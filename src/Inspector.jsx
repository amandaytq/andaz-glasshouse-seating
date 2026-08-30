import { useEffect, useMemo, useRef } from 'react'
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
}) {
  const seatRefs = useRef([])

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
        <GuestManager guests={guests} onChange={onGuestsChange} seatedNames={seatedIndex} />
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

  // Rect tables seat top row first (ceil(pax/2)), then the bottom row — matches
  // the seat numbering on the plan.
  const topRowCount = Math.ceil(seatCount / 2)

  const seatRange = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k)
  const knownNames = new Set(guests.map((g) => g.name))

  const babySeats = new Set(Array.isArray(item.babySeats) ? item.babySeats : [])
  const toggleBaby = (i) => {
    const next = new Set(babySeats)
    next.has(i) ? next.delete(i) : next.add(i)
    set({ babySeats: [...next].sort((a, b) => a - b) })
  }

  const renderSeatRow = (i) => {
    const val = seatNames[i] || ''
    const groups =
      val && !knownNames.has(val)
        ? [{ label: 'On this seat', options: [{ value: val, label: `${val} (not in list)` }] }, ...comboGroups]
        : comboGroups
    return (
      <div key={i} className="guest-row">
        <span className="guest-num">{i + 1}</span>
        <Combobox
          inputRef={(el) => (seatRefs.current[i] = el)}
          value={val}
          groups={groups}
          placeholder="Search guest…"
          onChange={(name) => onAssignSeat(item.id, i, name)}
        />
        <label className="baby-check" title="Baby seat">
          <input
            type="checkbox"
            checked={babySeats.has(i)}
            onChange={() => toggleBaby(i)}
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

      {isTable && seatCount > 0 && (
        <>
          <hr />
          <div className="guests">
            <div className="guests-head">
              <span>Guests ({seatNames.filter(Boolean).length}/{seatCount} seated)</span>
              {seatNames.some(Boolean) && (
                <button className="mini" onClick={() => set({ seatNames: [] })}>
                  clear
                </button>
              )}
            </div>
            {isRect ? (
              <>
                <div className="guests-sub">Top row</div>
                {seatRange(0, topRowCount).map(renderSeatRow)}
                {topRowCount < seatCount && (
                  <>
                    <div className="guests-sub">Bottom row</div>
                    {seatRange(topRowCount, seatCount).map(renderSeatRow)}
                  </>
                )}
              </>
            ) : (
              seatRange(0, seatCount).map(renderSeatRow)
            )}
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
