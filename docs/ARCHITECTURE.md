# Architecture

## Context and boundaries

The process is local: IBM Bob spawns this server, communicates via MCP over
stdio, and supplies manually entered information in later milestones. The
server has no direct connection to Rally, Copado, Salesforce, Git or a
corporate repository.

    IBM Bob
       | MCP JSON-RPC over stdio
       v
    MCP adapter (src/mcp)
       | typed calls
       v
    application services (src/services)
       | domain types, validation and errors
       v
    filesystem infrastructure (src/filesystem)
       |
       v
    authorized root/.ws-workspace

## Deployment boundary

The verified IBM Bob registration is held in IBM Bob's `mcp.json`. It runs
`node C:\\US-Workspace-MCP\\dist\\index.js`, passes
`WS_WORKSPACE_ROOT=C:\\WS-Workspace`, and communicates with the process using
MCP JSON-RPC on stdio.

    C:\\US-Workspace-MCP                 C:\\WS-Workspace
    source code and dist/       separate  authorized runtime root
    server executable             roles   .ws-workspace/active
                                            .ws-workspace/archive
                                            .ws-workspace/config

The source/build directory and runtime workspace are intentionally separate.
The server needs to execute code from the first location but is authorized to
read and write only under the second. This limits the filesystem boundary,
prevents workspace initialization from changing the repository, and keeps
runtime work-item data independent of deployments or rebuilds.

## Product layering and deferred architecture options

The execution architecture remains local and file-based through Milestones 4
and 5. The product direction distinguishes three conceptual layers without
changing that execution architecture:

    WS Workspace Core (future general direction)
       ^
       | future reusable specialization
    Technology Profile
       ^
       | future project-specific specialization
    Project Profile

The Core direction covers general concepts such as Work Item, document,
context, manifest, revision, decision, checkpoint, evidence, relation,
component, functional capability, and audit. A future Technology Profile may
hold technology vocabulary and conventions. A future Project Profile may hold
stable, transversal project knowledge. Neither profile is implemented or has a
defined format, storage, API, loader, or versioning model.

A Work Item Dossier is separate from a Project Profile: it is generated,
updated, and audited around one Work Item. A future dossier may reference a
Project Profile, but it must not become the general container of stable project
knowledge.

The current M1–M3 implementation is the validated local base from which a Core
may evolve; it is not already technology-neutral. Its current contracts include
`SalesforceContext`, `developmentAlias`, and `rallyId` for the first Salesforce
and Rally use case. Their future neutralization requires separate approval and
must not alter completed milestone evidence retroactively.

Shared persistence, synchronization, corporate folders, internal servers, a
Central Knowledge Service, APIs, databases, multi-tenancy, SaaS, cloud
deployment, and enterprise authentication are future options, not an approved
target architecture. The existing local files remain the sole authorized
persistence mechanism for the MVP.

## Components

- domain: current Work Item vocabulary plus closed Milestone 3 document types,
  lifecycle metadata, revisions, content types, and typed payload contracts.
  Current contracts retain explicit Salesforce/Rally dependencies.
- config: resolution and verification of the explicit authorized root.
- filesystem: containment-safe path resolution, workspace initialization,
  dossier staging, locking, and the local dossier-repository adapter.
- services: reusable use cases, including Work Item validation, deterministic
  document templates, manifest lifecycle rendering, AI-context projection, and
  document lifecycle coordination.
- mcp: thin registrations that convert service results and errors to tool
  results.
- scripts: an MCP stdio smoke client used for local technical verification.

## Code structure

    src/
      config/
      domain/
      errors/
      filesystem/
      mcp/
      scripts/
      services/
      index.ts
    tests/

## stdio strategy

The official TypeScript MCP SDK v1 package, @modelcontextprotocol/sdk 1.29.0,
is used because its official documentation recommends its v1 line for
production while v2 remains pre-release. StdioServerTransport owns protocol
messages on stdout. Application diagnostics use stderr only.

## Path management

WS_WORKSPACE_ROOT is mandatory and must reference an existing, readable and
writable directory that is not a filesystem volume root. Every child path is
resolved against that root and rejected when its relative path escapes it. The
initializer has no user-provided path argument, further reducing traversal
surface.

## Work Item creation

`create_work_item` is a thin MCP adapter over `WorkItemCreationService`. The
service validates the manual input with Zod, normalizes a safe internal ID from
the Rally ID, builds the initial DRAFT `WorkItem`, and requests persistence from
the filesystem layer. The original Rally ID remains a distinct persisted field.

The filesystem layer requires the Milestone 1 workspace structure to exist. It
rejects non-directory or unsafe targets, writes the dossier in a unique staging
directory below `.ws-workspace`, and promotes it to `active/<id>` only after all
files have been created. Existing target directories are never overwritten.
Returned paths are relative to the authorized workspace; absolute paths are not
returned by the service or the MCP adapter.

## Milestone 3 document lifecycle

Milestone 3 implements the approved hexagonal flow:

    MCP adapter
       |
       v
    WorkItemDocumentService
       |
       v
    WorkItemDossierRepository port
       |
       v
    LocalFilesystemWorkItemDossierRepository

`WorkItemDocumentService` owns lifecycle rules. `DocumentTemplateService`
renders only supplied payload values and permitted persisted facts with stable
ordering and visible unknown placeholders. `ManifestLifecycleService` renders
the backward-compatible lifecycle inventory. `AIContextProjectionService`
derives `AI_CONTEXT.md` only from `WORK_ITEM.yml`, persisted functional
analysis, and approved lifecycle metadata. A controlled `Clock` dependency
supplies lifecycle timestamps so tests use a fixed time.

The repository is the only component that resolves dossier paths or knows
directories, staging, locks, and physical commits. It uses a safe active-dossier
lookup, closed type-to-relative-path mapping, exclusive per-Work-Item locks,
contained staging, exclusive initialization, revision comparison, and logical
document-plus-manifest replacement. A normal failed commit restores the last
valid files and removes its staging directory. Reads and mutations return safe
relative paths and structured errors only.

The MCP adapter registers only `initialize_work_item_documents`,
`get_work_item_document`, `update_work_item_document`, and
`refresh_ai_context` for Milestone 3. It delegates all business and filesystem
rules to the services; no complete-dossier or generic directory-read operation
exists.

## Configuration

Configuration comes only from `WS_WORKSPACE_ROOT`; IBM Bob supplies that normal
server environment variable through its verified registration. There is no
additional Bob-specific server configuration and no implicit fallback. Invalid,
missing, inaccessible or non-directory roots stop server startup safely.

## Infrastructure independence and future profiles

Domain and application-service logic must remain independent of the MCP
transport and local filesystem implementation. The current filesystem layer is
the approved local persistence adapter for Milestones 4 and 5. Maintaining that
boundary keeps future technology-neutral evolution, profiles, or a separately
selected sharing architecture feasible without changing business rules.

This boundary does not make the current Work Item contract technology-neutral;
the explicit Salesforce/Rally fields remain valid and frozen for M1–M3.

## Errors

Domain-relevant failures use WorkspaceError subclasses with a stable code,
message and optional safe details. The MCP layer returns that serializable
structure as an error tool result; it does not leak stack traces.

## Testing

Unit tests use temporary directories to cover root validation, containment,
initialization, no-overwrite behavior, service responses and structured errors.
The compiled smoke client is an additional protocol-level technical check.
Milestone 1 also verified the compiled server under IBM Bob's real stdio MCP
registration, including tool invocation and runtime-root propagation.
