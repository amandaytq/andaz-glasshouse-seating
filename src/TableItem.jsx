import { memo } from 'react'
import { rectSeatPositions, roundSeatPositions } from './seatGeometry.js'

// Renders one layout item in FEET units, centred on (0,0). The parent <g> in
// FloorPlan applies translate + scale(PT_PER_FOOT) + rotate, so everything here
// is authored at real-world scale (1 unit = 1 ft).
function TableItemBase({
  item,
  selected,
  movable,
  showSeats,
  showNames,
  sideByName,
  roleByName,
  onPointerDown,
  onSeatPointerDown,
}) {
  const { kind, shape, rotation, lengthFt, widthFt, diameterFt, pax, name, color, active } = item
  const isTable = kind === 'table'
  const ghost = isTable && active === false
  const seatNames = Array.isArray(item.seatNames) ? item.seatNames : []
  const babySeats = new Set(Array.isArray(item.babySeats) ? item.babySeats : [])
  const rot = rotation || 0

  const stroke = selected ? '#1f6feb' : ghost ? '#8a9a8f' : '#3a4654'
  const strokeWidth = selected ? 0.12 : 0.06
  const fillOpacity = ghost ? 0.28 : kind === 'zone' ? 0.5 : 0.96

  const seats =
    isTable && pax > 0
      ? shape === 'round'
        ? roundSeatPositions(diameterFt, pax)
        : rectSeatPositions(lengthFt, widthFt, pax)
      : []

  return (
    <g
      className={`item item-${kind}${selected ? ' is-selected' : ''}`}
      onPointerDown={(e) => onPointerDown(e, item)}
      style={{ cursor: movable ? 'grab' : 'pointer' }}
    >
      {showSeats &&
        seats.map((s, i) => {
          const nm = seatNames[i]
          const baby = babySeats.has(i)
          const side = nm && sideByName?.get(nm)
          const role = nm && roleByName?.get(nm) // 'bride' | 'groom' | undefined
          const emoji = role === 'bride' ? '👑' : role === 'groom' ? '🤵' : null
          const r = baby ? 0.5 : 0.8
          return (
            <g
              key={i}
              style={{ cursor: 'pointer' }}
              onPointerDown={(e) => onSeatPointerDown?.(e, item.id, i)}
            >
              <circle
                className={`seat${nm ? ' seat-filled' : ''}${side ? ` seat-${side}` : ''}${
                  baby ? ' seat-baby' : ''
                }${role ? ' seat-couple' : ''}${
                  shape === 'rect'
                    ? i < Math.ceil(pax / 2)
                      ? ' seat-toprow'
                      : ' seat-botrow'
                    : ''
                }`}
                cx={s.x}
                cy={s.y}
                r={r}
              />
              <text
                className={`seat-num${emoji ? ' seat-emoji' : ''}`}
                x={s.x}
                y={s.y}
                transform={`rotate(${-rot} ${s.x} ${s.y})`}
                textAnchor="middle"
                dominantBaseline="central"
                style={{ fontSize: emoji ? 1 : 0.82 }}
              >
                {emoji || i + 1}
              </text>
            </g>
          )
        })}

      {shape === 'round' ? (
        <circle
          r={diameterFt / 2}
          fill={color}
          fillOpacity={fillOpacity}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeDasharray={ghost ? '0.4 0.3' : undefined}
        />
      ) : (
        <rect
          x={-lengthFt / 2}
          y={-widthFt / 2}
          width={lengthFt}
          height={widthFt}
          rx={kind === 'zone' ? 0 : 0.3}
          fill={color}
          fillOpacity={fillOpacity}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeDasharray={ghost ? '0.4 0.3' : kind === 'zone' ? '0.8 0.5' : undefined}
        />
      )}

      {selected && shape === 'rect' && (
        <rect
          x={-lengthFt / 2 - 0.4}
          y={-widthFt / 2 - 0.4}
          width={lengthFt + 0.8}
          height={widthFt + 0.8}
          fill="none"
          stroke="#1f6feb"
          strokeWidth={0.06}
          strokeDasharray="0.5 0.35"
        />
      )}

      {/* guest name labels — staggered out/in so neighbours don't overlap;
          a leader line ties each name back to its seat */}
      {showNames &&
        seats.map((s, i) =>
          seatNames[i] ? (
            <g key={`n${i}`}>
              <line
                className="seat-name-leader"
                x1={s.x}
                y1={s.y}
                x2={s.nx}
                y2={s.ny}
              />
              <text
                className="seat-name"
                x={s.nx}
                y={s.ny}
                transform={`rotate(${-rot} ${s.nx} ${s.ny})`}
                textAnchor={s.anchor}
                dominantBaseline="middle"
                style={{ fontSize: 0.95 }}
              >
                {seatNames[i]}
              </text>
            </g>
          ) : null,
        )}

      {/* label */}
      {kind === 'furniture' ? (
        <FurnitureLabel
          name={name}
          rot={rot}
          labelAngle={item.labelAngle || 0}
          boxLen={lengthFt}
          boxWid={widthFt}
        />
      ) : isTable ? (
        <g transform={`rotate(${-rot})`}>
          <text
            className="item-label"
            textAnchor="middle"
            dominantBaseline="middle"
            y={-0.4}
            style={{ fontSize: shape === 'round' ? 0.95 : 1.1 }}
          >
            {`${name} - ${pax} pax ${active === false ? '(optional)' : ''}`}
          </text>
          <text
            className="item-label-len"
            textAnchor="middle"
            dominantBaseline="middle"
            y={0.8}
            style={{ fontSize: shape === 'round' ? 0.7 : 0.8 }}
          >
            ({shape === 'round' ? `${round1(diameterFt)} ft dia` : `${round1(lengthFt)} ft`})
          </text>
        </g>
      ) : (
        <g transform={`rotate(${-rot})`}>
          <text
            className="item-label"
            textAnchor="middle"
            dominantBaseline="middle"
            y={0}
            style={{ fontSize: 1.1 }}
          >
            {name}
          </text>
        </g>
      )}
    </g>
  )
}

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10

// Wrap `text` into lines that fit `maxWidthFt` at the given font size (feet units).
function wrapText(text, maxWidthFt, fontSize) {
  const charW = fontSize * 0.55
  const maxChars = Math.max(6, Math.floor(maxWidthFt / charW))
  const lines = []
  let cur = ''
  for (const w of text.split(/\s+/)) {
    const trial = cur ? `${cur} ${w}` : w
    if (trial.length > maxChars && cur) {
      lines.push(cur)
      cur = w
    } else {
      cur = trial
    }
  }
  if (cur) lines.push(cur)
  return lines
}

// Furniture label: wrapped to fit the box, optionally rotated (labelAngle).
function FurnitureLabel({ name, rot, labelAngle, boxLen, boxWid }) {
  const a = (((labelAngle || 0) % 360) + 360) % 360
  const vertical = a === 90 || a === 270
  const along = vertical ? boxWid : boxLen // text runs along this dimension
  const across = vertical ? boxLen : boxWid // lines stack across this one
  const fontSize = Math.min(1.2, Math.max(0.65, across / 6))
  const lines = wrapText(name, Math.max(4, along - 2), fontSize)
  const lh = fontSize * 1.25
  const y0 = -((lines.length - 1) * lh) / 2

  return (
    <g transform={`rotate(${labelAngle - rot})`}>
      {lines.map((ln, i) => (
        <text
          key={i}
          className="item-label"
          textAnchor="middle"
          dominantBaseline="middle"
          x={0}
          y={y0 + i * lh}
          style={{ fontSize }}
        >
          {ln}
        </text>
      ))}
    </g>
  )
}

export const TableItem = memo(TableItemBase)
