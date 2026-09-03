import { useMemo, useState } from 'react'
import { BRIDE_GUESTS } from './data/brideGuests.js'
import { GROOM_GUESTS } from './data/groomGuests.js'

const BUILTIN = { bride: BRIDE_GUESTS, groom: GROOM_GUESTS }

const SIDES = [
  { key: 'bride', label: "Bride's side" },
  { key: 'groom', label: "Groom's side" },
]

let seq = 0
const newId = () => `g-${Date.now().toString(36)}-${++seq}-${Math.random().toString(36).slice(2, 5)}`

const csvCell = (v) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// One CSV, rows sorted by side then table then name.  Columns:
// Side, Name, Relation, Table, Seat
function guestsToCsv(guests, seatedNames) {
  const rows = guests
    .map((g) => {
      const at = seatedNames?.get(g.name)
      return {
        side: g.side === 'bride' ? "Bride's side" : "Groom's side",
        name: g.name,
        relation: g.relation || '',
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
  const header = ['Side', 'Name', 'Relation', 'Table', 'Seat']
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push([r.side, r.name, r.relation, r.table, r.seat].map(csvCell).join(','))
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
    rows.push({ id: newId(), name, side, relation, rsvp })
  }
  return rows
}

// Append `incoming`, keeping every guest name unique (seats reference names).
export function mergeGuests(existing, incoming) {
  const taken = new Set(existing.map((g) => g.name.toLowerCase()))
  const added = incoming.map((g) => {
    let name = g.name
    if (taken.has(name.toLowerCase())) {
      const base = g.relation ? `${g.name} (${g.relation})` : g.name
      name = base
      let n = 2
      while (taken.has(name.toLowerCase())) name = `${base} ${n++}`
    }
    taken.add(name.toLowerCase())
    return { ...g, name }
  })
  return [...existing, ...added]
}

export function GuestManager({ guests, onChange, seatedNames, tables = [], onSeatGuest }) {
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

  const update = (id, patch) => onChange(guests.map((g) => (g.id === id ? { ...g, ...patch } : g)))
  const remove = (id) => onChange(guests.filter((g) => g.id !== id))

  const renderRow = (g) => {
    const seatedAt = seatedNames?.get(g.name)
    return (
      <li key={g.id} className="guestmgr-row">
        <input
          className="g-name"
          value={g.name}
          placeholder="name"
          onChange={(e) => update(g.id, { name: e.target.value })}
        />
        <input
          className="g-rel"
          value={g.relation}
          placeholder="relation"
          onChange={(e) => update(g.id, { relation: e.target.value })}
        />
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
        <button className="g-del" onClick={() => remove(g.id)} title="remove">
          ×
        </button>
      </li>
    )
  }
  const add = (side) => {
    setCollapsed((c) => ({ ...c, [side]: false, [`${side}::(no relation)`]: false }))
    onChange([...guests, { id: newId(), name: '', side, relation: '', rsvp: 'yes' }])
  }

  const doPaste = () => {
    const rows = parseGuestPaste(pasteText, pasteSide)
    if (rows.length) onChange(mergeGuests(guests, rows))
    setPasteText('')
    setPasteSide(null)
  }

  // one-click import of a built-in list — skips names already present
  const have = new Set(guests.map((g) => g.name.toLowerCase()))
  const newFromBuiltin = (side) => BUILTIN[side].filter((g) => !have.has(g.name.toLowerCase()))
  const loadBuiltin = (side) =>
    onChange([...guests, ...newFromBuiltin(side).map((g) => ({ id: newId(), ...g }))])

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

      {SIDES.map(({ key, label }) => {
        const n = newFromBuiltin(key).length
        return n > 0 ? (
          <button key={key} className="guestmgr-load" onClick={() => loadBuiltin(key)}>
            + Load {label} list ({n} new)
          </button>
        ) : null
      })}

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
