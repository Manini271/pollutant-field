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
  const scroller = document.getElementById("scroller");
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, viewW = 0, viewH = 0, dpr = 1;

  // W x H is the canvas size: the visible area, or more when a view needs to scroll
  function sizeCanvas(w, h) {
    if (w === W && h === H && canvas.width === Math.round(w * dpr)) return;
    W = w; H = h; canvas.style.width = w + "px"; canvas.style.height = h + "px";
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function resize() {
    dpr = window.devicePixelRatio || 1;
    viewW = scroller.clientWidth; viewH = scroller.clientHeight;
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
        if (d.source === "gap") return [NOT_REMOVED, NEVER];
        if (d.source === "bottom-up") return [REMOVED, d.ttCat];
        if (d.removal == null) return [NOT_REMOVED, "Removal not reported"];
        return d.removal >= state.threshold ? [REMOVED, d.ttCat] : [NOT_REMOVED, `Removed less than ${state.threshold}%`];
      }
      default: return ["All"];
    }
  }
  const REMOVED = "Removed reliably", NOT_REMOVED = "Not reliably removed", NEVER = "Never measured";
  // groups and clusters that stand for missing treatment get a dashed outline
  const DASHED = new Set([NOT_REMOVED, NEVER, "Not measured"]);
  // views laid out as group slots; Scale's groups are single clusters, so they get a title and no callouts
  const SLOT_VIEWS = new Set(["pollutant", "treatment", "coverage", "scale"]);
  const SLOT_TITLE_H = 28;

  let leaves = new Map();   // leafKey -> {x, y, R, label, parentKey, text}
  let parents = new Map();  // parentKey -> {label, x, y, R, top, colL, colR, bottom, left, right}
  let matrix = null;

  // ------------------------------------------------------------ callout labels
  const LABEL = { size: 12, line: 14, maxW: 150, padX: 4, padY: 2, gap: 3, lead: 22 };
  const font = (w, s) => `${w} ${s}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  const boxH = l => l.text.h + LABEL.padY * 2;
  const colH = col => col.reduce((t, l) => t + boxH(l) + LABEL.gap, 0);

  // wrap to at most two lines within maxW; measured bold so a highlighted label still fits its box
  function wrapLabel(text, maxW) {
    ctx.font = font(700, LABEL.size);
    const lines = [];
    let cur = "";
    for (const word of text.split(" ")) {
      const t = cur ? cur + " " + word : word;
      if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = word; } else cur = t;
    }
    if (cur) lines.push(cur);
    if (lines.length > 2) lines.splice(1, lines.length - 1, lines.slice(1).join(" "));
    return { lines, w: Math.max(...lines.map(l => ctx.measureText(l).width)), h: lines.length * LABEL.line };
  }

  // Each group gets a slot: title on top, its circle below, a callout column on each side.
  // Slots fill rows across the field. Marks shrink until everything fits the visible height;
  // past their floor the field grows taller and scrolls instead (and wider, on screens too narrow
  // for one group and its callouts). Returns the size used.
  function layoutSlots(nodes) {
    const groups = new Map();
    nodes.forEach(d => {
      const path = pathFor(d), solo = path.length === 1, gk = "/" + path[0], lk = gk + "/" + (solo ? "" : path[1]);
      d.path = path; d.leaf = lk;
      let g = groups.get(gk); if (!g) groups.set(gk, g = { key: gk, label: path[0], leaves: new Map(), value: 0 });
      let l = g.leaves.get(lk); if (!l) g.leaves.set(lk, l = { key: lk, label: solo ? path[0] : path[1], solo, value: 0 });
      const v = (d.base + 1) ** 2 * 1.3; l.value += v; g.value += v;
    });
    const gs = [...groups.values()].sort((a, b) => b.value - a.value);
    gs.forEach(g => {
      g.list = [...g.leaves.values()].sort((a, b) => b.value - a.value);
      g.list.forEach(l => { l.text = wrapLabel(l.label, LABEL.maxW); });
    });

    const pad = 24, gutter = 16, rowGap = 18, titleH = SLOT_TITLE_H;
    const avail = viewW - pad * 2;
    function build(s) {
      gs.forEach(g => {
        const circ = g.list.map(l => ({ l, r: s * Math.sqrt(l.value) + 8 }));
        d3.packSiblings(circ);
        const e = d3.packEnclose(circ);
        circ.forEach(c => { c.l.dx = c.x - e.x; c.l.dy = c.y - e.y; c.l.R = c.r - 8; });
        g.R = e.r + 12;
        // callouts go on the side their cluster sits on, then the columns are evened out
        const left = [], right = [];
        g.list.forEach(l => { if (!l.solo) (l.dx < 0 ? left : right).push(l); });
        for (;;) {
          const [big, small] = colH(left) > colH(right) ? [left, right] : [right, left];
          if (!big.length) break;
          big.sort((a, b) => Math.abs(a.dx) - Math.abs(b.dx));
          if (colH(big) - colH(small) <= boxH(big[0]) + LABEL.gap) break;
          small.push(big.shift());
        }
        const colW = col => (col.length ? Math.max(...col.map(l => l.text.w)) + LABEL.padX * 2 + LABEL.lead : 0);
        g.left = left; g.right = right; g.wL = colW(left); g.wR = colW(right);
        g.w = g.wL + 2 * g.R + g.wR + gutter;
        g.h = titleH + Math.max(2 * g.R, colH(left), colH(right));
      });
      const rows = [];
      let row = null;
      gs.forEach(g => {
        if (!row || row.w + g.w > avail) rows.push(row = { gs: [], w: 0, h: 0 });
        row.gs.push(g); row.w += g.w; row.h = Math.max(row.h, g.h);
      });
      const total = pad * 2 + rows.reduce((t, r) => t + r.h, 0) + rowGap * (rows.length - 1);
      return { rows, total, fits: total <= viewH && rows.every(r => r.w <= avail) };
    }

    // largest mark scale that fits; if even the floor does not fit, use the floor and scroll
    const sMin = 0.3, sMax = 1.35;
    let s = sMin;
    if (build(sMax).fits) s = sMax;
    else if (build(sMin).fits) {
      let lo = sMin, hi = sMax;
      for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (build(m).fits) lo = m; else hi = m; }
      s = lo;
    }
    const { rows, total } = build(s);
    nodes.forEach(d => { d.r = d.base * s; });

    const width = Math.max(viewW, Math.ceil(Math.max(...rows.map(r => r.w)) + pad * 2));
    let y = pad;
    rows.forEach(r => {
      let x = pad + Math.max(0, (width - pad * 2 - r.w) / 2);
      r.gs.forEach(g => {
        const cx = x + gutter / 2 + g.wL + g.R, cy = y + titleH + g.R;
        parents.set(g.key, { label: g.label, x: cx, y: cy, R: g.R, top: y, bottom: y + g.h,
          colL: cx - g.R - LABEL.lead, colR: cx + g.R + LABEL.lead,
          left: g.left.map(l => l.key), right: g.right.map(l => l.key) });
        g.list.forEach(l => leaves.set(l.key, { x: cx + l.dx, y: cy + l.dy, R: l.R, label: l.label, text: l.text, solo: l.solo, parentKey: g.key }));
        x += g.w;
      });
      y += r.h + rowGap;
    });
    return { width, height: Math.max(viewH, Math.ceil(total)) };
  }

  function layout(alpha = 0.9) {
    const nodes = visible();
    leaves = new Map(); parents = new Map(); matrix = null;
    const pad = 36;

    if (SLOT_VIEWS.has(state.view)) {
      const { width, height } = layoutSlots(nodes);
      sizeCanvas(width, height);
    } else if (state.view === "matrix") {
      sizeCanvas(viewW, viewH);
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
      sizeCanvas(viewW, viewH);
      const R = Math.min(W, H) / 2 - pad;
      const need = Math.sqrt(nodes.reduce((s, d) => s + (d.base + 1) ** 2, 0) * 1.3);
      const rs = Math.max(0.35, Math.min(1.25, R / need));
      nodes.forEach(d => { d.r = d.base * rs; d.leaf = "All"; });
      leaves.set("All", { x: W / 2, y: H / 2, R: R });
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

    // group circles: outlines only, so the marks carry all the color.
    // Groups are a little darker than their clusters; missing treatment is dashed.
    const leafHulls = new Map();
    if (state.view !== "float" && state.view !== "matrix") {
      leaves.forEach((L, key) => { const h = hullOf(key); if (h) leafHulls.set(key, h); });
      parents.forEach((P, key) => {
        const kids = [...leafHulls.entries()].filter(([k]) => leaves.get(k).parentKey === key).map(([, h]) => h);
        if (!kids.length) { P.hull = null; return; }
        const e = d3.packEnclose(kids.map(h => ({ x: h.x, y: h.y, r: h.r })));
        P.hull = { x: e.x, y: e.y, r: e.r + 12 };
        ring(P.hull, C.muted, 0.55, DASHED.has(P.label));
      });
      leafHulls.forEach((h, key) => {
        const L = leaves.get(key);
        if (!L.solo) ring(h, C.rule, 1, DASHED.has(L.label));
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

    // labels on top of everything
    if (SLOT_VIEWS.has(state.view)) drawCallouts(leafHulls, focus);
  }

  function ring(h, color, alpha, dashed) {
    ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
    ctx.setLineDash(dashed ? [5, 5] : []);
    ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = 1; ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  // Every cluster gets a label in its group's left or right column, stacked so none overlap,
  // with a leader line to the cluster's edge. Leaders are drawn first, then the label boxes over them.
  function drawCallouts(leafHulls, focus) {
    const placed = [];
    parents.forEach(P => {
      [["left", P.colL], ["right", P.colR]].forEach(([side, ax]) => {
        const items = P[side].map(k => ({ key: k, L: leaves.get(k), h: leafHulls.get(k) })).filter(it => it.h);
        items.forEach(it => { it.bh = boxH(it.L); it.want = it.L.y - it.bh / 2; });
        items.sort((a, b) => a.want - b.want);
        let cur = P.top + SLOT_TITLE_H;
        items.forEach(it => { it.y0 = Math.max(it.want, cur); cur = it.y0 + it.bh + LABEL.gap; });
        let lim = P.bottom;
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i];
          if (it.y0 + it.bh > lim) it.y0 = lim - it.bh;
          lim = it.y0 - LABEL.gap;
        }
        items.forEach(it => { it.side = side; it.ax = ax; it.ay = it.y0 + it.bh / 2; placed.push(it); });
      });
    });

    ctx.strokeStyle = C.muted; ctx.lineWidth = 0.75; ctx.globalAlpha = 0.8;
    placed.forEach(it => {
      const { h } = it, dx = it.ax - h.x, dy = it.ay - h.y, dist = Math.hypot(dx, dy) || 1;
      ctx.beginPath(); ctx.moveTo(it.ax, it.ay); ctx.lineTo(h.x + (dx / dist) * h.r, h.y + (dy / dist) * h.r); ctx.stroke();
    });
    ctx.globalAlpha = 1;

    placed.forEach(it => {
      const { lines, w } = it.L.text, bw = w + LABEL.padX * 2;
      const x0 = it.side === "left" ? it.ax - bw : it.ax;
      ctx.fillStyle = C.bg; ctx.fillRect(x0, it.y0, bw, it.bh);
      const hot = focus && focus.leaf === it.key;
      ctx.font = font(hot ? 700 : 500, LABEL.size); ctx.fillStyle = hot ? C.ink : C.muted;
      ctx.textBaseline = "top"; ctx.textAlign = it.side === "left" ? "right" : "left";
      const tx = it.side === "left" ? it.ax - LABEL.padX : it.ax + LABEL.padX;
      lines.forEach((ln, i) => ctx.fillText(ln, tx, it.y0 + LABEL.padY + i * LABEL.line + 1));
    });

    // group titles above their circles, clear of the callout columns
    parents.forEach(P => { if (P.hull) label(P.label, P.x, P.top + SLOT_TITLE_H - 8, 15, 700, C.ink); });
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
      status.textContent = `${pols.size - ok.size} of ${pols.size} measured pollutants have no technology that removes ${state.threshold}% or more` +
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
      b.addEventListener("click", () => { state.view = v.key; scroller.scrollTo(0, 0); buildControls(); layout(); });
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
  const pct = v => (v == null ? "removal not reported" : `${Math.round(v)}% median removal`);

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
  new ResizeObserver(resize).observe(scroller);
})();
