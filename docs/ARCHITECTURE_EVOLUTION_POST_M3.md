# Architecture Evolution Post-Milestone 3

## Purpose

This document records the product-level evolution review completed after
Milestone 3. It clarifies product identity and future conceptual boundaries
without changing the validated local MVP, its code, its MCP contracts, or its
historical evidence.

## Validated base at the time of review

Milestones 1, 2, and 3 are `COMPLETED — FROZEN`. They provide the local MCP foundation,
safe Work Item creation, and controlled document lifecycle. The local
filesystem remains the sole authorized persistence mechanism, and the existing
hexagonal architecture remains in force.

Milestone 4 was subsequently completed, frozen, and officially closed under its own
frozen design after automated and manual IBM Bob validation passed.

These milestones are the local, documentary, and architectural base from which
WS Workspace Core may evolve. They are not a fully neutral Core already: the
current validated contract explicitly contains `SalesforceContext`,
`developmentAlias`, and `rallyId` for its initial Salesforce/Rally use case.
That dependency is preserved and must not be hidden. A future neutralization
requires separate approval and implementation.

## Product layering direction

The future product direction has three conceptual layers:

1. **WS Workspace Core:** general concepts including Work Item, document,
   context, manifest, revision, decision, checkpoint, evidence, relation,
   component, functional capability, and audit.
2. **Technology Profile:** a future reusable extension for technology-specific
   vocabulary, component types, validations, or conventions. Salesforce is an
   example only; no Salesforce profile is defined here.
3. **Project Profile:** future stable, transversal knowledge of one project,
   such as its vocabulary, capabilities, conventions, known components, and
   functional relations. No Contact Center knowledge is defined here.

## Knowledge boundary

A Project Profile and a Work Item Dossier are intentionally different:

- A **Project Profile** is future stable, cross-Work-Item project knowledge.
- A **Work Item Dossier** is the generated, updated, and auditable record of
  one concrete Work Item.

A future dossier may reference Project Profile knowledge. It must not become a
general container for the stable knowledge of an entire project.

## Deferred choices

No complete profile format, API, loader or shared persistence mechanism is
selected. M5 now selects a narrow local schema for incremental knowledge,
relations and concepts, but it does not constitute a Technology Profile or
Project Profile completo. Sharing, synchronization, corporate folders,
internal servers, a Central Knowledge Service, databases, multi-tenancy, SaaS,
cloud deployment, and enterprise authentication are future options only.

Centralization is neither implemented nor rejected. It may be reconsidered
only when a future milestone explicitly scopes shared storage or
centralization.

## Milestone impact

This review does not reopen or modify M1–M3. At the time of this review,
Milestone 4 was unstarted and subject to a separate design review. Milestone 4
has since been designed, implemented, validated, and officially closed under
its own frozen contract. Technology Profiles, Project Profiles, and sharing
architecture were not part of Milestone 4 and remain unimplemented. M5
introduces only the approved local knowledge-base boundary and leaves complete
profiles and sharing unimplemented.

## Current status after M4.1B implementation

Milestones 1–4.1 are `COMPLETED — FROZEN`. M4.1A is
`DESIGN APPROVED — FROZEN`: it documents workspace-local `es-ES` rendering,
manifest-resident technical snapshot metadata, provider boundaries and
historical English compatibility. M4.1B implements that frozen design without
changing the conceptual layering and has passed automatic and manual IBM Bob
validation.

Milestone 5 está `COMPLETED — FROZEN`. Su contrato técnico y la implementación
local aditiva superaron la validación manual oficial B1–B19 mediante IBM Bob,
sin alterar la separación entre conocimiento estructurado del proyecto y cada
Work Item Dossier. La implementación avanza la visión hacia una base de
conocimiento viva dentro de esos límites.

Approved M5 boundaries are:

- one workspace-level M5 source in
  `.ws-workspace/records/KNOWLEDGE_BASE.json`, separate from M4;
- an explicit read-only `WS_PROJECT_SOURCE_ROOT`;
- dual historical/M5 dossier layouts without automatic migration;
- canonical lifecycle with a compatible legacy projection;
- stable but declared participant identity; and
- logical completion without physical archive movement;
- a causal M3/M4 revision fence for the sequential historical auto-reopen
  bridge.

## Authority

This document is explanatory. ADR-016 records the conceptual layering;
ADR-018, ADR-019, ADR-020 and ADR-021 record the approved M5 evolution. Completed
milestone designs and validation evidence remain historical contracts and are
not rewritten by this update.
