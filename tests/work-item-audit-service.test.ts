import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { AUDIT_ARTIFACT_RELATIVE_PATHS, type TrackingType } from '../src/domain/work-item-audit.js';
import {
  AuditEntryNotFoundError,
  AuditIdempotencyConflictError,
  AuditRevisionConflictError,
  EvidenceReferenceDuplicateError,
  TestPlanConflictError,
  TestPlanRevisionConflictError,
} from '../src/errors/workspace-error.js';
import { LocalFilesystemWorkItemAuditRepository } from '../src/filesystem/local-filesystem-work-item-audit-repository.js';
import { LocalFilesystemWorkItemDossierRepository } from '../src/filesystem/local-filesystem-work-item-dossier-repository.js';
import { initializeWorkspace } from '../src/filesystem/workspace-initializer.js';
import { AIContextProjectionService } from '../src/services/ai-context-projection-service.js';
import { AuditContextSummaryService } from '../src/services/audit-context-summary-service.js';
import { AuditLedgerService } from '../src/services/audit-ledger-service.js';
import { AuditProjectionService } from '../src/services/audit-projection-service.js';
import type { Clock } from '../src/services/clock.js';
import { DocumentTemplateService } from '../src/services/document-template-service.js';
import type { IdGenerator } from '../src/services/id-generator.js';
import { M4ManifestInventoryService } from '../src/services/m4-manifest-inventory-service.js';
import { ManifestLifecycleService } from '../src/services/manifest-lifecycle-service.js';
import { WorkItemAuditService } from '../src/services/work-item-audit-service.js';
import { WorkItemCreationService } from '../src/services/work-item-creation-service.js';
import { WorkItemDocumentService } from '../src/services/work-item-document-service.js';
import { createTemporaryWorkspaceRoot, removeTemporaryWorkspaceRoot } from './helpers.js';

const temporaryRoots: string[] = [];

class IncrementingClock implements Clock {
  private calls = 0;

  public now(): string {
    const value = new Date(Date.UTC(2026, 6, 24, 12, 0, 0, this.calls));
    this.calls += 1;
    return value.toISOString();
  }
}

class SequenceIdGenerator implements IdGenerator {
  private value = 0;

  public generate(): string {
    this.value += 1;
    return `10000000-0000-4000-8000-${this.value.toString().padStart(12, '0')}`;
  }
}

interface Fixture {
  root: string;
  workItemId: string;
  dossierDirectory: string;
  audit: WorkItemAuditService;
  documents: WorkItemDocumentService;
  dossierRepository: LocalFilesystemWorkItemDossierRepository;
  workItemBeforeM4: string;
  aiContextBeforeM4: string;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(removeTemporaryWorkspaceRoot));
});

async function createFixture(): Promise<Fixture> {
  const root = await createTemporaryWorkspaceRoot();
  temporaryRoots.push(root);
  await initializeWorkspace(root);
  const created = await new WorkItemCreationService({ workspaceRoot: root }).create({
    type: 'TECHNICAL_TASK',
    rallyId: 'M4-SERVICE-1',
    title: 'Validate the Milestone 4 application service',
    functionalDefinition: 'Exercise M1 through M4 using real local adapters.',
    developmentAlias: 'm4-validation',
    relatedComponents: ['audit-ledger', 'local-repository'],
    startedAt: '2026-07-24',
  });
  const dossierRepository = new LocalFilesystemWorkItemDossierRepository({
    workspaceRoot: root,
  });
  const documents = new WorkItemDocumentService(
    dossierRepository,
    new DocumentTemplateService(),
    new ManifestLifecycleService(new IncrementingClock()),
    new AIContextProjectionService(),
  );
  await documents.initialize({ workItemId: created.id });

  const audit = new WorkItemAuditService(
    new LocalFilesystemWorkItemAuditRepository({ workspaceRoot: root }),
    new AuditLedgerService(new IncrementingClock(), new SequenceIdGenerator()),
    new AuditProjectionService(),
    new M4ManifestInventoryService(),
    new AuditContextSummaryService(),
  );
  const dossierDirectory = join(root, '.ws-workspace', 'active', created.id);
  const workItemBeforeM4 = await readFile(join(dossierDirectory, 'WORK_ITEM.yml'), 'utf8');
  const aiContextBeforeM4 = await readFile(
    join(dossierDirectory, 'context', 'AI_CONTEXT.md'),
    'utf8',
  );

  return {
    root,
    workItemId: created.id,
    dossierDirectory,
    audit,
    documents,
    dossierRepository,
    workItemBeforeM4,
    aiContextBeforeM4,
  };
}

async function expectM4DoesNotChangeWorkItemOrAiContext(fixture: Fixture): Promise<void> {
  await expect(readFile(join(fixture.dossierDirectory, 'WORK_ITEM.yml'), 'utf8')).resolves.toBe(
    fixture.workItemBeforeM4,
  );
  await expect(
    readFile(join(fixture.dossierDirectory, 'context', 'AI_CONTEXT.md'), 'utf8'),
  ).resolves.toBe(fixture.aiContextBeforeM4);
  await expect(fixture.dossierRepository.readWorkItem(fixture.workItemId)).resolves.toMatchObject({
    status: 'DRAFT',
  });
}

describe('WorkItemAuditService with the local M1-M4 stack', () => {
  it('initializes all five artifacts atomically and idempotently without changing M3 data', async () => {
    const fixture = await createFixture();

    const first = await fixture.audit.initialize({ workItemId: fixture.workItemId });
    const second = await fixture.audit.initialize({ workItemId: fixture.workItemId });

    expect(first).toEqual({
      workItemId: fixture.workItemId,
      auditRevision: 0,
      created: [...AUDIT_ARTIFACT_RELATIVE_PATHS],
      existing: [],
    });
    expect(second).toEqual({
      workItemId: fixture.workItemId,
      auditRevision: 0,
      created: [],
      existing: [...AUDIT_ARTIFACT_RELATIVE_PATHS],
    });
    for (const relativePath of AUDIT_ARTIFACT_RELATIVE_PATHS) {
      await expect(stat(join(fixture.dossierDirectory, relativePath))).resolves.toMatchObject({
        isFile: expect.any(Function),
      });
    }
    await expectM4DoesNotChangeWorkItemOrAiContext(fixture);
  });

  it('commits all five append operations, resolves an exact retry first, and returns four closed views', async () => {
    const fixture = await createFixture();
    await fixture.audit.initialize({ workItemId: fixture.workItemId });

    const evidenceRequest = {
      workItemId: fixture.workItemId,
      expectedAuditRevision: 0,
      idempotencyKey: 'evidence-service-1',
      label: 'Automated service result',
      description: 'Logical metadata only.',
      logicalPath: 'evidence/service/result.json',
      declaredActor: 'integration-test',
    };
    const evidence = await fixture.audit.registerEvidenceReference(evidenceRequest);
    const decisionRequest = {
      workItemId: fixture.workItemId,
      expectedAuditRevision: 1,
      idempotencyKey: 'decision-service-1',
      kind: 'DECISION',
      title: 'Use the structured audit ledger',
      decision: 'Persist audit entries in the M4 JSON ledger.',
      rationale: 'The frozen design requires one structured source of truth.',
      declaredActor: 'integration-test',
      evidenceReferenceIds: [evidence.evidenceReferenceId],
    };
    const decision = await fixture.audit.recordDecision(decisionRequest);
    const checkpoint = await fixture.audit.recordCheckpoint({
      workItemId: fixture.workItemId,
      expectedAuditRevision: 2,
      idempotencyKey: 'checkpoint-service-1',
      kind: 'PROGRESS',
      summary: 'The structured ledger and decision are persisted.',
      declaredActor: 'integration-test',
      relatedDecisionIds: [decision.decisionId],
      evidenceReferenceIds: [evidence.evidenceReferenceId],
    });
    const plan = await fixture.audit.defineTestPlan({
      workItemId: fixture.workItemId,
      expectedAuditRevision: 3,
      expectedPlanRevision: 0,
      idempotencyKey: 'plan-service-1',
      purpose: 'Validate the M4 application service.',
      declaredActor: 'integration-test',
      testCases: [
        {
          title: 'Run the integration flow',
          objective: 'Confirm all audit artifacts remain consistent.',
          verificationMethod: 'AUTOMATED',
          expectedOutcome: 'The execution passes.',
        },
      ],
    });
    const execution = await fixture.audit.recordTestExecution({
      workItemId: fixture.workItemId,
      expectedAuditRevision: 4,
      expectedPlanRevision: 1,
      idempotencyKey: 'execution-service-1',
      planId: plan.planId,
      planRevision: plan.planRevision,
      testCaseId: plan.testCases[0]!.testCaseId,
      executionMethod: 'AUTOMATED',
      outcome: 'PASSED',
      summary: 'The real local integration flow passed.',
      declaredActor: 'integration-test',
      evidenceReferenceIds: [evidence.evidenceReferenceId],
    });

    expect([
      evidence.auditRevision,
      decision.auditRevision,
      checkpoint.auditRevision,
      plan.auditRevision,
      execution.auditRevision,
    ]).toEqual([1, 2, 3, 4, 5]);

    const retry = await fixture.audit.recordDecision(decisionRequest);
    expect(retry).toEqual({ ...decision, idempotent: true });
    await expect(
      fixture.audit.recordDecision({
        ...decisionRequest,
        expectedAuditRevision: 999,
        title: 'A different payload for the same key',
      }),
    ).rejects.toBeInstanceOf(AuditIdempotencyConflictError);
    await expect(
      fixture.audit.recordCheckpoint({
        workItemId: fixture.workItemId,
        expectedAuditRevision: 1,
        idempotencyKey: 'checkpoint-stale',
        kind: 'PROGRESS',
        summary: 'This stale mutation must not be persisted.',
        declaredActor: 'integration-test',
      }),
    ).rejects.toBeInstanceOf(AuditRevisionConflictError);

    const trackingTypes: TrackingType[] = [
      'DECISIONS',
      'CHECKPOINTS',
      'TESTING',
      'EVIDENCE_REFERENCES',
    ];
    const views = [];
    for (const trackingType of trackingTypes) {
      views.push(await fixture.audit.getTracking({ workItemId: fixture.workItemId, trackingType }));
    }
    expect(views.map((view) => view.auditRevision)).toEqual([5, 5, 5, 5]);
    expect(views[0]!.content).toContain('Use the structured audit ledger');
    expect(views[1]!.content).toContain('structured ledger and decision');
    expect(views[2]!.content).toContain('Run the integration flow');
    expect(views[2]!.content).toContain('PASSED');
    expect(views[3]!.content).toContain('Automated service result');
    expect(JSON.stringify(views)).not.toContain(fixture.root);
    await expectM4DoesNotChangeWorkItemOrAiContext(fixture);
  });

  it('enforces relationships, one logical plan, active versions, and unique evidence paths', async () => {
    const fixture = await createFixture();
    await fixture.audit.initialize({ workItemId: fixture.workItemId });
    const evidence = await fixture.audit.registerEvidenceReference({
      workItemId: fixture.workItemId,
      expectedAuditRevision: 0,
      idempotencyKey: 'evidence-relations-1',
      label: 'Relation evidence',
      logicalPath: 'evidence/relations.txt',
      declaredActor: 'integration-test',
    });

    await expect(
      fixture.audit.registerEvidenceReference({
        workItemId: fixture.workItemId,
        expectedAuditRevision: 1,
        idempotencyKey: 'evidence-relations-2',
        label: 'Duplicate relation evidence',
        logicalPath: 'evidence\\relations.txt',
        declaredActor: 'integration-test',
      }),
    ).rejects.toBeInstanceOf(EvidenceReferenceDuplicateError);
    await expect(
      fixture.audit.recordDecision({
        workItemId: fixture.workItemId,
        expectedAuditRevision: 1,
        idempotencyKey: 'decision-missing-evidence',
        kind: 'DECISION',
        title: 'Invalid relation',
        decision: 'This entry must not be stored.',
        rationale: 'Its evidence reference does not exist.',
        declaredActor: 'integration-test',
        evidenceReferenceIds: ['00000000-0000-4000-8000-000000009999'],
      }),
    ).rejects.toBeInstanceOf(AuditEntryNotFoundError);

    const decision = await fixture.audit.recordDecision({
      workItemId: fixture.workItemId,
      expectedAuditRevision: 1,
      idempotencyKey: 'decision-relations-1',
      kind: 'DECISION',
      title: 'Initial decision',
      decision: 'Use the first plan version.',
      rationale: 'It establishes an auditable baseline.',
      declaredActor: 'integration-test',
      evidenceReferenceIds: [evidence.evidenceReferenceId],
    });
    await fixture.audit.recordDecision({
      workItemId: fixture.workItemId,
      expectedAuditRevision: 2,
      idempotencyKey: 'decision-relations-2',
      kind: 'CORRECTION',
      title: 'Clarified decision',
      decision: 'Use immutable plan versions.',
      rationale: 'The clarification keeps the original decision.',
      declaredActor: 'integration-test',
      relatedDecisionId: decision.decisionId,
    });
    const checkpoint = await fixture.audit.recordCheckpoint({
      workItemId: fixture.workItemId,
      expectedAuditRevision: 3,
      idempotencyKey: 'checkpoint-relations-1',
      kind: 'RISK',
      summary: 'The first plan may require refinement.',
      declaredActor: 'integration-test',
      relatedDecisionIds: [decision.decisionId],
    });
    await fixture.audit.recordCheckpoint({
      workItemId: fixture.workItemId,
      expectedAuditRevision: 4,
      idempotencyKey: 'checkpoint-relations-2',
      kind: 'PROGRESS',
      summary: 'The plan refinement is ready.',
      declaredActor: 'integration-test',
      correctsCheckpointId: checkpoint.checkpointId,
    });
    const plan1 = await fixture.audit.defineTestPlan({
      workItemId: fixture.workItemId,
      expectedAuditRevision: 5,
      expectedPlanRevision: 0,
      idempotencyKey: 'plan-relations-1',
      purpose: 'Validate the initial behavior.',
      declaredActor: 'integration-test',
      testCases: [
        {
          title: 'Initial case',
          objective: 'Exercise revision one.',
          verificationMethod: 'MANUAL',
          expectedOutcome: 'Revision one is traceable.',
        },
      ],
    });

    await expect(
      fixture.audit.defineTestPlan({
        workItemId: fixture.workItemId,
        expectedAuditRevision: 6,
        expectedPlanRevision: 1,
        idempotencyKey: 'plan-without-id',
        purpose: 'Attempt a second logical plan.',
        declaredActor: 'integration-test',
        testCases: [
          {
            title: 'Invalid second plan',
            objective: 'This must be rejected.',
            verificationMethod: 'MANUAL',
            expectedOutcome: 'The request fails.',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(TestPlanConflictError);
    await expect(
      fixture.audit.defineTestPlan({
        workItemId: fixture.workItemId,
        expectedAuditRevision: 6,
        expectedPlanRevision: 0,
        idempotencyKey: 'plan-stale-version',
        planId: plan1.planId,
        purpose: 'Use a stale plan revision.',
        declaredActor: 'integration-test',
        testCases: [
          {
            title: 'Stale plan case',
            objective: 'This must be rejected.',
            verificationMethod: 'MANUAL',
            expectedOutcome: 'The request fails.',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(TestPlanRevisionConflictError);

    const plan2 = await fixture.audit.defineTestPlan({
      workItemId: fixture.workItemId,
      expectedAuditRevision: 6,
      expectedPlanRevision: 1,
      idempotencyKey: 'plan-relations-2',
      planId: plan1.planId,
      purpose: 'Validate the refined behavior.',
      declaredActor: 'integration-test',
      testCases: [
        {
          title: 'Active case',
          objective: 'Exercise revision two.',
          verificationMethod: 'AUTOMATED',
          expectedOutcome: 'Revision two is active.',
        },
      ],
    });
    expect(plan2).toMatchObject({ planId: plan1.planId, planRevision: 2, auditRevision: 7 });

    await expect(
      fixture.audit.recordTestExecution({
        workItemId: fixture.workItemId,
        expectedAuditRevision: 7,
        expectedPlanRevision: 1,
        idempotencyKey: 'execution-old-plan',
        planId: plan1.planId,
        planRevision: 1,
        testCaseId: plan1.testCases[0]!.testCaseId,
        executionMethod: 'MANUAL',
        outcome: 'PASSED',
        summary: 'A superseded plan cannot receive a new execution.',
        declaredActor: 'integration-test',
      }),
    ).rejects.toBeInstanceOf(TestPlanRevisionConflictError);
    const activeExecution = await fixture.audit.recordTestExecution({
      workItemId: fixture.workItemId,
      expectedAuditRevision: 7,
      expectedPlanRevision: 2,
      idempotencyKey: 'execution-active-plan',
      planId: plan2.planId,
      planRevision: 2,
      testCaseId: plan2.testCases[0]!.testCaseId,
      executionMethod: 'AUTOMATED',
      outcome: 'PASSED',
      summary: 'The active version executed successfully.',
      declaredActor: 'integration-test',
    });
    expect(activeExecution).toMatchObject({ auditRevision: 8, idempotent: false });

    const testing = await fixture.audit.getTracking({
      workItemId: fixture.workItemId,
      trackingType: 'TESTING',
    });
    expect(testing.auditRevision).toBe(8);
    expect(testing.content).toContain('Plan revision 2');
    expect(testing.content).toContain('Plan revision 1');
    expect(testing.content).toContain('The active version executed successfully');
    await expectM4DoesNotChangeWorkItemOrAiContext(fixture);
  });
});
