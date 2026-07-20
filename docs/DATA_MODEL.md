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
- decisions, checkpoints, tests: Future collections.

## Enumerations

WorkItemType is exactly USER_STORY, DEFECT, INCIDENT and TECHNICAL_TASK.
WorkItemStatus is DRAFT, ANALYSIS, PLANNED, DEVELOPMENT, TESTING,
READY_FOR_REVIEW, CLOSED, BLOCKED, REOPENED and CANCELLED.

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

The TypeScript interfaces in src/domain/work-item.ts intentionally model this
vocabulary but, at the completion of Milestone 1, do not yet persist or expose
actual work items.
