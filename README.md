# WS Workspace MCP

WS Workspace MCP is a local Model Context Protocol server for IBM Bob. It
provides the secure foundation for the documented lifecycle of Salesforce-team
work items from Rally while keeping functional and technical context in a local
workspace.

It addresses the loss of context between analysis, development, testing and a
later reopening of the same work item. The server is intentionally local and
file-based in its first milestones. It has no connection to Rally, Copado,
Salesforce, or corporate systems.

## Current state

**Milestone 2 is completed and validated.** Milestone 1 remains completed and validated.
The server now provides secure creation of an initial DRAFT Work Item dossier,
in addition to health inspection, capability discovery, and idempotent
workspace initialization. Work Item lifecycle actions such as closing and
reopening remain unavailable.

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
compiled server through stdio, discovers its tools, then calls `health_check`,
`get_server_capabilities`, `initialize_workspace`, and `create_work_item`.
It never uses `C:\\WS-Workspace` or another user workspace for this test.

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
and `snapshots/` directories. Milestone 3 will add the remaining lifecycle
documents.

## Milestone 2 Validation

- `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, and
  `npm run check` passed.
- The test suite contains 32 passing tests, including valid and optional-field
  creation, validation failures, duplicate protection, traversal protection,
  initial-file content, and structured MCP errors.
- `npm run smoke` passed using a temporary workspace; it discovered and invoked
  `create_work_item` without touching the configured runtime workspace.

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
