"""
Build data/data.js for the pollutant x treatment field.

Inputs
  data/iwtt/*.csv          EPA Industrial Wastewater Treatment Technology DB (top-down)
  data/grid_bottomup.csv   GIAN / UNDP GRID grassroots practices (bottom-up)

Output
  data/data.js             window.WATER_DATA = {...}

Run from the repo root:  python scripts/build_data.py
"""
import json, re
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
IWTT = ROOT / "data" / "iwtt"
R = lambda f: pd.read_csv(IWTT / f, encoding="latin1")

# ---------------------------------------------------------------- taxonomy
# Edit these lists to move a pollutant between families / subclasses.
HEAVY_METALS = {"Selenium","Chromium","Copper","Zinc","Iron","Nickel","Lead","Cadmium","Mercury",
    "Arsenic","Aluminum","Manganese","Barium","Silver","Strontium","Tin","Vanadium","Beryllium",
    "Cobalt","Antimony","Thallium","Molybdenum","Titanium","Cesium"}
INORGANIC = {"Chloride","Calcium","Sulfate","Sodium","Magnesium","Potassium","Fluoride","Bromide",
    "Boron","Silicon","Cyanide","Cyanate","Thiocyanate","Sulfide","Hydrogen sulfide","Perchlorate",
    "Bicarbonate","Carbonate","Hardness","Alkalinity","Chlorine","Halogens","Nitrogen oxides"}
PHARMA = {"Ciprofloxacin","Ampicillin","Azithromycin","Morphine","Metronidazol","Diclofenac",
    "Chlortetracycline","Bisoprolol","Carbamazepine","Active Pharmaceutical Ingredients (APIs)",
    "Estrogenicity"}
SUSPENDED = {"Solids, suspended","Turbidity","Solids, total","Color"}
DISSOLVED = {"Solids, dissolved","Conductivity"}
OILS = {"Oil and grease","Fats, oils, and grease"}
CONDITION = {"Dissolved oxygen","ORP","pH range excursion","Carbon dioxide"}
ORGANIC_LOAD = {"Chemical oxygen demand (COD)","Biochemical oxygen demand (BOD)","Carbon",
    "Oxygen Demand","Organic compounds"}
NUTRIENTS = {"Ammonia","Phosphorus","Nitrogen, Total Kjeldahl (TKN)","Nitrate","Nitrogen","Nitrite",
    "Phosphate","Ammonium"}

def classify(term):
    if "PFAS" in term: return "Chemical", "PFAS forever chemicals"
    if term in HEAVY_METALS: return "Chemical", "Heavy metals and metalloids"
    if term in INORGANIC: return "Chemical", "Inorganic ions and salts"
    if term in PHARMA: return "Chemical", "Pharmaceuticals"
    if term in SUSPENDED: return "Physical", "Suspended solids and turbidity"
    if term in DISSOLVED: return "Physical", "Dissolved solids and salinity"
    if term in OILS: return "Physical", "Oils and grease"
    if term in CONDITION: return "Physical", "Water condition"
    if term in ORGANIC_LOAD: return "Biological", "Sewage and organic load"
    if term in NUTRIENTS: return "Biological", "Nutrients and algal bloom drivers"
    return "Chemical", "Hydrocarbons and industrial organics"

SUB_DESC = {
 "Heavy metals and metalloids": "Toxic metals from mining, plating and power generation. They do not break down, so treatment has to capture them: precipitation, ion exchange, sorption or membranes.",
 "Inorganic ions and salts": "Dissolved minerals and ions such as chloride, sulfate, fluoride and cyanide. Many pass through biological plants untouched.",
 "PFAS forever chemicals": "Fluorinated surfactants that resist almost every conventional process. Removal rates in the database are low for most short-chain compounds.",
 "Pharmaceuticals": "Drug residues and hormone activity. Antibiotics in this group also select for resistant microbes downstream.",
 "Hydrocarbons and industrial organics": "Fuels, solvents, phenols and other synthetic organics from refining and chemical manufacturing.",
 "Suspended solids and turbidity": "Particles you can see: silt, dirt, flocs and cloudiness. Usually the easiest load to remove by settling or filtering.",
 "Dissolved solids and salinity": "Total dissolved solids and conductivity. Invisible, and mostly only removed by membranes, evaporation or ion exchange.",
 "Oils and grease": "Free and emulsified fats and oils, separated by flotation, skimming or biological breakdown.",
 "Water condition": "Oxygen, redox and pH state. These describe the water more than a contaminant to remove.",
 "Sewage and organic load": "BOD, COD and organic carbon: the oxygen-hungry organic matter in sewage and food waste that microbes digest.",
 "Nutrients and algal bloom drivers": "Nitrogen and phosphorus forms. Excess nutrients fuel algal blooms and dead zones once discharged.",
 "Microbes and pathogens": "Bacteria, viruses and protozoa. The industrial database does not measure these at all.",
}
FAMILY_DESC = {
 "Chemical": "Dissolved substances defined by their chemistry: metals, salts, synthetic organics, PFAS and drug residues.",
 "Physical": "Properties of the water body itself: solids, cloudiness, salinity, oils and oxygen state.",
 "Biological": "Living or once-living load: sewage organics, nutrients that feed blooms, and microbes.",
}
TT_CAT_DESC = {
 "Biological": "Microbial communities digest organic matter and nutrients: activated sludge, biofilms, wetlands, membrane bioreactors.",
 "Chemical": "Reagents or energy transform or bind pollutants: precipitation, oxidation, disinfection, ion exchange, UV.",
 "Physical": "Mechanical and thermal separation: settling, flotation, aeration, evaporation, electro-processes.",
 "Membrane": "Pressure-driven barriers that sieve particles down to ions: micro/ultrafiltration, nanofiltration, reverse osmosis.",
 "Filtration": "Granular, cloth and cartridge media that strain particles from the flow.",
 "Sorption": "Surfaces that hold pollutants: activated carbon and engineered adsorptive media.",
}
# Pollutants the user's taxonomy cares about that IWTT never measures.
GAPS = [
 ("Fecal coliform and E. coli", "Biological", "Microbes and pathogens"),
 ("Enteric viruses", "Biological", "Microbes and pathogens"),
 ("Protozoa (Giardia, Cryptosporidium)", "Biological", "Microbes and pathogens"),
 ("Cyanobacteria and cyanotoxins", "Biological", "Nutrients and algal bloom drivers"),
 ("Antibiotic resistance genes", "Biological", "Microbes and pathogens"),
 ("Microplastics", "Physical", "Suspended solids and turbidity"),
]

def clean(s):
    s = "" if pd.isna(s) else str(s)
    s = re.sub(r"\s+", " ", s.replace("\\t", " ")).strip()
    return s.replace("( ", "(")

# ---------------------------------------------------------------- IWTT
p = R("PARAMETER.csv"); k = R("KEY_PARAMETER_CODE.csv"); u = R("TREATMENT_UNITS.csv")
tt = R("KEY_TREATMENT_TECH_CODES.csv"); ts = R("TREATMENT_SYSTEM.csv"); ref = R("REFERENCE_INFO.csv")

p = p.merge(k[["PARAMID", "POLLUTANT_SEARCH_TERM"]], on="PARAMID", how="left")
p["term"] = p.POLLUTANT_SEARCH_TERM.fillna(p.PARAMETER).map(clean)
p["removal"] = pd.to_numeric(p.UPDATEREMOVAL, errors="coerce")
tt["cat"] = tt.TT_CATEGORY.replace({"Physical, NEC": "Physical"})
j = (p.merge(u, on=["REF_ID", "SYSTEM_NAME"])
      .merge(tt[["TT_CODE", "TT_NAME", "cat", "TT_VARIATION"]], on="TT_CODE")
      .merge(ts[["REF_ID", "SYSTEM_NAME", "INDUSTRY", "SCALE"]], on=["REF_ID", "SYSTEM_NAME"], how="left")
      .merge(ref[["REF_ID", "TITLE", "REFDATE", "MAIN_AUTHOR"]], on="REF_ID", how="left"))

nodes = []
for (term, code), g in j.groupby(["term", "TT_CODE"]):
    fam, sub = classify(term)
    r = g.removal.dropna()
    refs = (g.drop_duplicates("REF_ID")[["TITLE", "REFDATE", "MAIN_AUTHOR"]].head(3)
              .apply(lambda x: {"title": clean(x.TITLE), "year": clean(x.REFDATE), "author": clean(x.MAIN_AUTHOR)}, axis=1).tolist())
    nodes.append({
        "id": f"t:{term}:{code}", "source": "top-down",
        "pollutant": re.sub(r"\s*\(PFAS\)$", "", term), "family": fam, "sub": sub,
        "tt": clean(g.TT_NAME.iloc[0]), "ttCode": code, "ttCat": g.cat.iloc[0],
        "ttVariation": clean(g.TT_VARIATION.iloc[0]),
        "n": int(len(g)), "systems": int(g.SYSTEM_NAME.nunique()),
        "removal": None if r.empty else round(float(r.median()), 1),
        "scales": {s: int(c) for s, c in g.drop_duplicates("SYSTEM_NAME").SCALE.fillna("Unspecified").value_counts().items()},
        "industries": [clean(x) for x in g.INDUSTRY.dropna().value_counts().head(3).index],
        "refs": [x for x in refs if x["title"]],
    })

for name, fam, sub in GAPS:
    nodes.append({"id": f"gap:{name}", "source": "gap", "pollutant": name, "family": fam, "sub": sub,
                  "tt": None, "ttCat": None, "n": 1, "removal": None})

# ---------------------------------------------------------------- GRID (bottom-up)
grid = pd.read_csv(ROOT / "data" / "grid_bottomup.csv")
for _, g in grid.iterrows():
    nodes.append({
        "id": f"g:{g.id}", "source": "bottom-up", "pollutant": clean(g.pollutant),
        "family": clean(g.pollutant_family), "sub": clean(g.pollutant_sub),
        "tt": clean(g["name"]), "ttCat": clean(g.treatment_category), "ttVariation": "",
        "description": clean(g.description), "region": clean(g.region), "url": clean(g.source_url),
        "isSample": str(g.is_sample).upper() == "TRUE", "n": 1, "removal": None,
    })

out = {
    "updated": (IWTT / "Read-Me.txt").read_text(encoding="latin1").strip(),
    "familyDesc": FAMILY_DESC, "subDesc": SUB_DESC, "ttCatDesc": TT_CAT_DESC,
    "nodes": nodes,
}
(ROOT / "data" / "data.js").write_text("window.WATER_DATA = " + json.dumps(out, ensure_ascii=False) + ";\n", encoding="utf-8")
print(f"wrote {len(nodes)} nodes")
