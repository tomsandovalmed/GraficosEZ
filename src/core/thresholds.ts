export type Dir = "lt" | "gt" | "none"; // lt: ideal por debajo del límite · gt: ideal por encima
export interface Rule {
  id: string; name: string;
  ideal: string;        // texto de la tabla de referencia
  pat: string;          // expresión regular sobre la clave "Objeto\Contador"
  dir: Dir; warn: number; crit: number;
  profile?: "OLTP" | "OLAP";
  relation?: boolean;   // regla comparativa (Total vs Target): sin franjas
}
export type Zone = "ok" | "warning" | "critical";

export const PROFILES: Record<string, { warn: number; crit: number }> = {
  OLTP: { warn: 95, crit: 90 },
  OLAP: { warn: 80, crit: 70 },
};

/** Valores ideales de la tabla de referencia. `warn` es el límite ideal; `crit` es un margen editable. */
export const DEFAULT_RULES: Rule[] = [
  { id: "pages", name: "Memory\\Pages/sec", ideal: "< 20", pat: "^Memory\\\\Pages/sec$", dir: "lt", warn: 20, crit: 40 },
  { id: "cpu", name: "% Processor Time", ideal: "< 80 %", pat: "Processor.*% Processor Time$", dir: "lt", warn: 80, crit: 90 },
  { id: "bchr", name: "Buffer cache hit ratio", ideal: "> 95 % (OLTP) · > 80 % (OLAP) · cercano a 100", pat: "Buffer cache hit ratio$", dir: "gt", warn: 95, crit: 90, profile: "OLTP" },
  { id: "tx", name: "Transactions/sec", ideal: "Variable", pat: "Transactions/sec$", dir: "none", warn: 0, crit: 0 },
  { id: "sess", name: "Cantidad de sesiones (User Connections)", ideal: "Variable", pat: "User Connections$", dir: "none", warn: 0, crit: 0 },
  { id: "comp", name: "SQL Compilations/sec", ideal: "<= 100", pat: "SQL Compilations/sec$", dir: "lt", warn: 100, crit: 200 },
  { id: "mem", name: "Target vs Total Server Memory", ideal: "Total igual o menor que Target", pat: "Total Server Memory", dir: "none", warn: 0, crit: 0, relation: true },
  { id: "locks", name: "Locks: Lock Requests/sec", ideal: "< 1000", pat: "Lock Requests/sec$", dir: "lt", warn: 1000, crit: 2000 },
];

/** Regla que corresponde a una serie (por su clave Objeto\Contador). */
export function ruleFor(key: string, rules: Rule[]): Rule | undefined {
  return rules.find((r) => new RegExp(r.pat, "i").test(key));
}

export function zoneOf(v: number, r: Rule): Zone {
  if (Number.isNaN(v) || r.dir === "none") return "ok";
  if (r.dir === "lt") return v > r.crit ? "critical" : v > r.warn ? "warning" : "ok";
  return v < r.crit ? "critical" : v < r.warn ? "warning" : "ok";
}

/** Porcentaje de muestras en Warning y en Critical. */
export function compliance(values: Float64Array, r: Rule) {
  let n = 0, w = 0, c = 0;
  for (const v of values) {
    if (Number.isNaN(v)) continue;
    n++;
    const z = zoneOf(v, r);
    if (z === "warning") w++; else if (z === "critical") c++;
  }
  return { n, warningPct: n ? (w / n) * 100 : 0, criticalPct: n ? (c / n) * 100 : 0 };
}

/** Porcentaje de muestras en que `a` supera a `b` (p. ej. Total > Target Server Memory). */
export function relationPct(a: Float64Array, b: Float64Array): number {
  let n = 0, k = 0;
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(a[i]) || Number.isNaN(b[i])) continue;
    n++;
    if (a[i] > b[i]) k++;
  }
  return n ? (k / n) * 100 : 0;
}

export interface Alert {
  start: number; end: number;           // epoch ms del episodio
  severity: "warning" | "critical";     // la peor zona alcanzada
  peak: number; peakAt: number;         // valor más extremo y cuándo ocurrió
  samples: number;
}

/**
 * Agrupa muestras consecutivas fuera del rango ideal en episodios (eventos).
 * Un hueco de datos mayor a `maxGapMs` corta el episodio.
 */
export function findAlerts(time: Float64Array, values: Float64Array, r: Rule, maxGapMs = Infinity): Alert[] {
  const out: Alert[] = [];
  if (r.dir === "none" || r.relation) return out;
  const worse = r.dir === "lt" ? (a: number, b: number) => a > b : (a: number, b: number) => a < b;
  let cur: Alert | null = null, last = -Infinity;
  for (let i = 0; i < time.length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) continue;
    const z = zoneOf(v, r);
    if (z === "ok" || (cur && time[i] - last > maxGapMs)) {
      if (cur) { out.push(cur); cur = null; }
      if (z === "ok") { last = time[i]; continue; }
    }
    if (!cur) cur = { start: time[i], end: time[i], severity: z as "warning" | "critical", peak: v, peakAt: time[i], samples: 1 };
    else {
      cur.end = time[i]; cur.samples++;
      if (z === "critical") cur.severity = "critical";
      if (worse(v, cur.peak)) { cur.peak = v; cur.peakAt = time[i]; }
    }
    last = time[i];
  }
  if (cur) out.push(cur);
  return out;
}
