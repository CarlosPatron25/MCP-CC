import { describe, expect, it } from 'vitest';

import type { WorkItem } from '../src/domain/work-item.js';
import type { DocumentLifecycleMetadata } from '../src/domain/work-item-document.js';
import { AIContextProjectionService } from '../src/services/ai-context-projection-service.js';

const workItem: WorkItem = {
  id: 'US-123',
  rallyId: 'US 123',
  type: 'USER_STORY',
  status: 'DRAFT',
  title: 'Create a controlled dossier',
  dates: { startedAt: '2026-07-22' },
  salesforce: { developmentAlias: 'development' },
  functional: { definition: 'Create a controlled Work Item dossier.' },
  initialScope: { relatedComponents: ['mcp-server', 'dossier'] },
  createdAt: '2026-07-22T10:00:00.000Z',
  updatedAt: '2026-07-22T10:00:00.000Z',
};

const lifecycleMetadata: DocumentLifecycleMetadata[] = [
  {
    documentType: 'MANIFEST',
    relativePath: '00_MANIFEST.md',
    status: 'UPDATED',
    revision: 1,
    updatedAt: '2026-07-22T12:00:00.000Z',
    updatedBy: 'SYSTEM',
    contentType: 'DERIVED',
  },
  {
    documentType: 'CURRENT_STATE',
    relativePath: '02_CURRENT_STATE.md',
    status: 'INITIALIZED',
    revision: 1,
    updatedAt: '2026-07-22T12:00:00.000Z',
    updatedBy: 'SYSTEM',
    contentType: 'TEMPLATE',
  },
  {
    documentType: 'FUNCTIONAL_ANALYSIS',
    relativePath: '01_FUNCTIONAL_ANALYSIS.md',
    status: 'CREATED',
    revision: 1,
    updatedAt: '2026-07-22T12:00:00.000Z',
    updatedBy: 'SYSTEM',
    contentType: 'SUPPLIED',
  },
];

describe('AIContextProjectionService', () => {
  it('projects only persisted inputs deterministically with stable ordering', () => {
    const service = new AIContextProjectionService();
    const functionalAnalysis = '# Functional Analysis\n\nPersisted supplied content.\n';

    const first = service.project(workItem, functionalAnalysis, lifecycleMetadata);
    const second = service.project(workItem, functionalAnalysis, lifecycleMetadata);

    expect(first).toBe(second);
    expect(first).toContain('Persisted supplied content.');
    expect(first).toContain('| FUNCTIONAL_ANALYSIS | 01_FUNCTIONAL_ANALYSIS.md |');
    expect(first).toContain('| CURRENT_STATE | 02_CURRENT_STATE.md |');
    expect(first.indexOf('FUNCTIONAL_ANALYSIS')).toBeLessThan(first.indexOf('CURRENT_STATE'));
    expect(first).not.toContain('checkpoint');
    expect(first).not.toContain('Decision');
  });
});
