"""
Fetch one waterbody's river lines and monitoring sites from the USGS
Network Linked Data Index (NLDI), a free public API with no key.

    python pipeline/fetch_waterbody.py

Writes:
  data/raw/<slug>_*.json            untouched API responses
  data/clean/<slug>_river.geojson   river lines for the map
  data/clean/<slug>_monitors.geojson   Water Quality Portal sampling sites

To change the waterbody, edit SLUG, NAME and POINT below.
"""
import json, sys, urllib.request, urllib.parse
from pathlib import Path

SLUG  = "providence"
NAME  = "Woonasquatucket + Providence River (WaterFire)"
POINT = (-71.4118, 41.8273)        # lon, lat near Waterplace Park; NLDI snaps to the nearest river
UPSTREAM_KM, DOWNSTREAM_KM = 30, 8

ROOT = Path(__file__).resolve().parents[1]
RAW, CLEAN = ROOT / "data" / "raw", ROOT / "data" / "clean"
RAW.mkdir(parents=True, exist_ok=True); CLEAN.mkdir(parents=True, exist_ok=True)

# USGS has moved this API before, so try the current address, then the older one
BASES = ["https://api.water.usgs.gov/nldi/linked-data",
         "https://labs.waterdata.usgs.gov/api/nldi/linked-data"]
AGENT = {"User-Agent": "BIOPOD research (maninibanerjee.studio@gmail.com)"}

def get(path, params=None):
    last = None
    for base in BASES:
        url = base + path + ("?" + urllib.parse.urlencode(params) if params else "")
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=AGENT), timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            last = f"{url}\n  -> {e}"
    sys.exit(f"Could not reach NLDI. Last attempt:\n{last}")

def save_raw(name, obj):
    (RAW / f"{SLUG}_{name}.json").write_text(json.dumps(obj))

# 1. snap the point to a river segment (COMID = the river segment's ID in the National Hydrography Dataset)
pos = get("/comid/position", {"f": "json", "coords": f"POINT({POINT[0]} {POINT[1]})"})
save_raw("position", pos)
props = pos["features"][0]["properties"]
comid = props.get("comid") or props.get("identifier")
print(f"Snapped to river segment COMID {comid} ({props.get('name') or 'unnamed'})")

# 2. river lines: upstream along the main stem, plus a short way downstream
up   = get(f"/comid/{comid}/navigation/UM/flowlines", {"distance": UPSTREAM_KM})
down = get(f"/comid/{comid}/navigation/DM/flowlines", {"distance": DOWNSTREAM_KM})
save_raw("flowlines_up", up); save_raw("flowlines_down", down)
river = {"type": "FeatureCollection",
         "name": NAME,
         "features": [dict(f, properties={**f.get("properties", {}), "direction": d})
                      for d, fc in (("upstream", up), ("downstream", down)) for f in fc.get("features", [])]}
(CLEAN / f"{SLUG}_river.geojson").write_text(json.dumps(river))
print(f"River: {len(river['features'])} line segments")

# 3. who monitors it: Water Quality Portal sites linked to this stretch
wqp = get(f"/comid/{comid}/navigation/UM/wqp", {"distance": UPSTREAM_KM})
save_raw("wqp", wqp)
monitors = {"type": "FeatureCollection", "features": []}
for f in wqp.get("features", []):
    p = f.get("properties", {})
    monitors["features"].append({
        "type": "Feature", "geometry": f.get("geometry"),
        "properties": {"name": p.get("name"), "id": p.get("identifier"),
                       "url": p.get("uri"), "source": "Water Quality Portal via USGS NLDI"}})
(CLEAN / f"{SLUG}_monitors.geojson").write_text(json.dumps(monitors))
print(f"Monitoring sites: {len(monitors['features'])}")
print("Done. Reload pages/stakeholders.html")
