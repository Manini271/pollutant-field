# Prompt for Claude Code

Paste everything below into Claude Code from the repo root.

---

This repo is a static GitHub Pages sketch called "Pollutant field" for my water-treatment startup. Read `README.md`, `index.html`, `css/style.css`, `js/app.js` and `scripts/build_data.py` before changing anything.

## What it is

A d3-force canvas where each mark is one pollutant x treatment technology pairing.

- Shape encodes pollutant family (triangle chemical, square physical, circle biological). Subclasses: heavy metals, inorganic ions and salts, PFAS, pharmaceuticals, hydrocarbons and industrial organics; suspended solids and turbidity, dissolved solids and salinity, oils and grease, water condition; sewage and organic load, nutrients and algal bloom drivers, microbes and pathogens.
- Color encodes treatment class (biological, chemical, physical, membrane, filtration, sorption), defined as CSS variables `--t-*`.
- Scale filter: top-down = EPA IWTT industrial database (`data/iwtt/*.csv`), bottom-up = GIAN/UNDP GRID grassroots practices (`data/grid_bottomup.csv`, currently sample rows), plus "not measured" gap nodes for pollutants IWTT never tracks.
- Views use nested `d3.pack` targets plus a containment force so marks settle into cells. Coverage view splits pairings into "Reaches threshold" (by treatment class) and "Slips through" using a median-removal slider.
- `scripts/build_data.py` builds `data/data.js` (`window.WATER_DATA`). Never hand-edit `data.js`.

## Constraints

- Stay a static site: no build step, no framework. d3 7.9.0 from cdnjs is the only dependency.
- Keep it working when `index.html` is opened from disk.
- Keep light and dark themes working through the CSS variables.
- In any copy you write, never use em dashes, and avoid the words "actually", "exactly", "especially" and the phrases "rather than" and "not just X, but Y".

## Tasks, in order

1. **GRID import.** I will add a GRID export at `data/grid_raw.csv`. Write `scripts/import_grid.py` that maps its columns to the schema in `data/grid_bottomup.csv`, classifies each practice into pollutant family/subclass and treatment class with keyword rules I can edit, and flags rows it could not classify for my review. Then rerun the build.
2. **Pollutant-centric coverage.** Add a toggle in Coverage view that collapses marks to one node per pollutant, placed inside every treatment cell that reaches the threshold for it, so I can see which pollutants no treatment class encloses.
3. **Shareable state.** Store view, filters, threshold, search and selection in the URL hash so I can send a link to a specific arrangement.
4. **Export.** Add a button that saves the current canvas as a 2x PNG with a legend strip.
5. **Mobile pass.** Test at 390px wide; make the filter rail collapsible and the drawer a bottom sheet.
6. **Keyboard access.** Let arrow keys move between marks in the current cell and Enter open the drawer.

After each task, open the page in a headless browser, screenshot every view, check the console for errors, and tell me what changed.
