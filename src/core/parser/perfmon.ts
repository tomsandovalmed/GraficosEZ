export interface PerfmonHeader {
  host: string;
  object: string;       // sin el prefijo de instancia SQL
  counter: string;
  sqlInstance?: string; // "(default)" para SQLServer:, o el nombre en MSSQL$NOMBRE:
  key: string;          // "Objeto\Contador": comparable entre servidores e instancias
  unit: string;
}

const RE = /^\\\\([^\\]+)\\(.+)\\([^\\]+)$/;

function guessUnit(counter: string): string {
  if (counter.startsWith("%") || /ratio/i.test(counter)) return "%";
  if (/\/sec$/i.test(counter)) return "/s";
  if (/\(KB\)/i.test(counter)) return "KB";
  if (/MBytes/i.test(counter)) return "MB";
  if (/\(ms\)/i.test(counter)) return "ms";
  return "";
}

/** Interpreta cabeceras tipo \\HOST\Objeto\Contador. Devuelve null si no son de Perfmon. */
export function parsePerfmonHeader(h: string): PerfmonHeader | null {
  const m = RE.exec(h.trim());
  if (!m) return null;
  let object = m[2], sqlInstance: string | undefined;
  const sm = /^(?:MSSQL\$([^:]+)|SQLServer):(.*)$/.exec(object);
  if (sm) { sqlInstance = sm[1] ?? "(default)"; object = sm[2]; }
  return { host: m[1], object, counter: m[3], sqlInstance, key: `${object}\\${m[3]}`, unit: guessUnit(m[3]) };
}
