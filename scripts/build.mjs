// Une el núcleo TypeScript + la interfaz en un único dist/index.html (sin dependencias).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const core = ["parser/csv", "parser/time", "parser/perfmon", "parser/dataset", "thresholds", "compare"]
  .map((n) => stripTypeScriptTypes(readFileSync(`src/core/${n}.ts`, "utf8")).replace(/^import .*$/gm, "").replace(/^export /gm, ""))
  .join("\n");
const html = readFileSync("src/ui/index.template.html", "utf8")
  .split("/*CORE*/").join(core)
  .split("/*UI*/").join(readFileSync("src/ui/app.js", "utf8"))
  .split("__LOGO__").join(readFileSync("src/assets/logo.png").toString("base64"));
mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", html);
console.log(`dist/index.html (${(html.length / 1024).toFixed(0)} KB)`);
