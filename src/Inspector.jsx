import { useEffect, useMemo, useRef, useState } from 'react'
import { lengthFromPax } from './defaultLayout.js'
import { GuestManager } from './GuestManager.jsx'
import { Combobox } from './Combobox.jsx'

// Right-hand panel for editing the selected item.
export function Inspector({
  item,
  onChange,
  onDuplicate,
  onRemove,
  seatFocus,
  locked,
  guests = [],
  onGuestsChange,
  seatedIndex,
  onAssignSeat,
  onReorderSeat,
  onSeatGuest,
  tables = [],
  onSwapSeats,
  onFillByRelation,
}) {
  const seatRefs = useRef([])
  const [swapTarget, setSwapTarget] = useState('')
  const [dragIdx, setDragIdx] = useState(null) // seat index being dragged
  const [order, setOrder] = useState(null) // live visual order during a drag

  // when a seat is clicked on the plan, focus its control here
  useEffect(() => {
    if (!seatFocus || seatFocus.id !== item?.id) return
    const el = seatRefs.current[seatFocus.index]
    if (el) {
      el.focus()
      el.select?.()
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [seatFocus, item?.id])

  const guestsBySide = useMemo(
    () => ({
      bride: guests.filter((g) => g.side === 'bride'),
      groom: guests.filter((g) => g.side === 'groom'),
    }),
    [guests],
  )

  // distinct relations per side + how many guests each has on that side
  const relBySide = useMemo(() => {
    const bride = {}
    const groom = {}
    for (const g of guests) {
      if (!g.relation) continue
      const bucket = g.side === 'bride' ? bride : groom
      bucket[g.relation] = (bucket[g.relation] || 0) + 1
    }
    return { bride, groom }
  }, [guests])

  // a table's relation tag is stored as "bride::Relative" / "groom::IBM"
  // (bare "Relative" from older data = either side)
  const parseRel = (entry) => {
    const i = entry.indexOf('::')
    return i >= 0
      ? { side: entry.slice(0, i), relation: entry.slice(i + 2) }
      : { side: null, relation: entry }
  }
  const relCount = (entry) => {
    const { side, relation } = parseRel(entry)
    if (side) return relBySide[side]?.[relation] || 0
    return (relBySide.bride[relation] || 0) + (relBySide.groom[relation] || 0)
  }
  const relLabel = (entry) => parseRel(entry).relation

  // Combobox option groups for seat assignment.
  const comboGroups = useMemo(() => {
    const toOpt = (g) => {
      const at = seatedIndex?.get(g.name)
      return {
        value: g.name,
        label: g.name + (g.relation ? ` — ${g.relation}` : ''),
        hint: at?.label || '',
      }
    }
    return [
      { label: "Bride's side", options: guestsBySide.bride.map(toOpt) },
      { label: "Groom's side", options: guestsBySide.groom.map(toOpt) },
    ].filter((grp) => grp.options.length)
  }, [guestsBySide, seatedIndex])

  if (!item) {
    return (
      <aside className="inspector">
        <p className="inspector-empty">
          Select a table to edit it, or click a seat to assign a guest.
        </p>
        <GuestManager
          guests={guests}
          onChange={onGuestsChange}
          seatedNames={seatedIndex}
          tables={tables}
          onSeatGuest={onSeatGuest}
        />
      </aside>
    )
  }

  const set = (patch) => onChange(item.id, patch)
  const num = (v) => (v === '' ? 0 : Number(v))
  const isTable = item.kind === 'table'
  const isRect = item.shape === 'rect'
  // every rectangular table is sized from its pax count (1 ft / pax); not editable
  const paxDriven = isTable && isRect
  const seatNames = Array.isArray(item.seatNames) ? item.seatNames : []
  const seatCount = isTable ? Math.max(0, Math.round(Number(item.pax) || 0)) : 0

  // Seats alternate top/bottom: even index -> top row, odd -> bottom row.
  const seatRange = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k)
  const knownNames = new Set(guests.map((g) => g.name))

  const babySeats = new Set(Array.isArray(item.babySeats) ? item.babySeats : [])
  const toggleBaby = (i) => {
    const next = new Set(babySeats)
    next.has(i) ? next.delete(i) : next.add(i)
    set({ babySeats: [...next].sort((a, b) => a - b) })
  }

  // ---- live seat reordering (drag rows in the list) --------------------
  const defaultOrder = seatRange(0, seatCount)
  const displayOrder = order && order.length === seatCount ? order : defaultOrder

  const startSeatDrag = (seatIdx) => {
    setDragIdx(seatIdx)
    setOrder(seatRange(0, seatCount))
  }
  const dragSeatToPos = (pos) => {
    if (dragIdx == null) return
    setOrder((cur) => {
      const base = cur && cur.length === seatCount ? cur : seatRange(0, seatCount)
      const curPos = base.indexOf(dragIdx)
      if (curPos < 0 || curPos === pos) return base
      const arr = base.slice()
      arr.splice(curPos, 1)
      arr.splice(pos, 0, dragIdx)
      return arr
    })
  }
  const endSeatDrag = () => {
    if (dragIdx != null && order) {
      const to = order.indexOf(dragIdx)
      if (to >= 0 && to !== dragIdx) onReorderSeat?.(item.id, dragIdx, to)
    }
    setDragIdx(null)
    setOrder(null)
  }

  const renderSeatRow = (seatIdx, pos) => {
    const val = seatNames[seatIdx] || ''
    const isTop = pos % 2 === 0 // even position -> top row, odd -> bottom
    const groups =
      val && !knownNames.has(val)
        ? [{ label: 'On this seat', options: [{ value: val, label: `${val} (not in list)` }] }, ...comboGroups]
        : comboGroups
    return (
      <div
        key={seatIdx}
        className={`guest-row${isRect ? (isTop ? ' row-top' : ' row-bot') : ''}${
          dragIdx === seatIdx ? ' is-dragging' : ''
        }`}
        onDragOver={(e) => {
          if (dragIdx == null) return
          e.preventDefault()
          dragSeatToPos(pos)
        }}
        onDrop={(e) => {
          e.preventDefault()
          endSeatDrag()
        }}
      >
        <span
          className="seat-move"
          title="Drag to move this seat"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move'
            startSeatDrag(seatIdx)
          }}
          onDragEnd={endSeatDrag}
        >
          ⠿
        </span>
        {isRect && (
          <span className={`row-tag ${isTop ? 'is-top' : 'is-bot'}`} title={isTop ? 'Top row' : 'Bottom row'}>
            {isTop ? 'T' : 'B'}
          </span>
        )}
        <span className="guest-num">{pos + 1}</span>
        <Combobox
          inputRef={(el) => (seatRefs.current[seatIdx] = el)}
          value={val}
          groups={groups}
          placeholder="Search guest…"
          onChange={(name) => onAssignSeat(item.id, seatIdx, name)}
        />
        <label className="baby-check" title="Baby seat">
          <input
            type="checkbox"
            checked={babySeats.has(seatIdx)}
            onChange={() => toggleBaby(seatIdx)}
          />
          👶
        </label>
      </div>
    )
  }

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <input
          className="field-name"
          value={item.name}
          onChange={(e) => set({ name: e.target.value })}
        />
        <span className={`badge badge-${item.kind}`}>{item.kind}</span>
      </div>

      <div className="field-row">
        <label>
          Shape
          <select value={item.shape} onChange={(e) => set({ shape: e.target.value })}>
            <option value="rect">Rectangular</option>
            <option value="round">Round</option>
          </select>
        </label>
        <label>
          Rotation°
          <input
            type="number"
            step="15"
            value={item.rotation || 0}
            onChange={(e) => set({ rotation: num(e.target.value) })}
          />
        </label>
        {item.kind === 'furniture' && (
          <label>
            Label°
            <input
              type="number"
              step="90"
              value={item.labelAngle || 0}
              onChange={(e) => set({ labelAngle: num(e.target.value) })}
            />
          </label>
        )}
      </div>

      <div className="field-row">
        <button className="mini" onClick={() => set({ rotation: 0 })}>
          0°
        </button>
        <button className="mini" onClick={() => set({ rotation: 90 })}>
          90°
        </button>
        <button
          className="mini"
          onClick={() => set({ rotation: ((item.rotation || 0) + 45) % 360 })}
        >
          +45°
        </button>
      </div>

      {isRect ? (
        <div className="field-row">
          <label>
            Length (ft)
            <input
              type="number"
              min="1"
              step="1"
              value={item.lengthFt}
              disabled={paxDriven}
              title={paxDriven ? 'Auto-sized from pax (1 ft per person) — edit Pax below' : undefined}
              onChange={(e) => set({ lengthFt: num(e.target.value) })}
            />
          </label>
          <label>
            {isTable ? 'Height (ft)' : 'Depth (ft)'}
            <input
              type="number"
              min="1"
              step="0.5"
              value={item.widthFt}
              disabled={isTable}
              title={isTable ? 'Fixed — the same for every table' : undefined}
              onChange={(e) => set({ widthFt: num(e.target.value) })}
            />
          </label>
        </div>
      ) : (
        <div className="field-row">
          <label>
            Diameter (ft)
            <input
              type="number"
              min="1"
              step="0.5"
              value={item.diameterFt}
              onChange={(e) => set({ diameterFt: num(e.target.value) })}
            />
          </label>
        </div>
      )}

      <div className="field-row">
        <label>
          X (ft)
          <input
            type="number"
            step="0.5"
            value={item.x}
            disabled={locked}
            title={locked ? 'Unlock placement to move tables' : undefined}
            onChange={(e) => set({ x: num(e.target.value) })}
          />
        </label>
        <label>
          Y (ft)
          <input
            type="number"
            step="0.5"
            value={item.y}
            disabled={locked}
            title={locked ? 'Unlock placement to move tables' : undefined}
            onChange={(e) => set({ y: num(e.target.value) })}
          />
        </label>
      </div>
      {locked && <p className="lock-note">🔒 Placement locked — positions can’t be changed.</p>}

      {isTable && (
        <>
          <hr />
          <div className="field-row">
            <label>
              Pax
              <input
                type="number"
                min="0"
                step="1"
                value={item.pax}
                onChange={(e) => set({ pax: num(e.target.value) })}
              />
              {paxDriven && (
                <span className="field-hint">
                  length auto-sizes to {lengthFromPax(item.pax)} ft (1 ft / pax)
                </span>
              )}
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={item.seating !== false}
                onChange={(e) => set({ seating: e.target.checked })}
              />
              Count in total
            </label>
          </div>
          <div className="field-row">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={item.active !== false}
                onChange={(e) => set({ active: e.target.checked })}
              />
              Active (unchecked = optional / not placed)
            </label>
          </div>
        </>
      )}

      {isTable && (
        <>
          <hr />
          <div className="field-row">
            <label>
              Swap all seats with
              <span className="swap-row">
                <select value={swapTarget} onChange={(e) => setSwapTarget(e.target.value)}>
                  <option value="">another table…</option>
                  {tables
                    .filter((t) => t.id !== item.id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
                <button
                  className="mini"
                  disabled={!swapTarget}
                  onClick={() => {
                    onSwapSeats?.(item.id, swapTarget)
                    setSwapTarget('')
                  }}
                >
                  Swap
                </button>
              </span>
            </label>
          </div>

          <div className="rel-fill">
            <div className="guests-sub">Fill seats by relation</div>
            <Combobox
              value=""
              placeholder="Add a relation / group…"
              groups={[
                {
                  label: "Bride's side",
                  options: Object.keys(relBySide.bride)
                    .sort((a, b) => a.localeCompare(b))
                    .map((r) => `bride::${r}`)
                    .filter((v) => !(item.relations || []).includes(v))
                    .map((v) => ({ value: v, label: parseRel(v).relation, hint: `${relCount(v)}` })),
                },
                {
                  label: "Groom's side",
                  options: Object.keys(relBySide.groom)
                    .sort((a, b) => a.localeCompare(b))
                    .map((r) => `groom::${r}`)
                    .filter((v) => !(item.relations || []).includes(v))
                    .map((v) => ({ value: v, label: parseRel(v).relation, hint: `${relCount(v)}` })),
                },
              ].filter((grp) => grp.options.length)}
              onChange={(r) =>
                r && onFillByRelation?.(item.id, [...(item.relations || []), r])
              }
            />
            {(item.relations || []).length > 0 && (
              <div className="rel-chips">
                {(item.relations || []).map((entry) => {
                  const { side } = parseRel(entry)
                  return (
                    <span key={entry} className={`rel-chip rel-${side || 'any'}`}>
                      {side === 'bride' ? '♀ ' : side === 'groom' ? '♂ ' : ''}
                      {relLabel(entry)} ({relCount(entry)})
                      <button
                        title="remove tag (keeps seated guests)"
                        onClick={() =>
                          onFillByRelation?.(
                            item.id,
                            (item.relations || []).filter((x) => x !== entry),
                          )
                        }
                      >
                        ×
                      </button>
                    </span>
                  )
                })}
                <button
                  className="mini"
                  onClick={() => onFillByRelation?.(item.id, item.relations || [])}
                >
                  re-fill free seats
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {isTable && seatCount > 0 && (
        <>
          <hr />
          <div className="guests">
            <div className="guests-head">
              <span>
                Guests ({seatNames.filter(Boolean).length}/{seatCount} seated)
                {isRect && <span className="field-hint"> · odd = top row, even = bottom</span>}
              </span>
              {seatNames.some(Boolean) && (
                <button className="mini" onClick={() => set({ seatNames: [] })}>
                  clear
                </button>
              )}
            </div>
            <div
              className="guests-seats"
              onDragOver={(e) => dragIdx != null && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                endSeatDrag()
              }}
            >
              {displayOrder.map((seatIdx, pos) => renderSeatRow(seatIdx, pos))}
            </div>
          </div>
        </>
      )}

      <hr />
      <div className="field-row">
        <label>
          Colour
          <input
            type="color"
            value={item.color || '#cccccc'}
            onChange={(e) => set({ color: e.target.value })}
          />
        </label>
      </div>

      <div className="inspector-actions">
        <button onClick={() => onDuplicate(item.id)}>Duplicate</button>
        <button className="danger" onClick={() => onRemove(item.id)}>
          Delete
        </button>
      </div>
    </aside>
  )
}
