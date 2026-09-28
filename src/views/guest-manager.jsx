import { useMemo, useState } from 'react'

const SIDES = [
  { key: 'bride', label: "Bride's side" },
  { key: 'groom', label: "Groom's side" },
]

// Meal preference — defaults to the standard Chinese banquet menu.
const MEALS = ['chinese', 'vegetarian', 'halal']
const MEAL_LABEL = { chinese: 'Chinese', vegetarian: 'Vegetarian', halal: 'Halal' }
const MEAL_BADGE = { chinese: 'C', vegetarian: 'V', halal: 'H' }
const nextMeal = (m) => MEALS[(MEALS.indexOf(m) + 1) % MEALS.length]

const csvCell = (v) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// One CSV, rows sorted by side then table then name.  Columns:
// Side, Name, Relation, Meal, Afterparty, Arrived, Parking Coupon, Table, Seat
function guestsToCsv(guests, seatedNames) {
  const rows = guests
    .map((g) => {
      const at = seatedNames?.get(g.name)
      return {
        side: g.side === 'bride' ? "Bride's side" : "Groom's side",
        name: g.name,
        relation: g.relation || '',
        meal: MEAL_LABEL[g.meal] || MEAL_LABEL.chinese,
        afterparty: g.afterparty ? 'Yes' : 'No',
        arrived: g.arrived ? 'Yes' : 'No',
        parking: g.needsParking ? 'Yes' : 'No',
        table: at?.table || '',
        seat: at?.seat || '',
        _sk: g.side === 'bride' ? 0 : 1,
      }
    })
    .sort(
      (a, b) =>
        a._sk - b._sk ||
        String(a.table).localeCompare(String(b.table), undefined, { numeric: true }) ||
        a.name.localeCompare(b.name),
    )
  const header = [
    'Side',
    'Name',
    'Relation',
    'Meal',
    'Afterparty',
    'Arrived',
    'Parking Coupon',
    'Table',
    'Seat',
  ]
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push(
      [r.side, r.name, r.relation, r.meal, r.afterparty, r.arrived, r.parking, r.table, r.seat]
        .map(csvCell)
        .join(','),
    )
  }
  return lines.join('\r\n')
}

function downloadCsv(text, filename) {
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Parse a pasted block, one guest per line, columns separated by TAB (or 2+
// spaces):  Name  <TAB>  Relation  <TAB>  [Group]  <TAB>  Attendance
// Only the first column is required; the rest are optional. The Group column, if
// present, is ignored.
export function parseGuestPaste(text, side) {
  const rows = []
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (/^\s*name\b/i.test(line) && /(relation|attend)/i.test(line)) continue // header
    const parts = (line.includes('\t') ? line.split('\t') : line.split(/\s{2,}/)).map((p) => p.trim())
    const name = parts[0]
    if (!name) continue
    const relation = parts[1] || ''
    const att = (parts[3] || parts[2] || '').toLowerCase()
    const rsvp =
      att.includes('baby') || /\bbaby$/i.test(name)
        ? 'baby'
        : att.includes('pend')
          ? 'pending'
          : att === 'no'
            ? 'no'
            : 'yes'
    rows.push({ name, side, relation, rsvp })
  }
  return rows
}

// guests: rows from useGuests(). onUpdateGuest/onRemoveGuest/onAddGuest/onBulkAdd
// are useGuests operations — each save is scoped to the one row it touches, so
// 200 people editing at once never overwrite each other's edits (see use-guests.js).
export function GuestManager({
  guests,
  onUpdateGuest,
  onRemoveGuest,
  onAddGuest,
  onBulkAdd,
  seatedNames,
  tables = [],
  onSeatGuest,
}) {
  const [q, setQ] = useState('')
  const [pasteSide, setPasteSide] = useState(null) // 'bride' | 'groom' | null
  const [pasteText, setPasteText] = useState('')
  const [collapsed, setCollapsed] = useState({ __rel: true }) // side keys + "side::relation" keys
  const toggle = (key) => setCollapsed((c) => ({ ...c, [key]: !c[key] }))

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return guests.filter(
      (g) => !needle || g.name.toLowerCase().includes(needle) || g.relation.toLowerCase().includes(needle),
    )
  }, [guests, q])

  const bySide = (side) => filtered.filter((g) => g.side === side)
  const sideStats = (side) => {
    const all = guests.filter((g) => g.side === side)
    return { total: all.length, seated: all.filter((g) => seatedNames?.has(g.name)).length }
  }

  // guests of a side, grouped into { relation, items } sorted by relation
  const relationGroups = (side) => {
    const map = new Map()
    for (const g of bySide(side)) {
      const r = g.relation || '(no relation)'
      if (!map.has(r)) map.set(r, [])
      map.get(r).push(g)
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([relation, items]) => ({ relation, items }))
  }

  const renderRow = (g) => {
    const seatedAt = seatedNames?.get(g.name)
    return (
      <li key={g.id} className="guestmgr-row">
        <input
          className="g-name"
          value={g.name}
          placeholder="name"
          onChange={(e) => onUpdateGuest(g.id, { name: e.target.value })}
        />
        <input
          className="g-rel"
          value={g.relation}
          placeholder="relation"
          onChange={(e) => onUpdateGuest(g.id, { relation: e.target.value })}
        />
        <button
          className={`g-meal is-${g.meal || 'chinese'}`}
          title={`Meal: ${MEAL_LABEL[g.meal] || MEAL_LABEL.chinese} (click to change)`}
          onClick={() => onUpdateGuest(g.id, { meal: nextMeal(g.meal || 'chinese') })}
        >
          {MEAL_BADGE[g.meal] || MEAL_BADGE.chinese}
        </button>
        <button
          className={`g-ap${g.afterparty ? ' is-yes' : ''}`}
          title={`Afterparty: ${g.afterparty ? 'Yes' : 'No'} (click to toggle)`}
          onClick={() => onUpdateGuest(g.id, { afterparty: !g.afterparty })}
        >
          {g.afterparty ? '🎉' : '—'}
        </button>
        <button
          className={`g-arrived${g.arrived ? ' is-yes' : ''}`}
          title={`Arrived: ${g.arrived ? 'Yes' : 'No'} (click to toggle)`}
          onClick={() => onUpdateGuest(g.id, { arrived: !g.arrived })}
        >
          {g.arrived ? '✓' : '—'}
        </button>
        <button
          className={`g-parking${g.needsParking ? ' is-yes' : ''}`}
          title={`Needs parking coupon: ${g.needsParking ? 'Yes' : 'No'} (click to toggle)`}
          onClick={() => onUpdateGuest(g.id, { needsParking: !g.needsParking })}
        >
          {g.needsParking ? '🅿️' : '—'}
        </button>
        <select
          className={`g-table-sel${seatedAt ? '' : ' is-unseated'}`}
          value={seatedAt?.tableId || ''}
          title={seatedAt ? seatedAt.label : 'not seated'}
          onChange={(e) => onSeatGuest?.(g.name, e.target.value)}
        >
          <option value="">— unseated —</option>
          {tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button className="g-del" onClick={() => onRemoveGuest(g.id)} title="remove">
          ×
        </button>
      </li>
    )
  }
  const add = (side) => {
    setCollapsed((c) => ({ ...c, [side]: false, [`${side}::(no relation)`]: false }))
    onAddGuest({ side })
  }

  const doPaste = () => {
    const rows = parseGuestPaste(pasteText, pasteSide)
    if (rows.length) onBulkAdd(rows)
    setPasteText('')
    setPasteSide(null)
  }

  return (
    <div className="guestmgr">
      <div className="guestmgr-head">
        <strong>Guest list</strong>
        <span>
          <span className="field-hint">{guests.length} total</span>
          <button
            className="mini"
            disabled={!guests.length}
            onClick={() => downloadCsv(guestsToCsv(guests, seatedNames), 'glasshouse-guest-list.csv')}
          >
            export CSV
          </button>
        </span>
      </div>

      <input
        className="guestmgr-search"
        type="search"
        placeholder="Filter by name or relation…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {SIDES.map(({ key, label }) => {
        const isOpen = !collapsed[key] || !!q.trim() // an active filter forces open
        return (
        <section key={key} className="guestmgr-side">
          <div className="guestmgr-side-head">
            <button
              className="guestmgr-toggle"
              onClick={() => toggle(key)}
              aria-expanded={isOpen}
            >
              <span className="chev">{isOpen ? '▾' : '▸'}</span>
              {label}{' '}
              <span className="field-hint">
                ({sideStats(key).seated} / {sideStats(key).total} seated)
              </span>
            </button>
            <span>
              <button className="mini" onClick={() => add(key)}>
                + add
              </button>
              <button className="mini" onClick={() => setPasteSide(pasteSide === key ? null : key)}>
                paste
              </button>
            </span>
          </div>

          {isOpen && pasteSide === key && (
            <div className="guestmgr-paste">
              <textarea
                rows={5}
                placeholder={'Name<tab>Relation<tab>Yes/Pending/Baby\none guest per line'}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <div className="guestmgr-paste-actions">
                <button onClick={doPaste} disabled={!pasteText.trim()}>
                  Add {parseGuestPaste(pasteText, key).length || ''} to {label}
                </button>
                <button
                  onClick={() => {
                    setPasteText('')
                    setPasteSide(null)
                  }}
                >
                  cancel
                </button>
              </div>
            </div>
          )}

          {isOpen && (
            <div className="guestmgr-rels">
              {relationGroups(key).map(({ relation, items }) => {
                const rkey = `${key}::${relation}`
                const rOpen = !collapsed[rkey] || !!q.trim()
                return (
                  <div key={rkey} className="guestmgr-relgroup">
                    <button
                      className="guestmgr-toggle guestmgr-reltoggle"
                      onClick={() => toggle(rkey)}
                      aria-expanded={rOpen}
                    >
                      <span className="chev">{rOpen ? '▾' : '▸'}</span>
                      {relation} <span className="field-hint">({items.length})</span>
                    </button>
                    {rOpen && <ul className="guestmgr-list">{items.map(renderRow)}</ul>}
                  </div>
                )
              })}
              {bySide(key).length === 0 && <div className="guestmgr-empty">none</div>}
            </div>
          )}
        </section>
        )
      })}
    </div>
  )
}
