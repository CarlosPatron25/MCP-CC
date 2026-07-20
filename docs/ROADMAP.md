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
and a temporary-workspace MCP smoke test covering `create_work_item`.

## Milestone 3: Context and Document Lifecycle

Generate and update the functional, current-state, technical-analysis, impact,
implementation-plan and AI-context documents through controlled services.
This milestone expands the dossier beyond the minimum structure created in
Milestone 2.

## Milestone 4: Decisions, Checkpoints and Testing

Add auditable decisions, progress checkpoints, test plans and evidence links.

## Milestone 5: Closing, Archive and Reopening

Implement transition validation, generated actual completion dates, controlled
archive handling, final reports and auditable reopening.

## Optional future milestone: Rally or Copado

Consider an adapter only after explicit approval, a documented contract and a
security review. It is not an implied roadmap commitment.
