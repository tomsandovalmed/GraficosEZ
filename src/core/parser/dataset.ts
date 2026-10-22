import { parseCsv } from "./csv.ts";
import { buildTimeParser } from "./time.ts";
import { parsePerfmonHeader, type PerfmonHeader } from "./perfmon.ts";

export interface Stats { count: number; min: number; max: number; mean: number; std: number; p95: number }
export interface Series extends Stats {
  id: string;
  header: string;
  label: string;
  unit: string;
  values: Float64Array; // alineado con Dataset.time; NaN = sin dato
  missing: number;
  perfmon?: PerfmonHeader;
}
export interface Quality {
  rowsRead: number; rowsKept: number;
  badTimeRows: number; outOfOrder: number; duplicates: number;
  medianStepMs: number; gaps: { from: number; to: number }[];
}
export interface Dataset {
  fileName: string; delimiter: string; timeHeader: string;
  host?: string;
  time: Float64Array;   // epoch ms ordenado ascendente
  series: Series[];
  tags: Record<string, string>; // columnas de texto (valor más frecuente)
  quality: Quality;
  warnings: string[];
}

const isEmpty = (s: string | undefined) => s === undefined || s.trim() === "";

export function computeStats(v: Float64Array): Stats {
  const f: number[] = [];
  for (const x of v) if (!Number.isNaN(x)) f.push(x);
  if (!f.length) return { count: 0, min: NaN, max: NaN, mean: NaN, std: NaN, p95: NaN };
  f.sort((a, b) => a - b);
  const mean = f.reduce((a, b) => a + b, 0) / f.length;
  const std = Math.sqrt(f.reduce((a, b) => a + (b - mean) ** 2, 0) / f.length);
  return { count: f.length, min: f[0], max: f[f.length - 1], mean, std, p95: f[Math.floor(0.95 * (f.length - 1))] };
}

/** Convierte cualquier CSV con una columna de fecha/hora en un Dataset genérico. */
export function parseDataset(text: string, fileName: string): Dataset {
  const { delimiter, rows } = parseCsv(text);
  if (rows.length < 2) throw new Error("El archivo no tiene filas de datos");
  const header = rows[0].map((h) => h.trim()), body = rows.slice(1), nCols = header.length;
  const cell = (r: number, c: number) => body[r][c];

  // 1) columna de tiempo: la primera que parezca fecha
  let timeCol = -1, tp = null as ReturnType<typeof buildTimeParser>;
  for (let c = 0; c < nCols && !tp; c++) {
    const sample: string[] = [];
    for (let r = 0; r < body.length && sample.length < 200; r++) if (!isEmpty(cell(r, c))) sample.push(cell(r, c));
    tp = buildTimeParser(sample);
    if (tp) timeCol = c;
  }
  if (!tp) throw new Error("No se encontró una columna de fecha/hora reconocible");

  // 2) tiempos válidos, orden cronológico y duplicados
  const t0 = body.map((_, r) => tp!.parse(cell(r, timeCol) ?? ""));
  const valid: number[] = [];
  let badTimeRows = 0, outOfOrder = 0, prev = -Infinity;
  t0.forEach((t, r) => {
    if (Number.isNaN(t)) { badTimeRows++; return; }
    if (t < prev) outOfOrder++;
    prev = t; valid.push(r);
  });
  valid.sort((a, b) => t0[a] - t0[b]);
  const keep: number[] = [];
  let duplicates = 0;
  for (const r of valid) {
    if (keep.length && t0[keep[keep.length - 1]] === t0[r]) duplicates++;
    else keep.push(r);
  }
  const time = Float64Array.from(keep, (r) => t0[r]);

  // 3) columnas: numéricas -> series, texto -> etiquetas
  const series: Series[] = [], tags: Record<string, string> = {};
  for (let c = 0; c < nCols; c++) {
    if (c === timeCol) continue;
    let ne = 0, nn = 0;
    for (let r = 0; r < body.length; r++) {
      const v = cell(r, c);
      if (isEmpty(v)) continue;
      ne++;
      if (Number.isFinite(Number(delimiter === ";" ? v.trim().replace(",", ".") : v.trim()))) nn++;
    }
    if (!ne) continue;
    if (nn / ne < 0.9) {
      const freq = new Map<string, number>();
      for (let r = 0; r < body.length; r++) { const v = (cell(r, c) ?? "").trim(); if (v) freq.set(v, (freq.get(v) ?? 0) + 1); }
      tags[header[c]] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
      continue;
    }
    const values = new Float64Array(keep.length);
    keep.forEach((r, i) => {
      const v = cell(r, c);
      const n = isEmpty(v) ? NaN : Number(delimiter === ";" ? v.trim().replace(",", ".") : v.trim());
      values[i] = Number.isFinite(n) ? n : NaN;
    });
    const pm = parsePerfmonHeader(header[c]) ?? undefined;
    const st = computeStats(values);
    series.push({
      id: `${c}`, header: header[c], label: pm ? `${pm.object} · ${pm.counter}` : header[c] || `Columna ${c + 1}`,
      unit: pm?.unit ?? "", values, missing: keep.length - st.count, perfmon: pm, ...st,
    });
  }

  // 4) calidad del dato
  const steps = Array.from(time.subarray(1), (t, i) => t - time[i]).sort((a, b) => a - b);
  const medianStepMs = steps.length ? steps[Math.floor(steps.length / 2)] : 0;
  const gaps: { from: number; to: number }[] = [];
  for (let i = 1; i < time.length && medianStepMs; i++)
    if (time[i] - time[i - 1] > 3 * medianStepMs) gaps.push({ from: time[i - 1], to: time[i] });

  const hosts = series.map((s) => s.perfmon?.host).filter(Boolean) as string[];
  const host = hosts.length ? hosts.sort((a, b) => hosts.filter((x) => x === b).length - hosts.filter((x) => x === a).length)[0] : undefined;

  const warnings: string[] = [];
  if (tp.ambiguous) warnings.push("Formato de fecha ambiguo: se asumió mes/día/año.");
  if (outOfOrder) warnings.push(`${outOfOrder} filas venían fuera de orden y se ordenaron por fecha.`);
  if (duplicates) warnings.push(`${duplicates} filas con fecha repetida se descartaron.`);
  if (badTimeRows) warnings.push(`${badTimeRows} filas con fecha inválida se descartaron.`);

  return {
    fileName, delimiter, timeHeader: header[timeCol], host, time, series, tags, warnings,
    quality: { rowsRead: body.length, rowsKept: keep.length, badTimeRows, outOfOrder, duplicates, medianStepMs, gaps },
  };
}
