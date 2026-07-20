# Architecture decision records

All decisions below are approved. Status is Accepted unless later superseded.

## Approved decision index

| #   | Approved decision                                                 | Record  |
| --- | ----------------------------------------------------------------- | ------- |
| 1   | Only four work-item types exist.                                  | ADR-001 |
| 2   | Rally ID is mandatory.                                            | ADR-002 |
| 3   | Git branches are not used in the workflow.                        | ADR-003 |
| 4   | A development sandbox or alias is mandatory.                      | ADR-004 |
| 5   | Start date is mandatory.                                          | ADR-005 |
| 6   | Planned completion date is optional.                              | ADR-005 |
| 7   | Actual completion date is generated on close.                     | ADR-005 |
| 8   | Responsible person is optional.                                   | ADR-006 |
| 9   | Initially related components are captured.                        | ADR-006 |
| 10  | Additional business information is optional.                      | ADR-006 |
| 11  | The first interface is MCP for IBM Bob.                           | ADR-007 |
| 12  | The verified IBM Bob registration is accepted.                    | ADR-007 |
| 13  | Initial local transport is stdio.                                 | ADR-008 |
| 14  | The core is decoupled from the MCP adapter.                       | ADR-009 |
| 15  | There is no Rally integration in Milestone 1.                     | ADR-010 |
| 16  | There is no Copado integration in Milestone 1.                    | ADR-010 |
| 17  | There is no VS Code extension in the MVP.                         | ADR-011 |
| 18  | Initial persistence is file-based.                                | ADR-009 |
| 19  | Development and validation are incremental.                       | ADR-012 |
| 20  | The tool never accesses or writes outside its authorized root.    | ADR-012 |
| 21  | IBM Bob runs the compiled server against a separate runtime root. | ADR-014 |

## ADR-001: Work-item types

Context: The team receives several Rally item kinds.
Decision: Permit only USER_STORY, DEFECT, INCIDENT and TECHNICAL_TASK.
Consequences: Validation and user interfaces reject every other kind.
Status: Accepted.

## ADR-002: Mandatory Rally ID

Context: Items need a traceable external reference.
Decision: Rally ID is mandatory at creation.
Consequences: Direct Rally access is not required to maintain traceability.
Status: Accepted.

## ADR-003: No Git branch workflow

Context: Copado is used by the team but source branching is not part of the
requested process.
Decision: Do not model or require a Git branch.
Consequences: No branch metadata or Git operations are introduced.
Status: Accepted.

## ADR-004: Mandatory development alias

Context: Work must identify its development Salesforce context.
Decision: A sandbox or development alias is required.
Consequences: Future creation validation requires SalesforceContext.developmentAlias.
Status: Accepted.

## ADR-005: Date policy

Context: Planning and real completion differ.
Decision: Start date is mandatory, planned completion is optional, and actual
completion is generated only on close.
Consequences: Creation cannot supply a final completion date.
Status: Accepted.

## ADR-006: Responsibility and initial scope

Context: Ownership and impacted components aid context recovery.
Decision: Responsible person and additional business information are optional;
initially related components are captured at creation.
Consequences: They are represented as optional responsibility/business records
and a required InitialScope.
Status: Accepted.

## ADR-007: IBM Bob MCP-first interface

Context: IBM Bob is the first operational client, and its local `mcp.json`
registration has been verified in Milestone 1.
Decision: Use MCP as the first interface with the confirmed IBM Bob stdio
registration.
Consequences: A generic multi-client product is not required; core logic stays
outside the adapter.
Status: Accepted.

## ADR-008: Local stdio transport

Context: The server runs on a personal computer.
Decision: Use local stdio transport initially.
Consequences: No HTTP listener, authentication endpoint or remote deployment is
introduced in Milestone 1.
Status: Accepted.

## ADR-009: Decoupled core and file persistence

Context: A future diagnostic CLI must reuse behavior.
Decision: Persist initially to files and keep services independent of the MCP
adapter.
Consequences: Filesystem infrastructure is called through application services.
Status: Accepted.

## ADR-010: Deferred external integrations

Context: Rally and Copado contracts are not confirmed.
Decision: Neither Rally nor Copado integration is included in Milestone 1.
Consequences: Information is manual and adapters remain future work.
Status: Accepted.

## ADR-011: No VS Code extension in the MVP

Context: IBM Bob is the approved first interface.
Decision: Do not add a VS Code extension.
Consequences: The MCP API remains the integration boundary.
Status: Accepted.

## ADR-012: Incremental validation and containment

Context: The project is personal-development software that must not touch
unapproved locations.
Decision: Deliver and validate one milestone at a time; never read or write
outside the authorized workspace root.
Consequences: WS_WORKSPACE_ROOT is explicit and all child paths are contained.
Status: Accepted.

## ADR-013: Reject filesystem volume roots

Context: An explicit path such as C:\ is technically absolute but grants an
unnecessarily broad local write scope.
Decision: Reject a configured filesystem volume root even when it is otherwise
readable and writable.
Consequences: The operator must choose a dedicated child directory; the
configuration failure is clear and does not expose the configured path.
Status: Accepted.

## ADR-014: Separate IBM Bob runtime workspace

Context: Milestone 1 validation confirmed IBM Bob registration through
`mcp.json`, using Node.js to launch `C:\\US-Workspace-MCP\\dist\\index.js` and
passing `WS_WORKSPACE_ROOT=C:\\WS-Workspace` over a local stdio MCP connection.
The executable and runtime data have different authorization needs.

Decision: Keep the source/build directory and the authorized runtime workspace
separate. IBM Bob launches the compiled server from the source/build directory,
while the server receives its sole writable location through
`WS_WORKSPACE_ROOT`.

Consequences: Runtime initialization and future workspace operations cannot use
the project repository as their target under the verified configuration. The
filesystem boundary remains narrow, work-item data is independent of server
builds, and the IBM Bob registration is a confirmed operational contract for
Milestone 1.

Status: Accepted and verified in Milestone 1.
