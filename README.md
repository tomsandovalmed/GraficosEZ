# Analizador de CSV

Herramienta web, 100 % en el navegador, para explorar y comparar archivos CSV con series de tiempo con alertas por umbrales (incluye reconocimiento de logs Perfmon de SQL Server).

```
npm run build   # genera dist/index.html (un solo archivo, sin dependencias)
npm test        # tests del núcleo
```

- `src/core/` núcleo en TypeScript: parser genérico (`parser/`) y comparación de periodos (`compare.ts`).
- `src/ui/` interfaz (vanilla JS + canvas, responsiva) y plantilla HTML.
- `src/assets/` logo de la herramienta (variantes clara y oscura), favicon y logo del desarrollador (pie de página, `logo-desarrollador.png`).
- `scripts/build.mjs` une todo en `dist/index.html`. Ábrelo con doble clic o súbelo a cualquier hosting estático.

Desarrollado por Tomas Sandoval.

## Perfiles de umbrales

Los umbrales son datos, no código: cada empresa o cliente tiene un perfil (lista de contadores con patrón, criterio, Warning y Critical).
En la pestaña **Umbrales** puedes crear, duplicar, editar, **descargar** (`.json`) y **cargar** perfiles; se guardan en el navegador.
Vienen de fábrica `SII` y `TGR` (según sus tablas de referencia). La carpeta `perfiles/` trae ambos como archivos `.json` y la plantilla estándar (`plantilla.json`); la pestaña **Instrucciones** incluye la plantilla y un prompt para que una IA convierta la tabla de un cliente nuevo en un perfil.
Formato del archivo: ver `serializeProfiles` en `src/core/thresholds.ts`.

## Versión

La versión que se muestra en el pie de página sale de `package.json` (`1.0.0` → “Versión 1.0”) al ejecutar `npm run build`.
