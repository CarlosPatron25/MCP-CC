# Data model

The following contracts describe the implemented local M1–M4.1 model. Required
fields are marked Required, nullable user choices are Optional, values set by
the system are Generated, and later lifecycle fields are Future.

## WorkItem

- id: Required internal identifier.
- rallyId: Required external reference entered manually.
- type: Required WorkItemType.
- status: Generated on creation; Future transition handling.
- title: Required.
- dates: Required WorkItemDates.
- responsibility: Optional WorkItemResponsibility.
- salesforce: Required SalesforceContext.
- functional: Required FunctionalContext.
- initialScope: Required InitialScope.
- business: Optional BusinessContext.
- createdAt: Generated ISO timestamp at creation.
- updatedAt: Generated ISO timestamp, initially equal to createdAt.
- decisions, checkpoints, tests: not fields of `WorkItem` or `WORK_ITEM.yml`;
  M4 owns separate append-only audit records.

## Enumerations

WorkItemType is exactly USER_STORY, DEFECT, INCIDENT and TECHNICAL_TASK.
WorkItemStatus is DRAFT, ANALYSIS, PLANNED, DEVELOPMENT, TESTING,
READY_FOR_REVIEW, CLOSED, BLOCKED, REOPENED and CANCELLED.

## Milestone 2 creation contract

`id` and `rallyId` are independent concepts. The manually supplied `rallyId`
is persisted exactly as entered. Milestone 2 derives the safe internal `id`
from that value only for directory naming; later milestones may use a different
ID-generation strategy without changing the semantic distinction.

Creation accepts only `YYYY-MM-DD` ISO dates. `startedAt` is required and
`plannedCompletionAt`, when present, must not precede it. `actualCompletionAt`
is not accepted at creation and remains generated only by future closure work.
`acceptanceCriteria` is an optional list of text values.

## Supporting records

| Contract               | Required fields                        | Optional fields       | Generated or future fields   |
| ---------------------- | -------------------------------------- | --------------------- | ---------------------------- |
| WorkItemDates          | startedAt                              | plannedCompletionAt   | actualCompletionAt on close  |
| WorkItemResponsibility | none                                   | responsiblePerson     | future ownership history     |
| SalesforceContext      | developmentAlias                       | sandboxName           | future org metadata          |
| FunctionalContext      | definition                             | acceptanceCriteria    | future refined context       |
| InitialScope           | relatedComponents                      | none                  | future discovered components |
| BusinessContext        | none                                   | additionalInformation | future stakeholder data      |
| DecisionRecord         | historical placeholder only            | none                  | superseded by the M4 ledger  |
| Checkpoint             | historical placeholder only            | none                  | superseded by the M4 ledger  |
| TestCase               | historical placeholder only            | none                  | superseded by the M4 ledger  |
| WorkItemManifest       | schemaVersion, workItemId, generatedAt | none                  | future document inventory    |

Milestone 2 persists the initial `WorkItem` fields in `WORK_ITEM.yml`, together
with `schemaVersion`, `createdAt`, and `updatedAt`. Optional responsibility and
business records are represented as null in the persisted YAML when absent, so
the file retains a stable top-level structure without changing their optional
domain semantics.

## Milestone 3 document lifecycle contracts

`ManagedDocumentType` is a closed enumeration: `MANIFEST`,
`FUNCTIONAL_ANALYSIS`, `CURRENT_STATE`, `TECHNICAL_ANALYSIS`,
`IMPACT_ANALYSIS`, `IMPLEMENTATION_PLAN`, and `AI_CONTEXT`. Only the middle
five analysis types are editable; `AI_CONTEXT` is derived and `MANIFEST` is
system-managed.

Every managed document has `DocumentLifecycleMetadata` with the document type,
safe dossier-relative path, lifecycle status (`CREATED`, `INITIALIZED`, or
`UPDATED`), positive `revision`, ISO `updatedAt`, literal `updatedBy: SYSTEM`,
and content type (`TEMPLATE`, `SUPPLIED`, or `DERIVED`). `SYSTEM` identifies
the local lifecycle process, not a person, corporate user, or authentication
identity.

Each editable document has a closed payload contract. Functional analysis
accepts functional definition, acceptance criteria, business information,
related components, development alias, responsibility, and planned dates.
Current state accepts supplied facts, constraints, and open questions.
Technical analysis accepts supplied observations, declared hypotheses,
dependencies, and open questions. Impact analysis accepts affected components,
supplied impacts, and open questions. Implementation plan accepts supplied
steps, prerequisites, and open questions. Unknown fields and later-milestone
records are rejected.

## Milestone 4 audit ledger

`records/AUDIT_LEDGER.json` is the M4 structured source of truth and begins at
`schemaVersion: "1.0.0"`. The initialized ledger has `revision: 0`; each
confirmed append advances the global audit revision by one and updates
`updatedAt` through the injected clock. Its arrays preserve append order:
`decisions`, `checkpoints`, `testPlans`, `testExecutions`,
`evidenceReferences`, and `idempotencyIndex`.

All entry, plan, test-case, and evidence identifiers are server-generated
UUIDv4 values. Every mutation supplies one globally unique idempotency key. The
index stores that key, operation, resulting entry ID, and canonical SHA-256
fingerprint of the normalized request including its expected preconditions. An
exact retry returns the original confirmed result before stale-revision checks;
a key reused by another operation or payload is a conflict.

### Audit entries

- `Decision`: `id`, `idempotencyKey`, `kind`, `title`, `decision`,
  `rationale`, `declaredActor`, `recordedAt`, optional
  `relatedDecisionId`, and optional `evidenceReferenceIds`. Kinds are
  `DECISION`, `CORRECTION`, `SUPERSESSION`, and `WITHDRAWAL`.
- `Checkpoint`: `id`, `idempotencyKey`, `kind`, `summary`,
  `declaredActor`, `recordedAt`, optional `correctsCheckpointId`, optional
  `relatedDecisionIds`, and optional `evidenceReferenceIds`. Kinds are
  `PROGRESS`, `RISK`, `BLOCKER`, and `HANDOFF`.
- `TestPlanVersion`: immutable version-entry `id`, the one logical `planId`,
  positive `planRevision`, `idempotencyKey`, `purpose`, `declaredActor`,
  `recordedAt`, and one or more test cases.
- `TestCaseDefinition`: server-generated `testCaseId`, `title`, `objective`,
  `verificationMethod` (`MANUAL` or `AUTOMATED`), and `expectedOutcome`.
- `TestExecution`: `id`, `idempotencyKey`, `planId`, `planRevision`,
  `testCaseId`, `executionMethod`, `outcome`, `summary`, `declaredActor`,
  `recordedAt`, and optional `evidenceReferenceIds`. Outcomes are `PASSED`,
  `FAILED`, and `BLOCKED`.
- `EvidenceReference`: `id`, `idempotencyKey`, `label`, optional
  `description`, normalized `logicalPath`, `declaredActor`, and `recordedAt`.

A Work Item has no more than one logical plan in M4. Versions share its
generated `planId`; the highest `planRevision` is active. An execution must
target that exact active revision and a case defined by it. Earlier versions
and executions remain immutable history.

Evidence paths use forward slashes, begin below `evidence/`, contain no empty,
`.` or `..` segments, and are unique after normalization. They are logical
labels only; the model makes no assertion about file existence or contents.
All audit text rejects absolute filesystem locations and URL-style locations
before persistence.

### Projections and manifest

`TrackingType` is exactly `DECISIONS`, `CHECKPOINTS`, `TESTING`, or
`EVIDENCE_REFERENCES`. These map respectively to `06_DECISIONS.md`,
`07_CHECKPOINTS.md`, `08_TEST_PLAN.md`, and `evidence/REFERENCES.md`. The
Markdown files are deterministic protected projections of the ledger.

`00_MANIFEST.md` has one M4-owned Audit Inventory before the historical
seven-row M3 lifecycle inventory. The M4 block records schema and audit
revision plus artifact revisions and counters; it does not extend
`ManagedDocumentType`. M4 manifest changes advance only the existing M3
`MANIFEST` lifecycle row.

The optional M4 part of `AI_CONTEXT` is also derived, but only during an
explicit refresh. It contains selected current audit facts, excludes physical
and logical locations and evidence content, and is bounded to 16 KiB by
complete semantic units.

## Milestone 4.1 rendering metadata (completed and frozen)

M4.1A introduces no domain field and changes neither `WorkItem` nor the M4
audit ledger. Its frozen M4.1B persistence design adds technical rendering
metadata only for Work Items created after M4.1B implementation:

- workspace configuration at `.ws-workspace/config/workspace-config.json`:
  `schemaVersion: "1.0.0"` and `documentLanguage: "es-ES"`;
- an immutable `DocumentRenderingSnapshotV1` persisted as technical metadata in
  the new `00_MANIFEST.md`, with schema `1.0.0`, language `es-ES`, and profile
  `ES_ES_V1`;
- one exact technical rendering marker in that new manifest, immediately after
  its H1 and blank line, outside protected M3/M4 blocks.

`DocumentLanguageCode` is initially the closed value `es-ES`.
`DocumentRenderingProfileId` is internally `ES_ES_V1` or
`EN_BASELINE_V1`; the latter represents the absence of a manifest marker in
historical English artifacts, not a selectable language. These records are not
functional input, business data, audit entries, or fields of the domain
`WorkItem` contract. M4.1B passed automatic and manual IBM Bob validation;
Milestone 4.1 is `COMPLETED — FROZEN`. Historical dossiers receive no migration
or rewrite.

## Modelo de conocimiento implementado de Milestone 5

**Estado:** `IMPLEMENTED — PENDING MANUAL IBM BOB VALIDATION`. Los tipos de
esta sección describen el contrato implementado; el estado no declara
validación manual, cierre ni congelación de M5.

### Fuente estructurada y autoridad

La única fuente estructurada M5 es
`.ws-workspace/records/KNOWLEDGE_BASE.json`, con schema estricto `1.0.0`,
`knowledgeRevision`, operaciones append-only e índice global de idempotencia.
Permanece separada de `records/AUDIT_LEDGER.json`; el ledger M4 continúa siendo
autoridad de decisiones, checkpoints M4, planes, ejecuciones y referencias de
evidencia.

Cada operación M5 conserva UUID v4, revisión resultante, clave de idempotencia,
fingerprint SHA-256, timestamp de `Clock`, actor `ParticipantRef | SYSTEM` y uno
o más eventos tipados. El estado actual se deriva reproduciendo operaciones;
Markdown, manifest, catálogo y vistas de sesión son proyecciones.

Cada manifest M5 proyecta `Knowledge revision` como watermark de la revisión
global vigente en el último commit que afectó a ese dossier. No es una segunda
autoridad ni tiene que coincidir con la revisión global actual después de una
mutación de otro Work Item. La validación del dossier usa su
`workItemRevision`, estado y contenido autoritativo, normalizando ese watermark
al comparar una proyección no afectada.

### Work Item, iteración y estado

M5 añade un contrato `WORK_ITEM.yml` v2 para creación nueva y un codec dual que
lee v1/v2 sin reescribir al leer. `create_work_item` conserva el contrato M2;
la creación M5 v2 añade `IterationRef` y responsable principal.

El manifest de un dossier creado por v2 incluye metadata interna de bootstrap:
schema de marcador y huella SHA-256 de la petición normalizada completa. La
huella no es una segunda fuente funcional ni contiene la clave o identidad en
claro; sólo vincula un posible estado parcial tras caída con su retry exacto.

```text
IterationRef {
  iterationId
  displayName?
  storageToken
}

CanonicalWorkItemStatus =
  IN_PROGRESS | COMPLETED | CANCELLED
```

La base M5 es autoridad del estado canónico. La proyección legacy usa `CLOSED`
para `COMPLETED`, `CANCELLED` para `CANCELLED` y `REOPENED` al reabrir; los
valores históricos restantes se interpretan como `IN_PROGRESS` tras
inicializar el workflow. `KNOWLEDGE_BASE.json` y YAML se confirman juntos.
Completar no
mueve la carpeta.

Cada evento `WORK_ITEM_COMPLETED` conserva además el límite histórico visible
en el momento del cierre:

```text
HistoricalMutationBoundary {
  m3DocumentRevisions: Record<ManagedDocumentType, positive integer>
  m4AuditRevision: non-negative integer
}
```

Este fence se reemplaza en cada nuevo cierre. No duplica documentos ni el
ledger M4: sólo registra sus cursores confirmados para decidir causalmente si
una mutación histórica posterior debe reabrir.

### Participantes y procedencia

```text
ParticipantRef {
  participantId
  displayName
}
```

Cada workflow M5 tiene exactamente un responsable y cero o más colaboradores.
Transferencias, altas y bajas son eventos inmutables. La identidad tiene
assurance `DECLARED`: se valida contra el estado persistido, pero no se afirma
autenticación.

La procedencia distingue como mínimo `MANUAL`, `AI_INFERRED`,
`HUMAN_CONFIRMED`, `SYSTEM_CALCULATED` e
`IMPORTED_PENDING_VALIDATION`. Confirmar o modificar conocimiento crea un
evento nuevo; una inferencia no oficializa por sí sola estado, responsabilidad,
relaciones críticas o catálogo.

### Sesiones, snapshots y checkpoints

Una `WorkSession` derivada de `KNOWLEDGE_BASE.json` tiene estado `ACTIVE` o `SUSPENDED`;
sólo puede existir una activa por `participantId`. Activar confirma siempre un
snapshot técnico. Un cambio de sesión confirma en una operación el snapshot y
checkpoint de origen, su suspensión, el snapshot de destino y su activación.

Un snapshot persiste únicamente paths relativos, SHA-256, tamaños, metadata
auxiliar, cambios `ADDED`, `MODIFIED`, `DELETED`, `UNCHANGED` o `REVERTED`, y
estado Git seguro cuando esté disponible. Nunca contiene contenido fuente ni
la raíz absoluta.

### Relaciones, conceptos y dossier

Las relaciones mínimas son `RELATED_TO`, `DEPENDS_ON`, `PART_OF` y `REPLACES`.
Se almacenan como aristas semánticas únicas; las inversas se derivan y nunca
alteran el layout.

La consulta de conocimiento relacionado devuelve por candidato su tipo,
`IterationRef`, clasificación y coincidencias explícitas de relaciones,
conceptos y componentes. Las relaciones incluyen arista, perspectiva,
explicación, evidencia y procedencia; las coincidencias de componente y
concepto enlazan la consolidación y el evento/procedencia que las sustentan.
También separa las propuestas locales del Work Item y el catálogo oficial
`projectConcepts`, que contiene únicamente conceptos aprobados con sus trazas
de propuesta y aprobación. Una ocurrencia conceptual es una frase/token exacta
normalizada y se etiqueta `CONFIRMED_TEXT_OCCURRENCE`; no crea una relación
semántica implícita. `matchReasons` distingue coincidencia `TYPE` y `ITERATION`;
el orden determinista no constituye ranking semántico.

Una propuesta de concepto contiene identidad, nombre normalizado, explicación,
entre 1 y 500 `evidenceReferenceIds` UUID v4, fingerprint y estado `PENDING`,
`APPROVED` o `REJECTED`. Rechazar no modifica el catálogo; aprobar requiere
actor humano declarado y confirmación.

Las consolidaciones M5 estructuradas proyectan
`09_FINAL_REPORT.md`, `10_FUNCTIONAL_OVERVIEW.md`,
`11_IMPLEMENTATION.md` y `12_TESTING.md`. Estos documentos no amplían el enum
M3 y no son editables como Markdown.

Una mutación histórica M3/M4 seguida de reapertura automática se representa
mediante dos commits físicos secuenciales: primero la fuente histórica y
después `KNOWLEDGE_BASE.json` con `WORK_ITEM_REOPENED`. El segundo commit relee
el estado y compara el cursor de revisión M3/M4 con
`lastCompletionBoundary`. Converge a no-op si el cursor ya estaba incluido o el
Work Item está `IN_PROGRESS`; no existe una transacción física
cross-repository ni una idempotency key compartida entre ambas fases. Los
timestamps se conservan para auditoría, pero no deciden causalidad.
