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
    version: 3, // v3: guests live in their own per-row store (see src/hooks/use-guests.js),
    // no longer embedded in the layout document. Tables still carry a
    // `seatNames` extra below — it's read once by src/data/default-guests.js to
    // seed the guest store's tableId/seatIndex; the running app ignores it.
    name: "The Glasshouse — HYBRID v1 (blueprint)",
    view: { ...DEFAULT_VIEW },
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
      // In the open space to the stage's left (nothing else in the layout
      // extends past the stage's own left edge, x 7.4), top-aligned with the
      // stage's own top edge (y 21.0) so it reads as clearly side-by-side
      // with it, with a real ~1ft gap between them. Portrait (widthFt >
      // lengthFt) and labelAngle 270, matching the stage's own orientation.
      {
        id: id("f"),
        kind: "furniture",
        shape: "rect",
        name: "Live Band",
        x: 4.5,
        y: 23.85,
        rotation: 0,
        labelAngle: 270,
        lengthFt: 3.75,
        widthFt: 5.7,
        diameterFt: 6,
        pax: 0,
        seating: false,
        active: true,
        color: "#f0d9a8",
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
      // Synced from the production layout (S3) so a fresh deploy / Reset starts
      // from the current real seating plan, not the original blueprint mock-up.
      rectTable("VIP2", 30, 25.5, 12, {
        seatNames: ["Mama", "Er Yi", "San Yi", "Mum", "Cassandra", "Philus", "Xiao Gu", "Da Gu", "Ah Ghim", "Dad", "Claudia", "Clarance"],
        lengthFt: lengthFromPax(12), // VIP tables are always 12-pax length
        lockLength: true,
        relations: ["bride::Relative"],
      }),
      rectTable("Table 7", 57.5, 25.5, 30, {
        seatNames: ["Da Jie", "Ken", "Er Jie", "Yun Xi", "Lai Wei Hong", "Yuen Mei Ma", "Janine Ong", "Soon Keat Chong", "Alfred Lai", "Elton Chua", "Caroline Tay", "Jason Lua", "", "Ace Han", "Emily Nyein", "Ms. Kasumi Chen", "Dawson", "Syaz", "Dulcia Lee", "Keia Ang", "Ryan Ang", "Carol Hon", "Wai San Yong", "Aitkah Sunny", "Wye kaye Yan", "Hoo Kiet Choke", "Shalote Chua", "Chin Hwee Teo", "Aloysious Tan", "Darryl Lim"],
        relations: ["bride::D's", "bride::Websparks", "bride::Secondary Friend"],
      }),
      rectTable("Table 8", 60, 15, 24, {
        seatNames: ["Jia Xuan Ng", "Justin Lim", "Zachary Goh", "Francis Goh", "Calvan Saw", "Leonard Lim", "Boon Han Charayaphan", "David Tong", "Jia Kuan Lau", "Andrew Chan", "", "Joe Ying Ying", "Wei lin Khoo", "Leon Chua", "Hui Lim Ng", "Kayla Ong", "Theo Tay", "Jin Ling Han", "Davien Soh", "Le Yuan Lee", "Tony Tan", "Eunice Lim", "Kevin Ng", "Penny Heng"],
        babySeats: [2],
        relations: ["bride::IBM", "bride::XD", "bride::Cherry"],
      }),
      rectTable("Table 9", 32.5, 15, 22, {
        seatNames: ["Andy", "Artino", "Melvin", "Siew Hua", "Shaine Wang", "Ka Chon Ho", "Sandy Huang", "Amber Lin", "Shi Ting Chen", "Zheng jie", "Josephine (jo)", "Zun Jie Yeo", "Yan Yu Sim", "Steffi Ong", "Quan Yong Koh", "Nicholas Yeo", "Pebble Quek", "Narelle Yeo", "Roanna Koh", "Gordon Goh", "Stefanie Ong", "Cliff Tan"],
        relations: ["bride::WSS", "bride::Overseas", "bride::Primary Friend"],
      }),
      rectTable("Table 10", 47.4, 5.5, 23, {
        seatNames: ["Arthur", "Benjamin", "Kai Lin", "Clara", "Philp", "Gina", "Glenn", "Jonas", "Sentosa", "Xiao Tian", "Sebastian Khoo", "Ashley Leong", "Jarmaine Oei", "Jywa Low", "Benjamin Tham", "Yen Yen Woo", "Addison Kang", "Esther Goh", "Hamilton", "Geraldine Mok", "Shu Yuan Mok", "Martin Mok"],
        relations: ["bride::Polyforum", "bride::Gametize", "bride::Pinnacle", "bride::Yumcha", "bride::Drinking"],
      }),

      // ---- Bottom half (below the aisle) ----------------------------
      rectTable("VIP1", 30, 41, 12, {
        seatNames: ["Daddy", "Mummy", "Jonathan", "Christine", "Ivan", "", "Amanda", "Jeremiah"],
        lengthFt: lengthFromPax(12), // VIP tables are always 12-pax length
        lockLength: true,
      }),
      rectTable("Table 3", 57.5, 41, 30, {
        seatNames: ["Joel Loong", "Matthew", "Belinda", "Khertan", "Shan", "Deepag", "Jacky", "Jun Jie", "Anshu", "Hao Jun", "Xing Ao", "Shoshanna", "Kenny", "Zhen Yu", "Edmund", "Sze Yee", "Kyra", "Vivien", "Jonathan (Viv + 1)", "Shamaine", "Sarah", "Joel Yeo", "Teng Liang", "Jun Hui", "Cheryl Tan", "Jordan", "Sheryl Toh", "Jon", "Serene", "Kai Wei"],
      }),
      rectTable("Table 4", 29.25, 53, 30),
      rectTable("Table 5", 60, 53, 24),
      rectTable("Table 6", 47.4, 63.5, 24, {
        seatNames: ["Raymond Kwan", "Jonathan Lim", "Hui Min Choong", "Xin de Ng", "Shi ling Lam", "Jenn Lim", "Teck Ren", "Nuwan", "Daren Ng", "Lu khei Chong", "Pei Yi Chew", "Petrine Tang", "Zi Kai Ong", "Huda Rafie", "Andy Teng", "Fairuz Choo", "Kumar Ravel", "Firly Yusmal", "Zoe", "Pei Zhi", "Felicia Ng", "Maria Ng", "Eddie Yu", "Doris Ng"],
        relations: ["bride::GovTech Im8", "bride::GovTech Design"],
      }),
    ],
  };
}
