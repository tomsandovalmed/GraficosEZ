/** Detecta el separador contando candidatos fuera de comillas en la cabecera. */
export function detectDelimiter(line: string): string {
  let best = ",", bestN = 0;
  for (const d of [",", ";", "\t", "|"]) {
    let n = 0, q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === d && !q) n++;
    }
    if (n > bestN) { best = d; bestN = n; }
  }
  return best;
}

/** Lector CSV tolerante: BOM, CRLF/LF, comillas, comillas escapadas y líneas vacías. */
export function parseCsv(text: string, delimiter?: string): { delimiter: string; rows: string[][] } {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const nl = text.indexOf("\n");
  const d = delimiter ?? detectDelimiter(nl < 0 ? text : text.slice(0, nl));
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  const endRow = () => {
    row.push(field); field = "";
    if (row.length > 1 || row[0].trim() !== "") rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === d) { row.push(field); field = ""; }
    else if (c === "\n") endRow();
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) endRow();
  return { delimiter: d, rows };
}
