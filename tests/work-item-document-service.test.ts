import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AuditTrackingConflictError,
  DocumentLifecycleConflictError,
  DocumentRevisionConflictError,
  DocumentTypeUnsupportedError,
  DocumentValidationError,
} from '../src/errors/workspace-error.js';
import { LocalFilesystemWorkItemDossierRepository } from '../src/filesystem/local-filesystem-work-item-dossier-repository.js';
import { initializeWorkspace } from '../src/filesystem/workspace-initializer.js';
import { AIContextProjectionService } from '../src/services/ai-context-projection-service.js';
import type { Clock } from '../src/services/clock.js';
import { DocumentTemplateService } from '../src/services/document-template-service.js';
import { ManifestLifecycleService } from '../src/services/manifest-lifecycle-service.js';
import { WorkItemCreationService } from '../src/services/work-item-creation-service.js';
import { WorkItemDocumentService } from '../src/services/work-item-document-service.js';
import { createTemporaryWorkspaceRoot, removeTemporaryWorkspaceRoot } from './helpers.js';

const temporaryRoots: string[] = [];
const fixedClock: Clock = { now: () => '2026-07-22T12:00:00.000Z' };

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(removeTemporaryWorkspaceRoot));
});

async function createService(): Promise<{
  root: string;
  workItemId: string;
  service: WorkItemDocumentService;
  repository: LocalFilesystemWorkItemDossierRepository;
}> {
  const root = await createTemporaryWorkspaceRoot();
  temporaryRoots.push(root);
  await initializeWorkspace(root);
  const created = await new WorkItemCreationService({ workspaceRoot: root }).create({
    type: 'USER_STORY',
    rallyId: 'US-123',
    title: 'Create a controlled dossier',
    functionalDefinition: 'A user can create a controlled dossier.',
    developmentAlias: 'development',
    relatedComponents: ['workspace-mcp'],
    startedAt: '2026-07-22',
  });
  const repository = new LocalFilesystemWorkItemDossierRepository({ workspaceRoot: root });
  const service = new WorkItemDocumentService(
    repository,
    new DocumentTemplateService(),
    new ManifestLifecycleService(fixedClock),
    new AIContextProjectionService(),
  );
  return { root, workItemId: created.id, service, repository };
}

describe('WorkItemDocumentService', () => {
  it('initializes the exact four lifecycle documents idempotently without changing DRAFT', async () => {
    const { root, workItemId, service, repository } = await createService();

    const first = await service.initialize({ workItemId });
    const second = await service.initialize({ workItemId });
    const currentState = await service.getDocument({ workItemId, documentType: 'CURRENT_STATE' });

    expect(first.created.map((entry) => entry.documentType)).toEqual([
      'CURRENT_STATE',
      'TECHNICAL_ANALYSIS',
      'IMPACT_ANALYSIS',
      'IMPLEMENTATION_PLAN',
    ]);
    expect(second).toMatchObject({ workItemId, created: [] });
    expect(second.existing).toHaveLength(7);
    expect(currentState.document.metadata).toMatchObject({
      relativePath: '02_CURRENT_STATE.md',
      revision: 1,
      status: 'INITIALIZED',
    });
    expect(JSON.stringify(first)).not.toContain(root);
    await expect(repository.readWorkItem(workItemId)).resolves.toMatchObject({ status: 'DRAFT' });
  });

  it('reads exactly one allowed document and rejects unsupported document types', async () => {
    const { root, workItemId, service } = await createService();
    await service.initialize({ workItemId });

    const result = await service.getDocument({ workItemId, documentType: 'TECHNICAL_ANALYSIS' });

    expect(result).toMatchObject({ workItemId });
    expect(result.document.content).toContain('# Análisis técnico');
    expect(result.document.metadata.relativePath).toBe('03_TECHNICAL_ANALYSIS.md');
    expect(JSON.stringify(result)).not.toContain(root);
    await expect(
      service.getDocument({ workItemId, documentType: 'AI_RULES' }),
    ).rejects.toBeInstanceOf(DocumentTypeUnsupportedError);
    await expect(
      service.getDocument({ workItemId, documentType: '../WORK_ITEM.yml' }),
    ).rejects.toBeInstanceOf(DocumentTypeUnsupportedError);
  });

  it('updates every editable document through its typed payload and revisions the manifest', async () => {
    const { workItemId, service } = await createService();
    await service.initialize({ workItemId });
    const updates = [
      {
        documentType: 'FUNCTIONAL_ANALYSIS',
        payload: {
          functionalDefinition: 'Updated supplied functional definition.',
          relatedComponents: ['workspace-mcp'],
          developmentAlias: 'development',
          startedAt: '2026-07-22',
        },
      },
      {
        documentType: 'CURRENT_STATE',
        payload: { knownFacts: ['A supplied current-state fact.'] },
      },
      {
        documentType: 'TECHNICAL_ANALYSIS',
        payload: { knownFacts: ['A supplied technical observation.'] },
      },
      {
        documentType: 'IMPACT_ANALYSIS',
        payload: { affectedComponents: ['workspace-mcp'] },
      },
      {
        documentType: 'IMPLEMENTATION_PLAN',
        payload: { plannedSteps: ['A supplied implementation step.'] },
      },
    ];

    for (const update of updates) {
      const current = await service.getDocument({
        workItemId,
        documentType: update.documentType,
      });
      const result = await service.update({
        workItemId,
        documentType: update.documentType,
        expectedRevision: current.document.metadata.revision,
        payload: update.payload,
      });
      expect(result.document).toMatchObject({
        documentType: update.documentType,
        revision: current.document.metadata.revision + 1,
        status: 'UPDATED',
        contentType: 'SUPPLIED',
      });
    }

    const manifest = await service.getDocument({ workItemId, documentType: 'MANIFEST' });
    expect(manifest.document.content).toContain(
      '| IMPLEMENTATION_PLAN | 05_IMPLEMENTATION_PLAN.md | UPDATED | 2 |',
    );
    expect(manifest.document.metadata.revision).toBe(6);
  });

  it('rejects stale revisions, raw-scope leakage, and attempts to edit AI context', async () => {
    const { workItemId, service } = await createService();
    await service.initialize({ workItemId });
    const before = await service.getDocument({ workItemId, documentType: 'CURRENT_STATE' });

    await expect(
      service.update({
        workItemId,
        documentType: 'CURRENT_STATE',
        expectedRevision: before.document.metadata.revision,
        payload: { knownFacts: ['A supplied fact.'], decisions: ['Not allowed'] },
      }),
    ).rejects.toBeInstanceOf(DocumentValidationError);
    await expect(
      service.update({
        workItemId,
        documentType: 'AI_CONTEXT',
        expectedRevision: 1,
        payload: { knownFacts: ['Not editable'] },
      }),
    ).rejects.toBeInstanceOf(DocumentTypeUnsupportedError);
    await service.update({
      workItemId,
      documentType: 'CURRENT_STATE',
      expectedRevision: before.document.metadata.revision,
      payload: { knownFacts: ['A supplied fact.'] },
    });
    await expect(
      service.update({
        workItemId,
        documentType: 'CURRENT_STATE',
        expectedRevision: before.document.metadata.revision,
        payload: { knownFacts: ['A different supplied fact.'] },
      }),
    ).rejects.toBeInstanceOf(DocumentRevisionConflictError);
  });

  it('refreshes only derived AI context and preserves the protected context files', async () => {
    const { root, workItemId, service } = await createService();
    await service.initialize({ workItemId });
    const aiContext = await service.getDocument({ workItemId, documentType: 'AI_CONTEXT' });
    const rulesPath = join(root, '.ws-workspace', 'active', workItemId, 'context', 'AI_RULES.md');
    const nextTaskPath = join(
      root,
      '.ws-workspace',
      'active',
      workItemId,
      'context',
      'NEXT_TASK.md',
    );
    const rules = await readFile(rulesPath, 'utf8');
    const nextTask = await readFile(nextTaskPath, 'utf8');

    const refreshed = await service.refreshAiContext({
      workItemId,
      expectedRevision: aiContext.document.metadata.revision,
    });
    const refreshedDocument = await service.getDocument({ workItemId, documentType: 'AI_CONTEXT' });

    expect(refreshed.document).toMatchObject({
      documentType: 'AI_CONTEXT',
      revision: 2,
      status: 'UPDATED',
      contentType: 'DERIVED',
    });
    expect(refreshedDocument.document.content).toContain('## Análisis funcional persistido');
    await expect(readFile(rulesPath, 'utf8')).resolves.toBe(rules);
    await expect(readFile(nextTaskPath, 'utf8')).resolves.toBe(nextTask);
  });

  it('keeps the historical M3 conflict code when the optional M4 summary lock is busy', async () => {
    const { workItemId, repository, service } = await createService();
    await service.initialize({ workItemId });
    const aiContext = await service.getDocument({ workItemId, documentType: 'AI_CONTEXT' });
    const contestedService = new WorkItemDocumentService(
      repository,
      new DocumentTemplateService(),
      new ManifestLifecycleService(fixedClock),
      new AIContextProjectionService(),
      {
        getContextSummary: async () => {
          throw new AuditTrackingConflictError('The shared lock is busy.');
        },
      },
    );

    await expect(
      contestedService.refreshAiContext({
        workItemId,
        expectedRevision: aiContext.document.metadata.revision,
      }),
    ).rejects.toBeInstanceOf(DocumentLifecycleConflictError);
  });
});
