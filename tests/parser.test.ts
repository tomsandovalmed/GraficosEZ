import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDataset, parsePerfmonHeader } from "../src/core/parser/index.ts";

test("ordena filas desordenadas y descarta duplicados", () => {
  const csv = `fecha,cpu\n2026-07-02 00:00:00,30\n2026-07-01 00:00:00,10\n2026-07-01 00:00:00,99\n2026-07-01 00:10:00,20\n`;
  const d = parseDataset(csv, "a.csv");
  assert.equal(d.quality.rowsKept, 3);
  assert.equal(d.quality.outOfOrder, 1);
  assert.equal(d.quality.duplicates, 1);
  assert.deepEqual([...d.series[0].values], [10, 20, 30]);
});

test("celdas con espacio son vacías y las columnas de texto son etiquetas", () => {
  const csv = `"t","\\\\SRV\\Memory\\Pages/sec","nota"\n"07/01/2026 00:00:00.500"," ","x;SRV"\n"07/01/2026 00:15:00.500","4","x;SRV"\n`;
  const d = parseDataset(csv, "b.csv");
  assert.equal(d.series.length, 1);
  assert.equal(d.series[0].missing, 1);
  assert.equal(d.series[0].mean, 4);
  assert.equal(d.tags["nota"], "x;SRV");
  assert.equal(d.host, "SRV");
});

test("deduce dd/MM cuando hay un día mayor a 12 y soporta ;", () => {
  const d = parseDataset(`fecha;v\n25/07/2026 10:00;1,5\n26/07/2026 10:00;2,5\n`, "c.csv");
  assert.equal(new Date(d.time[0]).getUTCDate(), 25);
  assert.equal(d.series[0].mean, 2);
});

test("cabeceras Perfmon: instancia nombrada y por defecto comparten clave", () => {
  const a = parsePerfmonHeader("\\\\BAHAM\\MSSQL$LONGVIEW:Buffer Manager\\Page life expectancy")!;
  const b = parsePerfmonHeader("\\\\CAUTIN\\SQLServer:Buffer Manager\\Page life expectancy")!;
  assert.equal(a.key, b.key);
  assert.equal(a.sqlInstance, "LONGVIEW");
  assert.equal(b.sqlInstance, "(default)");
});

test("falla con claridad si no hay columna de fecha", () => {
  assert.throws(() => parseDataset("a,b\n1,2\n3,4\n", "d.csv"), /fecha/);
});
