# Current state

## Milestone 1: COMPLETED — FROZEN

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

## Milestone 2: COMPLETED — FROZEN

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

## Milestone 3: COMPLETED — FROZEN

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
context. The M3 contract retains the Work Item in `DRAFT` and does not itself
define decisions, checkpoints, testing, closure, archive, reopen, external
integrations, or the Central Knowledge Service.

Manual IBM Bob validation completed on 2026-07-22 through IBM Bob with
**19/19 tests passed**. It verified the correct MCP server, all eight tools,
Milestone 1 and 2 regression behavior, the four Milestone 3 operations,
idempotency, revision control and conflicts, strict payload validation,
`AI_CONTEXT` as a protected `DERIVED` document, and the absence of absolute
paths. All acceptance criteria are satisfied.

## Milestone 4: COMPLETED — FROZEN

**Milestone 4 Architecture Challenge: PASSED.** **Milestone 4 Design Review:
PASSED.** Its formal technical design is approved and frozen in
[MILESTONE_4_DESIGN.md](MILESTONE_4_DESIGN.md).

The implementation exposes exactly seven M4 tools in addition to the eight
historical M1–M3 tools: `initialize_work_item_tracking`, `record_decision`,
`record_checkpoint`, `define_test_plan`, `record_test_execution`,
`register_evidence_reference`, and `get_work_item_tracking`.

The implementation uses `records/AUDIT_LEDGER.json` as schema-versioned,
append-only source of truth. It derives four protected projections, owns a
losslessly composed M4 manifest section, applies one global idempotency index,
distinguishes `auditRevision` from `planRevision`, preserves one logical plan
with immutable versions, and records logical evidence metadata without
dereferencing evidence content. M3 and M4 share one physical Work Item lock and
one journaled multi-file transaction coordinator.

M4 does not modify `WORK_ITEM.yml`, status, the seven-value M3 document
enumeration, or `get_work_item_document`. It does not implement closure,
archiving, reopening, profiles, shared persistence, synchronization, or
external integrations. AI context changes only through the existing explicit
refresh and receives a deterministic M4 summary bounded to 16 KiB with
locations and evidence content omitted.

Automated validation passed: format, typecheck, lint, 24 test files with 145
tests, build, combined check, and the disposable-root smoke flow discovering
exactly 15 MCP tools. The automated and manual evidence is
recorded in [Pruebas_Milestone_4.md](Pruebas_Milestone_4.md).

Manual IBM Bob validation passed: 42 tests executed, 42 passed, 0 failed, and
0 were non-executable. The two observed identifier-error differences are the
documented distinction between malformed UUID input and a well-formed but
incompatible or absent identity. The observed `AUDIT_TRACKING_CONFLICT` is the
expected fail-closed result for concurrent calls under the shared Work Item
lock. No contractual defect or code change was required.

The authoritative status is:

- `Milestone 4 Design: FROZEN`
- `Milestone 4 Implementation: COMPLETED — FROZEN`
- `Milestone 4: COMPLETED`

The design, implementation, automated evidence, and manual IBM Bob evidence are
frozen. Milestone 4 is officially closed.

## Milestone 4.1A: DESIGN APPROVED — FROZEN

The canonical [M4.1A design](MILESTONE_4_1_DESIGN.md) freezes the
workspace-local document-language configuration, immutable per-Work-Item
manifest rendering snapshot, provider boundary, technical Markdown marker,
historical English compatibility, and error/validation rules. M4.1B implements
that frozen contract without changing MCP schemas, Work Item semantics, M3/M4
locks, recovery, ledger, or `AI_CONTEXT` semantics.

`Milestone 4.1B: IMPLEMENTED`. Automatic validation, smoke evidence, and manual
IBM Bob validation have passed. The executive manual-validation summary records
no implementation or contract defects; retry idempotency, human-payload
preservation, the rendering marker, historical compatibility, and M1–M4
regression were validated. The observations were non-blocking.

`Milestone 4.1: COMPLETED — FROZEN`.

## Milestone 5: IMPLEMENTED — PENDING MANUAL IBM BOB REVALIDATION

**Hecho verificado:** la implementación de producción M5 está presente y
preserva las quince herramientas históricas M1–M4.1. Añade creación v2,
workflow y participantes declarados, sesiones con snapshots técnicos,
consolidación, relaciones, conceptos, revisión y ciclo de vida lógico. La única
fuente estructurada M5 es
`.ws-workspace/records/KNOWLEDGE_BASE.json`; no se han introducido ledgers M5
por sesión, workflow o Work Item.

La atomicidad M5 abarca `KNOWLEDGE_BASE.json` y las proyecciones del commit M5.
El bridge desde una mutación M3/M4 usa dos commits físicos secuenciales y
converge por reevaluación del estado y por un fence causal de revisiones M3/M4
capturado en cada cierre, no por timestamps ni por una transacción
cross-repository. El `Knowledge revision` proyectado es un watermark global por
dossier y sólo avanza cuando ese dossier participa en el commit.

**Decisión aprobada:** el contrato técnico completo está en
[MILESTONE_5_DESIGN.md](MILESTONE_5_DESIGN.md). ADR-018, ADR-019, ADR-020, ADR-021
y ADR-022
registran la base única M5 separada del ledger M4, la segunda raíz de proyecto
de solo lectura, el layout dual, el estado canónico con proyección legacy, la
identidad declarada, la ausencia de archivado físico, el fence causal del
bridge histórico y la reconciliación correlacionada del lock protocol.

**Estado de validación:** M5 está
`IMPLEMENTED — PENDING MANUAL IBM BOB REVALIDATION`. La matriz reproducible y el
plan manual están en
[Pruebas_Milestone_5.md](Pruebas_Milestone_5.md). Los resultados automáticos
finales de la corrección ADR-022 están registrados en `PASS`: formato,
typecheck, lint, 38 archivos con 294 pruebas, build, check integrado, smoke
compilado con 38 herramientas y diff check. La revalidación manual IBM Bob
permanece pendiente. M5 no está completado ni congelado.

**Corrección operativa ADR-022:** el lock protocol `2.0.0` correlaciona
instancia MCP, operación, token, propósito y propietario del lock. El
coordinador mantiene un registro en memoria de propietarios activos, clasifica
lock, claim y transacción antes de responder conflicto y sólo completa un
`RELEASE` residual cuando la identidad correlacionada y la ausencia de
transacción pendiente lo permiten. Los errores al retirar lock o claim se
propagan; si coinciden con un error funcional, éste conserva el contrato
público y el error de cleanup queda encadenado. Los formatos desconocidos,
claims parciales, tokens divergentes y propietarios remotos no demostrados
inactivos se preservan con fallo cerrado. No se usa antigüedad como criterio de
limpieza.

## Authoritative milestone state

- `Milestone 1: COMPLETED — FROZEN`
- `Milestone 2: COMPLETED — FROZEN`
- `Milestone 3: COMPLETED — FROZEN`
- `Milestone 4: COMPLETED — FROZEN`
- `Milestone 4.1A: DESIGN APPROVED — FROZEN`
- `Milestone 4.1B: IMPLEMENTED — AUTOMATIC VALIDATION PASS — MANUAL IBM BOB VALIDATION PASS`
- `Milestone 4.1: COMPLETED — FROZEN`
- `Milestone 5 Design: TECHNICAL CONTRACT COMPLETE — NOT FROZEN`
- `Milestone 5 Implementation: IMPLEMENTED — PENDING MANUAL IBM BOB REVALIDATION`
- `Milestone 5: NOT COMPLETED — NOT FROZEN`

## Post-Milestone 3 product evolution review

The current architecture remains local and file-based. Milestone 4 persists
Work Item data in the local authorized workspace. The M4.1A design and M4.1B
implementation are frozen as Milestone 4.1. Milestone 5 is implemented under
its complete technical contract and awaits manual IBM Bob revalidation after
ADR-022; it is not completed or frozen.

The product direction now distinguishes a future WS Workspace Core, future
Technology Profiles, and future Project Profiles. M1–M4.1 are the completed and
validated local, documentary, and architectural base for that evolution; they
are not claimed to be a fully neutral Core. Current frozen contracts retain
`SalesforceContext`, `developmentAlias`, and `rallyId` for the initial
Salesforce/Rally use case.

A future Project Profile will represent stable, transversal project knowledge;
a Work Item Dossier remains the generated, updated, and audited record of one
Work Item. M5 selects only a narrow local knowledge-base contract, relations
and concept catalogue; it does not implement a complete Project Profile.
Shared persistence, synchronization, corporate folders, internal servers, a
Central Knowledge Service, APIs, databases, multi-tenancy, SaaS, cloud
deployment, and enterprise authentication remain unselected. M5 preserves the
implemented M1–M4.1 contracts through an additive implementation.
