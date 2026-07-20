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

## Components

- domain: work-item type vocabulary and future model contracts.
- config: resolution and verification of the explicit authorized root.
- filesystem: containment-safe path resolution and idempotent initialization.
- services: use cases and serializable responses shared by MCP and a future
  diagnostic CLI.
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

## Configuration

Configuration comes only from `WS_WORKSPACE_ROOT`; IBM Bob supplies that normal
server environment variable through its verified registration. There is no
additional Bob-specific server configuration and no implicit fallback. Invalid,
missing, inaccessible or non-directory roots stop server startup safely.

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
