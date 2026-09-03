// -----------------------------------------------------------------------------
// Default layout = the arrangement in the PDF blueprint, positioned in real feet
// (room-origin space; see venue.js). Coordinates were measured off the embedded
// blueprint image against the PDF scale bar (10 ft = 51 pt).
//
// Item kinds:
//   'table'      seating item. Counts toward total pax (when `seating` && `active`).
//   'furniture'  physical object, no seats (stage / AV).
//   'zone'       a marked area, no seats (aisle space).
//
// Pax drives a rectangular table: its LENGTH is always its pax count x 1 ft
// (not user-editable), while its HEIGHT / depth is always DEFAULT_TABLE_HEIGHT_FT.
// -----------------------------------------------------------------------------

import { BRIDE_GUESTS } from "./data/brideGuests.js";
import { GROOM_GUESTS } from "./data/groomGuests.js";

// Fixed drawn depth of every table, in feet (a 6 ft banquet trestle is ~30").
export const DEFAULT_TABLE_HEIGHT_FT = 3.5;

// Default round-table diameter, in feet.
export const DEFAULT_ROUND_DIAMETER_FT = 6;

// Shared view settings — stored in the layout doc so every visitor sees the
// same blueprint/grid state.
export const DEFAULT_VIEW = { showUnderlay: false, showGrid: true };

// Back-compat alias.
export const TABLE_WIDTH_FT = DEFAULT_TABLE_HEIGHT_FT;

export const PAX_PER_FOOT = 1; // long banquet table, seats both sides
export const FT_PER_PAX = 1 / PAX_PER_FOOT;
export const MIN_TABLE_LENGTH_FT = 3;
export const LENGTH_STEP_FT = 3; // table length is always a multiple of this

export function paxFromLength(lengthFt) {
  return Math.max(0, Math.round(lengthFt * PAX_PER_FOOT));
}
// Length derived from pax (~1 ft/pax), then rounded UP to the next 3 ft.
export function lengthFromPax(pax) {
  const raw = Math.max(
    MIN_TABLE_LENGTH_FT,
    Math.max(0, Number(pax) || 0) * FT_PER_PAX,
  );
  return Math.ceil(raw / LENGTH_STEP_FT) * LENGTH_STEP_FT;
}

let uid = 0;
const id = (prefix) => `${prefix}-${++uid}`;

function rectTable(name, x, y, pax, extra = {}) {
  return {
    id: id("t"),
    kind: "table",
    shape: "rect",
    name,
    x,
    y,
    rotation: 0,
    lengthFt: lengthFromPax(pax), // length derived from pax
    widthFt: DEFAULT_TABLE_HEIGHT_FT, // height always constant
    diameterFt: DEFAULT_ROUND_DIAMETER_FT,
    pax,
    seatNames: [], // guest name per seat, index = seat order
    seating: true,
    active: true,
    color: "#c9d8ef",
    ...extra,
  };
}

function roundTable(name, x, y, pax, diameterFt, extra = {}) {
  return {
    id: id("t"),
    kind: "table",
    shape: "round",
    name,
    x,
    y,
    rotation: 0,
    lengthFt: 6,
    widthFt: DEFAULT_TABLE_HEIGHT_FT,
    diameterFt,
    pax,
    seatNames: [],
    seating: true,
    active: true,
    color: "#e7d7f2",
    ...extra,
  };
}

export function buildDefaultLayout() {
  uid = 0;
  return {
    version: 2,
    name: "The Glasshouse — HYBRID v1 (blueprint)",
    view: { ...DEFAULT_VIEW },
    // Master guest list, split by side. Each: { id, name, side, relation, rsvp }.
    // Seats reference guests by name (item.seatNames[i]).
    guests: [
      {
        id: "g-bride",
        name: "Amanda",
        side: "bride",
        role: "bride",
        relation: "Bride",
        rsvp: "yes",
      },
      {
        id: "g-groom",
        name: "Jeremiah",
        side: "groom",
        role: "groom",
        relation: "Groom",
        rsvp: "yes",
      },
      ...BRIDE_GUESTS.map((g, i) => ({ id: `g-b${i + 1}`, ...g })),
      ...GROOM_GUESTS.map((g, i) => ({ id: `g-g${i + 1}`, ...g })),
    ],
    items: [
      // ---- Stage / fixed furniture --------------------------------------
      {
        id: id("f"),
        kind: "furniture",
        shape: "rect",
        name: "Stage + Podium + Dummy Cake + Toasting Tower",
        x: 13.7,
        y: 33.2,
        rotation: 0,
        labelAngle: 270, // read the label vertically, along the tall box
        lengthFt: 12.5, // depth (x)
        widthFt: 24.5, // width along stage (y)
        diameterFt: 6,
        pax: 0,
        seating: false,
        active: true,
        color: "#dfe3e8",
      },
      {
        id: id("f"),
        kind: "furniture",
        shape: "rect",
        name: "AV",
        x: 78.5,
        y: 58.5,
        rotation: 0,
        lengthFt: 2.5,
        widthFt: 6,
        diameterFt: 6,
        pax: 0,
        seating: false,
        active: true,
        color: "#d0d4d9",
      },

      // ---- Aisle space -------------------------------------------------
      {
        id: id("z"),
        kind: "zone",
        shape: "rect",
        name: "Aisle Space",
        x: 50,
        y: 33.5,
        rotation: 0,
        lengthFt: 62,
        widthFt: 6,
        diameterFt: 6,
        pax: 0,
        seating: false,
        active: true,
        color: "#d2e7fcd2",
      },

      // ---- Top half (above the aisle) --------------------------------
      // Both VIP tables are always drawn at a 12-pax length (a matching pair),
      // regardless of how many people sit there. `lockLength` keeps normalizeItem
      // from resetting it to the pax-derived value.
      rectTable("VIP2", 30.0, 25.5, 8, {
        lengthFt: lengthFromPax(12), // VIP tables are always 12-pax length
        lockLength: true,
      }),
      rectTable("Table 7", 57.5, 25.5, 30),
      rectTable("Table 8", 60, 15, 24),
      rectTable("Table 9", 32.5, 15, 24),
      rectTable("Table 10", 47.4, 5.5, 24),

      // ---- Bottom half (below the aisle) ----------------------------
      rectTable("VIP1", 30.0, 41, 12, {
        seatNames: ["", "", "", "", "", "Amanda", "Jeremiah"], // seat 6 & 7
        lengthFt: lengthFromPax(12), // VIP tables are always 12-pax length
        lockLength: true,
      }),
      rectTable("Table 3", 57.5, 41, 30),
      rectTable("Table 4", 32.5, 53, 24),
      rectTable("Table 5", 60, 53, 24),
      rectTable("Table 6", 47.4, 63.5, 24),
    ],
  };
}
