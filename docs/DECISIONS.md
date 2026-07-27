# Architecture decision records

All decisions below are approved. Status is Accepted unless later superseded.

## Approved decision index

| #   | Approved decision                                                                | Record  |
| --- | -------------------------------------------------------------------------------- | ------- |
| 1   | Only four work-item types exist.                                                 | ADR-001 |
| 2   | Rally ID is mandatory.                                                           | ADR-002 |
| 3   | Git branches are not used in the workflow.                                       | ADR-003 |
| 4   | A development sandbox or alias is mandatory.                                     | ADR-004 |
| 5   | Start date is mandatory.                                                         | ADR-005 |
| 6   | Planned completion date is optional.                                             | ADR-005 |
| 7   | Actual completion date is generated on close.                                    | ADR-005 |
| 8   | Responsible person is optional.                                                  | ADR-006 |
| 9   | Initially related components are captured.                                       | ADR-006 |
| 10  | Additional business information is optional.                                     | ADR-006 |
| 11  | The first interface is MCP for IBM Bob.                                          | ADR-007 |
| 12  | The verified IBM Bob registration is accepted.                                   | ADR-007 |
| 13  | Initial local transport is stdio.                                                | ADR-008 |
| 14  | The core is decoupled from the MCP adapter.                                      | ADR-009 |
| 15  | There is no Rally integration in Milestone 1.                                    | ADR-010 |
| 16  | There is no Copado integration in Milestone 1.                                   | ADR-010 |
| 17  | There is no VS Code extension in the MVP.                                        | ADR-011 |
| 18  | Initial persistence is file-based.                                               | ADR-009 |
| 19  | Development and validation are incremental.                                      | ADR-012 |
| 20  | The tool never accesses or writes outside its authorized root.                   | ADR-012 |
| 21  | IBM Bob runs the compiled server against a separate runtime root.                | ADR-014 |
| 22  | The MVP remains local; future sharing needs separate approval.                   | ADR-015 |
| 23  | Product layering and deferred future sharing are clarified.                      | ADR-016 |
| 24  | Document-language configuration and rendering snapshots are local and immutable. | ADR-017 |

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

## ADR-015: Local MVP before centralized knowledge service

Context: The local file-based architecture is the approved implementation for
the current MVP. The finished product is intended to provide a shared source
of truth for multiple project developers rather than independent local
workspaces.

Decision: Keep local file persistence for Milestones 3, 4, and 5. After the
local MVP, evolve the product through a separately approved initiative toward
the following target direction:

    IBM Bob -> MCP local -> Central Knowledge Service -> Single Work Item Repository -> Shared Documentation

The Central Knowledge Service will be the future source of truth. Business
logic must remain decoupled from MCP transport and persistence infrastructure
to facilitate that future migration.

Consequences: This decision changes no current architecture, behavior,
milestone scope, persistence mechanism, or external integration. It does not
authorize the implementation or design of a service contract, API, database,
deployment, authentication model, or migration plan.

Status: Partially superseded by ADR-016.

Supersession note: ADR-016 supersedes only the part of this ADR that selected a
Central Knowledge Service as the future approved direction or mandatory source
of truth. Its historical context and its decision to preserve the local MVP
remain unchanged.

## ADR-016: Product Layering: Core, Technology Profiles and Project Profiles

Context: WS Workspace MCP completed Milestones 1–3 as a local MCP product
validated for a Salesforce and Rally use case. Product evolution needs a clear
general direction without falsely treating those completed contracts as
technology-neutral or selecting a sharing architecture prematurely.

Problem: The product must distinguish general Work Item knowledge from future
technology-specific and project-specific knowledge. It must also distinguish
stable project knowledge from the generated and auditable dossier of one Work
Item. ADR-015 previously selected a Central Knowledge Service as the approved
future direction, whereas future sharing and synchronization choices are now
explicitly open.

Alternatives:

1. Retain Salesforce/Rally as the permanent product identity.
2. Implement profiles or a sharing architecture immediately.
3. Establish conceptual product layering, preserve the validated local system,
   and defer profile and sharing implementation. **Selected.**

Decision: WS Workspace will evolve toward a general WS Workspace Core with
future Technology Profiles and Project Profiles. The Core direction can own
general concepts such as Work Item, document, context, manifest, revision,
decision, checkpoint, evidence, relation, component, functional capability,
and audit. A Technology Profile is a future reusable, technology-specific
extension. A Project Profile is future stable, transversal knowledge belonging
to one project.

The Work Item Dossier remains separate: it is generated, updated, and audited
around one concrete Work Item. A future dossier may reference Project Profile
knowledge but must not become the general container for it.

Limits: This ADR defines neither a profile format, schema, API, loading
mechanism, versioning model, persistence mechanism, nor implementation. It
does not define Salesforce or Contact Center profiles and does not introduce
functional project knowledge.

Relation to M1–M3: M1–M3 remain `COMPLETED`, implemented, tested, and
validated. They form the local, documentary, and architectural base from which
the Core may evolve. They are not reinterpreted as a fully neutral Core: the
current frozen contracts explicitly contain `SalesforceContext`,
`developmentAlias`, and `rallyId` for the initial Salesforce/Rally use case.
Their neutralization requires a separate approved evolution.

Consequences: The current local filesystem, hexagonal architecture, MCP
contracts, tests, and validation evidence remain valid and unchanged. The
product identity becomes technology-independent at the strategic level while
the implementation documents its remaining dependencies honestly.

Risks: A future contributor may mistake this conceptual direction for an
implementation mandate, hide current Salesforce/Rally dependencies, or place
stable project knowledge in dossiers. Documentation and future milestone design
must keep those boundaries explicit.

Deferred elements: Sharing, synchronization, corporate folders, internal
servers, a Central Knowledge Service, central APIs, databases, multi-tenancy,
SaaS, cloud deployment, enterprise authentication, profile formats,
versioning, persistence, loaders, and onboarding are future options, not
selected decisions.

ADR-015 relationship: ADR-016 supersedes ADR-015 only where ADR-015 selected a
Central Knowledge Service as the future approved direction or required source
of truth. Centralization is not rejected; it is one unselected future option.
ADR-015's historical motivation and its local-MVP preservation remain intact.

Roadmap impact: Milestone 4 remains limited to its existing decisions,
checkpoints, and testing scope. This ADR does not start, redesign, or expand
Milestone 4.

Status: Accepted.

## ADR-017: Persistencia del idioma documental y snapshot de rendering

Context: Milestones 1–4 están completados y congelados con documentación de
sistema en inglés, contratos MCP cerrados y persistencia local. Se necesita
preparar localización de la prosa propiedad del sistema para Work Items nuevos
sin reinterpretar históricos, traducir contenido humano ni ampliar el contrato
de transporte.

Decision: La fuente de verdad del idioma documental será
`.ws-workspace/config/workspace-config.json`, con el contrato versionado
`{"schemaVersion":"1.0.0","documentLanguage":"es-ES"}`. La configuración
será JSON estricto de hasta 4 KiB, se creará sólo cuando falte mediante
publicación atómica sin reemplazo y nunca se sobrescribirá o reparará
silenciosamente. No se introduce `WS_DOCUMENT_LANGUAGE`, parámetro MCP, sidecar
ni workspace lock.

Cada Work Item nuevo creado por la implementación M4.1B conservará un
snapshot inmutable de idioma y perfil como metadata técnica dentro de
`00_MANIFEST.md`. Los perfiles
internos son `ES_ES_V1` para la prosa española nueva y `EN_BASELINE_V1` sólo para
compatibilidad histórica por ausencia de marker. La prosa del sistema será
proporcionada por proveedores tipados y un registro exhaustivo de artefactos;
los payloads humanos y tokens técnicos exactos no se traducen. Todo dossier
nuevo `ES_ES_V1` persistirá el marcador técnico exacto exclusivamente en su
`00_MANIFEST.md`, según lo establecido en
`MILESTONE_4_1_DESIGN.md`, tras el H1 y antes del primer `##`.

Los Work Items históricos sin marker conservarán exactamente el
baseline inglés, sin migración. Un snapshot, configuración o marcador inválido
fallará cerrado con errores aditivos seguros. M3 y M4 conservan sus locks,
journal, recovery, ledger, bloques protegidos, precedencia general y contratos
MCP.

Consequences: El marker es metadata técnica interna, no información funcional
ni de negocio. Su borrado manual completo es un riesgo residual aceptado: puede
hacer un dossier español indistinguible de un histórico sin marker, sin que se
autorice sidecar o autoreparación. M4.1A queda aprobado y congelado como diseño.
M4.1B debe
implementar proveedores, validadores, parser de marcador, pruebas de seguridad
y regresión. La validación automática está superada y la validación IBM Bob
separada queda pendiente antes del cierre administrativo de M4.1. No cambia el
modelo `WorkItem`, el ledger, las quince herramientas MCP ni Milestone 5, que
permanece pausado.

Status: Accepted.
