import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLayout } from '../hooks/use-layout.js'
import { useGuests } from '../hooks/use-guests.js'
import { FloorPlan } from '../views/floor-plan.jsx'
import { Inspector } from '../views/inspector.jsx'
import { seatingToCsv, downloadCsv } from '../views/guest-manager.jsx'
import { DEFAULT_TABLE_HEIGHT_FT, DEFAULT_ROUND_DIAMETER_FT } from '../default-layout.js'

export function SeatingPlannerPage({ onHome }) {
  const {
    layout,
    loading: layoutLoading,
    saveState: layoutSaveState,
    setLayoutName,
    updateItem,
    addItem,
    removeItem,
    duplicateItem,
    resetLayout,
    replaceLayout,
    setLayoutView,
    reorderBabySeats,
    swapBabySeats,
    setTableRelations,
    undo,
    redo,
    beginTransient,
  } = useLayout()

  const {
    guests,
    loading: guestsLoading,
    saveState: guestsSaveState,
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
  } = useGuests()

  const loading = layoutLoading || guestsLoading
  // Two independent stores (tables autosave to /api/layout, guests autosave
  // per-row to /api/guests) — show the more "urgent" of the two states.
  const saveState =
    layoutSaveState === 'offline' || guestsSaveState === 'offline'
      ? 'offline'
      : layoutSaveState === 'saving' || guestsSaveState === 'saving'
        ? 'saving'
        : 'saved'

  const [selectedId, setSelectedId] = useState(null)
  const [seatFocus, setSeatFocus] = useState(null) // { id, index } from a seat click
  // Placement lock — ON by default so tables can't be dragged by accident.
  const [locked, setLocked] = useState(() => {
    try {
      return localStorage.getItem('glasshouse-lock') !== 'off'
    } catch {
      return true
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('glasshouse-lock', locked ? 'on' : 'off')
    } catch {
      /* ignore */
    }
  }, [locked])
  const [zoom, setZoom] = useState(1)
  const [showSeats, setShowSeats] = useState(true)
  const [showNames, setShowNames] = useState(true)
  const [underlayOpacity, setUnderlayOpacity] = useState(1)
  const [snap, setSnap] = useState(0.25)
  const fileInput = useRef(null)

  // Blueprint + grid toggles are shared (stored in the layout doc / S3).
  const showUnderlay = layout?.view?.showUnderlay ?? true
  const showGrid = layout?.view?.showGrid ?? false

  const selectItem = useCallback((id) => {
    setSelectedId(id)
    setSeatFocus(null)
  }, [])

  const handleSeatClick = useCallback((id, index) => {
    setSelectedId(id)
    setSeatFocus({ id, index, at: Date.now() })
  }, [])

  // Guests carry their own tableId/seatIndex now (see use-guests.js); tables no
  // longer own a seatNames array. Rebuild one per table here, purely for
  // rendering (FloorPlan / TableItem / Inspector), so that layer stays untouched.
  const seatNamesByTable = useMemo(() => {
    const m = new Map()
    for (const g of guests) {
      if (g.tableId == null || g.seatIndex == null || !g.name) continue
      if (!m.has(g.tableId)) m.set(g.tableId, [])
      m.get(g.tableId)[g.seatIndex] = g.name
    }
    return m
  }, [guests])

  const displayItems = useMemo(() => {
    return (layout?.items ?? []).map((it) => {
      if (it.kind !== 'table') return it
      const pax = Math.max(0, Math.round(Number(it.pax) || 0))
      const arr = seatNamesByTable.get(it.id) || []
      const seatNames = Array.from({ length: pax }, (_, i) => arr[i] || '')
      while (seatNames.length && !seatNames[seatNames.length - 1]) seatNames.pop()
      return { ...it, seatNames }
    })
  }, [layout, seatNamesByTable])

  const displayLayout = layout ? { ...layout, items: displayItems } : layout

  const exportTables = useMemo(
    () =>
      displayItems
        .filter((it) => it.kind === 'table')
        .map((it) => ({ id: it.id, name: it.name, pax: it.pax, seatNames: it.seatNames })),
    [displayItems],
  )

  const selected = displayItems.find((it) => it.id === selectedId) || null

  // name -> 'groom' | 'bride'  (for tinting seats on the plan)
  const sideByName = useMemo(() => {
    const m = new Map()
    for (const g of guests) if (g.name) m.set(g.name, g.side)
    return m
  }, [guests])

  // name -> 'bride' | 'groom'  for the couple only (special seat styling)
  const roleByName = useMemo(() => {
    const m = new Map()
    for (const g of guests) if (g.name && g.role) m.set(g.name, g.role)
    return m
  }, [guests])

  // name -> { tableId, table, seat, label }  (first seat that guest is assigned to)
  const seatedIndex = useMemo(() => {
    const m = new Map()
    const tableById = new Map(displayItems.map((it) => [it.id, it]))
    for (const g of guests) {
      if (!g.name || g.tableId == null || g.seatIndex == null || m.has(g.name)) continue
      const t = tableById.get(g.tableId)
      if (!t) continue
      m.set(g.name, {
        tableId: g.tableId,
        table: t.name,
        seat: g.seatIndex + 1,
        label: `${t.name} · seat ${g.seatIndex + 1}`,
      })
    }
    return m
  }, [guests, displayItems])

  // Guest-count-based, not table-capacity-based: a table's `pax` field is its
  // configured seat capacity, which can legitimately differ from how many
  // guests actually exist (extra/buffer seats, or a stale pax value) — what
  // actually matters for planning is how many real guests there are and how
  // many of them have a seat, both of which now live on the guest rows.
  const stats = useMemo(() => {
    const totalGuests = guests.length
    const seatedGuests = guests.filter((g) => g.tableId != null && g.seatIndex != null).length
    const tables = displayItems.filter((it) => it.kind === 'table')
    const activeTables = tables.filter((t) => t.active !== false)
    return {
      totalPax: totalGuests,
      assignedPax: seatedGuests,
      unassignedPax: Math.max(0, totalGuests - seatedGuests),
      activeCount: activeTables.length,
      optionalCount: tables.length - activeTables.length,
      optionalPax: tables
        .filter((t) => t.active === false)
        .reduce((s, t) => s + (Number(t.pax) || 0), 0),
    }
  }, [guests, displayItems])

  // keyboard: undo / redo / delete
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        removeItem(selectedId)
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, removeItem, selectedId])

  const handleAdd = useCallback(
    (shape) => {
      const base = {
        kind: 'table',
        shape,
        name: shape === 'round' ? 'New round table' : 'New table',
        x: 55,
        y: 45,
        rotation: 0,
        lengthFt: shape === 'round' ? 6 : 18,
        widthFt: DEFAULT_TABLE_HEIGHT_FT,
        diameterFt: DEFAULT_ROUND_DIAMETER_FT,
        pax: shape === 'round' ? 8 : 18,
        seating: true,
        active: true,
        color: shape === 'round' ? '#e7d7f2' : '#c9d8ef',
      }
      const id = addItem(base)
      setSelectedId(id)
    },
    [addItem],
  )

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify({ ...layout, guests }, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(layout.name || 'glasshouse-layout').replace(/[^\w-]+/g, '_')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [layout, guests])

  const handleImport = useCallback(
    (e) => {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result))
          replaceLayout(data)
          if (Array.isArray(data.guests)) replaceGuests(data.guests)
          setSelectedId(null)
        } catch (err) {
          alert('Could not read that file: ' + err.message)
        }
      }
      reader.readAsText(file)
      e.target.value = ''
    },
    [replaceLayout, replaceGuests],
  )

  const handleReset = useCallback(() => {
    if (!confirm('Reset to the original blueprint layout? This clears your changes.')) return
    resetLayout()
    resetGuests()
    setSelectedId(null)
  }, [resetLayout, resetGuests])

  const handleReorderSeat = useCallback(
    (tableId, from, to) => {
      const t = displayItems.find((it) => it.id === tableId)
      const pax = t ? Math.max(0, Math.round(Number(t.pax) || 0)) : 0
      reorderSeats(tableId, from, to, pax)
      reorderBabySeats(tableId, from, to)
    },
    [displayItems, reorderSeats, reorderBabySeats],
  )

  const handleSeatGuest = useCallback(
    (name, tableId) => {
      const t = tableId ? displayItems.find((it) => it.id === tableId) : null
      const pax = t ? Math.max(0, Math.round(Number(t.pax) || 0)) : 0
      seatGuestAtTable(name, tableId || null, pax)
    },
    [displayItems, seatGuestAtTable],
  )

  const handleSwapSeats = useCallback(
    (aId, bId) => {
      swapTableSeats(aId, bId)
      swapBabySeats(aId, bId)
    },
    [swapTableSeats, swapBabySeats],
  )

  const handleFillByRelation = useCallback(
    (tableId, relations) => {
      const t = displayItems.find((it) => it.id === tableId)
      const pax = t ? Math.max(0, Math.round(Number(t.pax) || 0)) : 0
      setTableRelations(tableId, relations)
      fillTableByRelations(tableId, relations, pax)
    },
    [displayItems, setTableRelations, fillTableByRelations],
  )

  if (loading || !layout) {
    return (
      <div className="app app-loading">
        <p>Loading the shared layout…</p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          {onHome && (
            <button className="mini home-link" onClick={onHome} title="Back to home">
              ← Home
            </button>
          )}
          <strong>Amanda &amp; Jeremiah</strong>
          <input
            className="layout-name"
            value={layout.name || ''}
            onChange={(e) => setLayoutName(e.target.value)}
          />
          <SaveStatus state={saveState} />
        </div>

        <div className="counters">
          <div className="counter">
            <span className="counter-num">{stats.totalPax}</span>
            <span className="counter-label">total guests</span>
          </div>
          <div className="counter">
            <span className="counter-num">{stats.assignedPax}</span>
            <span className="counter-label">assigned</span>
          </div>
          <div className={`counter${stats.unassignedPax > 0 ? ' counter-alert' : ''}`}>
            <span className="counter-num">{stats.unassignedPax}</span>
            <span className="counter-label">unassigned</span>
          </div>
          <div className="counter">
            <span className="counter-num">{stats.activeCount}</span>
            <span className="counter-label">tables</span>
          </div>
          {stats.optionalCount > 0 && (
            <div className="counter counter-muted">
              <span className="counter-num">+{stats.optionalPax}</span>
              <span className="counter-label">{stats.optionalCount} optional</span>
            </div>
          )}
        </div>

        <div className="toolbar">
          <button
            className={`lock-toggle ${locked ? 'is-locked' : 'is-unlocked'}`}
            onClick={() => setLocked((v) => !v)}
            title={
              locked
                ? 'Table placement is locked — click to allow moving tables'
                : 'Tables can be dragged — click to lock placement'
            }
          >
            {locked ? '🔒 Placement locked' : '🔓 Placement unlocked'}
          </button>
          <span className="sep" />
          <button onClick={() => handleAdd('rect')}>+ Rect table</button>
          <button onClick={() => handleAdd('round')}>+ Round table</button>
          <span className="sep" />
          <button onClick={undo} title="Cmd/Ctrl+Z">
            Undo
          </button>
          <button onClick={redo} title="Cmd/Ctrl+Shift+Z">
            Redo
          </button>
          <span className="sep" />
          <button onClick={handleExport}>Export</button>
          <button onClick={() => fileInput.current?.click()}>Import</button>
          <button
            disabled={!exportTables.length}
            onClick={() => downloadCsv(seatingToCsv(exportTables), 'glasshouse-seating-chart.csv')}
          >
            Export CSV
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            hidden
            onChange={handleImport}
          />
          <button className="danger" onClick={handleReset}>
            Reset
          </button>
        </div>
      </header>

      <div className="viewcontrols">
        <label>
          Zoom
          <input
            type="range"
            min="0.4"
            max="3"
            step="0.05"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
          <span className="field-hint">{Math.round(zoom * 100)}%</span>
        </label>
        <span className="sep" />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={showUnderlay}
            onChange={(e) => setLayoutView({ showUnderlay: e.target.checked })}
          />
          Blueprint
        </label>
        <label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={underlayOpacity}
            disabled={!showUnderlay}
            onChange={(e) => setUnderlayOpacity(Number(e.target.value))}
          />
          <span className="field-hint">{Math.round(underlayOpacity * 100)}%</span>
        </label>
        <span className="sep" />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(e) => setLayoutView({ showGrid: e.target.checked })}
          />
          5ft grid
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={showSeats} onChange={(e) => setShowSeats(e.target.checked)} />
          Seats
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />
          Names
        </label>
        <label>
          Snap
          <select value={snap} onChange={(e) => setSnap(Number(e.target.value))}>
            <option value={0}>Off</option>
            <option value={0.25}>0.25 ft</option>
            <option value={0.5}>0.5 ft</option>
            <option value={1}>1 ft</option>
            <option value={2}>2 ft</option>
          </select>
        </label>
        <span className="sep" />
        <button onClick={() => window.print()}>Print A4</button>
      </div>

      <main className="workspace">
        <FloorPlan
          layout={displayLayout}
          selectedId={selectedId}
          locked={locked}
          sideByName={sideByName}
          roleByName={roleByName}
          onSelect={selectItem}
          onSeatClick={handleSeatClick}
          onMoveItem={(id, patch) => updateItem(id, patch, { record: false })}
          onDragStart={beginTransient}
          zoom={zoom}
          showGrid={showGrid}
          showSeats={showSeats}
          showNames={showNames}
          showUnderlay={showUnderlay}
          underlayOpacity={underlayOpacity}
          snapFt={snap}
        />
        <Inspector
          item={selected}
          seatFocus={seatFocus}
          locked={locked}
          guests={guests}
          onUpdateGuest={patchGuest}
          onRemoveGuest={removeGuest}
          onAddGuest={addGuest}
          onBulkAdd={bulkAddGuests}
          seatedIndex={seatedIndex}
          onAssignSeat={assignSeat}
          onReorderSeat={handleReorderSeat}
          onSeatGuest={handleSeatGuest}
          onClearTable={clearTable}
          tables={exportTables}
          onSwapSeats={handleSwapSeats}
          onFillByRelation={handleFillByRelation}
          onChange={updateItem}
          onDuplicate={(id) => {
            const nid = duplicateItem(id)
            if (nid) setSelectedId(nid)
          }}
          onRemove={(id) => {
            removeItem(id)
            setSelectedId(null)
          }}
        />
      </main>
    </div>
  )
}

function SaveStatus({ state }) {
  const map = {
    saved: { text: 'All changes saved', cls: 'ok' },
    saving: { text: 'Saving…', cls: 'busy' },
    offline: { text: 'Offline — retrying', cls: 'warn' },
  }
  const s = map[state] || map.saved
  return <span className={`save-status save-${s.cls}`}>{s.text}</span>
}
