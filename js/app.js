/* Pollutant field
   One mark = one pollutant paired with one treatment technology.
   Shape  = pollutant family (circle biological, triangle chemical, square physical)
   Color  = treatment class
   Ring   = bottom-up (grassroots) record, dashed outline = never measured
   Size   = the same for every mark; it carries no meaning for now */

(() => {
  const DATA = window.WATER_DATA;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const FAMILIES = ["Chemical", "Physical", "Biological"];
  const SHAPES = { Chemical: "triangle", Physical: "square", Biological: "circle" };
  const TT_CATS = ["Biological", "Chemical", "Physical", "Membrane", "Filtration", "Sorption"];
  const SOURCES = [
    { key: "top-down", label: "Top-down", note: "industrial plants (EPA IWTT)" },
    { key: "bottom-up", label: "Bottom-up", note: "grassroots practices (GRID)" },
    { key: "gap", label: "Not measured", note: "pollutants no IWTT study tracks" },
  ];
  const VIEWS = [
    { key: "float", label: "Float" },
    { key: "pollutant", label: "Pollutant" },
    { key: "treatment", label: "Treatment" },
    { key: "matrix", label: "Matrix" },
    { key: "coverage", label: "Coverage" },
    { key: "scale", label: "Scale" },
  ];
  const SUBS = {};
  DATA.nodes.forEach(n => { (SUBS[n.family] ||= new Set()).add(n.sub); });

  // ------------------------------------------------------------ state
  const state = {
    view: "float",
    families: new Set(FAMILIES),
    subs: new Set(Object.values(SUBS).flatMap(s => [...s])),
    tt: new Set(TT_CATS),
    sources: new Set(SOURCES.map(s => s.key)),
    threshold: 70,
    query: "",
    selected: null,
    hover: null,
  };

  // ------------------------------------------------------------ nodes
  const BASE_R = 6.5;   // one base radius for every mark; each view still scales it to fit its layout
  const all = DATA.nodes.map(d => ({ ...d, base: BASE_R, r: BASE_R, phase: Math.random() * Math.PI * 2 }));

  // ------------------------------------------------------------ theme
  let C = {};
  function readTheme() {
    const s = getComputedStyle(document.documentElement);
    const v = k => s.getPropertyValue(k).trim();
    C = {
      bg: v("--bg"), ink: v("--ink"), muted: v("--muted"), rule: v("--rule"),
      tt: Object.fromEntries(TT_CATS.map(t => [t, v(`--t-${t.toLowerCase()}`)])),
    };
  }
  readTheme();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { readTheme(); buildControls(); draw(); });

  // ------------------------------------------------------------ canvas
  const field = document.getElementById("field");
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1;

  function resize() {
    const b = field.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = b.width; H = b.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout(0.6);
  }

  // ------------------------------------------------------------ filtering
  const visible = () => all.filter(d =>
    state.sources.has(d.source) &&
    state.families.has(d.family) && state.subs.has(d.sub) &&
    (d.ttCat == null || state.tt.has(d.ttCat)));

  const matches = d => {
    if (state.selected) return d.pollutant === state.selected.pollutant;
    if (!state.query) return true;
    const q = state.query;
    return d.pollutant.toLowerCase().includes(q) || (d.tt || "").toLowerCase().includes(q);
  };

  // ------------------------------------------------------------ grouping per view
  // Returns a path of group names; the last is the leaf the node is pulled toward.
  function pathFor(d) {
    switch (state.view) {
      case "pollutant": return [d.family, d.sub];
      case "treatment":
        return d.source === "gap" ? ["Not measured", "No treatment recorded"] : [d.ttCat, d.tt];
      case "scale":
        return [SOURCES.find(s => s.key === d.source).label];
      case "coverage": {
        if (d.source === "gap") return ["Slips through", "Never measured"];
        if (d.source === "bottom-up") return ["Reaches threshold", d.ttCat];
        if (d.removal == null) return ["Slips through", "No removal data"];
        return d.removal >= state.threshold ? ["Reaches threshold", d.ttCat] : ["Slips through", "Below threshold"];
      }
      default: return ["All"];
    }
  }

  let leaves = new Map();   // leafKey -> {x, y, R, color, label, depth, parentKey}
  let parents = new Map();  // parentKey -> {label}
  let matrix = null;

  function groupColor(view, path) {
    if (view === "treatment" && C.tt[path[0]]) return C.tt[path[0]];
    if (view === "coverage" && path[0] === "Reaches threshold") return C.tt[path[1]];
    return C.muted;
  }

  function layout(alpha = 0.9) {
    const nodes = visible();
    leaves = new Map(); parents = new Map(); matrix = null;
    const pad = 36;

    if (state.view === "matrix") {
      const cols = [...TT_CATS, "None"], rows = FAMILIES;
      const left = 110, top = 50;
      const cw = (W - left - 20) / cols.length, ch = (H - top - 40) / rows.length;
      matrix = { cols, rows, left, top, cw, ch };
      const counts = {};
      nodes.forEach(d => { const k = `${d.family}|${d.ttCat || "None"}`; counts[k] = (counts[k] || 0) + (d.base + 1) ** 2; });
      const capR = Math.min(cw, ch) / 2 - 8;
      const need = Math.max(...Object.values(counts).map(v => Math.sqrt(v * 1.25)), 1);
      const rs = Math.max(0.35, Math.min(1.2, capR / need));
      nodes.forEach(d => { d.r = d.base * rs; });
      rows.forEach((f, i) => cols.forEach((t, j) => {
        leaves.set(`${f}|${t}`, { x: left + cw * (j + 0.5), y: top + ch * (i + 0.5), R: capR });
      }));
      nodes.forEach(d => { d.leaf = `${d.family}|${d.ttCat || "None"}`; });
    } else if (state.view === "float") {
      const R = Math.min(W, H) / 2 - pad;
      const need = Math.sqrt(nodes.reduce((s, d) => s + (d.base + 1) ** 2, 0) * 1.3);
      const rs = Math.max(0.35, Math.min(1.25, R / need));
      nodes.forEach(d => { d.r = d.base * rs; d.leaf = "All"; });
      leaves.set("All", { x: W / 2, y: H / 2, R: R });
    } else {
      // nested circle packing: root -> group -> leaf
      const tree = { name: "root", children: [] };
      const index = new Map();
      nodes.forEach(d => {
        const path = pathFor(d);
        d.path = path;
        let parent = tree, key = "";
        path.forEach((name, i) => {
          key += "/" + name;
          let child = index.get(key);
          if (!child) {
            child = { name, key, path: path.slice(0, i + 1), children: i < path.length - 1 ? [] : undefined, value: 0 };
            parent.children.push(child); index.set(key, child);
          }
          if (i === path.length - 1) child.value += (d.base + 1) ** 2 * 1.3;
          parent = child;
        });
        d.leaf = key;
      });
      const root = d3.hierarchy(tree).sum(n => n.value || 0).sort((a, b) => b.value - a.value);
      d3.pack().size([W - pad * 2, H - pad * 2]).padding(n => (n.depth === 0 ? 30 : 16))(root);
      const lv = root.leaves().filter(l => l.data.value > 0);
      const scale = d3.median(lv, l => l.r / Math.sqrt(l.data.value)) || 1;
      const rs = Math.max(0.3, Math.min(1.35, scale));
      nodes.forEach(d => { d.r = d.base * rs; });
      root.each(n => {
        if (n.depth === 0) return;
        const entry = { x: n.x + pad, y: n.y + pad, R: n.r, label: n.data.name, path: n.data.path, depth: n.depth,
          color: groupColor(state.view, n.data.path), parentKey: n.parent && n.parent.depth > 0 ? n.parent.data.key : null };
        if (n.children) parents.set(n.data.key, entry); else leaves.set(n.data.key, entry);
      });
    }

    nodes.forEach(d => {
      if (d.x == null) { d.x = W / 2 + (Math.random() - 0.5) * W * 0.6; d.y = H / 2 + (Math.random() - 0.5) * H * 0.6; }
    });
    sim.nodes(nodes);
    sim.force("collide").radius(d => d.r + (state.view === "float" ? 2.2 : 0.7));
    sim.alphaTarget(state.view === "float" && !reduceMotion ? 0.04 : 0);
    if (reduceMotion) { sim.alpha(1); for (let i = 0; i < 260; i++) sim.tick(); sim.stop(); draw(); }
    else sim.alpha(alpha).restart();
    updateStatus();
  }

  // ------------------------------------------------------------ forces
  function forceContain() {
    let nodes;
    function f() {
      for (const d of nodes) {
        const L = leaves.get(d.leaf); if (!L) continue;
        const dx = d.x - L.x, dy = d.y - L.y, dist = Math.hypot(dx, dy), lim = L.R - d.r;
        if (dist > lim && dist > 0) { const k = (dist - lim) / dist * 0.5; d.x -= dx * k; d.y -= dy * k; }
      }
    }
    f.initialize = n => (nodes = n);
    return f;
  }
  function forceDrift() {
    let nodes, t = 0;
    function f() {
      if (state.view !== "float" || reduceMotion) return;
      t += 0.01;
      for (const d of nodes) { d.vx += Math.cos(t + d.phase) * 0.03; d.vy += Math.sin(t * 1.3 + d.phase) * 0.03; }
    }
    f.initialize = n => (nodes = n);
    return f;
  }
  const sim = d3.forceSimulation()
    .velocityDecay(0.32).alphaDecay(0.025)
    .force("x", d3.forceX(d => (leaves.get(d.leaf) || { x: W / 2 }).x).strength(d => state.view === "float" ? 0.012 : 0.07))
    .force("y", d3.forceY(d => (leaves.get(d.leaf) || { y: H / 2 }).y).strength(d => state.view === "float" ? 0.012 : 0.07))
    .force("collide", d3.forceCollide().iterations(2))
    .force("contain", forceContain())
    .force("drift", forceDrift())
    .on("tick", draw);

  // ------------------------------------------------------------ drawing
  function shapePath(c, shape, x, y, r) {
    c.beginPath();
    if (shape === "circle") c.arc(x, y, r, 0, Math.PI * 2);
    else if (shape === "square") { const s = r * 0.88; c.rect(x - s, y - s, s * 2, s * 2); }
    else { const R = r * 1.22; c.moveTo(x, y - R); c.lineTo(x + R * 0.866, y + R * 0.5); c.lineTo(x - R * 0.866, y + R * 0.5); c.closePath(); }
  }

  function hullOf(key) {
    let sx = 0, sy = 0, n = 0;
    const ns = sim.nodes().filter(d => d.leaf === key);
    ns.forEach(d => { sx += d.x; sy += d.y; n++; });
    if (!n) return null;
    const cx = sx / n, cy = sy / n;
    let R = 0; ns.forEach(d => { R = Math.max(R, Math.hypot(d.x - cx, d.y - cy) + d.r); });
    return { x: cx, y: cy, r: R + 6 };
  }

  function label(text, x, y, size, weight, color) {
    ctx.font = `${weight} ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.lineWidth = 4; ctx.strokeStyle = C.bg; ctx.lineJoin = "round";
    ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const nodes = sim.nodes();
    const highlighting = !!(state.selected || state.query);

    // group cells
    const leafHulls = new Map();
    if (state.view !== "float" && state.view !== "matrix") {
      leaves.forEach((L, key) => { const h = hullOf(key); if (h) leafHulls.set(key, h); });
      // parents enclose their children
      parents.forEach((P, key) => {
        const kids = [...leafHulls.entries()].filter(([k]) => leaves.get(k).parentKey === key).map(([, h]) => h);
        if (!kids.length) return;
        const e = d3.packEnclose(kids.map(h => ({ x: h.x, y: h.y, r: h.r })));
        P.hull = { x: e.x, y: e.y, r: e.r + 12 };
        ctx.beginPath(); ctx.arc(P.hull.x, P.hull.y, P.hull.r, 0, Math.PI * 2);
        ctx.setLineDash(P.label === "Slips through" || P.label === "Not measured" ? [5, 5] : []);
        ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      });
      leafHulls.forEach((h, key) => {
        const L = leaves.get(key);
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.fillStyle = L.color; ctx.globalAlpha = 0.09; ctx.fill();
        ctx.globalAlpha = 0.45; ctx.strokeStyle = L.color; ctx.lineWidth = 1; ctx.stroke();
        ctx.globalAlpha = 1;
      });
    }
    if (matrix) drawMatrixFrame();

    // marks
    for (const d of nodes) {
      const on = !highlighting || matches(d);
      ctx.globalAlpha = on ? 1 : 0.1;
      const shape = SHAPES[d.family] || "circle";
      if (d.source === "gap") {
        shapePath(ctx, shape, d.x, d.y, d.r);
        ctx.setLineDash([2.5, 2]); ctx.strokeStyle = C.ink; ctx.lineWidth = 1.3; ctx.stroke(); ctx.setLineDash([]);
      } else {
        shapePath(ctx, shape, d.x, d.y, d.r);
        ctx.fillStyle = C.tt[d.ttCat] || C.muted; ctx.fill();
        if (d.source === "bottom-up") {
          ctx.beginPath(); ctx.arc(d.x, d.y, d.r * 1.55 + 2, 0, Math.PI * 2);
          ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2; ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;

    const focus = state.hover || state.selected;
    if (focus && sim.nodes().includes(focus)) {
      ctx.beginPath(); ctx.arc(focus.x, focus.y, focus.r * 1.6 + 4, 0, Math.PI * 2);
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.stroke();
    }

    // labels last so they sit on top; skip any that would collide, hovered cell wins
    if (state.view !== "float" && state.view !== "matrix") {
      const items = [];
      parents.forEach(P => { if (P.hull) items.push({ t: P.label, x: P.hull.x, y: P.hull.y - P.hull.r - 4, size: 15, w: 700, c: C.ink, p: 1e6 }); });
      leafHulls.forEach((h, key) => {
        const L = leaves.get(key);
        if (L.label === "All") return;
        const hot = focus && focus.leaf === key;
        items.push({ t: L.label, x: h.x, y: h.y - h.r - 3, size: 12, w: hot ? 700 : 500, c: hot ? C.ink : C.muted, p: hot ? 2e6 : h.r });
      });
      items.sort((a, b) => b.p - a.p);
      const placed = [];
      for (const it of items) {
        ctx.font = `${it.w} ${it.size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
        const w = ctx.measureText(it.t).width + 6, box = { x0: it.x - w / 2, x1: it.x + w / 2, y0: it.y - it.size - 2, y1: it.y + 1 };
        if (placed.some(b => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
        placed.push(box); label(it.t, it.x, it.y, it.size, it.w, it.c);
      }
    }
  }

  function drawMatrixFrame() {
    const { cols, rows, left, top, cw, ch } = matrix;
    ctx.strokeStyle = C.rule; ctx.lineWidth = 1;
    cols.forEach((c, j) => {
      const x = left + cw * j;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + ch * rows.length); ctx.stroke();
      label(c === "None" ? "No treatment" : c, x + cw / 2, top - 10, 13, 700, c === "None" ? C.muted : C.tt[c]);
    });
    rows.forEach((r, i) => {
      const y = top + ch * i;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + cw * cols.length, y); ctx.stroke();
      ctx.font = `700 13px "Helvetica Neue", Helvetica, Arial, sans-serif`; ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillStyle = C.ink; ctx.fillText(r, left - 30, y + ch / 2);
      shapePath(ctx, SHAPES[r], left - 15, y + ch / 2, 6); ctx.fillStyle = C.ink; ctx.fill();
    });
    // empty cells are the story: mark them
    const filled = new Set(sim.nodes().map(d => d.leaf));
    rows.forEach((r, i) => cols.forEach((c, j) => {
      if (!filled.has(`${r}|${c}`)) {
        ctx.font = `400 12px "Helvetica Neue", Helvetica, Arial, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = C.muted; ctx.fillText("no data", left + cw * (j + 0.5), top + ch * (i + 0.5));
      }
    }));
  }

  // ------------------------------------------------------------ status line
  const status = document.getElementById("status");
  function updateStatus() {
    const ns = sim.nodes();
    if (state.view === "coverage") {
      const top = ns.filter(d => d.source === "top-down");
      const pols = new Set(top.map(d => d.pollutant));
      const ok = new Set(top.filter(d => d.removal != null && d.removal >= state.threshold).map(d => d.pollutant));
      const gaps = ns.filter(d => d.source === "gap").length;
      status.textContent = `${pols.size - ok.size} of ${pols.size} measured pollutants have no technology reaching ${state.threshold}% median removal` +
        (gaps ? `, and ${gaps} are never measured.` : ".");
    } else {
      const p = new Set(ns.map(d => d.pollutant)).size;
      status.textContent = `${ns.length} pairings across ${p} pollutants`;
    }
  }

  // ------------------------------------------------------------ controls
  const svgShape = (shape, color, size = 12, ring = false, dashed = false) => {
    const h = size / 2, r = size * 0.36;
    let s = "";
    if (shape === "circle") s = `<circle cx="${h}" cy="${h}" r="${r}"/>`;
    else if (shape === "square") s = `<rect x="${h - r * 0.9}" y="${h - r * 0.9}" width="${r * 1.8}" height="${r * 1.8}"/>`;
    else s = `<polygon points="${h},${h - r * 1.2} ${h + r * 1.05},${h + r * 0.62} ${h - r * 1.05},${h + r * 0.62}"/>`;
    const paint = dashed ? `fill="none" stroke="${color}" stroke-dasharray="2 1.5"` : `fill="${color}"`;
    const ringEl = ring ? `<circle cx="${h}" cy="${h}" r="${h - 0.7}" fill="none" stroke="${C.ink}" stroke-width="1"/>` : "";
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><g ${paint}>${s}</g>${ringEl}</svg>`;
  };
  const count = pred => all.filter(pred).length;

  function chip(text, pressed, icon, n, onClick, extraClass = "") {
    const b = document.createElement("button");
    b.className = "chip " + extraClass;
    b.setAttribute("aria-pressed", pressed);
    b.innerHTML = `${icon || ""}<span>${text}</span>${n != null ? `<span class="count">${n}</span>` : ""}`;
    b.addEventListener("click", onClick);
    return b;
  }

  function buildControls() {
    const views = document.getElementById("views"); views.innerHTML = "";
    VIEWS.forEach(v => {
      const b = document.createElement("button");
      b.setAttribute("role", "radio"); b.setAttribute("aria-checked", state.view === v.key); b.textContent = v.label;
      b.addEventListener("click", () => { state.view = v.key; buildControls(); layout(); });
      views.appendChild(b);
    });
    document.getElementById("thresholdWrap").hidden = state.view !== "coverage";

    const fam = document.getElementById("families"); fam.innerHTML = "";
    FAMILIES.forEach(f => {
      const wrap = document.createElement("div"); wrap.className = "family";
      wrap.appendChild(chip(f, state.families.has(f), svgShape(SHAPES[f], C.ink, 13), count(d => d.family === f), () => {
        toggle(state.families, f); buildControls(); layout(0.5);
      }));
      const subs = document.createElement("div"); subs.className = "subs";
      [...SUBS[f]].sort().forEach(s => subs.appendChild(chip(s, state.subs.has(s), null, count(d => d.sub === s), () => {
        toggle(state.subs, s); buildControls(); layout(0.5);
      })));
      wrap.appendChild(subs); fam.appendChild(wrap);
    });

    const tt = document.getElementById("treatments"); tt.innerHTML = "";
    TT_CATS.forEach(t => tt.appendChild(chip(t, state.tt.has(t), svgShape("circle", C.tt[t], 13), count(d => d.ttCat === t), () => {
      toggle(state.tt, t); buildControls(); layout(0.5);
    })));

    const sc = document.getElementById("scales"); sc.innerHTML = "";
    SOURCES.forEach(s => {
      const icon = s.key === "bottom-up" ? svgShape("circle", C.muted, 14, true) : s.key === "gap" ? svgShape("circle", C.ink, 13, false, true) : svgShape("circle", C.muted, 13);
      const b = chip(s.label, state.sources.has(s.key), icon, count(d => d.source === s.key), () => {
        toggle(state.sources, s.key); buildControls(); layout(0.5);
      });
      b.title = s.note; sc.appendChild(b);
    });
  }
  const toggle = (set, k) => (set.has(k) ? set.delete(k) : set.add(k));

  const thr = document.getElementById("threshold");
  thr.addEventListener("input", () => {
    state.threshold = +thr.value; document.getElementById("thresholdOut").textContent = thr.value; layout(0.5);
  });
  document.getElementById("search").addEventListener("input", e => {
    state.query = e.target.value.trim().toLowerCase(); draw();
  });

  // ------------------------------------------------------------ hover, click
  const tip = document.getElementById("tip");
  const pct = v => (v == null ? "no removal data" : `${Math.round(v)}% median removal`);

  function pick(ev) {
    const b = canvas.getBoundingClientRect();
    const x = ev.clientX - b.left, y = ev.clientY - b.top;
    const d = sim.find(x, y, 14);
    return { d, x, y };
  }
  canvas.addEventListener("mousemove", ev => {
    const { d, x, y } = pick(ev);
    state.hover = d || null;
    canvas.style.cursor = d ? "pointer" : "default";
    if (d) {
      const what = d.source === "gap" ? "Not measured in IWTT" : d.source === "bottom-up" ? `${d.tt} (grassroots)` : `${d.tt}<br>${pct(d.removal)}`;
      tip.innerHTML = `<b>${d.pollutant}</b>${what}`;
      tip.hidden = false;
      const tx = Math.min(x + 14, W - 270), ty = Math.max(y - 46, 6);
      tip.style.left = tx + "px"; tip.style.top = ty + "px";
    } else tip.hidden = true;
    if (sim.alpha() < sim.alphaMin() || reduceMotion) draw();
  });
  canvas.addEventListener("mouseleave", () => { tip.hidden = true; state.hover = null; draw(); });
  canvas.addEventListener("click", ev => { const { d } = pick(ev); select(d || null); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") select(null); });
  document.getElementById("close").addEventListener("click", () => select(null));

  // ------------------------------------------------------------ drawer
  const drawer = document.getElementById("drawer"), body = document.getElementById("drawerBody");
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function select(d) {
    state.selected = d;
    drawer.hidden = !d;
    if (d) renderDrawer(d);
    draw();
  }

  function renderDrawer(d) {
    const color = C.tt[d.ttCat] || C.muted;
    const siblings = all.filter(x => x.pollutant === d.pollutant && x !== d)
      .sort((a, b) => (b.removal ?? -1) - (a.removal ?? -1));
    let html = `
      <p class="kicker">${svgShape(SHAPES[d.family], C.ink, 13)} ${esc(d.family)}, ${esc(d.sub).toLowerCase()}</p>
      <h3>${esc(d.pollutant)}</h3>
      <p class="body">${esc(DATA.subDesc[d.sub] || DATA.familyDesc[d.family])}</p>`;

    if (d.source === "gap") {
      html += `<section><h4>Treatment</h4><p class="body">No study in the industrial wastewater database reports removal for this pollutant. It sits outside what current top-down systems are monitored for.</p></section>`;
    } else {
      html += `<section><h4>Treatment</h4>
        <p class="kicker"><span class="dot" style="background:${color}"></span>${esc(d.ttCat)}</p>
        <h3 style="font-size:18px">${esc(d.tt)}</h3>
        ${d.ttVariation ? `<p class="body">Also called: ${esc(d.ttVariation)}</p>` : ""}
        <p class="body">${esc(DATA.ttCatDesc[d.ttCat] || "")}</p></section>`;
    }

    if (d.source === "top-down") {
      const scales = Object.entries(d.scales || {}).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ");
      html += `<section><h4>Evidence</h4><dl>
        <dt>Median removal</dt><dd>${d.removal == null ? "not reported" : Math.round(d.removal) + "%"}
          ${d.removal != null ? `<div class="bar"><i style="width:${Math.max(0, Math.min(100, d.removal))}%;background:${color}"></i></div>` : ""}</dd>
        <dt>Records</dt><dd>${d.n} across ${d.systems} system${d.systems > 1 ? "s" : ""}</dd>
        <dt>Scale</dt><dd>${esc(scales) || "unspecified"}</dd>
        <dt>Industries</dt><dd>${esc((d.industries || []).join(", ")) || "unspecified"}</dd>
      </dl>
      ${d.refs && d.refs.length ? `<h4 style="margin-top:12px">Sources</h4><ol class="refs">${d.refs.map(r => `<li>${esc(r.title)}${r.year ? ` (${esc(r.year)})` : ""}</li>`).join("")}</ol>` : ""}
      </section>`;
    } else if (d.source === "bottom-up") {
      html += `<section><h4>Grassroots practice</h4>
        ${d.isSample ? `<p><span class="flag">Sample row, replace with GRID data</span></p>` : ""}
        <p class="body">${esc(d.description)}</p>
        <dl><dt>Region</dt><dd>${esc(d.region)}</dd></dl>
        ${d.url ? `<p class="body"><a href="${esc(d.url)}" target="_blank" rel="noopener">Open in GRID</a></p>` : ""}</section>`;
    }

    if (siblings.length) {
      html += `<section><h4>Every recorded treatment for ${esc(d.pollutant)}</h4><ul class="alts">${siblings.map(s => `
        <li><span class="dot" style="background:${C.tt[s.ttCat] || "transparent"};${s.source === "gap" ? `border:1px dashed ${C.ink}` : ""}"></span>
        <button data-id="${esc(s.id)}">${esc(s.tt || "Not measured")}${s.source === "bottom-up" ? " (grassroots)" : ""}</button>
        <span>${s.removal == null ? "" : Math.round(s.removal) + "%"}</span></li>`).join("")}</ul></section>`;
    }
    body.innerHTML = html;
    body.querySelectorAll(".alts button").forEach(b => b.addEventListener("click", () => {
      select(all.find(x => x.id === b.dataset.id));
    }));
    drawer.scrollTop = 0;
  }

  // ------------------------------------------------------------ go
  buildControls();
  new ResizeObserver(resize).observe(field);
})();
