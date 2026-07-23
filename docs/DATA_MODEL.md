# Data model

The following contracts establish names and ownership before the lifecycle is
implemented. Required fields are marked Required, nullable user choices are
Optional, values set by the system are Generated, and later lifecycle fields
are Future.

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
- decisions, checkpoints, tests: Future collections.

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

| Contract               | Required fields                        | Optional fields       | Generated or future fields    |
| ---------------------- | -------------------------------------- | --------------------- | ----------------------------- |
| WorkItemDates          | startedAt                              | plannedCompletionAt   | actualCompletionAt on close   |
| WorkItemResponsibility | none                                   | responsiblePerson     | future ownership history      |
| SalesforceContext      | developmentAlias                       | sandboxName           | future org metadata           |
| FunctionalContext      | definition                             | acceptanceCriteria    | future refined context        |
| InitialScope           | relatedComponents                      | none                  | future discovered components  |
| BusinessContext        | none                                   | additionalInformation | future stakeholder data       |
| DecisionRecord         | id, title, decision, decidedAt         | rationale             | future alternatives and links |
| Checkpoint             | id, recordedAt, summary                | author                | future structured progress    |
| TestCase               | id, title, result                      | evidenceReferences    | future execution detail       |
| WorkItemManifest       | schemaVersion, workItemId, generatedAt | none                  | future document inventory     |

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
