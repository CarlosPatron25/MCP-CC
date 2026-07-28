import { describe, expect, it } from 'vitest';

import type {
  AppendKnowledgeOperationRequest,
  KnowledgeActor,
  KnowledgeBaseLedger,
  KnowledgeEventInput,
  KnowledgeOperationName,
  KnowledgeProvenance,
  ParticipantRef,
  TechnicalSnapshot,
} from '../src/domain/work-item-knowledge.js';
import type { Clock } from '../src/services/clock.js';
import type { IdGenerator } from '../src/services/id-generator.js';
import {
  KnowledgeBaseLedgerError,
  KnowledgeBaseLedgerService,
} from '../src/services/knowledge-base-ledger-service.js';

function uuid(sequence: number): string {
  return `10000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`;
}

class SequentialClock implements Clock {
  private nextSecond = 0;

  public now(): string {
    const value = new Date(Date.UTC(2026, 6, 28, 12, 0, this.nextSecond));
    this.nextSecond += 1;
    return value.toISOString();
  }
}

class SequentialIdGenerator implements IdGenerator {
  private nextIdentity = 1;

  public generate(): string {
    const value = `20000000-0000-4000-8000-${this.nextIdentity.toString(16).padStart(12, '0')}`;
    this.nextIdentity += 1;
    return value;
  }
}

const owner: ParticipantRef = {
  participantId: 'developer:owner',
  displayName: 'Owner Developer',
};
const collaborator: ParticipantRef = {
  participantId: 'developer:collaborator',
  displayName: 'Collaborating Developer',
};
const reviewer: ParticipantRef = {
  participantId: 'developer:reviewer',
  displayName: 'Review Developer',
};

function manual(actor: ParticipantRef = owner): KnowledgeProvenance {
  return { source: 'MANUAL', introducedBy: actor };
}

function calculated(): KnowledgeProvenance {
  return { source: 'SYSTEM_CALCULATED' };
}

function confirmed(
  actor: ParticipantRef = owner,
  basedOnKnowledgeIds?: string[],
): KnowledgeProvenance {
  return {
    source: 'HUMAN_CONFIRMED',
    confirmedBy: actor,
    ...(basedOnKnowledgeIds === undefined ? {} : { basedOnKnowledgeIds }),
  };
}

function workflowEvent(
  workItemId: string,
  responsible: ParticipantRef = owner,
): KnowledgeEventInput {
  return {
    eventType: 'WORKFLOW_INITIALIZED',
    provenance: manual(responsible),
    payload: {
      workItemId,
      iteration: {
        iterationId: 'Iteration 91',
        displayName: 'Iteration 91',
        storageToken: 'iteration-091',
      },
      responsible,
      classification: 'STANDARD',
      initialStatus: 'IN_PROGRESS',
    },
  };
}

function snapshot(
  snapshotId: string,
  sessionId: string,
  kind: TechnicalSnapshot['kind'],
  capturedAt = '2026-07-28T12:30:00.000Z',
): TechnicalSnapshot {
  return {
    snapshotId,
    sessionId,
    kind,
    capturedAt,
    files: [
      {
        relativePath: 'src/example.ts',
        sha256: 'a'.repeat(64),
        size: 42,
        modifiedAt: '2026-07-28T12:29:00.000Z',
      },
    ],
    changes: [
      {
        relativePath: 'src/example.ts',
        changeType: kind === 'ACTIVATION' ? 'UNCHANGED' : 'MODIFIED',
        previousSha256: 'a'.repeat(64),
        currentSha256: kind === 'ACTIVATION' ? 'a'.repeat(64) : 'b'.repeat(64),
      },
    ],
    git: { available: false },
    exclusions: [{ relativePath: 'node_modules', reason: 'EXCLUDED_DIRECTORY' }],
    totalBytes: 42,
  };
}

function createHarness(): KnowledgeBaseLedgerService {
  return new KnowledgeBaseLedgerService(new SequentialClock(), new SequentialIdGenerator());
}

function append(
  service: KnowledgeBaseLedgerService,
  ledger: KnowledgeBaseLedger,
  operation: KnowledgeOperationName,
  idempotencySequence: number,
  events: KnowledgeEventInput[],
  actor: KnowledgeActor = owner,
  fingerprintPayload?: unknown,
): KnowledgeBaseLedger {
  return service.appendOperation(
    ledger,
    {
      expectedKnowledgeRevision: ledger.knowledgeRevision,
      idempotencyKey: uuid(idempotencySequence),
      operation,
      actor,
      events,
    },
    fingerprintPayload,
  ).ledger;
}

describe('KnowledgeBaseLedgerService', () => {
  it('creates, serializes, and parses the strict empty ledger deterministically', () => {
    const service = createHarness();
    const empty = service.createEmptyLedger();

    expect(empty).toEqual({
      schemaVersion: '1.0.0',
      knowledgeRevision: 0,
      updatedAt: '2026-07-28T12:00:00.000Z',
      operations: [],
      idempotencyIndex: [],
    });

    const serialized = service.serialize(empty);
    expect(serialized.endsWith('\n')).toBe(true);
    expect(service.parse(serialized)).toEqual(empty);
    expect(service.serialize(service.parse(serialized))).toBe(serialized);
  });

  it('rejects unknown fields and corrupted revision, index, or event payload state', () => {
    const service = createHarness();
    const initialized = append(
      service,
      service.createEmptyLedger(),
      'initialize_work_item_workflow',
      1,
      [workflowEvent('WI-1')],
    );

    const unknownTopLevel = JSON.parse(service.serialize(initialized)) as Record<string, unknown>;
    unknownTopLevel.unexpected = true;
    expect(() => service.parse(JSON.stringify(unknownTopLevel))).toThrow(KnowledgeBaseLedgerError);

    const badRevision = structuredClone(initialized);
    badRevision.knowledgeRevision = 2;
    expect(() => service.validate(badRevision)).toThrow(
      expect.objectContaining({ code: 'WORKFLOW_CORRUPT' }),
    );

    const badIndex = structuredClone(initialized);
    badIndex.idempotencyIndex[0]!.operationId = uuid(999);
    expect(() => service.validate(badIndex)).toThrow(
      expect.objectContaining({ code: 'WORKFLOW_CORRUPT' }),
    );

    const unknownPayload = JSON.parse(service.serialize(initialized)) as {
      operations: Array<{ events: Array<{ payload: Record<string, unknown> }> }>;
    };
    unknownPayload.operations[0]!.events[0]!.payload.unexpected = true;
    expect(() => service.parse(JSON.stringify(unknownPayload))).toThrow(
      expect.objectContaining({ code: 'WORKFLOW_CORRUPT' }),
    );
  });

  it('replays initialized workflows and resolves an exact retry before a stale revision', () => {
    const service = createHarness();
    const empty = service.createEmptyLedger();
    const firstRequest: AppendKnowledgeOperationRequest = {
      expectedKnowledgeRevision: 0,
      idempotencyKey: uuid(10),
      operation: 'initialize_work_item_workflow',
      actor: owner,
      events: [workflowEvent('WI-1')],
    };
    const first = service.appendOperation(empty, firstRequest, { workItemId: 'WI-1' });
    const secondLedger = append(service, first.ledger, 'initialize_work_item_workflow', 11, [
      workflowEvent('WI-2', reviewer),
    ]);

    const retry = service.appendOperation(
      secondLedger,
      {
        ...firstRequest,
        events: [workflowEvent('WI-1')],
      },
      { workItemId: 'WI-1' },
    );

    expect(retry.idempotent).toBe(true);
    expect(retry.ledger).toMatchObject({
      knowledgeRevision: 1,
      operations: [first.knowledgeOperation],
    });
    expect(retry.knowledgeOperation).toEqual(first.knowledgeOperation);
    expect(service.projectState(secondLedger).workItems).toMatchObject([
      { workItemId: 'WI-1', status: 'IN_PROGRESS', responsible: owner },
      { workItemId: 'WI-2', status: 'IN_PROGRESS', responsible: reviewer },
    ]);

    expect(() =>
      service.appendOperation(secondLedger, firstRequest, { workItemId: 'a-different-work-item' }),
    ).toThrow(expect.objectContaining({ code: 'WORKFLOW_IDEMPOTENCY_CONFLICT' }));

    expect(() =>
      service.appendOperation(secondLedger, {
        ...firstRequest,
        idempotencyKey: uuid(12),
      }),
    ).toThrow(expect.objectContaining({ code: 'WORKFLOW_REVISION_CONFLICT' }));
  });

  it('replays a session with deterministic snapshots and an append-only checkpoint', () => {
    const service = createHarness();
    let ledger = append(service, service.createEmptyLedger(), 'initialize_work_item_workflow', 20, [
      workflowEvent('WI-SESSION'),
    ]);
    const sessionId = uuid(200);
    const activationSnapshotId = uuid(201);
    ledger = append(service, ledger, 'activate_work_session', 21, [
      {
        eventType: 'TECHNICAL_SNAPSHOT_RECORDED',
        provenance: calculated(),
        payload: { snapshot: snapshot(activationSnapshotId, sessionId, 'ACTIVATION') },
      },
      {
        eventType: 'SESSION_ACTIVATED',
        provenance: manual(),
        payload: {
          sessionId,
          developer: owner,
          workItemId: 'WI-SESSION',
          activationSnapshotId,
        },
      },
    ]);

    const checkpointSnapshotId = uuid(202);
    const checkpointId = uuid(203);
    ledger = append(service, ledger, 'record_session_checkpoint', 22, [
      {
        eventType: 'TECHNICAL_SNAPSHOT_RECORDED',
        provenance: calculated(),
        payload: { snapshot: snapshot(checkpointSnapshotId, sessionId, 'CHECKPOINT') },
      },
      {
        eventType: 'SESSION_CHECKPOINT_RECORDED',
        provenance: {
          source: 'AI_INFERRED',
          introducedBy: owner,
          evidenceReferenceIds: [uuid(204)],
        },
        payload: {
          checkpointId,
          sessionId,
          workItemId: 'WI-SESSION',
          snapshotId: checkpointSnapshotId,
          kind: 'MANUAL',
          observedWork: ['Implementation changed deterministically.'],
          relevantContext: ['The current session owns the observed work.'],
          pendingQuestions: ['Confirm the final regression scenario.'],
          semanticSummary: 'Checkpoint proposed by the host.',
        },
      },
    ]);

    const state = service.projectState(ledger);
    expect(state.snapshots).toHaveLength(2);
    expect(state.checkpoints).toHaveLength(1);
    expect(state.sessions).toEqual([
      expect.objectContaining({
        sessionId,
        status: 'ACTIVE',
        activationSnapshotId,
        lastCheckpointId: checkpointId,
      }),
    ]);
    expect(state.checkpoints[0]?.provenance).toMatchObject({
      source: 'AI_INFERRED',
      introducedBy: owner,
      evidenceReferenceIds: [uuid(204)],
    });
  });

  it('replays collaborators, responsibility transfer, and a semantic Work Item relation', () => {
    const service = createHarness();
    let ledger = append(service, service.createEmptyLedger(), 'initialize_work_item_workflow', 30, [
      workflowEvent('WI-A'),
    ]);
    ledger = append(
      service,
      ledger,
      'initialize_work_item_workflow',
      31,
      [workflowEvent('WI-B', reviewer)],
      reviewer,
    );
    ledger = append(service, ledger, 'add_work_item_collaborator', 32, [
      {
        eventType: 'COLLABORATOR_ADDED',
        provenance: manual(),
        payload: { workItemId: 'WI-A', collaborator },
      },
    ]);
    ledger = append(service, ledger, 'transfer_work_item_responsibility', 33, [
      {
        eventType: 'RESPONSIBILITY_TRANSFERRED',
        provenance: confirmed(),
        payload: {
          workItemId: 'WI-A',
          previousResponsibleId: owner.participantId,
          newResponsible: collaborator,
          reason: 'The collaborator now owns final delivery.',
          confirmation: true,
        },
      },
    ]);
    const relationId = uuid(300);
    ledger = append(
      service,
      ledger,
      'add_work_item_relation',
      34,
      [
        {
          eventType: 'RELATION_ADDED',
          provenance: manual(collaborator),
          payload: {
            relationId,
            relationType: 'DEPENDS_ON',
            sourceWorkItemId: 'WI-A',
            targetWorkItemId: 'WI-B',
            explanation: 'WI-A consumes the behavior delivered by WI-B.',
            evidenceReferenceIds: [uuid(301)],
          },
        },
      ],
      collaborator,
    );

    const state = service.projectState(ledger);
    expect(state.workItems.find((item) => item.workItemId === 'WI-A')).toMatchObject({
      responsible: collaborator,
      collaborators: [],
      responsibilityHistory: [
        expect.objectContaining({
          previousResponsible: owner,
          newResponsible: collaborator,
          actor: owner,
        }),
      ],
    });
    expect(state.relations).toEqual([
      expect.objectContaining({
        relationId,
        relationType: 'DEPENDS_ON',
        sourceWorkItemId: 'WI-A',
        targetWorkItemId: 'WI-B',
        status: 'ACTIVE',
        provenance: manual(collaborator),
      }),
    ]);
  });

  it('keeps rejected proposals out of the catalog and approves a later proposal atomically', () => {
    const service = createHarness();
    let ledger = append(service, service.createEmptyLedger(), 'initialize_work_item_workflow', 40, [
      workflowEvent('WI-CONCEPT'),
    ]);
    const rejectedProposalId = uuid(400);
    ledger = append(service, ledger, 'propose_project_concept', 41, [
      {
        eventType: 'CONCEPT_PROPOSED',
        provenance: manual(),
        payload: {
          proposalId: rejectedProposalId,
          workItemId: 'WI-CONCEPT',
          normalizedName: 'authentication',
          displayName: 'Authentication',
          explanation: 'The initial evidence is insufficient.',
          evidenceReferenceIds: [uuid(401)],
          evidenceFingerprint: 'c'.repeat(64),
          proposedBy: owner,
        },
      },
    ]);
    ledger = append(service, ledger, 'resolve_project_concept_proposal', 42, [
      {
        eventType: 'CONCEPT_PROPOSAL_RESOLVED',
        provenance: confirmed(),
        payload: {
          proposalId: rejectedProposalId,
          resolution: 'REJECTED',
          resolvedBy: owner,
          resolutionReason: 'More evidence is required.',
          confirmation: false,
        },
      },
    ]);
    expect(service.projectState(ledger)).toMatchObject({
      conceptProposals: [{ proposalId: rejectedProposalId, status: 'REJECTED' }],
      concepts: [],
    });

    const approvedProposalId = uuid(402);
    ledger = append(service, ledger, 'propose_project_concept', 43, [
      {
        eventType: 'CONCEPT_PROPOSED',
        provenance: manual(),
        payload: {
          proposalId: approvedProposalId,
          workItemId: 'WI-CONCEPT',
          normalizedName: 'authentication',
          displayName: 'Authentication',
          explanation: 'New test evidence confirms a stable project concept.',
          evidenceReferenceIds: [uuid(403)],
          evidenceFingerprint: 'd'.repeat(64),
          proposedBy: owner,
        },
      },
    ]);
    ledger = append(service, ledger, 'resolve_project_concept_proposal', 44, [
      {
        eventType: 'CONCEPT_PROPOSAL_RESOLVED',
        provenance: confirmed(),
        payload: {
          proposalId: approvedProposalId,
          resolution: 'APPROVED',
          resolvedBy: owner,
          resolutionReason: 'The new evidence is sufficient.',
          confirmation: true,
        },
      },
    ]);

    const state = service.projectState(ledger);
    expect(state.conceptProposals.map((proposal) => proposal.status)).toEqual([
      'REJECTED',
      'APPROVED',
    ]);
    expect(state.concepts).toEqual([
      expect.objectContaining({
        normalizedName: 'authentication',
        approvedProposalId,
        approvedBy: owner,
      }),
    ]);
    expect(state.catalogRevision).toBe(4);
  });

  it('replays consolidation, review, completion, semantic provenance, and reopening', () => {
    const service = createHarness();
    let ledger = append(service, service.createEmptyLedger(), 'initialize_work_item_workflow', 50, [
      workflowEvent('WI-LIFECYCLE'),
    ]);
    ledger = append(service, ledger, 'consolidate_work_item_dossier', 51, [
      {
        eventType: 'KNOWLEDGE_CONSOLIDATED',
        provenance: manual(),
        payload: {
          consolidation: {
            consolidationId: uuid(500),
            workItemId: 'WI-LIFECYCLE',
            functionalOverview: {
              purpose: 'Provide a resumable assisted workflow.',
              actualBehavior: 'The workflow persists confirmed knowledge.',
              functionalFlow: ['Activate.', 'Work.', 'Checkpoint.'],
              entryConditions: ['The workflow is initialized.'],
              businessRules: ['Only the responsible confirms completion.'],
              testData: ['A temporary Work Item.'],
              relatedWorkItemIds: [],
            },
            implementation: {
              components: [
                {
                  name: 'Knowledge ledger',
                  type: 'TypeScript service',
                  responsibility: 'Preserve append-only workflow knowledge.',
                  changes: ['Add strict replay.'],
                },
              ],
              dependencies: ['M4 audit remains separate.'],
              implementationDecisions: ['Use one M5 workspace ledger.'],
              technicalFlow: ['Validate.', 'Append.', 'Replay.'],
            },
            testing: {
              preconditions: ['An initialized workflow.'],
              testData: ['Deterministic identities.'],
              scenarios: [
                {
                  title: 'Complete and reopen',
                  steps: ['Review.', 'Complete.', 'Reopen.'],
                  expectedOutcome: 'History remains append-only.',
                },
              ],
              regressionChecks: ['M1-M4.1 remain available.'],
              evidenceReferenceIds: [uuid(501)],
              closureChecklist: ['Structural review passed.'],
            },
          },
        },
      },
    ]);

    const observationId = uuid(502);
    const reviewId = uuid(503);
    ledger = append(service, ledger, 'review_work_item', 52, [
      {
        eventType: 'SEMANTIC_OBSERVATION_RECORDED',
        provenance: {
          source: 'AI_INFERRED',
          introducedBy: reviewer,
          evidenceReferenceIds: [uuid(504)],
        },
        payload: {
          observationId,
          workItemId: 'WI-LIFECYCLE',
          severity: 'WARNING',
          explanation: 'The host suggests an additional regression note.',
          evidenceReferenceIds: [uuid(504)],
        },
      },
      {
        eventType: 'STRUCTURAL_REVIEW_RECORDED',
        provenance: calculated(),
        payload: {
          reviewId,
          workItemId: 'WI-LIFECYCLE',
          result: 'PASSED',
          findings: [],
        },
      },
    ]);
    const reviewKnowledgeId = ledger.operations.at(-1)!.events.at(-1)!.eventId;
    ledger = append(service, ledger, 'complete_work_item', 53, [
      {
        eventType: 'WORK_ITEM_COMPLETED',
        provenance: confirmed(owner, [reviewKnowledgeId]),
        payload: {
          workItemId: 'WI-LIFECYCLE',
          responsibleId: owner.participantId,
          structuralReviewId: reviewId,
          historicalMutationBoundary: {
            m3DocumentRevisions: {
              MANIFEST: 1,
              FUNCTIONAL_ANALYSIS: 1,
              CURRENT_STATE: 1,
              TECHNICAL_ANALYSIS: 1,
              IMPACT_ANALYSIS: 1,
              IMPLEMENTATION_PLAN: 1,
              AI_CONTEXT: 1,
            },
            m4AuditRevision: 0,
          },
          confirmation: true,
        },
      },
    ]);
    expect(service.projectState(ledger)).toMatchObject({
      workItems: [
        {
          workItemId: 'WI-LIFECYCLE',
          status: 'COMPLETED',
          latestConsolidation: { consolidationId: uuid(500) },
          latestStructuralReview: { reviewId, result: 'PASSED' },
        },
      ],
      semanticObservations: [
        {
          observationId,
          status: 'OPEN',
          provenance: { source: 'AI_INFERRED', introducedBy: reviewer },
        },
      ],
    });

    ledger = append(service, ledger, 'reopen_work_item', 54, [
      {
        eventType: 'WORK_ITEM_REOPENED',
        provenance: confirmed(),
        payload: {
          workItemId: 'WI-LIFECYCLE',
          reason: 'A confirmed follow-up change is required.',
          trigger: 'reopen_work_item',
          explicit: true,
          confirmation: true,
        },
      },
    ]);
    expect(service.projectState(ledger).workItems[0]).toMatchObject({
      status: 'IN_PROGRESS',
      completedAt: expect.any(String),
      lastReopenedAt: expect.any(String),
    });
  });
});
