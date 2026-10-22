# Analizador de CSV

Herramienta web, 100 % en el navegador, para explorar y comparar archivos CSV con series de tiempo con alertas por umbrales (incluye reconocimiento de logs Perfmon de SQL Server).

```
npm run build   # genera dist/index.html (un solo archivo, sin dependencias)
npm test        # tests del núcleo
```

- `src/core/` núcleo en TypeScript: parser genérico (`parser/`) y comparación de periodos (`compare.ts`).
- `src/ui/` interfaz (vanilla JS + canvas) y plantilla HTML.
- `scripts/build.mjs` une todo en `dist/index.html`. Ábrelo con doble clic o súbelo a cualquier hosting estático.

Desarrollado por Tomas Sandoval.
