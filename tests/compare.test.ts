import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDataset } from "../src/core/parser/index.ts";
import { sliceDataset, comparePeriods } from "../src/core/compare.ts";

const mk = (days: number[], f: (d: number) => number) =>
  "t,cpu\n" + days.map((d) => `2026-07-${String(d).padStart(2, "0")} 12:00:00,${f(d)}`).join("\n");

test("sliceDataset recorta por rango y recalcula estadísticas", () => {
  const d = parseDataset(mk([1, 2, 3, 4, 5, 6], (x) => x), "x.csv");
  const s = sliceDataset(d, Date.UTC(2026, 6, 4), Infinity);
  assert.equal(s.time.length, 3);
  assert.equal(s.series[0].mean, 5);
});

test("comparePeriods calcula la variación porcentual", () => {
  const a = parseDataset(mk([1, 2, 3], () => 10), "a.csv"), b = parseDataset(mk([1, 2, 3], () => 15), "b.csv");
  const c = comparePeriods(a, b, "cpu")!;
  assert.equal(Math.round(c.deltaPct.mean), 50);
  assert.equal(comparePeriods(a, b, "no-existe"), null);
});
