export type Dir = "lt" | "gt" | "none"; // lt: ideal por debajo del límite · gt: ideal por encima
export interface Variant { warn: number; crit: number }
export interface Rule {
  id: string; name: string;
  ideal: string;        // texto libre del "valor ideal" (si está vacío se deduce del criterio)
  pat: string;          // texto que debe contener la clave "Objeto\Contador", o una expresión /regex/
  dir: Dir; warn: number; crit: number;
  variants?: Record<string, Variant>; // p. ej. OLTP / OLAP: valores alternativos para el mismo contador
  variant?: string;                   // variante activa
  relation?: boolean;                 // regla comparativa (Total vs Target): sin franjas
}
export type Zone = "ok" | "warning" | "critical";

/** Un perfil de umbrales completo, tal como se guarda en el archivo descargable. */
export interface ProfileFile {
  format: string; version: number;
  name: string; description?: string; draft?: boolean; updated?: string;
  rules: Rule[];
}
export const PROFILE_FORMAT = "analizador-csv.umbrales";

/** ¿El patrón corresponde a esta clave? Texto simple = "contiene" (sin mayúsculas); /expresión/ = regex. */
export function matches(pat: string, key: string): boolean {
  if (!pat) return false;
  if (pat.length > 2 && pat.startsWith("/") && pat.endsWith("/")) {
    try { return new RegExp(pat.slice(1, -1), "i").test(key); } catch { return false; }
  }
  return key.toLowerCase().includes(pat.toLowerCase());
}

export const idealOf = (r: Rule): string =>
  r.ideal || (r.dir === "lt" ? `< ${r.warn}` : r.dir === "gt" ? `> ${r.warn}` : "Variable");

/** Problemas de una regla que el usuario debería corregir (vacío = regla sana). */
export function ruleIssues(r: Rule): string[] {
  const out: string[] = [];
  if (!r.pat.trim()) out.push("Falta el patrón: sin él la regla no coincide con ninguna serie.");
  else if (r.pat.length > 2 && r.pat.startsWith("/") && r.pat.endsWith("/")) {
    try { new RegExp(r.pat.slice(1, -1)); } catch { out.push("La expresión regular del patrón no es válida."); }
  }
  if (!r.relation && r.dir === "lt" && r.crit <= r.warn) out.push("Con “menor es mejor”, Critical debe ser mayor que Warning.");
  if (!r.relation && r.dir === "gt" && r.crit >= r.warn) out.push("Con “mayor es mejor”, Critical debe ser menor que Warning.");
  return out;
}

/** Valores ideales de la tabla de referencia de SII. `warn` es el límite ideal; `crit` es un margen editable. */
export const SII_RULES: Rule[] = [
  { id: "pages", name: "Memory\\Pages/sec", ideal: "< 20", pat: "Memory\\Pages/sec", dir: "lt", warn: 20, crit: 40 },
  { id: "cpu", name: "% Processor Time", ideal: "< 80 %", pat: "Processor(_Total)\\% Processor Time", dir: "lt", warn: 80, crit: 90 },
  { id: "bchr", name: "Buffer cache hit ratio", ideal: "> 95 % (OLTP) · > 80 % (OLAP)", pat: "Buffer cache hit ratio", dir: "gt", warn: 95, crit: 90,
    variants: { OLTP: { warn: 95, crit: 90 }, OLAP: { warn: 80, crit: 70 } }, variant: "OLTP" },
  { id: "tx", name: "Transactions/sec", ideal: "Variable", pat: "Transactions/sec", dir: "none", warn: 0, crit: 0 },
  { id: "sess", name: "Cantidad de sesiones por día (User Connections)", ideal: "Variable", pat: "User Connections", dir: "none", warn: 0, crit: 0 },
  { id: "comp", name: "SQL Compilations/sec", ideal: "<= 100", pat: "SQL Compilations/sec", dir: "lt", warn: 100, crit: 200 },
  { id: "mem", name: "Target vs Total Memory", ideal: "Total igual o menor que Target", pat: "Total Server Memory", dir: "none", warn: 0, crit: 0, relation: true },
  { id: "locks", name: "Locks: Lock Requests/sec", ideal: "< 1000", pat: "Lock Requests/sec", dir: "lt", warn: 1000, crit: 2000 },
];

/** Umbrales de TGR según su tabla de referencia. Los contadores de costo de CPU y crecimiento por base de datos son informativos. */
export const TGR_RULES: Rule[] = [
  { id: "cpu", name: "% Processor Time", ideal: "< 80 %", pat: "Processor(_Total)\\% Processor Time", dir: "lt", warn: 80, crit: 90 },
  { id: "bchr", name: "Cache Hit Ratio", ideal: "> 80 %", pat: "Buffer cache hit ratio", dir: "gt", warn: 80, crit: 70 },
  { id: "sess", name: "User Connections", ideal: "Variable", pat: "User Connections", dir: "none", warn: 0, crit: 0 },
  { id: "cost", name: "Costo de CPU por BDD", ideal: "Variable", pat: "Costo de CPU", dir: "none", warn: 0, crit: 0 },
  { id: "growth", name: "Gráfica Crecimiento BDD", ideal: "Variable", pat: "Crecimiento", dir: "none", warn: 0, crit: 0 },
];

/** Perfiles de fábrica. `rev` sube cuando cambian sus valores, para actualizar los que el usuario no editó. */
export const BUILTIN_PROFILES: { id: string; name: string; description: string; draft?: boolean; rev: number; rules: Rule[] }[] = [
  { id: "sii", name: "SII", description: "Valores ideales de la tabla de referencia de SII. El inicio de la zona Critical es un margen editable.", rev: 1, rules: SII_RULES },
  { id: "tgr", name: "TGR", description: "Valores ideales de la tabla de referencia de TGR. El inicio de la zona Critical es un margen editable.", rev: 2, rules: TGR_RULES },
];

/** Plantilla estándar de un perfil, lista para copiar, completar o dársela a una IA. */
export const PROFILE_TEMPLATE: ProfileFile = {
  format: PROFILE_FORMAT, version: 1,
  name: "Nombre del perfil (empresa o cliente)",
  description: "De dónde salen estos valores (documento, fecha, responsable…)",
  draft: false,
  rules: [
    { id: "cpu", name: "% Processor Time", ideal: "< 80 %", pat: "Processor(_Total)\\% Processor Time", dir: "lt", warn: 80, crit: 90 },
    { id: "cache", name: "Buffer cache hit ratio", ideal: "> 95 %", pat: "Buffer cache hit ratio", dir: "gt", warn: 95, crit: 90 },
    { id: "sesiones", name: "User Connections", ideal: "Variable", pat: "User Connections", dir: "none", warn: 0, crit: 0 },
  ],
};

/** Prompt para que una IA convierta una tabla de umbrales (texto o imagen) en un perfil válido. */
export function aiPrompt(): string {
  return `Actúa como analista de bases de datos. Te entregaré una tabla de valores ideales (umbrales) de contadores de rendimiento (Performance Monitor / PDH). Conviértela en un archivo JSON con EXACTAMENTE esta estructura:

${JSON.stringify(PROFILE_TEMPLATE, null, 2)}

Reglas:
1. "format" y "version" no cambian. En "name" pon el nombre de la empresa o cliente.
2. Crea un objeto dentro de "rules" por cada fila de la tabla.
3. "id": corto, en minúsculas, sin espacios y único.
4. "name": el contador tal como aparece en la tabla.
5. "ideal": el valor ideal tal como aparece en la tabla (por ejemplo "< 80 %" o "Variable").
6. "pat": texto simple que contenga el nombre del contador tal como aparece en el encabezado del CSV (por ejemplo "Lock Requests/sec" o "Processor(_Total)\\\\% Processor Time"; recuerda duplicar la barra invertida dentro del JSON). No uses expresiones regulares salvo que sea imprescindible; si lo haces, escríbela entre barras: "/Processor.*Time$/".
7. "dir": "lt" si lo ideal es estar POR DEBAJO del límite (alerta si sube, por ejemplo "< 80"); "gt" si lo ideal es estar POR ENCIMA (alerta si baja, por ejemplo "> 95"); "none" si el valor es "Variable" o solo informativo.
8. "warn": número donde empieza la zona Warning (normalmente el límite de la tabla). "crit": número donde empieza la zona Critical. Con "lt", crit debe ser mayor que warn; con "gt", menor. Si la tabla no indica el valor Critical, propón un margen razonable. Con "none" usa 0 y 0.
9. Responde solo con el bloque JSON, sin comentarios dentro. Después del JSON, en una línea aparte, indica qué valores de "crit" propusiste por tu cuenta.

Datos a convertir: [PEGA AQUÍ LA TABLA O ADJUNTA LA IMAGEN]`;
}

/** Regla que corresponde a una serie (por su clave Objeto\Contador). La primera que coincide gana. */
export function ruleFor(key: string, rules: Rule[]): Rule | undefined {
  return rules.find((r) => matches(r.pat, key));
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

/* ---------- archivos de perfil (importar / exportar) ---------- */
const num = (v: any, d = 0) => (v !== "" && v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d);

function cleanRule(x: any, i: number, used: Set<string>): Rule {
  if (!x || typeof x !== "object") throw new Error(`La regla ${i + 1} no es válida.`);
  const dir: Dir = x.dir === "lt" || x.dir === "gt" ? x.dir : "none";
  let id = String(x.id ?? "").trim() || `r${i + 1}`;
  while (used.has(id)) id += "_";
  used.add(id);
  const r: Rule = { id, name: String(x.name ?? "").trim() || `Contador ${i + 1}`, ideal: String(x.ideal ?? ""), pat: String(x.pat ?? ""), dir, warn: num(x.warn), crit: num(x.crit) };
  if (x.relation === true) r.relation = true;
  if (x.variants && typeof x.variants === "object") {
    r.variants = {};
    for (const [k, v] of Object.entries(x.variants as Record<string, any>)) r.variants[k] = { warn: num(v?.warn), crit: num(v?.crit) };
    if (typeof x.variant === "string" && r.variants[x.variant]) r.variant = x.variant;
  }
  return r;
}

function cleanProfile(x: any): ProfileFile {
  if (!x || typeof x !== "object" || !Array.isArray(x.rules)) throw new Error("El archivo no tiene la lista de reglas (“rules”).");
  const used = new Set<string>();
  return {
    format: PROFILE_FORMAT, version: 1, name: String(x.name ?? "").trim() || "Perfil importado",
    description: x.description ? String(x.description) : "", draft: x.draft === true,
    rules: x.rules.map((r: unknown, i: number) => cleanRule(r, i, used)),
  };
}

/** Lee un archivo de perfil (uno solo o un paquete con varios) y lo valida. Lanza Error con un mensaje claro. */
export function parseProfiles(text: string): ProfileFile[] {
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error("El archivo no es un JSON válido."); }
  if (data && !Array.isArray(data) && data.format && data.format !== PROFILE_FORMAT) throw new Error("El archivo no es un perfil de umbrales de esta herramienta.");
  const list = Array.isArray(data) ? data : Array.isArray(data?.profiles) ? data.profiles : [data];
  if (!list.length) throw new Error("El archivo no contiene perfiles.");
  return list.map(cleanProfile);
}

export function serializeProfiles(ps: { name: string; description?: string; draft?: boolean; rules: Rule[] }[]): string {
  const updated = new Date().toISOString().slice(0, 10);
  const one = (p: { name: string; description?: string; draft?: boolean; rules: Rule[] }) => ({ format: PROFILE_FORMAT, version: 1, name: p.name, description: p.description || "", draft: !!p.draft, updated, rules: p.rules });
  return JSON.stringify(ps.length === 1 ? one(ps[0]) : { format: PROFILE_FORMAT, version: 1, profiles: ps.map(one) }, null, 2);
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
