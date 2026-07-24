# Product definition

## Vision

WS Workspace MCP is evolving toward a structured knowledge engine for software
development Work Items. It retains an understandable dossier for each item of
work so a person or development AI can resume it without reconstructing its
history. Salesforce and Rally are the first validated use case, not the
product's permanent technology boundary.

## Target user

The primary user is a developer using IBM Bob while analysing, implementing,
testing, or revisiting a Work Item. The initially validated user is a Salesforce
developer working with a Rally reference. Technical leads and reviewers are
secondary consumers of the resulting documentation.

## Problem

Work Item requests, local analysis, implementation decisions, affected
components, and test evidence can otherwise live in disconnected locations or
disappear from the active conversation. Reopening an item requires rediscovery
and increases the risk of incomplete changes. The initial implementation keeps
the Salesforce/Rally vocabulary required by its validated contract.

## Value proposition

For every approved work item, the product will make its functional request,
technical context, decisions, progress and evidence discoverable in a
consistent local directory. IBM Bob can use the same structured context without
embedding business knowledge in the MCP adapter.

## MVP scope

The intended MVP supports exactly four work-item types, local file persistence,
a controlled document lifecycle, state tracking and an MCP-first interface for
IBM Bob.

Milestones 1 through 4 are completed and validated. Milestone 1 provides the
secure MCP foundation and workspace initialization. Milestone 2 provides safe,
manual creation of a DRAFT Work Item and its minimum initial dossier through
`create_work_item`. Milestone 3 completes the approved local context-and-
document-lifecycle scope: the four remaining analysis documents, controlled
single-document reads, typed replacement updates, manifest lifecycle metadata,
and derived AI-context refresh. Milestone 4 implements local append-only
decisions and checkpoints, immutable test-plan versions and executions,
controlled evidence references, deterministic audit projections, and explicit
bounded AI-context integration. Its automated validation and manual IBM Bob
validation have passed, and Milestone 4 is completed. Search and all state
transitions remain future milestone work.

## Outside the MVP

- Direct Rally integration.
- Direct Copado integration.
- A VS Code extension.
- Automatic access to Salesforce or corporate repositories.
- Multi-client or remote-host compatibility as a product requirement.

## Future architecture direction

The local-file MVP remains the approved execution architecture through
Milestones 4 and 5. Product evolution distinguishes a future general WS
Workspace Core from future Technology Profiles and Project Profiles. A
Technology Profile may eventually express technology-specific vocabulary and
conventions; a Project Profile may eventually hold stable, project-wide
knowledge. Neither has a defined format, persistence mechanism, API, versioning
model, or loader.

The Project Profile is not a Work Item Dossier. A dossier contains generated,
updated, and auditable knowledge for one work item; a Project Profile is future
stable, transversal project knowledge that a dossier may eventually reference.

Sharing, synchronization, corporate folders, internal servers, a Central
Knowledge Service, APIs, databases, multi-tenancy, SaaS, cloud deployment, and
enterprise authentication remain unselected future options. They do not change
the local MVP architecture.

## Product principles

- Preserve traceability over convenience.
- Keep the domain independent of IBM Bob.
- Keep business logic independent of persistence and transport infrastructure.
- Keep stable project knowledge separate from individual Work Item dossiers.
- Avoid treating the validated Salesforce/Rally contract as a fictitiously
  neutral Core.
- Require explicit workspace authorization before writing.
- Keep integrations simulated until their contracts are confirmed.
- Grow one verified milestone at a time.

## Initial definition of success

Milestones 1 and 2 have verified that an IBM Bob user can run the local server,
safely initialize an authorized workspace, and create a DRAFT Work Item dossier
without exposing or modifying files outside that workspace. Manual IBM Bob
validation also confirmed duplicate protection and preservation of existing
dossiers.

Milestone 3 implemented the approved local document lifecycle and passed both
automated validation and manual IBM Bob validation on 2026-07-22 (19/19
tests). The dossier can hold controlled current-state, technical-analysis,
impact-analysis, and implementation-plan documents; it can also expose one
approved document at a time, versioned metadata, and derived AI context. The
milestone is completed.

**Milestone 4 Architecture Challenge: PASSED.** **Milestone 4 Design Review:
PASSED.** Its formal design is frozen in
[MILESTONE_4_DESIGN.md](MILESTONE_4_DESIGN.md). The implementation exposes
exactly seven approved M4 operations backed by a schema-versioned append-only
ledger, protected projections, global idempotency, revision checks, shared
locking, and journaled multi-file persistence. It preserves `WORK_ITEM.yml`,
status, and all M3 contracts.

Automated validation passed with 24 test files and 145 tests plus the complete
format, typecheck, lint, build, combined-check, and disposable-root smoke
workflow. Manual IBM Bob validation passed with 42/42 tests, 0 failures, and 0
non-executable tests. The three observations were resolved as contract-valid
validation precedence and shared-lock behavior, without code changes.

The completed M1–M4 foundation is the valid local
base for future Core evolution, not a claim that the existing
`SalesforceContext`, `developmentAlias`, and `rallyId` contracts are already
neutral. The M4 design and implementation are frozen and Milestone 4 is
officially closed. Contract neutralization requires an explicitly approved
future change.
