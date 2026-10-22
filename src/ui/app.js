"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];
const DAYMS = 86400000;
const fmtT = (t) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
const dstr = (t) => new Date(t).toISOString().slice(0, 10);
const dms = (s) => Date.parse(s + "T00:00:00Z");
const fmtN = (n) => { if (!Number.isFinite(n)) return "–"; const a = Math.abs(n); return a >= 1e6 ? (n / 1e6).toFixed(2) + "M" : a >= 1e4 ? (n / 1e3).toFixed(1) + "k" : a >= 100 ? n.toFixed(0) : n.toFixed(2); };

/* ---------- umbrales (editables, guardados en el navegador) ---------- */
const RKEY = "analizador-csv.umbrales.v1";
const cloneRules = () => JSON.parse(JSON.stringify(DEFAULT_RULES));
function loadRules() {
  try {
    const saved = JSON.parse(localStorage.getItem(RKEY));
    if (Array.isArray(saved)) return cloneRules().map((r) => Object.assign(r, saved.find((x) => x.id === r.id) || {}, { pat: r.pat, name: r.name, ideal: r.ideal, relation: r.relation }));
  } catch (e) { /* sin almacenamiento: se usan los valores de la tabla */ }
  return cloneRules();
}
const saveRules = () => { try { localStorage.setItem(RKEY, JSON.stringify(S.rules)); } catch (e) { /* ignorar */ } };

const S = { files: [], sel: [], tab: "explore", xr: null, hl: null, nid: 1, q: "", msgs: [], cmp: {}, fmt: "png", rules: loadRules(), sev: "all", sort: "date", lim: {}, rows: [] };
const F = (id) => S.files.find((f) => f.id === +id);
const SER = (e) => F(e.fid)?.d.series.find((s) => s.id === e.sid);
/** Servidor (e instancia SQL con nombre) al que pertenece un archivo. */
function origin(f) {
  const s = f.d.series.find((x) => x.perfmon && x.perfmon.sqlInstance);
  const inst = s && s.perfmon.sqlInstance !== "(default)" ? s.perfmon.sqlInstance : "";
  const h = f.d.host || String(Object.values(f.d.tags)[0] || "").replace(/^[\s;]+/, "") || f.name;
  return inst ? `${h}\\${inst}` : h;
}
const zonesFor = (keys) => { const rs = keys.map((k) => ruleFor(k, S.rules)), r = rs[0]; return r && r.dir !== "none" && rs.every((x) => x === r) ? r : null; };
const toast = (m) => { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3200); };

/* ---------- carga de archivos ---------- */
async function addFiles(list) {
  S.msgs = [];
  for (const f of list) {
    try {
      const d = parseDataset(await f.text(), f.name);
      if (!d.time.length) throw new Error("sin filas con fecha válida");
      S.files.push({ id: S.nid++, name: f.name, d });
      d.warnings.forEach((w) => S.msgs.push(`${f.name}: ${w}`));
    } catch (e) { S.msgs.push(`${f.name}: no se pudo leer (${e.message})`); }
  }
  S.cmp = {}; render();
}

/* ---------- gráfico canvas ---------- */
const nearest = (a, x) => { let lo = 0, hi = a.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m; else hi = m; } return Math.abs(a[lo] - x) <= Math.abs(a[hi] - x) ? lo : hi; };
const gapOf = (x) => { const d = []; for (let i = 1; i < x.length && d.length < 400; i++) d.push(x[i] - x[i - 1]); d.sort((a, b) => a - b); return d.length ? d[d.length >> 1] * 12 : Infinity; };
const niceDays = (d) => [1, 2, 5, 7, 10, 14, 30].find((n) => n >= d) || 60;
const WARN = "rgba(245,158,11,0.13)", CRIT = "rgba(220,38,38,0.13)", WARN_C = "#d97706", CRIT_C = "#dc2626";
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
/** Escala con valores redondos (0, 20, 40…) en vez de límites arbitrarios. */
function niceScale(lo, hi, n = 5) {
  const raw = (hi - lo || 1) / n, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step, ticks = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(+v.toPrecision(12));
  return { lo: a, hi: b, ticks };
}

function drawChart(cv, lines, o = {}) {
  const dpr = Math.max(devicePixelRatio || 1, 2), W = cv.clientWidth;
  const st = getComputedStyle(document.documentElement), V = (n) => st.getPropertyValue(n).trim();
  const muted = V("--muted"), grid = V("--line"), ink = V("--text"), panel = V("--panel") || "#fff";
  // cabecera dentro del lienzo (título, subtítulo y leyenda): así también queda en la imagen exportada
  const mc = document.createElement("canvas").getContext("2d"); mc.font = `12px ${FONT}`;
  const leg = []; let lx = 14, ly = 0;
  for (const l of lines) { const w = mc.measureText(l.label).width + 30; if (lx > 14 && lx + w > W - 10) { lx = 14; ly += 20; } leg.push([lx, ly, l]); lx += w + 8; }
  const titleH = o.title ? (o.sub ? 42 : 26) : 0, legH = lines.length ? ly + 28 : 0;
  cv.style.height = (o.h || 320) + titleH + legH + "px";
  const H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const P = { l: 52, r: 18, t: 8 + titleH + legH, b: 30 }, pw = W - P.l - P.r, ph = H - P.t - P.b;
  c.textAlign = "left";
  if (o.title) { c.fillStyle = ink; c.font = `600 14px ${FONT}`; c.fillText(o.title, 14, 24); if (o.sub) { c.fillStyle = muted; c.font = `12px ${FONT}`; c.fillText(o.sub, 14, 42); } }
  c.font = `12px ${FONT}`;
  for (const [x, y, l] of leg) { c.fillStyle = l.color; c.beginPath(); c.arc(x + 5, y + titleH + 14, 4.5, 0, Math.PI * 2); c.fill(); c.fillStyle = ink; c.fillText(l.label, x + 16, y + titleH + 18); }

  // rango X
  let x0 = Infinity, x1 = -Infinity;
  for (const l of lines) if (l.x.length) { x0 = Math.min(x0, l.x[0]); x1 = Math.max(x1, l.x[l.x.length - 1]); }
  if (o.xr) [x0, x1] = o.xr;
  if (!(x1 > x0)) { x0 = 0; x1 = 1; }
  // rango Y con escala redonda; los porcentajes no pasan de 100
  const z = o.zones || null, pct = lines.length > 0 && lines.every((l) => l.unit === "%");
  let gl = Infinity, gh = -Infinity;
  for (const l of lines) for (let i = 0; i < l.x.length; i++) { const v = l.y[i]; if (l.x[i] < x0 || l.x[i] > x1) continue; if (v < gl) gl = v; if (v > gh) gh = v; }
  if (z) { const mg = Math.abs(z.crit - z.warn); gl = Math.min(gl, z.warn, z.crit - (z.dir === "gt" ? mg : 0)); gh = Math.max(gh, z.warn, z.crit + (z.dir === "lt" ? mg : 0)); }
  if (!Number.isFinite(gl)) { gl = 0; gh = 1; }
  if (gl >= 0 && gl < gh * 0.35) gl = 0;
  if (gh <= gl) gh = gl + 1;
  let sc = niceScale(gl, gh + (gh - gl) * 0.04);
  if (pct && sc.hi > 100) sc = { lo: sc.lo, hi: 100, ticks: sc.ticks.filter((v) => v < 100).concat(100) };
  const G = [sc.lo, sc.hi];
  const X = (x) => P.l + ((x - x0) / (x1 - x0)) * pw;
  const Y = (v) => P.t + ph - ((v - G[0]) / (G[1] - G[0])) * ph;
  const tk = (v) => { const a = Math.abs(v), t = a >= 1e6 ? +(v / 1e6).toFixed(2) + "M" : a >= 1e4 ? +(v / 1e3).toFixed(1) + "k" : String(+v.toFixed(2)); return pct ? t + "%" : t; };

  // eje Y: líneas guía punteadas y valores redondos
  c.font = `11px ${FONT}`; c.lineWidth = 1;
  for (const v of sc.ticks) {
    const y = Y(v);
    c.strokeStyle = grid; c.setLineDash([3, 4]); c.beginPath(); c.moveTo(P.l, y); c.lineTo(W - P.r, y); c.stroke(); c.setLineDash([]);
    c.fillStyle = muted; c.textAlign = "right"; c.fillText(tk(v), P.l - 8, y + 4);
  }
  // eje X dinámico: escala según la duración del periodo
  const span = x1 - x0, ticks = [];
  if (o.rel && span > 3 * DAYMS) { const step = niceDays(span / DAYMS / Math.max(2, Math.floor(pw / 90))) * DAYMS; for (let t = Math.ceil(x0 / step) * step; t <= x1; t += step) ticks.push(t); }
  else { const nt = Math.max(2, Math.floor(pw / 120)); for (let k = 0; k <= nt; k++) ticks.push(x0 + (span * k) / nt); }
  const fmt = (x) => o.hour ? Math.round(x) + " h" : o.rel ? (span > 3 * DAYMS ? "Día " + Math.round(x / DAYMS) : (x / 3600000).toFixed(0) + " h") : span < 2 * DAYMS ? fmtT(x).slice(11) : span < 20 * DAYMS ? fmtT(x).slice(5) : fmtT(x).slice(0, 10);
  c.strokeStyle = grid; c.beginPath(); c.moveTo(P.l, P.t + ph + 0.5); c.lineTo(W - P.r, P.t + ph + 0.5); c.stroke();
  for (const t of ticks) {
    const px = X(t);
    c.strokeStyle = grid; c.beginPath(); c.moveTo(px, P.t + ph); c.lineTo(px, P.t + ph + 4); c.stroke();
    c.fillStyle = muted; c.textAlign = px < P.l + 24 ? "left" : px > W - P.r - 24 ? "right" : "center"; c.fillText(fmt(t), px, H - 10);
  }
  // franjas Warning / Critical
  if (z) {
    const yv = (v) => Math.max(P.t, Math.min(P.t + ph, Y(v)));
    const band = (a, b, col, txt, tc) => {
      const ya = yv(a), yb = yv(b), top = Math.min(ya, yb), h = Math.abs(ya - yb);
      if (h < 1) return;
      c.fillStyle = col; c.fillRect(P.l, top, pw, h);
      if (h >= 17) { c.fillStyle = tc; c.font = `600 11px ${FONT}`; c.textAlign = "right"; c.fillText(txt, W - P.r - 8, top + 14); }
    };
    const op = z.dir === "lt" ? ">" : "<";
    band(z.warn, z.crit, WARN, `Warning Zone ${op} ${z.warn}`, V("--warn-ink"));
    band(z.crit, z.dir === "lt" ? G[1] : G[0], CRIT, `Critical Zone ${op} ${z.crit}`, V("--crit-ink"));
    c.lineWidth = 1; c.setLineDash([5, 4]);
    for (const [v, col] of [[z.warn, WARN_C], [z.crit, CRIT_C]]) { const y = Y(v); if (y >= P.t && y <= P.t + ph) { c.strokeStyle = col; c.globalAlpha = 0.8; c.beginPath(); c.moveTo(P.l, y); c.lineTo(W - P.r, y); c.stroke(); c.globalAlpha = 1; } }
    c.setLineDash([]);
  }
  // evento resaltado (franja vertical sobre el periodo de la alerta)
  if (o.hl && X(o.hl.end) >= P.l && X(o.hl.start) <= P.l + pw) {
    const a = Math.max(P.l, X(o.hl.start)), b = Math.min(P.l + pw, X(o.hl.end)), w = Math.max(6, b - a), x = Math.min(a, P.l + pw - w);
    c.fillStyle = "rgba(128,128,128,0.2)"; c.fillRect(x, P.t, w, ph);
    c.strokeStyle = ink; c.globalAlpha = 0.55; c.lineWidth = 1; c.setLineDash([3, 3]); c.strokeRect(x + 0.5, P.t + 0.5, w - 1, ph - 1); c.setLineDash([]); c.globalAlpha = 1;
  }
  // líneas continuas con relleno degradado; los huecos largos sin datos se unen con trazo punteado
  c.save(); c.beginPath(); c.rect(P.l, P.t - 2, pw, ph + 4); c.clip();
  lines.forEach((l) => {
    const gap = gapOf(l.x), segs = [], links = []; let cur = [], prev = -1, pp = null;
    for (let j = 0; j < l.x.length; j++) {
      const v = l.y[j]; if (Number.isNaN(v)) continue;
      const pt = [X(l.x[j]), Y(v)];
      if (prev >= 0 && l.x[j] - l.x[prev] > gap) { links.push([pp, pt]); segs.push(cur); cur = []; }
      cur.push(pt); prev = j; pp = pt;
    }
    if (cur.length) segs.push(cur);
    if (lines.length <= 2) {
      const g = c.createLinearGradient(0, P.t, 0, P.t + ph); g.addColorStop(0, l.color + "30"); g.addColorStop(1, l.color + "03"); c.fillStyle = g;
      for (const sg of segs) if (sg.length > 1) { c.beginPath(); c.moveTo(sg[0][0], P.t + ph); for (const [x, y] of sg) c.lineTo(x, y); c.lineTo(sg[sg.length - 1][0], P.t + ph); c.closePath(); c.fill(); }
    }
    c.strokeStyle = l.color; c.lineWidth = 1.7; c.lineJoin = "round"; c.lineCap = "round"; c.setLineDash([]);
    for (const sg of segs) {
      if (sg.length === 1) { c.fillStyle = l.color; c.beginPath(); c.arc(sg[0][0], sg[0][1], 1.8, 0, Math.PI * 2); c.fill(); continue; }
      c.beginPath(); sg.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke();
    }
    c.globalAlpha = 0.45; c.lineWidth = 1.2; c.setLineDash([2, 4]);
    for (const [p1, p2] of links) { c.beginPath(); c.moveTo(p1[0], p1[1]); c.lineTo(p2[0], p2[1]); c.stroke(); }
    c.globalAlpha = 1; c.setLineDash([]);
  });
  c.restore();
  if (o.hl && o.hl.peak && o.hl.peak.x >= x0 && o.hl.peak.x <= x1) {
    const px = X(o.hl.peak.x), py = Y(o.hl.peak.y);
    c.fillStyle = o.hl.peak.color; c.strokeStyle = panel; c.lineWidth = 2.5; c.beginPath(); c.arc(px, py, 6, 0, Math.PI * 2); c.stroke(); c.fill();
  }
  cv._img = c.getImageData(0, 0, cv.width, cv.height);
  cv._g = { x0, x1, P, pw, ph, W, lines, o, X, Y, dpr, panel };
}

function bind(cv, onZoom) {
  const box = cv.parentNode, tip = box.querySelector(".tip"), selb = box.querySelector(".sel");
  let d0 = null;
  const px = (e) => e.clientX - cv.getBoundingClientRect().left;
  const xAt = (p) => { const g = cv._g; return g.x0 + ((p - g.P.l) / g.pw) * (g.x1 - g.x0); };
  const redraw = () => { const g = cv._g, c = cv.getContext("2d"); c.setTransform(1, 0, 0, 1, 0, 0); c.putImageData(cv._img, 0, 0); c.setTransform(g.dpr, 0, 0, g.dpr, 0, 0); return c; };
  cv.onmousedown = (e) => { d0 = px(e); };
  cv.onmousemove = (e) => {
    const g = cv._g, p = px(e), c = redraw();
    if (p < g.P.l || p > g.W - g.P.r) { tip.hidden = true; return; }
    // cruz de lectura y puntos sobre cada línea
    c.strokeStyle = "rgba(128,128,128,0.75)"; c.lineWidth = 1; c.setLineDash([4, 3]); c.beginPath(); c.moveTo(p, g.P.t); c.lineTo(p, g.P.t + g.ph); c.stroke(); c.setLineDash([]);
    const x = xAt(p);
    const rows = g.lines.map((l) => {
      const i = nearest(l.x, x), v = l.y[i];
      if (Number.isFinite(v)) { c.fillStyle = l.color; c.strokeStyle = g.panel; c.lineWidth = 2; c.beginPath(); c.arc(g.X(l.x[i]), g.Y(v), 4.5, 0, Math.PI * 2); c.stroke(); c.fill(); }
      return `<div><i style="background:${l.color}"></i>${esc(l.label)}: <b>${fmtN(v)}</b>${l.t0 !== undefined ? ` <small>${fmtT(l.t0 + l.x[i])}</small>` : ""}</div>`;
    });
    if (d0 !== null) { selb.hidden = false; selb.style.left = Math.min(d0, p) + 6 + "px"; selb.style.width = Math.abs(p - d0) + "px"; }
    const head = g.o.hour ? Math.round(x) + " h" : g.o.rel ? "Día " + (x / DAYMS).toFixed(1) : fmtT(x);
    tip.innerHTML = `<small>${head}</small>` + rows.join("");
    tip.hidden = false; tip.style.left = (p > g.W / 2 ? p - tip.offsetWidth - 6 : p + 18) + "px";
  };
  cv.onmouseup = (e) => { const p = px(e); selb.hidden = true; if (d0 !== null && Math.abs(p - d0) > 8) onZoom([xAt(Math.min(d0, p)), xAt(Math.max(d0, p))]); d0 = null; };
  cv.onmouseleave = () => { tip.hidden = true; selb.hidden = true; d0 = null; redraw(); };
  cv.ondblclick = () => onZoom(null);
}
const chartInto = (id, lines, o, z) => { const cv = $("#" + id); drawChart(cv, lines, o); bind(cv, z || (() => {})); };
const cw = (id) => `<div class="cw"><canvas id="${id}"></canvas><div class="tip" hidden></div><div class="sel" hidden></div></div>`;
const expBar = () => `<span class="exp"><select data-fmt title="Formato de imagen"><option value="png" ${S.fmt === "png" ? "selected" : ""}>PNG</option><option value="jpeg" ${S.fmt === "jpeg" ? "selected" : ""}>JPEG</option></select><button data-exp="dl">Descargar gráfico</button><button data-exp="cp">Copiar al portapapeles</button></span>`;

/* ---------- exportar gráfico ---------- */
async function exportChart(mode) {
  const cvs = [...document.querySelectorAll("#main .cw canvas")];
  if (!cvs.length) return;
  const out = document.createElement("canvas"); out.width = Math.max(...cvs.map((x) => x.width)); out.height = cvs.reduce((a, x) => a + x.height, 0);
  const c = out.getContext("2d");
  c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--panel").trim() || "#fff";
  c.fillRect(0, 0, out.width, out.height);
  let oy = 0; for (const x of cvs) { c.drawImage(x, 0, oy); oy += x.height; }
  const jpeg = S.fmt === "jpeg", toBlob = (type) => new Promise((r) => out.toBlob(r, type, 0.92));
  const name = `grafico-${new Date().toISOString().slice(0, 10)}.${jpeg ? "jpg" : "png"}`;
  try {
    if (mode === "cp") {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": await toBlob("image/png") })]);
      toast("Gráfico copiado al portapapeles.");
    } else {
      const blob = await toBlob(jpeg ? "image/jpeg" : "image/png");
      const dl = window.claude && (await window.claude.use("downloads"));
      if (dl) { await dl.save({ filename: name, data: blob }); toast("Gráfico guardado."); }
      else { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
    }
  } catch (e) {
    toast(e && e.code === "declined" ? "Descarga cancelada." : mode === "cp" ? "El navegador no permitió copiar. Usa “Descargar gráfico”." : "No se pudo guardar el gráfico.");
  }
}

/* ---------- barra lateral ---------- */
function renderSide() {
  const files = S.files.map((f) => `<div class="file"><div><b>${esc(f.name)}</b><small>${esc(origin(f))} · ${f.d.time.length} filas · ${dstr(f.d.time[0])} → ${dstr(f.d.time[f.d.time.length - 1])}</small></div><button class="x" data-act="rm" data-id="${f.id}" title="Quitar">✕</button></div>`).join("");
  $("#side").innerHTML = `<label class="drop">Arrastra tus CSV aquí<br><span>o haz clic para elegirlos</span><input type="file" id="fi" multiple accept=".csv,.tsv,.txt" hidden></label>${S.msgs.map((m) => `<p class="warn">${esc(m)}</p>`).join("")}${files}${S.files.length ? `<input id="q" placeholder="Buscar serie…" value="${esc(S.q)}"><div id="slist"></div>` : ""}`;
  seriesList();
}
function seriesList() {
  if (!$("#slist")) return;
  const q = S.q.toLowerCase();
  $("#slist").innerHTML = S.files.map((f) => {
    const items = f.d.series.filter((s) => s.label.toLowerCase().includes(q)).map((s) => `<label class="si"><input type="checkbox" data-s="${f.id}:${s.id}" ${S.sel.some((e) => e.fid === f.id && e.sid === s.id) ? "checked" : ""}> ${esc(s.label)}</label>`).join("");
    return items ? `<details open><summary>${esc(origin(f))} <small>${f.d.series.length} series</small></summary>${items}</details>` : "";
  }).join("");
}

/* ---------- vista Explorar ---------- */
const fmtDur = (ms) => { if (ms <= 0) return "1 muestra"; const m = Math.round(ms / 60000); if (m < 60) return m + " min"; const h = Math.floor(m / 60); if (h < 48) return h + " h" + (m % 60 ? " " + (m % 60) + " min" : ""); return Math.round(h / 24) + " d"; };
const hlFor = (g) => { const h = S.hl; if (!h) return null; const x = g.find((q) => q.e.fid === h.fid && q.e.sid === h.sid); return { start: h.start, end: h.end, peak: x ? { x: h.peakAt, y: h.peak, color: x.color } : null }; };
const labelsFor = (g) => { const cnt = {}; g.forEach((x) => { const k = origin(x.f); cnt[k] = (cnt[k] || 0) + 1; }); return g.map((x) => (cnt[origin(x.f)] > 1 ? `${origin(x.f)} (${x.f.name})` : origin(x.f))); };

/** Alertas del contador de un gráfico: se listan justo debajo de él. */
function alertsHtml(g, cvId) {
  const r = ruleFor(keyOf(g[0].s), S.rules);
  if (!r || r.dir === "none" || r.relation) return `<p class="muted nr">Sin umbral para este contador${r ? " (" + esc(r.ideal) + ")" : ""}: no genera alertas.</p>`;
  const key = keyOf(g[0].s);
  const all = g.flatMap((x) => findAlerts(x.f.d.time, x.s.values, r, x.f.d.quality.medianStepMs * 12 || Infinity).map((a) => ({ f: x.f, s: x.s, r, a, cv: cvId })));
  if (!all.length) return `<p class="ok nr">✓ Sin alertas: ${esc(r.name)} se mantuvo dentro del rango ideal (${esc(r.ideal)}).</p>`;
  const nC = all.filter((x) => x.a.severity === "critical").length, nW = all.length - nC;
  const rows = all.filter((x) => S.sev === "all" || x.a.severity === S.sev);
  rows.sort(S.sort === "sev" ? (p, q) => (q.a.severity === "critical") - (p.a.severity === "critical") || p.a.start - q.a.start : (p, q) => p.a.start - q.a.start);
  const lim = S.lim[key] || 10, shown = rows.slice(0, lim), base = S.rows.length;
  S.rows.push(...shown);
  const o = (v, t, cur) => `<option value="${v}" ${cur === v ? "selected" : ""}>${t}</option>`;
  const multiSrv = new Set(shown.map((x) => origin(x.f))).size > 1;
  const prob = (sev) => `${esc(r.name)} ${r.dir === "lt" ? "&gt;" : "&lt;"} ${sev === "critical" ? r.crit : r.warn}`;
  const head = `<div class="ah"><b>⚠ Alertas detectadas</b><small>(${all.length})</small><span class="b crit">${nC} Critical</span><span class="b warn">${nW} Warning</span><span class="exp"><select data-al="sev">${o("all", "Todas", S.sev)}${o("critical", "Critical", S.sev)}${o("warning", "Warning", S.sev)}</select><select data-al="sort">${o("date", "Por fecha", S.sort)}${o("sev", "Críticas primero", S.sort)}</select></span></div>`;
  const table = shown.length ? `<table class="al"><tr><th>Fecha / hora</th><th>Severidad</th>${multiSrv ? "<th>Servidor</th>" : ""}<th>Problema</th><th class="n">Valor pico</th><th class="n">Duración</th><th>Acción</th></tr>${shown.map((x, i) => `<tr><td>${fmtT(x.a.start)}</td><td><span class="b ${x.a.severity === "critical" ? "crit" : "warn"}">${x.a.severity === "critical" ? "CRITICAL" : "WARNING"}</span></td>${multiSrv ? `<td>${esc(origin(x.f))}</td>` : ""}<td class="p">${prob(x.a.severity)}</td><td class="n">${fmtN(x.a.peak)}</td><td class="n">${fmtDur(x.a.end - x.a.start)}</td><td><button class="go" data-act="goto" data-i="${base + i}">Ver en gráfico</button></td></tr>`).join("")}</table>${rows.length > shown.length ? `<button class="more" data-act="more" data-k="${esc(key)}">Mostrar más (${rows.length - shown.length} restantes)</button>` : ""}` : `<p class="muted nr">Ninguna alerta coincide con el filtro.</p>`;
  return head + table;
}

function renderExplore() {
  const m = $("#main");
  if (!S.files.length) { m.innerHTML = `<div class="empty">Carga uno o varios CSV para comenzar.<br>Cada archivo se interpreta solo: columna de fecha, series numéricas y etiquetas.</div>`; return; }
  const sel = S.sel.map((e, i) => ({ e, s: SER(e), f: F(e.fid), color: COLORS[i % COLORS.length] })).filter((x) => x.s);
  if (!sel.length) { m.innerHTML = `<div class="empty">Marca uno o más contadores en el panel izquierdo para ver su gráfico y sus alertas.</div>`; return; }
  const groups = new Map();
  sel.forEach((x) => { const k = keyOf(x.s); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); });
  const panels = [...groups.values()];
  S.rows = [];
  const body = panels.map((g, i) => cw("cv" + i) + alertsHtml(g, "cv" + i)).join("");
  m.innerHTML = `<div class="bar"><button data-act="rz">Restablecer zoom</button>${S.hl ? `<button data-act="hl-clear">Quitar resaltado</button>` : ""}${expBar()}<small>Un gráfico por contador; los servidores del mismo contador se superponen · arrastra para acercar · doble clic para volver</small></div>${body}
  <table><tr><th>Serie</th><th>Servidor</th><th>Mín</th><th>Prom</th><th>P95</th><th>Máx</th><th>Desv</th><th>Sin dato</th><th>% Warning</th><th>% Critical</th></tr>${sel.map(({ s, f, color }) => {
    const r = ruleFor(keyOf(s), S.rules), cp = r && r.dir !== "none" ? compliance(s.values, r) : null;
    return `<tr><td><i style="background:${color}"></i>${esc(s.label)}</td><td>${esc(origin(f))}</td><td>${fmtN(s.min)}</td><td>${fmtN(s.mean)}</td><td>${fmtN(s.p95)}</td><td>${fmtN(s.max)}</td><td>${fmtN(s.std)}</td><td>${s.missing}</td><td>${cp ? cp.warningPct.toFixed(1) + " %" : "–"}</td><td>${cp ? cp.criticalPct.toFixed(1) + " %" : "–"}</td></tr>`;
  }).join("")}</table>`;
  panels.forEach((g, i) => {
    const r = ruleFor(keyOf(g[0].s), S.rules), L = labelsFor(g);
    chartInto("cv" + i, g.map(({ s, f, color }, k) => ({ x: f.d.time, y: s.values, color, unit: s.unit, label: L[k] })), { h: panels.length > 1 ? 250 : 300, xr: S.xr, zones: zonesFor([keyOf(g[0].s)]), hl: hlFor(g), title: g[0].s.label, sub: r && r.dir !== "none" && !r.relation ? "Valor ideal: " + r.ideal : "" }, (z) => { S.xr = z; renderExplore(); });
  });
}

/* ---------- vista Comparar ---------- */
function cmpInit() {
  const c = S.cmp;
  if (c.a && F(c.a.fid) && F(c.b.fid)) return;
  const f1 = S.files[0], f2 = S.files[1] || f1, rg = (f) => [dstr(f.d.time[0]), dstr(f.d.time[f.d.time.length - 1])];
  if (f1 === f2) { const [s, e] = rg(f1), mid = dstr((dms(s) + dms(e)) / 2); c.a = { fid: f1.id, from: s, to: mid }; c.b = { fid: f1.id, from: dstr(dms(mid) + DAYMS), to: e }; }
  else { c.a = { fid: f1.id, from: rg(f1)[0], to: rg(f1)[1] }; c.b = { fid: f2.id, from: rg(f2)[0], to: rg(f2)[1] }; }
  c.key = ""; c.mode = "overlay";
}
function renderCompare() {
  const m = $("#main");
  if (!S.files.length) { m.innerHTML = `<div class="empty">Carga al menos un CSV para comparar periodos.</div>`; return; }
  cmpInit();
  const c = S.cmp, sl = (p) => sliceDataset(F(p.fid).d, dms(p.from), dms(p.to) + DAYMS);
  const A = sl(c.a), B = sl(c.b), ka = new Set(A.series.map(keyOf)), common = B.series.filter((s) => ka.has(keyOf(s)));
  if (!common.some((s) => keyOf(s) === c.key)) c.key = common[0] ? keyOf(common[0]) : "";
  const fopt = (id) => S.files.map((f) => `<option value="${f.id}" ${f.id === id ? "selected" : ""}>${esc(f.name)}</option>`).join("");
  const side = (n, p) => `<div class="box"><h3>Periodo ${n.toUpperCase()}</h3><select data-c="${n}.fid">${fopt(p.fid)}</select><div class="row"><input type="date" data-c="${n}.from" value="${p.from}"><input type="date" data-c="${n}.to" value="${p.to}"></div></div>`;
  const head = `<div class="grid2">${side("a", c.a)}${side("b", c.b)}</div><div class="bar"><label>Métrica <select data-c="key">${common.map((s) => `<option value="${esc(keyOf(s))}" ${keyOf(s) === c.key ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></label><label>Eje X <select data-c="mode"><option value="overlay" ${c.mode === "overlay" ? "selected" : ""}>Superpuesto (días desde el inicio de cada periodo)</option><option value="calendar" ${c.mode === "calendar" ? "selected" : ""}>Calendario real</option></select></label></div>`;
  const cmp = c.key && A.time.length && B.time.length ? comparePeriods(A, B, c.key) : null;
  if (!cmp) { m.innerHTML = head + `<div class="empty">No hay datos comparables: revisa las fechas o que ambos periodos compartan al menos una métrica.</div>`; return; }
  const sa = A.series.find((s) => keyOf(s) === c.key), sb = B.series.find((s) => keyOf(s) === c.key), unit = sa.unit, zr = zonesFor([c.key]);
  const row = (n, k) => { const d = cmp.deltaPct[k]; return `<tr><td>${n}</td><td>${fmtN(cmp.prev[k])}</td><td>${fmtN(cmp.curr[k])}</td><td class="${d > 0 ? "up" : "dn"}">${Number.isFinite(d) ? (d > 0 ? "+" : "") + d.toFixed(1) + " %" : "–"}</td></tr>`; };
  m.innerHTML = head + `<table><tr><th>${esc(sa.label)} ${esc(unit)}</th><th>A</th><th>B</th><th>Cambio B vs A</th></tr>${row("Promedio", "mean")}${row("P95", "p95")}${row("Máximo", "max")}</table>
  <h3 class="t">Superposición de periodos ${expBar()}</h3>${cw("cv0")}`;
  const rel = c.mode === "overlay";
  const mk = (n, slc, s, p, color) => { const t0 = dms(p.from); return { x: rel ? Float64Array.from(slc.time, (t) => t - t0) : slc.time, y: s.values, color, unit: s.unit, t0: rel ? t0 : undefined, label: `Periodo ${n} · ${origin(F(p.fid))} (${p.from} → ${p.to})` }; };
  const spanA = dms(c.a.to) + DAYMS - dms(c.a.from), spanB = dms(c.b.to) + DAYMS - dms(c.b.from);
  const xr = rel ? [0, Math.max(spanA, spanB)] : [Math.min(dms(c.a.from), dms(c.b.from)), Math.max(dms(c.a.to), dms(c.b.to)) + DAYMS];
  chartInto("cv0", [mk("A", A, sa, c.a, COLORS[0]), mk("B", B, sb, c.b, COLORS[1])], { rel, xr, zones: zr, title: sa.label, sub: zr ? "Valor ideal: " + zr.ideal : "" });
}

/* ---------- vista Umbrales ---------- */
function renderThresholds() {
  const m = $("#main"), R = S.rules;
  const dirSel = (r) => `<select data-r="${r.id}.dir">${[["lt", "Menor es mejor (<)"], ["gt", "Mayor es mejor (>)"], ["none", "Sin umbral (variable)"]].map(([v, t]) => `<option value="${v}" ${r.dir === v ? "selected" : ""}>${t}</option>`).join("")}</select>`;
  const prof = (r) => r.profile ? `<select data-r="${r.id}.profile">${Object.keys(PROFILES).map((p) => `<option ${r.profile === p ? "selected" : ""}>${p}</option>`).join("")}</select>` : "–";
  const num = (r, f) => r.relation ? "–" : `<input type="number" step="any" data-r="${r.id}.${f}" value="${r[f]}" ${r.dir === "none" ? "disabled" : ""} style="width:84px">`;
  const rows = R.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.ideal)}</td><td>${r.relation ? "Total ≤ Target" : dirSel(r)}</td><td>${num(r, "warn")}</td><td>${num(r, "crit")}</td><td>${prof(r)}</td></tr>`).join("");
  const sum = [];
  for (const f of S.files) {
    for (const r of R) {
      if (r.relation) {
        const tot = f.d.series.find((s) => /Total Server Memory/i.test(keyOf(s))), tgt = f.d.series.find((s) => /Target Server Memory/i.test(keyOf(s)));
        if (tot && tgt) sum.push(`<tr><td>${esc(origin(f))}</td><td>${esc(r.name)}</td><td>Total &gt; Target</td><td>${relationPct(tot.values, tgt.values).toFixed(1)} %</td><td>–</td></tr>`);
      } else if (r.dir !== "none") for (const s of f.d.series) if (ruleFor(keyOf(s), R) === r) { const cp = compliance(s.values, r); sum.push(`<tr><td>${esc(origin(f))}</td><td>${esc(r.name)}</td><td>${esc(s.label)}</td><td>${cp.warningPct.toFixed(1)} %</td><td>${cp.criticalPct.toFixed(1)} %</td></tr>`); }
    }
  }
  m.innerHTML = `<p class="muted" style="margin-top:0">Valores ideales según la tabla de referencia. La zona Warning empieza en el límite ideal y la zona Critical en el margen que definas: puedes modificar ambos. Los cambios se guardan en este navegador.</p>
  <table><tr><th>Contador</th><th>Valor ideal</th><th>Criterio</th><th>Warning desde</th><th>Critical desde</th><th>Perfil</th></tr>${rows}</table>
  <div class="bar"><button data-act="rules-reset">Restablecer valores de la tabla</button></div>
  <h3 class="t">Cumplimiento por archivo</h3>${sum.length ? `<table><tr><th>Servidor</th><th>Contador</th><th>Serie</th><th>% Warning</th><th>% Critical</th></tr>${sum.join("")}</table>` : `<div class="empty">Carga archivos para ver qué porcentaje del tiempo cada contador estuvo en Warning o Critical.</div>`}`;
}

/* ---------- eventos ---------- */
const syncTabs = () => document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === S.tab));
const renderMain = () => (S.tab === "explore" ? renderExplore() : S.tab === "compare" ? renderCompare() : renderThresholds());
const render = () => { renderSide(); syncTabs(); renderMain(); };

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act],[data-tab],[data-exp]");
  if (!t) return;
  if (t.dataset.tab) { S.tab = t.dataset.tab; syncTabs(); renderMain(); return; }
  if (t.dataset.exp) { exportChart(t.dataset.exp); return; }
  const a = t.dataset.act;
  if (a === "rm") { const id = +t.dataset.id; S.files = S.files.filter((f) => f.id !== id); S.sel = S.sel.filter((x) => x.fid !== id); if (S.hl && S.hl.fid === id) S.hl = null; S.cmp = {}; render(); }
  else if (a === "goto") {
    const x = S.rows[+t.dataset.i];
    if (!x) return;
    if (!S.sel.some((e) => e.fid === x.f.id && e.sid === x.s.id)) { if (S.sel.length >= COLORS.length) S.sel.shift(); S.sel.push({ fid: x.f.id, sid: x.s.id }); seriesList(); }
    const pad = Math.max((x.a.end - x.a.start) * 0.5, 12 * 3600000, 20 * (x.f.d.quality.medianStepMs || 0));
    S.xr = [x.a.start - pad, x.a.end + pad]; S.hl = { fid: x.f.id, sid: x.s.id, start: x.a.start, end: x.a.end, peak: x.a.peak, peakAt: x.a.peakAt };
    renderExplore(); const first = $("#" + x.cv); if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
  } else if (a === "more") { S.lim[t.dataset.k] = (S.lim[t.dataset.k] || 10) + 20; renderExplore(); }
  else if (a === "hl-clear") { S.hl = null; renderExplore(); }
  else if (a === "rz") { S.xr = null; renderExplore(); }
  else if (a === "rules-reset") { S.rules = cloneRules(); saveRules(); renderThresholds(); }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "fi") addFiles([...t.files]);
  else if (t.dataset.fmt !== undefined) { S.fmt = t.value; document.querySelectorAll("[data-fmt]").forEach((x) => (x.value = t.value)); }
  else if (t.dataset.s) {
    const [fid, sid] = t.dataset.s.split(":"), f = +fid, i = S.sel.findIndex((x) => x.fid === f && x.sid === sid);
    if (i >= 0) S.sel.splice(i, 1); else if (S.sel.length < COLORS.length) S.sel.push({ fid: f, sid }); else { t.checked = false; return; }
    renderExplore();
  } else if (t.dataset.al) { S[t.dataset.al] = t.value; S.lim = {}; renderExplore(); }
  else if (t.dataset.r) {
    const [id, field] = t.dataset.r.split("."), r = S.rules.find((x) => x.id === id);
    if (field === "dir") r.dir = t.value;
    else if (field === "profile") { r.profile = t.value; Object.assign(r, PROFILES[t.value]); }
    else r[field] = +t.value;
    saveRules(); renderThresholds();
  } else if (t.dataset.c) {
    const p = t.dataset.c;
    if (p === "key") S.cmp.key = t.value;
    else if (p === "mode") S.cmp.mode = t.value;
    else {
      const [side, field] = p.split(".");
      if (field === "fid") { const f = F(t.value); S.cmp[side] = { fid: f.id, from: dstr(f.d.time[0]), to: dstr(f.d.time[f.d.time.length - 1]) }; }
      else if (t.value) S.cmp[side][field] = t.value;
    }
    renderCompare();
  }
});
document.addEventListener("input", (e) => { if (e.target.id === "q") { S.q = e.target.value; seriesList(); } });
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });
addEventListener("resize", () => { if (S.files.length && S.tab !== "thresholds") renderMain(); });
document.querySelectorAll("img.logo").forEach((i) => (i.src = LOGO));
render();
