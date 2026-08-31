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

The M5 process accepts `WS_WORKSPACE_ROOT` and the optional
`WS_PROJECT_SOURCE_ROOT`. Use a separate, explicitly authorized read-only
project directory for operations that capture technical snapshots; never infer
it from `cwd` or reuse the writable root. Its absence preserves M1–M4.1
availability and makes session activation fail safely.

The current `npm.cmd run smoke` creates and removes temporary workspace and
project roots itself. It must not be pointed at a real runtime workspace. It
validates the compiled stdio server through representative M1–M5 operations,
preserves discovery of the fifteen historical tools, verifies revisions and
identifiers, rejects absolute-path leakage in observed results, and confirms
temporary-root cleanup.

## IBM Bob runtime configuration

The verified IBM Bob `mcp.json` entry launches the compiled server directly:

```json
{
  "mcpServers": {
    "ws-workspace-mcp": {
      "command": "node",
      "args": ["C:\\US-Workspace-MCP\\dist\\index.js"],
      "env": {
        "WS_WORKSPACE_ROOT": "C:\\WS-Workspace",
        "WS_PROJECT_SOURCE_ROOT": "C:\\ruta\\de\\proyecto\\solo-lectura"
      },
      "alwaysAllow": ["health_check", "get_server_capabilities"]
    }
  }
}
```

This configuration belongs to IBM Bob rather than this repository. The
repository at `C:\\US-Workspace-MCP` contains the source and `dist` output;
`C:\\WS-Workspace` is the separately authorized runtime data root.
`WS_PROJECT_SOURCE_ROOT` must identify the separate project tree that Bob may
observe read-only; replace the illustrative value and never reuse either root
as the other.

## Conventions

Use strict TypeScript, ES modules and explicit type-only imports. Keep functions
small and give errors stable codes. Production code must not use console.log
because stdio stdout is reserved for MCP protocol messages. Prettier controls
formatting and ESLint enforces code-quality rules.

Keep domain and application-service business logic independent of the MCP
transport and filesystem implementation. Milestones 4 and 5 retain local file
persistence. M5 approves only a narrow local knowledge base, relation model,
concept catalogue and observation port; it does not implement complete
Technology or Project Profiles. Do not add remote infrastructure, shared
storage, synchronization, APIs, databases, complete profiles, or integrations
outside the approved M5 contract.

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

Do not create lifecycle or recovery markers outside the ADR-022 protocol.
Schema `2.0.0` requires a process `instanceId`, operation ID, acquisition token
and an exact lock reference in each claim. Reconciliation must run through the
shared lock/claim/transaction classifier, revalidate physical identity and
remain independent of artifact age. Never suppress an unconfirmed release; if
the functional operation also failed, preserve its `WorkspaceError` and attach
the cleanup failure.

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

## Milestone 4.1 document-language conventions (completed and frozen)

M4.1A is a frozen design and M4.1B is implemented. Do not add
`WS_DOCUMENT_LANGUAGE`, an MCP language parameter, a sidecar, a global
string-language lint rule, or automatic translation. System-visible prose is
obtained from an exhaustive typed
artifact registry and a `DocumentContentProvider` selected through immutable
technical metadata in `00_MANIFEST.md`. User-supplied text and strict technical
tokens remain
literal.

The workspace configuration is a strict, maximum-4-KiB JSON file at
`.ws-workspace/config/workspace-config.json`. It is create-once, never
overwritten, and uses safe non-replacement publication after existing filesystem
checks. Each new Spanish `00_MANIFEST.md` includes the exact
marker and position documented in `MILESTONE_4_1_DESIGN.md`; historical
manifests without a marker remain valid and must never be rewritten.

M4.1B tests cover configuration and marker corruption, concurrent creation,
snapshot immutability, Spanish provider coverage, human-text preservation,
byte-compatible historical rendering, M3/M4 integration, and unchanged
fifteen-tool MCP schemas. See `Pruebas_Milestone_4_1.md` for reproducible
automatic results. Automatic and manual IBM Bob validation have passed.
Milestone 4.1 is `COMPLETED — FROZEN`.

## Convenciones de desarrollo de Milestone 5 (implementado y congelado)

M5 está `COMPLETED — FROZEN`; las reglas siguientes continúan siendo
obligatorias para mantenimiento y correcciones. La validación manual oficial
IBM Bob, incluida la revalidación ADR-022, se completó satisfactoriamente.

- Keep `.ws-workspace/records/KNOWLEDGE_BASE.json` as the sole M5 structured
  source. Never add M5 fields or operation names to the strict M4 ledger.
- Use closed discriminated unions, strict Zod codecs, UUID v4 identities,
  injected `Clock`, canonical fingerprints, expected revisions and exact retry
  before stale-revision checks.
- Keep `create_work_item` unchanged. Additive creation and workflow
  initialization must use the dual locator and reject duplicate IDs across
  historical and nested layouts.
- Domain and application services never construct paths. The locator,
  knowledge repository and observation adapter own their distinct physical
  boundaries.
- `WS_WORKSPACE_ROOT` is the only write boundary.
  `WS_PROJECT_SOURCE_ROOT` is read-only, non-overlapping and never returned.
  Snapshot code must stream hashes, enforce limits and avoid file content.
- Acquire the M5 knowledge lock before affected Work Item locks; sort Work Item
  IDs lexicographically. Do not introduce a second per-Work-Item lock.
- Confirm the knowledge base, projections, manifests and legacy YAML affected
  by one logical mutation in a single recoverable transaction. Recovery target
  recognition does not grant general write authority.
- Do not describe the historical M3/M4 mutation plus M5 auto-reopen bridge as
  one physical transaction. They are sequential commits. Every completion must
  capture all seven M3 document revisions and the M4 `auditRevision` under the
  M5 gate and shared Work Item lock. The bridge must compare its typed M3/M4
  cursor with that boundary before bridge idempotency: an older/equal cursor is
  a no-op, while a newer cursor reopens only a still-`COMPLETED` workflow.
  Retry safety does not depend on timestamps or a shared idempotency key.
- Do not attach the historical bridge to `initialize_work_item_documents`; a
  valid initialization after completion creates no new document revision.
- Treat manifest `Knowledge revision` as a per-dossier watermark of the global
  revision at that dossier's last affected commit. Do not rewrite unrelated
  dossiers merely to advance it, and normalize it when validating otherwise
  authoritative projection content.
- Require 1–500 UUID v4 `evidenceReferenceIds` for every project-concept
  proposal.
- Preserve M3 and M4 enums, providers, marker, inventories and explicit
  `AI_CONTEXT` refresh. Add M5 manifest content through owned section
  composition and include new artifact kinds in both rendering providers.
- Treat `ParticipantRef` as declared identity. Never infer it from the
  operating system or describe local equality checks as authentication.
- Do not move a dossier on complete, cancel or reopen.
- Keep MCP adapters thin and all historical tool schemas unchanged. Expand
  capabilities and smoke only in the increment that actually implements the
  new tools.

Every M5 increment must add unit, repository, MCP, idempotency, concurrency,
failure-injection, recovery, historical-compatibility and no-absolute-path
coverage proportional to its surface. Run:

```text
npm.cmd run format
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run build
npm.cmd run check
npm.cmd run smoke
```

El estado vigente es `COMPLETED — FROZEN`. La evidencia de la revalidación
manual y del cierre aprobado está registrada en `Pruebas_Milestone_5.md`.

## Adding a document or template

Define its purpose and lifecycle in docs/FUNCTIONAL_REQUIREMENTS.md and
docs/DATA_MODEL.md. Add the template through a dedicated document-generation
service in a later milestone, test non-overwrite and idempotence behavior, then
record it in the manifest contract.
