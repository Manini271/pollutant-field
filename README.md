# Pollutant field

An interactive sketch of which water pollutants current treatment technologies handle, and which slip through.

Each mark pairs one pollutant with one treatment technology.

- **Shape** is the pollutant family: triangle chemical, square physical, circle biological
- **Color** is the treatment class: biological, chemical, physical, membrane, filtration, sorption
- **Ringed** marks are bottom-up grassroots practices (GIAN / UNDP GRID)
- **Dashed outlines** are pollutants no study in the industrial database measures (pathogens, cyanotoxins, microplastics)

Views: Float, Pollutant, Treatment, Matrix, Coverage (with a removal threshold slider), Scale.
Hover for a summary, click for the full record and every other technology tested on that pollutant.

## Run locally

Open `index.html` in a browser. Data is loaded from `data/data.js`, so no server is needed.

## Publish on GitHub Pages

1. Push this folder to a repo.
2. Settings > Pages > Deploy from branch > `main` / root.
3. The site appears at `https://<you>.github.io/<repo>/`.

## Update the data

```
pip install pandas
python scripts/build_data.py
```

- Top-down data: drop a newer EPA IWTT export into `data/iwtt/`.
- Bottom-up data: replace the sample rows in `data/grid_bottomup.csv` with GRID records (same columns, set `is_sample` to FALSE).
- To move a pollutant to a different family or subclass, edit the sets at the top of `scripts/build_data.py`.

## Caveats

- IWTT reports removal for a whole treatment train. A technology inherits the removal of the train it sat in, so treat per-technology numbers as indicative.
- Mark size reflects how many records exist, which is a measure of research attention, not importance.
- Nutrients are filed under biological because they drive algal blooms; move them if your taxonomy differs.
