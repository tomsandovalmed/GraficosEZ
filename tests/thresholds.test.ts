import { test } from "node:test";
import assert from "node:assert/strict";
import { SII_RULES, TGR_RULES, BUILTIN_PROFILES, PROFILE_TEMPLATE, aiPrompt, ruleFor, zoneOf, compliance, relationPct, matches, idealOf, ruleIssues, parseProfiles, serializeProfiles } from "../src/core/thresholds.ts";

const R = (id: string) => SII_RULES.find((r) => r.id === id)!;

test("las reglas se asignan a los contadores de la tabla", () => {
  assert.equal(ruleFor("Memory\\Pages/sec", SII_RULES)?.id, "pages");
  assert.equal(ruleFor("Processor(_Total)\\% Processor Time", SII_RULES)?.id, "cpu");
  assert.equal(ruleFor("Buffer Manager\\Buffer cache hit ratio", SII_RULES)?.id, "bchr");
  assert.equal(ruleFor("SQL Statistics\\SQL Compilations/sec", SII_RULES)?.id, "comp");
  assert.equal(ruleFor("Locks(_Total)\\Lock Requests/sec", SII_RULES)?.id, "locks");
  assert.equal(ruleFor("ventas\\total", SII_RULES), undefined);
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

test("matches: texto simple, /regex/ y patrones inválidos", () => {
  assert.ok(matches("lock requests", "Locks(_Total)\\Lock Requests/sec"));
  assert.ok(matches("/^Memory.*sec$/", "Memory\\Pages/sec"));
  assert.equal(matches("/(/", "x"), false);
  assert.equal(matches("", "x"), false);
});

test("idealOf deduce el texto cuando no se define", () => {
  assert.equal(idealOf({ ...R("cpu"), ideal: "" }), "< 80");
  assert.equal(idealOf({ ...R("bchr"), ideal: "" }), "> 95");
  assert.equal(idealOf({ ...R("tx"), ideal: "" }), "Variable");
});

test("perfiles: ida y vuelta, paquete y errores claros", () => {
  const p = BUILTIN_PROFILES[0];
  const back = parseProfiles(serializeProfiles([p]));
  assert.equal(back.length, 1);
  assert.equal(back[0].name, "SII");
  assert.deepEqual(back[0].rules.map((r) => [r.id, r.dir, r.warn, r.crit]), p.rules.map((r) => [r.id, r.dir, r.warn, r.crit]));
  assert.equal(back[0].rules.find((r) => r.id === "bchr")?.variants?.OLAP.warn, 80);
  const pack = parseProfiles(serializeProfiles(BUILTIN_PROFILES));
  assert.deepEqual(pack.map((x) => x.name), ["SII", "TGR"]);
  assert.equal(pack[1].draft, false);
  assert.throws(() => parseProfiles("no es json"), /JSON/);
  assert.throws(() => parseProfiles('{"format":"otra-cosa","rules":[]}'), /perfil de umbrales/);
  assert.throws(() => parseProfiles('{"name":"x"}'), /rules/);
});

test("perfiles: ids repetidos, criterios y números inválidos se sanean", () => {
  const [p] = parseProfiles(JSON.stringify({ name: "Cliente X", rules: [{ id: "a", name: "A", pat: "a", dir: "raro", warn: "12", crit: "x" }, { id: "a", name: "B", pat: "b", dir: "gt", warn: 5, crit: 3 }] }));
  assert.equal(p.rules[0].dir, "none");
  assert.equal(p.rules[0].warn, 12);
  assert.equal(p.rules[0].crit, 0);
  assert.notEqual(p.rules[0].id, p.rules[1].id);
});

test("perfil TGR: contadores de su tabla de referencia", () => {
  const tgr = BUILTIN_PROFILES[1].rules;
  assert.equal(ruleFor("Processor(_Total)\\% Processor Time", tgr)?.warn, 80);
  const c = ruleFor("Buffer Manager\\Buffer cache hit ratio", tgr)!;
  assert.deepEqual([c.dir, c.warn, c.crit], ["gt", 80, 70]);
  assert.equal(ruleFor("General Statistics\\User Connections", tgr)?.dir, "none");
  assert.deepEqual(tgr.flatMap((r) => ruleIssues(r)), []);
  assert.notEqual(tgr, TGR_RULES.slice());
});

test("plantilla y prompt: la plantilla es un perfil válido y el prompt la incluye", () => {
  const [p] = parseProfiles(JSON.stringify(PROFILE_TEMPLATE));
  assert.equal(p.rules.length, 3);
  assert.deepEqual(p.rules.flatMap((r) => ruleIssues(r)), []);
  const prompt = aiPrompt();
  assert.ok(prompt.includes('"format": "analizador-csv.umbrales"'));
  assert.ok(prompt.includes("[PEGA AQUÍ LA TABLA O ADJUNTA LA IMAGEN]"));
});

test("ruleIssues detecta patrón vacío, regex inválida y límites invertidos", () => {
  assert.deepEqual(ruleIssues(R("cpu")), []);
  assert.deepEqual(ruleIssues(R("bchr")), []);
  assert.equal(ruleIssues({ ...R("cpu"), pat: "" }).length, 1);
  assert.match(ruleIssues({ ...R("cpu"), pat: "/(/" })[0], /expresión/);
  assert.match(ruleIssues({ ...R("cpu"), crit: 50 })[0], /mayor que Warning/);
  assert.match(ruleIssues({ ...R("bchr"), crit: 99 })[0], /menor que Warning/);
  assert.deepEqual(ruleIssues(R("tx")), []);
});
