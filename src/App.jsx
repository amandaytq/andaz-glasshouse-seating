import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLayout } from './useLayout.js'
import { FloorPlan } from './FloorPlan.jsx'
import { Inspector } from './Inspector.jsx'
import { DEFAULT_TABLE_HEIGHT_FT, DEFAULT_ROUND_DIAMETER_FT } from './defaultLayout.js'

export default function App() {
  const {
    layout,
    loading,
    saveState,
    setLayoutName,
    updateItem,
    addItem,
    removeItem,
    duplicateItem,
    resetLayout,
    replaceLayout,
    setLayoutView,
    setGuestList,
    assignSeat,
    seatGuestAtTable,
    reorderSeats,
    swapTableSeats,
    fillTableByRelations,
    undo,
    redo,
    beginTransient,
  } = useLayout()

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

  const selected = layout?.items.find((it) => it.id === selectedId) || null

  const guests = layout?.guests ?? []

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

  // name -> { table, seat, label }  (first seat that guest is assigned to)
  const seatedIndex = useMemo(() => {
    const m = new Map()
    for (const it of layout?.items ?? []) {
      if (it.kind !== 'table' || !Array.isArray(it.seatNames)) continue
      const pax = Math.max(0, Math.round(Number(it.pax) || 0))
      it.seatNames.slice(0, pax).forEach((n, i) => {
        if (n && !m.has(n)) {
          m.set(n, {
            tableId: it.id,
            table: it.name,
            seat: i + 1,
            label: `${it.name} · seat ${i + 1}`,
          })
        }
      })
    }
    return m
  }, [layout])

  const stats = useMemo(() => {
    const tables = (layout?.items ?? []).filter((it) => it.kind === 'table')
    const activeTables = tables.filter((t) => t.active !== false)
    const seated = activeTables.filter((t) => t.seating !== false)
    const totalPax = seated.reduce((s, t) => s + (Number(t.pax) || 0), 0)
    const assignedPax = seated.reduce((s, t) => {
      const pax = Math.max(0, Math.round(Number(t.pax) || 0))
      const named = Array.isArray(t.seatNames)
        ? t.seatNames.filter((n) => n && String(n).trim()).length
        : 0
      return s + Math.min(named, pax)
    }, 0)
    return {
      totalPax,
      assignedPax,
      unassignedPax: Math.max(0, totalPax - assignedPax),
      activeCount: activeTables.length,
      optionalCount: tables.length - activeTables.length,
      optionalPax: tables
        .filter((t) => t.active === false)
        .reduce((s, t) => s + (Number(t.pax) || 0), 0),
    }
  }, [layout])

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
    const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(layout.name || 'glasshouse-layout').replace(/[^\w-]+/g, '_')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [layout])

  const handleImport = useCallback(
    (e) => {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        try {
          replaceLayout(JSON.parse(String(reader.result)))
          setSelectedId(null)
        } catch (err) {
          alert('Could not read that file: ' + err.message)
        }
      }
      reader.readAsText(file)
      e.target.value = ''
    },
    [replaceLayout],
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
          <strong>The Glasshouse</strong>
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
            <span className="counter-label">total pax</span>
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
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            hidden
            onChange={handleImport}
          />
          <button
            className="danger"
            onClick={() => {
              if (confirm('Reset to the original blueprint layout? This clears your changes.')) {
                resetLayout()
                setSelectedId(null)
              }
            }}
          >
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
          layout={layout}
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
          onGuestsChange={setGuestList}
          seatedIndex={seatedIndex}
          onAssignSeat={assignSeat}
          onReorderSeat={reorderSeats}
          onSeatGuest={seatGuestAtTable}
          tables={layout.items.filter((it) => it.kind === 'table').map((it) => ({ id: it.id, name: it.name }))}
          onSwapSeats={swapTableSeats}
          onFillByRelation={fillTableByRelations}
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
