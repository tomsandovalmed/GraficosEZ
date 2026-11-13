import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUILTIN_PROFILES, PROFILE_TEMPLATE } from "../src/core/thresholds.ts";

// Los .json de perfiles/ son copias descargables de los perfiles de fábrica: deben coincidir con el código.
const read = (n: string) => JSON.parse(readFileSync(new URL(`../perfiles/${n}.json`, import.meta.url), "utf8"));

for (const b of BUILTIN_PROFILES) {
  test(`perfiles/${b.id}.json coincide con el perfil de fábrica ${b.name}`, () => {
    const f = read(b.id);
    assert.equal(f.name, b.name);
    assert.equal(f.description, b.description);
    assert.deepEqual(f.rules, b.rules);
  });
}

test("perfiles/plantilla.json coincide con PROFILE_TEMPLATE", () => {
  assert.deepEqual(read("plantilla"), PROFILE_TEMPLATE);
});
