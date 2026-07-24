# Milestone 4 Technical Design: Decisions, Checkpoints and Testing

**Milestone Status:** COMPLETED  
**Design:** FROZEN  
**Architecture Challenge:** PASSED  
**Design Review:** PASSED  
**Implementation:** COMPLETED — FROZEN  
**Automated Validation:** PASS — 145 tests  
**Manual IBM Bob Validation:** PASS — 42/42 tests

This document is the approved and frozen technical contract for Milestone 4.
Automated and manual evidence is recorded separately in
`Pruebas_Milestone_4.md`. The design and implementation are frozen, and
Milestone 4 is officially closed. This status does not change the completed
M1–M3 contracts.

## 1. Objective

Extend one active local Work Item dossier with controlled audit records for
decisions, progress checkpoints, test-plan versions, test-case definitions,
test executions, and evidence references. The scope remains local, file-based,
MCP-first, deterministic, and compatible with the M1–M3 local MVP.

## 2. Inherited context

M1, M2, and M3 are `COMPLETED` and frozen. The server runs locally over MCP
stdio, uses IBM Bob as its first client, and persists only below the authorized
`WS_WORKSPACE_ROOT`.

M3 already provides a closed seven-document lifecycle inventory, optimistic
document revisions, one exclusive Work Item lock, contained staging, logical
document-plus-manifest commits, and explicit derived `AI_CONTEXT` refresh. Its
managed-document enumeration and `get_work_item_document` contract remain
unchanged.

The existing `DecisionRecord`, `Checkpoint`, and `TestCase` domain placeholders
are not persisted or implemented behavior. They do not determine the M4
persisted model and are not changed by this design.

## 3. Scope

The frozen M4 scope, now implemented, is:

- append-only decisions and related correction, supersession, or withdrawal
  events;
- append-only progress checkpoints;
- immutable versions of a test plan and their generated test-case identities;
- append-only manual or automatic test-execution records;
- controlled, non-dereferenced evidence references;
- deterministic Markdown projections of the structured audit source;
- a dedicated M4 manifest section; and
- an explicit, bounded M4 summary in `AI_CONTEXT` through the existing
  `refresh_ai_context` operation.

All M4 behavior applies only to an existing active Work Item whose M3 document
lifecycle has already been initialized. The Work Item remains `DRAFT`.

Each Work Item can have at most one logical test plan in M4. That plan can have
multiple immutable versions; M4 does not support multiple plans, suites,
campaigns, or parallel planning branches.

## 4. Outside scope

M4 does not introduce:

- Work Item closing, archiving, reopening, a final state, an actual completion
  date, or `09_FINAL_REPORT.md`;
- Technology Profiles, Project Profiles, search, shared storage,
  synchronization, a central service, HTTP APIs, databases, authentication,
  multi-user behavior, or multi-tenancy;
- Rally, Copado, Salesforce, Git, or other external integrations;
- evidence upload, storage, reading, existence checks, content validation, or
  external URL handling;
- arbitrary file reads or writes; or
- automatic `AI_CONTEXT` refresh.

## 5. Frozen functional decisions

- `records/AUDIT_LEDGER.json` is the structured source of truth for M4.
- M4 Markdown files are deterministic, protected projections; they are not
  editable source records.
- Audit entries are append-only. A correction, supersession, or withdrawal is
  a new entry linked to an earlier one; existing confirmed entries are never
  rewritten or silently removed.
- Each audit entry receives a server-generated UUID v4 and a mandatory client
  `idempotencyKey`. The two concepts are independent.
- Audit timestamps are generated through the existing `Clock` abstraction.
- Test plans have a stable logical `planId` and immutable positive
  `planRevision` values. A Work Item has exactly zero or one logical plan, and
  every appended plan version belongs to that one plan and owns its test-case
  definitions.
- A test execution references the exact `planId`, `planRevision`, and
  server-generated `testCaseId` that it exercised, and a new execution can
  target only the active plan version.
- A checkpoint of type `BLOCKER` is an audit record, not a Work Item state
  transition.
- Evidence references are logical relative names below `evidence/`; recording
  one does not prove that a file exists or is valid.

## 6. Alternatives considered

### Markdown as the source record

One append-only Markdown document per category would be easy to inspect, but
would require fragile parsing for uniqueness, relations, idempotency, and test
case validation. It also makes safe reconstruction after a partial update more
difficult. It is not selected.

### Structured ledger with derived Markdown

A single structured local ledger can validate relationships and idempotency,
while projections remain readable by people and AI. All related artifacts can
be committed together. This is the selected design.

### One source file per audit entry

This would maximize physical immutability but creates unnecessary local-file
growth, listing complexity, and recovery surface for the approved M4 scope. It
is not selected.

## 7. Architecture selected

```text
MCP adapter
  → WorkItemAuditService
    → WorkItemAuditRepository port
      → Local filesystem adapter
        → authorized root/.ws-workspace/active/<work-item>
```

The MCP adapter validates transport shapes, invokes a service, and serializes
safe results or structured errors. It never constructs paths, reads or writes
files, owns revisions, acquires locks, or renders business Markdown.

`WorkItemAuditService` coordinates use cases. `AuditLedgerService` validates
append-only records, idempotency, references, and plan revisions.
`AuditProjectionService` renders M4 Markdown from a ledger snapshot only.
`M4ManifestInventoryService` owns the M4 manifest block.
`AuditContextSummaryService` supplies the M4-only summary to the existing
AI-context projection without exposing physical evidence locations.

The local adapter is the only component that knows physical files, paths,
staging, locks, commits, rollback, or recovery. The application layer receives
and returns domain records and safe dossier-relative paths only.

## Architectural Invariants

1. An audit entry is never silently deleted.
2. A confirmed decision, checkpoint, plan version, execution, or evidence
   reference is never modified.
3. Every correction, supersession, or withdrawal is a new auditable entry.
4. `records/AUDIT_LEDGER.json` is the M4 structured source of truth.
5. M4 Markdown is derived from that source.
6. The structured source is never rebuilt from Markdown.
7. Every derived Markdown projection is deterministically regenerable from the
   ledger.
8. Derived documents accept no direct edit operation.
9. `AI_CONTEXT` remains derived and protected, and is regenerated only through
   `refresh_ai_context`.
10. No M4 mutation refreshes `AI_CONTEXT` automatically.
11. Every M4 mutation uses one logical multi-file commit.
12. A ledger, its projections, and its manifest inventory are never left in a
    visible divergent state.
13. M4 never modifies `WORK_ITEM.yml`.
14. M4 never changes Work Item status.
15. A `BLOCKER` checkpoint is not a state transition.
16. M4 never implements closing, archiving, reopening, or actual completion.
17. M4 does not modify `get_work_item_document`.
18. M4 does not extend M3's historical seven-document managed enumeration.
19. M3 and M4 use one exclusive lock per Work Item.
20. No response exposes absolute paths, staging paths, lock paths, or native
    filesystem details.
21. No M4 operation reads or writes an arbitrary file.
22. An evidence reference is not evidence of file existence or content
    validity.
23. Every append-only write is idempotent through `idempotencyKey`.
24. A stale revision never performs a partial write.
25. Every audit timestamp comes from `Clock`.
26. Projection content and ordering are deterministic.
27. M1–M3 remain compatible, completed, and historically unchanged.
28. M4 adds no profiles, centralization, synchronization, or external
    integration.
29. Idempotency metadata and its referenced entry are committed and validated
    together.
30. A detected ledger, index, manifest, or projection inconsistency fails
    safely; it is never silently repaired.
31. The manifest renderer preserves all sections not owned by the active
    operation.
32. A Work Item has at most one logical test plan in M4; plan versions are its
    immutable history, not separate plans.
33. A new test execution targets only the active plan version.
34. M4 initialization checks preserve the historical M1–M3 error precedence.
35. A shared-lock conflict does not disclose whether M3 or M4 holds the lock.

## 8. Domain model

### Audit ledger

Conceptually, `AUDIT_LEDGER.json` contains:

```text
schemaVersion
revision
updatedAt
decisions[]
checkpoints[]
testPlans[]
testExecutions[]
evidenceReferences[]
idempotencyIndex[]
```

`revision` is the positive global `auditRevision` after the first confirmed
append. The initialized empty ledger has revision `0`. `updatedAt` is generated
by `Clock`. Collections retain entries in append order; projections apply their
own specified deterministic sort. The ledger contains no Markdown, projection
bytes, file contents, absolute paths, or other recomputable derived data.

`testPlans[]` is an append-only collection of versions, not multiple logical
plans. It is empty until the first definition, and every entry thereafter must
have the same generated `planId`. The active version is the entry with the
highest confirmed `planRevision` for that one plan.

### Decision

A decision has `id`, `idempotencyKey`, `kind`, `title`, `decision`,
`rationale`, `declaredActor`, `recordedAt`, optional `relatedDecisionId`, and
optional `evidenceReferenceIds`.

`kind` is exactly `DECISION`, `CORRECTION`, `SUPERSESSION`, or `WITHDRAWAL`.
For every non-`DECISION` entry, `relatedDecisionId` is required and must refer
to a prior decision. A `CORRECTION` clarifies an earlier decision;
`SUPERSESSION` replaces it with a new decision; `WITHDRAWAL` records its
withdrawal. Projections derive current-versus-historical presentation from
these explicit relations without changing prior entries.

### Checkpoint

A checkpoint has `id`, `idempotencyKey`, `kind`, `summary`, `declaredActor`,
`recordedAt`, optional `correctsCheckpointId`, optional
`relatedDecisionIds`, and optional `evidenceReferenceIds`.

`kind` is exactly `PROGRESS`, `RISK`, `BLOCKER`, or `HANDOFF`. A correction is
a new checkpoint that references a prior checkpoint; it does not rewrite it.

### Test plans and cases

`TestPlanVersion` has an immutable server-generated version-entry `id`, one
server-generated logical `planId`, positive `planRevision`, `idempotencyKey`,
`purpose`, `declaredActor`, `recordedAt`, and test cases.

The first `define_test_plan` call omits `planId`, requires
`expectedPlanRevision: 0`, and creates the only logical plan with
`planRevision: 1`. Supplying a client-selected `planId` for that first call is
rejected because internal identities are server-generated. Once any version
exists, omitting `planId` does not create a second plan and returns
`TEST_PLAN_CONFLICT`. Every subsequent version must provide that same returned
`planId` and the current `expectedPlanRevision`; a different `planId` returns
`TEST_PLAN_CONFLICT`. The last confirmed version is the active version.

A test case is not an IBM Bob identity: it receives a server-generated
`testCaseId` within its plan version and contains `title`, `objective`,
`verificationMethod` (`MANUAL` or `AUTOMATED`), and `expectedOutcome`.

### Test executions

A test execution has `id`, `idempotencyKey`, `planId`, `planRevision`,
`testCaseId`, `executionMethod`, `outcome`, `summary`, `declaredActor`,
`recordedAt`, and optional `evidenceReferenceIds`.

`executionMethod` is `MANUAL` or `AUTOMATED`; `outcome` is `PASSED`, `FAILED`,
or `BLOCKED`. A new execution is valid only when
`planRevision == expectedPlanRevision == currentPlanRevision` for the one
logical plan. A stale version returns `TEST_PLAN_REVISION_CONFLICT`; a caller
cannot add a retrospective execution to a superseded version. Absence of an
execution is the only representation of a case not run. Executions already
recorded against earlier versions remain immutable and auditable.

### Evidence reference

An evidence reference has `id`, `idempotencyKey`, `label`, optional
`description`, `logicalPath`, `declaredActor`, and `recordedAt`.

`logicalPath` is a normalized forward-slash path beneath `evidence/`. It cannot
be absolute, contain `..`, contain empty traversal segments, use a URL scheme,
or refer outside the dossier. The path is a label only: M4 never opens, stats,
uploads, reads, or validates that file. A distinct evidence entry cannot claim
an already-registered normalized logical path.

## 9. Schema, IDs, and idempotency

### Schema version

The ledger begins at `schemaVersion: "1.0.0"`. A future schema change must be
explicitly versioned, parsed strictly, and accompanied by an approved migration
or compatibility strategy. M4 does not define later-milestone fields or a
future schema now. Unknown root fields, unknown entry fields, duplicate IDs,
and malformed indexes are corruption, not ignored extensions.

### Internal identifiers

Every generated internal identity uses canonical UUID v4 text from
`crypto.randomUUID()`: lowercase hexadecimal groups separated by hyphens. It
has no functional prefix and no dependency on Rally, Salesforce, IBM Bob, a
record type, or user input. It is an implementation identity, not business
meaning.

### Idempotency key and index

Every append operation accepts one required, normalized, non-empty
`idempotencyKey`. The key is stored in its created entry and in the explicit
ledger index. Each index row contains:

```text
idempotencyKey
operation
entryId
payloadFingerprint
```

`payloadFingerprint` is a deterministic hash of the canonical normalized
client payload for that operation. Server-generated IDs, timestamps,
`auditRevision`, and derived values are excluded from the fingerprint.

The index is an array rather than an unchecked map so it can be rendered,
sorted, and validated deterministically. Its key remains globally unique across
all M4 append operations. The operation is retained to produce a precise
conflict and to validate the index against the linked entry.

Inside the shared lock, a service first checks the index. Same key, operation,
and fingerprint returns the already-confirmed result without a write, revision
increment, timestamp change, or projection refresh. The same key with another
operation or fingerprint returns a stable idempotency conflict. Every index row
must reference exactly one entry whose embedded key matches; any mismatch is a
corruption failure.

## 10. Derived documents and physical dossier structure

M4 creates only these approved artifacts:

```text
records/AUDIT_LEDGER.json
06_DECISIONS.md
07_CHECKPOINTS.md
08_TEST_PLAN.md
evidence/REFERENCES.md
```

`09_FINAL_REPORT.md` remains reserved for M5 and is not created.

The ledger is system-managed structured data. `06_DECISIONS.md` projects
decision history and current presentation; `07_CHECKPOINTS.md` projects
checkpoints; `08_TEST_PLAN.md` projects plan versions, cases, and executions;
and `evidence/REFERENCES.md` projects evidence-reference metadata only. All
four Markdown files are derived, protected, and regenerated from the ledger.

`initialize_work_item_tracking` creates all five artifacts atomically only
when none exists. A fully valid existing set is idempotently reported as
existing. A partial, duplicate, malformed, manually altered, or inconsistent
set fails safely without overwriting anything.

## 11. Manifest integration

`00_MANIFEST.md` gains a single M4-owned block:

```text
## Milestone 4 Audit Inventory
```

It records the ledger schema version, current `auditRevision`, generated time,
last activity time, ledger-relative path, the four projection-relative paths,
projection revision, and counters for decisions, checkpoints, plan versions,
test cases, executions, and evidence references.

The block is placed before `## Document Lifecycle Inventory` for compatibility
with the current M3 renderer. Position is not the only preservation mechanism:
the M4 implementation must use an explicit section parser and lossless section
compositor. It must detect zero-or-one M4 block, reject duplicate or malformed
blocks, replace only its own valid block, and preserve all non-owned manifest
sections byte-for-byte where their managed data is not changing.

M3's historical lifecycle inventory retains exactly its seven entries. M4 does
not add a document type to it. When M4 changes the manifest, the existing M3
`MANIFEST` lifecycle metadata is advanced normally because its content changed;
the other six M3 entries remain untouched. The M4 inventory has its own audit
revision and does not reinterpret M3 document revisions.

The shared manifest compositing contract must pass this regression sequence:

1. initialize M3;
2. mutate M3;
3. initialize M4;
4. mutate M4;
5. mutate M3 again;
6. mutate M4 again;
7. read and validate both inventories.

No step may remove or duplicate a section, change M3 document types, lose a
revision, alter another milestone's counter, or reconstruct non-owned content.

## 12. Revisions, concurrency, and recovery

### Revision policy

`auditRevision` is the ledger-wide revision. `planRevision` is the immutable
functional revision within one logical plan. They are distinct.

| Operation                       | Expected revision requirements                                                         | Successful result                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `initialize_work_item_tracking` | None                                                                                   | `auditRevision: 0` for a new ledger; existing revision when idempotent |
| `record_decision`               | `expectedAuditRevision`                                                                | next `auditRevision` and generated decision ID                         |
| `record_checkpoint`             | `expectedAuditRevision`                                                                | next `auditRevision` and generated checkpoint ID                       |
| `define_test_plan`              | `expectedAuditRevision`; `expectedPlanRevision` (`0` only for the first plan)          | next audit revision, the only plan ID, and next plan revision          |
| `record_test_execution`         | `expectedAuditRevision`; `planRevision == expectedPlanRevision == currentPlanRevision` | next audit revision and execution ID                                   |
| `register_evidence_reference`   | `expectedAuditRevision`                                                                | next audit revision and evidence ID                                    |
| `get_work_item_tracking`        | None                                                                                   | current audit revision and one closed view                             |

An exact idempotent retry is checked before a stale-revision rejection. It
returns the original confirmed result and does not increment a revision.
Otherwise, a stale audit or plan revision returns a stable conflict and writes
nothing.

### Shared lock

M3 and M4 share the existing one-lock-per-Work-Item exclusion boundary. M4
must not introduce a parallel lock. A retained lock fails closed; M4 must not
silently steal or delete it. Existing M3 operations retain their documented
conflict behavior, while an M4 operation returns `AUDIT_TRACKING_CONFLICT` with
the safe conceptual message: "Another Work Item operation holds the shared
exclusive lock." The holder may be an M3 or M4 operation and is never
identified.

### Logical multi-file commit

Every real M4 mutation stages the next ledger, every derived Markdown
projection, and the next manifest together. The adapter validates the current
ledger, projections, M3 inventory, M4 inventory, lock, and expected revisions
before any visible replacement. It then promotes the staged set as one logical
commit. The returned revision describes only a fully confirmed set.

### Staging, rollback, and recovery

Staging remains contained beneath `.ws-workspace/.staging` and is never
returned. The adapter records a contained transaction journal before moving
visible originals. If a normal failure occurs, staged replacements are removed,
backups are restored, and staging is cleaned.

On the next dossier operation, an abandoned journal is detected before a read
or new mutation. Recovery restores the last fully committed visible set and
removes only the validated transaction staging material. Recovery never infers
new ledger data from projections, never deletes a valid dossier artifact, and
never exposes internal locations. Tests must inject failures before promotion,
between replacements, and after originals are moved.

## 13. Controlled AI-context integration

`refresh_ai_context` remains the only AI-context mutation. M4 operations do
not call it or modify its revision.

When a valid M4 ledger exists, an M4 summary may include current decisions,
recent checkpoints, priority blockers and risks, the active plan version, the
latest execution per test case from that active version, and evidence IDs with
labels. It excludes the full ledger, every evidence file content, logical and
physical paths, URLs, state changes, inferred conclusions, and complete
execution history. Historical plan versions and their executions remain in the
ledger but are not removed to build this summary.

The M4 summary is deterministically ordered and limited to 16 KiB through
semantic truncation: preserve section headings and select entries in documented
priority order, then emit an explicit omission marker. It must never cut bytes
or Markdown syntax arbitrarily. If M4 is absent, `AI_CONTEXT` retains its M3
projection behavior.

## 14. MCP tools and contracts

All tool schemas are strict. They accept no path, filename, raw Markdown,
arbitrary JSON document, or arbitrary dossier read request.

| Tool                            | Purpose                                           | Mutation |
| ------------------------------- | ------------------------------------------------- | -------- |
| `initialize_work_item_tracking` | Initialize the approved M4 audit artifacts.       | Yes      |
| `record_decision`               | Append one immutable decision event.              | Yes      |
| `record_checkpoint`             | Append one immutable checkpoint.                  | Yes      |
| `define_test_plan`              | Append an immutable initial or next plan version. | Yes      |
| `record_test_execution`         | Append one execution for a current-plan case.     | Yes      |
| `register_evidence_reference`   | Append one controlled evidence reference.         | Yes      |
| `get_work_item_tracking`        | Return one closed M4 projection.                  | No       |

### Inputs and outputs

- `initialize_work_item_tracking`: `{ workItemId }`; returns created or
  existing safe relative artifact paths and `auditRevision`.
- `record_decision`: `{ workItemId, expectedAuditRevision, idempotencyKey,
kind, title, decision, rationale, declaredActor, relatedDecisionId?,
evidenceReferenceIds? }`; returns the generated ID, timestamp, and next
  audit revision.
- `record_checkpoint`: `{ workItemId, expectedAuditRevision, idempotencyKey,
kind, summary, declaredActor, correctsCheckpointId?, relatedDecisionIds?,
evidenceReferenceIds? }`; returns the generated ID, timestamp, and next
  audit revision.
- `define_test_plan`: `{ workItemId, expectedAuditRevision, idempotencyKey,
planId?, expectedPlanRevision, purpose, declaredActor, testCases[] }`. The
  first request omits `planId` and uses `expectedPlanRevision: 0`; the server
  creates the only `planId` and revision `1`. Later requests must provide that
  same ID and the current plan revision. Omission after initialization or a
  different ID returns `TEST_PLAN_CONFLICT`. Each case supplies only title,
  objective, verification method, and expected outcome; the server generates
  all plan-version and test-case IDs. The result returns `planId`,
  `planRevision`, generated case IDs, and audit revision.
- `record_test_execution`: `{ workItemId, expectedAuditRevision,
expectedPlanRevision, idempotencyKey, planId, planRevision, testCaseId,
executionMethod, outcome, summary, declaredActor, evidenceReferenceIds? }`;
  validates that `planRevision`, `expectedPlanRevision`, and the active plan
  revision are identical before it returns execution ID, timestamp, and audit
  revision.
- `register_evidence_reference`: `{ workItemId, expectedAuditRevision,
idempotencyKey, label, description?, logicalPath, declaredActor }`; returns
  evidence ID, timestamp, and audit revision.
- `get_work_item_tracking`: `{ workItemId, trackingType }`, where
  `trackingType` is exactly `DECISIONS`, `CHECKPOINTS`, `TESTING`, or
  `EVIDENCE_REFERENCES`; returns one projection, its safe relative path, and
  current audit revision.

An operation that references an evidence ID, decision ID, checkpoint ID, plan,
or test case validates that reference against the ledger. A later attachment
requires a new append-only correction or record; no existing record is edited.

### Idempotency and retry behavior by operation

| Operation                       | Idempotency behavior                                                                   | Retry behavior                                                                                                                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initialize_work_item_tracking` | Structural idempotency; no `idempotencyKey` is required.                               | A complete valid artifact set is returned as existing without a write. A partial set fails safely.                                                                                                                    |
| `record_decision`               | The entry and index share the required key and canonical payload fingerprint.          | An exact retry returns the original decision ID, timestamp, and audit revision. A different payload or operation for that key conflicts.                                                                              |
| `record_checkpoint`             | The entry and index share the required key and canonical payload fingerprint.          | An exact retry returns the original checkpoint result without a write; an incompatible retry conflicts.                                                                                                               |
| `define_test_plan`              | The immutable plan-version entry and index share the required key and fingerprint.     | An exact retry returns the original generated plan and case IDs before revision validation. A new first plan is allowed only when none exists; later versions require the one existing plan ID and current revisions. |
| `record_test_execution`         | The execution and index share the required key and canonical payload fingerprint.      | An exact retry returns the original execution before stale-revision rejection. A new execution requires the active plan version; an older version conflicts.                                                          |
| `register_evidence_reference`   | The evidence entry and index share the required key and canonical payload fingerprint. | An exact retry returns the original evidence ID; a new logical path collision or incompatible retry fails safely.                                                                                                     |
| `get_work_item_tracking`        | Read-only; no key or revision precondition.                                            | A later read returns the latest fully committed closed view.                                                                                                                                                          |

## 15. Validation and errors

Validation has this mandatory precedence for every M4 operation:

1. validate that the active Work Item exists;
2. validate that its M3 lifecycle is initialized;
3. validate M4 initialization, ledger, projections, and manifest state; then
4. validate the M4 request, idempotency, relations, and revisions.

Missing Work Item returns the historical `WORK_ITEM_NOT_FOUND` behavior.
Absent or uninitialized M3 lifecycle returns the corresponding historical M3
code, including `DOCUMENT_NOT_INITIALIZED`; it is never masked as an M4 error.
With valid M3 but absent M4 artifacts, non-initialization M4 operations return
`AUDIT_TRACKING_NOT_INITIALIZED`. A partial, duplicate, malformed, or
inconsistent M4 set returns `AUDIT_LEDGER_CORRUPT` or the appropriate safe
structural error. `initialize_work_item_tracking` follows the same first two
checks but may create an absent M4 set.

Further validation includes strict closed enums, positive safe revisions, UUID
and idempotency behavior, required normalized text, one-logical-plan
cardinality, active-plan execution equality, unique normalized evidence paths,
valid ledger relations, canonical forward-slash evidence paths, and contained
physical paths owned only by the repository.

Identifier validation is intentionally syntactic before semantic lookup. A
malformed `planId` or `testCaseId` is not a comparable domain identity and
returns `AUDIT_ENTRY_VALIDATION_FAILED`. A canonical UUID v4 that is valid in
shape but identifies another logical plan returns `TEST_PLAN_CONFLICT`; a
canonical UUID v4 absent from the exact active plan version returns
`TEST_CASE_NOT_FOUND`. This is validation precedence, not an expansion or
change of the error contract.

Existing M1–M3 error codes remain unchanged. The M4 codes are:

| Code                             | Meaning                                                                 |
| -------------------------------- | ----------------------------------------------------------------------- |
| `AUDIT_TRACKING_NOT_INITIALIZED` | M3 is valid but required M4 artifacts are absent.                       |
| `AUDIT_ENTRY_VALIDATION_FAILED`  | A strict M4 request or reference is invalid.                            |
| `AUDIT_IDEMPOTENCY_CONFLICT`     | A key is reused with another operation or payload.                      |
| `AUDIT_REVISION_CONFLICT`        | `expectedAuditRevision` is stale.                                       |
| `TEST_PLAN_REVISION_CONFLICT`    | The expected, supplied, or current active plan revision does not match. |
| `TEST_PLAN_CONFLICT`             | A request attempts a second logical plan or another `planId`.           |
| `AUDIT_ENTRY_NOT_FOUND`          | A referenced audit entry is absent.                                     |
| `TEST_CASE_NOT_FOUND`            | The case is absent from the exact plan version.                         |
| `EVIDENCE_REFERENCE_DUPLICATE`   | A different entry claims the same logical path.                         |
| `AUDIT_TRACKING_CONFLICT`        | Another Work Item operation holds the shared exclusive lock.            |
| `AUDIT_LEDGER_CORRUPT`           | Ledger, index, projection, or M4 manifest data is inconsistent.         |
| `AUDIT_TRACKING_UPDATE_FAILED`   | A staged M4 commit could not be confirmed safely.                       |

Errors expose only stable codes, safe messages, and limited field or safe-ID
details. They never reveal absolute paths, native error text, staging names,
or lock locations.

## 16. Acceptance criteria

M4 implementation validation requires:

- every approved M4 artifact can be initialized safely and idempotently;
- the ledger is the only structured source and every Markdown projection is
  deterministic and protected;
- UUID v4 IDs and idempotency behavior satisfy the approved retry rules;
- append-only entries cannot be replaced or deleted through MCP;
- audit and plan revision conflicts leave no partial state;
- every Work Item has zero or one logical plan, whose immutable versions share
  the same generated `planId`;
- a new execution satisfies
  `planRevision == expectedPlanRevision == currentPlanRevision`, while earlier
  executions remain auditable;
- M3 and M4 manifest inventories survive alternating mutations intact;
- M4 error precedence returns a historical M3 error before an M4
  initialization error when the M3 lifecycle is absent;
- M4 does not modify `WORK_ITEM.yml`, status, M3 document types, or
  `get_work_item_document`;
- no response leaks an absolute or internal filesystem path;
- evidence registration performs no file access or validity claim;
- `AI_CONTEXT` changes only after an explicit successful refresh; and
- all automated and manual validation evidence is collected before completion.

## 17. Test strategy

Tests use temporary roots and preserve the complete M1–M3 suite.

- Domain tests cover UUID format, IDs, normalized fingerprints, idempotency
  index validation, append-only relations, single-plan cardinality, immutable
  plan versions, active-plan execution equality, and test-case references.
- Projection tests cover stable ordering, Markdown determinism, semantic
  16 KiB truncation, omitted-content markers, and absence of paths or evidence
  content.
- Repository tests cover exact initialization, no overwrite, partial-state
  rejection, containment, symlinks, shared locks, multi-file staging, rollback,
  abandoned-journal recovery, and corruption detection.
- Service tests cover same-key retries, incompatible-key conflicts, stale audit
  and plan revisions, attempted second or different plan IDs, attempts to
  execute against superseded versions, duplicate evidence paths, invalid
  relationships, initialization-error precedence, and `WORK_ITEM.yml`/status
  preservation.
- MCP tests cover seven closed tools, strict payload rejection, closed tracking
  views, safe structured errors, and the absence of generic file access.
- Regression tests execute the mandatory alternating M3/M4 manifest sequence.
- The implemented smoke test uses a disposable root to exercise initialization,
  each M4 mutation, all four closed reads, an exact retry, a conflict, explicit
  AI-context refresh, exact tool discovery, cleanup, and no absolute-path
  leakage.

## 18. Manual IBM Bob validation plan

Manual validation occurs only after automated validation passes. IBM Bob must
verify tool discovery, M1–M3 regression behavior, M4 initialization
idempotence, a real append for every M4 record type, exact same-key retries,
idempotency conflicts, stale revisions, M3/M4 manifest preservation, derived
document protection, single-plan cardinality, rejection of execution against a
superseded version, explicit AI-context refresh, evidence non-dereferencing,
and absence of absolute paths. It must also verify that no M5 operation or
external integration appears.

Manual IBM Bob validation completed successfully after automated validation:
42 tests were executed, 42 passed, 0 failed, and 0 were non-executable. The
official result is `MANUAL IBM BOB VALIDATION: PASS`.

Three observations were reviewed during closure. Malformed `planId` and
`testCaseId` values returned the strict request-validation code before
semantic plan or case lookup, as specified above. Parallel calls returned
`AUDIT_TRACKING_CONFLICT`, as required by the shared exclusive Work Item lock
and fail-closed concurrency policy. None represents a contractual defect; no
code or contract change was required.

## 19. Risks and known limitations

The structured-ledger design adds files and a multi-file transaction, but
avoids using Markdown as mutable source. The primary risks are unbounded audit
growth, manual alteration, stale clients, projection/ledger divergence, and
mistaking a reference for validated evidence. The design mitigates these with
append-only data, strict parsing, shared locking, deterministic projections,
semantic context bounds, transaction recovery, and explicit wording.

M4 intentionally does not provide a durable external backup, content-addressed
evidence store, authenticated identity, global search, remote sharing, or
crash-proof guarantees beyond the defined local journal recovery protocol.
Those capabilities require separately approved future scope.

## 20. Documentation impact

This design does not alter historical M1–M3 requirements, models, designs, or
validation evidence. Operational documentation describes verified M4 behavior
and automated and manual results in `Pruebas_Milestone_4.md`. The seven M4
tools and their approved local artifacts are implemented and frozen. Milestone
4 is completed and officially closed.

## 21. Incremental implementation plan

1. Add M4 domain contracts, strict validation, UUID generation, canonical
   payload fingerprinting, and clock-based timestamps.
2. Add the audit repository port and deterministic ledger/projection services.
3. Generalize the local transaction mechanism internally while preserving M3
   behavior and its single Work Item lock.
4. Implement lossless M3/M4 manifest section composition and alternating
   mutation regression tests.
5. Implement M4 initialization and append-only application services.
6. Add thin MCP registrations, capability reporting, and structured errors.
7. Add repository, service, MCP, security, recovery, and regression tests.
8. Expand the disposable-root smoke client after implementation.
9. Synchronize verified documentation, run the approved validation commands,
   collect IBM Bob evidence, and request closure separately.

Implementation record: steps 1–9 are implemented and validated. Automated and
manual IBM Bob evidence is recorded, documentation is synchronized, and the
closure decision is approved.

No step authorizes M5, profiles, centralization, integrations, or a change to
the completed M1–M3 contracts.

## 22. Traceability matrix

| Requirement or decision               | Invariant        | Model                                   | MCP tool                      | Service / repository              | Artifact                      | Validation                                                    |
| ------------------------------------- | ---------------- | --------------------------------------- | ----------------------------- | --------------------------------- | ----------------------------- | ------------------------------------------------------------- |
| Structured source of truth            | 4–7              | `AuditLedger`                           | all M4 mutations              | ledger service / audit repository | `records/AUDIT_LEDGER.json`   | deterministic projection and corruption tests                 |
| Append-only decisions                 | 1–3, 23          | `Decision`                              | `record_decision`             | audit service                     | `06_DECISIONS.md`             | retry, correction, supersession, withdrawal tests             |
| Checkpoints without state change      | 13–16            | `Checkpoint`                            | `record_checkpoint`           | audit service                     | `07_CHECKPOINTS.md`           | status-preservation tests                                     |
| One logical plan, immutable versions  | 2, 24–26, 32     | `TestPlanVersion`, `TestCaseDefinition` | `define_test_plan`            | ledger service                    | `08_TEST_PLAN.md`             | first-plan, second-plan, wrong-ID, and stale-plan tests       |
| Active-version execution traceability | 2, 23–26, 33     | `TestExecution`                         | `record_test_execution`       | ledger service                    | `08_TEST_PLAN.md`             | exact active plan/version/case and historical-execution tests |
| Non-dereferenced evidence             | 20–22            | `EvidenceReference`                     | `register_evidence_reference` | audit service / repository        | `evidence/REFERENCES.md`      | traversal, URL, and no-file-access tests                      |
| Closed M4 reading                     | 17, 21           | `TrackingType`                          | `get_work_item_tracking`      | audit service / repository        | one approved projection       | unsupported-view tests                                        |
| Explicit AI update                    | 8–10, 26         | `AuditContextSummary`                   | existing `refresh_ai_context` | context projection provider       | `context/AI_CONTEXT.md`       | explicit-refresh and 16 KiB tests                             |
| Manifest coexistence                  | 11–12, 17–19, 31 | M4 inventory                            | all M4 mutations              | manifest compositor / repository  | `00_MANIFEST.md`              | required M3/M4 alternation test                               |
| Safe multi-file persistence           | 11–12, 19–21, 24 | commit request                          | all mutating tools            | local audit repository            | staging and backups           | injected-failure and recovery tests                           |
| Initialization error precedence       | 27, 34           | initialization state                    | all M4 tools                  | audit service / repository        | M3 lifecycle and M4 artifacts | M3-before-M4 error-precedence tests                           |
| Shared lock confidentiality           | 19–21, 35        | lock conflict                           | all M4 mutations              | local audit repository            | internal lock only            | M3-holder and M4-holder conflict tests                        |

## 23. Freeze record

Human review accepted this contract after the architecture challenge and
design review passed. The scope, exclusions, invariants, model, persistence
boundaries, concurrency, MCP surface, validation, and implementation sequence
are frozen. The validated implementation is also frozen. Automated validation
passed with 145 tests, manual IBM Bob validation passed with 42/42 tests, and
Milestone 4 is officially closed.
