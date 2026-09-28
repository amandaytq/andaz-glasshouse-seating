import { useEffect, useMemo, useRef, useState } from 'react'

// Lightweight searchable single-select. `groups` = [{ label, options: [{ value,
// label, hint }] }]. Calls onChange(value) — '' means cleared.
export function Combobox({
  value,
  groups,
  onChange,
  placeholder = 'Search…',
  emptyLabel = '— empty —',
  inputRef,
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const [menuPos, setMenuPos] = useState(null)
  const rootRef = useRef(null)
  const localRef = useRef(null)
  const inputEl = useRef(null)
  const setRef = (el) => {
    inputEl.current = el
    if (typeof inputRef === 'function') inputRef(el)
    else if (inputRef) inputRef.current = el
    else localRef.current = el
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const out = []
    for (const g of groups) {
      const options = g.options.filter(
        (o) =>
          !needle ||
          o.label.toLowerCase().includes(needle) ||
          (o.hint || '').toLowerCase().includes(needle),
      )
      if (options.length) out.push({ label: g.label, options })
    }
    return out
  }, [groups, q])

  const flatOptions = useMemo(() => filtered.flatMap((g) => g.options), [filtered])

  useEffect(() => {
    if (!open) {
      setMenuPos(null)
      setQ('')
      return
    }
    const place = () => {
      const r = inputEl.current?.getBoundingClientRect()
      if (r) setMenuPos({ top: r.bottom + 2, left: r.left, width: r.width })
    }
    place()
    const onDoc = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false)
    }
    const onScroll = (e) => {
      // keep open while scrolling the menu itself; close on outside scroll
      if (rootRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  useEffect(() => setHi(0), [q, open])

  const pick = (v) => {
    onChange(v)
    setOpen(false)
    setQ('')
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHi((h) => Math.min(h + 1, flatOptions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const o = flatOptions[hi]
      if (o) pick(o.value)
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQ('')
    }
  }

  return (
    <div className={`cbx${open ? ' is-open' : ''}`} ref={rootRef}>
      <input
        ref={setRef}
        className="cbx-input"
        value={open ? q : value || ''}
        placeholder={value || placeholder}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {value && !open && (
        <button
          className="cbx-clear"
          tabIndex={-1}
          title="clear"
          onMouseDown={(e) => {
            e.preventDefault()
            onChange('')
          }}
        >
          ×
        </button>
      )}
      {open && menuPos && (
        <div
          className="cbx-menu"
          style={{
            position: 'fixed',
            top: menuPos.top,
            left: menuPos.left,
            width: menuPos.width,
          }}
        >
          <button
            className="cbx-opt cbx-empty"
            onMouseDown={(e) => {
              e.preventDefault()
              pick('')
            }}
          >
            {emptyLabel}
          </button>
          {filtered.length === 0 && <div className="cbx-none">no match</div>}
          {filtered.map((g) => (
            <div key={g.label} className="cbx-group">
              <div className="cbx-group-label">{g.label}</div>
              {g.options.map((o) => {
                const idx = flatOptions.indexOf(o)
                return (
                  <button
                    key={o.value}
                    className={`cbx-opt${idx === hi ? ' is-hi' : ''}${
                      o.value === value ? ' is-current' : ''
                    }`}
                    onMouseEnter={() => setHi(idx)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      pick(o.value)
                    }}
                  >
                    <span className="cbx-opt-label">{o.label}</span>
                    {o.hint && <span className="cbx-opt-hint">{o.hint}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
