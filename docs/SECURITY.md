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

M3–M5 share the coordinated exclusion boundary. Protocol `2.0.0` lock and
recovery-claim files correlate process instance, operation, acquisition token,
purpose and referenced lock; the current process also registers active owners
in memory. PID alone is never sufficient to prove ownership or abandonment.
Release compares physical file identity as well as content and never deletes
an unowned replacement. A correlated `RELEASE` is completed before returning a
conflict only when no scoped transaction is pending and no current-instance
owner remains registered. Malformed, divergent, legacy-live or remotely
unknown ownership is retained, and no cleanup decision is based on age. The
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
validates physical identities and retains a correlated claim during lock
release to detect tampering and fail closed. Any unconfirmed lock or claim
retirement is propagated to the caller; a simultaneous functional error keeps
its public code and carries the cleanup error as its cause. The protocol does
not claim protection from a fully privileged hostile local process.

## Milestone 4.1 configuration security (completed and frozen)

M4.1B reads only the fixed workspace-relative path
`.ws-workspace/config/workspace-config.json`, after the existing containment,
physical-parent and regular-file checks. The JSON has a 4 KiB maximum and
strict closed validation. A missing file is created once using atomic
non-replacement publication; a valid existing file is never overwritten and an
invalid file is not repaired. Symlinks, junctions, non-regular files, malformed
JSON, unknown fields and unsupported values fail closed.

The per-Work-Item snapshot marker in `00_MANIFEST.md` is technical
integrity metadata. Corruption is reported with safe, additive errors without filesystem
paths. Historical Work Items without this metadata retain their English baseline
and are not migrated. This design adds no environment variable, secret, network
permission, workspace-wide lock, sidecar, or change to M3/M4 locking, journal,
recovery or ledger security. Automatic and manual IBM Bob validation passed,
and Milestone 4.1 is `COMPLETED — FROZEN`.

## Contrato de seguridad de Milestone 5 (implementado; validación manual pendiente)

**Estado:** `IMPLEMENTED — PENDING MANUAL IBM BOB VALIDATION`. La validación
manual de los límites de seguridad en IBM Bob sigue pendiente.

M5 mantiene `WS_WORKSPACE_ROOT` como única raíz escribible y añade
`WS_PROJECT_SOURCE_ROOT` como autoridad separada de solo lectura. Ambas raíces
deben ser explícitas, absolutas, existentes, directorios no raíz y no pueden
coincidir ni contenerse. No habrá fallback a `cwd`, autodetección ni exposición
de sus paths. La ausencia de la raíz de proyecto no reducirá la disponibilidad
M1–M4.1, pero impide activar una sesión M5.

El adaptador de snapshot implementado:

- recorre sólo archivos regulares bajo la raíz autorizada;
- no sigue symlinks, junctions o reparse points;
- persiste paths relativos, hashes, tamaños y metadata acotada, nunca
  contenido fuente;
- excluye `.git` físico, `.ws-workspace`, `node_modules`, `dist` y `coverage`;
- ejecuta Git opcional sin shell y con argumentos fijos de solo lectura;
- no lee ni devuelve remotes;
- aplica límites de entradas, bytes leídos y longitud de path; y
- cancela sin persistencia parcial cuando un límite o identidad física falla.

`.ws-workspace/records/KNOWLEDGE_BASE.json` tiene schema cerrado, tamaño
acotado, revisión, fingerprints, índice de idempotencia validado y operaciones
append-only. Las mutaciones adquieren el knowledge lock antes de locks de Work
Item ordenados. Journal, hashes, parents físicos, allowlist y propiedad de lock
se validarán antes de mover o retirar material. Un estado desconocido o
corrupto se conserva y falla cerrado.

La creación v2 publica el dossier antes de terminar sus inicializaciones
M3/M4/M5 y, por tanto, declara un bootstrap recuperable, no atomicidad
cross-repository. El manifest conserva únicamente la huella SHA-256 de toda la
petición normalizada; no expone la clave ni el `participantId`. Tras una caída,
esa huella impide que una petición diferente adopte el dossier parcial. Los
errores controlados intentan retirarlo y un fallo de rollback se eleva sin
presentar éxito.

La reapertura disparada por M3/M4 no se presenta como transacción física única:
el commit histórico precede al commit M5. Cada cierre conserva una frontera
causal con las siete revisiones documentales M3 y la revisión de auditoría M4.
La segunda fase compara su cursor tipado con esa frontera antes de la
idempotencia del bridge: cursores anteriores o iguales son no-op; uno posterior
reabre únicamente un workflow todavía `COMPLETED`. Los timestamps sólo auditan
y no se confía en una idempotency key común. El watermark `Knowledge revision`
de un dossier no afectado puede quedar por detrás de la revisión global sin
considerarse corrupción, porque se valida junto con `workItemRevision` y el
contenido autoritativo.

Las propuestas de concepto exigen entre 1 y 500 UUID v4 en
`evidenceReferenceIds`; un array vacío se rechaza antes de persistir.

La identidad M5 es `DECLARED`: un `participantId` se compara con el estado
persistido, pero no constituye autenticación. No se usa el usuario del sistema
operativo. Cierre, cancelación, reapertura explícita, transferencia y
aprobación de concepto requieren actor declarado permitido y confirmación. Una
IA no puede ejecutar esas acciones por inferencia.

Las respuestas y errores M5 no exponen roots, rutas absolutas, locks,
staging, journals, contenido fuente, credenciales ni detalles nativos. El
futuro puerto de identidad o almacenamiento compartido requiere diseño y
revisión de seguridad separados.

## Secrets and sensitive data

Do not commit credentials, tokens, certificates, internal URLs, client data,
production exports or corporate source. .env is ignored; .env.example contains
only a placeholder path. Logs must not print secret-bearing configuration or
document contents.

## Least privilege

Run the server with the least-privileged local account practical. Choose a
dedicated empty directory as WS_WORKSPACE_ROOT, not a filesystem root and not a
corporate repository. The process needs no network listener or external service
credential in the implemented M1–M4.1 scope. La observación M5 implementada
requiere permiso de lectura exclusivamente sobre una raíz de proyecto
dedicada; no requiere listener de red ni credencial externa.

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
