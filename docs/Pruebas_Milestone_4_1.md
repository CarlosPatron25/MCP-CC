# WS Workspace MCP — Pruebas de Milestone 4.1B

## Estado

`COMPLETED — FROZEN`

M4.1B está `IMPLEMENTED`, con validación automática y validación manual IBM Bob
en `PASS`. Milestone 4.1 queda oficialmente `COMPLETED — FROZEN`.

## Alcance validado

- Configuración local create-once en
  `.ws-workspace/config/workspace-config.json`, con JSON canónico, límite de
  4 KiB, validación cerrada y publicación no reemplazable ante carrera.
- Snapshot técnico exacto de `ES_ES_V1` en el manifest de dossiers nuevos,
  parser estructural con LF/CRLF, rechazo seguro de marker inválido y fallback
  histórico `EN_BASELINE_V1` cuando el marker no existe.
- Registro tipado y exhaustivo de los 15 artefactos de prosa del sistema, con
  providers español e inglés baseline.
- Generación M2 y renderers/proyecciones M3/M4 con prosa del sistema en
  español, conservando literal el contenido humano y los tokens técnicos.
- Integridad de `WORK_ITEM.yml`, bloques protegidos M3/M4, ledger, locking,
  journal, recovery, idempotencia y las 15 herramientas MCP sin cambios de
  schema ni de superficie.

## Evidencia automática

Ejecutado el 2026-07-26 desde la raíz del repositorio:

| Comando                    | Resultado                     |
| -------------------------- | ----------------------------- |
| `npm.cmd run format:write` | PASS                          |
| `npm.cmd run format`       | PASS                          |
| `npm.cmd run typecheck`    | PASS                          |
| `npm.cmd run lint`         | PASS                          |
| `npm.cmd run test`         | PASS — 26 archivos, 158 tests |
| `npm.cmd run build`        | PASS                          |
| `npm.cmd run check`        | PASS                          |
| `npm.cmd run smoke`        | PASS                          |

El smoke usa un workspace temporal, verifica el archivo de configuración
canónico, el marker exacto, la literalidad de un payload humano, proyecciones
localizadas, actualización explícita de `AI_CONTEXT`, el inventario de manifest
M3/M4, idempotencia, errores seguros, ausencia de rutas absolutas y el conjunto
exacto de 15 herramientas MCP.

## Cobertura específica añadida

- `document-rendering.test.ts`: perfiles congelados, inventario exhaustivo,
  marker exacto, LF/CRLF, ausencia histórica y formas inválidas.
- `workspace-document-language-configuration.test.ts`: orden y whitespace JSON
  permitidos, no reescritura de configuración válida, carrera create-if-absent
  e inválidos sin reparación.
- Regresiones M2/M3/M4 y MCP actualizadas para comprobar que el rendering nuevo
  es español y que los valores aportados por el usuario permanecen sin
  traducción.

## Validación manual IBM Bob

**Resultado:** `PASS`

Resumen ejecutivo:

- Validación automática y validación manual: PASS.
- 0 defectos de implementación y 0 defectos de contrato.
- Retry idempotente, preservación del payload humano y marker de rendering
  validados.
- Compatibilidad histórica y regresión M1–M4 validadas satisfactoriamente.
- Las observaciones fueron únicamente no bloqueantes.

No se reproduce aquí el informe completo de IBM Bob. Milestone 5 queda
`READY TO START`.
