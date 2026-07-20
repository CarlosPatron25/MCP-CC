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

## Inputs and errors

Configuration is validated before server startup. Future MCP inputs must be
schema-validated before application services use them. Errors return stable
codes and safe messages, not stack traces or environment dumps.

## Secrets and sensitive data

Do not commit credentials, tokens, certificates, internal URLs, client data,
production exports or corporate source. .env is ignored; .env.example contains
only a placeholder path. Logs must not print secret-bearing configuration or
document contents.

## Least privilege

Run the server with the least-privileged local account practical. Choose a
dedicated empty directory as WS_WORKSPACE_ROOT, not a filesystem root and not a
corporate repository. The process needs no network listener or external service
credential in Milestone 1.

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
