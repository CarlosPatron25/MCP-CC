# Product definition

## Vision

La visión vigente establece que WS Workspace construye y mantiene una base de
conocimiento viva de un proyecto software. Los Work Items son la unidad de
adquisición incremental: su dossier conserva conocimiento comprensible para
que una persona o una IA de desarrollo pueda reanudar el trabajo sin
reconstruir la historia. Salesforce y Rally son el primer caso validado, no la
frontera tecnológica permanente del producto.

## Target user

The primary user is a developer using IBM Bob while analysing, implementing,
testing, or revisiting a Work Item. The initially validated user is a Salesforce
developer working with a Rally reference. Technical leads and reviewers are
secondary consumers of the resulting documentation.

## Problem

Work Item requests, local analysis, implementation decisions, affected
components, and test evidence can otherwise live in disconnected locations or
disappear from the active conversation. Reopening an item requires rediscovery
and increases the risk of incomplete changes. The initial implementation keeps
the Salesforce/Rally vocabulary required by its validated contract.

## Value proposition

For every approved work item, the product will make its functional request,
technical context, decisions, progress and evidence discoverable in a
consistent local directory. IBM Bob can use the same structured context without
embedding business knowledge in the MCP adapter.

## MVP scope

The intended MVP supports exactly four work-item types, local file persistence,
a controlled document lifecycle, state tracking and an MCP-first interface for
IBM Bob.

Milestones 1 through 4.1 are `COMPLETED — FROZEN` and validated. Milestone 1
provides the
secure MCP foundation and workspace initialization. Milestone 2 provides safe,
manual creation of a DRAFT Work Item and its minimum initial dossier through
`create_work_item`. Milestone 3 completes the approved local context-and-
document-lifecycle scope: the four remaining analysis documents, controlled
single-document reads, typed replacement updates, manifest lifecycle metadata,
and derived AI-context refresh. Milestone 4 implements local append-only
decisions and checkpoints, immutable test-plan versions and executions,
controlled evidence references, deterministic audit projections, and explicit
bounded AI-context integration. Its automated validation and manual IBM Bob
validation have passed, and Milestone 4 is completed. M4.1A is a
`DESIGN APPROVED — FROZEN` documentation/localisation decision; M4.1B is
implemented and has passed automatic and manual IBM Bob validation. Milestone
4.1 is `COMPLETED — FROZEN`.

Milestone 5 está `COMPLETED — FROZEN`. Su contrato y su implementación aditiva
han superado la validación manual oficial B1–B19 mediante IBM Bob en un
workspace corporativo aislado. M1–M4.1 permanecen preservados y congelados.

## M4.1A document-language boundary

The approved M4.1A design governs implemented system-owned documentation for
new Work Items through a workspace-selected `es-ES` profile captured in an
immutable snapshot. It neither translates user-provided content nor changes the existing
MCP, Work Item, ledger, locking, recovery, or `AI_CONTEXT` contracts. Historical
Work Items remain in their persisted English baseline. The configuration and
snapshot are implemented; no `WS_DOCUMENT_LANGUAGE` runtime variable exists.
M4.1B passed automatic and manual IBM Bob validation, and Milestone 4.1 is
`COMPLETED — FROZEN`.

## Incremento de producto Milestone 5

**Hecho verificado:** M1–M4.1 proporcionan la baseline local de quince
herramientas históricas, dossiers versionados, ledger M4, proyecciones
protegidas, idempotencia, locking y recovery. M5 amplía esa baseline sin
retirar ni renombrar dichos contratos.

**Decisión M5:** el incremento introduce una base de conocimiento estructurada
workspace-level separada del ledger M4, sesiones explícitas, snapshots
deterministas, participantes, procedencia, relaciones, conceptos,
consolidación orientada al lector futuro y ciclo de vida lógico. IBM Bob es el
cliente de referencia, pero las reglas siguen siendo portables mediante MCP y
puertos de aplicación.

**Implementación y cierre:** el contrato completo está en
`MILESTONE_5_DESIGN.md`. El estado vigente es `COMPLETED — FROZEN`: B1–B19 se
ejecutó satisfactoriamente mediante IBM Bob y verificó el ciclo M5 completo y
la limpieza del workspace al cierre. El servicio central, sharing,
autenticación corporativa, scanner completo, PDF y PowerPoint permanecen fuera
de M5.

## Outside the MVP

- Direct Rally integration.
- Direct Copado integration.
- A VS Code extension.
- Automatic access to Salesforce or corporate repositories.
- Remote deployment or a multi-client shared service in the local MVP.

## Future architecture direction

The local-file MVP remains the approved execution architecture through
Milestone 5. Product evolution distinguishes a future general WS Workspace
Core from future Technology Profiles and Project Profiles. A
Technology Profile may eventually express technology-specific vocabulary and
conventions; a Project Profile may eventually hold stable, project-wide
knowledge. M5 defines only a narrow local concept catalogue, relations and
knowledge-query boundary; it does not define a complete profile format,
shared persistence mechanism, API or loader.

The Project Profile is not a Work Item Dossier. A dossier contains generated,
updated, and auditable knowledge for one work item; a Project Profile is future
stable, transversal project knowledge that a dossier may eventually reference.

Sharing, synchronization, corporate folders, internal servers, a Central
Knowledge Service, APIs, databases, multi-tenancy, SaaS, cloud deployment, and
enterprise authentication remain unselected future options. They do not change
the local MVP architecture.

## Product principles

- Preserve traceability over convenience.
- Keep the domain independent of IBM Bob.
- Keep business logic independent of persistence and transport infrastructure.
- Keep stable project knowledge separate from individual Work Item dossiers.
- Avoid treating the validated Salesforce/Rally contract as a fictitiously
  neutral Core.
- Require explicit workspace authorization before writing.
- Keep integrations simulated until their contracts are confirmed.
- Grow one verified milestone at a time.

## Initial definition of success

Milestones 1 and 2 have verified that an IBM Bob user can run the local server,
safely initialize an authorized workspace, and create a DRAFT Work Item dossier
without exposing or modifying files outside that workspace. Manual IBM Bob
validation also confirmed duplicate protection and preservation of existing
dossiers.

Milestone 3 implemented the approved local document lifecycle and passed both
automated validation and manual IBM Bob validation on 2026-07-22 (19/19
tests). The dossier can hold controlled current-state, technical-analysis,
impact-analysis, and implementation-plan documents; it can also expose one
approved document at a time, versioned metadata, and derived AI context. The
milestone is completed.

**Milestone 4 Architecture Challenge: PASSED.** **Milestone 4 Design Review:
PASSED.** Its formal design is frozen in
[MILESTONE_4_DESIGN.md](MILESTONE_4_DESIGN.md). The implementation exposes
exactly seven approved M4 operations backed by a schema-versioned append-only
ledger, protected projections, global idempotency, revision checks, shared
locking, and journaled multi-file persistence. It preserves `WORK_ITEM.yml`,
status, and all M3 contracts.

Automated validation passed with 24 test files and 145 tests plus the complete
format, typecheck, lint, build, combined-check, and disposable-root smoke
workflow. Manual IBM Bob validation passed with 42/42 tests, 0 failures, and 0
non-executable tests. The three observations were resolved as contract-valid
validation precedence and shared-lock behavior, without code changes.

The completed M1–M4.1 foundation is the valid local
base for future Core evolution, not a claim that the existing
`SalesforceContext`, `developmentAlias`, and `rallyId` contracts are already
neutral. The M4 design and implementation are frozen and Milestone 4 is
officially closed. Contract neutralization requires an explicitly approved
future change.
