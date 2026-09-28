// File-backed store for INDIVIDUAL GUEST ROWS (separate from the table/layout
// document in layoutStore.js). Each guest is its own record — { id, name, side,
// relation, rsvp, meal, role?, tableId, seatIndex, updatedAt } — so 200 people
// can edit 200 different rows at once with no whole-document overwrite: a save
// only ever touches the one row (and, when it changes a seat, the row of
// whoever it bumped out of that seat).
//
// This mirrors what lambda/index.mjs does against DynamoDB — keep the two in
// sync; the seat-assignment logic below is duplicated there deliberately (kept
// short) rather than shared across a packaging boundary.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDefaultGuests } from '../src/data/defaultGuests.js'

const dir = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.LAYOUT_DATA_DIR || path.join(dir, 'data')
const FILE = path.join(DATA_DIR, 'guests.json')

let cache = null // Map<id, guest>
let chain = Promise.resolve()

function newId() {
  return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

async function load() {
  if (cache) return cache
  try {
    const raw = await fs.readFile(FILE, 'utf8')
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) {
      cache = new Map(arr.map((g) => [g.id, g]))
      return cache
    }
  } catch {
    /* missing or corrupt -> seed */
  }
  cache = new Map(buildDefaultGuests().map((g) => [g.id, { ...g, updatedAt: new Date().toISOString() }]))
  await persist()
  return cache
}

async function persist() {
  await fs.mkdir(DATA_DIR, { recursive: true })
  const tmp = `${FILE}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, JSON.stringify([...cache.values()], null, 2))
  await fs.rename(tmp, FILE)
}

export function listGuests() {
  chain = chain.then(load, load)
  return chain.then((m) => [...m.values()])
}

// Upsert one guest. If it takes a seat (tableId+seatIndex both set), whoever
// else is currently in that exact seat is bumped out (their tableId/seatIndex
// cleared) as part of the same write. Returns { guest, bumped: guest|null }.
export function upsertGuest(patch) {
  chain = chain.then(async () => {
    await load()
    const id = patch.id || newId()
    const prev = cache.get(id) || {}
    const guest = {
      id,
      name: String(patch.name ?? prev.name ?? '').trim(),
      side: patch.side === 'bride' || prev.side === 'bride' ? 'bride' : 'groom',
      relation: String(patch.relation ?? prev.relation ?? '').trim(),
      rsvp: patch.rsvp ?? prev.rsvp ?? 'yes',
      meal: patch.meal ?? prev.meal ?? 'chinese',
      tableId: patch.tableId !== undefined ? patch.tableId : (prev.tableId ?? null),
      seatIndex: patch.seatIndex !== undefined ? patch.seatIndex : (prev.seatIndex ?? null),
      updatedAt: new Date().toISOString(),
    }
    if (prev.role) guest.role = prev.role
    if (patch.role) guest.role = patch.role

    let bumped = null
    if (guest.tableId != null && guest.seatIndex != null) {
      for (const g of cache.values()) {
        if (g.id !== id && g.tableId === guest.tableId && g.seatIndex === guest.seatIndex) {
          bumped = { ...g, tableId: null, seatIndex: null, updatedAt: new Date().toISOString() }
          cache.set(g.id, bumped)
        }
      }
    }
    cache.set(id, guest)
    await persist()
    return { guest, bumped }
  })
  return chain
}

export function deleteGuest(id) {
  chain = chain.then(async () => {
    await load()
    cache.delete(id)
    await persist()
    return { ok: true }
  })
  return chain
}

export function resetGuests() {
  chain = chain.then(async () => {
    cache = new Map(buildDefaultGuests().map((g) => [g.id, { ...g, updatedAt: new Date().toISOString() }]))
    await persist()
    return [...cache.values()]
  })
  return chain
}
