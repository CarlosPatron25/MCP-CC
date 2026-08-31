# WS Workspace MCP

WS Workspace MCP is a local Model Context Protocol server for IBM Bob and the
initial local foundation for a structured knowledge engine around software
development Work Items. Its first validated use case is Salesforce work tracked
through Rally, while its product direction is broader than that initial use
case.

It addresses the loss of context between analysis, development, testing and a
later reopening of the same work item. The server is intentionally local and
file-based in its first milestones. It has no external connection to Rally,
Copado, Salesforce, or corporate systems.

The completed Milestones 1 through 4.1 are the local, documentary, and
architectural base from which WS Workspace Core may evolve. They are not yet a
fully technology-neutral Core: the validated creation contract explicitly
contains `SalesforceContext`, `developmentAlias`, and `rallyId`. Removing or
generalizing those dependencies requires a separate approved evolution; it is
not implied by this product direction.

## Current state

**Milestones 1 through 4.1 are completed and officially closed.** Their
approved designs, implementations and validation evidence are frozen.
Milestone 4 passed automated validation and manual IBM Bob validation with
42/42 tests. Milestone 4.1B passed automatic validation with 158 tests and
manual IBM Bob validation.

The server provides secure creation and controlled local document lifecycle,
append-only decisions and checkpoints, immutable-version test planning,
executions and controlled evidence references. M5 adds workflow, technical
sessions, living knowledge, logical completion, cancellation and auditable
reopening. Health inspection, capability discovery, idempotent workspace
initialization, and explicit derived AI-context refresh remain available.
Physical archive movement remains unavailable.

Milestone 4 uses the current local file-based workspace. Milestone 4.1A is the
approved and frozen documentation/localisation design; M4.1B has completed
automatic and manual IBM Bob validation. Milestone 4.1 is closed and frozen.

Milestone 5 está `COMPLETED — FROZEN`. La validación manual oficial mediante
IBM Bob ejecutó satisfactoriamente la batería B1–B19 en un workspace corporativo
aislado, sobre el commit `ea59fedc68a1769603e96fd048d3c3333cc9696a` y Node.js
`v24.18.0`. El resultado confirmó el ciclo de vida completo, sesiones,
snapshots, workflow, relaciones, revisión semántica, auditoría, consolidación,
cierre y limpieza operacional: no quedaron locks persistentes, staging,
journals ni claims. El detalle y la evidencia de cierre constan en
[Pruebas_Milestone_5.md](docs/Pruebas_Milestone_5.md).

La implementación M5 construye y mantiene una base de conocimiento viva del
proyecto sobre una única fuente estructurada
`.ws-workspace/records/KNOWLEDGE_BASE.json`, separada del ledger M4. Incluye
sesiones, snapshots técnicos, participantes, procedencia, relaciones,
conceptos, consolidación documental y ciclo de vida lógico. Technology
Profiles, Project Profiles completos, sincronización y servicio central
continúan fuera del alcance actual.

La reapertura automática posterior a una mutación M3/M4 es retry-safe y
convergente, pero usa dos commits físicos secuenciales; no es una transacción
cross-repository. Cada cierre conserva un fence con las revisiones M3 por
documento y la revisión M4 confirmadas dentro del knowledge gate. El bridge
reabre únicamente ante un cursor histórico posterior a ese fence, sin depender
de la resolución del timestamp. En cada dossier, `Knowledge revision` es el
watermark de la revisión global vigente en su último commit afectado y no
obliga a reescribir dossiers ajenos.
Sharing, synchronization, corporate folders, internal servers, and a Central
Knowledge Service remain future options that have not been selected.

## Milestone 4.1A design

The frozen [M4.1A design](docs/MILESTONE_4_1_DESIGN.md) now governs the
implemented workspace-local document-language configuration and immutable
manifest rendering snapshot for new Work Items. M4.1B is `IMPLEMENTED`, with
automatic validation and manual IBM Bob validation `PASS`. Milestone 4.1 is
`COMPLETED — FROZEN`; no `WS_DOCUMENT_LANGUAGE` variable or MCP contract change
exists, and historical Work Items retain their English baseline.

## Estado de diseño, implementación y cierre de Milestone 5

**Hecho verificado:** la implementación preserva las quince herramientas
históricas M1–M4.1 y añade contratos MCP M5 sin renombrar ni retirar los
anteriores. Mantiene persistencia local, dossiers históricos, ledger M4, locks,
recovery y perfiles de rendering.

**Decisión M5:** el diseño aprobado introduce
`.ws-workspace/records/KNOWLEDGE_BASE.json` como única fuente M5, separada de
`records/AUDIT_LEDGER.json`; `WS_PROJECT_SOURCE_ROOT` como segunda raíz
explícita y de solo lectura; layout dual; estados canónicos
`IN_PROGRESS`, `COMPLETED` y `CANCELLED` con proyección legacy; identidad
`DECLARED`; cierre lógico sin archivado físico; y fence causal para el bridge
M3/M4. Véanse ADR-018, ADR-019, ADR-020, ADR-021 y ADR-022.

**Cierre verificado:** M5 está `COMPLETED — FROZEN`. La corrección ADR-022
mantiene identidad correlacionada de instancia, operación y token,
clasificación conjunta de lock/claim/transacción y propagación determinista de
fallos de liberación. La validación automática final pasó con 38 archivos y
294 pruebas, y el smoke compilado conservó 38 herramientas MCP. La validación
manual oficial B1–B19 mediante IBM Bob fue satisfactoria y confirmó que el
workspace aislado terminó sin residuos operativos. La evidencia canónica está
en [Pruebas_Milestone_5.md](docs/Pruebas_Milestone_5.md).

**Observación funcional para futuras baterías:** `create_work_item_v2`
inicializa automáticamente el workflow M5. Por tanto,
`initialize_work_item_workflow`, invocado inmediatamente después sobre ese
Work Item, devuelve correctamente `WORK_ITEM_STATE_CONFLICT`. Es el resultado
esperado de un workflow ya inicializado, no un defecto ni una inicialización
adicional que deba ejecutarse.

## Requirements

- Node.js 18 or later. Milestone 1 validation used Node.js v24.18.0.
- npm. In PowerShell environments that block npm.ps1, use npm.cmd.

## Installation and validation

La guía operativa de Windows e IBM Bob está en
[INSTALLATION_GUIDE_WINDOWS_IBM_BOB.md](docs/INSTALLATION_GUIDE_WINDOWS_IBM_BOB.md).
El [registro histórico de instalación corporativa](docs/VALIDATION_CORPORATE_INSTALLATION_2026-07-30.md)
se conserva como evidencia complementaria; el resultado formal de M5 permanece
en [Pruebas_Milestone_5.md](docs/Pruebas_Milestone_5.md).

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
    $env:WS_PROJECT_SOURCE_ROOT = 'C:\\ruta\\de\\proyecto\\solo-lectura'
    npm.cmd run build
    npm.cmd run start

For local development, replace start with npm.cmd run dev. The process uses
stdio for JSON-RPC; diagnostics are sent only to stderr.
`WS_PROJECT_SOURCE_ROOT` es opcional para M1–M4.1, pero las operaciones M5 que
capturan snapshots requieren una raíz separada, válida y de sólo lectura.

## Basic technical test

After building, run:

    npm.cmd run smoke

El smoke actual crea y elimina sus propias raíces temporales de workspace y
proyecto. Inicia el servidor compilado por stdio, verifica que las quince
herramientas históricas siguen presentes y recorre contratos representativos
M1–M5, incluida la fuente única de conocimiento, activación y cambio de sesión,
snapshot técnico y creación v2. También comprueba revisiones, identificadores,
capabilities, limpieza y ausencia de rutas absolutas en las respuestas. Nunca
usa `C:\\WS-Workspace` ni otro workspace real para esta prueba.

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
and `snapshots/` directories. Milestone 3 then adds the four controlled
lifecycle documents and a versioned lifecycle inventory without modifying
`WORK_ITEM.yml`, `AI_RULES.md`, or `NEXT_TASK.md`.

## Milestone 3 document lifecycle

Milestone 3 adds four MCP tools and no generic dossier-reading operation:

- `initialize_work_item_documents` creates only
  `02_CURRENT_STATE.md`, `03_TECHNICAL_ANALYSIS.md`,
  `04_IMPACT_ANALYSIS.md`, and `05_IMPLEMENTATION_PLAN.md`. It is idempotent
  after successful initialization and never overwrites an unexpected existing
  file.
- `get_work_item_document` reads exactly one closed-enumeration document:
  `MANIFEST`, `FUNCTIONAL_ANALYSIS`, `CURRENT_STATE`,
  `TECHNICAL_ANALYSIS`, `IMPACT_ANALYSIS`, `IMPLEMENTATION_PLAN`, or
  `AI_CONTEXT`. It accepts no path or arbitrary filename.
- `update_work_item_document` replaces one of the five editable documents
  (`FUNCTIONAL_ANALYSIS` through `IMPLEMENTATION_PLAN`) from its typed payload
  and a positive `expectedRevision`. It does not accept raw Markdown or
  patches.
- `refresh_ai_context` regenerates only `context/AI_CONTEXT.md` from approved
  persisted Work Item facts, the persisted functional analysis, and lifecycle
  metadata. It also requires the current AI-context revision.

`00_MANIFEST.md` now retains its original inventory and adds a Document
Lifecycle Inventory. Each managed document records its relative path, status
(`CREATED`, `INITIALIZED`, or `UPDATED`), positive revision, timestamp,
`updatedBy: SYSTEM`, and content type (`TEMPLATE`, `SUPPLIED`, or `DERIVED`).
Every successful update logically commits the document and manifest together.
The Work Item remains `DRAFT`.

The local repository owns containment, exclusive per-Work-Item locks, staging,
revision enforcement, and recovery of ordinary failed commits. A concurrent
or retained lock returns `DOCUMENT_LIFECYCLE_CONFLICT`; a stale revision returns
`DOCUMENT_REVISION_CONFLICT`. Responses contain only safe relative paths.

ADR-022 applies one lock protocol to M3–M5. New markers use schema `2.0.0` and
correlate process instance, operation and acquisition token. Before returning a
lock conflict, the coordinator classifies lock, claim and scoped transaction;
it completes only a physically revalidated, correlated `RELEASE` with no
pending transaction and no active local owner. Malformed, divergent or unknown
states are retained, and release cleanup failures are returned to the caller.

## Milestone 3 automated validation

- The full automated suite reports 56 passing tests, including deterministic
  templates and AI projection, typed updates for every editable document,
  manifest revisions, no-overwrite behavior, locks, injected commit failure
  recovery, filesystem containment, and MCP structured errors.
- `npm.cmd run format`, `npm.cmd run typecheck`, `npm.cmd run lint`,
  `npm.cmd run test`, `npm.cmd run build`, `npm.cmd run check`, and
  `npm.cmd run smoke` have passed for this implementation.
- The smoke test uses a newly created temporary root and removes it afterwards;
  it does not touch the configured IBM Bob runtime workspace.

## Milestone 3 manual IBM Bob validation

Manual validation completed on 2026-07-22 through IBM Bob with **19/19 tests
passed**. It verified the correct server version, discovery of all eight MCP
tools, Milestone 1 and 2 regression behavior, the four Milestone 3 operations,
idempotent initialization, revision control and conflicts, strict payload
validation, protected derived documents, `AI_CONTEXT` as `DERIVED`, and the
absence of absolute paths. All Milestone 3 acceptance criteria are satisfied.

Milestone 3 is officially closed. **Milestone 4 Architecture Challenge:
PASSED** and **Milestone 4 Design Review: PASSED**. Its formal design is
`FROZEN`.
See [MILESTONE_4_DESIGN.md](docs/MILESTONE_4_DESIGN.md).

## Milestone 4 audit tracking

Milestone 4 adds exactly seven MCP tools without changing the historical
Milestone 3 document enumeration or `get_work_item_document` contract:

- `initialize_work_item_tracking`
- `record_decision`
- `record_checkpoint`
- `define_test_plan`
- `record_test_execution`
- `register_evidence_reference`
- `get_work_item_tracking`

The structured source of truth is `records/AUDIT_LEDGER.json` with schema
version `1.0.0`, a ledger-wide `auditRevision`, immutable append-only records,
canonical request fingerprints, and a global idempotency-key index. One logical
test plan can have immutable versions and executions only against its active
version. Evidence references are logical metadata below `evidence/`; the server
does not open, stat, upload, or validate referenced content.

The ledger, the four protected Markdown projections, and the M4-owned manifest
section are promoted as one logical multi-file commit under the same
per-Work-Item lock used by Milestone 3. Recovery validates the journal, hashes,
approved paths, physical directory chains, and lock ownership before restoring
or removing anything. M4 never changes `WORK_ITEM.yml` or Work Item status.

M4 mutations do not refresh `context/AI_CONTEXT.md`. Only an explicit
`refresh_ai_context` derives the bounded M4 summary; it is deterministic, no
larger than 16 KiB, and omits filesystem locations and evidence content.
`get_work_item_tracking` exposes only `DECISIONS`, `CHECKPOINTS`, `TESTING`, or
`EVIDENCE_REFERENCES`.

## Milestone 4 validation and closure

Automated validation passed with 24 test files and 145 tests, plus format,
typecheck, lint, build, combined check, and the disposable-root MCP smoke flow.
Coverage includes strict schemas and initialization precedence, exact retries
and incompatible idempotency reuse, audit and plan revision conflicts,
single-plan versioning, deterministic projections, lossless M3/M4 manifest
composition, shared locking, crash recovery, symlink/junction rejection,
logical evidence non-dereferencing, AI-context bounds and path redaction, and
M1–M3 regression behavior.

Manual IBM Bob validation passed with 42/42 tests, 0 failures, and 0
non-executable tests. Its three observations were reviewed against the frozen
contract: malformed `planId` and `testCaseId` values correctly fail strict
request validation before semantic lookup, while parallel calls correctly
return the shared-lock conflict. No contractual defect was found and no code
change was required.

The authoritative status is:

- `Milestone 4 Design: FROZEN`
- `Milestone 4 Implementation: COMPLETED — FROZEN`
- `Milestone 4: COMPLETED`

Milestone 4 is officially closed. See
[Pruebas_Milestone_4.md](docs/Pruebas_Milestone_4.md) for the automated and
manual evidence and the architectural resolution of the observations.

M4.1B implementation evidence is recorded in
[Pruebas_Milestone_4_1.md](docs/Pruebas_Milestone_4_1.md). Its automatic and
manual IBM Bob validation passed with no implementation or contract defects.
Milestone 4.1 is officially `COMPLETED — FROZEN`.

## Milestone 2 Validation

- `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, and
  `npm run check` passed.
- The test suite contains 32 passing tests, including valid and optional-field
  creation, validation failures, duplicate protection, traversal protection,
  initial-file content, and structured MCP errors.
- `npm run smoke` passed using a temporary workspace; it discovered and invoked
  `create_work_item` without touching the configured runtime workspace.
- Manual IBM Bob validation passed: `health_check`,
  `get_server_capabilities`, and idempotent `initialize_workspace` behaved as
  expected; `create_work_item` created the complete minimum DRAFT dossier.
  Duplicate creation returned `WORK_ITEM_ALREADY_EXISTS`, existing dossiers
  were preserved, and neither successful nor error responses exposed absolute
  filesystem paths.

## IBM Bob

La configuración operativa vigente para M5 debe registrar el servidor en
`mcp.json` con ambas raíces:

```json
{
  "mcpServers": {
    "ws-workspace-mcp": {
      "command": "node",
      "args": ["C:\\US-Workspace-MCP\\dist\\index.js"],
      "env": {
        "WS_WORKSPACE_ROOT": "C:\\WS-Workspace",
        "WS_PROJECT_SOURCE_ROOT": "C:\\ruta\\de\\proyecto\\solo-lectura"
      },
      "alwaysAllow": ["health_check", "get_server_capabilities"]
    }
  }
}
```

IBM Bob launches `node dist/index.js` and communicates with the server over
MCP JSON-RPC on stdio. `WS_WORKSPACE_ROOT` es la única raíz escribible.
`WS_PROJECT_SOURCE_ROOT` es una raíz distinta de observación técnica y sólo
lectura para el MCP. Las dos deben ser absolutas, existentes, directorios que
no sean raíces de volumen, y no pueden coincidir, solaparse ni contenerse.

La ausencia de `WS_PROJECT_SOURCE_ROOT` conserva las operaciones M1–M4.1, pero
la activación de sesiones M5 falla de forma segura. Después de cambiar
`mcp.json`, reinicia IBM Bob antes de ejecutar herramientas. La configuración
histórica de la validación de M1 sólo declaraba `WS_WORKSPACE_ROOT`; no es la
configuración operativa suficiente para las sesiones M5.

`C:\\US-Workspace-MCP` and `C:\\WS-Workspace` have deliberately different
roles. The first contains the source code and compiled server; the second is
the authorized runtime workspace. Keeping them separate prevents a runtime MCP
tool from writing into the source repository, narrows the filesystem permission
boundary, and keeps work-item data independent of the server build.

`create_work_item` is intentionally not in `alwaysAllow`; it creates files and
should remain subject to the host's normal confirmation policy.

## Product evolution direction

The product direction retains three conceptual layers:

- **WS Workspace Core:** general Work Item, document, context, manifest,
  revision, decision, checkpoint, evidence, relation, component, functional
  capability, and audit concepts.
- **Technology Profile:** a future reusable technology-specific extension; a
  Salesforce profile is only a future example.
- **Project Profile:** future stable, project-wide knowledge. It is distinct
  from the generated, updated, and auditable Work Item Dossier.

M5 implements a narrow local knowledge-base contract, a concept catalogue,
relations and future import classifications without implementing a complete
Technology Profile or Project Profile. No shared persistence, synchronization,
service, API, database, central architecture, or complete profile loader is
implemented. See
[ARCHITECTURE_EVOLUTION_POST_M3.md](docs/ARCHITECTURE_EVOLUTION_POST_M3.md),
ADR-016 and ADR-018 for the approved boundaries.

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
