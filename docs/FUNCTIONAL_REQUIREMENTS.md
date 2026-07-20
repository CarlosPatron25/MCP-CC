# Functional requirements

## Allowed work-item types

The MVP permits exactly these values: USER_STORY, DEFECT, INCIDENT and
TECHNICAL_TASK. No additional type is implied by this list.

## Creation data

Required data for a future work-item creation tool:

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
1 defines the vocabulary and initial rules only; it does not expose a
transition tool or full state machine. A new item will start in DRAFT, CLOSED will require the
future closure evidence, and REOPENED will be allowed only after a recorded
closure. BLOCKED and CANCELLED must retain the reason as a future auditable
checkpoint or decision.

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
Milestone 3 will generate the remaining lifecycle documents progressively.
Closed items will later be moved or copied to `.ws-workspace/archive` through a
controlled process.

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
