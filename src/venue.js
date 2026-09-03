// -----------------------------------------------------------------------------
// Venue geometry for "The Glasshouse 236-248 Pax HYBRID v1".
//
// The supplied PDF is an A4 LANDSCAPE page (MediaBox [0 0 842 596] pt) whose
// floor plan is a single embedded raster image (1607 x 778 px). There is no
// vector table data in the PDF, so to reproduce it *exactly* and to scale we:
//
//   1. render that same image (src/assets/floorplan.jpg) as an underlay, placed
//      at the exact coordinates the PDF places it;
//   2. take the real-world scale from the PDF's own scale bar, drawn in the
//      content stream as `8 474 52 1 re` with end ticks at x=8 and x=59
//      -> 10 ft = 51 pt  ->  PT_PER_FOOT = 5.10;
//   3. lay editable table objects on top, positioned in real feet.
//
// All SVG coordinates below are in PDF POINTS on the A4 page (origin top-left,
// y down), so 1 unit here == 1 pt in the PDF == 1/72 inch on an A4 printout.
// -----------------------------------------------------------------------------

// Uniform zoom baked into every canvas measurement (page, image, scale, ticks).
// Bump this to render the whole plan larger while keeping every position and
// size proportional. 1 = the true A4 page in points.
export const CANVAS_SCALE = 2;
const S = CANVAS_SCALE;

// A4 landscape page, in points (matches the PDF MediaBox) x CANVAS_SCALE.
export const PAGE = { w: 842 * S, h: 596 * S };

// Where the PDF paints the plan image on that page (derived from the content
// stream: translate 58.72, scale 0.523958/0.523136, image 1607x778, +8 pt page
// offset). Width spans the full page; height keeps the image's aspect ratio.
export const PLAN_IMAGE = { x: 0, y: 66.72 * S, w: 842 * S, h: 407.0 * S };

// Pixels of the source image per point on the page.
export const IMG_PX_PER_PT = 1607 / PLAN_IMAGE.w;

// Real-world scale: points on the page per foot (from the PDF scale bar) x scale.
export const PT_PER_FOOT = 5.2 * S;
export const IMG_PX_PER_FOOT = PT_PER_FOOT * IMG_PX_PER_PT;

// Interior top-left corner of the main hall, measured on the source image
// (~30, 34 px), expressed in page points.
export const ROOM_ORIGIN = {
  x: (30 / 1607) * PLAN_IMAGE.w,
  y: PLAN_IMAGE.y + (34 / 778) * PLAN_IMAGE.h,
};

// feet (room-origin space) -> page points
export function feetToPt(xFt, yFt) {
  return {
    x: ROOM_ORIGIN.x + xFt * PT_PER_FOOT,
    y: ROOM_ORIGIN.y + yFt * PT_PER_FOOT,
  };
}
// page points -> feet
export function ptToFeet(xPt, yPt) {
  return {
    x: (xPt - ROOM_ORIGIN.x) / PT_PER_FOOT,
    y: (yPt - ROOM_ORIGIN.y) / PT_PER_FOOT,
  };
}

// Scale bar exactly where the PDF draws it (content-stream y 470 + 8 pt offset).
export const SCALE_BAR = { x: 8 * S, y: 478 * S, lengthFt: 10 };

// Vector trace of the MAIN HALL — the area the tables occupy — in feet
// (room-origin space), taken off the blueprint image against the scale bar.
// The glass wing to the east is left out; this is the table-placement boundary.
export const VENUE_OUTLINE = [
  [0, 0], // top-left corner
  [82.3, 0.9], // top wall -> top-right corner (slight slope)
  [82.6, 13.2], // east wall down to the glass-wing junction
  [87.0, 13.5], // short jog east where the wing opens off the hall
  [87.0, 17.0],
  [82.9, 17.4], // back onto the hall's east wall
  [83.1, 49.6], // straight down, past the wall alcoves
  [85.6, 50.3], // step out at the AV recess
  [85.6, 57.2],
  [83.1, 58.0],
  [83.0, 68.0], // bottom-right corner
  [0, 70.4], // bottom wall slopes down to the bottom-left corner
];

// Structural / decorative circles from the blueprint (not seating), in feet.
export const VENUE_COLUMNS = [
  { x: 29.3, y: 3.5, r: 3.2 },
  { x: 64.2, y: 2.9, r: 3.2 },
  { x: 30.8, y: 67.4, r: 3.2 },
  { x: 67.8, y: 67.4, r: 3.2 },
  { x: 97.1, y: 42.9, r: 3.2 },
  { x: 121.2, y: 45.8, r: 3.2 },
];

export function outlinePath(points = VENUE_OUTLINE) {
  return (
    points
      .map((p, i) => {
        const q = feetToPt(p[0], p[1]);
        return `${i === 0 ? "M" : "L"} ${q.x.toFixed(2)} ${q.y.toFixed(2)}`;
      })
      .join(" ") + " Z"
  );
}
