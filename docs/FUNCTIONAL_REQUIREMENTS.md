# Functional requirements

## Allowed work-item types

The MVP permits exactly these values: USER_STORY, DEFECT, INCIDENT and
TECHNICAL_TASK. No additional type is implied by this list.

## Creation data

Required data for the implemented Milestone 2 `create_work_item` tool:

- Work-item type.
- Rally ID.
- Title.
- Functional definition.
- Development sandbox or alias.
- Initially related components.
- Start date.

Optional data:

- Acceptance criteria.
- Planned completion date.
- Responsible person.
- Additional business information.

The actual completion date is generated when an item is closed. Git branches
are not part of the functional workflow.

Milestone 2 accepts `startedAt` and `plannedCompletionAt` only as ISO dates in
the `YYYY-MM-DD` format. `plannedCompletionAt` cannot be earlier than
`startedAt`. `acceptanceCriteria` is a list of text values. The manually
entered Rally ID is preserved, while a separate safe internal ID is derived for
the Work Item directory.

## States

The legacy vocabulary is DRAFT, ANALYSIS, PLANNED, DEVELOPMENT, TESTING,
READY_FOR_REVIEW, CLOSED, BLOCKED, REOPENED and CANCELLED. M1–M4.1 expose no
transition tool or full state machine: a new legacy item starts in DRAFT and
remains there during implemented operations. An M4 `BLOCKER` checkpoint does
not change status.

M5 keeps that vocabulary only as a compatibility projection. Its canonical
states are `IN_PROGRESS`, `COMPLETED` and `CANCELLED`, as specified below.

## Expected lifecycle

An item is entered from Bob, receives a dossier and progresses through work,
testing and controlled consolidation. M5 completes it logically without moving
its folder. A reopened item preserves every closure, review, date and reason.
Physical archive handling is a separately approved future option.

## Progressive documentation structure

Milestone 2 creates only the minimum initial dossier: `WORK_ITEM.yml`,
`00_MANIFEST.md`, `01_FUNCTIONAL_ANALYSIS.md`, `context/AI_CONTEXT.md`,
`context/AI_RULES.md`, `context/NEXT_TASK.md`, and the `evidence` and
`snapshots` directories. The initial manifest records the created inventory and
its initial status.

The complete dossier is a product target, not a Milestone 2 requirement.
Milestone 3 generates the remaining lifecycle documents progressively. M5
keeps completed dossiers at their stable location;
`.ws-workspace/archive` remains a compatibility directory and receives no
automatic move.

## Milestone 3 document lifecycle

Milestone 3 creates exactly these additional documents for an existing active
DRAFT Work Item: `02_CURRENT_STATE.md`, `03_TECHNICAL_ANALYSIS.md`,
`04_IMPACT_ANALYSIS.md`, and `05_IMPLEMENTATION_PLAN.md`. Initialization is
idempotent after success. It creates only missing approved documents and never
replaces an unexpected pre-existing file.

The managed lifecycle inventory covers `00_MANIFEST.md`,
`01_FUNCTIONAL_ANALYSIS.md`, the four new documents, and
`context/AI_CONTEXT.md`. `WORK_ITEM.yml`, `context/AI_RULES.md`, and
`context/NEXT_TASK.md` are preserved without modification. The Work Item stays
in `DRAFT`.

Only the functional analysis, current state, technical analysis, impact
analysis, and implementation plan are editable. Each replacement requires a
document-specific typed payload and a matching positive revision. AI context is
derived only by its refresh operation. Callers cannot provide raw Markdown,
paths, arbitrary filenames, directories, patches, decisions, checkpoints,
testing data, closure data, archive data, reopening data, or
`actualCompletionAt` through an M3 document payload. Decisions, checkpoints,
testing records, and evidence references are accepted only through the separate
M4 audit-tracking operations.

## Milestone 4 decisions, checkpoints, testing, and evidence references

M4 applies only to an existing active Work Item with a valid initialized M3
document lifecycle. `initialize_work_item_tracking` idempotently creates
`records/AUDIT_LEDGER.json`, `06_DECISIONS.md`, `07_CHECKPOINTS.md`,
`08_TEST_PLAN.md`, `evidence/REFERENCES.md`, and one M4-owned manifest section
as a single logical commit.

The other mutating operations are `record_decision`, `record_checkpoint`,
`define_test_plan`, `record_test_execution`, and
`register_evidence_reference`. `get_work_item_tracking` reads exactly one of
`DECISIONS`, `CHECKPOINTS`, `TESTING`, or `EVIDENCE_REFERENCES`; it accepts no
path or arbitrary file name.

All real records are immutable append-only entries with server-generated UUIDv4
identifiers and clock timestamps. Every mutation has a global idempotency key
and expected audit revision. Plan definition and execution also enforce the
current plan revision. An exact retry returns its original result without
writing; incompatible key reuse or stale revisions return stable conflicts.

A Work Item may have only one logical M4 test plan, with immutable versions.
Executions can target only the active version and one case defined by it.
Historical versions and executions remain visible in the protected test
projection.

Evidence registration stores metadata only. Its normalized logical path must be
unique and contained below `evidence/`; registration performs no existence
check, file read, content validation, upload, or external access. Audit text
cannot contain absolute filesystem or URL-style locations.

The audit ledger is the structured source of truth. Four deterministic Markdown
files and the M4 manifest inventory are derived and protected. M3 and M4
inventories must survive alternating updates without changing the historical
seven-value M3 document enumeration. M4 never modifies `WORK_ITEM.yml`, Work
Item status, `get_work_item_document`, closure, archive, or reopening.

M4 changes `AI_CONTEXT` only through the existing explicit
`refresh_ai_context` operation. The selected audit summary is deterministic,
bounded to 16 KiB, and excludes paths, URLs, and evidence content.

## Milestone 4.1 document-language behaviour (completed and frozen)

For a Work Item created by the approved M4.1B implementation, the workspace
document language is selected from a local, validated
configuration and captured in immutable technical metadata in `00_MANIFEST.md`.
The initial selection is `es-ES`; all system-owned new-document prose uses its provider
profile and technical tokens remain exact. Human-provided fields, including
functional definitions, acceptance criteria, supplied facts, decisions,
evidence labels, and all other user text, are never translated.

Work Items created before M4.1B remain English historical baseline artifacts.
They are not migrated, and the absence of a manifest marker is compatible. The
design does not modify the M2 minimum dossier, M3 typed payloads, M4 ledger or
projections, Work Item states, `AI_CONTEXT` semantics, or any MCP operation.
There is no language parameter and no `WS_DOCUMENT_LANGUAGE` setting. M4.1B
automatic tests, smoke validation and manual IBM Bob validation have passed.
Milestone 4.1 is `COMPLETED — FROZEN`.

## Milestone 5: ciclo asistido y conocimiento vivo

**Estado:** M5 está
`IMPLEMENTED — PENDING MANUAL IBM BOB VALIDATION`; esta sección describe el
contrato implementado, todavía no completado ni congelado.

### Creación y modelo físico

`create_work_item` conserva sus campos y comportamiento M2. El contrato
aditivo M5 de creación v2 solicita Rally ID, título, definición funcional,
tipo, iteración y actor declarado responsable. Genera `startedAt` mediante
`Clock`.

La inicialización M2→M3→M4→M5 es un bootstrap por fases bajo exclusión global.
Un error controlado retira el dossier nuevo. Si una caída deja un parcial, su
manifest contiene sólo la huella SHA-256 de la petición normalizada completa y
únicamente el retry exacto puede reanudarlo; otra petición falla como colisión.

Los históricos permanecen en `.ws-workspace/active/<workItemId>`. Los nuevos
M5 usan
`.ws-workspace/active/<iterationStorageToken>/<workItemType>/<workItemId>`.
Un localizador dual impide duplicados y no migra históricos. Ninguna
relación ni transición moverá carpetas.

### Ciclo de vida y participantes

Los estados canónicos M5 son `IN_PROGRESS`, `COMPLETED` y `CANCELLED`. Varios
Work Items pueden permanecer `IN_PROGRESS` sin sesión activa. Cada workflow M5
tiene exactamente un responsable principal y cero o más colaboradores. Sólo el
responsable puede completar; una transferencia conserva toda la historia.

La identidad se suministra como `participantId` estable y `displayName`. Es
identidad `DECLARED`, no autenticación. No se usa el usuario del sistema
operativo.

### Sesiones, snapshots y checkpoints

Cada desarrollador puede tener como máximo una sesión activa. Activar requiere
un Work Item `IN_PROGRESS`, participante autorizado y snapshot técnico
confirmado. Cambiar de sesión es una única mutación idempotente y recuperable:
checkpoint y snapshot del origen, suspensión, snapshot del destino y
activación se confirman juntos.

El snapshot observa únicamente una raíz de proyecto explícita y de solo
lectura. Conserva inventario, hashes, tamaños, paths relativos, diferencias y
Git opcional; nunca contenido fuente ni la ruta absoluta. Los cambios
revertidos pueden quedar en la historia de sesión, pero no en la implementación
final proyectada.

### Dossier híbrido, procedencia, relaciones y conceptos

La base M5 estructurada `KNOWLEDGE_BASE.json` es autoridad de workflow,
sesiones, participantes,
procedencia, relaciones, conceptos, revisión y transiciones. El ledger M4
mantiene decisiones, checkpoints M4, pruebas y evidencia. Markdown y
`AI_CONTEXT` son proyecciones protegidas; el refresh de contexto sigue siendo
explícito.

Toda afirmación relevante conserva procedencia. La IA puede proponer, pero no
puede oficializar por sí sola estado, responsable, catálogo, cierre o
relaciones críticas.

Las relaciones mínimas son `RELATED_TO`, `DEPENDS_ON`, `PART_OF` y `REPLACES`.
Son semánticas y nunca físicas. Los conceptos se proponen con explicación y
entre 1 y 500 `evidenceReferenceIds` UUID v4; aprobar o rechazar requiere una
operación humana declarada. Rechazar no cambia el catálogo y una propuesta
rechazada idéntica no reaparece sin nueva evidencia.

La línea `Knowledge revision` de cada manifest M5 es el watermark de la
revisión global vigente en el último commit que afectó a ese dossier. No se
reescriben dossiers ajenos para sincronizar ese número.

### Cierre, cancelación y reapertura

Closing must record an actual completion date, final report, test evidence and
the final state. Completing requires an explicit confirmation by the current
responsible participant and a current successful structural review. Structural
failures block completion; semantic observations remain informative,
append-only and non-blocking.

Reopening creates an auditable event and retains every previous closure,
review, date and evidence. A new substantive mutation on a completed Work Item
reopens it automatically; reads, exact retries, recovery and derived refreshes
do not. Cancelling requires the responsible actor, reason and confirmation.
Completion, cancellation and reopening do not move the dossier to
`.ws-workspace/archive`.

Cuando el cambio sustantivo procede de M3/M4, la mutación histórica y la
reapertura son dos commits físicos secuenciales. El bridge relee el estado M5,
compara la revisión histórica confirmada con el fence persistido en el último
cierre, reabre sólo si continúa `COMPLETED` y el cursor es posterior, y converge
a no-op si ya está `IN_PROGRESS` o el cursor ya estaba incluido. La
inicialización M3 posterior a un cierre es un no-op y no reabre. No se usan
timestamps como orden causal ni se promete atomicidad física cross-repository.

## Search and traceability

M5 implementa `get_related_knowledge` para candidatos deterministas basados en
relaciones confirmadas, ocurrencias exactas de conceptos, componentes, tipo,
iteración y clasificación. La respuesta distingue propuestas locales y
catálogo aprobado y devuelve relaciones y señales con evidencia, consolidación
y procedencia suficientes para resolverlas sin otra tool. El ranking semántico
continúa siendo responsabilidad del host. Una búsqueda futura más amplia deberá
admitir Rally ID exacto y filtros por fecha de inicio, finalización planificada
y finalización real. Toda mutación debe atribuirse a timestamp,
actor/procedencia y evento inmutable.
