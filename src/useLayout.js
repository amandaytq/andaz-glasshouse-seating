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
  if (next.kind === 'table' && !Array.isArray(next.seatNames)) next = { ...next, seatNames: [] }
  if (next.kind === 'table' && !Array.isArray(next.babySeats)) next = { ...next, babySeats: [] }

  if (next.kind === 'table' && next.shape === 'rect') {
    const patch = {}
    if (next.widthFt !== DEFAULT_TABLE_HEIGHT_FT) patch.widthFt = DEFAULT_TABLE_HEIGHT_FT
    const len = lengthFromPax(next.pax)
    if (len !== next.lengthFt) patch.lengthFt = len
    if (Object.keys(patch).length) next = { ...next, ...patch }
  } else if (next.widthFt == null) {
    next = { ...next, widthFt: DEFAULT_TABLE_HEIGHT_FT }
  }
  return next
}

function normalizeGuest(g, i) {
  const rsvp = String(g?.rsvp ?? 'yes').toLowerCase()
  return {
    id: g?.id || `g-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 5)}`,
    name: String(g?.name ?? '').trim(),
    side: g?.side === 'bride' ? 'bride' : 'groom',
    relation: String(g?.relation ?? '').trim(),
    group: String(g?.group ?? '').trim(),
    rsvp: ['yes', 'no', 'pending', 'baby'].includes(rsvp) ? rsvp : 'yes',
  }
}

// Keep every guest name unique (seats reference guests by name).
function dedupeGuestNames(guests) {
  const taken = new Set()
  return guests.map((g) => {
    if (!g.name) return g
    let name = g.name
    let n = 2
    while (taken.has(name.toLowerCase())) name = `${g.name} (${n++})`
    taken.add(name.toLowerCase())
    return name === g.name ? g : { ...g, name }
  })
}

function normalizeLayout(layout) {
  return {
    ...layout,
    view: { ...DEFAULT_VIEW, ...(layout.view || {}) },
    guests: dedupeGuestNames(
      Array.isArray(layout.guests) ? layout.guests.map(normalizeGuest) : [],
    ),
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
              seatNames: Array.isArray(src.seatNames) ? [...src.seatNames] : [],
            },
          ],
        }
      })
      return newId
    },
    [commit],
  )

  // Assign a guest to one seat. Guarantees the guest sits nowhere else: their
  // name is cleared from every other seat on every table first.
  const assignSeat = useCallback(
    (itemId, index, name) => {
      commit((prev) => {
        let mutated = false
        const items = prev.items.map((it) => {
          if (it.kind !== 'table') return it
          let seats = Array.isArray(it.seatNames) ? it.seatNames.slice() : []
          const before = seats.join(' ')
          if (name) {
            seats = seats.map((n, i) =>
              n === name && !(it.id === itemId && i === index) ? '' : n,
            )
          }
          if (it.id === itemId) {
            while (seats.length <= index) seats.push('')
            seats[index] = name
          }
          while (seats.length && !seats[seats.length - 1]) seats.pop()
          if (seats.join(' ') !== before) {
            mutated = true
            return { ...it, seatNames: seats }
          }
          return it
        })
        return mutated ? { ...prev, items } : prev
      })
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
    setGuestList: (next) =>
      commit((prev) => ({
        ...prev,
        guests: dedupeGuestNames(
          (typeof next === 'function' ? next(prev.guests || []) : next).map(normalizeGuest),
        ),
      })),
    updateItem,
    assignSeat,
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
