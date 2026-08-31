# WS Workspace MCP — Milestone 5

## Diseño técnico definitivo del ciclo de trabajo asistido y la base de conocimiento viva

**Estado del diseño:** `CONTRATO TÉCNICO COMPLETO — FROZEN`

**Estado de la implementación:** `IMPLEMENTED — VALIDATED — FROZEN`

**Estado de cierre de M5:** `COMPLETED — FROZEN`

Este documento es el contrato técnico de Milestone 5. Fija como entrada las
decisiones funcionales recibidas para M5, deriva las decisiones técnicas necesarias para
implementarlas sobre la arquitectura real de M1–M4.1 y preserva expresamente
los contratos históricos. Declara el contrato implementado, validado
manualmente, cerrado y congelado sin alterar contratos históricos.

Los términos **hecho histórico verificado**, **decisión M5**, **implementado**
y **diferido** se usan con significados distintos:

- **Hecho histórico verificado:** comportamiento presente en la baseline
  congelada M1–M4.1.
- **Decisión M5:** contrato que debe cumplir la implementación de este
  milestone.
- **Implementado:** comportamiento o símbolo presente en el código M5; no
  implica por sí solo resultado automático `PASS` ni validación manual.
- **Diferido:** capacidad fuera del alcance implementado de M5.

---

## 1. Objetivo

M5 introduce el incremento mínimo coherente para que WS Workspace pueda
capturar conocimiento durante el trabajo real sobre un Work Item y conservarlo
como parte de una base de conocimiento viva.

El resultado debe permitir:

1. crear o incorporar un Work Item a M5;
2. asignarle un responsable principal y colaboradores;
3. activar una sesión de trabajo por desarrollador;
4. capturar siempre un snapshot técnico determinista al activar;
5. cambiar de contexto mediante un checkpoint automático y recuperable;
6. reanudar con contexto útil;
7. conservar procedencia, relaciones y conceptos;
8. consolidar un dossier híbrido orientado a una persona futura;
9. revisar, completar, cancelar y reabrir con reglas explícitas;
10. mantener íntegros M1–M4.1, sus herramientas, dossiers y evidencias.

M5 constituye una base local y portable. No es todavía el servicio central,
el escáner de bootstrap completo ni el sistema definitivo de identidad,
sincronización o gobierno.

## 2. No objetivos

Quedan fuera de M5:

- integración directa con Rally, Copado, Salesforce u otros sistemas;
- lectura de credenciales, tokens, certificados o configuración corporativa;
- sincronización entre equipos o almacenamiento compartido;
- API HTTP, base de datos, SaaS, multi-tenancy o servicio central;
- autenticación corporativa o garantía criptográfica de identidad humana;
- escáner inicial completo de repositorios históricos;
- embeddings, motor vectorial o ranking semántico dentro del MCP;
- generación de PDF o PowerPoint;
- Technology Profiles y Project Profiles completos;
- jerarquías físicas de Work Items;
- edición libre de Markdown, rutas o JSON internos;
- traducción automática del contenido aportado por personas;
- migración automática o movimiento de dossiers históricos;
- archivado físico al completar un Work Item.

`.ws-workspace/archive` se conserva por compatibilidad, pero M5 no mueve
dossiers a esa carpeta. `COMPLETED` es un estado lógico. Esta decisión evita
que la consulta posterior o la reapertura dependan de una migración física y
supersede para M5 la antigua previsión no implementada de archivar al cerrar.

## 3. Visión y límites

La visión estable es:

> WS Workspace construye y mantiene una base de conocimiento viva de un
> proyecto software.

Los Work Items son la unidad de adquisición incremental, no el objetivo final.
El conocimiento puede proceder en el futuro de:

- adquisición inicial mediante un escáner o bootstrap;
- adquisición incremental mediante sesiones, snapshots, decisiones,
  documentación, pruebas, relaciones y conceptos de los Work Items.

La arquitectura de ejecución M5 continúa siendo:

```text
Host con IA
  → cliente MCP
    → adaptador MCP de WS Workspace
      → servicios de aplicación y dominio
        → puertos
          → adaptadores locales
            → workspace de datos y raíz de proyecto autorizada
```

IBM Bob es el cliente de referencia del MVP. Las acciones, formularios,
confirmaciones y vistas que Bob ofrezca son experiencia de cliente; ninguna
regla de dominio, persistencia, auditoría o recuperación depende de ellas.

El MCP realiza hechos deterministas. El host con IA interpreta esos hechos:

| Responsabilidad del MCP                     | Responsabilidad del host                  |
| ------------------------------------------- | ----------------------------------------- |
| inventario, hashes, tamaños y diferencias   | pertenencia probable al Work Item         |
| estado Git objetivo, cuando esté disponible | significado de un cambio                  |
| revisiones, relaciones e identidades        | resumen narrativo                         |
| validación estructural                      | revisión semántica                        |
| persistencia, locks y recovery              | propuesta de documentación                |
| proyecciones deterministas                  | detección semántica de cambio de contexto |

## 4. Baseline previa verificada

M1–M4.1 aportan:

- 15 herramientas MCP;
- `WS_WORKSPACE_ROOT` como única raíz de datos autorizada;
- creación de dossiers bajo `.ws-workspace/active/<id>`;
- siete documentos gestionados por M3;
- `records/AUDIT_LEDGER.json` M4 `1.0.0` append-only;
- cuatro proyecciones M4 protegidas;
- revisión optimista, idempotencia M4 y UUID v4;
- lock exclusivo compartido por Work Item;
- staging, journal, commit lógico, rollback y recovery;
- manifest compuesto sin pérdida;
- `ES_ES_V1` para dossiers nuevos y `EN_BASELINE_V1` para históricos.

Antes de M5, esta baseline no implementaba sesiones, snapshots técnicos, iteraciones,
participantes estructurados, procedencia M5, relaciones entre Work Items,
conceptos, cierre ni reapertura.

## 5. Vocabulario

| Término               | Definición M5                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| Work Item             | Unidad permanente de trabajo y adquisición incremental de conocimiento.                                 |
| Iteration             | Agrupación abstracta configurable; el núcleo no usa el término Sprint.                                  |
| Dossier               | Fuente de verdad agregada formada por Markdown, datos estructurados, auditoría, snapshots y evidencias. |
| Sesión                | Actividad actual de un desarrollador sobre un Work Item. No es el Work Item.                            |
| Checkpoint            | Registro recuperable del estado de una sesión en un punto controlado.                                   |
| Snapshot técnico      | Captura objetiva y determinista del árbol autorizado y, opcionalmente, de Git.                          |
| Responsable principal | Único participante responsable de calidad y cierre.                                                     |
| Colaborador           | Participante adicional que puede aportar conocimiento o cambios.                                        |
| Procedencia           | Origen y confirmación de una afirmación o evento.                                                       |
| Relación              | Arista semántica entre Work Items; nunca una carpeta.                                                   |
| Concepto              | Término oficial y reutilizable del proyecto.                                                            |
| Propuesta de concepto | Candidato local que no altera el catálogo hasta aprobación humana.                                      |
| Revisión estructural  | Comprobación determinista y bloqueante.                                                                 |
| Revisión semántica    | Observación del host, informativa y no bloqueante.                                                      |
| Proyección            | Representación derivada y regenerable desde una fuente estructurada.                                    |
| Identidad declarada   | Identidad estable suministrada por el cliente, validada por igualdad pero no autenticada.               |
| Golden Work Item      | Clasificación preparada para conocimiento validado de referencia; su gobierno completo es futuro.       |

## 6. Decisiones técnicas implementadas y congeladas

### 6.1 Dos raíces con permisos distintos

**Decisión M5:** se introduce `WS_PROJECT_SOURCE_ROOT` como binding de
despliegue explícito y de solo lectura.

- `WS_WORKSPACE_ROOT` continúa siendo la única raíz donde el servidor escribe.
- `WS_PROJECT_SOURCE_ROOT` autoriza únicamente observación técnica.
- Ambas deben ser absolutas, existentes, directorios y no raíces de volumen.
- No pueden coincidir ni contenerse entre sí.
- No existe fallback ni descubrimiento implícito.
- La ausencia de `WS_PROJECT_SOURCE_ROOT` no impide arrancar ni usar M1–M4.1.
- Una activación M5 falla con un error seguro si la raíz no está configurada.
- Ninguna respuesta ni fuente persistida conserva la ruta absoluta.

El path físico local es un binding de despliegue, no una preferencia funcional
del proyecto. Por ello puede variar entre desarrolladores sin convertir la
configuración global del proyecto en preferencias divergentes.

### 6.2 Layout dual y ausencia de migración

Los dossiers históricos siguen en:

```text
.ws-workspace/active/<workItemId>
```

Los Work Items creados por el contrato M5 se guardan en:

```text
.ws-workspace/active/<iterationStorageToken>/<workItemType>/<workItemId>
```

El `WorkItemLocator` implementado:

- lee ambos layouts;
- valida directorios físicos sin seguir enlaces;
- exige unicidad global del `workItemId`;
- rechaza dos ubicaciones para el mismo identificador;
- nunca mueve un dossier histórico automáticamente;
- nunca usa relaciones para resolver una carpeta.

`active` se conserva como namespace físico histórico y no representa el estado
canónico M5.

### 6.3 Estados canónicos y compatibilidad legacy

Los estados principales M5 son exactamente:

```text
IN_PROGRESS | COMPLETED | CANCELLED
```

El campo legacy de `WORK_ITEM.yml` se mantiene como proyección compatible:

| Estado legacy                  | Estado canónico M5 |
| ------------------------------ | ------------------ |
| `CLOSED`                       | `COMPLETED`        |
| `CANCELLED`                    | `CANCELLED`        |
| cualquier otro valor histórico | `IN_PROGRESS`      |

Al completar se persiste `CLOSED`; al reabrir se persiste `REOPENED`; al
cancelar se persiste `CANCELLED`. `KNOWLEDGE_BASE.json` y `WORK_ITEM.yml` deben quedar
consistentes en un único commit lógico.

`actualCompletionAt` conserva la fecha del último cierre confirmado. Las
fechas de todos los cierres y reaperturas permanecen en el historial
append-only de `KNOWLEDGE_BASE.json`.

### 6.4 Base de conocimiento M5 única y separada de M4

M5 no amplía ni reinterpreta `records/AUDIT_LEDGER.json`.

La única fuente estructurada M5 de todo el workspace será:

```text
.ws-workspace/records/KNOWLEDGE_BASE.json
```

Contiene en un historial append-only los Work Items registrados en M5, sesiones,
checkpoints, snapshots, participantes, procedencia, consolidaciones, relaciones,
propuestas, catálogo, revisiones y transiciones de estado. Un único índice de
idempotencia cubre todas las mutaciones M5 del workspace.

El ledger M4 continúa en schema `1.0.0`, con sus operaciones, proyecciones e
índice intactos. La base M5 aplica los mismos principios de integridad, pero
posee schema, eventos, revisión e índice propios. Los Markdown y manifests de
cada dossier son proyecciones de esta fuente workspace-level.

### 6.5 Identidad declarada

M5 usa identificadores estables desacoplados del nombre visible:

```text
ParticipantRef {
  participantId
  displayName
}
```

El servidor valida forma, pertenencia y coincidencia con el responsable o los
colaboradores. No afirma que la persona esté autenticada. Los documentos y
respuestas deben usar expresiones como “actor declarado”, no “usuario
autenticado”.

No se usa el nombre de usuario del sistema operativo como identidad.

### 6.6 Creación compatible

`create_work_item` M2 permanece sin cambios.

M5 añade `create_work_item_v2`, con entrada mínima:

- Rally ID;
- título;
- definición funcional;
- tipo;
- iteración;
- actor declarado, que se convierte en responsable principal.

`startedAt` se genera con `Clock`. Alias Salesforce, componentes y demás
contexto pueden incorporarse después. Los nuevos dossiers usan un
`WORK_ITEM.yml` versionado compatible con lectores M5; los lectores M3/M4 se
amplían de forma aditiva para aceptar v1 y v2 sin reescribir v1.

El alta completa es un bootstrap físico por fases M2→M3→M4→M5 bajo una única
exclusión global, no una transacción cross-repository. Un error controlado
retira el dossier recién creado; una caída de proceso puede dejar un dossier
parcial visible. Desde su primera publicación, el manifest contiene una huella
SHA-256 de la petición normalizada completa, sin conservar la clave ni la
identidad declarada en claro. Sólo un retry que reproduzca exactamente esa
petición puede reanudar el bootstrap; cualquier otra petición se trata como
colisión global y no repara ni adopta el dossier.

`create_work_item_v2` completa también la inicialización del workflow M5 del
dossier nuevo. Por ello, una llamada inmediata posterior a
`initialize_work_item_workflow` sobre ese mismo Work Item devuelve
`WORK_ITEM_STATE_CONFLICT`: el workflow ya existe. Este resultado es esperado y
debe usarse en futuras baterías para distinguir creación v2 de la incorporación
explícita de un dossier histórico.

### 6.7 Archivado físico

Completar, cancelar o reabrir no mueve la carpeta. Esta decisión:

- mantiene estable la identidad física;
- evita que las relaciones alteren el árbol;
- permite consulta posterior;
- evita una transacción de directorio incompatible con el coordinador actual;
- deja el archivado físico para una decisión futura independiente.

## 7. Invariantes de M5

1. Un Work Item M5 tiene exactamente un responsable principal.
2. El responsable no aparece simultáneamente como colaborador.
3. Un desarrollador tiene como máximo una sesión activa.
4. Varios Work Items pueden estar `IN_PROGRESS`.
5. Activar una sesión genera siempre un snapshot técnico confirmado.
6. Cambiar de sesión confirma primero el checkpoint de la anterior.
7. Un cambio de sesión interrumpido es recuperable e idempotente.
8. Ningún snapshot contiene contenido de archivos ni rutas absolutas.
9. El MCP no decide semánticamente a qué Work Item pertenece un cambio.
10. Los cambios revertidos no aparecen como implementación final.
11. Los cambios revertidos pueden permanecer como evidencia de sesión.
12. Una decisión o afirmación relevante tiene procedencia.
13. Una inferencia de IA no se convierte sola en configuración o conocimiento oficial.
14. Una propuesta no modifica el catálogo oficial.
15. Una propuesta rechazada idéntica no se recrea sin evidencia nueva.
16. Las relaciones nunca cambian carpetas.
17. Una relación dirigida se almacena una sola vez; su inversa es derivada.
18. Completar exige confirmación explícita del responsable principal.
19. Una revisión estructural fallida bloquea el cierre.
20. Una observación semántica no bloquea el cierre.
21. Las observaciones semánticas y sus resoluciones son append-only.
22. Una mutación sustantiva sobre un completado provoca reapertura automática.
23. Una regeneración puramente derivada no provoca reapertura.
24. Todo evento confirmado es inmutable.
25. Toda corrección se representa mediante un evento nuevo.
26. Toda mutación M5 requiere `idempotencyKey`.
27. El retry exacto se resuelve antes de una revisión obsoleta.
28. Una revisión obsoleta no escribe.
29. `KNOWLEDGE_BASE.json`, proyecciones M5, manifest y proyección legacy se confirman juntos.
30. M3, M4 y M5 comparten la exclusión física por Work Item.
31. M3/M4 pueden recuperar un journal M5 y M5 puede recuperar journals M3/M4.
32. Un estado corrupto falla cerrado y no se reconstruye silenciosamente desde Markdown.
33. Las proyecciones Markdown no son fuente de verdad.
34. `AI_CONTEXT` sólo cambia mediante `refresh_ai_context`.
35. M5 no altera el marker de rendering ni el perfil efectivo.
36. Los dossiers históricos se leen sin migración destructiva.
37. Ninguna operación acepta una ruta arbitraria.
38. Ninguna respuesta expone locks, staging, journals o paths nativos.
39. Las herramientas M1–M4.1 siguen disponibles.
40. M5 sólo se declara completado y congelado después de validación manual IBM
    Bob satisfactoria y cierre documental aprobado.
41. El valor `Knowledge revision` proyectado en cada dossier es el watermark
    global del último commit que afectó a ese dossier, no una copia que deba
    avanzar con mutaciones de otros Work Items.
42. Una mutación histórica M3/M4 y su reapertura M5 usan dos commits físicos
    secuenciales; el bridge converge al reintentarse y no se presenta como una
    transacción física cross-repository.

## 8. Arquitectura seleccionada

```text
MCP M5 adapter
  → servicios de aplicación M5
    → servicios de dominio/codec/proyección
      → puertos M5
        → adaptadores filesystem y observación local
          → coordinador transaccional, base única y dossiers afectados
```

Componentes implementados:

```text
src/domain/
  technical-snapshot.ts
  work-item-knowledge.ts

src/services/
  knowledge-base-ledger-service.ts
  knowledge-base-application-service.ts
  knowledge-base-repository.ts
  knowledge-context-summary-service.ts
  m5-projection-service.ts
  project-observation.ts
  work-item-v2-creation-service.ts

src/filesystem/
  work-item-locator.ts
  local-filesystem-knowledge-base-repository.ts
  local-project-observation-adapter.ts
  workspace-knowledge-operation-gate.ts
  workspace-transaction-paths.ts

src/mcp/
  m5-input-schemas.ts
  server.ts
```

Los nombres son parte de la partición técnica, no nombres funcionales
corporativos ni contratos externos.

## 9. Modelo de dominio

### 9.1 Iteration

```text
IterationRef {
  iterationId: string
  displayName?: string
  storageToken: string
}
```

- `iterationId` se conserva literalmente tras trim.
- `storageToken` se deriva mediante normalización segura y estable.
- Dos IDs que colisionen en el mismo token se rechazan.
- El dominio no contiene `Sprint`.

### 9.2 Participante

```text
ParticipantRef {
  participantId: string
  displayName: string
}
```

`participantId` es opaco, estable, de 1 a 128 caracteres y admite únicamente
letras ASCII, dígitos, `.`, `_`, `:`, `@` y `-`. Nunca se utiliza directamente
como path.

### 9.3 Procedencia

```text
KnowledgeProvenance {
  source:
    MANUAL
    | AI_INFERRED
    | HUMAN_CONFIRMED
    | SYSTEM_CALCULATED
    | IMPORTED_PENDING_VALIDATION
  introducedBy?: ParticipantRef
  confirmedBy?: ParticipantRef
  evidenceReferenceIds?: UUID[]
  basedOnKnowledgeIds?: UUID[]
}
```

Reglas:

- `MANUAL` exige `introducedBy` y no admite `confirmedBy`.
- `AI_INFERRED` no admite identidades humanas en `introducedBy` ni
  `confirmedBy`; puede enlazar evidencia o conocimiento previo.
- `HUMAN_CONFIRMED` exige `confirmedBy`; `introducedBy` es opcional para
  conservar quién introdujo originalmente la afirmación.
- `SYSTEM_CALCULATED` no admite `introducedBy` ni `confirmedBy`.
- `IMPORTED_PENDING_VALIDATION` puede declarar el participante que realizó la
  importación mediante `introducedBy`, pero no admite `confirmedBy` mientras
  siga pendiente.
- En una observación semántica, toda identidad de procedencia declarada debe
  coincidir por `participantId` con el actor declarado de la operación.
- `AI_INFERRED` puede entrar en un dossier `IN_PROGRESS`.
- Configuración, responsable, cierre, catálogo oficial y relaciones críticas
  requieren una operación humana explícita.
- `IMPORTED_PENDING_VALIDATION` nunca se presenta como conocimiento oficial.
- Una confirmación crea un evento nuevo y referencia la afirmación anterior.

### 9.4 Estado de conocimiento

```text
KnowledgeClassification {
  STANDARD
  GOLDEN
  IMPORTED_PENDING_VALIDATION
}
```

M5 prepara el campo y la lectura. No implementa todavía el gobierno para
promover automáticamente un Work Item a `GOLDEN`.

### 9.5 Ledger único de conocimiento

`.ws-workspace/records/KNOWLEDGE_BASE.json` usa schema estricto `1.0.0`:

```text
KnowledgeBaseLedger {
  schemaVersion: "1.0.0"
  knowledgeRevision: non-negative integer
  updatedAt: ISO timestamp
  operations: KnowledgeOperation[]
  idempotencyIndex: KnowledgeIdempotencyEntry[]
}

KnowledgeOperation {
  operationId: UUIDv4
  knowledgeRevision: positive integer
  operation: M5Operation
  idempotencyKey: UUIDv4
  payloadFingerprint: SHA-256
  recordedAt: ISO timestamp
  actor: ParticipantRef | SYSTEM
  events: KnowledgeEvent[]
}

KnowledgeEvent {
  eventId: UUIDv4
  eventType: KnowledgeEventType
  provenance: KnowledgeProvenance
  payload: closed event-specific payload
}

KnowledgeIdempotencyEntry {
  idempotencyKey: UUIDv4
  operation: M5Operation
  operationId: UUIDv4
  payloadFingerprint: SHA-256
  resultingKnowledgeRevision: positive integer
}
```

El estado actual nunca se persiste como segunda autoridad: se obtiene
reproduciendo `operations` y se proyecta a una vista `KnowledgeBaseState`.
Esta vista calcula revisiones lógicas por Work Item, por desarrollador y de
catálogo, además de la revisión física global.

Una mutación lógica añade una sola `KnowledgeOperation` e incrementa
`knowledgeRevision` una vez, aunque produzca varios eventos, por ejemplo
checkpoint, snapshot y cambio de sesión.

Tipos mínimos de evento:

- `WORKFLOW_INITIALIZED`
- `SESSION_ACTIVATED`
- `SESSION_SUSPENDED`
- `SESSION_CHECKPOINT_RECORDED`
- `TECHNICAL_SNAPSHOT_RECORDED`
- `COLLABORATOR_ADDED`
- `COLLABORATOR_REMOVED`
- `RESPONSIBILITY_TRANSFERRED`
- `KNOWLEDGE_CONSOLIDATED`
- `RELATION_ADDED`
- `RELATION_REMOVED`
- `CONCEPT_PROPOSED`
- `CONCEPT_PROPOSAL_RESOLVED`
- `STRUCTURAL_REVIEW_RECORDED`
- `SEMANTIC_OBSERVATION_RECORDED`
- `SEMANTIC_OBSERVATION_RESOLVED`
- `WORK_ITEM_COMPLETED`
- `WORK_ITEM_REOPENED`
- `WORK_ITEM_CANCELLED`

Los payloads son uniones discriminadas cerradas. Campos desconocidos son
corrupción al leer y validación fallida al escribir. El índice se valida contra
la operación y sus eventos; nunca se reconstruye desde las proyecciones.

## 10. Modelo de sesiones

### 10.1 Fuente estructurada

Las sesiones se derivan del ledger único `KNOWLEDGE_BASE.json`; no existe un
session store independiente:

```text
WorkSession {
  sessionId
  developer: ParticipantRef
  workItemId
  status: ACTIVE | SUSPENDED
  activatedAt
  suspendedAt?
  activationSnapshotId
  lastCheckpointId?
}
```

Sólo puede existir una sesión `ACTIVE` por `participantId`. Una sesión
suspendida conserva historia y puede dar lugar a una nueva activación de ese
Work Item con referencia al último checkpoint.

### 10.2 Activación

`activate_work_session`:

1. valida actor, sesión y Work Item;
2. exige workflow M5 inicializado;
3. exige estado canónico `IN_PROGRESS`;
4. comprueba que el actor es responsable o colaborador;
5. rechaza otra sesión activa del mismo desarrollador;
6. genera y confirma snapshot técnico;
7. registra la activación en el workflow;
8. publica la sesión como activa;
9. devuelve snapshot, último checkpoint y contexto de reanudación.

La sesión no se considera activa si el snapshot no está confirmado.

### 10.3 Cambio

`switch_work_session` es una sola mutación de la base de conocimiento. Calcula
y añade, dentro de una misma `KnowledgeOperation`:

1. snapshot y checkpoint de la sesión de origen;
2. suspensión de la sesión de origen;
3. snapshot de activación del destino;
4. activación o reanudación del destino.

La transacción física sustituye juntos `KNOWLEDGE_BASE.json` y las proyecciones
afectadas de los dos dossiers. Ningún checkpoint, snapshot o cambio de sesión
es visible por separado. Una caída antes del commit marker restaura todo el
estado anterior; una caída posterior conserva todo el estado nuevo.

El retry con la misma clave devuelve el resultado original.

### 10.4 Reanudación

Al activar de nuevo un Work Item, la respuesta incluye:

- último checkpoint;
- snapshot de activación actual;
- diferencias desde el checkpoint anterior;
- cuestiones pendientes;
- contexto relevante;
- observaciones semánticas abiertas;
- estado de revisión y dossier.

`resume_work_session_context` es una lectura y no modifica el dossier.

## 11. Snapshot técnico determinista

### 11.1 Alcance

El adaptador observa `WS_PROJECT_SOURCE_ROOT`. Recorre determinísticamente los
archivos regulares sin seguir symlinks o junctions.

Exclusiones iniciales:

- `.git/**` como árbol físico;
- `.ws-workspace/**`;
- `node_modules/**`;
- `dist/**`;
- `coverage/**`;
- entradas no regulares.

Git se consulta por un adaptador separado y opcional.

### 11.2 Datos persistidos

Cada snapshot es el payload inmutable de un evento
`TECHNICAL_SNAPSHOT_RECORDED` dentro de `KNOWLEDGE_BASE.json`. No existe un
segundo ledger de snapshots. La vista derivada usa:

```text
TechnicalSnapshot {
  snapshotId
  sessionId
  kind: ACTIVATION | CHECKPOINT | SWITCH | CLOSURE
  capturedAt
  files[]
  changes[]
  git
  exclusions[]
}

SnapshotFile {
  relativePath
  sha256
  size
  modifiedAt?
}

SnapshotChange {
  relativePath
  changeType: ADDED | MODIFIED | DELETED | UNCHANGED | REVERTED
  previousSha256?
  currentSha256?
}
```

`modifiedAt` es evidencia auxiliar; la clasificación se basa en existencia y
hash, no únicamente en fechas.

`REVERTED` significa que el hash actual coincide con el snapshot de activación
o baseline mientras un checkpoint intermedio registró otro hash. Se conserva
en sesión/auditoría y se excluye de la proyección de implementación final.

### 11.3 Git

Si Git está disponible:

- se ejecuta sin shell;
- se usan argumentos fijos;
- se desactivan optional locks y file-system monitor;
- no se ejecutan operaciones de escritura;
- no se leen ni devuelven remotes;
- se conserva HEAD y estado de archivos en rutas relativas;
- la rama observada, si se incluye, es evidencia y no parte del workflow.

Si Git no está disponible, `git.available` es `false` y el snapshot de archivos
sigue siendo válido.

### 11.4 Límites

La implementación aplica límites explícitos:

- máximo 100.000 entradas;
- máximo 512 bytes UTF-8 por ruta relativa;
- hashing por streaming;
- máximo 5 GiB leídos por snapshot;
- cancelación completa y sin persistencia parcial al superar límites.

Estos límites sólo podrán evolucionar mediante configuración versionada y
documentada.

## 12. Checkpoints

Un checkpoint contiene:

```text
SessionCheckpoint {
  checkpointId
  sessionId
  workItemId
  snapshotId
  kind: MANUAL | AUTOMATIC_SWITCH | CLOSURE
  observedWork[]
  relevantContext[]
  pendingQuestions[]
  semanticSummary?
  provenance
  recordedAt
}
```

- Snapshot y diferencias son calculados por el MCP.
- Resumen, contexto y preguntas pueden ser propuestos por el host.
- En modo degradado se conservan los hechos y las listas semánticas pueden
  quedar vacías de forma explícita.
- Un checkpoint de cambio es automático y no exige una confirmación del
  desarrollador.
- El checkpoint es append-only.
- La consolidación documental puede ocurrir en el mismo flujo o después, pero
  el cambio de sesión no pierde el checkpoint si la consolidación falla.

## 13. Participantes y responsabilidad

### 13.1 Reglas

- Todo workflow M5 inicializado tiene un responsable principal.
- Puede tener cero o más colaboradores.
- El creador de un Work Item v2 es responsable inicial.
- Un histórico requiere responsable en
  `initialize_work_item_workflow`.
- Sólo responsable o colaboradores pueden activar sesión.
- Sólo el responsable puede completar.
- El responsable actual confirma una transferencia.
- Una transferencia conserva responsable anterior, nuevo responsable, actor,
  instante y motivo.

### 13.2 Proyección legacy

`responsiblePerson` en `WORK_ITEM.yml` se mantiene como proyección legible del
`displayName` actual. El participante estructurado y el historial viven en el
`KNOWLEDGE_BASE.json`. Si ambas representaciones divergen, la lectura M5 falla cerrada.

### 13.3 Autorización local

La autorización MVP compara el `participantId` declarado con el estado
persistido. No constituye autenticación. Un futuro adaptador de identidad podrá
autenticar el mismo identificador sin cambiar el dominio.

## 14. Dossier híbrido

### 14.1 Autoridad

| Información                                                        | Autoridad                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------ |
| identidad legacy, Rally ID y tipo                                  | `WORK_ITEM.yml` versionado                             |
| estado canónico, iteración y participantes                         | `KNOWLEDGE_BASE.json`; YAML como proyección compatible |
| explicación funcional/técnica/pruebas                              | versión estructurada M5 y Markdown derivado            |
| decisiones y checkpoints históricos M4                             | `AUDIT_LEDGER.json`                                    |
| sesiones, snapshots, procedencia, relaciones, conceptos y ciclo M5 | `KNOWLEDGE_BASE.json`                                  |
| catálogo oficial                                                   | vista derivada de `KNOWLEDGE_BASE.json`                |
| contenido de evidencia                                             | fuera del control M5; sólo referencias M4              |
| lectura rápida del host                                            | `AI_CONTEXT`, derivado explícitamente                  |

### 14.2 Documentos M5

M5 no cambia los siete tipos M3 ni las cuatro proyecciones M4. Añade:

```text
09_FINAL_REPORT.md
10_FUNCTIONAL_OVERVIEW.md
11_IMPLEMENTATION.md
12_TESTING.md
```

Son proyecciones protegidas del último conocimiento consolidado de
`KNOWLEDGE_BASE.json` y, cuando aplica, de referencias del ledger M4. No
aceptan edición Markdown directa.

`10_FUNCTIONAL_OVERVIEW.md` incluye:

- propósito y comportamiento real;
- flujo funcional;
- condiciones de entrada;
- reglas de negocio;
- datos para probar;
- relaciones funcionales y Work Items relacionados.

`11_IMPLEMENTATION.md` incluye:

- componentes y tipo;
- responsabilidad de cada componente;
- cambios, dependencias y relaciones;
- decisiones de implementación;
- flujo técnico final;
- soporte abierto para Apex, LWC, Aura, Flows, Custom Metadata, Custom
  Settings, Permission Sets, Templates, Layouts y otros tipos declarados.

`12_TESTING.md` incluye:

- precondiciones y datos;
- escenarios, pasos y resultados esperados;
- regresión;
- evidencias referenciadas;
- checklist;
- revisión semántica y resolución.

`09_FINAL_REPORT.md` es el índice final coherente: estado, participantes,
fechas, revisión estructural, resumen funcional, implementación, pruebas,
decisiones y observaciones semánticas.

### 14.3 Consolidación

`consolidate_work_item_dossier` acepta un payload estructurado cerrado, nunca
Markdown. Cada versión completa se conserva como evento
`KNOWLEDGE_CONSOLIDATED`; las cuatro proyecciones se regeneran
determinísticamente.

En `IN_PROGRESS` se permiten campos incompletos visibles. Para completar, la
última versión debe satisfacer la revisión estructural.

### 14.4 AI_CONTEXT

M5 aporta un resumen determinista y acotado al proveedor compuesto de contexto.
Las mutaciones M5 no refrescan automáticamente `AI_CONTEXT`; únicamente
`refresh_ai_context` lo modifica, preservando el contrato M3/M4.

## 15. Relaciones entre Work Items

El vocabulario mínimo M5 es:

```text
RELATED_TO | DEPENDS_ON | PART_OF | REPLACES
```

- `RELATED_TO` es simétrica y se canonicaliza ordenando IDs.
- `DEPENDS_ON` es dirigida; `BLOCKS` se deriva como inversa.
- `PART_OF` es dirigida y cubre agrupación o padre/hijo semántico.
- `REPLACES` es dirigida.

Cada relación tiene UUID, Work Items fuente/destino, tipo, explicación,
procedencia y evidencia opcional.

No se guardan dos copias. La arista se conserva una sola vez en
`KNOWLEDGE_BASE.json`, con origen canónico. Las consultas agregadas resuelven
entradas y salidas. Retirar una
relación crea `RELATION_REMOVED`; no elimina su alta.

Un conjunto de ocho Work Items puede reconstruirse mediante `PART_OF` hacia un
Work Item coordinador o mediante el cierre transitivo de `RELATED_TO` y
`DEPENDS_ON`, sin anidamiento físico.

## 16. Catálogo vivo de conceptos

### 16.1 Persistencia

La fuente oficial es el mismo `KNOWLEDGE_BASE.json`. Sus eventos de concepto
son append-only para propuestas, altas, alias, cambios, rechazos y retiradas.
El catálogo consultable es una vista derivada, no otro fichero con autoridad.

### 16.2 Propuesta

```text
ConceptProposal {
  proposalId
  normalizedName
  displayName
  explanation
  evidenceReferenceIds[]
  evidenceFingerprint
  status: PENDING | APPROVED | REJECTED
  proposedBy
  resolvedBy?
  resolutionReason?
}
```

`evidenceReferenceIds` es obligatorio y contiene entre 1 y 500 UUID v4. Una
propuesta sin al menos una referencia de evidencia se rechaza en el schema MCP
antes de aplicar reglas de catálogo.

La huella de supresión incluye el nombre normalizado y el conjunto de
evidencias. Una propuesta previamente rechazada con el mismo nombre y la misma
evidencia devuelve su resultado sin crear otra, aunque cambie sólo la
redacción de la explicación. Evidencia nueva produce una huella nueva y permite
reconsideración.

### 16.3 Aprobación

- Nunca es automática.
- Requiere actor humano declarado y `confirmation: true`.
- En el MVP puede aprobar cualquier participante declarado que figure como
  responsable o colaborador de al menos un Work Item M5.
- La aprobación añade resolución y alta de catálogo en una única
  `KnowledgeOperation` y un único commit.
- El modelo de administración corporativa queda preparado mediante un puerto
  de autorización, pero no se afirma autenticación.
- Rechazar no modifica el catálogo.

La evolución profunda de una funcionalidad no crea por sí misma un concepto
nuevo.

## 17. Consulta y reutilización de conocimiento

`get_related_knowledge` devuelve candidatos estructurados y trazables:

- Work Items relacionados explícitamente;
- coincidencias exactas de conceptos;
- componentes compartidos;
- tipo e iteración;
- conocimiento clasificado como `GOLDEN`;
- conocimiento importado todavía pendiente, marcado como tal.

El orden determinista del MCP usa coincidencias y relaciones explícitas. IBM
Bob puede aplicar ranking semántico y proponer resultados al desarrollador.
El MCP nunca presenta una inferencia como relación confirmada.

Cada candidato devuelve su tipo, `IterationRef`, clasificación, relaciones,
componentes y conceptos coincidentes, `matchReasons` (`TYPE` y/o `ITERATION`)
y un score informativo. Cada relación incluye extremos, perspectiva desde el
Work Item consultado, tipo derivado, explicación, evidencia, procedencia e
instante. `componentMatches` y `conceptMatches` conservan la traza del evento
de consolidación o aprobación que justifica la coincidencia, junto con su
procedencia y evidencia. Una coincidencia textual de concepto sólo se declara
como `CONFIRMED_TEXT_OCCURRENCE` cuando existe una frase o token normalizado
exacto; no se usa semejanza parcial.

La respuesta separa `localConceptProposals`, todavía locales y con su resolución
auditable, de `projectConcepts`, ya aprobados en el catálogo global. También
incluye `catalogRevision`. No devuelve el título histórico libre del candidato
ni contenido fuente. El orden es lexicográfico por número de relaciones,
conceptos, componentes y coincidencias de tipo/iteración, después por
clasificación (`GOLDEN`, luego `IMPORTED_PENDING_VALIDATION`) y por ID. Los
candidatos de esas dos clasificaciones se incluyen aunque no compartan otra
señal; la clasificación pendiente queda visible. No se presenta ese orden como
ranking semántico.

## 18. Contratos MCP

### 18.1 Reglas comunes

- Todos los schemas son cerrados con `additionalProperties: false`.
- Toda mutación M5 recibe `idempotencyKey`.
- Toda mutación posterior a la creación/inicialización recibe
  `expectedKnowledgeRevision`.
- La revisión es única para toda la base M5; se acepta la contención global
  como simplificación consciente del MVP local.
- Todo actor usa `ParticipantRef`.
- IDs internos son UUID v4 generados por el servidor.
- Las respuestas contienen rutas relativas aprobadas, nunca paths absolutos.
- El SDK MCP valida primero que la petición satisface el JSON Schema publicado;
  una violación de forma se devuelve como resultado MCP `isError` de validación
  de entrada generado por el SDK y no entra en la aplicación ni recibe un
  código de dominio M5.
- Para toda petición válida en transporte, la validación de precondiciones
  conserva la precedencia:
  workspace → localización → baseline M3/M4 cuando aplique → M5 inicializado →
  integridad → payload → idempotencia → revisión → reglas funcionales.

### 18.2 Herramientas aditivas

| Herramienta                         | Mutación | Contrato principal                                              |
| ----------------------------------- | -------- | --------------------------------------------------------------- |
| `create_work_item_v2`               | sí       | campos mínimos, iteration, actor, idempotencia                  |
| `initialize_work_item_workflow`     | sí       | incorpora histórico con iteration y responsable                 |
| `get_work_item_workflow`            | no       | estado, participantes, revisión y revisiones                    |
| `activate_work_session`             | sí       | actor, Work Item, knowledge revision; snapshot obligatorio      |
| `switch_work_session`               | sí       | destino, knowledge revision y checkpoint semántico opcional     |
| `record_session_checkpoint`         | sí       | checkpoint de sesión activa                                     |
| `suspend_work_session`              | sí       | snapshot, checkpoint y suspensión explícita de la sesión activa |
| `get_active_work_session`           | no       | sesión activa del actor                                         |
| `resume_work_session_context`       | no       | último checkpoint, diff y contexto                              |
| `add_work_item_collaborator`        | sí       | colaborador y revisión                                          |
| `remove_work_item_collaborator`     | sí       | colaborador y revisión                                          |
| `transfer_work_item_responsibility` | sí       | nuevo responsable, motivo y confirmación                        |
| `add_work_item_relation`            | sí       | relación mínima, explicación y procedencia                      |
| `remove_work_item_relation`         | sí       | relationId y motivo                                             |
| `propose_project_concept`           | sí       | concepto, explicación y 1–500 referencias de evidencia          |
| `resolve_project_concept_proposal`  | sí       | aprobar/rechazar y confirmación                                 |
| `consolidate_work_item_dossier`     | sí       | payload humano estructurado y procedencia                       |
| `review_work_item`                  | sí       | revisión estructural calculada y observaciones semánticas       |
| `resolve_semantic_observation`      | sí       | resolución append-only de una observación semántica             |
| `complete_work_item`                | sí       | responsable, revisión válida y confirmación explícita           |
| `cancel_work_item`                  | sí       | responsable, motivo y confirmación                              |
| `reopen_work_item`                  | sí       | responsable, motivo y confirmación                              |
| `get_related_knowledge`             | no       | candidatos deterministas y procedencia                          |

Las veintitrés herramientas aditivas están implementadas. Las quince
herramientas históricas no se eliminan ni renombran.

### 18.3 Confirmaciones

`confirmation: true` es obligatorio para:

- completar;
- cancelar;
- reabrir explícitamente;
- transferir responsabilidad;
- aprobar un concepto global; y
- resolver una observación semántica.

La interfaz visual de Bob puede obtener la confirmación mediante una acción.
Otros clientes pueden enviar el mismo booleano por MCP.

### 18.4 Reapertura automática

Mutaciones sustantivas que reabren un completado:

- actualización suministrada de documentos M3;
- decisiones, checkpoints, plan, ejecución o evidencia M4;
- participantes o responsabilidad;
- consolidación;
- relaciones;
- propuesta o resolución local de concepto;
- resolución de una observación semántica;
- nuevo checkpoint o nueva sesión.

No reabren:

- lecturas;
- `refresh_ai_context`;
- regeneración idéntica de una proyección;
- retry idempotente;
- recovery que sólo restaura el último commit confirmado.

La reapertura automática usa actor `SYSTEM` si el contrato histórico no
transporta actor, conserva como desencadenante la herramienta y registra su
propia `KnowledgeOperation`. Los timestamps son evidencia de auditoría, no el
criterio causal.

Cada `WORK_ITEM_COMPLETED` persiste la frontera histórica observada al cerrar:

```text
HistoricalMutationBoundary {
  m3DocumentRevisions: Record<ManagedDocumentType, positive integer>
  m4AuditRevision: nonnegative integer
}
```

El cierre obtiene las siete revisiones M3 del inventario del manifest y la
revisión M4 del ledger/inventario mientras mantiene el gate M5 y el lock
compartido del Work Item; vuelve a comprobar que M4 sigue listo para cierre y
que ambas representaciones de su revisión coinciden.

El bridge histórico no convierte una mutación M3/M4 y la reapertura M5 en un
único commit físico. Primero se confirma el contrato histórico y después se
reevalúa el estado M5 en un segundo commit. M3 aporta tipo y revisión documental;
M4 aporta identificador de entrada y `auditRevision`. Antes de consultar la
idempotencia del bridge, ese cursor se compara con la última frontera de cierre.
Un cursor anterior o igual converge a no-op; uno posterior reabre sólo si el
estado sigue `COMPLETED`. Si ya está `IN_PROGRESS`, también converge a no-op.
Así, un retry cuya segunda fase falló puede reabrir todavía, mientras que un
retry antiguo después de un cierre posterior no lo hace. No existe una clave de
idempotencia compartida ni atomicidad cross-repository.

`initialize_work_item_documents` no dispara el bridge: una inicialización
válida posterior a un cierre no puede introducir una revisión documental nueva
y permanece como no-op histórico.

## 19. Persistencia

### 19.1 Artefactos por Work Item

```text
09_FINAL_REPORT.md
10_FUNCTIONAL_OVERVIEW.md
11_IMPLEMENTATION.md
12_TESTING.md
```

Estos artefactos son proyecciones sin autoridad. El manifest incorpora:

```text
## Milestone 5 Workflow and Knowledge Inventory
```

La sección registra schema, revisión proyectada, paths, contadores y hash de
proyecciones. `Knowledge revision` es un watermark: contiene la revisión global
de `KNOWLEDGE_BASE.json` vigente cuando ese dossier fue confirmado por última
vez. Una mutación que sólo afecta a otro dossier no reescribe este valor. La
consistencia usa `workItemRevision` y el contenido autoritativo, y normaliza el
watermark al comparar una proyección no afectada. La sección se sitúa antes del
bloque M4, que permanece antes del bloque M3.

### 19.2 Fuente de workspace

```text
.ws-workspace/records/KNOWLEDGE_BASE.json
```

Es la única fuente M5 y se crea de forma segura, estricta, idempotente y no
destructiva. Un fichero parcial o corrupto no se repara silenciosamente.

### 19.3 WORK_ITEM.yml

Se introduce un codec versionado que:

- lee dossiers históricos v1;
- lee dossiers v2;
- conserva `actualCompletionAt`;
- rechaza campos duplicados o formas no canónicas;
- serializa sólo contratos conocidos;
- no reescribe un histórico por el mero hecho de leerlo.

Las mutaciones de estado o responsabilidad actualizan la proyección YAML en el
mismo commit que `KNOWLEDGE_BASE.json`.

## 20. Auditoría e idempotencia

### 20.1 Auditoría

M4 conserva la autoridad de decisiones, checkpoints M4, planes, ejecuciones y
evidencias. M5 conserva sesiones, snapshots, participantes, procedencia,
relaciones, conceptos, revisión y ciclo de vida.

No se duplican eventos M5 dentro del ledger M4.

### 20.2 Idempotencia

`KNOWLEDGE_BASE.json` tiene un único índice global para todas las mutaciones M5
y todos los Work Items del workspace. Una clave no puede reutilizarse en otra
operación, Work Item, sesión o concepto.

La huella se calcula sobre el payload normalizado, operación y precondiciones
esperadas. Excluye IDs y timestamps generados.

Orden obligatorio:

1. validar integridad;
2. buscar `idempotencyKey`;
3. devolver retry exacto;
4. rechazar reutilización incompatible;
5. comprobar revisiones;
6. aplicar reglas;
7. confirmar.

Las claves deben ser UUID v4 suministradas por el cliente M5.

## 21. Concurrencia

### 21.1 Work Item

M5 reutiliza `.locks/<workItemId>.lifecycle.lock` para cada dossier afectado.
No crea un segundo lock por Work Item.

### 21.2 Base de conocimiento

Toda mutación M5 adquiere primero
`.locks/M5-KNOWLEDGE.lifecycle.lock`. Después adquiere los locks de los Work
Items afectados en orden lexicográfico de
`workItemId`. Un switch puede mantener los locks de origen y destino porque el
orden total impide ciclos.

Cada fase de una mutación histórica M3/M4 que deba comprobar reapertura
automática usa el mismo orden: knowledge lock y después Work Item lock. El
commit M3/M4 libera sus locks antes de que el bridge ejecute el commit M5
secuencial. Los reads invocan recovery global antes de devolver una vista.

El cierre lee y persiste su `HistoricalMutationBoundary` bajo ese mismo gate y
lock de Work Item. La lectura M4 de readiness se repite en ese ámbito y debe
coincidir con la revisión de su inventario antes de confirmar el cierre.

### 21.3 Contención

La revisión optimista M5 es únicamente `knowledgeRevision`. Todas las
mutaciones M5 serializan la fuente workspace-level. Esta contención global es
una limitación aceptada para obtener atomicidad simple y verificable dentro de
cada commit M5 del MVP local; no implica atomicidad física con un commit M3/M4
anterior. El futuro adaptador compartido podrá introducir particionado sin
cambiar los eventos de dominio.

Las revisiones M3/M4 conservan su significado y se incluyen como
precondiciones adicionales cuando una operación transversal modifica sus
artefactos.

## 22. Commit lógico y recovery

### 22.1 Transacción workspace-level

`WorkspaceKnowledgeOperationGate` y `WorkItemOperationCoordinator` operan con
base física `.ws-workspace` y confirman como una sola transacción M5:

- `records/KNOWLEDGE_BASE.json`;
- proyecciones M5 de todos los dossiers afectados;
- manifests afectados;
- `WORK_ITEM.yml` afectados.

El coordinador valida hashes, files regulares, parents físicos, allowlist,
journal e identidad del lock antes de mover o eliminar.

Para `switch_work_session`, la operación física contiene exactamente la base
M5, las proyecciones/manifest del origen y las del destino. Checkpoint,
snapshots de origen/destino, idempotencia y sesión cambian juntos o no cambia
nada.

### 22.2 Journal exacto

El staging se ubica bajo:

```text
.ws-workspace/.staging/M5-KNOWLEDGE-shared-transaction/
```

El journal inmutable del coordinador contiene schema, transaction ID,
identificador del coordinador, fase, contador de promociones y, por target,
path relativo a `.ws-workspace`, existencia previa, creación de parent, hashes
before/after y nombre de backup. La operación M5, sus revisiones y los Work Item
IDs afectados permanecen en el ledger autoritativo y no se duplican en el
journal físico.

Fases:

```text
PREPARED → ORIGINALS_MOVED → PROMOTING → READY_TO_CONFIRM → COMMITTED
```

Un commit marker con transaction ID hace irreversible la confirmación.

### 22.3 Política de targets

`workspace-transaction-paths.ts` y el localizador validan:

- el path exacto `records/KNOWLEDGE_BASE.json`;
- un dossier localizado y su lista cerrada de artefactos M1–M5;
- que el layout registrado coincide con el `WorkItemLocator`;
- que ningún target es un link o sale de `.ws-workspace`.

La política es usada por M3, M4 y M5 para recovery. Cada operación mantiene una
allowlist de escritura más pequeña. Poder recuperar una ruta no autoriza a
escribirla en cualquier operación.

### 22.4 Recovery transversal

Los repositorios M3/M4/M5 entran por el mismo gate workspace-level y usan el
mismo identificador de coordinador. Al inicio de cualquier operación
comprueban primero un journal M5 abandonado.

Recovery:

- sin marker restaura todos los before hashes;
- con marker exige todos los after hashes y sólo retira staging;
- nunca deja visible checkpoint sin cambio de sesión ni viceversa;
- nunca deja catálogo aprobado sin resolución de propuesta;
- valida knowledge lock y todos los Work Item locks afectados;
- conserva material desconocido y falla cerrado.

Este recovery puede finalizar journals abandonados de cualquiera de los tres
adaptadores, pero no fusiona la mutación histórica y la reapertura en una
transacción única. Tras recuperar la primera fase, un retry del flujo vuelve a
evaluar el estado y completa o suprime de forma convergente la segunda.

## 23. Compatibilidad

M5 preserva:

- dossiers M2, M3, M4 y M4.1;
- lectura `EN_BASELINE_V1`;
- creación y rendering `ES_ES_V1`;
- marker inmutable;
- siete tipos M3;
- cuatro tracking types M4;
- ledger M4 `1.0.0`;
- inventarios M3/M4;
- UUID, revisiones e idempotencia M4;
- lock, staging, journal, rollback y recovery;
- ausencia de paths absolutos;
- las quince herramientas anteriores.

No hay migración al leer. Un histórico sólo obtiene artefactos M5 mediante
`initialize_work_item_workflow`, que es explícita, idempotente y no mueve su
carpeta.

Un dossier M5 parcialmente inicializado sin marker válido, o con proyecciones
parciales, es corrupción. La única excepción recuperable es un bootstrap v2 con
marker `PENDING` y fingerprint persistido: queda aislado de las operaciones
públicas M3/M4/M5 y sólo el retry exacto dentro de su scope puede completar las
fases pendientes. Nunca se adopta por otro payload ni se borra automáticamente.

## 24. Seguridad y privacidad

- Sólo `WS_WORKSPACE_ROOT` admite escrituras.
- `WS_PROJECT_SOURCE_ROOT` es sólo lectura.
- No se persiste contenido fuente.
- No se persisten rutas absolutas, remotes o URLs.
- No se siguen symlinks, junctions o reparse points.
- Git se ejecuta sin shell y con argumentos fijos.
- Textos de auditoría aplican la política existente contra locations.
- Los payloads son cerrados y tienen límites de longitud y cardinalidad.
- Los ledgers tienen tamaño máximo documentado por codec.
- Las proyecciones escapan Markdown para impedir inyección de secciones.
- No se confía en el usuario del sistema operativo.
- La identidad declarada se etiqueta como tal.
- La IA no puede cerrar, transferir, aprobar catálogo ni oficializar
  conocimiento sin confirmación humana.
- No se registran nombres de sistemas, clientes o datos no confirmados.
- Los errores conocidos usan códigos aditivos y detalles seguros.

Familias de error aditivas M5:

```text
PROJECT_SOURCE_CONFIGURATION_INVALID
PROJECT_SOURCE_NOT_CONFIGURED
TECHNICAL_SNAPSHOT_FAILED
TECHNICAL_SNAPSHOT_LIMIT_EXCEEDED
KNOWLEDGE_BASE_CONFLICT
KNOWLEDGE_BASE_CORRUPT
KNOWLEDGE_BASE_UPDATE_FAILED
WORKFLOW_NOT_INITIALIZED
WORKFLOW_CORRUPT
WORKFLOW_REVISION_CONFLICT
WORKFLOW_IDEMPOTENCY_CONFLICT
WORK_SESSION_CONFLICT
WORK_SESSION_NOT_ACTIVE
PARTICIPANT_NOT_AUTHORIZED
STRUCTURAL_REVIEW_FAILED
CONCEPT_PROPOSAL_CONFLICT
CONCEPT_CATALOG_CONFLICT
WORK_ITEM_RELATION_CONFLICT
WORK_ITEM_STATE_CONFLICT
M5_UPDATE_FAILED
```

## 25. Revisión y ciclo de vida

### 25.1 Revisión estructural

La revisión calculada comprueba como mínimo:

1. Work Item y workflow válidos;
2. responsable principal único;
3. M3 inicializado e íntegro;
4. M4 inicializado e íntegro;
5. `KNOWLEDGE_BASE.json`, manifest y proyecciones consistentes;
6. al menos un snapshot confirmado;
7. al menos un checkpoint de sesión;
8. consolidación funcional, implementación y testing no vacía;
9. un plan de pruebas activo;
10. cada caso activo con última ejecución `PASSED`;
11. referencias usadas existentes;
12. ausencia de sesión activa sobre el Work Item;
13. paths y procedencia válidos.

El resultado y sus hallazgos se registran. Un resultado fallido bloquea
`complete_work_item`.

### 25.2 Revisión semántica

El host puede aportar observaciones con severidad, explicación, evidencia y
procedencia. Pueden quedar abiertas al cerrar. Resolver una observación crea un
evento nuevo. No alteran por sí solas el resultado estructural.

### 25.3 Completar

Requiere:

- estado `IN_PROGRESS`;
- actor igual al responsable;
- `confirmation: true`;
- revisión estructural vigente y aprobada;
- revisión esperada coincidente.

Persiste evento, fecha real, `CLOSED`, final report, manifest y
`KNOWLEDGE_BASE.json` como un commit.

### 25.4 Cancelar

Sólo desde `IN_PROGRESS`, por el responsable, con motivo y confirmación. No
borra conocimiento ni evidencias.

### 25.5 Reabrir

Puede ser explícita o automática. Conserva cierres anteriores, fecha y review.
El estado legacy pasa a `REOPENED`. Un nuevo cierre requiere otra revisión
estructural.

## 26. Secuencia incremental de implementación

Los incrementos M5.0–M5.9 están implementados en el código. Esta secuencia se
conserva como trazabilidad de entrega; la ejecución automática final y la
validación manual IBM Bob se registran por separado en
[Pruebas_Milestone_5.md](Pruebas_Milestone_5.md).

### Incremento M5.0 — Contrato y baseline

- diseño y ADRs aprobados;
- estados documentales contradictorios corregidos;
- baseline previa registrada;
- contrato cerrado antes de los cambios de producción.

### Incremento M5.1 — Compatibilidad y workflow

- codec Work Item v1/v2;
- locator dual;
- dominio y servicio de ledger sobre `KNOWLEDGE_BASE.json`;
- repositorio y manifest M5;
- allowlist de recovery central;
- `create_work_item_v2`, inicialización y lectura workflow.

### Incremento M5.2 — Participantes y procedencia

- responsable, colaboradores y transferencias;
- procedencia común;
- proyección legacy;
- pruebas de autorización declarada.

### Incremento M5.3 — Observación técnica

- configuración read-only;
- walker seguro y Git opcional;
- eventos de snapshot en la base única y diff/reverted;
- límites y redacción.

### Incremento M5.4 — Sesiones y checkpoints

- vistas de sesión en la base única y knowledge lock;
- activación, switch, checkpoint y reanudación;
- transacción transversal y recovery.

### Incremento M5.5 — Dossier híbrido

- payloads de consolidación;
- proyecciones 09–12;
- manifest y contexto M5;
- compatibilidad de perfiles.

### Incremento M5.6 — Relaciones y conocimiento relacionado

- vocabulario mínimo;
- consultas agregadas;
- clasificación Golden/imported preparada.

### Incremento M5.7 — Conceptos

- propuestas, rechazo, supresión y aprobación;
- catálogo derivado y commit único;
- autorización declarada.

### Incremento M5.8 — Review, cierre y reapertura

- revisión estructural/semántica;
- complete/cancel/reopen;
- auto-reopen de mutaciones históricas;
- final report.

### Incremento M5.9 — MCP, smoke y Bob

- catálogo final de tools/capabilities;
- smoke desechable;
- regresión completa;
- documentación y batería manual.

Cada incremento incluye contrato, dominio, aplicación, adaptador, MCP, pruebas,
documentación e inspección de diff. No se realiza una reescritura masiva.

## 27. Criterios de aceptación

La implementación está entregada. La validación automática final confirmó que:

- todos los invariantes estén automatizados;
- los 30 requisitos mínimos de la matriz tengan prueba;
- la suite M1–M4.1 siga pasando;
- typecheck, lint, test y build pasen;
- format y smoke pasen;
- recovery e idempotencia se prueben con fallos inyectados;
- históricos se lean sin reescritura;
- dossiers nuevos sean `es-ES`;
- ningún resultado exponga roots absolutos;
- el cliente stdio automatizado descubra e invoque las herramientas nuevas;
- la documentación refleje el estado real.

La validación manual oficial posterior mediante IBM Bob ejecutó
satisfactoriamente B1–B19 en un workspace corporativo aislado, sobre el commit
`ea59fedc68a1769603e96fd048d3c3333cc9696a` y Node.js `v24.18.0`. Verificó
sesiones, snapshots, workflow, relaciones, revisión semántica, auditoría,
consolidación y cierre del ciclo de vida. El workspace terminó limpio, sin
locks persistentes, staging, journals ni claims. El resultado registrado es:

```text
COMPLETED — FROZEN
```

## 28. Plan de pruebas automatizadas

### 28.1 Unidad

- codecs estrictos y canonicalización;
- mapping de estados;
- participantes y procedencia;
- fingerprint/idempotencia;
- relaciones e inversas;
- propuestas y supresión;
- diff y detección de revertidos;
- revisión estructural;
- proyecciones y providers.

### 28.2 Integración filesystem

- layout histórico y anidado;
- symlink/junction;
- límites de snapshot;
- Git presente/ausente;
- knowledge lock workspace-level y locks de Work Item ordenados;
- commits multiarchivo;
- recuperación M3↔M4↔M5;
- transacciones knowledge interrumpidas en cada fase;
- corrupción y sets parciales.

### 28.3 MCP

- discovery y capabilities;
- schemas cerrados;
- precedencia de errores;
- resultados seguros;
- retry exacto;
- flujo completo M5;
- ausencia de paths absolutos.

### 28.4 Regresión

- herramientas M1–M4.1 sin cambios;
- manifests LF/CRLF;
- históricos ingleses;
- nuevos dossiers españoles;
- alternancia de mutaciones M3/M4/M5;
- smoke en root temporal.

## 29. Validación manual IBM Bob — PASS

| Escenario                | Comportamiento estándar MCP | Experiencia Bob          | Degradable               |
| ------------------------ | --------------------------- | ------------------------ | ------------------------ |
| creación                 | tool estructurada           | formulario corto         | entrada JSON/manual      |
| conocimiento relacionado | candidatos estructurados    | tarjetas/selectores      | lista ordenada           |
| activación               | tool + snapshot             | acción “Iniciar trabajo” | llamada directa          |
| trabajo observado        | hechos y diff               | resumen del host         | inventario sin semántica |
| cambio de contexto       | transacción + checkpoint    | acción ligera            | llamada explícita        |
| reanudación              | contexto estructurado       | panel de resumen         | respuesta textual        |
| colaboradores            | mutaciones tipadas          | selector                 | IDs manuales             |
| concepto                 | propuesta y evidencia       | tarjeta aprobar/rechazar | confirmación booleana    |
| revisión                 | estructural + observaciones | checklist                | resultado estructurado   |
| cierre                   | confirmación requerida      | diálogo explícito        | `confirmation: true`     |
| consulta posterior       | dossier y relaciones        | navegación               | Markdown/JSON            |

Batería manual ejecutada:

El guion ejecutable y el registro canónico de evidencia están en
[Pruebas_Milestone_5.md](Pruebas_Milestone_5.md), pasos B1–B19. La batería se
ejecutó satisfactoriamente mediante IBM Bob. La secuencia funcional cubierta
fue:

1. inicializar workspace y comprobar capabilities;
2. crear Work Item v2;
3. consultar conocimiento relacionado;
4. activar sesión y ver snapshot;
5. registrar trabajo y checkpoint;
6. cambiar a otro Work Item;
7. reanudar el primero;
8. añadir colaborador y transferir responsabilidad;
9. proponer y rechazar concepto;
10. repetir propuesta sin nueva evidencia;
11. proponer con evidencia nueva y aprobar;
12. añadir relaciones;
13. consolidar dossier;
14. obtener review estructural fallida;
15. corregir estructura;
16. registrar observación semántica;
17. resolver la observación con confirmación;
18. comprobar rechazo de cierre por colaborador;
19. suspender sesión, completar pruebas M4 y obtener review estructural aprobada;
20. cerrar por responsable;
21. modificar mediante M3/M4 y verificar reapertura automática;
22. consultar dossier meses-después simulado;
23. validar histórico inglés;
24. comprobar que ninguna respuesta contiene roots absolutos.

## 30. Riesgos y mitigaciones

| Riesgo                                 | Mitigación                                            |
| -------------------------------------- | ----------------------------------------------------- |
| escaneo de una raíz incorrecta         | segunda raíz explícita, no fallback y no solapamiento |
| fuga de source                         | sólo hashes/metadatos, nunca contenido                |
| repositorio excesivo                   | límites y fallo atómico                               |
| falsa autenticación                    | etiqueta de identidad declarada y puerto futuro       |
| duplicación de estado                  | tabla de autoridad y validación cruzada               |
| romper M4                              | base M5 única, pero separada del ledger M4            |
| journal irrecuperable por otra versión | allowlist compartida central                          |
| deadlock multi-Work Item               | knowledge lock y Work Item locks ordenados            |
| cambio de sesión parcial               | journal durable, rollback y recovery                  |
| proyección contradictoria              | regeneración y comparación estricta                   |
| Markdown inyectado                     | payloads cerrados y escaping                          |
| propuesta repetitiva                   | fingerprint de evidencia                              |
| relaciones inconsistentes              | una arista canónica, inversas derivadas               |
| históricos reinterpretados             | layout dual y ausencia de migración                   |
| reapertura no auditada desde M3        | evento SYSTEM con desencadenante                      |
| crecimiento de fuentes append-only     | límites y futura compactación versionada, no incluida |
| dependencia de Bob                     | contratos MCP equivalentes y modo degradado           |

## 31. Alternativas descartadas

### Ampliar el ledger M4

Descartada porque su schema, operaciones, proyecciones e índice están
congelados. Exigiría migrar históricos y reinterpretar evidencia M4.

### Cambiar `create_work_item`

Descartada porque rompería el schema M2. Una operación v2 aditiva permite el
nuevo mínimo sin invalidar clientes o pruebas históricos.

### Escanear el source sin una raíz explícita

Descartada por seguridad y por contradecir la separación de source y workspace
de datos.

### Mover históricos al nuevo layout

Descartada por riesgo, ausencia de beneficio funcional inmediato y prohibición
de migración destructiva automática.

### Representar relaciones con carpetas

Descartada porque impide múltiples relaciones, acopla semántica a paths y
contradice el modelo físico congelado.

### Incorporar IA dentro del MCP

Descartada porque acoplaría dominio a modelo/host, elevaría coste y mezclaría
hechos con inferencias.

### Usar Markdown como fuente M5

Descartada por fragilidad para procedencia, idempotencia, relaciones,
autorización, revisiones y recuperación.

### Usar únicamente un lock global

Descartada porque no conserva ownership ni exclusión específica sobre cada
dossier afectado. Se adopta un knowledge gate global seguido de locks de Work
Item ordenados para el MVP. La serialización workspace-level es una limitación
consciente de este adaptador local.

## 32. Matriz de trazabilidad de los 30 requisitos mínimos

Los símbolos de esta tabla corresponden a la implementación actual. El
resultado de cada escenario se registra exclusivamente en
[Pruebas_Milestone_5.md](Pruebas_Milestone_5.md).

| #   | Requisito                              | Diseño       | Código implementado                               | Cobertura automatizada                               |
| --- | -------------------------------------- | ------------ | ------------------------------------------------- | ---------------------------------------------------- |
| 1   | activar primera sesión                 | §10.2        | `KnowledgeBaseApplicationService.activateSession` | `knowledge-base-application-service.test.ts`         |
| 2   | impedir dos sesiones por desarrollador | §10.1, §21   | `KnowledgeBaseLedgerService`                      | `knowledge-base-ledger-service.test.ts`              |
| 3   | varios Work Items IN_PROGRESS          | §6.3, §10    | `KnowledgeBaseLedgerService`                      | `knowledge-base-application-service.test.ts`         |
| 4   | snapshot al activar                    | §10.2, §11   | `ProjectObservation` + `activateSession`          | `local-project-observation-adapter.test.ts`          |
| 5   | cambiar sesión                         | §10.3        | `KnowledgeBaseApplicationService.switchSession`   | `knowledge-base-application-service.test.ts`         |
| 6   | checkpoint automático                  | §12          | `switchSession`                                   | `knowledge-base-application-service.test.ts`         |
| 7   | reanudar con contexto                  | §10.4        | `resumeSessionContext`                            | `knowledge-base-application-service.test.ts`         |
| 8   | doble operación misma key              | §20.2        | `KnowledgeBaseLedgerService`                      | `knowledge-base-ledger-service.test.ts`              |
| 9   | recuperar operación interrumpida       | §22.4        | `LocalFilesystemKnowledgeBaseRepository`          | `local-filesystem-knowledge-base-repository.test.ts` |
| 10  | added/modified/deleted/reverted        | §11.2        | `LocalProjectObservationAdapter`                  | `local-project-observation-adapter.test.ts`          |
| 11  | revertidos fuera de implementación     | §11.2, §14   | `M5ProjectionService`                             | final projection omite reverted                      |
| 12  | asignar responsable                    | §13          | `initializeWorkflow`                              | `knowledge-base-application-service.test.ts`         |
| 13  | añadir colaboradores                   | §13          | `addCollaborator`                                 | `knowledge-base-application-service.test.ts`         |
| 14  | transferir responsabilidad             | §13          | `transferResponsibility`                          | `knowledge-base-application-service.test.ts`         |
| 15  | colaborador no cierra                  | §25.3        | `completeWorkItem`                                | `knowledge-base-application-service.test.ts`         |
| 16  | responsable cierra                     | §25.3        | `completeWorkItem`                                | `mcp-m5.test.ts`                                     |
| 17  | revisión estructural bloquea           | §25.1        | `reviewWorkItem`                                  | `knowledge-base-application-service.test.ts`         |
| 18  | semántica no bloquea                   | §25.2        | `reviewWorkItem`                                  | `knowledge-base-application-service.test.ts`         |
| 19  | modificación reabre                    | §18.4, §25.5 | `autoReopenForExternalMutation`                   | `mcp-m5.test.ts`                                     |
| 20  | conservar procedencia                  | §9.3         | codec `KnowledgeProvenance`                       | `knowledge-base-ledger-service.test.ts`              |
| 21  | relación sin mover carpeta             | §15          | `addRelation`                                     | `knowledge-base-application-service.test.ts`         |
| 22  | proponer concepto                      | §16.2        | `PROPOSE_CONCEPT_SCHEMA` + `proposeConcept`       | schemas y aplicación M5                              |
| 23  | rechazar sin catálogo                  | §16.3        | `resolveConceptProposal`                          | `knowledge-base-application-service.test.ts`         |
| 24  | aprobar con auditoría/autorización     | §16.3        | `resolveConceptProposal`                          | `knowledge-base-application-service.test.ts`         |
| 25  | leer históricos                        | §6.2, §23    | `WorkItemLocator`, codec dual                     | `work-item-locator.test.ts`                          |
| 26  | crear nuevos es-ES                     | §6.6, §23    | `WorkItemV2CreationService`                       | `work-item-v2-creation-service.test.ts`              |
| 27  | preservar manifest/inventarios         | §19, §22     | `M5ProjectionService` + repositorio               | `m5-projection-service.test.ts`                      |
| 28  | actualizar AI_CONTEXT coherente        | §14.4        | `KnowledgeContextSummaryService`                  | `mcp-m5.test.ts`                                     |
| 29  | no exponer rutas absolutas             | §24          | adapters/serializadores                           | `mcp-m5.test.ts` y smoke                             |
| 30  | regresión de tools existentes          | §23, §28.4   | composición MCP                                   | `mcp-m4.test.ts`                                     |

## 33. Trazabilidad adicional requisito → artefacto

| Área          | Fuente estructurada   | Proyección/consulta           | Prueba crítica           |
| ------------- | --------------------- | ----------------------------- | ------------------------ |
| sesiones      | `KNOWLEDGE_BASE.json` | active/resume tools           | una activa por actor     |
| snapshots     | `KNOWLEDGE_BASE.json` | session context               | hashes y reverted        |
| participantes | `KNOWLEDGE_BASE.json` | workflow/final report         | transferencia            |
| procedencia   | `KNOWLEDGE_BASE.json` | dossier/query                 | confirmación append-only |
| dossier       | `KNOWLEDGE_BASE.json` | 09–12 Markdown                | determinismo             |
| relaciones    | `KNOWLEDGE_BASE.json` | related knowledge             | inversa derivada y traza |
| conceptos     | `KNOWLEDGE_BASE.json` | catalog/query                 | rechazo y aprobación     |
| estado        | `KNOWLEDGE_BASE.json` | YAML, workflow y final report | auto-reopen              |
| fence causal  | `KNOWLEDGE_BASE.json` | estado y bridge M3/M4         | cursor antes/después     |
| revisión      | `KNOWLEDGE_BASE.json` | review/final report           | structural vs semantic   |

## 34. Archivos afectados por la implementación

Además de los archivos nuevos de §8, la implementación revisó de forma
controlada:

- `src/config/workspace-config.ts`;
- `src/domain/work-item.ts`;
- `src/errors/workspace-error.ts`;
- `src/filesystem/work-item-dossier.ts`;
- los dos repositorios filesystem existentes;
- `src/filesystem/work-item-operation-coordinator.ts`;
- `src/mcp/server.ts`;
- `src/services/foundation-service.ts`;
- `src/services/document-rendering.ts`;
- `src/services/work-item-creation-service.ts`;
- `src/services/work-item-document-service.ts`;
- `src/services/work-item-audit-service.ts`;
- smoke, pruebas y documentación canónica.

Cada modificación preserva los contratos previos y dispone de cobertura
automatizada; el resultado final de la ejecución se registra únicamente en
`Pruebas_Milestone_5.md`.

## 35. Condición final de éxito

M5 ha sido validado satisfactoriamente: el desarrollador puede trabajar mediante una
sesión explícita, cambiar de contexto de forma segura, reanudar sin
redescubrimiento, obtener hechos técnicos sin IA, consolidar conocimiento con
procedencia, relacionarlo y gobernar conceptos, y completar o reabrir el Work
Item sin perder historia. El resultado manual oficial y sus observaciones están
registrados en [Pruebas_Milestone_5.md](Pruebas_Milestone_5.md).

La arquitectura sigue siendo local, portable, compatible y preparada
para un futuro servicio compartido sin haberlo implementado prematuramente.
