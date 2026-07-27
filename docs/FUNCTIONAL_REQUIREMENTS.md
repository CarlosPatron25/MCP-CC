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

The planned states are DRAFT, ANALYSIS, PLANNED, DEVELOPMENT, TESTING,
READY_FOR_REVIEW, CLOSED, BLOCKED, REOPENED and CANCELLED. Completed Milestone
1 defines the vocabulary and initial rules only; M1–M4 expose no transition
tool or full state machine. A new item starts in DRAFT and remains there during
the implemented M2–M4 operations. CLOSED will require future closure evidence,
and REOPENED will be allowed only after a recorded closure. BLOCKED and
CANCELLED must retain their reasons in separately approved future transition
work; an M4 `BLOCKER` checkpoint does not change status.

## Expected lifecycle

A future item is manually entered from Bob, receives an initial folder and
document templates, progresses through analysis, planning, development and
testing, then is closed and archived. A reopened item must preserve the closed
history and record why it was reopened.

## Progressive documentation structure

Milestone 2 creates only the minimum initial dossier: `WORK_ITEM.yml`,
`00_MANIFEST.md`, `01_FUNCTIONAL_ANALYSIS.md`, `context/AI_CONTEXT.md`,
`context/AI_RULES.md`, `context/NEXT_TASK.md`, and the `evidence` and
`snapshots` directories. The initial manifest records the created inventory and
its initial status.

The complete dossier is a product target, not a Milestone 2 requirement.
Milestone 3 generates the remaining lifecycle documents progressively.
Closed items will later be moved or copied to `.ws-workspace/archive` through a
controlled process.

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

## Milestone 4.1 document-language behaviour (design frozen; manual validation pending)

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
automatic tests and smoke validation have passed; IBM Bob validation remains
pending.

## Future closure and reopening rules

Closing must record an actual completion date, final report, test evidence and
the final state. Reopening must create an auditable event, retain historical
evidence and set the state to REOPENED; it must not silently replace the
previous closure.

## Search and traceability

Future search must support exact Rally ID lookup and date-based filtering at
least by start date, planned completion date and actual completion date. Each
mutation must be attributable to a timestamp, recorded decision or checkpoint,
and the documentation generated from it.
