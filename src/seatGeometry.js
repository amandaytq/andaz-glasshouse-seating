// Seat marker positions for a table, in the table's LOCAL coordinate space
// (centre at 0,0, long axis along X for rectangles). Units: feet.
//
// Rectangular seats are numbered ALTERNATING up/down along the length:
// seat 1 top-left, seat 2 bottom-left, seat 3 top, seat 4 bottom, ... so a pair
// facing each other shares a column. `seats[i]` is the seat for index i.
//
// Each seat: { x, y } marker centre, plus { nx, ny, anchor, side } for the guest
// name label. Labels on alternate columns are pushed further out so long names
// on tightly-spaced seats don't overlap their neighbours.

const NAME_GAP = 0.5; // base distance from seat to its name label
const STAGGER_FT = 0.7; // extra push-out for alternate columns (rect)
const STAGGER_ROUND_FT = 1.2; // extra radius for every other label (round)

export function rectSeatPositions(lengthFt, widthFt, pax) {
  if (pax <= 0) return [];
  const inset = 1.1; // seat sits this far outside the long edge
  const yTop = -(widthFt / 2 + inset);
  const yBot = widthFt / 2 + inset;

  const cols = Math.ceil(pax / 2);
  const usable = lengthFt - 1.5;
  const step = cols > 1 ? usable / (cols - 1) : 0;
  const start = cols > 1 ? -usable / 2 : 0;

  const seats = [];
  for (let i = 0; i < pax; i++) {
    const col = Math.floor(i / 2);
    const top = i % 2 === 0; // even index -> top, odd -> bottom
    const x = start + col * step;
    const y = top ? yTop : yBot;
    const far = col % 2 === 1 ? STAGGER_FT : 0;
    seats.push({
      x,
      y,
      side: top ? "top" : "bottom",
      nx: x,
      ny: top ? y - NAME_GAP - far : y + NAME_GAP + far,
      anchor: "middle",
    });
  }
  return seats;
}

export function roundSeatPositions(diameterFt, pax) {
  if (pax <= 0) return [];
  const r = diameterFt / 2 + 1.1;
  const rName = diameterFt / 2 + 1.1 + NAME_GAP;
  const seats = [];
  for (let i = 0; i < pax; i++) {
    const a = (i / pax) * Math.PI * 2 - Math.PI / 2;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    const rn = rName + (i % 2 === 1 ? STAGGER_ROUND_FT : 0); // alternate label radius
    seats.push({
      x: cx * r,
      y: cy * r,
      nx: cx * rn,
      ny: cy * rn,
      anchor: cx > 0.3 ? "start" : cx < -0.3 ? "end" : "middle",
      side: cy < 0 ? "top" : "bottom",
    });
  }
  return seats;
}
