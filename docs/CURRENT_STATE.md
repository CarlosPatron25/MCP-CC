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
- Manual validation through IBM Bob passed. `health_check` verified server
  health; `get_server_capabilities` exposed the four supported tools; and
  `initialize_workspace` confirmed idempotency. `create_work_item` created the
  complete minimum DRAFT dossier, returned `WORK_ITEM_ALREADY_EXISTS` for a
  duplicate, preserved the existing dossier, and exposed no absolute path in
  success or error responses.

## Milestone 3: COMPLETED

Milestone 3 design remains approved and frozen in `MILESTONE_3_DESIGN.md`. The
approved local implementation is complete and officially closed.

Automated validation passed: `npm.cmd run format`, `npm.cmd run typecheck`,
`npm.cmd run lint`, `npm.cmd run test` (56 tests), `npm.cmd run build`,
`npm.cmd run check`, and `npm.cmd run smoke`. The smoke test created and
removed its own temporary root; it discovered all eight MCP tools and exercised
document initialization, a controlled read and update, and AI-context refresh
without touching `C:\\WS-Workspace` or exposing an absolute path.

The server implements exactly four Milestone 3 operations:
`initialize_work_item_documents`, `get_work_item_document`,
`update_work_item_document`, and `refresh_ai_context`. It creates the four
approved lifecycle documents, maintains versioned manifest entries, supports
typed complete replacements for five editable documents, and derives AI
context. It retains the Work Item in `DRAFT`; it does not implement decisions,
checkpoints, testing, closure, archive, reopen, external integrations, or the
Central Knowledge Service.

Manual IBM Bob validation completed on 2026-07-22 through IBM Bob with
**19/19 tests passed**. It verified the correct MCP server, all eight tools,
Milestone 1 and 2 regression behavior, the four Milestone 3 operations,
idempotency, revision control and conflicts, strict payload validation,
`AI_CONTEXT` as a protected `DERIVED` document, and the absence of absolute
paths. All acceptance criteria are satisfied.

The project is ready to begin the design of Milestone 4. Milestone 4 has not
started.

## Post-Milestone 3 product evolution review

The current architecture remains local and file-based. Milestones 4 and 5 will
continue to persist Work Item data in the local authorized workspace.

The product direction now distinguishes a future WS Workspace Core, future
Technology Profiles, and future Project Profiles. M1–M3 are the completed and
validated local, documentary, and architectural base for that evolution; they
are not claimed to be a fully neutral Core. Current frozen contracts retain
`SalesforceContext`, `developmentAlias`, and `rallyId` for the initial
Salesforce/Rally use case.

A future Project Profile will represent stable, transversal project knowledge;
a Work Item Dossier remains the generated, updated, and audited record of one
Work Item. Profiles, shared persistence, synchronization, corporate folders,
internal servers, a Central Knowledge Service, APIs, databases, multi-tenancy,
SaaS, cloud deployment, and enterprise authentication are not selected. This
review does not change M1–M3, start Milestone 4, or alter the local MVP.
