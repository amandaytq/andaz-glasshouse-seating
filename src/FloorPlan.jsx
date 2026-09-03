import { useCallback, useRef } from "react";
import {
  PAGE,
  PLAN_IMAGE,
  PT_PER_FOOT,
  SCALE_BAR,
  CANVAS_SCALE,
  feetToPt,
  ptToFeet,
  outlinePath,
} from "./venue.js";
import floorplanUrl from "./assets/floorplan.png";
import floorplanPlainUrl from "./assets/floorplan_plain.png";
import { TableItem } from "./TableItem.jsx";

// Map a pointer event to page-point coordinates using the live SVG CTM.
function clientToPt(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

const round2 = (n) => Math.round(n * 100) / 100;

export function FloorPlan({
  layout,
  selectedId,
  locked,
  sideByName,
  roleByName,
  onSelect,
  onMoveItem,
  onDragStart,
  zoom,
  showGrid,
  showSeats,
  showNames,
  onSeatClick,
  showUnderlay,
  underlayOpacity,
  snapFt,
}) {
  const svgRef = useRef(null);
  const drag = useRef(null);

  const handleSeatPointerDown = useCallback(
    (e, tableId, index) => {
      e.stopPropagation();
      onSeatClick?.(tableId, index);
    },
    [onSeatClick],
  );

  const handlePointerDown = useCallback(
    (e, item) => {
      e.stopPropagation();
      onSelect(item.id);
      // Placement lock (global or per-item): select only, no drag.
      if (locked || item.locked) return;
      const start = ptToFeet(
        ...pointToTuple(clientToPt(svgRef.current, e.clientX, e.clientY)),
      );
      drag.current = {
        id: item.id,
        grabDX: start.x - item.x,
        grabDY: start.y - item.y,
        moved: false,
      };
      e.target.setPointerCapture?.(e.pointerId);
    },
    [onSelect, locked],
  );

  const handlePointerMove = useCallback(
    (e) => {
      if (!drag.current) return;
      const f = ptToFeet(
        ...pointToTuple(clientToPt(svgRef.current, e.clientX, e.clientY)),
      );
      let nx = f.x - drag.current.grabDX;
      let ny = f.y - drag.current.grabDY;
      if (snapFt > 0) {
        nx = Math.round(nx / snapFt) * snapFt;
        ny = Math.round(ny / snapFt) * snapFt;
      }
      if (!drag.current.moved) {
        drag.current.moved = true;
        onDragStart();
      }
      onMoveItem(drag.current.id, { x: round2(nx), y: round2(ny) });
    },
    [onMoveItem, onDragStart, snapFt],
  );

  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  return (
    <div className="floorplan-scroll">
      <svg
        ref={svgRef}
        className="floorplan"
        width={PAGE.w * zoom}
        height={PAGE.h * zoom}
        viewBox={`0 0 ${PAGE.w} ${PAGE.h}`}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerDown={() => onSelect(null)}
      >
        {/* A4 page */}
        <rect x={0} y={0} width={PAGE.w} height={PAGE.h} fill="#ffffff" />

        {/* blueprint underlay — the authoritative, to-scale map from the PDF */}
        {showUnderlay ? (
          <image
            href={floorplanUrl}
            x={PLAN_IMAGE.x}
            y={PLAN_IMAGE.y}
            width={PLAN_IMAGE.w}
            height={PLAN_IMAGE.h}
            opacity={underlayOpacity}
            preserveAspectRatio="none"
          />
        ) : 
          <image
            href={floorplanPlainUrl}
            x={PLAN_IMAGE.x}
            y={PLAN_IMAGE.y}
            width={PLAN_IMAGE.w}
            height={PLAN_IMAGE.h}
            opacity={underlayOpacity}
            preserveAspectRatio="none"
          />
        }

        {showGrid && <Grid />}

        {/* items: zones, then furniture, then tables */}
        {order(layout.items).map((item) => {
          const p = feetToPt(item.x, item.y);
          return (
            <g
              key={item.id}
              transform={`translate(${p.x} ${p.y}) scale(${PT_PER_FOOT}) rotate(${item.rotation || 0})`}
            >
              <TableItem
                item={item}
                selected={item.id === selectedId}
                movable={!locked && !item.locked}
                showSeats={showSeats}
                showNames={showNames}
                sideByName={sideByName}
                roleByName={roleByName}
                onPointerDown={handlePointerDown}
                onSeatPointerDown={handleSeatPointerDown}
              />
            </g>
          );
        })}

        <ScaleBar />
      </svg>
    </div>
  );
}

function pointToTuple(p) {
  return [p.x, p.y];
}

function order(items) {
  const rank = { zone: 0, furniture: 1, table: 2 };
  return [...items].sort((a, b) => (rank[a.kind] ?? 3) - (rank[b.kind] ?? 3));
}

// 5 ft grid over the room, drawn in page points.
function Grid() {
  const lines = [];
  const maxFt = 180;
  for (let ft = 0; ft <= maxFt; ft += 5) {
    const a = feetToPt(ft, 0);
    const b = feetToPt(ft, 72);
    lines.push(
      <line
        key={`x${ft}`}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        className={ft % 25 === 0 ? "grid-line grid-major" : "grid-line"}
      />,
    );
  }
  for (let ft = 0; ft <= 75; ft += 5) {
    const a = feetToPt(0, ft);
    const b = feetToPt(maxFt, ft);
    lines.push(
      <line
        key={`y${ft}`}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        className={ft % 25 === 0 ? "grid-line grid-major" : "grid-line"}
      />,
    );
  }
  return <g pointerEvents="none">{lines}</g>;
}

function ScaleBar() {
  const len = SCALE_BAR.lengthFt * PT_PER_FOOT;
  const { x, y } = SCALE_BAR;
  const t = 3 * CANVAS_SCALE; // tick half-height
  return (
    <g className="scale-bar" pointerEvents="none">
      <line x1={x} y1={y} x2={x + len} y2={y} />
      <line x1={x} y1={y - t} x2={x} y2={y + t} />
      <line x1={x + len} y1={y - t} x2={x + len} y2={y + t} />
      <text x={x} y={y - t - 2 * CANVAS_SCALE}>
        {SCALE_BAR.lengthFt} Feet
      </text>
    </g>
  );
}
