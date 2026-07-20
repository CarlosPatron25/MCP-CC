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

The MVP supports exactly four work-item types, local file persistence, a
document lifecycle, state tracking, safe search and an MCP-first interface for
IBM Bob. Milestone 1 is completed and provides the validated secure MCP
foundation and workspace initialization; later MVP behavior remains future
milestone work.

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

Milestone 1 has verified that an IBM Bob user can run the local server and
safely initialize an authorized workspace without exposing or modifying files
outside it. Later milestones will extend that foundation to complete work-item
dossiers.
