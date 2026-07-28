import { createHash } from 'node:crypto';

import {
  diffTechnicalSnapshotFiles,
  netTechnicalSnapshotChanges,
  type TechnicalSnapshotChange,
} from '../domain/technical-snapshot.js';
import type { WorkItem } from '../domain/work-item.js';
import type {
  KnowledgeBaseState,
  KnowledgeConsolidation,
  WorkItemKnowledgeState,
  WorkItemRelation,
} from '../domain/work-item-knowledge.js';
import { ManifestUpdateError } from '../errors/workspace-error.js';
import { providerForManifest } from './document-rendering.js';
import {
  M5_KNOWLEDGE_INVENTORY_HEADING,
  ManifestSectionCompositor,
} from './manifest-section-compositor.js';
import { completeWorkItemV2BootstrapMarker } from './work-item-v2-bootstrap-marker.js';

export const M5_PROJECTION_PATHS = [
  '09_FINAL_REPORT.md',
  '10_FUNCTIONAL_OVERVIEW.md',
  '11_IMPLEMENTATION.md',
  '12_TESTING.md',
] as const;

export interface M5ProjectionSet {
  manifest: string;
  artifacts: Record<(typeof M5_PROJECTION_PATHS)[number], string>;
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function omitSensitiveLocations(value: string): string {
  return value
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>()]+/giu, '[URL omitted]')
    .replace(/(^|[^\p{L}\p{N}])www\.[^\s<>()]*/giu, '$1[URL omitted]')
    .replace(/(^|[^\p{L}\p{N}])(?![a-z]:[\\/])[a-z][a-z0-9+.-]*:\S+/giu, '$1[URL omitted]')
    .replace(/\b[a-z]:[\\/][^\s<>()\x5b\x5d{},;]+/giu, '[path omitted]')
    .replace(/(^|[^\p{L}\p{N}._/\\-])(?:\\\\|\/\/)[^\s<>()\x5b\x5d{},;:]*/giu, '$1[path omitted]')
    .replace(/(^|[^\p{L}\p{N}._/\\-])[\\/](?![\\/])[^\s<>()\x5b\x5d{},;]*/giu, '$1[path omitted]')
    .replace(/(^|[^\p{L}\p{N}._/\\-])~[\\/][^\s<>()\x5b\x5d{},;]+/giu, '$1[path omitted]')
    .replace(
      /(^|[^\p{L}\p{N}._/\\-])(?:\.{1,2}[\\/])?(?:[^\s\\/<>()\x5b\x5d{},;:]+[\\/])+[^\s\\/<>()\x5b\x5d{},;:]+/gu,
      '$1[path omitted]',
    );
}

function markdownInline(value: string): string {
  const normalized = value.replace(/\r\n?/gu, '\n').replace(/\s+/gu, ' ').trim();
  const markdownCharacters = new Set(['\\', '`', '*', '_', '[', ']', '<', '>', '#', '|']);
  return Array.from(normalized)
    .map((character) => (markdownCharacters.has(character) ? `\\${character}` : character))
    .join('');
}

function safeText(value: string): string {
  return markdownInline(omitSensitiveLocations(value));
}

function safeTechnicalText(value: string): string {
  return markdownInline(value);
}

function lineOrMissing(value: string | undefined, missing: string): string {
  return value === undefined || value.trim().length === 0 ? `_${missing}_` : safeText(value);
}

function list(values: readonly string[], missing: string): string {
  return values.length === 0
    ? `_${missing}_`
    : values.map((value) => `- ${safeText(value)}`).join('\n');
}

function technicalList(values: readonly string[], missing: string): string {
  return values.length === 0
    ? `_${missing}_`
    : values.map((value) => `- ${safeTechnicalText(value)}`).join('\n');
}

function renderedList(values: readonly string[], missing: string): string {
  return values.length === 0 ? `_${missing}_` : values.map((value) => `- ${value}`).join('\n');
}

function language(manifest: string): 'es' | 'en' {
  return providerForManifest(manifest).profileId === 'ES_ES_V1' ? 'es' : 'en';
}

function compareSnapshots(
  left: KnowledgeBaseState['snapshots'][number],
  right: KnowledgeBaseState['snapshots'][number],
): number {
  return (
    left.capturedAt.localeCompare(right.capturedAt) ||
    left.snapshotId.localeCompare(right.snapshotId)
  );
}

function accumulatedChangesWithoutBaseline(
  snapshots: readonly KnowledgeBaseState['snapshots'][number][],
): TechnicalSnapshotChange[] {
  const accumulated = new Map<string, TechnicalSnapshotChange>();
  for (const snapshot of snapshots) {
    for (const change of snapshot.changes) {
      if (change.changeType === 'REVERTED') {
        accumulated.delete(change.relativePath);
      } else if (change.changeType !== 'UNCHANGED') {
        accumulated.set(change.relativePath, change);
      }
    }
  }
  return [...accumulated.values()].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

function finalTechnicalChanges(
  snapshots: readonly KnowledgeBaseState['snapshots'][number][],
): string[] {
  const ordered = [...snapshots].sort(compareSnapshots);
  const latest = ordered.at(-1);
  if (latest === undefined) {
    return [];
  }

  const baseline = ordered.find((snapshot) => snapshot.kind === 'ACTIVATION');
  const changes =
    baseline === undefined
      ? accumulatedChangesWithoutBaseline(ordered)
      : netTechnicalSnapshotChanges(
          diffTechnicalSnapshotFiles(latest.files, baseline.files, baseline.files),
        );
  return changes.map((change) => `${change.changeType}: ${change.relativePath}`);
}

function semanticObservationSummary(
  observation: KnowledgeBaseState['semanticObservations'][number],
  locale: 'es' | 'en',
): string {
  const summary = `${observation.status}/${observation.severity}: ${safeText(observation.explanation)}`;
  if (observation.status !== 'RESOLVED') {
    return summary;
  }

  const resolution =
    observation.resolution === undefined
      ? locale === 'es'
        ? 'No registrada'
        : 'Not recorded'
      : safeText(observation.resolution);
  const resolvedBy =
    observation.resolvedBy === undefined
      ? locale === 'es'
        ? 'No registrado'
        : 'Not recorded'
      : `${safeText(observation.resolvedBy.displayName)} (${safeTechnicalText(
          observation.resolvedBy.participantId,
        )})`;
  const resolvedAt =
    observation.resolvedAt === undefined
      ? locale === 'es'
        ? 'No registrada'
        : 'Not recorded'
      : safeTechnicalText(observation.resolvedAt);
  return locale === 'es'
    ? `${summary} — Resolución: ${resolution} — Resuelta por: ${resolvedBy} — Fecha: ${resolvedAt}`
    : `${summary} — Resolution: ${resolution} — Resolved by: ${resolvedBy} — Date: ${resolvedAt}`;
}

function relationSummary(relations: readonly WorkItemRelation[], workItemId: string): string[] {
  return relations
    .filter(
      (relation) =>
        relation.status === 'ACTIVE' &&
        (relation.sourceWorkItemId === workItemId || relation.targetWorkItemId === workItemId),
    )
    .map((relation) => {
      const direction =
        relation.sourceWorkItemId === workItemId
          ? `${relation.relationType} → ${relation.targetWorkItemId}`
          : `${relation.sourceWorkItemId} → ${relation.relationType}`;
      return `${direction}: ${relation.explanation}`;
    })
    .sort((left, right) => left.localeCompare(right));
}

function consolidationOrEmpty(state: WorkItemKnowledgeState): KnowledgeConsolidation {
  return (
    state.latestConsolidation ?? {
      consolidationId: 'PENDING',
      workItemId: state.workItemId,
      functionalOverview: {
        functionalFlow: [],
        entryConditions: [],
        businessRules: [],
        testData: [],
        relatedWorkItemIds: [],
      },
      implementation: {
        components: [],
        dependencies: [],
        implementationDecisions: [],
        technicalFlow: [],
      },
      testing: {
        preconditions: [],
        testData: [],
        scenarios: [],
        regressionChecks: [],
        evidenceReferenceIds: [],
        closureChecklist: [],
      },
    }
  );
}

export class M5ProjectionService {
  private readonly compositor = new ManifestSectionCompositor();

  public render(
    workItem: WorkItem,
    workflow: WorkItemKnowledgeState,
    state: KnowledgeBaseState,
    currentManifest: string,
  ): M5ProjectionSet {
    const completedBootstrap = completeWorkItemV2BootstrapMarker(currentManifest);
    if (!completedBootstrap.valid) {
      throw new ManifestUpdateError('The Work Item v2 bootstrap marker is invalid.');
    }
    const manifest = completedBootstrap.manifest;
    const locale = language(manifest);
    const consolidation = consolidationOrEmpty(workflow);
    const related = relationSummary(state.relations, workflow.workItemId);
    const observations = state.semanticObservations
      .filter((entry) => entry.workItemId === workflow.workItemId)
      .sort(
        (left, right) =>
          left.recordedAt.localeCompare(right.recordedAt) ||
          left.observationId.localeCompare(right.observationId),
      );
    const sessions = state.sessions.filter((entry) => entry.workItemId === workflow.workItemId);
    const sessionIds = new Set(sessions.map((entry) => entry.sessionId));
    const snapshots = state.snapshots.filter((entry) => sessionIds.has(entry.sessionId));
    const netChanges = finalTechnicalChanges(snapshots);

    const artifacts =
      locale === 'es'
        ? this.renderSpanish(workItem, workflow, consolidation, related, observations, netChanges)
        : this.renderEnglish(workItem, workflow, consolidation, related, observations, netChanges);
    const revision = state.workItemRevisions[workflow.workItemId] ?? 0;
    const inventory = [
      M5_KNOWLEDGE_INVENTORY_HEADING,
      '',
      `- Schema version: 1.0.0`,
      `- Knowledge revision: ${state.knowledgeRevision}`,
      `- Work Item revision: ${revision}`,
      `- Canonical status: ${workflow.status}`,
      '',
      '| Relative path | Projection | SHA-256 |',
      '| --- | --- | --- |',
      ...M5_PROJECTION_PATHS.map((path) => `| ${path} | PROTECTED | ${sha256(artifacts[path])} |`),
    ].join('\n');
    return {
      artifacts,
      manifest: this.compositor.upsertM5KnowledgeInventory(manifest, inventory),
    };
  }

  private renderSpanish(
    workItem: WorkItem,
    workflow: WorkItemKnowledgeState,
    consolidation: KnowledgeConsolidation,
    related: readonly string[],
    observations: readonly KnowledgeBaseState['semanticObservations'][number][],
    netChanges: readonly string[],
  ): M5ProjectionSet['artifacts'] {
    const missing = 'Pendiente de consolidación';
    const functional = [
      '# Visión funcional',
      '',
      '<!-- PROYECCIÓN M5 PROTEGIDA. NO EDITAR DIRECTAMENTE. -->',
      '',
      '## Propósito',
      '',
      lineOrMissing(consolidation.functionalOverview.purpose, missing),
      '',
      '## Comportamiento real',
      '',
      lineOrMissing(consolidation.functionalOverview.actualBehavior, missing),
      '',
      '## Flujo funcional',
      '',
      list(consolidation.functionalOverview.functionalFlow, missing),
      '',
      '## Condiciones de entrada',
      '',
      list(consolidation.functionalOverview.entryConditions, missing),
      '',
      '## Reglas de negocio',
      '',
      list(consolidation.functionalOverview.businessRules, missing),
      '',
      '## Datos para probar',
      '',
      list(consolidation.functionalOverview.testData, missing),
      '',
      '## Relaciones funcionales',
      '',
      list(related, 'Sin relaciones confirmadas'),
      '',
      '## Work Items relacionados',
      '',
      list(
        [...consolidation.functionalOverview.relatedWorkItemIds].sort((left, right) =>
          left.localeCompare(right),
        ),
        'Sin Work Items relacionados',
      ),
      '',
    ].join('\n');
    const implementation = [
      '# Implementación',
      '',
      '<!-- PROYECCIÓN M5 PROTEGIDA. NO EDITAR DIRECTAMENTE. -->',
      '',
      '## Componentes',
      '',
      ...(consolidation.implementation.components.length === 0
        ? [`_${missing}_`]
        : consolidation.implementation.components.flatMap((component) => [
            `### ${safeText(component.name)} (${safeText(component.type)})`,
            '',
            safeText(component.responsibility),
            '',
            list(component.changes, missing),
            '',
          ])),
      '## Dependencias',
      '',
      list(consolidation.implementation.dependencies, missing),
      '',
      '## Decisiones de implementación',
      '',
      list(consolidation.implementation.implementationDecisions, missing),
      '',
      '## Flujo técnico final',
      '',
      list(consolidation.implementation.technicalFlow, missing),
      '',
      '## Cambios técnicos netos observados',
      '',
      technicalList(netChanges, 'Sin cambios netos confirmados'),
      '',
      '## Relaciones técnicas',
      '',
      list(related, 'Sin relaciones confirmadas'),
      '',
    ].join('\n');
    const testing = [
      '# Pruebas',
      '',
      '<!-- PROYECCIÓN M5 PROTEGIDA. NO EDITAR DIRECTAMENTE. -->',
      '',
      '## Precondiciones',
      '',
      list(consolidation.testing.preconditions, missing),
      '',
      '## Datos',
      '',
      list(consolidation.testing.testData, missing),
      '',
      '## Escenarios',
      '',
      ...(consolidation.testing.scenarios.length === 0
        ? [`_${missing}_`, '']
        : consolidation.testing.scenarios.flatMap((scenario) => [
            `### ${safeText(scenario.title)}`,
            '',
            list(scenario.steps, missing),
            '',
            `**Resultado esperado:** ${safeText(scenario.expectedOutcome)}`,
            '',
          ])),
      '## Regresión',
      '',
      list(consolidation.testing.regressionChecks, missing),
      '',
      '## Evidencias',
      '',
      list(consolidation.testing.evidenceReferenceIds, 'Sin evidencias referenciadas'),
      '',
      '## Checklist de cierre',
      '',
      list(consolidation.testing.closureChecklist, missing),
      '',
      '## Observaciones semánticas',
      '',
      renderedList(
        observations.map((entry) => semanticObservationSummary(entry, 'es')),
        'Sin observaciones semánticas',
      ),
      '',
    ].join('\n');
    const report = this.finalReportSpanish(workItem, workflow, functional, implementation, testing);
    return {
      '09_FINAL_REPORT.md': report,
      '10_FUNCTIONAL_OVERVIEW.md': functional,
      '11_IMPLEMENTATION.md': implementation,
      '12_TESTING.md': testing,
    };
  }

  private finalReportSpanish(
    workItem: WorkItem,
    workflow: WorkItemKnowledgeState,
    functional: string,
    implementation: string,
    testing: string,
  ): string {
    return [
      '# Informe final del Work Item',
      '',
      '<!-- PROYECCIÓN M5 PROTEGIDA. NO EDITAR DIRECTAMENTE. -->',
      '',
      `- ID: ${workItem.id}`,
      `- Título: ${safeText(workItem.title)}`,
      `- Estado: ${workflow.status}`,
      `- Iteración: ${safeText(workflow.iteration.displayName ?? workflow.iteration.iterationId)}`,
      `- Responsable principal: ${safeText(workflow.responsible.displayName)} (${workflow.responsible.participantId})`,
      `- Colaboradores: ${workflow.collaborators.map((entry) => safeText(entry.displayName)).join(', ') || 'Ninguno'}`,
      `- Finalización: ${workflow.completedAt ?? 'No completado'}`,
      `- Revisión estructural: ${workflow.latestStructuralReview?.result ?? 'NO REGISTRADA'}`,
      '',
      '## Resumen funcional',
      '',
      sectionBody(functional),
      '',
      '## Implementación',
      '',
      sectionBody(implementation),
      '',
      '## Pruebas',
      '',
      sectionBody(testing),
      '',
    ].join('\n');
  }

  private renderEnglish(
    workItem: WorkItem,
    workflow: WorkItemKnowledgeState,
    consolidation: KnowledgeConsolidation,
    related: readonly string[],
    observations: readonly KnowledgeBaseState['semanticObservations'][number][],
    netChanges: readonly string[],
  ): M5ProjectionSet['artifacts'] {
    const missing = 'Pending consolidation';
    const functional = [
      '# Functional Overview',
      '',
      '<!-- PROTECTED M5 PROJECTION. DO NOT EDIT DIRECTLY. -->',
      '',
      '## Purpose',
      '',
      lineOrMissing(consolidation.functionalOverview.purpose, missing),
      '',
      '## Actual behavior',
      '',
      lineOrMissing(consolidation.functionalOverview.actualBehavior, missing),
      '',
      '## Functional flow',
      '',
      list(consolidation.functionalOverview.functionalFlow, missing),
      '',
      '## Entry conditions',
      '',
      list(consolidation.functionalOverview.entryConditions, missing),
      '',
      '## Business rules',
      '',
      list(consolidation.functionalOverview.businessRules, missing),
      '',
      '## Test data',
      '',
      list(consolidation.functionalOverview.testData, missing),
      '',
      '## Functional relations',
      '',
      list(related, 'No confirmed relations'),
      '',
      '## Related Work Items',
      '',
      list(
        [...consolidation.functionalOverview.relatedWorkItemIds].sort((left, right) =>
          left.localeCompare(right),
        ),
        'No related Work Items',
      ),
      '',
    ].join('\n');
    const implementation = [
      '# Implementation',
      '',
      '<!-- PROTECTED M5 PROJECTION. DO NOT EDIT DIRECTLY. -->',
      '',
      '## Components',
      '',
      ...(consolidation.implementation.components.length === 0
        ? [`_${missing}_`]
        : consolidation.implementation.components.flatMap((component) => [
            `### ${safeText(component.name)} (${safeText(component.type)})`,
            '',
            safeText(component.responsibility),
            '',
            list(component.changes, missing),
            '',
          ])),
      '## Dependencies',
      '',
      list(consolidation.implementation.dependencies, missing),
      '',
      '## Implementation decisions',
      '',
      list(consolidation.implementation.implementationDecisions, missing),
      '',
      '## Final technical flow',
      '',
      list(consolidation.implementation.technicalFlow, missing),
      '',
      '## Observed net technical changes',
      '',
      technicalList(netChanges, 'No confirmed net changes'),
      '',
      '## Technical relations',
      '',
      list(related, 'No confirmed relations'),
      '',
    ].join('\n');
    const testing = [
      '# Testing',
      '',
      '<!-- PROTECTED M5 PROJECTION. DO NOT EDIT DIRECTLY. -->',
      '',
      '## Preconditions',
      '',
      list(consolidation.testing.preconditions, missing),
      '',
      '## Data',
      '',
      list(consolidation.testing.testData, missing),
      '',
      '## Scenarios',
      '',
      ...(consolidation.testing.scenarios.length === 0
        ? [`_${missing}_`, '']
        : consolidation.testing.scenarios.flatMap((scenario) => [
            `### ${safeText(scenario.title)}`,
            '',
            list(scenario.steps, missing),
            '',
            `**Expected outcome:** ${safeText(scenario.expectedOutcome)}`,
            '',
          ])),
      '## Regression',
      '',
      list(consolidation.testing.regressionChecks, missing),
      '',
      '## Evidence',
      '',
      list(consolidation.testing.evidenceReferenceIds, 'No referenced evidence'),
      '',
      '## Closure checklist',
      '',
      list(consolidation.testing.closureChecklist, missing),
      '',
      '## Semantic observations',
      '',
      renderedList(
        observations.map((entry) => semanticObservationSummary(entry, 'en')),
        'No semantic observations',
      ),
      '',
    ].join('\n');
    const report = [
      '# Work Item Final Report',
      '',
      '<!-- PROTECTED M5 PROJECTION. DO NOT EDIT DIRECTLY. -->',
      '',
      `- ID: ${workItem.id}`,
      `- Title: ${safeText(workItem.title)}`,
      `- Status: ${workflow.status}`,
      `- Iteration: ${safeText(workflow.iteration.displayName ?? workflow.iteration.iterationId)}`,
      `- Principal: ${safeText(workflow.responsible.displayName)} (${workflow.responsible.participantId})`,
      `- Collaborators: ${workflow.collaborators.map((entry) => safeText(entry.displayName)).join(', ') || 'None'}`,
      `- Completed at: ${workflow.completedAt ?? 'Not completed'}`,
      `- Structural review: ${workflow.latestStructuralReview?.result ?? 'NOT RECORDED'}`,
      '',
      '## Functional summary',
      '',
      sectionBody(functional),
      '',
      '## Implementation',
      '',
      sectionBody(implementation),
      '',
      '## Testing',
      '',
      sectionBody(testing),
      '',
    ].join('\n');
    return {
      '09_FINAL_REPORT.md': report,
      '10_FUNCTIONAL_OVERVIEW.md': functional,
      '11_IMPLEMENTATION.md': implementation,
      '12_TESTING.md': testing,
    };
  }
}

function sectionBody(document: string): string {
  return document
    .split('\n')
    .filter(
      (line) =>
        !line.startsWith('# ') &&
        !line.includes('PROYECCIÓN M5 PROTEGIDA') &&
        !line.includes('PROTECTED M5 PROJECTION'),
    )
    .join('\n')
    .trim();
}
