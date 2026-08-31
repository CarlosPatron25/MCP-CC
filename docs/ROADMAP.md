# Roadmap

No delivery dates are assigned. A milestone starts only after the preceding one
has verifiable validation evidence.

## Milestone 1: MCP Foundation - COMPLETED — FROZEN

Create the local TypeScript project, documentation, secure configuration and
foundation tools. This milestone is completed and its validation includes a
passing build and smoke test, idempotent workspace initialization, verified IBM
Bob `mcp.json` registration, real MCP tool execution over stdio, and secure
filesystem isolation. See [CURRENT_STATE.md](CURRENT_STATE.md) for the
verification record.

## Milestone 2: Work Item Creation - COMPLETED — FROZEN

Validate manual fields, create a work-item directory and initial dossier, and
persist the initial manifest. Its delivered structure is limited to
`WORK_ITEM.yml`, `00_MANIFEST.md`, `01_FUNCTIONAL_ANALYSIS.md`, the three
context documents, and the `evidence` and `snapshots` directories. It must not
introduce external integrations, lifecycle operations, or documents assigned to
later milestones.

Validation passed: typecheck, lint, 32 automated tests, build, combined check,
and a temporary-workspace MCP smoke test covering `create_work_item`. Manual
IBM Bob validation also confirmed health, capabilities, initialization
idempotency, DRAFT dossier creation, duplicate protection, non-overwrite
behavior, and the absence of absolute paths in MCP responses.

## Milestone 3: Context and Document Lifecycle - COMPLETED — FROZEN

Generate and update the functional, current-state, technical-analysis, impact,
implementation-plan and AI-context documents through controlled services.
This milestone expands the dossier beyond the minimum structure created in
Milestone 2 and continues to use local file persistence.

The technical design is approved and frozen in
[MILESTONE_3_DESIGN.md](MILESTONE_3_DESIGN.md). The approved implementation is
complete: it creates exactly the four missing documents, reads one closed-type
document at a time, updates only editable documents through typed payloads and
revisions, maintains the manifest inventory, and refreshes derived AI context.
It remains local and file-based.

Automated validation passed: format, typecheck, lint, 56 tests, build, combined
check, and the expanded temporary-workspace smoke test. Manual IBM Bob
validation passed on 2026-07-22 with 19/19 tests. It verified all eight MCP
tools, Milestone 1 and 2 regression behavior, the four new operations,
idempotency, revisions and conflicts, strict payloads, derived AI context, and
the absence of absolute paths. All Milestone 3 acceptance criteria are
satisfied.

**Milestone 4 Architecture Challenge: PASSED.** **Milestone 4 Design Review:
PASSED.** Its formal design is frozen in
[MILESTONE_4_DESIGN.md](MILESTONE_4_DESIGN.md). Automated implementation
validation and manual IBM Bob validation have passed.

## Milestone 4: Decisions, Checkpoints and Testing - COMPLETED — FROZEN

The implemented milestone provides auditable decisions, progress checkpoints,
test plans, executions, and evidence references through local file persistence.

Design status: `FROZEN`. Implementation status: `COMPLETED — FROZEN`.

The implemented scope is exactly seven MCP tools, one schema-versioned
append-only audit ledger, four protected projections, one losslessly composed
M4 manifest inventory, global mutation idempotency, separate audit and plan
revisions, immutable versions of one logical test plan, logical
non-dereferenced evidence references, a shared M3/M4 Work Item lock, journaled
multi-file recovery, and explicit bounded AI-context integration.

Automated validation covers 24 test files with 145 passing tests and the
required format, typecheck, lint, build, combined check, and disposable-root
smoke commands. The smoke flow discovers exactly 15 tools and exercises all
seven M4 operations while preserving the M1–M3 baseline. See
[Pruebas_Milestone_4.md](Pruebas_Milestone_4.md).

Manual IBM Bob validation passed with 42/42 tests, 0 failures, and 0
non-executable tests. Its three observations were classified as two expected
strict-validation precedence results and one expected shared-lock concurrency
conflict. No contractual defect was found. The design, implementation, and
validation evidence are frozen; Milestone 4 is officially closed.

It does not introduce Technology Profiles, Project Profiles, shared storage,
synchronization, a Central Knowledge Service, central APIs, databases, or
multi-tenancy. It also does not implement closing, archiving, reopening, or
state transitions. Its detailed design is documented in
[MILESTONE_4_DESIGN.md](MILESTONE_4_DESIGN.md), and the implementation follows
that frozen contract.

## Milestone 4.1A: Document-language design - DESIGN APPROVED — FROZEN

This design-only milestone freezes the workspace-local language configuration,
immutable per-Work-Item manifest rendering snapshot, Spanish provider profile for future
system-owned prose, technical Markdown marker, and English historical baseline.
It makes no implementation change and does not alter M1–M4 contracts, tools,
locks, journal, recovery, ledger, or AI context. See
[MILESTONE_4_1_DESIGN.md](MILESTONE_4_1_DESIGN.md).

## Milestone 4.1B: Document-language implementation - IMPLEMENTED

M4.1B implements the frozen M4.1A design, automatic regression coverage and
smoke validation. Manual IBM Bob validation passed with no implementation or
contract defects; idempotent retry, human-payload preservation, rendering
marker, historical compatibility, and M1–M4 regression were validated. The
observations were non-blocking. The language is not a runtime variable or MCP
parameter, and no tool contract changed. Milestone 4.1 is `COMPLETED — FROZEN`.

## Milestone 5: Ciclo asistido y base de conocimiento viva — COMPLETED — FROZEN

**Hecho verificado:** M1–M4.1 permanecen completados y congelados. La
implementación aditiva M5 preserva las quince herramientas históricas e
incorpora sesiones, snapshots técnicos, participantes M5, relaciones entre
Work Items, catálogo de conceptos, consolidación, cierre y reapertura lógica.

**Decisión aprobada:** [MILESTONE_5_DESIGN.md](MILESTONE_5_DESIGN.md) es el
contrato técnico de M5. El alcance introduce de forma incremental:

- fuente estructurada única M5 en
  `.ws-workspace/records/KNOWLEDGE_BASE.json`, separada del ledger M4;
- `WS_PROJECT_SOURCE_ROOT` como segunda raíz explícita de solo lectura;
- creación v2 y localización dual sin migrar dossiers históricos;
- sesiones, snapshots deterministas, checkpoints y reanudación;
- responsable, colaboradores y procedencia declarada;
- dossier híbrido y proyecciones orientadas al lector futuro;
- relaciones, conceptos y consulta de conocimiento relacionado; y
- revisión, cierre lógico, cancelación y reapertura auditable.

Completar no mueve el dossier a `.ws-workspace/archive`; el archivado físico
queda diferido. Los estados canónicos M5 son `IN_PROGRESS`, `COMPLETED` y
`CANCELLED`, con proyección compatible para contratos históricos.

**Implementación y validación:** los incrementos compatibles de contrato,
workflow, observación, sesiones, dossier, relaciones, conceptos, revisión y
MCP están implementados y congelados. La validación manual oficial mediante
IBM Bob completó satisfactoriamente B1–B19 en un workspace corporativo aislado,
con ciclo de vida, sesiones, snapshots, workflow, relaciones, revisión
semántica, auditoría, consolidación, cierre y limpieza operacional verificados.
El workspace final no tenía locks persistentes ni staging, journals o claims.
La matriz automática y el registro manual canónico están en
[Pruebas_Milestone_5.md](Pruebas_Milestone_5.md). El estado vigente es
`COMPLETED — FROZEN`.

## Post-MVP architecture options

WS Workspace may evolve from the validated local base toward a general Core
with future Technology Profiles and Project Profiles. Sharing, synchronization,
corporate folders, internal servers, a Central Knowledge Service, central APIs,
databases, multi-tenancy, SaaS, cloud deployment, and enterprise authentication
are not selected.
This is not a delivery milestone, does not alter the frozen scope of
Milestones 3–4.1 or the approved M5 contract, and must not be implemented until
separately planned and approved.

## Optional future milestone: Rally or Copado

Consider an adapter only after explicit approval, a documented contract and a
security review. It is not an implied roadmap commitment.
