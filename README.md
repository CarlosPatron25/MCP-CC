# WS Workspace MCP

WS Workspace MCP is a local Model Context Protocol server for IBM Bob and the
initial local foundation for a structured knowledge engine around software
development Work Items. Its first validated use case is Salesforce work tracked
through Rally, while its product direction is broader than that initial use
case.

It addresses the loss of context between analysis, development, testing and a
later reopening of the same work item. The server is intentionally local and
file-based in its first milestones. It has no external connection to Rally,
Copado, Salesforce, or corporate systems.

The completed Milestones 1, 2, and 3 are the local, documentary, and
architectural base from which WS Workspace Core may evolve. They are not yet a
fully technology-neutral Core: the validated creation contract explicitly
contains `SalesforceContext`, `developmentAlias`, and `rallyId`. Removing or
generalizing those dependencies requires a separate approved evolution; it is
not implied by this product direction.

## Current state

**Milestone 3 is completed.** Its approved and frozen implementation passed
automated validation and manual IBM Bob validation on 2026-07-22. Milestones 1,
2, and 3 are completed and validated.

The server now provides secure creation of an initial DRAFT Work Item dossier
and its controlled local document lifecycle, in addition to health inspection,
capability discovery, and idempotent workspace initialization. Closing,
archiving, reopening, decisions, checkpoints, and structured testing remain
unavailable.

Milestones 4 and 5 continue to use the current local file-based workspace. The
product direction distinguishes a future WS Workspace Core, Technology Profiles
and Project Profiles, without implementing or defining any of them today.
Sharing, synchronization, corporate folders, internal servers, and a Central
Knowledge Service remain future options that have not been selected.

## Requirements

- Node.js 18 or later. Milestone 1 validation used Node.js v24.18.0.
- npm. In PowerShell environments that block npm.ps1, use npm.cmd.

## Installation and validation

    npm.cmd install
    npm.cmd run build
    npm.cmd run typecheck
    npm.cmd run lint
    npm.cmd run test
    npm.cmd run check

The combined check runs typecheck, lint, tests and build. Formatting can be
checked with npm.cmd run format and applied with npm.cmd run format:write.

## Start the MCP server

The root must already exist, be a readable and writable directory, and not be a
filesystem volume root. The server never chooses a fallback path.

    $env:WS_WORKSPACE_ROOT = 'C:\\WS-Workspace'
    npm.cmd run build
    npm.cmd run start

For local development, replace start with npm.cmd run dev. The process uses
stdio for JSON-RPC; diagnostics are sent only to stderr.

## Basic technical test

After building, run:

    npm.cmd run smoke

The smoke client creates and removes its own temporary workspace. It starts the
compiled server through stdio, discovers all eight tools, initializes a
workspace, creates a Work Item, initializes the Milestone 3 documents, reads
and updates one document at its current revision, and refreshes AI context. It
checks that no absolute temporary-workspace path is returned. It never uses
`C:\\WS-Workspace` or another user workspace for this test.

## Create a Work Item

`create_work_item` creates a DRAFT dossier under
`.ws-workspace/active/<id>/`. Required input is `type`, `rallyId`, `title`,
`functionalDefinition`, `developmentAlias`, `relatedComponents`, and
`startedAt`. Dates use the strict `YYYY-MM-DD` ISO format. The tool rejects
unsafe Rally IDs, unsupported types, invalid dates, empty component lists, and
duplicates without overwriting the existing dossier.

The persisted `id` is a safe internal identifier derived from the Rally ID for
Milestone 2; `rallyId` preserves the exact user-provided value. The initial
dossier contains `WORK_ITEM.yml`, `00_MANIFEST.md`,
`01_FUNCTIONAL_ANALYSIS.md`, the three `context/` files, and empty `evidence/`
and `snapshots/` directories. Milestone 3 then adds the four controlled
lifecycle documents and a versioned lifecycle inventory without modifying
`WORK_ITEM.yml`, `AI_RULES.md`, or `NEXT_TASK.md`.

## Milestone 3 document lifecycle

Milestone 3 adds four MCP tools and no generic dossier-reading operation:

- `initialize_work_item_documents` creates only
  `02_CURRENT_STATE.md`, `03_TECHNICAL_ANALYSIS.md`,
  `04_IMPACT_ANALYSIS.md`, and `05_IMPLEMENTATION_PLAN.md`. It is idempotent
  after successful initialization and never overwrites an unexpected existing
  file.
- `get_work_item_document` reads exactly one closed-enumeration document:
  `MANIFEST`, `FUNCTIONAL_ANALYSIS`, `CURRENT_STATE`,
  `TECHNICAL_ANALYSIS`, `IMPACT_ANALYSIS`, `IMPLEMENTATION_PLAN`, or
  `AI_CONTEXT`. It accepts no path or arbitrary filename.
- `update_work_item_document` replaces one of the five editable documents
  (`FUNCTIONAL_ANALYSIS` through `IMPLEMENTATION_PLAN`) from its typed payload
  and a positive `expectedRevision`. It does not accept raw Markdown or
  patches.
- `refresh_ai_context` regenerates only `context/AI_CONTEXT.md` from approved
  persisted Work Item facts, the persisted functional analysis, and lifecycle
  metadata. It also requires the current AI-context revision.

`00_MANIFEST.md` now retains its original inventory and adds a Document
Lifecycle Inventory. Each managed document records its relative path, status
(`CREATED`, `INITIALIZED`, or `UPDATED`), positive revision, timestamp,
`updatedBy: SYSTEM`, and content type (`TEMPLATE`, `SUPPLIED`, or `DERIVED`).
Every successful update logically commits the document and manifest together.
The Work Item remains `DRAFT`.

The local repository owns containment, exclusive per-Work-Item locks, staging,
revision enforcement, and recovery of ordinary failed commits. A concurrent
or retained lock returns `DOCUMENT_LIFECYCLE_CONFLICT`; a stale revision returns
`DOCUMENT_REVISION_CONFLICT`. Responses contain only safe relative paths.

## Milestone 3 automated validation

- The full automated suite reports 56 passing tests, including deterministic
  templates and AI projection, typed updates for every editable document,
  manifest revisions, no-overwrite behavior, locks, injected commit failure
  recovery, filesystem containment, and MCP structured errors.
- `npm.cmd run format`, `npm.cmd run typecheck`, `npm.cmd run lint`,
  `npm.cmd run test`, `npm.cmd run build`, `npm.cmd run check`, and
  `npm.cmd run smoke` have passed for this implementation.
- The smoke test uses a newly created temporary root and removes it afterwards;
  it does not touch the configured IBM Bob runtime workspace.

## Milestone 3 manual IBM Bob validation

Manual validation completed on 2026-07-22 through IBM Bob with **19/19 tests
passed**. It verified the correct server version, discovery of all eight MCP
tools, Milestone 1 and 2 regression behavior, the four Milestone 3 operations,
idempotent initialization, revision control and conflicts, strict payload
validation, protected derived documents, `AI_CONTEXT` as `DERIVED`, and the
absence of absolute paths. All Milestone 3 acceptance criteria are satisfied.

Milestone 3 is officially closed. The next work is the design of Milestone 4;
Milestone 4 has not started.

## Milestone 2 Validation

- `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, and
  `npm run check` passed.
- The test suite contains 32 passing tests, including valid and optional-field
  creation, validation failures, duplicate protection, traversal protection,
  initial-file content, and structured MCP errors.
- `npm run smoke` passed using a temporary workspace; it discovered and invoked
  `create_work_item` without touching the configured runtime workspace.
- Manual IBM Bob validation passed: `health_check`,
  `get_server_capabilities`, and idempotent `initialize_workspace` behaved as
  expected; `create_work_item` created the complete minimum DRAFT dossier.
  Duplicate creation returned `WORK_ITEM_ALREADY_EXISTS`, existing dossiers
  were preserved, and neither successful nor error responses exposed absolute
  filesystem paths.

## IBM Bob

IBM Bob integration is verified. Register the server in IBM Bob's `mcp.json`
with this configuration:

```json
{
  "mcpServers": {
    "ws-workspace-mcp": {
      "command": "node",
      "args": ["C:\\US-Workspace-MCP\\dist\\index.js"],
      "env": {
        "WS_WORKSPACE_ROOT": "C:\\WS-Workspace"
      },
      "alwaysAllow": ["health_check", "get_server_capabilities"]
    }
  }
}
```

IBM Bob launches `node dist/index.js` and communicates with the server over
MCP JSON-RPC on stdio. `WS_WORKSPACE_ROOT` is passed to the child process and
is the only location in which the server may initialize or manage workspace
content.

`C:\\US-Workspace-MCP` and `C:\\WS-Workspace` have deliberately different
roles. The first contains the source code and compiled server; the second is
the authorized runtime workspace. Keeping them separate prevents a runtime MCP
tool from writing into the source repository, narrows the filesystem permission
boundary, and keeps work-item data independent of the server build.

`create_work_item` is intentionally not in `alwaysAllow`; it creates files and
should remain subject to the host's normal confirmation policy.

## Product evolution direction

The target product direction has three conceptual layers:

- **WS Workspace Core:** general Work Item, document, context, manifest,
  revision, decision, checkpoint, evidence, relation, component, functional
  capability, and audit concepts.
- **Technology Profile:** a future reusable technology-specific extension; a
  Salesforce profile is only a future example.
- **Project Profile:** future stable, project-wide knowledge. It is distinct
  from the generated, updated, and auditable Work Item Dossier.

No profile, loading mechanism, shared persistence, synchronization, service,
API, database, or central architecture is designed or implemented. See
[ARCHITECTURE_EVOLUTION_POST_M3.md](docs/ARCHITECTURE_EVOLUTION_POST_M3.md) and
ADR-016 for the approved boundaries.

## Milestone 1 Validation

- `npm run build` passed with no TypeScript errors.
- `npm run smoke` passed and discovered `health_check`,
  `get_server_capabilities`, and `initialize_workspace`.
- `initialize_workspace` created `.ws-workspace`, `active`, `archive`,
  `config`, and `README.md` on its first run; its second run returned no
  created entries and reported all five entries as existing.
- IBM Bob connected through the registered stdio MCP server and successfully
  invoked real MCP tools, including `health_check`.
- The configured runtime root propagated correctly, and filesystem access
  remained isolated to that authorized root.

See docs/ for product, functional, architectural, security and development
details.
