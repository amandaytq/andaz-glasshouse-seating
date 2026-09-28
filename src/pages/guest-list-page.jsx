import { useEffect, useMemo, useState } from 'react'
import { useGuests } from '../hooks/use-guests.js'
import { useLayout } from '../hooks/use-layout.js'
import { ConfirmDialog } from '../components/confirm-dialog.jsx'
import { Combobox } from '../components/combobox.jsx'

const TABS = [
  { value: 'all', label: 'All' },
  { value: 'bride', label: 'Bride' },
  { value: 'groom', label: 'Groom' },
]

// Public, searchable guest list — no password (unlike /assign-seats). Almost
// everything here is read-only: name, category, meal, table, afterparty and
// parking are admin-only fields, edited in the password-gated seating planner
// (see views/guest-manager.jsx). The one exception is "Arrived" — anyone on
// this page can check a guest in, so door staff don't need the admin password
// just to mark arrivals.
export function GuestListPage() {
  const { guests: allGuests, loading: guestsLoading, patchGuest } = useGuests()
  const { layout, loading: layoutLoading } = useLayout()
  // The couple themselves aren't "guests" — leave Amanda and Jeremiah out of
  // this list entirely (counts, filters, search, everything).
  const guests = useMemo(
    () => allGuests.filter((g) => g.role !== 'bride' && g.role !== 'groom'),
    [allGuests],
  )
  const [side, setSide] = useState('all')
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [pendingUncheck, setPendingUncheck] = useState(null) // guest being un-checked-in, awaiting confirmation

  // Checking someone in is a one-click action; undoing it asks first, since
  // it's easy to fat-finger on a phone at a busy door and lose track of
  // who's actually arrived.
  const toggleArrived = (g) => {
    if (g.arrived) setPendingUncheck(g)
    else patchGuest(g.id, { arrived: true })
  }

  const sideCounts = useMemo(
    () => ({
      all: guests.length,
      bride: guests.filter((g) => g.side === 'bride').length,
      groom: guests.filter((g) => g.side === 'groom').length,
    }),
    [guests],
  )

  const tableNameById = useMemo(() => {
    const m = new Map()
    for (const it of layout?.items ?? []) if (it.kind === 'table') m.set(it.id, it.name)
    return m
  }, [layout])

  // Only the categories that actually exist on the current tab's side — no
  // point offering "IBM" while looking at the Groom tab if it's a bride-only
  // category.
  const categories = useMemo(() => {
    const set = new Set()
    for (const g of guests) {
      if (side !== 'all' && g.side !== side) continue
      if (g.relation) set.add(g.relation)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [guests, side])

  // If the selected category doesn't exist on the newly-picked side (or
  // anywhere anymore), fall back to "All categories" instead of silently
  // filtering everything out.
  useEffect(() => {
    if (category !== 'all' && !categories.includes(category)) setCategory('all')
  }, [category, categories])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return guests
      .filter((g) => side === 'all' || g.side === side)
      .filter((g) => category === 'all' || g.relation === category)
      .filter((g) => !needle || g.name.toLowerCase().includes(needle))
      .map((g) => ({ ...g, tableName: g.tableId ? tableNameById.get(g.tableId) : null }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [guests, side, category, query, tableNameById])

  const loading = guestsLoading || layoutLoading

  return (
    <div className="guestlist-page">
      <header className="guestlist-head">
        <strong>Guest List</strong>
        <span className="field-hint">
          {loading ? 'loading…' : `${rows.length} of ${guests.length} guests`}
        </span>
      </header>

      <div className="guestlist-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={side === t.value}
            className={`guestlist-tab${side === t.value ? ' is-active' : ''}`}
            onClick={() => setSide(t.value)}
          >
            {t.label} <span className="guestlist-tab-count">{sideCounts[t.value]}</span>
          </button>
        ))}
      </div>

      <div className="guestlist-filters">
        <input
          className="guestlist-search"
          type="search"
          placeholder="Search by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Combobox
          value={category === 'all' ? '' : category}
          placeholder="All categories"
          emptyLabel="All categories"
          groups={[{ label: 'Categories', options: categories.map((c) => ({ value: c, label: c })) }]}
          onChange={(v) => setCategory(v || 'all')}
        />
      </div>

      {loading ? (
        <p className="field-hint">Loading the guest list…</p>
      ) : (
        <div className="guestlist-table-wrap">
          <table className="guestlist-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Side</th>
                <th>Category</th>
                <th>Table</th>
                <th>Afterparty</th>
                <th>Parking</th>
                <th>Arrived</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id}>
                  <td data-label="Name">{g.name}</td>
                  <td data-label="Side">{g.side === 'bride' ? "Bride's side" : "Groom's side"}</td>
                  <td data-label="Category">{g.relation || '—'}</td>
                  <td data-label="Table">{g.tableName || '— unseated —'}</td>
                  <td data-label="Afterparty">
                    {g.afterparty ? <span className="ap-badge is-yes">Yes</span> : <span className="ap-dash">–</span>}
                  </td>
                  <td data-label="Parking">
                    {g.needsParking ? (
                      <span className="ap-badge is-yes">Yes</span>
                    ) : (
                      <span className="ap-dash">–</span>
                    )}
                  </td>
                  <td data-label="Arrived">
                    <button
                      type="button"
                      className="ap-badge ap-badge-btn"
                      title={g.arrived ? 'Click to undo check-in' : 'Click to check in'}
                      onClick={() => toggleArrived(g)}
                    >
                      {g.arrived ? '✓ Checked In' : 'Check In'}
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="guestlist-empty">
                    No guests match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingUncheck}
        title="Undo check-in?"
        message={pendingUncheck ? `Mark ${pendingUncheck.name} as not arrived.` : ''}
        confirmLabel="Undo check-in"
        danger
        onConfirm={() => {
          patchGuest(pendingUncheck.id, { arrived: false })
          setPendingUncheck(null)
        }}
        onCancel={() => setPendingUncheck(null)}
      />
    </div>
  )
}
