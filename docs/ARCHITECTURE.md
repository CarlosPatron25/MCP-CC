# Architecture

## Context and boundaries

The process is local: IBM Bob spawns this server, communicates via MCP over
stdio, and supplies manually entered information in later milestones. The
The frozen M1–M4.1 server has no direct connection to Rally, Copado,
Salesforce, Git or a corporate repository.

M5 implements an explicitly
authorized read-only project-observation adapter, including optional
deterministic local Git status. It does not add Rally, Copado, Salesforce,
remote Git access or any network capability.

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
stable, transversal project knowledge. M5 defines only a narrow local
knowledge base, relation model, concept catalogue and import classification;
neither complete profile is implemented or has a defined shared storage, API
or loader.

A Work Item Dossier is separate from a Project Profile: it is generated,
updated, and audited around one Work Item. A future dossier may reference a
Project Profile, but it must not become the general container of stable project
knowledge.

The completed M1–M4.1 foundation is the local base from which a Core may evolve;
it is not already technology-neutral. Its current contracts include
`SalesforceContext`, `developmentAlias`, and `rallyId` for the first Salesforce
and Rally use case. Their future neutralization requires separate approval and
must not alter completed milestone evidence retroactively.

Shared persistence, synchronization, corporate folders, internal servers, a
Central Knowledge Service, APIs, databases, multi-tenancy, SaaS, cloud
deployment, and enterprise authentication are future options, not an approved
target architecture. The existing local files remain the sole authorized
persistence mechanism for the MVP.

## Components

- domain: current Work Item vocabulary, closed Milestone 3 document types and
  lifecycle contracts, plus the M4 audit ledger, entries, closed tracking views,
  revisions, and typed request contracts. Current contracts retain explicit
  Salesforce/Rally dependencies.
- config: resolution and verification of the explicit authorized root.
- filesystem: containment-safe path resolution, workspace initialization,
  dossier staging, the local dossier and audit adapters, and one shared
  Work-Item operation coordinator for physical locking, transaction journals,
  promotion, rollback, and recovery.
- services: reusable use cases, including Work Item validation, deterministic
  document templates, manifest lifecycle rendering, AI-context projection,
  document lifecycle coordination, audit-ledger integrity, deterministic audit
  projections, M4 manifest inventory, and bounded audit-context summaries.
- mcp: thin registrations that convert service results and errors to tool
  results.
- scripts: an MCP stdio smoke client used for local technical verification.

M5 adds domain and application boundaries for workflow, sessions, technical
snapshots, participants, provenance, relations, concepts, dossier
consolidation and review. They use a workspace-level M5 repository backed by
the single `KNOWLEDGE_BASE.json` source and a separate read-only
project-observation port.

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

## Milestone 4 audit tracking

Milestone 4 implements a separate hexagonal flow without extending the M3
managed-document contract:

    MCP adapter
       |
       v
    WorkItemAuditService
       |
       v
    WorkItemAuditRepository port
       |
       v
    LocalFilesystemWorkItemAuditRepository

`records/AUDIT_LEDGER.json` is the schema-versioned structured source of truth.
`AuditLedgerService` owns strict parsing, canonical fingerprints, the global
idempotency index, relationships, server-generated UUIDv4 identifiers, the
ledger-wide audit revision, and plan revisions. `AuditProjectionService`
deterministically derives `06_DECISIONS.md`, `07_CHECKPOINTS.md`,
`08_TEST_PLAN.md`, and `evidence/REFERENCES.md`; those files are protected
views, not independent sources.

`ManifestSectionCompositor` preserves every byte outside an owned section,
supports LF and CRLF, keeps the M4 block before the historical M3 block, and
strictly validates the seven-row M3 lifecycle inventory before M4 behavior.
`M4ManifestInventoryService` owns only the audit inventory. Alternating M3 and
M4 updates therefore retain both contracts while only the M3 `MANIFEST` row
advances for M4 manifest changes.

The dossier and audit repositories share `WorkItemOperationCoordinator` and
the same `.locks/<workItemId>.lifecycle.lock` exclusion boundary. Each real M4
mutation stages the ledger, four projections, and manifest together. The
immutable journal records approved relative paths and before/after hashes;
rollback and later recovery validate the journal, regular-file identities,
physical non-link directory chains, and lock ownership before moving or
removing data. A commit marker makes confirmation irreversible. Retained or
unowned locks fail closed.

Application validation preserves the required order: active Work Item, valid M3
lifecycle, M4 initialization/integrity, then strict M4 payload, relationships,
idempotency, and revisions. The published MCP JSON Schemas remain closed with
`additionalProperties: false`; a small adapter bridge defers complete M4
payload validation to the application boundary so the SDK cannot mask the
historical initialization errors.

One logical test plan may have immutable versions; executions target only the
active version. Evidence references are normalized logical metadata and are
never dereferenced. M4 mutations never change `WORK_ITEM.yml`, status, or
`AI_CONTEXT`. Only `refresh_ai_context` can include the deterministic M4
summary, which is semantically truncated to 16 KiB and excludes filesystem
locations, URLs, and evidence content.

## Configuration

The verified M1–M4.1 executable configuration comes only from
`WS_WORKSPACE_ROOT`; IBM Bob supplies that normal server environment variable
through its verified registration. There is no implicit fallback. Invalid,
missing, inaccessible or non-directory writable roots stop server startup
safely.

M5 implements `WS_PROJECT_SOURCE_ROOT` as an optional second deployment binding
with read-only authority. It must be absolute, existing, non-root,
non-overlapping with `WS_WORKSPACE_ROOT`, and is never inferred from the
process directory or exposed in responses. Its absence preserves M1–M4.1
availability while M5 session activation fails safely.

## Milestone 4.1 document-language implementation (completed and frozen)

M4.1A approves the implemented local configuration at
`.ws-workspace/config/workspace-config.json`, with the canonical initial JSON
`{"schemaVersion":"1.0.0","documentLanguage":"es-ES"}`. M4.1B implements
this persistence contract while the server continues to accept only
`WS_WORKSPACE_ROOT`; no `WS_DOCUMENT_LANGUAGE` variable or MCP parameter exists.

M4.1B writes an immutable rendering snapshot as technical metadata in each
new `00_MANIFEST.md` and resolves an internal `ES_ES_V1` or historical
`EN_BASELINE_V1` provider from it. System-owned prose is supplied through a
typed provider registry. Human payloads and strict technical tokens remain
literal. Each new Spanish
`00_MANIFEST.md` carries the technical rendering marker specified in
[MILESTONE_4_1_DESIGN.md](MILESTONE_4_1_DESIGN.md); it is not a business or
audit record and no sidecar is introduced.

The design preserves the M3/M4 coordinator, locks, journal and recovery
boundaries. Snapshot resolution for rendering occurs inside the existing Work
Item operation boundary, while historical Work Items without a manifest marker
retain their persisted English baseline without migration. Configuration files
are strictly bounded, validated, and created without replacement. M4.1B is
implemented with automatic and manual IBM Bob validation passed. Milestone 4.1
is `COMPLETED — FROZEN`.

## Arquitectura de Milestone 5 (implementada; validación manual pendiente)

**Hecho verificado:** la implementación ejecutable conserva
`.ws-workspace/active/<workItemId>` para históricos, el ledger M4 por dossier y
los coordinadores M3/M4 existentes. M5 añade layout dual, servicios de
aplicación, observación de proyecto, proyecciones y un repositorio workspace
level cuya única fuente estructurada es
`.ws-workspace/records/KNOWLEDGE_BASE.json`.

**Decisiones M5:**

- `.ws-workspace/records/KNOWLEDGE_BASE.json` es la única fuente estructurada
  M5 del workspace, con schema, revisión e idempotencia propios y sin ampliar
  `records/AUDIT_LEDGER.json`;
- los dossiers históricos conservan el layout plano y los nuevos M5 usan
  `.ws-workspace/active/<iterationStorageToken>/<workItemType>/<workItemId>`;
- un localizador dual resolverá ambos layouts sin migrar ni mover históricos;
- los estados canónicos son `IN_PROGRESS`, `COMPLETED` y `CANCELLED`;
  `WORK_ITEM.yml` es una proyección compatible confirmada junto con la base
  M5;
- completar, cancelar o reabrir no moverá el dossier a `archive`;
- la identidad del MVP es estable pero `DECLARED`, nunca inferida del usuario
  del sistema operativo; y
- los Markdown M5, el catálogo y las vistas de sesión son proyecciones, no
  fuentes de verdad.

La concurrencia M5 adquiere primero un knowledge lock workspace-level y luego
los locks de Work Item afectados en orden estable. El commit lógico abarca
la base M5, proyecciones, manifests y proyecciones legacy afectadas. Recovery
valida targets M1–M5 mediante una política compartida y falla cerrado.

Una mutación histórica M3/M4 y la reapertura M5 que pueda provocar no forman
una transacción física única. El adaptador confirma primero M3/M4 y ejecuta
después el bridge M5 como segundo commit. La segunda fase relee el estado y es
convergente. Cada `WORK_ITEM_COMPLETED` conserva, dentro del mismo knowledge
gate, las revisiones de los siete documentos M3 y la `auditRevision` M4. El
bridge compara el cursor de la mutación histórica con ese fence: reabre sólo un
`COMPLETED` cuando el cursor es posterior y queda en no-op para un cursor ya
incluido, aunque ambos commits compartan timestamp. La inicialización documental
posterior al cierre ya es necesariamente un no-op y no dispara el bridge. Los
commits M5 internos sí mantienen juntas la base y sus proyecciones afectadas.

La creación v2 también es un bootstrap físico por fases M2→M3→M4→M5, ejecutado
bajo el gate global. Un error controlado revierte el dossier recién creado; una
caída puede dejarlo visible y parcial. Su manifest liga ese estado desde el
inicio a la huella SHA-256 de la petición normalizada completa. El servicio
sólo permite que el retry exacto continúe las fases restantes; una petición
distinta no adopta ni repara ese dossier.

La línea proyectada `Knowledge revision` es un watermark global por dossier:
registra la revisión global vigente en el último commit que afectó a ese
dossier. Los dossiers no afectados no se reescriben para avanzar ese número;
su consistencia se valida por `workItemRevision` y contenido autoritativo.

**Estado:** la implementación está
`IMPLEMENTED — PENDING MANUAL IBM BOB VALIDATION` conforme a
[MILESTONE_5_DESIGN.md](MILESTONE_5_DESIGN.md). M5 no está completado ni
congelado; la evidencia automática y el plan manual se registran en
[Pruebas_Milestone_5.md](Pruebas_Milestone_5.md).

## Infrastructure independence and future profiles

El dominio y los servicios de aplicación deben permanecer independientes del
transporte MCP y de la implementación filesystem. La capa filesystem actual es
el adaptador local aprobado para Milestone 4 y la base que M5 ampliará mediante
puertos compatibles. Mantener ese límite permite evolucionar en el futuro
hacia neutralidad tecnológica, perfiles o una arquitectura de sharing
aprobada por separado sin cambiar las reglas de negocio.

This boundary does not make the current Work Item contract technology-neutral;
the explicit Salesforce/Rally fields remain valid and frozen for M1–M3.

## Errors

Domain-relevant failures use WorkspaceError subclasses with a stable code,
message and optional safe details. The MCP layer returns that serializable
structure as an error tool result; it does not leak stack traces.

## Testing

Unit tests use temporary directories to cover root validation, containment,
initialization, no-overwrite behavior, service responses and structured errors.
The M4 suite also covers append-only integrity, exact retries, conflicts,
manifest alternation and CRLF, protected projections, path and URL rejection,
symlink/junction defense, shared-lock ownership, multi-file failure injection,
rollback, and abandoned-journal recovery. The compiled smoke client preserves
discovery of the fifteen historical tools and exercises representative M1–M5
flows in disposable roots without returning an absolute path.
Milestone 1 also verified the compiled server under IBM Bob's real stdio MCP
registration, including tool invocation and runtime-root propagation.
