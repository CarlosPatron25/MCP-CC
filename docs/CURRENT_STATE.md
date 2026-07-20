# Current state

## Milestone 1: COMPLETED

Milestone 1 is officially closed. Its delivered scope is the secure local MCP
foundation: health inspection, capability discovery, and idempotent runtime
workspace initialization. At the time of its closure, Work Item creation,
lifecycle management, and external adapters remained out of scope.

## Milestone 1 Validation

The following evidence was verified in a real environment:

- `npm run build` passed with no TypeScript errors.
- `npm run smoke` passed and discovered `health_check`,
  `get_server_capabilities`, and `initialize_workspace`.
- `health_check` reported `ws-workspace-mcp` version `0.1.0`, status `ok`,
  Node.js `v24.18.0`, a hidden absolute authorized-root path, and read-write
  filesystem access.
- The first `initialize_workspace` run created `.ws-workspace`, `active`,
  `archive`, `config`, and `README.md`. The second run created nothing and
  reported those same five entries as existing, confirming idempotency.
- IBM Bob connected to the server, invoked real MCP tools, and propagated
  `WS_WORKSPACE_ROOT` through the stdio child process.
- Filesystem isolation was verified: runtime operations remained within the
  configured authorized root.

## Verified IBM Bob registration

IBM Bob registers the server through its `mcp.json` configuration. The verified
entry launches the compiled server with Node.js, passes the runtime workspace
explicitly, and permits only the two read-only tools without confirmation:

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

The server uses MCP JSON-RPC over stdio. `C:\\US-Workspace-MCP` is the source
and build location; `C:\\WS-Workspace` is the runtime workspace. This
separation ensures that MCP filesystem writes target the explicitly authorized
runtime data location rather than the project repository.

## Milestone 2: COMPLETED

Milestone 2 implements safe, manual creation of a DRAFT Work Item and its
minimum initial dossier through `create_work_item`. The server validates the
input, derives a safe internal `id` without replacing the user-provided
`rallyId`, prevents duplicate or traversal-based creation, and writes the
dossier under `.ws-workspace/active` through a staging area.

The initial structure is limited to `WORK_ITEM.yml`, `00_MANIFEST.md`,
`01_FUNCTIONAL_ANALYSIS.md`, `context/AI_CONTEXT.md`, `context/AI_RULES.md`,
`context/NEXT_TASK.md`, `evidence/`, and `snapshots/`. The remaining dossier
documents are explicitly deferred to Milestone 3.

## Milestone 2 Validation

- `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, and
  `npm run check` passed.
- The full suite reports 32 passing tests, including real MCP adapter coverage
  for the successful response and a structured duplicate error.
- `npm run smoke` passed using an automatically created and removed temporary
  workspace. It discovered all four tools and successfully initialized and
  created a DRAFT Work Item without using `C:\\WS-Workspace`.
