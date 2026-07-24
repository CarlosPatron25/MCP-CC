# Security

## Initial threat model

The local server accepts requests from its MCP host and can write documentation.
The principal threats are an untrusted or malformed path, accidental selection
of a corporate directory, accidental overwrite, unsafe log output, and future
external integrations with unconfirmed credentials or data contracts.

## Filesystem containment

WS_WORKSPACE_ROOT is explicit, absolute, existing and verified as readable and
writable. Child paths are resolved and must remain below that root. The current
initializer accepts no target-path parameter and creates only
.ws-workspace/active, archive and config plus its README.

## Write protection

Initialization uses exclusive creation for its README. Existing directories and
files are reported as existing and are never deleted or overwritten. The server
does not perform operations outside the authorized root.

## Work Item creation

Milestone 2 keeps the user-supplied Rally ID distinct from the generated
internal directory ID. The former is preserved as data; the latter is
normalized to a restricted safe token. Rally IDs containing traversal markers,
path separators, or control characters are rejected before filesystem use.

The Work Item service writes a complete initial dossier to a unique staging
directory inside `.ws-workspace` and promotes it only after all directories and
files are created. A pre-existing target is reported as a stable duplicate
error and is never overwritten. Service and MCP responses expose only relative
workspace paths, never absolute filesystem paths.

## Inputs and errors

Configuration is validated before server startup. Implemented MCP tools publish
closed schemas and reject unknown fields. M4 performs complete payload
validation inside the application boundary after the active Work Item, M3
lifecycle, and M4 initialization/integrity preconditions, preserving historical
error precedence. Errors return stable codes and safe messages, not stack
traces or environment dumps.

## Milestone 3 lifecycle protection

Milestone 3 accepts only a safe Work Item ID and a closed document-type
enumeration; it does not accept a path, glob, filename, or directory request.
Typed payload schemas are closed and reject unknown fields, including records
reserved for decisions, testing, closure, archiving, and reopening. Raw
Markdown and patches are not accepted.

The local repository verifies the active dossier and managed files as contained
non-symlink filesystem entries. It uses exclusive creation for the four new
documents, a contained staging directory, and an exclusive logical lock per
Work Item. A mutation uses the caller's positive expected revision; stale
revisions leave all files unchanged. Concurrent or retained locks fail safely
with `DOCUMENT_LIFECYCLE_CONFLICT` rather than exposing lock or staging paths.
Failed ordinary commits restore the last valid document and manifest and clean
their staging material.

The lifecycle manifest and all tool responses expose only dossier-relative
paths. Structured lifecycle errors never include absolute paths, native
filesystem errors, stack traces, or staging and lock locations.

## Milestone 4 audit protection

M4 accepts only the seven closed audit operations and four closed tracking
views. It accepts no arbitrary path, filename, glob, raw ledger JSON, raw
Markdown, patch, or directory request. All audit text is normalized and rejects
absolute filesystem or URL-style locations before persistence. Evidence
registration accepts one normalized logical label below `evidence/`; it never
opens, stats, uploads, reads, follows, or validates the referenced file.

The append-only ledger is parsed strictly at schema `1.0.0`. UUIDv4 identities,
canonical fingerprints, a global idempotency index, immutable relations, and
separate audit and plan revisions prevent ambiguous replay or partial logical
updates. A stale or incompatible request writes nothing. Projections are
deterministic and protected; inconsistent ledger, index, projection, or
manifest state fails closed.

M3 and M4 share one per-Work-Item exclusion boundary. Lock and recovery-claim
files carry process and ownership tokens; release compares physical file
identity as well as content and never deletes an unowned replacement. The
multi-file journal is immutable, progress records are append-only, and a commit
marker is written atomically. Rollback and abandoned-transaction recovery
validate approved relative paths, UUID transaction identity, hashes, regular
files, and every physical directory parent. Symlinks, junctions, unexpected
repair content, malformed journals, unknown locks, and inconsistent backups are
retained and rejected rather than followed or removed.

The explicit AI-context refresh includes at most 16 KiB of M4 summary by
complete semantic units. It omits filesystem and logical paths, URLs, evidence
descriptions, and evidence content. M4 mutations never refresh AI context
automatically.

The logical lock coordinates server instances and other cooperative writers. A
separate process with the same operating-system permissions can still attempt a
check/use race against local files; Node.js does not expose portable `openat`
and `renameat` primitives for an entirely descriptor-relative transaction.
Dedicated directory permissions remain required. The implementation repeatedly
validates physical identities and retains a live claim during lock release to
detect tampering and fail closed, but it does not claim protection from a fully
privileged hostile local process.

## Secrets and sensitive data

Do not commit credentials, tokens, certificates, internal URLs, client data,
production exports or corporate source. .env is ignored; .env.example contains
only a placeholder path. Logs must not print secret-bearing configuration or
document contents.

## Least privilege

Run the server with the least-privileged local account practical. Choose a
dedicated empty directory as WS_WORKSPACE_ROOT, not a filesystem root and not a
corporate repository. The process needs no network listener or external service
credential in the implemented M1–M4 scope.

## Verified IBM Bob boundary

Milestone 1 verified IBM Bob launching the compiled server through `mcp.json`
with MCP JSON-RPC over stdio. Its configuration executes code from
`C:\\US-Workspace-MCP\\dist\\index.js` while authorizing
`C:\\WS-Workspace` through `WS_WORKSPACE_ROOT`. This separation is a security
control: the server can operate only inside the configured runtime workspace,
not in the source/build repository. The verified health check hides the
absolute runtime-root path in its response.

## Personal-development risks

A personal computer may have weaker access controls, backup policies or
malware protections than a corporate environment. Before installing on a work
computer, obtain the applicable approval, use an approved directory, review
dependencies and lockfile, verify the IBM Bob registration and runtime root for
that installation, verify no corporate data will be copied into the workspace,
and repeat all validations.
