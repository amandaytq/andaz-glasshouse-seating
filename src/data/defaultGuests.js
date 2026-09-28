// Builds the default GUEST ROWS (one per person) for seeding a fresh guest
// store (local file store, or a new DynamoDB table). Combines the bride/groom
// rosters with the seat arrangement authored in defaultLayout.js's table
// definitions (their `seatNames` extras), so a fresh seed reproduces the last
// synced seating plan.

import { BRIDE_GUESTS } from './brideGuests.js'
import { GROOM_GUESTS } from './groomGuests.js'
import { buildDefaultLayout } from '../defaultLayout.js'

export function buildDefaultGuests() {
  const layout = buildDefaultLayout()

  // name -> { tableId, seatIndex }, read off each table's authored seatNames.
  const seatOf = new Map()
  for (const item of layout.items) {
    if (item.kind !== 'table' || !Array.isArray(item.seatNames)) continue
    item.seatNames.forEach((name, i) => {
      if (name) seatOf.set(name, { tableId: item.id, seatIndex: i })
    })
  }

  const toGuest = (g, id) => {
    const seat = seatOf.get(g.name) || {}
    return {
      id,
      name: g.name,
      side: g.side,
      relation: g.relation || '',
      rsvp: g.rsvp || 'yes',
      meal: g.meal || 'chinese',
      ...(g.role ? { role: g.role } : {}),
      tableId: seat.tableId ?? null,
      seatIndex: seat.seatIndex ?? null,
    }
  }

  const bride = [
    { name: 'Amanda', side: 'bride', relation: 'Bride', rsvp: 'yes', role: 'bride' },
    ...BRIDE_GUESTS,
  ].map((g, i) => toGuest(g, i === 0 ? 'g-bride' : `g-b${i}`))

  const groom = [
    { name: 'Jeremiah', side: 'groom', relation: 'Groom', rsvp: 'yes', role: 'groom' },
    ...GROOM_GUESTS,
  ].map((g, i) => toGuest(g, i === 0 ? 'g-groom' : `g-g${i}`))

  return [...bride, ...groom]
}
