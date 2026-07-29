# WS Workspace MCP — Pruebas de Milestone 5

## Estado

**Implementación:** `IMPLEMENTED — PENDING MANUAL IBM BOB REVALIDATION`

**Validación automática de la corrección ADR-022:** `PASS — 2026-07-29`

**Revalidación manual IBM Bob:** `PENDIENTE`

**Cierre de Milestone 5:** `NO COMPLETADO — NO CONGELADO`

Este documento registra la batería reproducible y el guion manual de
Milestone 5 y la corrección operativa ADR-022. La validación automática final
de la corrección se registra sobre el árbol de trabajo descrito en la sección 2. La revalidación IBM Bob continúa pendiente y, por tanto, M5 no está
completado ni congelado.

## 1. Contrato de evidencia

La ejecución final debe registrar:

- fecha y zona horaria;
- commit o, si el árbol no está limpio, identificador de commit y resumen de
  `git diff --stat`;
- versiones de Node.js y npm;
- comando exacto, código de salida y resumen no truncado;
- número de archivos y casos ejecutados para la suite;
- resultado del smoke compilado;
- ausencia de credenciales, datos de cliente y rutas absolutas en la evidencia
  publicada; y
- incidencias, hipótesis y decisiones diferenciadas.

No se copiarán roots reales, contenido fuente, tokens, configuración
corporativa ni datos de producción a este documento.

## 2. Secuencia automática reproducible

Ejecutar desde la raíz del repositorio, en este orden:

```text
npm.cmd run format
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run build
npm.cmd run check
npm.cmd run smoke
git diff --check
```

El `check` integrado no sustituye el registro individual anterior; confirma la
misma secuencia como una sola comprobación adicional.

### Registro de ejecución final

Ejecución finalizada: `2026-07-28T18:36:39+02:00` (`Europe/Madrid`). Base Git:
`e4e48ab42f3a`; árbol de trabajo M5 no limpio cuyo `git diff --stat` abarca 33
archivos versionados modificados, más 31 archivos nuevos identificados por
`git status --short`. Entorno: Node.js `v24.18.0`, npm `11.16.0`. No se publican
roots temporales ni contenido fuente.

| Comprobación    | Resultado | Evidencia                                                         |
| --------------- | --------- | ----------------------------------------------------------------- |
| format          | `PASS`    | Prettier: todos los archivos conformes; código de salida 0        |
| typecheck       | `PASS`    | `tsc --noEmit`; código de salida 0                                |
| lint            | `PASS`    | ESLint sin errores ni avisos; código de salida 0                  |
| test            | `PASS`    | Vitest: 37 archivos y 276 casos; código de salida 0               |
| build           | `PASS`    | `tsc -p tsconfig.build.json`; código de salida 0                  |
| smoke           | `PASS`    | Binario compilado; 38 tools descubiertas; código de salida 0      |
| check integrado | `PASS`    | format, typecheck, lint, test y build encadenados; salida final 0 |
| diff check      | `PASS`    | `git diff --check`; código de salida 0                            |

Incidencias intermedias resueltas antes de esta ejecución: la composición
paralela de los resúmenes M4 y M5 competía por el mismo lock y se hizo
secuencial; el bootstrap `PENDING` quedó aislado para su retry exacto; el
repositorio pasó a detectar artefactos M5 huérfanos; la consulta relacionada
incorporó procedencia autocontenida y coincidencia léxica exacta; y la
reapertura histórica sustituyó timestamps por el fence causal ADR-021. No
quedan incidencias automáticas abiertas.

### Registro de ejecución correctiva ADR-022

Ejecución finalizada: `2026-07-29T18:59:42+02:00` (`Europe/Madrid`). Base Git:
`1ac42ce`; árbol de trabajo sin commit con nueve archivos versionados
modificados y un test nuevo. Entorno: Node.js `v24.18.0`, npm `11.16.0`. No se
publican roots temporales, PIDs, tokens ni contenido corporativo.

| Comprobación    | Resultado | Evidencia                                                    |
| --------------- | --------- | ------------------------------------------------------------ |
| format          | `PASS`    | Prettier: todos los archivos conformes; código de salida 0   |
| typecheck       | `PASS`    | `tsc --noEmit`; código de salida 0                           |
| lint            | `PASS`    | ESLint sin errores ni avisos; código de salida 0             |
| test            | `PASS`    | Vitest: 38 archivos y 294 casos; código de salida 0          |
| build           | `PASS`    | `tsc -p tsconfig.build.json`; código de salida 0             |
| smoke           | `PASS`    | Binario compilado; 38 tools descubiertas; código de salida 0 |
| check integrado | `PASS`    | format, typecheck, lint, test y build; salida final 0        |
| diff check      | `PASS`    | `git diff --check`; código de salida 0                       |

La cobertura correctiva reproduce el origen, no sólo el estado final: crea el
claim `RELEASE`, falla antes o después de retirar el lock, falla antes de
retirar el claim, simula otra instancia y exige que el siguiente intento deje
de quedar bloqueado. También cubre error funcional más error de cleanup,
misma/otra instancia, PID reutilizado, `RECOVERY`, tokens divergentes, formatos
parciales, journal sin lock, staging seguro/desconocido y propietario legítimo
simultáneo. La suite completa preserva M1–M5, incluido el bootstrap `PENDING` y
su retry exacto.

## 3. Matriz automática de escenarios

La fuente estructurada esperada en todos los escenarios M5 es únicamente
`.ws-workspace/records/KNOWLEDGE_BASE.json`. No existe un ledger independiente
por sesión, workflow, Work Item, catálogo o relación.

| #   | Escenario                                         | Resultado esperado                                                                 | Cobertura principal                                  | Resultado |
| --- | ------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------- | --------- |
| 1   | Configurar una raíz escribible válida             | El servidor inicia sin fallback ni exposición del path                             | `workspace-config.test.ts`                           | `PASS`    |
| 2   | Omitir la raíz de proyecto                        | M1–M4.1 siguen disponibles y la activación M5 falla de forma segura                | `workspace-config.test.ts`, aplicación               | `PASS`    |
| 3   | Configurar roots iguales, solapados o de volumen  | La configuración se rechaza sin persistencia parcial                               | `workspace-config.test.ts`                           | `PASS`    |
| 4   | Localizar un dossier histórico plano              | Se resuelve sin migrarlo ni reescribirlo                                           | `work-item-locator.test.ts`                          | `PASS`    |
| 5   | Localizar un dossier M5 anidado                   | Se resuelve por iteration/type/id y exige `WORK_ITEM.yml` físico                   | `work-item-locator.test.ts`                          | `PASS`    |
| 6   | Duplicar un ID entre layouts                      | La operación falla cerrada por identidad no única                                  | `work-item-locator.test.ts`                          | `PASS`    |
| 7   | Crear un Work Item v2 mínimo                      | Se genera dossier `es-ES`, iteration y responsable sin alterar M2                  | `work-item-v2-creation-service.test.ts`, MCP         | `PASS`    |
| 8   | Reintentar la creación v2 con la misma key        | Se devuelve el resultado original sin nueva mutación                               | MCP M5 y ledger                                      | `PASS`    |
| 9   | Incorporar un histórico a workflow M5             | Se inicializa explícitamente sin mover su carpeta                                  | aplicación M5                                        | `PASS`    |
| 10  | Activar la primera sesión de un actor             | Se registra snapshot y una sola sesión `ACTIVE`                                    | aplicación M5                                        | `PASS`    |
| 11  | Activar una segunda sesión sin switch             | Se rechaza el conflicto y no hay dos sesiones activas                              | ledger/aplicación M5                                 | `PASS`    |
| 12  | Mantener varios Work Items `IN_PROGRESS`          | Los workflows coexisten aunque sólo uno tenga sesión activa por actor              | aplicación M5                                        | `PASS`    |
| 13  | Capturar inventario y hashes                      | Sólo se persisten paths relativos, tamaños, SHA-256 y metadata permitida           | `local-project-observation-adapter.test.ts`          | `PASS`    |
| 14  | Encontrar symlink, junction o reparse point       | No se sigue y no se escapa de la raíz autorizada                                   | `local-project-observation-adapter.test.ts`          | `PASS`    |
| 15  | Alcanzar límites del snapshot                     | Se cancela de forma segura sin snapshot parcial                                    | `local-project-observation-adapter.test.ts`          | `PASS`    |
| 16  | Clasificar cambios técnicos                       | Se distinguen `ADDED`, `MODIFIED`, `DELETED`, `UNCHANGED` y `REVERTED`             | observación/proyección M5                            | `PASS`    |
| 17  | Cambiar sesión A→B                                | Checkpoint, snapshots, suspensión y activación se confirman como una mutación      | aplicación/repositorio M5                            | `PASS`    |
| 18  | Registrar checkpoint manual                       | Se conserva payload, procedencia y revisión append-only                            | aplicación M5                                        | `PASS`    |
| 19  | Suspender la sesión activa                        | Se confirma snapshot, checkpoint y estado `SUSPENDED`                              | aplicación/MCP M5                                    | `PASS`    |
| 20  | Reanudar contexto                                 | Se devuelve contexto acotado, último checkpoint y diff sin contenido fuente        | aplicación M5                                        | `PASS`    |
| 21  | Repetir una mutación con key y payload idénticos  | Se devuelve la revisión resultante original sin write                              | `knowledge-base-ledger-service.test.ts`              | `PASS`    |
| 22  | Reusar una key con payload distinto               | Se devuelve conflicto de idempotencia seguro                                       | `knowledge-base-ledger-service.test.ts`              | `PASS`    |
| 23  | Enviar una revisión obsoleta                      | Se devuelve conflicto optimista sin mutación                                       | ledger/aplicación M5                                 | `PASS`    |
| 24  | Interrumpir un commit M5                          | Recovery restaura o confirma el estado permitido sin mezclar versiones             | `local-filesystem-knowledge-base-repository.test.ts` | `PASS`    |
| 25  | Ejecutar mutaciones concurrentes                  | Lock global M5 y locks ordenados impiden pérdida de actualizaciones                | repositorio M5                                       | `PASS`    |
| 26  | Añadir y retirar colaborador                      | Se preservan eventos y exactamente un responsable                                  | aplicación M5                                        | `PASS`    |
| 27  | Transferir responsabilidad                        | Requiere actor permitido y confirmación; conserva la historia                      | aplicación M5                                        | `PASS`    |
| 28  | Intentar cierre como colaborador                  | Se rechaza por autorización declarada                                              | aplicación/MCP M5                                    | `PASS`    |
| 29  | Añadir y retirar relación                         | La arista es semántica, auditable y no mueve carpetas                              | aplicación M5                                        | `PASS`    |
| 30  | Canonicalizar `RELATED_TO`                        | El orden estable evita aristas duplicadas equivalentes                             | ledger/aplicación M5                                 | `PASS`    |
| 31  | Proponer un concepto                              | Exige 1–500 `evidenceReferenceIds` UUID v4 y registra `PENDING`                    | schemas/aplicación M5                                | `PASS`    |
| 32  | Rechazar una propuesta                            | El catálogo no cambia y queda resolución append-only                               | aplicación M5                                        | `PASS`    |
| 33  | Aprobar una propuesta                             | Requiere participante declarado y confirmación; catálogo y evento son atómicos     | aplicación M5                                        | `PASS`    |
| 34  | Consolidar dossier híbrido                        | Payload estructurado y procedencia regeneran las proyecciones protegidas           | `m5-projection-service.test.ts`                      | `PASS`    |
| 35  | Proyectar implementación final                    | Los cambios `REVERTED` y `UNCHANGED` no aparecen como implementación neta          | `m5-projection-service.test.ts`                      | `PASS`    |
| 36  | Alternar mutaciones M3/M4/M5                      | Manifest e inventarios conservan todas sus secciones                               | proyección/repositorio/MCP                           | `PASS`    |
| 37  | Ejecutar revisión estructural fallida             | Los findings bloquean `complete_work_item`                                         | aplicación M5                                        | `PASS`    |
| 38  | Registrar observación semántica abierta           | Se conserva sin alterar por sí sola el resultado estructural                       | aplicación M5                                        | `PASS`    |
| 39  | Resolver observación semántica                    | Requiere confirmación y crea un evento nuevo sin borrar la observación             | aplicación/MCP M5                                    | `PASS`    |
| 40  | Completar como responsable                        | Requiere review vigente, pruebas pasadas, ausencia de sesión activa y confirmación | aplicación/MCP M5                                    | `PASS`    |
| 41  | Cancelar y reabrir explícitamente                 | Se conservan motivos, fechas e historia; no hay movimiento físico                  | aplicación M5                                        | `PASS`    |
| 42  | Mutar M3/M4 tras completar                        | El cursor supera el fence causal; dos commits reabren o convergen a no-op          | aplicación/MCP M5                                    | `PASS`    |
| 43  | Consultar conocimiento relacionado                | Candidatos, relaciones, catálogo y procedencia son autocontenidos y deterministas  | aplicación/MCP M5                                    | `PASS`    |
| 44  | Refrescar `AI_CONTEXT` explícitamente             | Combina resúmenes M4+M5 acotados sin refresh implícito                             | `mcp-m5.test.ts`                                     | `PASS`    |
| 45  | Descubrir el catálogo MCP completo                | Están las 15 tools históricas y las 23 aditivas M5, sin renombrados                | `mcp-m4.test.ts`, smoke                              | `PASS`    |
| 46  | Inspeccionar respuestas y errores representativos | No aparecen roots, paths absolutos, locks, journals ni contenido fuente            | MCP M5, smoke                                        | `PASS`    |
| 47  | Mutar sólo uno de dos dossiers                    | El watermark global avanza sólo en el afectado; el otro sigue siendo consistente   | aplicación/proyección M5                             | `PASS`    |
| 48  | Recuperar un bootstrap v2 `PENDING`               | Sólo el retry exacto adopta el dossier; M3/M4/M5 públicos no lo observan           | creación v2/repositorio M5                           | `PASS`    |
| 49  | Perder el ledger con artefactos M5 persistidos    | El inventario de dossiers impide tratar la base existente como nueva               | repositorio M5                                       | `PASS`    |
| 50  | Reintentar un cursor anterior tras otro cierre    | La frontera más reciente lo convierte en no-op aunque el timestamp coincida        | aplicación M5                                        | `PASS`    |
| 51  | Comparar concepto exacto y prefijo léxico         | Sólo frase/token exacto produce `CONFIRMED_TEXT_OCCURRENCE` y conserva su traza    | aplicación/MCP M5                                    | `PASS`    |
| 52  | Fallar al crear o retirar el claim de liberación  | El caller recibe error; lock/claim residual queda visible y correlacionado         | `work-item-lock-protocol.test.ts`                    | `PASS`    |
| 53  | Fallar al retirar lock y claim                    | Se informan ambos fallos sin ocultar el error funcional previo                     | `work-item-lock-protocol.test.ts`                    | `PASS`    |
| 54  | Reiniciar tras la ventana exacta del incidente    | Otra instancia reconcilia `RELEASE` y el retry deja de quedar bloqueado            | `work-item-lock-protocol.test.ts`                    | `PASS`    |
| 55  | Reutilizar PID con otra instancia                 | Sólo un `RELEASE` exactamente correlacionado puede completarse                     | `work-item-lock-protocol.test.ts`                    | `PASS`    |
| 56  | Encontrar `RECOVERY` vivo o lock remoto vivo      | Se devuelve conflicto y se preservan los artefactos                                | `work-item-lock-protocol.test.ts`                    | `PASS`    |
| 57  | Encontrar formato parcial o tokens divergentes    | No se borra nada y el estado falla cerrado                                         | `work-item-lock-protocol.test.ts`                    | `PASS`    |
| 58  | Journal válido sin lock                           | Se adquiere el gate y recovery restaura el estado confirmado                       | `work-item-lock-protocol.test.ts`                    | `PASS`    |
| 59  | Staging sin journal seguro o desconocido          | El seguro se retira; el desconocido se conserva con error de recovery              | `work-item-lock-protocol.test.ts`                    | `PASS`    |
| 60  | Ejecutar dos propietarios legítimos simultáneos   | El segundo recibe conflicto mientras el primero permanece registrado               | `work-item-lock-protocol.test.ts`                    | `PASS`    |
| 61  | Observar `RELEASE` del propietario local activo   | No se reconcilia mientras la operación exacta siga registrada                      | `work-item-lock-protocol.test.ts`                    | `PASS`    |
| 62  | Combinar lock y `RELEASE` con journal válido      | Se preservan los tres artefactos y se devuelve conflicto                           | `work-item-lock-protocol.test.ts`                    | `PASS`    |

## 4. Plan de validación manual IBM Bob

### 4.1 Precondiciones

1. Finalizar la secuencia automática con evidencia `PASS`.
2. Compilar el mismo estado del código que se validará manualmente.
3. Crear dos directorios temporales, separados y no solapados:
   uno escribible para `WS_WORKSPACE_ROOT` y otro de sólo lectura lógica para
   `WS_PROJECT_SOURCE_ROOT`.
4. Registrar el servidor compilado en IBM Bob por stdio con ambas variables.
5. No usar un workspace real, un repositorio corporativo ni datos de cliente.
6. Preparar identificadores ficticios, UUID v4 nuevos y actores declarados de
   prueba.

### 4.2 Registro operativo previo

Usar exclusivamente datos ficticios y anotar los valores devueltos por el
servidor; ningún ID, revisión o path se inventa ni se reutiliza entre ejecuciones.

| Referencia | Participante ficticio | Rol inicial      | Rol que debe verificarse               |
| ---------- | --------------------- | ---------------- | -------------------------------------- |
| Actor A    | UUID v4 nuevo         | responsable de A | colaborador tras B8                    |
| Actor B    | UUID v4 nuevo         | sin rol inicial  | colaborador y después responsable de A |

| Referencia  | Uso                           | Estado inicial esperado |
| ----------- | ----------------------------- | ----------------------- |
| Work Item A | flujo M5 principal            | `IN_PROGRESS` tras B3   |
| Work Item B | destino del switch y relación | `IN_PROGRESS` tras B3   |
| Histórico H | compatibilidad de B4          | sin mover ni migrar     |

| Dato obtenido dinámicamente         | Valor a registrar durante la ejecución |
| ----------------------------------- | -------------------------------------- |
| revisiones globales y por Work Item | por cada mutación, antes y después     |
| session IDs y snapshot IDs          | B5, B6, B7 y B16 si se usa checkpoint  |
| plan ID, versión y test case IDs    | B13                                    |
| evidence IDs                        | B10 y B15                              |
| relation ID                         | B9                                     |
| proposal IDs y concept ID aprobado  | B10                                    |
| observation ID y review ID          | B12 y B13                              |
| boundary M3/M4 del cierre           | B14 y B15                              |

### 4.3 B0 recomendado — comportamiento sin `WS_PROJECT_SOURCE_ROOT`

Este preflight es recomendado y no forma parte de B1–B19 ni de su regla de
cierre. En una raíz temporal independiente, preparar un workflow M5 ficticio
de prueba y reiniciar temporalmente IBM Bob sin
`WS_PROJECT_SOURCE_ROOT`. Verificar que M1–M4.1 permanecen disponibles,
intentar `activate_work_session` sobre ese workflow y comprobar
`PROJECT_SOURCE_NOT_CONFIGURED` o el error contractual seguro equivalente.
Restaurar ambas variables, reiniciar IBM Bob y comenzar B1–B19 en las raíces
limpias previstas para esa batería.

| Paso | Acción                                                                     | Evidencia esperada                                     | Resultado                    |
| ---- | -------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------- |
| B0   | Omitir temporalmente la raíz de proyecto y activar una sesión M5 preparada | M1–M4.1 disponibles; fallo M5 seguro sin exponer paths | `RECOMENDADA — NO EJECUTADA` |

### 4.4 Recorrido manual B1–B19

| #   | Acción en IBM Bob                          | Evidencia esperada                                       | Resultado   |
| --- | ------------------------------------------ | -------------------------------------------------------- | ----------- |
| B1  | Descubrir capabilities y catálogo          | 38 herramientas exactas, sin paths absolutos             | `PENDIENTE` |
| B2  | Inicializar dos veces                      | resultado inicial y retry idempotente, sin roots         | `PENDIENTE` |
| B3  | Crear A y B por v2                         | bootstrap M3/M4/M5 completo y dossier `es-ES`            | `PENDIENTE` |
| B4  | Inicializar histórico H                    | sólo artefactos M5 autorizados; sin migración            | `PENDIENTE` |
| B5  | Activar sesión de A con Actor A            | snapshot y sesión activa, sin contenido fuente           | `PENDIENTE` |
| B6  | Checkpoint, consulta activa y reanudación  | contexto acotado y revisiones trazables                  | `PENDIENTE` |
| B7  | Cambiar A→B y suspender B                  | A suspendido, B activo y después ninguna sesión A        | `PENDIENTE` |
| B8  | Añadir B y transferir responsabilidad      | responsable, rol final de A e historial coherentes       | `PENDIENTE` |
| B9  | Relacionar A y B                           | dos perspectivas derivadas, sin movimiento físico        | `PENDIENTE` |
| B10 | Proponer, rechazar y aprobar concepto      | evidencia real, supresión equivalente y catálogo oficial | `PENDIENTE` |
| B11 | Consolidar A y refrescar contexto          | proyecciones 09–12 y resumen M4+M5 explícito             | `PENDIENTE` |
| B12 | Registrar y resolver observación semántica | ambas entradas visibles; A continúa `IN_PROGRESS`        | `PENDIENTE` |
| B13 | Preparar review estructural aprobado       | plan, ejecuciones, sesión y consolidación válidos        | `PENDIENTE` |
| B14 | Rechazo de A y cierre por B                | `COMPLETED`, `CLOSED`, fence y dossier inmóvil           | `PENDIENTE` |
| B15 | Decisión M4 post-cierre y retry exacto     | reapertura causal única en segundo commit M5             | `PENDIENTE` |
| B16 | Idempotencia de una mutación M5            | retry sin write y conflicto key/payload diferenciado     | `PENDIENTE` |
| B17 | Reiniciar Bob y releer                     | persistencia y derivación estables                       | `PENDIENTE` |
| B18 | Revisar respuestas capturadas              | sin datos o ubicaciones sensibles                        | `PENDIENTE` |
| B19 | Comparar watermarks A/B                    | sólo A avanza; B sigue consistente                       | `PENDIENTE` |

### 4.5 Detalle ejecutable de B1–B19

#### B1 — Catálogo exacto

Invocar `health_check` y `get_server_capabilities`. Registrar 38 herramientas:
las 15 históricas exactas son `health_check`,
`get_server_capabilities`, `initialize_workspace`, `create_work_item`,
`initialize_work_item_documents`, `get_work_item_document`,
`update_work_item_document`, `refresh_ai_context`,
`initialize_work_item_tracking`, `record_decision`, `record_checkpoint`,
`define_test_plan`, `record_test_execution`, `register_evidence_reference` y
`get_work_item_tracking`. Comparar las otras 23, sin omisiones ni renombrados,
con la tabla exhaustiva de herramientas aditivas de la sección 18.2 de
`MILESTONE_5_DESIGN.md`. Registrar cualquier herramienta inesperada como
incidencia y comprobar que ninguna respuesta revela una raíz absoluta.

#### B2 — Inicialización

Ejecutar `initialize_workspace` dos veces sobre la misma raíz temporal.
Conservar los resultados creados/existentes y cualquier revisión aplicable que
el servidor devuelva, sin publicar roots. La segunda llamada debe ser un retry
idempotente, no una nueva inicialización.

#### B3 — Creación v2 completa

Crear A y B mediante `create_work_item_v2`, con iteración, responsable e
idempotency keys nuevas. Para cada respuesta y dossier, comprobar el layout
`iteration/type/id`, rendering `es-ES`, iteración, responsable, workflow M5,
M3 y M4 inicializados, fuente M5 actualizada, artefactos 09–12 presentes,
secciones M5/M4/M3 del manifest, marker bootstrap no `PENDING` y revisiones
coherentes. Los valores se obtienen de respuestas reales y lecturas autorizadas.

#### B4 — Histórico

Antes de `initialize_work_item_workflow`, registrar hashes de los archivos
históricos que no deben ser afectados. Confirmar después que H no se mueve,
que esos archivos conservan sus bytes y que sólo se crean o modifican
artefactos, campos y secciones expresamente autorizados por M5. No debe haber
migración destructiva.

#### B5 — Activación

Identificar A y Actor A. Activar `activate_work_session` y comprobar snapshot
obligatorio, session ID, estado activo y paths exclusivamente relativos. La
evidencia no puede incluir contenido de la raíz de proyecto.

#### B6 — Checkpoint y contexto

En este orden, ejecutar `record_session_checkpoint`, `get_active_work_session`
y `resume_work_session_context`. Registrar la revisión usada y la resultante de
cada mutación, el checkpoint ID y el contexto acotado devuelto.

#### B7 — Switch y suspensión

Cambiar la sesión de Actor A de A a B. Comprobar que A queda suspendido y B
activo; suspender B explícitamente; confirmar después que Actor A no tiene
sesión activa. Registrar snapshots, checkpoint, session IDs y revisiones
resultantes.

#### B8 — Participantes

Actor A añade a Actor B como colaborador. Actor A transfiere la responsabilidad
a B con `confirmation: true`. Consultar el workflow para comprobar a B como
responsable, registrar el rol final de A que devuelva la implementación y
preservar el historial de transferencia.

#### B9 — Relación

Crear una relación entre A y B, preferentemente dirigida para observar sus dos
perspectivas derivadas. Consultar conocimiento relacionado desde ambos Work
Items y comprobar tipo/perspectiva, procedencia, evidencia y relation ID.
Confirmar que ninguna carpeta cambia.

#### B10 — Conceptos y evidencias

Registrar primero una referencia M4 E1 con `register_evidence_reference`.
Proponer un concepto con E1, rechazarlo y repetir exactamente el concepto con
la misma evidencia: no debe aparecer una segunda propuesta equivalente ni un
evento adicional. Registrar E2, proponer de nuevo con evidencia nueva y aprobar
con Actor B y `confirmation: true`. Verificar que sólo la propuesta aprobada
aparece en el catálogo oficial; propuestas locales y sus resoluciones siguen
trazables. Usar exclusivamente IDs devueltos por respuestas reales.

#### B11 — Consolidación

Consultar primero el workflow y su revisión vigente de A. Ejecutar
`consolidate_work_item_dossier`, comprobar las proyecciones 09–12 y su
procedencia, y sólo después ejecutar `refresh_ai_context` como una operación
explícita separada. Confirmar el resumen M4+M5 y no presentar la consolidación
como un refresh automático de `AI_CONTEXT`.

#### B12 — Observación semántica

Registrar una observación semántica mediante `review_work_item` y resolverla
con `resolve_semantic_observation` y confirmación. A sigue `IN_PROGRESS` en
este punto, por lo que no se espera reapertura. La observación original y su
resolución deben seguir visibles.

#### B13 — Preparación del review aprobado

Consultar el estado M4, definir o actualizar un plan activo y registrar una
ejecución `PASSED` para cada caso activo. Verificar que no hay sesión activa y
que A continúa consolidado. Ejecutar `review_work_item`, obtener un resultado
estructural aprobado y conservar review ID, plan ID, test case IDs y revisiones
para el cierre.

#### B14 — Autorización y cierre

Actor A, ya colaborador, intenta cerrar y debe ser rechazado sin mutación.
Volver a leer la revisión vigente. Actor B, responsable, completa con
`confirmation: true`. Comprobar `COMPLETED`, proyección legacy `CLOSED`, fecha
real de cierre, ausencia de sesión activa y dossier inmóvil. Registrar desde el
workflow la frontera M3/M4 (`HistoricalMutationBoundary`) capturada al cierre.

#### B15 — Reapertura causal ADR-021

Después del cierre, registrar una decisión M4 material. Comprobar que su commit
M4 se confirmó, que su `auditRevision` supera el fence registrado y que el
segundo commit M5 cambia A a `IN_PROGRESS` con proyección `REOPENED` y actor
`SYSTEM`. No describir ambos commits como una única transacción física.
Confirmar que el dossier no se mueve. Repetir exactamente la mutación M4 y
verificar que no crea otra reapertura.

#### B16 — Idempotencia M5

Elegir una mutación M5 segura y anotar su operación, key, payload y revisión
original; se recomienda un `record_session_checkpoint` de una sesión de prueba
activada a tal efecto y suspendida después. Ejecutar la llamada válida y su
retry exacto con la misma key y payload: debe devolver el resultado original sin
escritura ni evento adicional. Reutilizar la key con payload distinto y exigir
el conflicto de idempotencia. No mezclar este índice M5 con la idempotencia M4.

#### B17 — Reinicio

Reiniciar IBM Bob y volver a consultar workflow, sesión y conocimiento
relacionado. Confirmar persistencia y derivación estable. Este paso valida
persistencia normal; no simula por sí solo recovery de una transacción
interrumpida.

#### B18 — Seguridad de respuestas

Inspeccionar cada respuesta cuando se produce y realizar aquí una revisión
agregada final. No debe aparecer raíz, path absoluto, código fuente, lock,
staging, journal, dato sensible ni configuración corporativa.

#### B19 — Watermark por dossier

Leer los manifests A y B inmediatamente antes de una mutación exclusiva de A y
registrar ambos `Knowledge revision`. Ejecutar la mutación, releer ambos
manifests y comprobar que A avanza, B conserva exactamente su watermark y B
sigue consistente aunque haya avanzado la revisión global.

### 4.6 Evidencia manual que debe adjuntarse

- fecha, versión de IBM Bob y plataforma;
- configuración redactada que muestre ambas variables sin revelar sus valores;
- catálogo exacto de B1 y referencia a la sección 18.2 de
  `MILESTONE_5_DESIGN.md`;
- tablas de actores, Work Items, IDs dinámicos y revisiones antes/después;
- inputs ficticios y respuestas JSON redactadas de B1–B19;
- confirmaciones humanas utilizadas;
- clasificación de cada error observado: validación de schema, regla de dominio
  o conflicto de revisión;
- baseline anterior y posterior de los dos manifests en B19;
- veredicto por paso, incidencias y reintentos;
- confirmación explícita de que no hubo escrituras bajo la raíz de proyecto; y
- confirmación de limpieza de las raíces temporales.

### 4.7 Revalidación correctiva ADR-022

La revalidación posterior a esta corrección debe usar primero roots
desechables. Con el servidor recompilado, ejecutar una mutación M5 válida, su
retry exacto, reiniciar IBM Bob y repetir una operación de lectura y otra
mutación. Al quedar el servidor ocioso no deben permanecer lifecycle locks ni
recovery claims de esas operaciones. Las respuestas deben conservar los
códigos MCP históricos y no exponer metadata del protocolo.

Los fallos de liberación, PID reutilizado, tokens divergentes, claim-only,
journal sin lock y staging desconocido se validan mediante la suite automática;
no deben provocarse cambiando permisos ni manipulando ficheros mientras IBM Bob
opera sobre un workspace corporativo.

Si el workspace corporativo conserva los artefactos históricos que originaron
la incidencia, el tratamiento es una intervención operativa separada y
explícitamente autorizada:

1. detener todas las instancias IBM Bob/MCP que escriban en ese root y verificar
   que no queda una operación en curso;
2. limitar el inventario a los IDs afectados; no borrar ni mover `.locks`,
   `.staging` o `records` de forma global;
3. capturar para evidencia redactada los nombres relativos, hashes, schema,
   purpose y correspondencia lock/claim, sin publicar paths absolutos, PID,
   tokens ni datos corporativos;
4. confirmar que no existe el transaction directory scoped ni journal para el
   ID antes de intervenir sobre un `RELEASE` histórico;
5. dado que los artefactos `1.0.0` no contienen identidad correlacionada, no
   forzar su auto-recovery: con aprobación del responsable operativo, mover los
   ficheros exactos a una cuarentena recuperable dentro del root autorizado y
   conservarlos hasta cerrar la incidencia; y
6. iniciar el build corregido, ejecutar una única operación controlada, exigir
   ausencia de residuo `2.0.0` al finalizar y después completar B1–B19.

Un formato parcial, un link, un journal/staging presente, tokens no
correlacionados o duda sobre un propietario activo detienen la intervención.
No se limpia por antigüedad y no se reutiliza este procedimiento para otros
IDs sin una autorización nueva.

## 5. Regla de cierre

Mientras exista cualquier resultado `PENDIENTE` o `FAIL`, el estado permanece:

```text
IMPLEMENTED — PENDING MANUAL IBM BOB REVALIDATION
```

Un `PASS` automático no autoriza por sí solo `COMPLETED — FROZEN`. Ese cierre
requiere que B1–B19 y la sección 4.7 tengan evidencia manual satisfactoria, que
las incidencias bloqueantes estén resueltas y que exista una decisión
documental separada de cierre. Este documento no adopta esa decisión.
