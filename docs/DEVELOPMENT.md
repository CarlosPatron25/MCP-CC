# Development guide

## Environment

Use Node.js 18 or later and npm. Milestone 1 was validated with Node.js
v24.18.0. In PowerShell environments that block `npm.ps1`, use `npm.cmd`.

## Commands

    npm.cmd install
    npm.cmd run dev
    npm.cmd run build
    npm.cmd run start
    npm.cmd run typecheck
    npm.cmd run lint
    npm.cmd run format
    npm.cmd run format:write
    npm.cmd run test
    npm.cmd run check
    npm.cmd run smoke

Set WS_WORKSPACE_ROOT to an existing authorized directory before dev or start.
Build before running start or smoke. Keep this directory separate from the
source repository; the verified runtime directory is `C:\\WS-Workspace`.

`npm.cmd run smoke` creates and removes a temporary workspace itself. It does
not require `WS_WORKSPACE_ROOT` and must not be pointed at the real runtime
workspace. It validates the compiled stdio server through initialization,
`create_work_item`, Milestone 3 document initialization, a controlled read and
update, all seven Milestone 4 operations, all four closed tracking views, an
exact idempotent retry, a controlled conflict, and explicit AI-context refresh.
It requires exactly 15 tools, verifies revisions and identifiers, rejects
absolute-path leakage in all observed results, and confirms temporary-root
cleanup.

## IBM Bob runtime configuration

The verified IBM Bob `mcp.json` entry launches the compiled server directly:

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

This configuration belongs to IBM Bob rather than this repository. The
repository at `C:\\US-Workspace-MCP` contains the source and `dist` output;
`C:\\WS-Workspace` is the separately authorized runtime data root. Do not use
the source repository as `WS_WORKSPACE_ROOT`.

## Conventions

Use strict TypeScript, ES modules and explicit type-only imports. Keep functions
small and give errors stable codes. Production code must not use console.log
because stdio stdout is reserved for MCP protocol messages. Prettier controls
formatting and ESLint enforces code-quality rules.

Keep domain and application-service business logic independent of the MCP
transport and filesystem implementation. Milestones 4 and 5 retain the current
local file persistence. The product direction distinguishes a future Core,
Technology Profiles, and Project Profiles, but none is implemented or defined
in the current MVP. Do not add remote infrastructure, shared storage,
synchronization, APIs, databases, profiles, or integrations until a future
milestone explicitly scopes and approves them.

The completed M1–M3 contracts retain `SalesforceContext`, `developmentAlias`,
and `rallyId`. Do not present them as already neutral or change them as part of
an architectural-documentation update.

## Folder architecture

- src/domain: language of the business model.
- src/config: safe configuration resolution.
- src/filesystem: secure filesystem operations.
- src/services: reusable use cases.
- src/mcp: transport adapter only.
- src/scripts: local diagnostic clients.
- tests: temporary-directory unit tests.

## Contribution flow

Read the foundation documents, identify the narrowest milestone scope, record
new decisions, implement service-level behavior first, then expose it through
MCP. Update the corresponding tests and documents in the same change. Inspect
the diff before handoff.

## Definition of Done

A change has clear scope, strict compilation, passing typecheck, lint and tests,
updated documentation, no unconfirmed external contract, and evidence of its
validation. It must preserve filesystem containment and avoid corporate data.

## Adding an MCP tool

Add a service method and unit tests first. Define a Zod input schema in
src/mcp/server.ts, register the tool as a thin adapter, return a structured
serializable result, and map known errors with toStructuredError. Update the
capabilities response, README and relevant requirements.

## Work Item creation conventions

Keep `create_work_item` as a thin adapter over `WorkItemCreationService`. The
service validates input and builds document contents; the filesystem layer owns
safe staging, exclusive file creation, and final promotion into `active/`.
Tests must use temporary roots, assert that service and MCP responses contain
no absolute paths, and preserve the Milestone 1 tool behavior.

## Work Item document lifecycle conventions

Keep the MCP adapter thin: it forwards the four approved lifecycle operations
to `WorkItemDocumentService` and serializes stable errors. Domain and
application services must not construct paths or access the filesystem;
`WorkItemDossierRepository` is the only dossier boundary. The current local
adapter owns containment, staging, logical locks, commits, and recovery.

Document templates and AI-context projection are deterministic. Use the
injected clock for lifecycle timestamps; tests must supply a fixed clock. A
mutation must carry a positive expected revision and update the document and
manifest as one logical repository operation. Do not add generic dossier reads,
closure, archive, reopen, external integrations, or central-service behavior
under this convention. Decisions, checkpoints, testing records, and evidence
references belong only to the separate M4 audit-tracking contract; never add
them to M3's seven document types or typed document payloads.

## Milestone 4 audit-tracking conventions

Keep the seven M4 registrations thin and closed. `WorkItemAuditService` owns the
use cases; `AuditLedgerService` owns strict normalized records, UUIDv4
identities, canonical request fingerprints including expected preconditions,
one global idempotency index, relationships, and separate audit and plan
revisions. Check an exact retry before rejecting its now-stale original
revision. Never mutate a prior entry.

A Work Item has at most one logical test plan in M4. New versions append to that
plan, and executions must reference the active plan revision and one of its test
case IDs. Evidence input is metadata only: normalize a contained path below
`evidence/`, but never open, stat, upload, read, or validate the referenced
file.

The audit repository and M3 dossier repository must use the shared
`WorkItemOperationCoordinator`. Every M4 mutation commits the ledger, four
projections, and manifest as one journaled operation. Validate physical
directory chains, regular files, approved relative paths, hashes, journal
identity, and owned locks before destructive recovery. Retain unknown or
unowned material and fail closed.

The M4 manifest block is composed losslessly before the M3 lifecycle block.
Projections are deterministic and protected. M4 mutations never refresh
`AI_CONTEXT`; only the explicit M3 refresh can request the bounded M4 summary.
Do not modify `WORK_ITEM.yml`, status, the M3 document enumeration, closure,
archive, reopening, profiles, external adapters, or shared infrastructure.

The MCP SDK normally validates a tool schema before application preconditions.
For M4, keep the published JSON Schema strict while the tested adapter bridge
passes the raw input to application validation after Work Item, M3, and M4
initialization checks. This bridge depends on the current SDK behavior and must
retain its stdio regression tests whenever the SDK is upgraded.

## Adding a document or template

Define its purpose and lifecycle in docs/FUNCTIONAL_REQUIREMENTS.md and
docs/DATA_MODEL.md. Add the template through a dedicated document-generation
service in a later milestone, test non-overwrite and idempotence behavior, then
record it in the manifest contract.
