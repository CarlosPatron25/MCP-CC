# Product definition

## Vision

WS Workspace MCP is the local working memory for a Salesforce delivery team. It
will retain a closed, understandable dossier for each item of work so a person
or development AI can resume it without reconstructing its history.

## Target user

The primary user is a Salesforce developer using IBM Bob while analysing,
implementing, testing or revisiting a Rally item. Technical leads and reviewers
are secondary consumers of the resulting documentation.

## Problem

Rally requests, local analysis, implementation decisions, affected components
and test evidence otherwise live in disconnected locations or disappear from
the active conversation. Reopening an item requires rediscovery and increases
the risk of incomplete changes.

## Value proposition

For every approved work item, the product will make its functional request,
technical context, decisions, progress and evidence discoverable in a
consistent local directory. IBM Bob can use the same structured context without
embedding business knowledge in the MCP adapter.

## MVP scope

The intended MVP supports exactly four work-item types, local file persistence,
a document lifecycle, state tracking, safe search and an MCP-first interface
for IBM Bob.

Milestones 1 and 2 are completed and validated. Milestone 1 provides the
secure MCP foundation and workspace initialization. Milestone 2 provides safe,
manual creation of a DRAFT Work Item and its minimum initial dossier through
`create_work_item`. The delivered dossier contains the persisted Work Item,
manifest, functional analysis, initial AI context, and evidence and snapshot
directories. Lifecycle operations, search, and the remaining dossier documents
are future milestone work.

## Outside the MVP

- Direct Rally integration.
- Direct Copado integration.
- A VS Code extension.
- Automatic access to Salesforce or corporate repositories.
- Multi-client or remote-host compatibility as a product requirement.

## Product principles

- Preserve traceability over convenience.
- Keep the domain independent of IBM Bob.
- Require explicit workspace authorization before writing.
- Keep integrations simulated until their contracts are confirmed.
- Grow one verified milestone at a time.

## Initial definition of success

Milestones 1 and 2 have verified that an IBM Bob user can run the local server,
safely initialize an authorized workspace, and create a DRAFT Work Item dossier
without exposing or modifying files outside that workspace. Milestone 3 will
extend the dossier progressively; it has not started.
