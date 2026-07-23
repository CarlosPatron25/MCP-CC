import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_LIFECYCLE_STATUSES,
  EDITABLE_DOCUMENT_TYPES,
  MANAGED_DOCUMENT_TYPES,
  isEditableDocumentType,
  isManagedDocumentType,
  type DocumentLifecycleMetadata,
} from '../src/domain/work-item-document.js';

describe('Work Item document lifecycle contracts', () => {
  it('exposes the closed Milestone 3 managed document set', () => {
    expect(MANAGED_DOCUMENT_TYPES).toEqual([
      'MANIFEST',
      'FUNCTIONAL_ANALYSIS',
      'CURRENT_STATE',
      'TECHNICAL_ANALYSIS',
      'IMPACT_ANALYSIS',
      'IMPLEMENTATION_PLAN',
      'AI_CONTEXT',
    ]);
    expect(EDITABLE_DOCUMENT_TYPES).toEqual([
      'FUNCTIONAL_ANALYSIS',
      'CURRENT_STATE',
      'TECHNICAL_ANALYSIS',
      'IMPACT_ANALYSIS',
      'IMPLEMENTATION_PLAN',
    ]);
  });

  it('recognizes only approved managed and editable types', () => {
    expect(isManagedDocumentType('CURRENT_STATE')).toBe(true);
    expect(isManagedDocumentType('AI_RULES')).toBe(false);
    expect(isEditableDocumentType('IMPLEMENTATION_PLAN')).toBe(true);
    expect(isEditableDocumentType('AI_CONTEXT')).toBe(false);
  });

  it('models only approved lifecycle statuses and content types', () => {
    expect(DOCUMENT_LIFECYCLE_STATUSES).toEqual(['CREATED', 'INITIALIZED', 'UPDATED']);
    expect(DOCUMENT_CONTENT_TYPES).toEqual(['TEMPLATE', 'SUPPLIED', 'DERIVED']);

    const metadata: DocumentLifecycleMetadata = {
      documentType: 'CURRENT_STATE',
      relativePath: '02_CURRENT_STATE.md',
      status: 'INITIALIZED',
      revision: 1,
      updatedAt: '2026-07-22T10:00:00.000Z',
      updatedBy: 'SYSTEM',
      contentType: 'TEMPLATE',
    };

    expect(metadata).toMatchObject({ revision: 1, updatedBy: 'SYSTEM' });
  });
});
