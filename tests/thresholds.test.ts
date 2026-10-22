import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RULES, ruleFor, zoneOf, compliance, relationPct } from "../src/core/thresholds.ts";

const R = (id: string) => DEFAULT_RULES.find((r) => r.id === id)!;

test("las reglas se asignan a los contadores de la tabla", () => {
  assert.equal(ruleFor("Memory\\Pages/sec", DEFAULT_RULES)?.id, "pages");
  assert.equal(ruleFor("Processor(_Total)\\% Processor Time", DEFAULT_RULES)?.id, "cpu");
  assert.equal(ruleFor("Buffer Manager\\Buffer cache hit ratio", DEFAULT_RULES)?.id, "bchr");
  assert.equal(ruleFor("SQL Statistics\\SQL Compilations/sec", DEFAULT_RULES)?.id, "comp");
  assert.equal(ruleFor("Locks(_Total)\\Lock Requests/sec", DEFAULT_RULES)?.id, "locks");
  assert.equal(ruleFor("ventas\\total", DEFAULT_RULES), undefined);
});

test("zonas: menor es mejor y mayor es mejor", () => {
  assert.equal(zoneOf(50, R("cpu")), "ok");
  assert.equal(zoneOf(85, R("cpu")), "warning");
  assert.equal(zoneOf(95, R("cpu")), "critical");
  assert.equal(zoneOf(99, R("bchr")), "ok");
  assert.equal(zoneOf(93, R("bchr")), "warning");
  assert.equal(zoneOf(80, R("bchr")), "critical");
  assert.equal(zoneOf(1e9, R("tx")), "ok");
});

test("cumplimiento y relación Total vs Target", () => {
  const c = compliance(Float64Array.from([10, 85, 95, NaN]), R("cpu"));
  assert.equal(c.n, 3);
  assert.ok(Math.abs(c.warningPct - 100 / 3) < 1e-9 && Math.abs(c.criticalPct - 100 / 3) < 1e-9);
  assert.equal(relationPct(Float64Array.from([5, 7, NaN]), Float64Array.from([6, 6, 1])), 50);
});

import { findAlerts } from "../src/core/thresholds.ts";

test("findAlerts agrupa muestras consecutivas en episodios", () => {
  const t = Float64Array.from([0, 1, 2, 3, 4, 5, 6]), v = Float64Array.from([10, 85, 95, 10, 92, 92, NaN]);
  const a = findAlerts(t, v, R("cpu"));
  assert.equal(a.length, 2);
  assert.deepEqual([a[0].start, a[0].end, a[0].severity, a[0].peak, a[0].peakAt], [1, 2, "critical", 95, 2]);
  assert.equal(a[1].samples, 2);
});

test("findAlerts corta por huecos de datos y respeta el sentido gt", () => {
  const cut = findAlerts(Float64Array.from([0, 1, 100, 101]), Float64Array.from([85, 85, 85, 85]), R("cpu"), 10);
  assert.equal(cut.length, 2);
  const g = findAlerts(Float64Array.from([0, 1, 2]), Float64Array.from([99, 93, 80]), R("bchr"));
  assert.equal(g.length, 1);
  assert.deepEqual([g[0].severity, g[0].peak], ["critical", 80]);
  assert.equal(findAlerts(Float64Array.from([0]), Float64Array.from([1e9]), R("tx")).length, 0);
});
