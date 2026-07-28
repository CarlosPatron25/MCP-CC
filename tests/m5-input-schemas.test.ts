import { describe, expect, it } from 'vitest';

import {
  CONSOLIDATE_DOSSIER_SCHEMA,
  M5_PROVENANCE_SCHEMA,
  REVIEW_WORK_ITEM_SCHEMA,
  SUSPEND_SESSION_SCHEMA,
} from '../src/mcp/m5-input-schemas.js';
import { CREATE_WORK_ITEM_V2_INPUT_SCHEMA } from '../src/services/work-item-v2-creation-service.js';

const mutation = {
  expectedKnowledgeRevision: 0,
  idempotencyKey: '90000000-0000-4000-8000-000000000001',
  actor: { participantId: 'dev:carlos', displayName: 'Carlos' },
};
const createWorkItemV2Input = {
  type: 'USER_STORY' as const,
  rallyId: 'WI-1',
  title: 'Safe title',
  functionalDefinition: 'Safe functional definition.',
  iteration: { iterationId: 'Iteration 1' },
  ...mutation,
};

describe('Milestone 5 closed input schemas', () => {
  it.each([
    {
      name: 'manual authorship',
      value: { source: 'MANUAL', introducedBy: mutation.actor },
    },
    {
      name: 'AI inference without a human identity',
      value: { source: 'AI_INFERRED' },
    },
    {
      name: 'human confirmation',
      value: { source: 'HUMAN_CONFIRMED', confirmedBy: mutation.actor },
    },
    {
      name: 'human confirmation with a declared introducer',
      value: {
        source: 'HUMAN_CONFIRMED',
        introducedBy: mutation.actor,
        confirmedBy: mutation.actor,
      },
    },
    {
      name: 'calculated system knowledge without a human identity',
      value: { source: 'SYSTEM_CALCULATED' },
    },
    {
      name: 'pending imported knowledge without an importer',
      value: { source: 'IMPORTED_PENDING_VALIDATION' },
    },
    {
      name: 'pending imported knowledge with a declared importer',
      value: {
        source: 'IMPORTED_PENDING_VALIDATION',
        introducedBy: mutation.actor,
      },
    },
  ])('accepts valid $name provenance', ({ value }) => {
    expect(M5_PROVENANCE_SCHEMA.safeParse(value).success).toBe(true);
  });

  it.each([
    {
      name: 'manual knowledge without its introducer',
      value: { source: 'MANUAL' },
    },
    {
      name: 'manual knowledge carrying a confirmation identity',
      value: {
        source: 'MANUAL',
        introducedBy: mutation.actor,
        confirmedBy: mutation.actor,
      },
    },
    {
      name: 'AI inference attributed to a human introducer',
      value: { source: 'AI_INFERRED', introducedBy: mutation.actor },
    },
    {
      name: 'AI inference attributed to a human confirmer',
      value: { source: 'AI_INFERRED', confirmedBy: mutation.actor },
    },
    {
      name: 'human confirmation without its confirmer',
      value: { source: 'HUMAN_CONFIRMED' },
    },
    {
      name: 'calculated system knowledge attributed to a human',
      value: { source: 'SYSTEM_CALCULATED', introducedBy: mutation.actor },
    },
    {
      name: 'pending imported knowledge presented as confirmed',
      value: {
        source: 'IMPORTED_PENDING_VALIDATION',
        confirmedBy: mutation.actor,
      },
    },
  ])('rejects invalid $name provenance', ({ value }) => {
    expect(M5_PROVENANCE_SCHEMA.safeParse(value).success).toBe(false);
  });

  it('rejects unknown path-bearing properties', () => {
    expect(
      SUSPEND_SESSION_SCHEMA.safeParse({
        workItemId: 'WI-1',
        observedWork: [],
        relevantContext: [],
        pendingQuestions: [],
        projectRoot: 'src',
        ...mutation,
      }).success,
    ).toBe(false);
  });

  it('rejects absolute locations and URLs in persisted semantic text', () => {
    expect(
      REVIEW_WORK_ITEM_SCHEMA.safeParse({
        workItemId: 'WI-1',
        semanticObservations: [
          {
            severity: 'WARNING',
            explanation: 'Inspect C:\\private\\source.ts before closing.',
            provenance: { source: 'AI_INFERRED' },
          },
        ],
        ...mutation,
      }).success,
    ).toBe(false);
    expect(
      CONSOLIDATE_DOSSIER_SCHEMA.safeParse({
        workItemId: 'WI-1',
        functionalOverview: {
          functionalFlow: ['Open https://internal.invalid/runbook'],
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
        provenance: { source: 'MANUAL', introducedBy: mutation.actor },
        ...mutation,
      }).success,
    ).toBe(false);
  });

  it.each([
    ['rallyId', 'C:\\private\\rally.txt'],
    ['title', 'Inspect /etc/passwd before starting.'],
    ['functionalDefinition', 'Open https://internal.invalid/runbook before starting.'],
  ] as const)('rejects unsafe create_work_item_v2 %s text', (field, value) => {
    expect(
      CREATE_WORK_ITEM_V2_INPUT_SCHEMA.safeParse({
        ...createWorkItemV2Input,
        [field]: value,
      }).success,
    ).toBe(false);
  });

  it.each([
    {
      name: 'iterationId',
      override: { iteration: { iterationId: 'C:\\private\\iteration' } },
    },
    {
      name: 'iteration displayName',
      override: {
        iteration: {
          iterationId: 'Iteration 1',
          displayName: 'Open https://internal.invalid/iteration',
        },
      },
    },
    {
      name: 'actor displayName',
      override: {
        actor: {
          participantId: 'dev:carlos',
          displayName: '/private/developer',
        },
      },
    },
  ])('rejects an unsafe create_work_item_v2 $name', ({ override }) => {
    expect(
      CREATE_WORK_ITEM_V2_INPUT_SCHEMA.safeParse({
        ...createWorkItemV2Input,
        ...override,
      }).success,
    ).toBe(false);
  });

  it('allows safe relative references in create_work_item_v2 semantic text', () => {
    expect(
      CREATE_WORK_ITEM_V2_INPUT_SCHEMA.safeParse({
        ...createWorkItemV2Input,
        title: 'Update src/application.ts',
        functionalDefinition: 'Keep docs/README.md aligned with the implementation.',
      }).success,
    ).toBe(true);
  });

  it('preserves safe relative technical references', () => {
    expect(
      SUSPEND_SESSION_SCHEMA.safeParse({
        workItemId: 'WI-1',
        observedWork: ['Updated src/application.ts.'],
        relevantContext: [],
        pendingQuestions: [],
        ...mutation,
      }).success,
    ).toBe(true);
  });
});
