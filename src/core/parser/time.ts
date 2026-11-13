const DT = /^\s*(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,6}))?)?)?\s*Z?\s*$/;

export interface TimeParser {
  parse: (s: string) => number; // epoch ms (hora "tal cual" del archivo, sin zona); NaN si es inválida
  ambiguous: boolean;           // true si dd/MM vs MM/dd no se pudo deducir
}

/** Deduce el formato de fecha a partir de una muestra. Devuelve null si no parece una columna de fechas. */
export function buildTimeParser(samples: string[]): TimeParser | null {
  const ok = samples.map((s) => DT.exec(s)).filter(Boolean) as RegExpExecArray[];
  if (!samples.length || ok.length / samples.length < 0.95) return null;
  const ymd = ok.every((m) => m[1].length === 4);
  const dmy = !ymd && ok.some((m) => +m[1] > 12);
  const ambiguous = !ymd && !dmy && !ok.some((m) => +m[2] > 12);
  const parse = (s: string) => {
    const m = DT.exec(s);
    if (!m) return NaN;
    let [y, mo, d] = ymd ? [+m[1], +m[2], +m[3]] : dmy ? [+m[3], +m[2], +m[1]] : [+m[3], +m[1], +m[2]];
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return NaN;
    return Date.UTC(y, mo - 1, d, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), Math.round(+("0." + (m[7] ?? "0")) * 1000));
  };
  return { parse, ambiguous };
}
