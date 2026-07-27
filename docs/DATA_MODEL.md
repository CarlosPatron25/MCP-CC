# Data model

The following contracts describe the implemented local M1–M4 model. Required
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

## Milestone 4.1 rendering metadata (design frozen; implementation pending manual validation)

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
`WorkItem` contract. M4.1B is `IMPLEMENTED — PENDING MANUAL IBM BOB
VALIDATION`; historical dossiers receive no migration or rewrite.
