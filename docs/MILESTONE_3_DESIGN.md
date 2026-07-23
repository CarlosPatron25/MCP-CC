# Milestone 3 Technical Design: Context and Document Lifecycle

Status: Completed. The approved design remains frozen; the implementation did
not add Milestone 4 or 5 behavior.

## Design basis

Verified project facts used by this design:

- Milestones 1 and 2 are complete. The current server is local, uses MCP over
  stdio, and persists the initial dossier inside the authorized workspace.
- The active dossier already contains `WORK_ITEM.yml`, `00_MANIFEST.md`,
  `01_FUNCTIONAL_ANALYSIS.md`, `context/AI_CONTEXT.md`,
  `context/AI_RULES.md`, `context/NEXT_TASK.md`, `evidence/`, and
  `snapshots/`.
- Milestone 3 must remain local and file-based. The Central Knowledge Service
  is a post-MVP vision and is not part of this design.

The contracts below are approved for Milestone 3 implementation.

## Completion record

Implementation, automated validation, and manual IBM Bob validation are
complete. Manual validation was performed on 2026-07-22 through IBM Bob and
passed 19/19 tests. It verified the MCP server, all eight tools, Milestone 1
and 2 regressions, the four Milestone 3 operations, idempotency, revision
control and conflicts, strict payload validation, protected derived AI context,
and the absence of absolute paths. All Milestone 3 acceptance criteria are
satisfied.

## 1. Objective

Extend an existing active Work Item dossier with controlled, traceable document
lifecycle operations. Milestone 3 creates missing analysis documents, allows
safe updates to approved document types, refreshes derived AI context, and
keeps `00_MANIFEST.md` consistent with the resulting document inventory.

## 2. Scope

Milestone 3 implements:

- create the four missing lifecycle documents defined in this design;
- update `01_FUNCTIONAL_ANALYSIS.md` from supplied functional information;
- update the new analysis documents through validated document-specific input;
- regenerate `context/AI_CONTEXT.md` from persisted Work Item and dossier
  facts;
- read an approved document and its safe lifecycle metadata;
- maintain a versioned lifecycle inventory in `00_MANIFEST.md`; and
- preserve the existing local filesystem repository as the only persistence
  adapter.

The Work Item remains in `DRAFT`; document updates do not implement a state
transition.

## 3. Exclusions

Milestone 3 must not implement or model:

- decisions, decision records, or decision lifecycle;
- checkpoints, structured testing, test plans, or test evidence management;
- closure, archiving, reopening, actual completion dates, or final reports;
- external integrations with Rally, Copado, Salesforce, Git, or any corporate
  system;
- the Central Knowledge Service, synchronization, remote clients, APIs,
  databases, authentication, or migration behavior; or
- changes to the Work Item creation contract, Work Item state machine, or
  existing Milestone 1 and 2 tool behavior.

## 4. Architecture

The implementation must preserve the current hexagonal separation:

    MCP adapter
       |
       v
    application services
       |
       v
    document lifecycle repository port
       |
       v
    local filesystem adapter

Domain contracts define document types, lifecycle metadata, and safe update
requests. Application services enforce business rules and never manipulate
paths directly. A repository port owns dossier reads and commits. The local
filesystem adapter is the Milestone 3 implementation of that port.

The MCP layer only validates transport input, invokes a service, and serializes
safe results or existing structured errors. This separation keeps business
logic independent of MCP and filesystem infrastructure, preserving the future
option to replace the local adapter with a separately approved central-service
adapter.

### Determinism

The same validated request, persisted dossier state, and template version must
produce exactly the same document content and logical AI-context projection.
Services must not depend on hidden IBM Bob state, conversation history, model
memory, unpersisted generative output, external access, or nondeterministic
collection ordering.

Creation and update timestamps may differ between executions. They must be
obtained through a controlled, injectable clock contract or abstraction so
tests can fix time deterministically. This requirement authorizes only the
minimum controlled clock abstraction needed by the approved Milestone 3 scope.

## Future compatibility

No domain or application service may assume local persistence, construct a
filesystem path, or know staging, locks, directories, or other physical storage
details. All dossier access must use `WorkItemDossierRepository` exclusively.

The local filesystem implementation is the approved adapter for Milestones 3,
4, and 5 only. A separately approved future implementation may replace it with
an adapter connected to the Central Knowledge Service without changing business
rules or application contracts. This compatibility requirement aligns with
ADR-015 and does not authorize design or implementation of the Central
Knowledge Service.

## 5. New services

The implemented application and infrastructure services are:

| Service                                    | Layer          | Purpose                                                                                                                                                                  |
| ------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WorkItemDocumentService`                  | application    | Coordinates initialization, controlled reading and updates, revision validation, manifest coordination, and template or projection invocation for one Work Item dossier. |
| `DocumentTemplateService`                  | application    | Produces deterministic document templates and renders validated document-specific content.                                                                               |
| `AIContextProjectionService`               | application    | Builds `AI_CONTEXT.md` only from persisted Work Item and approved dossier facts.                                                                                         |
| `ManifestLifecycleService`                 | application    | Produces the backward-compatible lifecycle inventory section of `00_MANIFEST.md`.                                                                                        |
| `WorkItemDossierRepository`                | port           | Defines safe dossier lookup, document read, revision check, and logical commit operations.                                                                               |
| `LocalFilesystemWorkItemDossierRepository` | infrastructure | Implements the port through contained paths, staging, exclusive creation, and recovery-safe local commits.                                                               |

## 6. Responsibilities

`WorkItemDocumentService` is the sole owner of document lifecycle rules. It
accepts a Work Item ID and a typed request, verifies that the active dossier
exists, checks the allowed document type and revision precondition, and asks
the repository to commit a rendered document and manifest update.

`DocumentTemplateService` owns document structure and placeholders. It must
not invent requirements, technical conclusions, impacts, or plans. It renders
only supplied values, persisted Work Item fields, or explicit "not provided"
placeholders.

`AIContextProjectionService` owns derived context. It must not add a technical
decision, a checkpoint, a test result, or an inferred requirement.

`ManifestLifecycleService` owns only the lifecycle inventory section. It does
not change Work Item data or document content.

The repository port owns path containment, document existence checks, revision
comparison, logical commit, and safe relative-path responses. The MCP adapter
must not perform any of those responsibilities.

## 7. Complete flow

### Initialize document lifecycle

1. IBM Bob calls `initialize_work_item_documents` with a Work Item ID.
2. The MCP adapter validates the request and calls `WorkItemDocumentService`.
3. The service loads the active dossier through the repository and verifies
   that it is an existing directory under `.ws-workspace/active`.
4. The template service renders only the four missing Milestone 3 documents.
5. The repository creates each missing document and updates the manifest
   inventory in one logical commit.
6. The result contains the Work Item ID, document states, revisions, and
   workspace-relative paths only.

### Update a managed document

1. IBM Bob first reads the document metadata and current revision.
2. IBM Bob calls `update_work_item_document` with the Work Item ID, document
   type, a typed content payload, and `expectedRevision`.
3. The service validates the payload, document type, and revision.
4. The template service renders the complete replacement document from the
   validated payload and permitted persisted facts.
5. The repository commits the document and corresponding manifest entry as one
   logical operation.
6. The result returns the next revision, update timestamp, and relative path.

### Refresh AI context

1. IBM Bob calls `refresh_ai_context` with a Work Item ID and the expected AI
   context revision.
2. The service reads the Work Item, functional analysis, and approved managed
   document metadata.
3. `AIContextProjectionService` creates a deterministic context projection.
4. The repository commits the refreshed AI context and manifest update after a
   revision check.

No operation changes Work Item status, creates a decision or checkpoint, or
performs closure behavior.

## 8. MCP operations

The following operation names and contracts are implemented:

| Operation                        | Purpose                                                                                  | Mutation |
| -------------------------------- | ---------------------------------------------------------------------------------------- | -------- |
| `initialize_work_item_documents` | Create only missing Milestone 3 documents and initialize their manifest entries.         | Yes      |
| `get_work_item_document`         | Return one approved document, its lifecycle metadata, and a relative path.               | No       |
| `update_work_item_document`      | Replace one initialized, editable document using typed content and an expected revision. | Yes      |
| `refresh_ai_context`             | Regenerate `AI_CONTEXT.md` from approved dossier facts and an expected revision.         | Yes      |

`get_work_item_document` returns exactly one approved document per call. It
accepts only a fixed document-type enumeration and returns that document's
content, lifecycle metadata, and a safe workspace-relative path. It never
accepts a path or arbitrary filename; it never returns a complete dossier,
file tree, or multiple documents in one response.

The update operation accepts only `FUNCTIONAL_ANALYSIS`, `CURRENT_STATE`,
`TECHNICAL_ANALYSIS`, `IMPACT_ANALYSIS`, and `IMPLEMENTATION_PLAN`.
`AI_CONTEXT` is refreshed only by `refresh_ai_context`; `AI_RULES` and
`NEXT_TASK` are not editable in Milestone 3.

Milestone 3 must not introduce generic dossier-read operations such as
`get_complete_work_item`, `get_full_dossier`, `read_directory`, or
`list_all_files`. Future approved milestones may define summary, search, or
context-retrieval operations separately.

All mutating operations require an expected revision. No operation accepts a
filesystem path, an absolute path, or an arbitrary filename.

## 9. New documents

The new files, created only by `initialize_work_item_documents`, are:

| File                        | Purpose                                                                                              | Initial content                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `02_CURRENT_STATE.md`       | Capture known implementation context, constraints, open questions, and explicitly unconfirmed items. | Deterministic template with persisted facts and "not provided" placeholders. |
| `03_TECHNICAL_ANALYSIS.md`  | Record supplied technical observations, hypotheses, dependencies, and unresolved questions.          | Deterministic template with no inferred conclusions.                         |
| `04_IMPACT_ANALYSIS.md`     | Record supplied affected components, impact statements, and known exclusions.                        | Deterministic template with no test plan or decision record.                 |
| `05_IMPLEMENTATION_PLAN.md` | Record supplied implementation steps, prerequisites, and open questions.                             | Deterministic template; it does not execute or approve a plan.               |

The design deliberately creates no test-plan, decision, checkpoint, closure,
archive, reopening, or final-report document.

## 10. Documents that are updated

| Existing document           | Milestone 3 treatment                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `00_MANIFEST.md`            | Updated after every successful lifecycle initialization, document update, or AI-context refresh. |
| `01_FUNCTIONAL_ANALYSIS.md` | Editable through the controlled update operation.                                                |
| `context/AI_CONTEXT.md`     | Regenerated only through `refresh_ai_context`.                                                   |
| `WORK_ITEM.yml`             | Read as source data only; not modified by Milestone 3.                                           |
| `context/AI_RULES.md`       | Preserved without modification.                                                                  |
| `context/NEXT_TASK.md`      | Preserved without modification.                                                                  |

The four new files become editable only after their successful initialization.

## 11. Update rules

- A lifecycle document may be created only when it is missing. Existing files
  are never replaced by initialization.
- A document may be updated only through its approved type-specific payload
  and only after successful initialization.
- The service renders the entire document; callers cannot supply arbitrary
  filenames or patch raw files.
- Text is normalized consistently. Empty optional values are represented by a
  visible "not provided" convention rather than invented content.
- The service distinguishes supplied facts, stated hypotheses, and unresolved
  questions in document sections. It must not turn hypotheses into facts.
- `AI_CONTEXT.md` is a derived projection. It must identify unknowns and must
  not introduce requirements or technical decisions.
- No lifecycle operation deletes a document, changes `WORK_ITEM.yml`, or
  changes Work Item status.

## 12. Concurrency rules

Each managed document has a positive integer revision recorded in the manifest
lifecycle inventory. A read returns the current revision. A mutation must send
that value as `expectedRevision`; a mismatch is rejected without writing any
file.

The repository port provides a per-Work-Item logical commit for the document
and manifest. The local adapter must use a contained staging area and an
exclusive per-Work-Item lock so concurrent mutations cannot interleave. If a
commit fails, the adapter must leave the last committed document and manifest
visible and remove or safely recover its staging material. A stale lock must be
handled deterministically without exposing absolute paths or deleting valid
dossier content.

Concurrent initialization is idempotent: the first successful call creates
missing files; a later call reports them as existing and does not overwrite
them.

## 13. Security rules

- Resolve the Work Item ID and every managed filename through the existing
  containment-safe repository boundary.
- Use a closed document-type enumeration; do not accept paths, glob patterns,
  or arbitrary extensions from MCP input.
- Reject absent, invalid, or non-directory active dossier targets.
- Use exclusive creation for new documents and contained staging for updates.
- Return only relative dossier paths, stable error codes, and safe messages.
  Never return an absolute path, stack trace, raw filesystem error, lock path,
  or staging path.
- Do not log document contents, credentials, or environment values to stdout.
  stdout remains exclusively for MCP JSON-RPC.
- Do not access external systems, perform network operations, or add a central
  service integration.

## 14. Manifest changes

`00_MANIFEST.md` remains the human-readable inventory introduced in Milestone 2. Milestone 3 adds a backward-compatible **Document Lifecycle Inventory**
section. Each managed document row records:

- document type and workspace-relative path;
- lifecycle status: `CREATED`, `INITIALIZED`, or `UPDATED`;
- positive revision number;
- generated or last-updated timestamp;
- `updatedBy`, set to the deterministic literal `SYSTEM` in Milestone 3; and
- whether the content is `TEMPLATE`, `SUPPLIED`, or `DERIVED`.

`updatedBy: SYSTEM` means that the local system performed the MCP operation. It
does not identify a person, corporate user, or external system and introduces
no authentication, user model, permissions, or identity integration. A future
approved milestone may allow this metadata field to hold a real actor identity.

The existing initial document and directory inventory is retained. The Work
Item YAML schema and fields are not changed. Every successful lifecycle commit
updates the affected document row and the manifest generation timestamp. A
failed operation leaves the prior manifest content valid and unchanged.

## 15. Validations

Application-service validation must cover:

- a safe, existing active Work Item ID;
- an initialized Milestone 3 lifecycle where required;
- an allowed document type for reads and mutations;
- an expected revision that is a positive integer and matches the manifest;
- a document-specific payload with required non-empty supplied fields;
- normalized optional text and collections;
- consistent section semantics: facts, hypotheses, open questions, impacts,
  and planned steps must be placed only in their allowed document type;
- a manifest that can be parsed by the repository's documented lifecycle
  contract; and
- all document and staging paths remaining inside the authorized workspace.

Validation must reject `actualCompletionAt`, decisions, checkpoints, test
records, closure evidence, and other later-milestone data when supplied to a
Milestone 3 operation.

## 16. Error codes

Existing configuration, filesystem, path-security, and Work Item creation
codes remain unchanged. The additional stable codes are:

| Code                          | Meaning                                                                     |
| ----------------------------- | --------------------------------------------------------------------------- |
| `WORK_ITEM_NOT_FOUND`         | The requested active dossier does not exist.                                |
| `DOCUMENT_TYPE_UNSUPPORTED`   | The requested document is not part of the approved Milestone 3 enumeration. |
| `DOCUMENT_NOT_INITIALIZED`    | A read or update requires a managed document that has not been initialized. |
| `DOCUMENT_ALREADY_EXISTS`     | Initialization encountered an existing target that must not be overwritten. |
| `DOCUMENT_VALIDATION_FAILED`  | The typed request is invalid or contains later-milestone content.           |
| `DOCUMENT_REVISION_CONFLICT`  | `expectedRevision` is stale or does not match the manifest.                 |
| `DOCUMENT_LIFECYCLE_CONFLICT` | Another mutation holds the Work Item lifecycle commit lock.                 |
| `DOCUMENT_UPDATE_FAILED`      | The repository could not safely commit the document and manifest.           |
| `MANIFEST_UPDATE_FAILED`      | The lifecycle inventory could not be safely updated.                        |

All errors must use the existing structured MCP error representation and omit
absolute paths and implementation details.

## 17. Test strategy

Tests use temporary workspace roots only and retain the Milestone 1 and 2
regression suite. The Milestone 3 suite must cover:

- initialization of the exact four new documents and no future documents;
- idempotent initialization and preservation of every pre-existing file;
- valid updates for each editable document type;
- deterministic AI-context refresh using only persisted and supplied facts;
- deterministic templates, stable list and section ordering, and deterministic
  `AI_CONTEXT.md` projections;
- a controllable fixed clock for timestamp assertions, with no dependency on
  IBM Bob chat state, conversation history, model memory, or external access;
- manifest lifecycle inventory creation and revision updates;
- invalid IDs, unsupported types, invalid payloads, later-milestone fields,
  missing documents, and non-initialized documents;
- stale revision and concurrent-mutation conflict behavior;
- contained paths, staging cleanup or recovery, atomic logical commit behavior,
  and absence of partial visible state after injected failures;
- safe serializable service and MCP responses with no absolute paths;
- structured MCP errors for validation, conflict, and non-overwrite cases;
- tool discovery and updated capabilities through an expanded temporary-root
  smoke test; and
- unchanged behavior of `health_check`, `get_server_capabilities`,
  `initialize_workspace`, and `create_work_item`.

## 18. Definition of Done

Milestone 3 is complete only when:

- all approved design contracts are implemented without Milestone 4 or 5
  behavior;
- the four documents are created safely and only when missing;
- managed updates, revisions, manifest updates, and derived AI context satisfy
  the rules in this design;
- document and manifest commits preserve non-overwrite, containment, and
  recoverable concurrency behavior;
- the same validated input, persisted state, and template version produce the
  same document content and logical projection, with timestamps supplied by a
  controlled clock dependency;
- MCP tools expose only approved Milestone 3 operations and safe structured
  responses;
- documentation is updated to describe the verified implementation and keeps
  the local architecture explicit;
- typecheck, lint, tests, build, combined check, and smoke test pass; and
- validation evidence is recorded before the milestone is marked complete.

All of these conditions were satisfied on 2026-07-22. Milestone 3 is closed;
Milestone 4 remains unstarted.

## 19. Risks

| Risk                                              | Mitigation in this design                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Ambiguous functional or technical input           | Typed payloads, explicit unknown placeholders, and no-invention rules.              |
| Lost update from concurrent MCP calls             | Per-document revisions, expected revisions, and per-Work-Item logical commit locks. |
| Partial document and manifest update              | Repository-owned staging, logical commit, and deterministic recovery rules.         |
| Manual filesystem edits                           | Detect inconsistent manifest/document state and fail safely rather than overwrite.  |
| Scope leakage into decisions, testing, or closure | Closed document enumeration, typed validation, and explicit exclusions.             |
| Future central-service migration pressure         | Domain and service logic remain independent of the local repository adapter.        |

## 20. Incremental implementation plan

1. Use this frozen design, including document names, MCP operation names,
   lifecycle statuses, revision semantics, manifest inventory, and error codes.
2. Add domain contracts and repository-port interfaces with no MCP exposure.
3. Implement deterministic templates and unit-test them without filesystem
   access.
4. Implement the local repository adapter for contained reads, initialization,
   revision checks, staging, and manifest commits.
5. Implement application services and their temporary-root tests.
6. Add thin MCP adapters and structured-error tests.
7. Expand the smoke client to exercise the approved Milestone 3 lifecycle in a
   disposable workspace.
8. Synchronize all operational and product documentation, run the full
   validation suite, collect evidence, and request Milestone 3 closure.

No implementation step may exceed this approved design.
