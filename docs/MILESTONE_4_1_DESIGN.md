# WS Workspace MCP — Milestone 4.1A

## Diseño de configuración y localización documental

**Estado del diseño:** `APPROVED — FROZEN`  
**Estado de implementación M4.1B:** `IMPLEMENTED — AUTOMATIC VALIDATION PASS — MANUAL IBM BOB VALIDATION PASS`  
**Estado de Milestone 4.1:** `COMPLETED — FROZEN`  
**Naturaleza:** diseño arquitectónico congelado e implementación conforme al
contrato, con validación automática y manual IBM Bob completadas; M4.1 queda
oficialmente cerrado.

## 1. Resumen ejecutivo

M4.1A congela el contrato para localización de la prosa documental propiedad del
sistema en nuevos Work Items. M4.1B usa una configuración local del workspace
y persiste el snapshot inmutable de rendering como metadata técnica en el
`00_MANIFEST.md` de cada dossier nuevo. Las operaciones posteriores resuelven el
perfil desde ese marker, no desde una variable de entorno ni una decisión mutable.

El único idioma público soportado es `es-ES`. Los dossiers sin marker mantienen
el baseline inglés histórico. M1–M4, el modelo `WorkItem`, `WORK_ITEM.yml`, el
ledger, los bloques M3/M4, locks, journal, recovery y las quince herramientas
MCP permanecen congelados.

## 2. Motivación funcional

El contexto generado por el sistema debe ser legible de forma consistente para
personas y asistentes. Esa elección no puede reinterpretar revisiones o
documentos ya creados cuando cambie el entorno o una futura política. El diseño
prioriza determinismo histórico, trazabilidad y compatibilidad.

## 3. Estado de la baseline

**Hecho verificado.** M1–M4 están `COMPLETED — FROZEN` y el runtime actual sólo
recibe `WS_WORKSPACE_ROOT`; sus artefactos actuales están en inglés.

**Decisión congelada.** Este documento define el contrato que M4.1B implementa.

**Hecho verificado.** M4.1B implementa este contrato y ha superado `format`,
`typecheck`, `lint`, `test` (158 tests), `build`, `check` y `smoke`. La
validación manual IBM Bob de M4.1B también ha superado; M4.1 está cerrado y
congelado.

## 4. Alcance

M4.1A aprueba la fuente de verdad por workspace, JSON estricto, marker/snapshot
en manifest, perfiles, proveedores, artefactos generados, compatibilidad
histórica, errores, precedencia, seguridad y pruebas futuras.

## 5. Fuera de alcance

No implementa M5, herramientas o schemas MCP nuevos, idioma por petición,
traducción de payload humano o datos de negocio, sidecar, migración de dossiers,
integraciones, perfiles de tecnología/proyecto, almacenamiento compartido,
cambios de estado, ledger, locks M3/M4, journal, recovery ni semántica
funcional de `AI_CONTEXT`. No existirá `WS_DOCUMENT_LANGUAGE`.

## 6. Clasificación de contenido

| Clase                     | Regla                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------- |
| Prosa visible del sistema | Debe provenir del `DocumentContentProvider` del perfil efectivo.                       |
| Payload y datos humanos   | Se persisten y representan literalmente; no se traducen.                               |
| Tokens técnicos           | No se traducen: claves, IDs, rutas, ficheros, enums, errores, schemas y bloques M3/M4. |
| Snapshot                  | Metadata técnica de rendering; no es contenido de negocio ni auditoría.                |

“Español” significa prosa del sistema para nuevos dossiers, no traducción
automática de todo texto que pueda aparecer en ellos.

## 7. Configuración persistida del workspace

La única fuente de verdad es:

```text
.ws-workspace/config/workspace-config.json
```

Es local al `WS_WORKSPACE_ROOT` autorizado, no se expone por MCP y no devuelve
rutas absolutas. `WS_WORKSPACE_ROOT` continúa como única configuración del
proceso; no existe segunda fuente de verdad de idioma.

## 8. Contrato exacto de workspace-config.json

La creación publica el contenido canónico, con un único newline final:

```json
{
  "schemaVersion": "1.0.0",
  "documentLanguage": "es-ES"
}
```

Sólo se permiten `schemaVersion` y `documentLanguage`. Sus valores son
respectivamente `1.0.0` y `es-ES`, exactos y case-sensitive. La lectura tolera
orden de claves y whitespace JSON, pero no claves desconocidas, valores vacíos,
aliases, `es`, `ES-es`, otros locales ni versiones. Se limita a 4 KiB antes de
parsear. Un archivo inválido no se repara ni normaliza.

## 9. Inicialización y workspaces históricos

`initialize_workspace` puede materializar la configuración si falta.
`create_work_item` puede hacer un ensure defensivo antes de crear un Work Item
nuevo, sólo tras las comprobaciones de seguridad existentes. Un workspace sin
configuración no equivale a un workspace inglés: la materialización sólo fija
futuros dossiers, no modifica, regenera ni traduce ninguno existente.

El archivo es create-once e inmutable en M4.1. La primera creación debe publicar
de forma atómica y create-if-absent desde un temporal. Si hay carrera, se valida
el archivo del ganador y sólo se continúa si es válido y equivalente. Nunca se
sobrescribe uno válido, ni se repara uno inválido. No se introduce workspace lock
mutable; una configuración editable necesitaría otro diseño.

## 10. Modelo DocumentLanguageCode

El tipo público persistido es cerrado:

```ts
type DocumentLanguageCode = 'es-ES';
```

No se afirma ni soporta `en-US`, `en-GB` u otro código. La ausencia histórica de
marker representa compatibilidad, no una alternativa pública de idioma.

## 11. Modelo DocumentRenderingProfileId

Los perfiles internos persistibles son:

```ts
type DocumentRenderingProfileId = 'ES_ES_V1' | 'EN_BASELINE_V1';
```

`ES_ES_V1` es el contrato español congelado. `EN_BASELINE_V1` representa los
bytes ingleses históricos exactos de M1–M4; no es configurable ni equivale a una
variante nacional de inglés. Cambiar bytes contractuales exige otro profile ID.

El contrato técnico interpretado desde el marker es:

```ts
interface DocumentRenderingSnapshotV1 {
  schemaVersion: '1.0.0';
  documentLanguage: DocumentLanguageCode;
  renderingProfile: 'ES_ES_V1';
}
```

Los nombres de clase no se persisten; se persisten idioma y perfil para que un
futuro cambio de mapping no reinterprete dossiers ya creados.

## 12. Providers documentales

La interfaz interna aprobada es:

```ts
interface DocumentContentProvider {
  readonly profileId: DocumentRenderingProfileId;
  // Prosa y etiquetas propiedad del sistema para un artefacto conocido.
}
```

M4.1B implementa `EsEsDocumentContentProviderV1` y
`BaselineEnglishDocumentContentProviderV1`. Los renderers combinan contenido del
provider con tokens técnicos y payload humano literal. El dominio `WorkItem` no
conoce idioma/perfil; los repositorios filesystem conservan y validan bytes, no
seleccionan providers. Los servicios M3/M4 resuelven el perfil efectivo dentro
de sus límites de lock y snapshot.

## 13. Registro de artefactos generados

Un `GeneratedArtifactKind` cerrado y un registro exhaustivo vinculan cada
artefacto de prosa del sistema con fragmentos por provider: README nuevo de
workspace, presentación de manifest, documentos M2/M3, `AI_CONTEXT`, `AI_RULES`,
`NEXT_TASK`, proyecciones M4, resumen de auditoría, títulos, encabezados,
etiquetas, notices, placeholders, instrucciones y texto auxiliar.

Fuera de providers sólo pueden existir contenido humano literal y tokens
técnicos inventariados. La comprobación es por tipos exhaustivos, pruebas de
completitud, golden fixtures, escaneo/AST focalizado y una allowlist mínima; no
se usa una prohibición ESLint global de strings.

## 14. Snapshot del Work Item

El snapshot se persiste exclusivamente como metadata técnica del `00_MANIFEST.md`
de un Work Item nuevo. No modifica `WORK_ITEM.yml`, no es campo de `WorkItem`,
no es entrada de ledger y no es editable por MCP. Una vez creado, el marker fija
documentLanguage y renderingProfile para toda generación, actualización o
proyección posterior del dossier.

## 15. Marker exacto y posición

El `00_MANIFEST.md` nuevo bajo `ES_ES_V1` contiene exactamente una vez:

```html
<!-- WS-WORKSPACE-MCP:DOCUMENT_RENDERING_SNAPSHOT schemaVersion=1.0.0 documentLanguage=es-ES renderingProfile=ES_ES_V1 -->
```

La forma exigida empieza con el H1 localizado, una línea vacía y el marker,
antes de cualquier `##`. Está fuera de bloques técnicos M3/M4, en una sola línea
con nombres, orden y casing canónicos. El parser admite LF y CRLF; los bytes
exteriores deben preservarse. Ninguna operación soportada puede modificar o
eliminar el marker. No hay sidecar.

## 16. Parser y reglas de validación

Un parser estructural —no una búsqueda de subcadena— valida el manifest:
unicidad, texto exacto, ubicación, atributos sin extras, schema, combinación
idioma/perfil y perfil soportado. Marker duplicado, parcial, malformado,
desplazado, con schema desconocido o combinación incoherente falla cerrado.

Una ausencia total de marker resuelve `EN_BASELINE_V1` para compatibilidad
histórica. La distinción entre histórico y marker español completamente borrado
es el riesgo residual aceptado, no un motivo para modificar los contratos M1–M4.

## 17. Riesgo residual aceptado

Un borrado manual completo del marker español puede hacer un dossier
indistinguible de uno histórico inglés. Se acepta porque ninguna herramienta
soportada lo elimina, el manifest está cubierto por hashes, backups y recovery,
y las proyecciones canónicas M4 normalmente detectan una selección incorrecta.
Eliminar la ambigüedad requeriría sidecar, segundo indicador o cambio invasivo
de contrato. No se autoriza autoreparación ni reescritura de contenido humano.

## 18. ADR sobre naturaleza del marker

El `DocumentRenderingSnapshot` es metadata técnica interna. No es contenido
funcional o de negocio del Manifest, ni `Decision`, `Checkpoint`, test,
evidencia o dato para integraciones externas. Su única función es fijar y
validar determinísticamente el contrato de rendering documental.

## 19. Resolución del perfil efectivo

1. Marker válido en `00_MANIFEST.md`: usar el perfil persistido y su provider.
2. Sin marker: usar `EN_BASELINE_V1` y preservar el baseline existente.
3. Marker presente inválido: error cerrado; no hay fallback inglés.

La configuración de workspace sólo interviene al crear el marker de un Work
Item nuevo. No participa al actualizar ni leer un dossier existente.

## 20. Integración con creación M2

M2 mantiene su dossier mínimo, contrato de `create_work_item`, datos de negocio
y respuestas MCP. M4.1B sólo asegura configuración y crea el marker en
`00_MANIFEST.md` junto con la plantilla de sistema española. No toca
`WORK_ITEM.yml`; todo input humano se conserva literal.

## 21. Integración con documentos M3

M3 conserva documentos, payloads, inventario de siete, revisiones y conflictos.
Antes de renderizar prosa de sistema resuelve el perfil dentro del lock existente
y lo reverifica antes del commit. El compositor preserva el marker, sus bytes
exteriores y los bloques M3. No hay regeneración automática de históricos.

## 22. Integración con AI_CONTEXT

`AI_CONTEXT` conserva operación explícita, estado DERIVED, límite 16 KiB y
exclusiones M4. Su prosa de sistema futura procede del provider; texto humano y
datos no se traducen. No se amplía contrato ni se añade refresh.

## 23. Integración con proyecciones M4

Ledger, siete operaciones, IDs, revisiones, idempotencia, proyecciones, manifest
lossless, lock compartido y recovery M4 siguen congelados. Las proyecciones
nuevas reciben prosa del provider y conservan tokens M4 estrictos. La alternancia
M3/M4 debe conservar marker, bloques e integridad byte-compatible.

## 24. Compatibilidad histórica

No hay backfill ni migración. Un dossier sin marker usa `EN_BASELINE_V1` sin
reescribir manifest, `WORK_ITEM.yml`, Markdown, ledger, `AI_CONTEXT`,
`AI_RULES`, `NEXT_TASK`, README ni proyecciones. Una migración futura deberá ser
explícita y auditable.

## 25. Lecturas ante metadata corrupta

`health_check` y `get_server_capabilities` continúan porque no renderizan ni
validan proyecciones. `get_work_item_document` puede devolver contenido
persistido cuando su lifecycle es válido; no renderiza ni valida canónicamente el
marker. No pueden continuar inicialización/actualización/refresh M3, mutaciones
M4, comparaciones de proyección ni `get_work_item_tracking` cuando requieran
equivalencia canónica. Esta matriz no modifica los contratos de lectura actuales.

## 26. Errores y precedencia

M4.1B añade sólo estos códigos aditivos:

- `WORKSPACE_CONFIGURATION_INVALID`
- `DOCUMENT_RENDERING_SNAPSHOT_INVALID`

Los mensajes públicos quedan en inglés y no exponen rutas absolutas, contenido
completo de configuración/manifest ni datos sensibles. Precedencia: seguridad
de filesystem y Work Item/lifecycle; parseo de ledger real cuando aplique;
marker/perfil; igualdad canónica de proyección; payload y precondiciones. Un
ledger corrupto no se oculta por rendering; un renderer mal resuelto no causa un
falso conflicto de proyección antes del error de snapshot.

## 27. Regla contra prosa hardcodeada

Toda prosa visible persistida por el sistema procede del provider. Se excluyen
payload humano, tokens técnicos, nombres/rutas, keys, schemas, IDs, enums,
errores, MCP, gramáticas M3/M4 estrictas y código. M4.1B aplica registro
tipado, providers exhaustivos, golden `EN_BASELINE_V1` byte-exactos, estructura
`ES_ES_V1`, sentinels de payload, AST/escaneo focalizado, allowlist, checklist
en `DEVELOPMENT.md` y revisión humana de generadores.

## 28. Glosario es-ES

| Término             | Forma aprobada           |
| ------------------- | ------------------------ |
| Work Item           | Work Item                |
| Work Item Manifest  | Manifiesto del Work Item |
| Functional Analysis | Análisis funcional       |
| Current State       | Estado actual            |
| Technical Analysis  | Análisis técnico         |
| Impact Analysis     | Análisis de impacto      |
| Implementation Plan | Plan de implementación   |
| AI Context          | Contexto de IA           |
| AI Rules            | Reglas de IA             |
| Next Task           | Siguiente tarea          |
| Decisions           | Decisiones               |
| Checkpoints         | Puntos de control        |
| Test Plan           | Plan de pruebas          |
| Test Case           | Caso de prueba           |
| Test Execution      | Ejecución de prueba      |
| Evidence References | Referencias de evidencia |
| Acceptance Criteria | Criterios de aceptación  |
| Related Components  | Componentes relacionados |
| Open Questions      | Preguntas abiertas       |
| Rationale           | Justificación            |
| Summary             | Resumen                  |
| Not provided        | No proporcionado         |

No se traducen nombres oficiales de tecnología. Cada concepto conserva una sola
forma aprobada; una variación futura requiere diseño, no corrección histórica.

## 29. Tokens técnicos no traducibles

Permanecen literales `WORK_ITEM.yml`, `AUDIT_LEDGER.json`, claves YAML/JSON,
fingerprints, enums, IDs, schemas, nombres de fichero, MCP, rutas, errores,
Document Lifecycle Inventory, Milestone 4 Audit Inventory, versiones y bloques
técnicos contractuales. Los bloques M3/M4 del manifest siguen en inglés y
byte-compatibles.

## 30. Superficie MCP sin cambios

M4.1 conserva exactamente quince tools, schemas, capabilities, discovery,
parámetros, respuestas y descripciones. No hay setter/getter de idioma, override
por Work Item ni campo nuevo. Tool descriptions y mensajes de error siguen en
inglés: no son prosa documental persistida.

## 31. Impacto por capa

| Capa            | Decisión M4.1B                            | Límite                                    |
| --------------- | ----------------------------------------- | ----------------------------------------- |
| Dominio         | Tipos técnicos de código/perfil/snapshot. | `WorkItem` y estados no cambian.          |
| Aplicación      | Resolver, providers y registry.           | No cambia caso de uso público.            |
| Infraestructura | Configuración segura y parser de marker.  | Repositorio preserva/valida bytes.        |
| MCP             | Ninguna tool/schema.                      | Errores seguros en inglés.                |
| Persistencia    | Config local y marker manifest futuro.    | Ledger, locks, journal/recovery intactos. |

## 32. Impacto contractual

Los contratos M1–M4 preservan bytes y tokens estrictos. El contrato persistido
nuevo previsto es JSON de workspace y metadata marker de `00_MANIFEST.md`, ambos
schema `1.0.0` y cerrados. No se cambian YAML de negocio, modelo WorkItem,
schemas MCP, payloads, enums, ledger ni modelo de estados.

## 33. Estrategia de pruebas y evidencia automática

M4.1B cubre: creación y segunda inicialización; ensure defensivo; JSON
inválido, claves/schema/locale inválidos, archivo no regular, symlink/junction,
publicación parcial, carrera y rutas seguras; formato, posición, unicidad,
ausencia histórica, combinación, LF/CRLF, marker corrupto y preservación en
alternancia M3/M4, rollback y recovery; golden inglés, estructura española,
provider exhaustivo, UTF-8/acentos/ñ, payload humano y allowlist; resolución
bajo lock, revalidación antes de commit, igualdad por perfil, refresh explícito
AI context y límite 16 KiB; quince MCP tools, schemas intactos, errores y
precedencia; y toda regresión M1–M4, staging, locking, journal, idempotencia,
evidence y smoke.

La evidencia automática reproducible queda registrada en
`Pruebas_Milestone_4_1.md`. La validación manual IBM Bob también ha superado;
el resumen ejecutivo documenta sus resultados sin reproducir el informe completo.

## 34. Validación manual IBM Bob

La batería manual independiente cubrió workspace nuevo español, histórico
inglés, ausencia de cambio MCP, payload humano intacto, errores seguros y
configuración/marker corruptos. Resultado: `PASS`, sin defectos de
implementación ni de contrato; las observaciones fueron no bloqueantes.

## 35. Riesgos y mitigaciones

| Riesgo                      | Mitigación                                                        |
| --------------------------- | ----------------------------------------------------------------- |
| Reinterpretar historia      | Marker inmutable por dossier y provider por perfil.               |
| Borrado completo del marker | Riesgo residual aceptado; hashes/backups/recovery y proyecciones. |
| Traducir datos humanos      | Provider sólo para prosa del sistema y sentinels.                 |
| Literales dispersos         | Registry, tipos, AST focalizado y revisión.                       |
| Configuración manipulada    | 4 KiB, JSON cerrado, filesystem seguro, fallo cerrado.            |
| Carrera inicial             | Publicación create-if-absent y revalidación.                      |
| Rotura M3/M4                | Preservación de bytes, bloques, locks y recovery.                 |

## 36. Registro de implementación

1. Tipos, validadores y configuración segura, con pruebas de filesystem/race.
2. Marker de manifest en creación M2 y compatibilidad histórica.
3. Registry/providers y golden fixtures ingleses.
4. Renderers, parser y preservación de marker sin tocar MCP/payloads.
5. Integración M3/M4, regresiones, smoke y validación IBM Bob.

Los cinco pasos están completados.

## 37. Criterios de aceptación

M4.1B está implementado y su validación automática demuestra que un workspace
nuevo crea JSON canónico y nuevos
manifests españoles con marker exacto; históricos siguen byte-compatibles en
inglés; payload/tokens se preservan; corrupción falla seguro; configuración no
se sobrescribe; MCP sigue en quince tools; y pruebas automáticas/manuales
aportan evidencia reproducible.

## 38. Criterios de cierre

M4.1A queda cerrado como diseño cuando ADR y estados concuerdan en configuración
local, `es-ES`, marker de manifest, `ES_ES_V1`, baseline `EN_BASELINE_V1`,
providers y sin variable/sidecar/MCP change. M4.1 ha completado la validación
manual IBM Bob y su cierre administrativo; no se modificaron contratos ni se
realizó commit ni push.

## 39. Decisiones congeladas

1. `workspace-config.json` es la fuente de verdad del workspace.
2. Sólo existe `DocumentLanguageCode = 'es-ES'`.
3. No hay `WS_DOCUMENT_LANGUAGE` ni parámetro MCP.
4. El marker `DocumentRenderingSnapshotV1` se persiste en `00_MANIFEST.md`.
5. `ES_ES_V1` es español nuevo; `EN_BASELINE_V1` es baseline histórico.
6. Toda prosa de sistema procede de provider; payload/tokens no se traducen.
7. Marker exacto tras H1 y antes de `##`; no hay sidecar.
8. Ausencia de marker es compatible; marker presente corrupto falla cerrado.
9. M3/M4 conservan contratos, locks, journal, recovery y bloques.
10. M4.1A está congelado; M4.1B está implementado y validado manualmente por IBM Bob.

## 40. Estado final

`Milestone 1: COMPLETED — FROZEN`  
`Milestone 2: COMPLETED — FROZEN`  
`Milestone 3: COMPLETED — FROZEN`  
`Milestone 4: COMPLETED — FROZEN`  
`Milestone 4.1A: DESIGN APPROVED — FROZEN`  
`Milestone 4.1B: IMPLEMENTED — AUTOMATIC VALIDATION PASS — MANUAL IBM BOB VALIDATION PASS`  
`Milestone 4.1: COMPLETED — FROZEN`  
`Milestone 5: READY TO START`

Este documento es la referencia canónica de M4.1A. Cualquier cambio de sus
límites, profiles, persistencia o compatibilidad exige ADR y revisión de diseño
antes de cambiar código.
