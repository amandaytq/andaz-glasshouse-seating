// Seat marker positions for a table, in the table's LOCAL coordinate space
// (centre at 0,0, long axis along X for rectangles). Units: feet.
//
// Rectangular seats are numbered row by row: the TOP row first, left -> right
// (seats 1 .. ceil(pax/2)), then the BOTTOM row left -> right. `seats[i]` is the
// seat for index i.
//
// Each seat: { x, y } marker centre, plus { nx, ny, anchor, side } for the guest
// name label. Labels on alternate seats in a row are pushed further out so long
// names on tightly-spaced seats don't overlap their neighbours.

const NAME_GAP = 0.5; // base distance from seat to its name label
const STAGGER_FT = 0.7; // extra push-out for every other label in a row (rect)
const STAGGER_ROUND_FT = 1.2; // extra radius for every other label (round)

export function rectSeatPositions(lengthFt, widthFt, pax) {
  if (pax <= 0) return [];
  const inset = 1.1; // seat sits this far outside the long edge
  const yTop = -(widthFt / 2 + inset);
  const yBot = widthFt / 2 + inset;

  const topCount = Math.ceil(pax / 2);
  const botCount = pax - topCount;
  const seats = [];

  const place = (count, y, side) => {
    if (count <= 0) return;
    const usable = lengthFt - 1.5;
    const step = count > 1 ? usable / (count - 1) : 0;
    const start = count > 1 ? -usable / 2 : 0;
    for (let i = 0; i < count; i++) {
      const x = start + i * step;
      const far = i % 2 === 1 ? STAGGER_FT : 0;
      seats.push({
        x,
        y,
        side,
        nx: x,
        ny: side === "top" ? y - NAME_GAP - far : y + NAME_GAP + far,
        anchor: "middle",
      });
    }
  };
  place(topCount, yTop, "top");
  place(botCount, yBot, "bottom");
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
