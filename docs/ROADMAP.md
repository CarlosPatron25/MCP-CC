# Roadmap

No delivery dates are assigned. A milestone starts only after the preceding one
has verifiable validation evidence.

## Milestone 1: MCP Foundation - COMPLETED

Create the local TypeScript project, documentation, secure configuration and
foundation tools. This milestone is completed and its validation includes a
passing build and smoke test, idempotent workspace initialization, verified IBM
Bob `mcp.json` registration, real MCP tool execution over stdio, and secure
filesystem isolation. See [CURRENT_STATE.md](CURRENT_STATE.md) for the
verification record.

## Milestone 2: Work Item Creation - COMPLETED

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

## Milestone 3: Context and Document Lifecycle - COMPLETED

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

## Milestone 4: Decisions, Checkpoints and Testing - COMPLETED

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

## Milestone 5: Closing, Archive and Reopening

Implement transition validation, generated actual completion dates, controlled
archive handling, final reports and auditable reopening.
This milestone continues to use local file persistence.

Status: not started. This roadmap entry is not a frozen technical contract.

## Post-MVP architecture options

WS Workspace may evolve from the validated local base toward a general Core
with future Technology Profiles and Project Profiles. Sharing, synchronization,
corporate folders, internal servers, a Central Knowledge Service, central APIs,
databases, multi-tenancy, SaaS, cloud deployment, and enterprise authentication
are not selected.
This is not a delivery milestone, does not alter the scope of Milestones 3–5,
and must not be implemented until separately planned and approved.

## Optional future milestone: Rally or Copado

Consider an adapter only after explicit approval, a documented contract and a
security review. It is not an implied roadmap commitment.
