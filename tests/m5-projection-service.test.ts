import { describe, expect, it } from 'vitest';

import type { WorkItem } from '../src/domain/work-item.js';
import type {
  KnowledgeBaseState,
  WorkItemKnowledgeState,
} from '../src/domain/work-item-knowledge.js';
import { M5ProjectionService } from '../src/services/m5-projection-service.js';

const workItem: WorkItem = {
  id: 'US-500',
  rallyId: 'US-500',
  type: 'USER_STORY',
  status: 'DRAFT',
  title: 'Acceso',
  dates: { startedAt: '2026-07-28' },
  salesforce: { developmentAlias: 'PENDING' },
  functional: { definition: 'Permitir acceso.' },
  initialScope: { relatedComponents: [] },
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
};

const workflow: WorkItemKnowledgeState = {
  workItemId: 'US-500',
  iteration: { iterationId: 'Iteration 1', storageToken: 'Iteration_1' },
  status: 'IN_PROGRESS',
  classification: 'STANDARD',
  responsible: { participantId: 'dev:1', displayName: 'Carlos' },
  collaborators: [],
  responsibilityHistory: [],
  latestConsolidation: {
    consolidationId: '00000000-0000-4000-8000-000000000001',
    workItemId: 'US-500',
    functionalOverview: {
      purpose: 'Controlar el acceso.',
      actualBehavior: 'Valida la identidad.',
      functionalFlow: ['Solicitar acceso', 'Validar'],
      entryConditions: ['Identidad disponible'],
      businessRules: ['Requiere permiso'],
      testData: ['Usuario habilitado'],
      relatedWorkItemIds: [],
    },
    implementation: {
      components: [
        {
          name: 'AccessService',
          type: 'Apex',
          responsibility: 'Validar',
          changes: ['Añadido control'],
        },
      ],
      dependencies: [],
      implementationDecisions: ['Validación central'],
      technicalFlow: ['Servicio → permiso'],
    },
    testing: {
      preconditions: ['Usuario'],
      testData: ['Permiso'],
      scenarios: [
        { title: 'Acceso válido', steps: ['Entrar'], expectedOutcome: 'Acceso concedido' },
      ],
      regressionChecks: ['Acceso denegado'],
      evidenceReferenceIds: [],
      closureChecklist: ['Pruebas superadas'],
    },
  },
};

function state(): KnowledgeBaseState {
  return {
    knowledgeRevision: 2,
    workItems: [workflow],
    sessions: [],
    snapshots: [],
    checkpoints: [],
    relations: [],
    conceptProposals: [],
    concepts: [],
    structuralReviews: [],
    semanticObservations: [],
    workItemRevisions: { 'US-500': 2 },
    developerRevisions: {},
    catalogRevision: 0,
  };
}

function snapshotFile(relativePath: string, hashCharacter: string) {
  return {
    relativePath,
    sha256: hashCharacter.repeat(64),
    size: 1,
    modifiedAt: '2026-07-28T00:00:00.000Z',
  };
}

const spanishManifest = [
  '# Manifiesto del Work Item',
  '',
  '<!-- WS-WORKSPACE-MCP:DOCUMENT_RENDERING_SNAPSHOT schemaVersion=1.0.0 documentLanguage=es-ES renderingProfile=ES_ES_V1 -->',
  '',
  '## Milestone 4 Audit Inventory',
  '',
  'M4',
  '',
  '## Document Lifecycle Inventory',
  '',
  '- Generated at: 2026-07-28T00:00:00.000Z',
  '',
].join('\n');

describe('M5ProjectionService', () => {
  it('renders protected es-ES projections and inserts M5 before M4/M3', () => {
    const result = new M5ProjectionService().render(workItem, workflow, state(), spanishManifest);

    expect(result.artifacts['10_FUNCTIONAL_OVERVIEW.md']).toContain('# Visión funcional');
    expect(result.artifacts['11_IMPLEMENTATION.md']).toContain('AccessService');
    expect(result.manifest.indexOf('Milestone 5')).toBeLessThan(
      result.manifest.indexOf('Milestone 4'),
    );
    expect(result.manifest.indexOf('Milestone 4')).toBeLessThan(
      result.manifest.indexOf('Document Lifecycle'),
    );
  });

  it('projects accumulated Work Item changes against the activation baseline', () => {
    const projected = state();
    const sessionId = '00000000-0000-4000-8000-000000000002';
    const activationSnapshotId = '00000000-0000-4000-8000-000000000003';
    projected.sessions.push({
      sessionId,
      developer: workflow.responsible,
      workItemId: workflow.workItemId,
      status: 'SUSPENDED',
      activatedAt: '2026-07-28T00:00:00.000Z',
      suspendedAt: '2026-07-28T02:00:00.000Z',
      activationSnapshotId,
    });
    projected.snapshots.push(
      {
        snapshotId: activationSnapshotId,
        sessionId,
        kind: 'ACTIVATION',
        capturedAt: '2026-07-28T00:00:00.000Z',
        files: [
          snapshotFile('modified.ts', 'a'),
          snapshotFile('reverted.ts', 'c'),
          snapshotFile('deleted.ts', 'd'),
          snapshotFile('stable.ts', 'e'),
        ],
        changes: [],
        git: { available: false },
        exclusions: [],
        totalBytes: 4,
      },
      {
        snapshotId: '00000000-0000-4000-8000-000000000004',
        sessionId,
        kind: 'CHECKPOINT',
        capturedAt: '2026-07-28T01:00:00.000Z',
        files: [
          snapshotFile('modified.ts', 'b'),
          snapshotFile('reverted.ts', 'f'),
          snapshotFile('added.ts', 'g'),
          snapshotFile('stable.ts', 'e'),
        ],
        changes: [
          { relativePath: 'modified.ts', changeType: 'MODIFIED' },
          { relativePath: 'reverted.ts', changeType: 'MODIFIED' },
          { relativePath: 'added.ts', changeType: 'ADDED' },
          { relativePath: 'deleted.ts', changeType: 'DELETED' },
          { relativePath: 'stable.ts', changeType: 'UNCHANGED' },
        ],
        git: { available: false },
        exclusions: [],
        totalBytes: 4,
      },
      {
        snapshotId: '00000000-0000-4000-8000-000000000005',
        sessionId,
        kind: 'CLOSURE',
        capturedAt: '2026-07-28T02:00:00.000Z',
        files: [
          snapshotFile('modified.ts', 'b'),
          snapshotFile('reverted.ts', 'c'),
          snapshotFile('added.ts', 'g'),
          snapshotFile('stable.ts', 'e'),
        ],
        changes: [
          { relativePath: 'modified.ts', changeType: 'UNCHANGED' },
          { relativePath: 'reverted.ts', changeType: 'REVERTED' },
          { relativePath: 'added.ts', changeType: 'UNCHANGED' },
          { relativePath: 'stable.ts', changeType: 'UNCHANGED' },
        ],
        git: { available: false },
        exclusions: [],
        totalBytes: 4,
      },
    );

    const content = new M5ProjectionService().render(workItem, workflow, projected, spanishManifest)
      .artifacts['11_IMPLEMENTATION.md'];
    expect(content).toContain('ADDED: added.ts');
    expect(content).toContain('DELETED: deleted.ts');
    expect(content).toContain('MODIFIED: modified.ts');
    expect(content).not.toContain('reverted.ts');
    expect(content).not.toContain('stable.ts');
  });

  it('renders consolidated related Work Items and resolved observation traceability', () => {
    const projectedWorkflow = structuredClone(workflow);
    projectedWorkflow.latestConsolidation!.functionalOverview.relatedWorkItemIds = [
      'US-700',
      'US-600',
    ];
    const projected = state();
    projected.semanticObservations.push({
      observationId: '00000000-0000-4000-8000-000000000006',
      workItemId: workflow.workItemId,
      severity: 'WARNING',
      explanation: 'Confirmar la regla con negocio.',
      provenance: { source: 'HUMAN_CONFIRMED' },
      recordedAt: '2026-07-28T03:00:00.000Z',
      status: 'RESOLVED',
      resolvedAt: '2026-07-28T04:00:00.000Z',
      resolvedBy: { participantId: 'qa:2', displayName: 'Lucía' },
      resolution: 'Confirmada por negocio.',
    });

    const artifacts = new M5ProjectionService().render(
      workItem,
      projectedWorkflow,
      projected,
      spanishManifest,
    ).artifacts;
    const functional = artifacts['10_FUNCTIONAL_OVERVIEW.md'];
    const testing = artifacts['12_TESTING.md'];

    expect(functional).toContain('## Work Items relacionados');
    expect(functional.indexOf('US-600')).toBeLessThan(functional.indexOf('US-700'));
    expect(testing).toContain('Resolución: Confirmada por negocio.');
    expect(testing).toContain('Resuelta por: Lucía (qa:2)');
    expect(testing).toContain('Fecha: 2026-07-28T04:00:00.000Z');
  });

  it('escapes injected Markdown headings and omits locations from human text', () => {
    const projectedWorkflow = structuredClone(workflow);
    projectedWorkflow.latestConsolidation!.functionalOverview.purpose =
      'Texto seguro\n## Sección inyectada\nC:\\private\\scope.md';
    projectedWorkflow.latestConsolidation!.implementation.components[0]!.responsibility =
      'Consultar https://internal.example.invalid/details';

    const artifacts = new M5ProjectionService().render(
      workItem,
      projectedWorkflow,
      state(),
      spanishManifest,
    ).artifacts;
    const functional = artifacts['10_FUNCTIONAL_OVERVIEW.md'];
    const implementation = artifacts['11_IMPLEMENTATION.md'];

    expect(functional).toContain('\\#\\# Sección inyectada');
    expect(functional).toContain('\\[path omitted\\]');
    expect(functional).not.toMatch(/^## Sección inyectada/gmu);
    expect(functional).not.toContain('C:\\private');
    expect(implementation).toContain('\\[URL omitted\\]');
    expect(implementation).not.toContain('https://');
  });
});
