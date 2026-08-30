# The Glasshouse — Layout Planner

An interactive React floor-plan editor built from the blueprint
**"The Glasshouse 236-248 Pax HYBRID v1"** (2024 wedding layouts).

## Drawn exactly to the PDF

The source PDF is an **A4-landscape page** (MediaBox `842 × 596 pt`) whose floor
plan is a single embedded raster image (`1607 × 778 px`) — there is no vector
table data in it. To reproduce it exactly and to scale, the app:

1. renders that same image (`src/assets/floorplan.jpg`, extracted from the PDF)
   as an underlay, placed at the exact coordinates the PDF places it
   (`x 0, y 66.72, w 842, h 407 pt`);
2. takes the real-world scale from the PDF's own scale bar — drawn in the content
   stream with end ticks 51 pt apart → **10 ft = 51 pt, `PT_PER_FOOT = 5.1`**;
3. lays editable table objects on top, positioned in **real feet**, rendered at
   that scale.

The SVG canvas is the A4 page in points, so **Print A4** (or the browser print
dialog) reproduces the plan at 1 : 1. Fade or hide the **Blueprint** underlay
while you rearrange; the overlay tables are the editable layer.

> The underlay is the authoritative map. Default table positions were measured
> off that image against the scale bar and line up to within a few inches — nudge
> any table onto its printed position with snap enabled if needed.

## Run

```bash
npm install
npm run dev            # http://localhost:5173  (Vite + the layout API)
```

For a production-style run (built SPA + API on one port):

```bash
npm run serve          # build, then serve on http://localhost:3000
# or: npm run build && npm start
PORT=8080 npm start
```

## Shared layout (file-backed "database")

Every change to a table is saved to the server, so a deployed instance shows the
**same layout to everyone**.

- The layout lives in **`server/data/layout.json`** — one JSON document, created
  from the blueprint on first run. Writes are serialised and atomic.
- API (same origin, no auth): `GET /api/layout`, `PUT /api/layout` (`{ layout }`),
  `POST /api/layout/reset`.
- The browser **autosaves** every edit (debounced ~0.7 s) and **polls every 5 s**;
  when you're idle it picks up changes anyone else made. A status pill in the
  header shows *All changes saved / Saving… / Offline — retrying*. `localStorage`
  is only a local cache for instant reload / offline; the server file is the
  source of truth.
- Last write wins (fine for a single planner). If two people edit the exact same
  moment, the later save overwrites; the other client re-syncs on its next poll.

**Deploy note:** the app needs a Node host (it's not a pure static site) and a
**persistent disk** for `server/data/`. On platforms with an ephemeral
filesystem the file resets to the blueprint on each redeploy — mount a volume, or
point `LAYOUT_DATA_DIR` at persistent storage.

## What you can do

- **Drag** any table / the stage / the aisle to reposition it (snap to 0.5/1/2 ft).
- **Select** an item to open the inspector and edit:
  - name, shape (rectangular / round), rotation
  - **pax** — this drives the table. For a rectangular table the **length grows
    with the pax count at 1 ft per person** (36 pax → 36 ft, matching the
    blueprint). The table **height / depth is fixed** at 2.5 ft for every table.
    Untick "Length follows pax" to set a fixed length independent of pax.
  - diameter (round tables)
  - exact X/Y position in feet
  - whether the table counts toward the running total
  - **Active** toggle — the two "possible to add 1 × 6 ft table for 6 pax" spots
    from the blueprint are pre-placed as inactive ghosts; activating both takes the
    total from 236 → 248
- **Name each guest** — click a seat on the plan (or use the **Guests** list in
  the inspector) to type a name; it shows above/below that seat and is saved to
  the layout file like everything else. Toggle the **Names** view control to
  show/hide them.
- **Add** rectangular or round tables; **Duplicate** / **Delete** (or press
  Delete/Backspace).
- **Undo / Redo** — Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z.
- **Export / Import** the layout as JSON; **Reset** back to the blueprint.
- The running **total pax** and **table count** are shown in the header.

Every change is auto-saved to the server (see **Shared layout** above), so all
visitors see the same arrangement.

## Blueprint reference (default layout)

| Table | Length | Pax | | Table | Length | Pax |
|------|-------|----|--|------|-------|----|
| Table 3 | 36 ft | 36 | | Table 8 | 24 ft | 24 |
| Table 4 | 24 ft | 24 | | Table 9 | 30 ft | 30 |
| Table 5 | 30 ft | 30 | | Table 10 | 18 ft | 18 |
| Table 6 | 18 ft | 18 | | VIP1 (round) | — | 10 |
| Table 7 | 36 ft | 36 | | VIP2 (round) | — | 10 |

Base total **236 pax**; + two optional 6 ft tables → **248 pax**.

## Files

| File | Purpose |
|------|---------|
| `server/index.js` | Production server: serves `dist/` + the layout API |
| `server/apiMiddleware.js` | `/api/layout` routes (used by both Vite dev and prod) |
| `server/layoutStore.js` | Atomic file-backed store (`server/data/layout.json`) |
| `src/useLayout.js` | Load / autosave / poll against the API + undo/redo |
| `src/assets/floorplan.jpg` | The plan image extracted from the PDF (the underlay) |
| `src/venue.js` | A4 page + image placement, `PT_PER_FOOT`, feet↔pt transforms, outline, columns |
| `src/defaultLayout.js` | Blueprint arrangement in feet + `lengthFromPax` rule + `DEFAULT_TABLE_HEIGHT_FT` |
| `src/FloorPlan.jsx` | SVG A4 plan, blueprint underlay, scale bar, pointer-drag |
| `src/TableItem.jsx` | One table/furniture/zone + its seat markers |
| `src/seatGeometry.js` | Seat marker placement |
| `src/Inspector.jsx` | Edit panel for the selected item |
| `src/App.jsx` | Shell, toolbar, counters, keyboard shortcuts |

> The vector `VENUE_OUTLINE` in `src/venue.js` is only a fallback shown when the
> blueprint underlay is faded/hidden; the underlay image is the exact map.
