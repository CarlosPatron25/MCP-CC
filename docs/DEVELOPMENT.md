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
    npm.cmd run test
    npm.cmd run check

Set WS_WORKSPACE_ROOT to an existing authorized directory before dev or start.
Build before running start or smoke. Keep this directory separate from the
source repository; the verified runtime directory is `C:\\WS-Workspace`.

`npm.cmd run smoke` creates and removes a temporary workspace itself. It does
not require `WS_WORKSPACE_ROOT` and must not be pointed at the real runtime
workspace. It validates the compiled stdio server through initialization and
`create_work_item`.

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

## Adding a document or template

Define its purpose and lifecycle in docs/FUNCTIONAL_REQUIREMENTS.md and
docs/DATA_MODEL.md. Add the template through a dedicated document-generation
service in a later milestone, test non-overwrite and idempotence behavior, then
record it in the manifest contract.
