import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildDefaultLayout,
  lengthFromPax,
  DEFAULT_TABLE_HEIGHT_FT,
  DEFAULT_ROUND_DIAMETER_FT,
  DEFAULT_VIEW,
} from './defaultLayout.js'

// The layout lives on the server (server/data/layout.json) so every visitor of a
// deployed instance sees the same arrangement. This hook:
//   - loads it from GET /api/layout (with a localStorage cache for instant paint)
//   - autosaves every change with a debounced PUT /api/layout
//   - polls every few seconds and adopts remote changes when the user is idle
// Same-origin by default (Vite dev middleware, or an Amplify `/api/<*>` rewrite).
// Set VITE_LAYOUT_API to a full URL to call a Lambda Function URL directly.
const API = import.meta.env.VITE_LAYOUT_API || '/api/layout'
const CACHE_KEY = 'glasshouse-layout-cache-v3'
const HISTORY_LIMIT = 60
const SAVE_DEBOUNCE_MS = 700
const POLL_MS = 5000
const IDLE_BEFORE_ADOPT_MS = 3000

// Enforce the table sizing rules for every rectangular table:
//   - LENGTH is always derived from pax at 1 ft / pax (not user-editable)
//   - HEIGHT / depth is always DEFAULT_TABLE_HEIGHT_FT
function normalizeItem(item) {
  let next = item
  if (next.diameterFt == null) next = { ...next, diameterFt: DEFAULT_ROUND_DIAMETER_FT }
  if (next.kind === 'table' && !Array.isArray(next.babySeats)) next = { ...next, babySeats: [] }
  if (next.kind === 'table' && !Array.isArray(next.relations)) next = { ...next, relations: [] }

  if (next.kind === 'table' && next.shape === 'rect') {
    const patch = {}
    if (next.widthFt !== DEFAULT_TABLE_HEIGHT_FT) patch.widthFt = DEFAULT_TABLE_HEIGHT_FT
    // `lockLength` tables keep their explicit length (e.g. the matched VIP pair)
    const len = next.lockLength && next.lengthFt > 0 ? next.lengthFt : lengthFromPax(next.pax)
    if (len !== next.lengthFt) patch.lengthFt = len
    if (Object.keys(patch).length) next = { ...next, ...patch }
  } else if (next.widthFt == null) {
    next = { ...next, widthFt: DEFAULT_TABLE_HEIGHT_FT }
  }
  return next
}

function normalizeLayout(layout) {
  // `guests` was dropped in v3 (see defaultLayout.js) — strip it explicitly so
  // an old production layout.json (saved before this refactor, which still has
  // its whole guest roster embedded here) doesn't keep getting silently
  // resaved to S3 forever on every autosave.
  const { guests, ...rest } = layout
  return {
    ...rest,
    view: { ...DEFAULT_VIEW, ...(layout.view || {}) },
    items: (layout.items || []).map(normalizeItem),
  }
}

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (c?.layout && Array.isArray(c.layout.items)) return c
  } catch {
    /* ignore */
  }
  return null
}
function writeCache(rec) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(rec))
  } catch {
    /* ignore */
  }
}

export function useLayout() {
  const cached = readCache()
  const [layout, setLayout] = useState(cached ? normalizeLayout(cached.layout) : null)
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState('saved') // 'saved' | 'saving' | 'offline'

  const past = useRef([])
  const future = useRef([])

  const revRef = useRef(cached?.rev || 0)
  const layoutRef = useRef(layout)
  const syncedRef = useRef(false) // a real GET has succeeded at least once
  const skipSaveRef = useRef(false) // next layout change came from the server, don't push it back
  const dirtyRef = useRef(false) // unsaved local edits
  const lastEditRef = useRef(0)
  const saveTimer = useRef(null)

  useEffect(() => {
    layoutRef.current = layout
  }, [layout])

  const applyServerRecord = useCallback((rec) => {
    revRef.current = rec.rev || 0
    syncedRef.current = true
    skipSaveRef.current = true
    past.current = []
    future.current = []
    dirtyRef.current = false
    setLayout(normalizeLayout(rec.layout))
    writeCache({ rev: rec.rev, layout: rec.layout })
    setSaveState('saved')
  }, [])

  // ---- initial load -----------------------------------------------------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(API)
        if (!res.ok) throw new Error(String(res.status))
        const rec = await res.json()
        if (cancelled) return
        applyServerRecord(rec)
      } catch {
        if (cancelled) return
        // offline: fall back to cache, or the blueprint if there is none
        if (!layoutRef.current) setLayout(buildDefaultLayout())
        setSaveState('offline')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [applyServerRecord])

  // ---- push local changes to the server (debounced) -------------------
  const flushSave = useCallback(async () => {
    if (!syncedRef.current) return
    const snapshot = layoutRef.current
    if (!snapshot) return
    setSaveState('saving')
    try {
      const res = await fetch(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout: snapshot }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const rec = await res.json()
      revRef.current = rec.rev || revRef.current
      dirtyRef.current = false
      writeCache({ rev: revRef.current, layout: snapshot })
      setSaveState('saved')
    } catch {
      setSaveState('offline')
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(flushSave, 4000) // retry
    }
  }, [])

  useEffect(() => {
    if (loading || layout == null) return
    // cache locally on every change (offline resilience / instant reload)
    writeCache({ rev: revRef.current, layout })

    if (skipSaveRef.current) {
      skipSaveRef.current = false
      return
    }
    dirtyRef.current = true
    lastEditRef.current = Date.now()
    setSaveState('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(saveTimer.current)
  }, [layout, loading, flushSave])

  // ---- poll for changes made by other people ------------------------
  useEffect(() => {
    if (loading) return
    const iv = setInterval(async () => {
      if (dirtyRef.current) return
      if (Date.now() - lastEditRef.current < IDLE_BEFORE_ADOPT_MS) return
      try {
        const res = await fetch(API)
        if (!res.ok) return
        const rec = await res.json()
        if ((rec.rev || 0) !== revRef.current) applyServerRecord(rec)
        else if (saveState === 'offline') setSaveState('saved')
      } catch {
        /* still offline */
      }
    }, POLL_MS)
    return () => clearInterval(iv)
  }, [loading, saveState, applyServerRecord])

  // ---- history-aware mutators (unchanged public surface) -------------
  const commit = useCallback((updater) => {
    setLayout((prev) => {
      if (prev == null) return prev
      const next = typeof updater === 'function' ? updater(prev) : updater
      if (next === prev) return prev
      past.current = [...past.current.slice(-HISTORY_LIMIT + 1), prev]
      future.current = []
      return next
    })
  }, [])

  const transient = useCallback((updater) => {
    setLayout((prev) => (prev == null ? prev : typeof updater === 'function' ? updater(prev) : updater))
  }, [])

  const beginTransient = useCallback(() => {
    setLayout((prev) => {
      if (prev == null) return prev
      past.current = [...past.current.slice(-HISTORY_LIMIT + 1), prev]
      future.current = []
      return prev
    })
  }, [])

  const undo = useCallback(() => {
    setLayout((prev) => {
      if (past.current.length === 0) return prev
      const previous = past.current[past.current.length - 1]
      past.current = past.current.slice(0, -1)
      future.current = [prev, ...future.current]
      return previous
    })
  }, [])

  const redo = useCallback(() => {
    setLayout((prev) => {
      if (future.current.length === 0) return prev
      const next = future.current[0]
      future.current = future.current.slice(1)
      past.current = [...past.current, prev]
      return next
    })
  }, [])

  const updateItem = useCallback(
    (itemId, patch, { record = true } = {}) => {
      const apply = (prev) => ({
        ...prev,
        items: prev.items.map((it) =>
          it.id === itemId
            ? normalizeItem({ ...it, ...(typeof patch === 'function' ? patch(it) : patch) })
            : it,
        ),
      })
      record ? commit(apply) : transient(apply)
    },
    [commit, transient],
  )

  const addItem = useCallback(
    (item) => {
      const newId = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      commit((prev) => ({ ...prev, items: [...prev.items, { ...item, id: newId }] }))
      return newId
    },
    [commit],
  )

  const removeItem = useCallback(
    (itemId) => commit((prev) => ({ ...prev, items: prev.items.filter((it) => it.id !== itemId) })),
    [commit],
  )

  const duplicateItem = useCallback(
    (itemId) => {
      let newId = null
      commit((prev) => {
        const src = prev.items.find((it) => it.id === itemId)
        if (!src) return prev
        newId = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
        return {
          ...prev,
          items: [
            ...prev.items,
            {
              ...src,
              id: newId,
              name: `${src.name} (copy)`,
              x: src.x + 4,
              y: src.y + 4,
            },
          ],
        }
      })
      return newId
    },
    [commit],
  )

  // Move seat `from` to position `to` within one table; the baby-seat flags
  // in between shift to fill the gap. Who's actually seated where lives on
  // the guest rows now (see useGuests.js's reorderSeats, which moves seatIndex
  // on the guest side and calls this to keep the table's babySeats in step).
  const reorderBabySeats = useCallback(
    (tableId, from, to) => {
      if (from === to) return
      commit((prev) => ({
        ...prev,
        items: prev.items.map((it) => {
          if (it.id !== tableId || it.kind !== 'table') return it
          const pax = Math.max(0, Math.round(Number(it.pax) || 0))
          if (from < 0 || from >= pax || to < 0 || to >= pax) return it
          const babySet = new Set(Array.isArray(it.babySeats) ? it.babySeats : [])
          const flags = Array.from({ length: pax }, (_, i) => babySet.has(i))
          const [moved] = flags.splice(from, 1)
          flags.splice(to, 0, moved)
          const babySeats = flags.map((b, i) => (b ? i : -1)).filter((i) => i >= 0)
          return { ...it, babySeats }
        }),
      }))
    },
    [commit],
  )

  // Swap two tables' baby-seat flags (paired with useGuests.js's
  // swapTableSeats, which swaps who's actually sitting where).
  const swapBabySeats = useCallback(
    (aId, bId) => {
      if (!aId || !bId || aId === bId) return
      commit((prev) => {
        const a = prev.items.find((i) => i.id === aId)
        const b = prev.items.find((i) => i.id === bId)
        if (!a || !b) return prev
        return {
          ...prev,
          items: prev.items.map((it) => {
            if (it.id === aId) return { ...it, babySeats: [...(b.babySeats || [])] }
            if (it.id === bId) return { ...it, babySeats: [...(a.babySeats || [])] }
            return it
          }),
        }
      })
    },
    [commit],
  )

  // Tag a table with the guest `relations` it's meant to hold (used by
  // useGuests.js's fillTableByRelations to know who's eligible for the seats).
  const setTableRelations = useCallback(
    (itemId, relations) => {
      const rels = [...new Set((relations || []).filter(Boolean))]
      commit((prev) => ({
        ...prev,
        items: prev.items.map((it) => (it.id === itemId ? { ...it, relations: rels } : it)),
      }))
    },
    [commit],
  )

  // Reset asks the server to restore the blueprint so everyone gets it.
  const resetLayout = useCallback(async () => {
    try {
      const res = await fetch(`${API}/reset`, { method: 'POST' })
      if (!res.ok) throw new Error(String(res.status))
      applyServerRecord(await res.json())
    } catch {
      commit(() => buildDefaultLayout())
    }
  }, [applyServerRecord, commit])

  const replaceLayout = useCallback(
    (next) => {
      if (!next || !Array.isArray(next.items)) throw new Error('Invalid layout file')
      commit(() => normalizeLayout(next))
    },
    [commit],
  )

  return {
    layout,
    loading,
    saveState,
    setLayoutName: (name) => commit((prev) => ({ ...prev, name })),
    setLayoutView: (patch) =>
      commit((prev) => ({ ...prev, view: { ...DEFAULT_VIEW, ...prev.view, ...patch } })),
    updateItem,
    reorderBabySeats,
    swapBabySeats,
    setTableRelations,
    addItem,
    removeItem,
    duplicateItem,
    resetLayout,
    replaceLayout,
    undo,
    redo,
    beginTransient,
    canUndo: () => past.current.length > 0,
    canRedo: () => future.current.length > 0,
  }
}
