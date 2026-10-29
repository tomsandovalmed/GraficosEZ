"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];
const DAYMS = 86400000;
const fmtT = (t) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
const dstr = (t) => new Date(t).toISOString().slice(0, 10);
const dms = (s) => Date.parse(s + "T00:00:00Z");
const fmtN = (n) => { if (!Number.isFinite(n)) return "–"; const a = Math.abs(n); return a >= 1e6 ? (n / 1e6).toFixed(2) + "M" : a >= 1e4 ? (n / 1e3).toFixed(1) + "k" : a >= 100 ? n.toFixed(0) : n.toFixed(2); };

/* ---------- perfiles de umbrales (guardados en el navegador; exportables a archivo) ---------- */
const PKEY = "analizador-csv.perfiles.v2";
const clone = (x) => JSON.parse(JSON.stringify(x));
const uid = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const slug = (t) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "perfil";
function loadProfiles() {
  let st = null;
  try { const x = JSON.parse(localStorage.getItem(PKEY)); if (x && Array.isArray(x.list) && x.list.length) st = x; } catch (e) { /* sin almacenamiento: perfiles de fábrica */ }
  if (!st) return { active: "sii", list: BUILTIN_PROFILES.map((p) => ({ ...clone(p), base: p.id })) };
  for (const b of BUILTIN_PROFILES) { // los perfiles de fábrica que no fueron editados se actualizan solos
    const p = st.list.find((x) => x.base === b.id);
    if (p && (p.rev || 1) < b.rev && !p.edited && !p.dirty) Object.assign(p, clone(b), { id: p.id, base: b.id, dirty: false, edited: false });
  }
  return st;
}
const activeOf = (pf) => pf.list.find((p) => p.id === pf.active) || pf.list[0];
const touch = () => { const p = activeOf(S.pf); p.dirty = true; p.edited = true; saveProfiles(); };
const saveProfiles = () => { try { localStorage.setItem(PKEY, JSON.stringify(S.pf)); } catch (e) { /* ignorar */ } };
function setActive(id) { S.pf.active = id; S.rules = activeOf(S.pf).rules; saveProfiles(); }
const uniqueName = (n) => { let k = n, i = 2; while (S.pf.list.some((p) => p.name === k)) k = `${n} (${i++})`; return k; };

const S = { files: [], sel: [], tab: "explore", xr: null, hl: null, nid: 1, q: "", msgs: [], cmp: {}, fmt: "png", pf: loadProfiles(), rules: [], sev: "all", sort: "date", lim: {}, rows: [], delArm: null, editMeta: false };
S.rules = activeOf(S.pf).rules;
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
      if (h >= 17) { c.font = `600 11px ${FONT}`; c.textAlign = "right"; c.lineWidth = 3; c.strokeStyle = panel; c.strokeText(txt, W - P.r - 8, top + 14); c.fillStyle = tc; c.fillText(txt, W - P.r - 8, top + 14); }
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
  cv.onpointerdown = (e) => { d0 = px(e); };
  cv.onpointermove = (e) => {
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
  cv.onpointerup = (e) => { const p = px(e); selb.hidden = true; if (d0 !== null && Math.abs(p - d0) > 8) onZoom([xAt(Math.min(d0, p)), xAt(Math.max(d0, p))]); d0 = null; };
  cv.onpointerleave = () => { tip.hidden = true; selb.hidden = true; d0 = null; redraw(); };
  cv.onpointercancel = cv.onpointerleave;
  cv.ondblclick = () => onZoom(null);
}
const chartInto = (id, lines, o, z) => { const cv = $("#" + id); drawChart(cv, lines, o); bind(cv, z || (() => {})); };
const cw = (id) => `<div class="cw"><canvas id="${id}"></canvas><div class="tip" hidden></div><div class="sel" hidden></div></div>`;
const expBar = () => `<span class="exp"><select data-fmt title="Formato de imagen"><option value="png" ${S.fmt === "png" ? "selected" : ""}>PNG</option><option value="jpeg" ${S.fmt === "jpeg" ? "selected" : ""}>JPEG</option></select><button data-exp="dl">Descargar gráfico</button><button data-exp="cp">Copiar al portapapeles</button></span>`;

/* ---------- guardar archivos ---------- */
async function saveBlob(blob, name) {
  const dl = window.claude && (await window.claude.use("downloads"));
  if (dl) { await dl.save({ filename: name, data: blob }); return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

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
      await saveBlob(blob, name); toast("Gráfico guardado.");
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
  if (!r || r.dir === "none" || r.relation) return `<p class="muted nr">Sin umbral para este contador${r ? " (" + esc(idealOf(r)) + ")" : ""}: no genera alertas.</p>`;
  const key = keyOf(g[0].s);
  const all = g.flatMap((x) => findAlerts(x.f.d.time, x.s.values, r, x.f.d.quality.medianStepMs * 12 || Infinity).map((a) => ({ f: x.f, s: x.s, r, a, cv: cvId })));
  if (!all.length) return `<p class="ok nr">✓ Sin alertas: ${esc(r.name)} se mantuvo dentro del rango ideal (${esc(idealOf(r))}).</p>`;
  const nC = all.filter((x) => x.a.severity === "critical").length, nW = all.length - nC;
  const rows = all.filter((x) => S.sev === "all" || x.a.severity === S.sev);
  rows.sort(S.sort === "sev" ? (p, q) => (q.a.severity === "critical") - (p.a.severity === "critical") || p.a.start - q.a.start : (p, q) => p.a.start - q.a.start);
  const lim = S.lim[key] || 10, shown = rows.slice(0, lim), base = S.rows.length;
  S.rows.push(...shown);
  const o = (v, t, cur) => `<option value="${v}" ${cur === v ? "selected" : ""}>${t}</option>`;
  const multiSrv = new Set(shown.map((x) => origin(x.f))).size > 1;
  const prob = (sev) => `${esc(r.name)} ${r.dir === "lt" ? "&gt;" : "&lt;"} ${sev === "critical" ? r.crit : r.warn}`;
  const head = `<div class="ah"><b>⚠ Alertas detectadas</b><small>(${all.length})</small><span class="b crit">${nC} Critical</span><span class="b warn">${nW} Warning</span><span class="exp"><select data-al="sev">${o("all", "Todas", S.sev)}${o("critical", "Critical", S.sev)}${o("warning", "Warning", S.sev)}</select><select data-al="sort">${o("date", "Por fecha", S.sort)}${o("sev", "Críticas primero", S.sort)}</select></span></div>`;
  const table = shown.length ? `<table class="al cards"><tr><th>Fecha / hora</th><th>Severidad</th>${multiSrv ? "<th>Servidor</th>" : ""}<th>Problema</th><th class="n">Valor pico</th><th class="n">Duración</th><th>Acción</th></tr>${shown.map((x, i) => `<tr><td>${fmtT(x.a.start)}</td><td><span class="b ${x.a.severity === "critical" ? "crit" : "warn"}">${x.a.severity === "critical" ? "CRITICAL" : "WARNING"}</span></td>${multiSrv ? `<td>${esc(origin(x.f))}</td>` : ""}<td class="p">${prob(x.a.severity)}</td><td class="n">${fmtN(x.a.peak)}</td><td class="n">${fmtDur(x.a.end - x.a.start)}</td><td><button class="go" data-act="goto" data-i="${base + i}">Ver en gráfico</button></td></tr>`).join("")}</table>${rows.length > shown.length ? `<button class="more" data-act="more" data-k="${esc(key)}">Mostrar más (${rows.length - shown.length} restantes)</button>` : ""}` : `<p class="muted nr">Ninguna alerta coincide con el filtro.</p>`;
  return head + table;
}

function renderExplore() {
  const m = $("#main");
  if (!S.files.length) { m.innerHTML = `<div class="empty">Carga uno o varios CSV para comenzar.<br>Cada archivo se interpreta solo: columna de fecha, series numéricas y etiquetas.</div>`; return; }
  const sel = S.sel.map((e, i) => ({ e, s: SER(e), f: F(e.fid), color: COLORS[i % COLORS.length] })).filter((x) => x.s);
  if (!sel.length) { m.innerHTML = `<div class="empty">Marca uno o más contadores en el panel “Archivos y series” (en pantallas pequeñas, con el botón ☰ Archivos) para ver su gráfico y sus alertas.</div>`; return; }
  const groups = new Map();
  sel.forEach((x) => { const k = keyOf(x.s); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); });
  const panels = [...groups.values()];
  S.rows = [];
  const body = panels.map((g, i) => cw("cv" + i) + alertsHtml(g, "cv" + i)).join("");
  m.innerHTML = `<div class="bar"><button data-act="rz">Restablecer zoom</button>${S.hl ? `<button data-act="hl-clear">Quitar resaltado</button>` : ""}${expBar()}<small>Un gráfico por contador; los servidores del mismo contador se superponen · arrastra para acercar · doble clic para volver · Umbrales: ${esc(activeOf(S.pf).name)}</small></div>${body}
  <table class="cards"><tr><th>Serie</th><th>Servidor</th><th>Mín</th><th>Prom</th><th>P95</th><th>Máx</th><th>Desv</th><th>Sin dato</th><th>% Warning</th><th>% Critical</th></tr>${sel.map(({ s, f, color }) => {
    const r = ruleFor(keyOf(s), S.rules), cp = r && r.dir !== "none" ? compliance(s.values, r) : null;
    return `<tr><td><i style="background:${color}"></i>${esc(s.label)}</td><td>${esc(origin(f))}</td><td>${fmtN(s.min)}</td><td>${fmtN(s.mean)}</td><td>${fmtN(s.p95)}</td><td>${fmtN(s.max)}</td><td>${fmtN(s.std)}</td><td>${s.missing}</td><td>${cp ? cp.warningPct.toFixed(1) + " %" : "–"}</td><td>${cp ? cp.criticalPct.toFixed(1) + " %" : "–"}</td></tr>`;
  }).join("")}</table>`;
  panels.forEach((g, i) => {
    const r = ruleFor(keyOf(g[0].s), S.rules), L = labelsFor(g);
    chartInto("cv" + i, g.map(({ s, f, color }, k) => ({ x: f.d.time, y: s.values, color, unit: s.unit, label: L[k] })), { h: panels.length > 1 ? 250 : 300, xr: S.xr, zones: zonesFor([keyOf(g[0].s)]), hl: hlFor(g), title: g[0].s.label, sub: r && r.dir !== "none" && !r.relation ? "Valor ideal: " + idealOf(r) : "" }, (z) => { S.xr = z; renderExplore(); });
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
  chartInto("cv0", [mk("A", A, sa, c.a, COLORS[0]), mk("B", B, sb, c.b, COLORS[1])], { rel, xr, zones: zr, title: sa.label, sub: zr ? "Valor ideal: " + idealOf(zr) : "" });
}

/* ---------- vista Umbrales ---------- */
function renderThresholds() {
  const m = $("#main"), p = activeOf(S.pf), R = p.rules, bi = BUILTIN_PROFILES.find((x) => x.id === p.base);
  const dirSel = (r) => `<select data-r="${r.id}.dir" title="Cuándo se activa la alerta">${[["lt", "Alerta si sube de (>)"], ["gt", "Alerta si baja de (<)"], ["none", "Solo informativo"]].map(([v, t]) => `<option value="${v}" ${r.dir === v ? "selected" : ""}>${t}</option>`).join("")}</select>`;
  const variant = (r) => r.variants ? `<span class="muted">Perfil</span><select data-r="${r.id}.variant" title="Perfil de uso del contador">${Object.keys(r.variants).map((v) => `<option ${r.variant === v ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>` : "";
  const count = (r) => S.files.reduce((n, f) => n + f.d.series.filter((x) => ruleFor(keyOf(x), R) === r).length, 0);
  let nIss = 0;
  const rows = R.map((r, i) => {
    const iss = ruleIssues(r), patIss = iss.find((t) => /patrón|expresión/.test(t)), critIss = iss.find((t) => /Critical/.test(t)), n = count(r);
    if (iss.length) nIss++;
    const num = (f, bad) => r.relation ? "–" : `<input type="number" step="any" data-r="${r.id}.${f}" value="${r[f]}" ${r.dir === "none" ? "disabled" : ""} class="${bad ? "bad" : ""}" ${bad ? `title="${esc(bad)}"` : ""} style="width:66px">`;
    const chip = S.files.length ? `<span class="chip ${n ? "" : "zero"}" title="Series de los archivos cargados que usan esta regla">${n ? n + (n === 1 ? " serie" : " series") : "sin coincidencias"}</span>` : "";
    return `<tr><td class="mv"><button class="x" data-act="rule-up" data-id="${r.id}" ${i === 0 ? "disabled" : ""} title="Subir (mayor prioridad)">▲</button><button class="x" data-act="rule-down" data-id="${r.id}" ${i === R.length - 1 ? "disabled" : ""} title="Bajar">▼</button></td>
    <td class="nm"><input type="text" data-r="${r.id}.name" class="nm1" value="${esc(r.name)}"><input type="text" data-r="${r.id}.pat" class="pt ${patIss ? "bad" : ""}" value="${esc(r.pat)}" placeholder="Patrón: texto o /regex/" ${patIss ? `title="${esc(patIss)}"` : ""}><div class="sub">${chip}${variant(r)}</div></td>
    <td><input type="text" data-r="${r.id}.ideal" value="${esc(r.ideal)}" placeholder="${esc(idealOf({ ...r, ideal: "" }))}" style="width:92px"></td>
    <td class="cr">${r.relation ? `<span class="muted">Comparación (Total &gt; Target)</span>` : dirSel(r)}</td><td>${num("warn")}</td><td>${num("crit", critIss)}</td>
    <td class="dl"><button class="x" data-act="rule-del" data-id="${r.id}" title="Eliminar contador">✕</button></td></tr>`;
  }).join("");
  const opts = S.pf.list.map((x) => `<option value="${esc(x.id)}" ${x.id === p.id ? "selected" : ""}>${esc(x.name)}</option>`).join("");
  const header = S.delArm === p.id
    ? `<div class="ph2 conf"><span>¿Eliminar el perfil <b>${esc(p.name)}</b>? No se puede deshacer.</span><button data-act="pf-del-yes" class="danger">Sí, eliminar</button><button data-act="pf-del-no">Cancelar</button></div>`
    : `<div class="ph2"><select data-pf="active" title="Perfil activo">${opts}</select><button data-act="pf-new">＋ Nuevo</button><button data-act="pf-dl">⬇ Exportar</button><label class="btn">⬆ Importar<input type="file" id="pf-file" accept=".json,application/json" hidden></label>
      <details class="menu"><summary class="btn" title="Más opciones">⋯</summary><div class="mi"><button data-act="pf-dup">Duplicar perfil</button>${S.pf.list.length > 1 ? `<button data-act="pf-dlall">Exportar todos los perfiles</button>` : ""}${p.base ? `<button data-act="pf-reset">Restablecer valores de origen</button>` : ""}${!p.base && S.pf.list.length > 1 ? `<button data-act="pf-del">Eliminar perfil…</button>` : ""}</div></details>
      ${p.dirty ? `<span class="dirty" title="Exporta el perfil para guardar una copia en un archivo">● Cambios sin exportar</span>` : ""}</div>`;
  const outdated = bi && (p.rev || 1) < bi.rev ? `<p class="warn" style="margin:-4px 2px 12px">Hay una versión más nueva de los valores de fábrica de este perfil. Tus cambios se conservan; usa ⋯ → “Restablecer valores de origen” si quieres actualizarlo.</p>` : "";
  const meta = `<div class="pmeta"><b>${esc(p.name)}</b>${p.draft ? `<span class="b warn">BORRADOR</span>` : ""}<small style="display:inline">${esc(p.description || "Sin descripción")}</small><button class="x" data-act="meta">${S.editMeta ? "Listo" : "✎ Editar detalles"}</button></div>
    ${p.draft ? `<p class="warn" style="margin:-4px 2px 12px">⚠ Perfil en borrador: las alertas usan valores que todavía no están confirmados.</p>` : ""}${outdated}
    ${S.editMeta ? `<div class="box" style="margin-bottom:12px"><div class="row"><input type="text" data-p="name" value="${esc(p.name)}" placeholder="Nombre del perfil (empresa o cliente)"><label class="row" style="gap:6px;align-items:center;flex:none"><input type="checkbox" data-p="draft" ${p.draft ? "checked" : ""}> Borrador</label></div><input type="text" data-p="description" value="${esc(p.description || "")}" placeholder="Descripción: empresa, contexto, de dónde salen los valores…"></div>` : ""}`;
  const sum = [];
  for (const f of S.files) {
    for (const r of R) {
      if (r.relation) {
        const tot = f.d.series.find((x) => /Total Server Memory/i.test(keyOf(x))), tgt = f.d.series.find((x) => /Target Server Memory/i.test(keyOf(x)));
        if (tot && tgt && ruleFor(keyOf(tot), R) === r) sum.push(`<tr><td>${esc(origin(f))}</td><td>${esc(r.name)}</td><td>Total &gt; Target</td><td class="n">${relationPct(tot.values, tgt.values).toFixed(1)} %</td><td class="n">–</td></tr>`);
      } else if (r.dir !== "none") for (const x of f.d.series) if (ruleFor(keyOf(x), R) === r) { const cp = compliance(x.values, r); sum.push(`<tr><td>${esc(origin(f))}</td><td>${esc(r.name)}</td><td>${esc(x.label)}</td><td class="n">${cp.warningPct.toFixed(1)} %</td><td class="n">${cp.criticalPct.toFixed(1)} %</td></tr>`); }
    }
  }
  m.innerHTML = header + meta + `<table class="rt al cards"><tr class="hd"><th></th><th>Contador y patrón</th><th>Valor ideal</th><th>Criterio</th><th>Warning</th><th>Critical</th><th></th></tr>${rows || `<tr><td colspan="7" class="muted" style="text-align:center">Este perfil no tiene contadores. Agrega el primero.</td></tr>`}</table>
  <div class="bar"><button data-act="rule-add">＋ Agregar contador</button>${nIss ? `<span class="warn">⚠ ${nIss} ${nIss === 1 ? "regla necesita" : "reglas necesitan"} revisión (marcadas en rojo)</span>` : ""}</div>
  <p class="muted" style="margin:0 2px 14px;font-size:12px">¿Dudas sobre criterio, Warning, Critical o patrones? Mira las <a href="#" data-tab="guide" style="color:var(--accent)">Instrucciones</a>.</p>
  <h3 class="t">Cumplimiento por archivo</h3>${sum.length ? `<table class="al cards"><tr><th>Servidor</th><th>Contador</th><th>Serie</th><th class="n">% Warning</th><th class="n">% Critical</th></tr>${sum.join("")}</table>` : `<div class="empty">Carga archivos para ver qué porcentaje del tiempo cada contador estuvo en Warning o Critical.</div>`}`;
}

/* ---------- vista Instrucciones ---------- */
function renderGuide() {
  const tpl = JSON.stringify(PROFILE_TEMPLATE, null, 2), prm = aiPrompt();
  $("#main").innerHTML = `<div class="guide">
  <div class="box"><h3>Empezar en 3 pasos</h3><ol>
    <li><b>Carga tus CSV</b> (arrástralos o usa el panel “Archivos y series”). Cada archivo se interpreta solo: columna de fecha, series numéricas y servidor.</li>
    <li><b>Elige el perfil de umbrales</b> de la empresa en el selector “Umbrales” de arriba (SII, TGR…), o crea o importa uno nuevo en la pestaña Umbrales.</li>
    <li><b>Marca contadores</b> en Explorar: cada uno muestra su gráfico con las franjas Warning y Critical y, debajo, su log de alertas con el botón “Ver en gráfico”. En Comparar superpones dos periodos o dos servidores.</li></ol></div>
  <details class="box" open><summary>Cómo funcionan los umbrales</summary>
    <p><b>Criterio.</b> “Alerta si sube de (&gt;)”: lo ideal es estar por debajo del límite (por ejemplo CPU &lt; 80 %). “Alerta si baja de (&lt;)”: lo ideal es estar por encima (por ejemplo cache hit ratio &gt; 95 %). “Solo informativo”: el valor es variable, no genera alertas.</p>
    <p><b>Warning y Critical.</b> Son los números donde empiezan la zona amarilla y la roja. Con “sube de”, Critical debe ser mayor que Warning; con “baja de”, menor. Las tablas de referencia suelen dar solo el valor ideal: úsalo como Warning y define tú el margen de Critical.</p>
    <p><b>Patrón.</b> Es el texto que debe contener el nombre del contador en el CSV, sin importar mayúsculas (por ejemplo “Lock Requests/sec”). Para casos finos acepta una expresión regular entre barras: /Processor.*Time$/. Si varias reglas coinciden con una serie, se aplica la primera de la lista.</p>
    <p><b>Perfil de uso.</b> Algunos contadores tienen valores distintos según el tipo de servidor (por ejemplo OLTP u OLAP en el cache hit ratio): se elige en la propia fila.</p></details>
  <details class="box" open><summary>Plantilla JSON estándar para un perfil de umbrales</summary>
    <p>Es el formato del archivo que se exporta e importa en la pestaña Umbrales. Puedes completarla a mano o pedirle a una IA que la llene (siguiente sección).</p>
    <pre class="code" id="tpl">${esc(tpl)}</pre>
    <div class="row" style="flex-wrap:wrap"><button data-act="copy-tpl">Copiar plantilla</button><button data-act="dl-tpl">Descargar plantilla (.json)</button></div></details>
  <details class="box" open><summary>Prompt para generar un perfil con una IA</summary>
    <p>Cuando una empresa te entregue su tabla de umbrales (texto, PDF o imagen), pega este prompt en una IA, adjunta la tabla y guarda la respuesta como archivo <code>.json</code>. Luego impórtalo con “⬆ Importar” en la pestaña Umbrales.</p>
    <pre class="code" id="prm">${esc(prm)}</pre>
    <div class="row" style="flex-wrap:wrap"><button data-act="copy-prompt">Copiar prompt</button></div></details>
  </div>`;
}
async function copyText(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); return; } catch (e) { /* se prueba el método alternativo */ }
  const ta = document.createElement("textarea"); ta.value = text; ta.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand("copy"); } catch (e) { /* ignorar */ } ta.remove();
  toast(ok ? msg : "No se pudo copiar automáticamente: haz clic en el texto y copia con Ctrl+C.");
}
/** Etiqueta cada celda con el nombre de su columna, para el formato de tarjetas en pantallas pequeñas. */
function labelTables() {
  document.querySelectorAll("table.cards").forEach((t) => {
    const hs = [...t.querySelectorAll("tr:first-child th")].map((h) => h.textContent.trim());
    t.querySelectorAll("tr").forEach((tr, i) => { if (i) [...tr.children].forEach((td, k) => td.setAttribute("data-label", hs[k] || "")); });
  });
}

/* ---------- eventos ---------- */
const syncTabs = () => { document.body.dataset.view = S.tab; document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === S.tab)); };
const renderMain = () => (S.tab === "explore" ? renderExplore() : S.tab === "compare" ? renderCompare() : S.tab === "thresholds" ? renderThresholds() : renderGuide());
function renderProf() { $("#prof").innerHTML = S.pf.list.map((p) => `<option value="${esc(p.id)}" ${p.id === S.pf.active ? "selected" : ""}>${esc(p.name)}</option>`).join(""); }
const render = () => { renderProf(); renderSide(); syncTabs(); renderMain(); };

function importProfiles(text) {
  try {
    const list = parseProfiles(text), added = list.map((x) => ({ id: uid(), name: uniqueName(x.name), description: x.description || "", draft: !!x.draft, rules: x.rules }));
    S.pf.list.push(...added); setActive(added[0].id); renderProf(); renderMain();
    toast(added.length === 1 ? `Perfil “${added[0].name}” cargado (${added[0].rules.length} contadores).` : `${added.length} perfiles cargados.`);
  } catch (e) { toast(e.message); }
}
async function downloadProfiles(list, name) {
  try { await saveBlob(new Blob([serializeProfiles(list)], { type: "application/json" }), name); toast("Perfil guardado."); list.forEach((x) => (x.dirty = false)); saveProfiles(); if (S.tab === "thresholds") renderThresholds(); }
  catch (e) { toast(e && e.code === "declined" ? "Descarga cancelada." : "No se pudo guardar el archivo."); }
}

document.addEventListener("click", (e) => {
  const menu = e.target.closest("details.menu");
  document.querySelectorAll("details.menu[open]").forEach((d) => { if (d !== menu || e.target.closest(".mi")) d.open = false; });
  const t = e.target.closest("[data-act],[data-exp],button[data-tab],a[data-tab]");
  if (!t) return;
  if (t.dataset.tab) { e.preventDefault(); S.tab = t.dataset.tab; syncTabs(); renderMain(); window.scrollTo({ top: 0 }); return; }
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
  else if (a === "side") document.body.classList.toggle("side-open");
  else if (a === "copy-tpl") copyText(JSON.stringify(PROFILE_TEMPLATE, null, 2), "Plantilla copiada.");
  else if (a === "copy-prompt") copyText(aiPrompt(), "Prompt copiado.");
  else if (a === "dl-tpl") { saveBlob(new Blob([JSON.stringify(PROFILE_TEMPLATE, null, 2)], { type: "application/json" }), "plantilla-umbrales.json").then(() => toast("Plantilla guardada.")).catch((e) => toast(e && e.code === "declined" ? "Descarga cancelada." : "No se pudo guardar el archivo.")); }
  else if (a === "pf-new") { const np = { id: uid(), name: uniqueName("Nuevo perfil"), description: "", draft: false, rules: [] }; S.pf.list.push(np); setActive(np.id); S.editMeta = true; renderProf(); renderThresholds(); }
  else if (a === "meta") { S.editMeta = !S.editMeta; renderThresholds(); }
  else if (a === "pf-dup") { const p = activeOf(S.pf), np = { ...clone(p), id: uid(), name: uniqueName(p.name + " (copia)"), base: undefined, dirty: false }; S.pf.list.push(np); setActive(np.id); renderProf(); renderThresholds(); }
  else if (a === "pf-del") { S.delArm = activeOf(S.pf).id; renderThresholds(); }
  else if (a === "pf-del-no") { S.delArm = null; renderThresholds(); }
  else if (a === "pf-del-yes") { const p = activeOf(S.pf); S.delArm = null; if (!p.base && S.pf.list.length > 1) { S.pf.list = S.pf.list.filter((x) => x.id !== p.id); setActive(S.pf.list[0].id); renderProf(); } renderThresholds(); }
  else if (a === "pf-dl") { const p = activeOf(S.pf); downloadProfiles([p], `umbrales-${slug(p.name)}.json`); }
  else if (a === "pf-dlall") downloadProfiles(S.pf.list, "umbrales-todos.json");
  else if (a === "pf-reset") { const p = activeOf(S.pf), b = BUILTIN_PROFILES.find((x) => x.id === p.base); if (b) { p.rules = clone(b.rules); p.rev = b.rev; S.rules = p.rules; touch(); p.edited = false; saveProfiles(); renderThresholds(); } }
  else if (a === "rule-add") { activeOf(S.pf).rules.push({ id: uid(), name: "Nuevo contador", ideal: "", pat: "", dir: "lt", warn: 0, crit: 0 }); touch(); renderThresholds(); }
  else if (a === "rule-del" || a === "rule-up" || a === "rule-down") {
    const R = activeOf(S.pf).rules, i = R.findIndex((x) => x.id === t.dataset.id), j = a === "rule-up" ? i - 1 : i + 1;
    if (i < 0) return;
    if (a === "rule-del") R.splice(i, 1); else if (j >= 0 && j < R.length) [R[i], R[j]] = [R[j], R[i]];
    touch(); renderThresholds();
  }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "fi") { const fl = [...t.files]; t.value = ""; addFiles(fl); }
  else if (t.id === "pf-file") { const f = t.files[0]; t.value = ""; if (f) f.text().then(importProfiles); }
  else if (t.dataset.pf) { setActive(t.value); S.delArm = null; renderProf(); renderMain(); }
  else if (t.dataset.p) {
    const p = activeOf(S.pf), k = t.dataset.p;
    if (k === "draft") p.draft = t.checked; else p[k] = k === "name" ? t.value.trim() || p.name : t.value;
    touch(); renderProf(); if (k === "draft") renderThresholds();
  }
  else if (t.dataset.fmt !== undefined) { S.fmt = t.value; document.querySelectorAll("[data-fmt]").forEach((x) => (x.value = t.value)); }
  else if (t.dataset.s) {
    const [fid, sid] = t.dataset.s.split(":"), f = +fid, i = S.sel.findIndex((x) => x.fid === f && x.sid === sid);
    if (i >= 0) S.sel.splice(i, 1); else if (S.sel.length < COLORS.length) S.sel.push({ fid: f, sid }); else { t.checked = false; return; }
    renderExplore();
  } else if (t.dataset.al) { S[t.dataset.al] = t.value; S.lim = {}; renderExplore(); }
  else if (t.dataset.r) {
    const [id, field] = t.dataset.r.split("."), r = S.rules.find((x) => x.id === id);
    if (!r) return;
    if (field === "dir") r.dir = t.value;
    else if (field === "variant") { r.variant = t.value; Object.assign(r, r.variants[t.value]); }
    else if (field === "warn" || field === "crit") { r[field] = +t.value; if (r.variants && r.variant) r.variants[r.variant] = { warn: r.warn, crit: r.crit }; }
    else r[field] = t.value;
    touch(); renderThresholds();
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
$("img.logo-app.lt").src = LOGO_L; $("img.logo-app.dk").src = LOGO_D;
new MutationObserver(labelTables).observe($("#main"), { childList: true, subtree: true });
render();
