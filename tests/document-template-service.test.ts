import { describe, expect, it } from 'vitest';

import type { WorkItem } from '../src/domain/work-item.js';
import { DocumentTemplateService } from '../src/services/document-template-service.js';

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

describe('DocumentTemplateService', () => {
  const service = new DocumentTemplateService();

  it('renders the exact four missing documents with visible unknown placeholders', () => {
    const documents = service.renderInitialDocuments(workItem);

    expect(Object.keys(documents)).toEqual([
      'CURRENT_STATE',
      'TECHNICAL_ANALYSIS',
      'IMPACT_ANALYSIS',
      'IMPLEMENTATION_PLAN',
    ]);
    for (const content of Object.values(documents)) {
      expect(content).toContain('_Not provided._');
      expect(content).toContain('US-123');
      expect(content).not.toContain('Decision');
      expect(content).not.toContain('Test plan');
    }
  });

  it('renders the same supplied input deterministically with normalized stable lists', () => {
    const payload = {
      documentType: 'TECHNICAL_ANALYSIS' as const,
      knownFacts: ['  Input is persisted. ', 'Adapter is thin', 'Adapter is thin'],
      declaredHypotheses: [' No external calls are needed '],
      dependencies: [' zod ', 'typescript'],
      openQuestions: [' What needs validation? '],
    };

    const first = service.renderEditableDocument(workItem, payload);
    const second = service.renderEditableDocument(workItem, payload);

    expect(first).toBe(second);
    expect(first).toContain('- Adapter is thin\n- Input is persisted.');
    expect(first).toContain('- typescript\n- zod');
    expect(first).toContain('- No external calls are needed');
  });

  it('keeps supplied facts, hypotheses, questions, and plan steps in separate sections', () => {
    const currentState = service.renderEditableDocument(workItem, {
      documentType: 'CURRENT_STATE',
      knownFacts: ['A persisted fact'],
      constraints: ['A supplied constraint'],
      openQuestions: ['An unanswered question'],
    });
    const plan = service.renderEditableDocument(workItem, {
      documentType: 'IMPLEMENTATION_PLAN',
      plannedSteps: ['A supplied plan step'],
      prerequisites: ['A prerequisite'],
      openQuestions: ['A plan question'],
    });

    expect(currentState).toContain('## Known implementation context\n\n- A persisted fact');
    expect(currentState).toContain('## Constraints\n\n- A supplied constraint');
    expect(currentState).toContain('## Open questions\n\n- An unanswered question');
    expect(plan).toContain('## Supplied implementation steps\n\n- A supplied plan step');
    expect(plan).toContain('## Prerequisites\n\n- A prerequisite');
  });

  it('renders the controlled functional analysis only from its supplied payload', () => {
    const content = service.renderEditableDocument(workItem, {
      documentType: 'FUNCTIONAL_ANALYSIS',
      functionalDefinition: '  A supplied functional definition. ',
      acceptanceCriteria: ['Second criterion', 'First criterion'],
      relatedComponents: ['dossier'],
      developmentAlias: ' development ',
      startedAt: '2026-07-22',
    });

    expect(content).toContain('A supplied functional definition.');
    expect(content).toContain('- First criterion\n- Second criterion');
    expect(content).toContain('_Not provided._');
  });
});
