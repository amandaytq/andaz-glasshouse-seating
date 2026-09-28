import { useCallback, useEffect, useRef, useState } from 'react'
import { buildDefaultGuests } from '../data/default-guests.js'

// Guests live as individual rows (one per person) — { id, name, side, relation,
// rsvp, meal, role?, tableId, seatIndex, updatedAt } — so ~200 people can each
// edit their own row without clobbering anyone else's. Unlike src/hooks/use-layout.js's
// table/furniture document, there is no single "the guest list" blob and no
// document-level undo/redo here: every field change saves itself, per row, on
// its own short debounce, and a poll periodically adopts rows other people
// changed (skipping any row this tab has a pending or in-flight edit for).
// Server side: server/guest-store.js (local dev, file-backed) and lambda/index.mjs
// (DynamoDB) — both enforce "a guest can only be in one seat" by bumping
// (clearing) whoever else is in a seat a write claims.
const API = import.meta.env.VITE_GUESTS_API || '/api/guests'
const CACHE_KEY = 'glasshouse-guests-cache-v1'
const SAVE_DEBOUNCE_MS = 700
const POLL_MS = 5000

function readCache() {
  try {
    const arr = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (Array.isArray(arr)) return arr
  } catch {
    /* ignore */
  }
  return null
}
function writeCache(list) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

// Reconcile a fresh server list against the local one: a row with a pending
// (unsaved or in-flight) local edit is kept as-is instead of being overwritten
// by whatever's on the server; everything else adopts the server's value. A
// row this tab deleted (but whose DELETE hasn't been confirmed by the server
// yet) is dropped outright, even if the poll still sees it on the server —
// otherwise a poll landing between "remove locally" and "server processes the
// DELETE" would silently bring a removed guest back.
function mergeServer(serverList, localList, dirty, deleted) {
  const localById = new Map(localList.map((g) => [g.id, g]))
  const out = []
  for (const sg of serverList) {
    if (deleted.has(sg.id)) continue
    out.push(dirty.has(sg.id) ? localById.get(sg.id) || sg : sg)
  }
  for (const lg of localList) {
    if (dirty.has(lg.id) && !serverList.some((sg) => sg.id === lg.id)) out.push(lg)
  }
  return out
}

let seq = 0
function newId() {
  return `g-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

// Make `name` unique against `list` (case-insensitively), tagging with
// `relation` first, then a running number — mirrors the old whole-document
// dedupe, applied one name at a time since rows save independently now.
function uniqueName(list, name, relation, excludeId) {
  if (!name) return name
  const taken = new Set(
    list.filter((g) => g.id !== excludeId).map((g) => g.name.toLowerCase()),
  )
  if (!taken.has(name.toLowerCase())) return name
  const base = relation ? `${name} (${relation})` : name
  let candidate = base
  let n = 2
  while (taken.has(candidate.toLowerCase())) candidate = `${base} ${n++}`
  return candidate
}

export function useGuests() {
  const cached = readCache()
  const [guests, setGuests] = useState(cached || [])
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState('saved') // 'saved' | 'saving' | 'offline'

  const guestsRef = useRef(guests)
  const dirtyRef = useRef(new Set()) // ids with an unsaved or in-flight edit
  const deletedRef = useRef(new Set()) // ids removed locally, DELETE not yet confirmed
  const timersRef = useRef(new Map()) // id -> debounce/retry timer

  useEffect(() => {
    guestsRef.current = guests
    writeCache(guests)
  }, [guests])

  // ---- save one row ------------------------------------------------------
  const flushRow = useCallback(async (id) => {
    const row = guestsRef.current.find((g) => g.id === id)
    if (!row) {
      dirtyRef.current.delete(id)
      return
    }
    setSaveState('saving')
    try {
      const res = await fetch(`${API}/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row),
      })
      if (!res.ok) throw new Error(String(res.status))
      const { guest, bumped } = await res.json()
      dirtyRef.current.delete(id)
      setGuests((prev) =>
        prev.map((g) => {
          if (g.id === id) return guest
          if (bumped && g.id === bumped.id && !dirtyRef.current.has(g.id)) return bumped
          return g
        }),
      )
      if (dirtyRef.current.size === 0) setSaveState('saved')
    } catch {
      setSaveState('offline')
      clearTimeout(timersRef.current.get(id))
      timersRef.current.set(id, setTimeout(() => flushRow(id), 4000)) // retry
    }
  }, [])

  const scheduleSave = useCallback(
    (id) => {
      dirtyRef.current.add(id)
      setSaveState('saving')
      clearTimeout(timersRef.current.get(id))
      timersRef.current.set(id, setTimeout(() => flushRow(id), SAVE_DEBOUNCE_MS))
    },
    [flushRow],
  )

  // ---- initial load -------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(API)
        if (!res.ok) throw new Error(String(res.status))
        const list = await res.json()
        if (cancelled) return
        setGuests(list)
        writeCache(list)
        setSaveState('saved')
      } catch {
        if (cancelled) return
        // offline: fall back to cache, or the seed list if there is none
        if (!guestsRef.current.length) setGuests(buildDefaultGuests())
        setSaveState('offline')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      for (const t of timersRef.current.values()) clearTimeout(t)
    }
  }, [])

  // ---- poll for changes made by other people ------------------------------
  useEffect(() => {
    if (loading) return
    const iv = setInterval(async () => {
      try {
        const res = await fetch(API)
        if (!res.ok) return
        const list = await res.json()
        setGuests((prev) => mergeServer(list, prev, dirtyRef.current, deletedRef.current))
        if (dirtyRef.current.size === 0) setSaveState('saved')
      } catch {
        /* still offline */
      }
    }, POLL_MS)
    return () => clearInterval(iv)
  }, [loading])

  // ---- local mutation primitive -------------------------------------------
  // Apply `patch` to one guest's row and save it (debounced). A name in the
  // patch is de-duped against everyone else first (seats reference guests by
  // name, so names must stay unique).
  const patchGuest = useCallback(
    (id, patch) => {
      setGuests((prev) => {
        let p = patch
        if (typeof patch.name === 'string' && patch.name) {
          const cur = prev.find((g) => g.id === id)
          const name = uniqueName(prev, patch.name, patch.relation ?? cur?.relation, id)
          if (name !== patch.name) p = { ...patch, name }
        }
        return prev.map((g) => (g.id === id ? { ...g, ...p } : g))
      })
      scheduleSave(id)
      return id
    },
    [scheduleSave],
  )

  // Add one new guest (own row from the start) and save it right away.
  const addGuest = useCallback(
    (patch = {}) => {
      const id = newId()
      const row = {
        id,
        name: '',
        side: 'bride',
        relation: '',
        rsvp: 'yes',
        meal: 'chinese',
        afterparty: false,
        arrived: false,
        needsParking: false,
        tableId: null,
        seatIndex: null,
        ...patch,
      }
      setGuests((prev) => [...prev, row])
      scheduleSave(id)
      return id
    },
    [scheduleSave],
  )

  // Add several guests at once (built-in list import / pasted block), deduping
  // names against the current list and each other.
  const bulkAddGuests = useCallback(
    (rows) => {
      const list = guestsRef.current
      const taken = new Set(list.map((g) => g.name.toLowerCase()))
      const added = []
      for (const r of rows) {
        if (!r.name) continue
        let name = r.name
        if (taken.has(name.toLowerCase())) {
          const base = r.relation ? `${r.name} (${r.relation})` : r.name
          name = base
          let n = 2
          while (taken.has(name.toLowerCase())) name = `${base} ${n++}`
        }
        taken.add(name.toLowerCase())
        added.push({
          id: newId(),
          name,
          side: r.side === 'bride' ? 'bride' : 'groom',
          relation: r.relation || '',
          rsvp: r.rsvp || 'yes',
          meal: r.meal || 'chinese',
          afterparty: !!r.afterparty,
          arrived: !!r.arrived,
          needsParking: !!r.needsParking,
          tableId: null,
          seatIndex: null,
        })
      }
      if (!added.length) return []
      setGuests((prev) => [...prev, ...added])
      added.forEach((g) => scheduleSave(g.id))
      return added
    },
    [scheduleSave],
  )

  const removeGuest = useCallback((id) => {
    clearTimeout(timersRef.current.get(id))
    timersRef.current.delete(id)
    dirtyRef.current.delete(id)
    deletedRef.current.add(id) // suppress poll resurrection until the DELETE is confirmed
    setGuests((prev) => prev.filter((g) => g.id !== id))

    const sendDelete = () => {
      fetch(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' })
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status))
          deletedRef.current.delete(id) // confirmed gone server-side
        })
        .catch(() => {
          // retry — keep suppressing until it lands, so a poll in between can't bring it back
          timersRef.current.set(id, setTimeout(sendDelete, 4000))
        })
    }
    sendDelete()
  }, [])

  // Wholesale replace the guest list (JSON import). Every row in `list` is
  // upserted (saved); any row that existed before and isn't in `list` anymore
  // is deleted. Used only by SeatingPlannerPage (pages/seating-planner-page.jsx)'s Import — everyday edits go through the
  // per-row ops above.
  const replaceGuests = useCallback(
    (list) => {
      for (const t of timersRef.current.values()) clearTimeout(t)
      timersRef.current.clear()
      const withIds = list.map((g) => ({ ...g, id: g.id || newId() }))
      const oldIds = new Set(guestsRef.current.map((g) => g.id))
      const newIds = new Set(withIds.map((g) => g.id))
      dirtyRef.current = new Set(newIds)
      setGuests(withIds)
      withIds.forEach((g) => scheduleSave(g.id))
      for (const id of oldIds) {
        if (!newIds.has(id)) {
          deletedRef.current.add(id)
          fetch(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' })
            .then((res) => {
              if (res.ok) deletedRef.current.delete(id)
            })
            .catch(() => {})
        }
      }
    },
    [scheduleSave],
  )

  const resetGuests = useCallback(async () => {
    for (const t of timersRef.current.values()) clearTimeout(t)
    timersRef.current.clear()
    dirtyRef.current.clear()
    try {
      const res = await fetch(`${API}/reset`, { method: 'POST' })
      if (!res.ok) throw new Error(String(res.status))
      const list = await res.json()
      setGuests(list)
      writeCache(list)
      setSaveState('saved')
    } catch {
      setGuests(buildDefaultGuests())
    }
  }, [])

  // ---- seat operations ----------------------------------------------------
  // These operate on guest rows only; table pax/relations live in use-layout.js
  // now, so callers (SeatingPlannerPage (pages/seating-planner-page.jsx)) pass in whatever table info each op needs and
  // separately keep the table's own extras (babySeats, relations tag) in step
  // via use-layout.js's reorderBabySeats / setTableRelations.

  // Put `name` in table `tableId`'s seat `seatIndex`; whoever else is in that
  // exact seat is unseated. Pass a falsy name to just clear the seat.
  const assignSeat = useCallback(
    (tableId, seatIndex, name) => {
      const byId = new Map(guestsRef.current.map((g) => [g.id, { ...g }]))
      const changedIds = []
      for (const g of byId.values()) {
        if (g.tableId === tableId && g.seatIndex === seatIndex && g.name !== name) {
          g.tableId = null
          g.seatIndex = null
          changedIds.push(g.id)
        }
      }
      if (name) {
        const target = [...byId.values()].find((g) => g.name === name)
        if (target && (target.tableId !== tableId || target.seatIndex !== seatIndex)) {
          target.tableId = tableId
          target.seatIndex = seatIndex
          changedIds.push(target.id)
        }
      }
      if (!changedIds.length) return
      setGuests([...byId.values()])
      changedIds.forEach(scheduleSave)
    },
    [scheduleSave],
  )

  // Seat `name` at the first free seat of `tableId` (or unseat them if tableId
  // is falsy). No-op if the guest is already at that table, or it's full.
  const seatGuestAtTable = useCallback(
    (name, tableId, pax) => {
      const list = guestsRef.current
      const guest = list.find((g) => g.name === name)
      if (!guest) return
      if (!tableId) {
        if (guest.tableId == null) return
        patchGuest(guest.id, { tableId: null, seatIndex: null })
        return
      }
      if (guest.tableId === tableId) return // already seated here
      const taken = new Set(
        list.filter((g) => g.tableId === tableId && g.id !== guest.id).map((g) => g.seatIndex),
      )
      let free = -1
      for (let i = 0; i < pax; i++) {
        if (!taken.has(i)) {
          free = i
          break
        }
      }
      if (free === -1) return // full
      patchGuest(guest.id, { tableId, seatIndex: free })
    },
    [patchGuest],
  )

  // Move seat `from` to position `to` within one table (0-based, `pax` seats);
  // the seats in between shift to fill the gap.
  const reorderSeats = useCallback(
    (tableId, from, to, pax) => {
      if (from === to || from < 0 || from >= pax || to < 0 || to >= pax) return
      const list = guestsRef.current
      const seats = Array.from(
        { length: pax },
        (_, i) => list.find((g) => g.tableId === tableId && g.seatIndex === i) || null,
      )
      const [moved] = seats.splice(from, 1)
      seats.splice(to, 0, moved)
      const changes = new Map()
      seats.forEach((g, i) => {
        if (g && g.seatIndex !== i) changes.set(g.id, i)
      })
      if (!changes.size) return
      setGuests((prev) => prev.map((g) => (changes.has(g.id) ? { ...g, seatIndex: changes.get(g.id) } : g)))
      changes.forEach((_, id) => scheduleSave(id))
    },
    [scheduleSave],
  )

  // Move every guest seated at table `aId` to table `bId` and vice versa.
  const swapTableSeats = useCallback(
    (aId, bId) => {
      if (!aId || !bId || aId === bId) return
      const changedIds = []
      const next = guestsRef.current.map((g) => {
        if (g.tableId === aId) {
          changedIds.push(g.id)
          return { ...g, tableId: bId }
        }
        if (g.tableId === bId) {
          changedIds.push(g.id)
          return { ...g, tableId: aId }
        }
        return g
      })
      if (!changedIds.length) return
      setGuests(next)
      changedIds.forEach(scheduleSave)
    },
    [scheduleSave],
  )

  // Unseat everyone currently at `tableId` ("clear" in the inspector).
  const clearTable = useCallback(
    (tableId) => {
      const changedIds = []
      const next = guestsRef.current.map((g) => {
        if (g.tableId === tableId) {
          changedIds.push(g.id)
          return { ...g, tableId: null, seatIndex: null }
        }
        return g
      })
      if (!changedIds.length) return
      setGuests(next)
      changedIds.forEach(scheduleSave)
    },
    [scheduleSave],
  )

  // Drop every not-yet-seated guest matching `relations` (tags like
  // "bride::Relative", or bare "Relative" for either side) into table
  // `tableId`'s free seats, guest-list order. Already-seated guests are left
  // where they are.
  const fillTableByRelations = useCallback(
    (tableId, relations, pax) => {
      const list = guestsRef.current
      const specs = (relations || []).filter(Boolean).map((r) => {
        const i = r.indexOf('::')
        return i >= 0 ? { side: r.slice(0, i), relation: r.slice(i + 2) } : { side: null, relation: r }
      })
      const takenSeats = new Set(list.filter((g) => g.tableId === tableId).map((g) => g.seatIndex))
      const freeSeats = []
      for (let i = 0; i < pax; i++) if (!takenSeats.has(i)) freeSeats.push(i)
      const wanted = list.filter(
        (g) =>
          g.name &&
          g.tableId == null &&
          specs.some((sp) => sp.relation === g.relation && (!sp.side || sp.side === g.side)),
      )
      const seatOf = new Map()
      for (let i = 0; i < freeSeats.length && i < wanted.length; i++) seatOf.set(wanted[i].id, freeSeats[i])
      if (!seatOf.size) return
      setGuests((prev) =>
        prev.map((g) => (seatOf.has(g.id) ? { ...g, tableId, seatIndex: seatOf.get(g.id) } : g)),
      )
      seatOf.forEach((_, id) => scheduleSave(id))
    },
    [scheduleSave],
  )

  return {
    guests,
    loading,
    saveState,
    patchGuest,
    addGuest,
    bulkAddGuests,
    removeGuest,
    replaceGuests,
    resetGuests,
    assignSeat,
    seatGuestAtTable,
    reorderSeats,
    swapTableSeats,
    clearTable,
    fillTableByRelations,
  }
}
