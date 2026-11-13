import { computeStats, type Dataset, type Series, type Stats } from "./parser/dataset.ts";

/** Clave para emparejar series entre archivos: contador Perfmon normalizado o el nombre de la columna. */
export const keyOf = (s: Series) => s.perfmon?.key ?? s.header;

/** Recorta un dataset al rango [from, to) en epoch ms. */
export function sliceDataset(d: Dataset, from: number, to: number): Dataset {
  const idx: number[] = [];
  d.time.forEach((t, i) => { if (t >= from && t < to) idx.push(i); });
  return {
    ...d,
    time: Float64Array.from(idx, (i) => d.time[i]),
    series: d.series.map((s) => {
      const values = Float64Array.from(idx, (i) => s.values[i]);
      const st = computeStats(values);
      return { ...s, values, missing: idx.length - st.count, ...st };
    }),
    quality: { ...d.quality, rowsKept: idx.length },
  };
}

export interface Comparison {
  prev: Stats; curr: Stats;
  deltaPct: { min: number; mean: number; max: number };
}
const pct = (a: number, b: number) => (a === 0 ? NaN : ((b - a) / Math.abs(a)) * 100);

/** Compara una misma métrica entre dos periodos. Devuelve null si la métrica no existe en ambos. */
export function comparePeriods(prev: Dataset, curr: Dataset, key: string): Comparison | null {
  const a = prev.series.find((s) => keyOf(s) === key), b = curr.series.find((s) => keyOf(s) === key);
  if (!a || !b) return null;
  return {
    prev: computeStats(a.values), curr: computeStats(b.values),
    deltaPct: { min: pct(a.min, b.min), mean: pct(a.mean, b.mean), max: pct(a.max, b.max) },
  };
}
