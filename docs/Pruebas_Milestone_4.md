# Pruebas de Validación — Milestone 4

**Fecha de ejecución automática:** 2026-07-24  
**Servidor MCP bajo prueba:** `ws-workspace-mcp` `0.1.0`  
**Raíz de prueba:** temporal y desechable  
**Validación manual IBM Bob:** PASS

## Estado autorizado

- `Milestone 4: COMPLETED`
- `Milestone 4 Design: FROZEN`
- `Milestone 4 Implementation: COMPLETED — FROZEN`

Este documento constituye la evidencia oficial de la validación automática y
de la validación manual mediante IBM Bob. El diseño y la implementación están
congelados; Milestone 4 está oficialmente cerrado.

## Validación automática

| Comando                 | Resultado |
| ----------------------- | --------- |
| `npm.cmd run format`    | PASS      |
| `npm.cmd run typecheck` | PASS      |
| `npm.cmd run lint`      | PASS      |
| `npm.cmd run test`      | PASS      |
| `npm.cmd run build`     | PASS      |
| `npm.cmd run check`     | PASS      |
| `npm.cmd run smoke`     | PASS      |

La suite contiene 24 archivos y 145 pruebas superadas. `check` vuelve a
ejecutar formato, typecheck, lint, test y build como una única cadena de
validación.

## Cobertura automatizada

Las pruebas de dominio y servicios cubren UUID v4, normalización,
canonicalización, fingerprints deterministas, índice global de idempotencia,
reintentos exactos, reutilización incompatible de claves, revisiones globales y
del plan, relaciones append-only, correcciones, checkpoints, un único plan
lógico, versiones inmutables, casos generados por el servidor, ejecuciones
contra la versión activa e historia preservada.

Las pruebas de persistencia y proyección cubren:

- ledger estructurado `records/AUDIT_LEDGER.json` como fuente de verdad;
- las cuatro proyecciones protegidas y regenerables;
- referencias de evidencia lógicas sin desreferenciar contenido;
- orden y regeneración deterministas;
- composición M3/M4 del manifest con LF y CRLF;
- preservación de secciones ajenas y de las seis filas M3 no afectadas;
- lock físico compartido por M3 y M4;
- staging, backups, commit multiarchivo, rollback y journal;
- recuperación de transacciones interrumpidas;
- rechazo de corrupción, traversal y symlinks/junctions;
- resumen M4 de `AI_CONTEXT` determinista, sin ubicaciones ni URLs y limitado
  a 16 KiB mediante truncado semántico.

Las pruebas MCP cubren las siete herramientas M4, esquemas estrictos, campos
desconocidos, precedencia de precondiciones, errores tipados, las cuatro vistas
cerradas, ausencia de lectura genérica y regresión de las ocho herramientas
M1–M3.

## Smoke MCP

El smoke ejecuta el flujo completo sobre una raíz temporal creada para la
prueba y la elimina en un bloque de limpieza final. No utiliza el workspace
runtime configurado.

La discovery devuelve exactamente estas 15 herramientas:

1. `health_check`
2. `get_server_capabilities`
3. `initialize_workspace`
4. `create_work_item`
5. `initialize_work_item_documents`
6. `get_work_item_document`
7. `update_work_item_document`
8. `refresh_ai_context`
9. `initialize_work_item_tracking`
10. `record_decision`
11. `record_checkpoint`
12. `define_test_plan`
13. `record_test_execution`
14. `register_evidence_reference`
15. `get_work_item_tracking`

El flujo valida inicialización M1–M4, una referencia de evidencia, una
decisión, un checkpoint, un plan, una ejecución, las cuatro vistas cerradas,
actualización explícita de `AI_CONTEXT`, ambos inventarios del manifest, un
reintento idempotente exacto, un conflicto de revisión y ausencia de rutas
absolutas en las respuestas. Las revisiones auditadas progresan de 0 a 5; el
reintento exacto no añade una nueva entrada.

## Regresión M1–M3

Las pruebas históricas permanecen activas. Los contratos de las ocho
herramientas anteriores, la enumeración cerrada de siete documentos M3,
`get_work_item_document`, `WORK_ITEM.yml`, los estados de Work Item y los
códigos de error históricos no se han ampliado ni sustituido. La alternancia
de mutaciones M3 y M4 comprueba que ambos inventarios permanecen válidos.

## Validación manual IBM Bob

Resultado oficial:

```text
MANUAL IBM BOB VALIDATION: PASS
```

| Resultado      | Total |
| -------------- | ----: |
| Ejecutadas     |    42 |
| PASS           |    42 |
| FAIL           |     0 |
| No ejecutables |     0 |

La validación manual confirma la ejecución satisfactoria del plan IBM Bob para
M4. No es necesario repetirla para este cierre.

## Observaciones IBM Bob y resolución arquitectónica

### 1. `planId` inválido

IBM Bob esperaba `TEST_PLAN_CONFLICT` y observó
`AUDIT_ENTRY_VALIDATION_FAILED`. El valor utilizado no representaba un UUID v4
canónico. El contrato aplica primero el esquema estricto: una identidad
malformada falla como solicitud inválida. `TEST_PLAN_CONFLICT` se reserva para
un UUID v4 válido que intenta introducir otro plan lógico o no coincide con el
único plan existente.

**Decisión:** diferencia de precedencia de validación; comportamiento correcto.

### 2. `testCaseId` inválido

IBM Bob esperaba `TEST_CASE_NOT_FOUND` y observó
`AUDIT_ENTRY_VALIDATION_FAILED`. Un valor malformado no alcanza la comprobación
de pertenencia al plan. Un UUID v4 válido pero ausente de la versión exacta del
plan sí produce `TEST_CASE_NOT_FOUND`.

**Decisión:** diferencia de precedencia de validación; comportamiento correcto.

### 3. Llamadas paralelas

IBM Bob observó `AUDIT_TRACKING_CONFLICT` durante llamadas paralelas de
validación de rutas. M3 y M4 comparten por contrato un lock exclusivo por Work
Item. Una operación concurrente no espera, no roba y no elimina el lock:
falla cerrado con ese código seguro.

**Decisión:** comportamiento de concurrencia esperado y requerido por el
diseño.

Las tres observaciones se consideran cerradas. No representan defectos
contractuales y no requieren cambios de código, arquitectura, contratos,
persistencia, locking, journal, recovery ni `AI_CONTEXT`.

## Límites de la evidencia

La evidencia incluye una ejecución real desde IBM Bob. La persistencia continúa
siendo local y depende de permisos del sistema operativo para excluir actores
hostiles con la misma identidad. Node.js no ofrece una primitiva portable
equivalente a `openat`/`renameat`; el coordinador comprueba identidad física y
falla cerrado, pero conserva una ventana TOCTOU residual ante sustituciones
concurrentes no cooperativas. Un fallo durante la liberación puede retener el
lock y requerir intervención manual para recuperar disponibilidad; no se borra
automáticamente un lock no poseído.

No se han implementado Milestone 5, cierre, archivo, reapertura, perfiles,
persistencia compartida, sincronización, servicio central, API HTTP, base de
datos, autenticación, multiusuario, multitenancy, búsqueda global ni
integraciones externas.

## Conclusión

La implementación, la validación automática y la validación manual IBM Bob de
M4 son satisfactorias. El diseño y la implementación quedan congelados. El
estado resultante es:

`MILESTONE 4 COMPLETED`
