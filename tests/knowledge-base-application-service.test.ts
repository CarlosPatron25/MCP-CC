import { describe, expect, it } from 'vitest';

import type { WorkItem } from '../src/domain/work-item.js';
import type { ManagedDocumentType } from '../src/domain/work-item-document.js';
import type {
  KnowledgeBaseLedger,
  KnowledgeBaseState,
  ParticipantRef,
} from '../src/domain/work-item-knowledge.js';
import type { TechnicalSnapshotObservation } from '../src/domain/technical-snapshot.js';
import { parsePersistedWorkItem } from '../src/filesystem/local-filesystem-work-item-dossier-repository.js';
import { KnowledgeBaseApplicationService } from '../src/services/knowledge-base-application-service.js';
import { KnowledgeBaseLedgerService } from '../src/services/knowledge-base-ledger-service.js';
import type {
  KnowledgeBaseCommit,
  KnowledgeBaseRepository,
  KnowledgeBaseRepositoryDecision,
  KnowledgeBaseRepositorySnapshot,
  KnowledgeDossierSnapshot,
} from '../src/services/knowledge-base-repository.js';
import { M5ProjectionService } from '../src/services/m5-projection-service.js';
import type { Clock } from '../src/services/clock.js';
import type { IdGenerator } from '../src/services/id-generator.js';
import {
  ManifestSectionCompositor,
  parseDocumentLifecycleInventorySection,
} from '../src/services/manifest-section-compositor.js';
import type { ProjectObservation } from '../src/services/project-observation.js';
import { ManifestLifecycleService } from '../src/services/manifest-lifecycle-service.js';
import { M4ManifestInventoryService } from '../src/services/m4-manifest-inventory-service.js';
import { serializeWorkItemYml } from '../src/services/work-item-creation-service.js';

const owner: ParticipantRef = {
  participantId: 'developer:owner',
  displayName: 'Owner Developer',
};

const collaborator: ParticipantRef = {
  participantId: 'developer:collaborator',
  displayName: 'Collaborating Developer',
};

const successor: ParticipantRef = {
  participantId: 'developer:successor',
  displayName: 'Successor Developer',
};

const baseManifest = [
  '# Manifiesto del Work Item',
  '',
  '<!-- WS-WORKSPACE-MCP:DOCUMENT_RENDERING_SNAPSHOT schemaVersion=1.0.0 documentLanguage=es-ES renderingProfile=ES_ES_V1 -->',
  '',
].join('\n');
const inventoryTimestamp = '2026-07-28T08:00:00.000Z';
const manifestLifecycle = new ManifestLifecycleService({ now: () => inventoryTimestamp });
const manifestWithM3 = manifestLifecycle.render(
  baseManifest,
  manifestLifecycle.createInitialMetadata(),
);
const m4ManifestInventory = new M4ManifestInventoryService();
const manifest = m4ManifestInventory.render(
  manifestWithM3,
  m4ManifestInventory.createInitialInventory(inventoryTimestamp),
);

function uuid(prefix: string, sequence: number): string {
  return `${prefix}0000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`;
}

function idempotencyKey(sequence: number): string {
  return uuid('9', sequence);
}

class SequentialClock implements Clock {
  private nextSecond = 0;

  public now(): string {
    const timestamp = new Date(Date.UTC(2026, 6, 28, 10, 0, this.nextSecond));
    this.nextSecond += 1;
    return timestamp.toISOString();
  }
}

class SequentialIdGenerator implements IdGenerator {
  private nextIdentity = 1;

  public generate(): string {
    const value = uuid('8', this.nextIdentity);
    this.nextIdentity += 1;
    return value;
  }
}

class SequentialProjectObservation implements ProjectObservation {
  public captures = 0;

  public async capture(): Promise<TechnicalSnapshotObservation> {
    this.captures += 1;
    const sha256 = this.captures.toString(16).padStart(64, '0');
    return {
      files: [
        {
          relativePath: 'src/application.ts',
          sha256,
          size: 100 + this.captures,
          modifiedAt: new Date(Date.UTC(2026, 6, 28, 9, 0, this.captures)).toISOString(),
        },
      ],
      exclusions: [
        {
          relativePath: 'node_modules',
          reason: 'EXCLUDED_DIRECTORY',
        },
      ],
      totalBytes: 100 + this.captures,
      git: { available: false },
    };
  }
}

interface StoredDossier {
  snapshot: KnowledgeDossierSnapshot;
  artifacts: Map<string, string>;
}

function cloneStoredDossiers(
  dossiers: ReadonlyMap<string, StoredDossier>,
): Map<string, StoredDossier> {
  return new Map(
    [...dossiers].map(([workItemId, dossier]) => [
      workItemId,
      {
        snapshot: {
          ...dossier.snapshot,
          workItem: structuredClone(dossier.snapshot.workItem),
          existingM5Artifacts: new Set(dossier.snapshot.existingM5Artifacts),
          m5Artifacts: new Map(dossier.snapshot.m5Artifacts),
        },
        artifacts: new Map(dossier.artifacts),
      },
    ]),
  );
}

class InMemoryKnowledgeBaseRepository implements KnowledgeBaseRepository {
  public ledgerContent: string | undefined;
  public commitCount = 0;
  public readonly snapshotRequests: string[][] = [];
  private dossiers: Map<string, StoredDossier>;

  public constructor(workItems: readonly WorkItem[]) {
    this.dossiers = new Map(
      workItems.map((workItem) => [
        workItem.id,
        {
          snapshot: {
            workItem: structuredClone(workItem),
            workItemYml: serializeWorkItemYml(workItem),
            manifest,
            dossierRelativePath: `active/Iteration_91/${workItem.type}/${workItem.id}`,
            existingM5Artifacts: new Set<string>(),
            m5Artifacts: new Map<string, string>(),
          },
          artifacts: new Map<string, string>(),
        },
      ]),
    );
  }

  public async withSnapshot<Result>(
    affectedWorkItemIds: readonly string[],
    decide: (
      snapshot: KnowledgeBaseRepositorySnapshot,
    ) => Promise<KnowledgeBaseRepositoryDecision<Result>> | KnowledgeBaseRepositoryDecision<Result>,
  ): Promise<Result> {
    this.snapshotRequests.push([...affectedWorkItemIds]);
    const decision = await decide(this.createSnapshot(this.ledgerContent, this.dossiers));
    if (decision.commit !== undefined) {
      this.applyCommit(decision.commit);
    }
    return decision.result;
  }

  public dossier(workItemId: string): KnowledgeDossierSnapshot {
    const dossier = this.dossiers.get(workItemId);
    if (dossier === undefined) {
      throw new Error('The test dossier does not exist.');
    }
    return dossier.snapshot;
  }

  public artifact(workItemId: string, relativePath: string): string | undefined {
    return this.dossiers.get(workItemId)?.artifacts.get(relativePath);
  }

  public dossierPaths(): string[] {
    return [...this.dossiers.values()]
      .map((dossier) => dossier.snapshot.dossierRelativePath)
      .sort();
  }

  public deleteArtifact(workItemId: string, relativePath: string): void {
    const dossier = this.dossiers.get(workItemId);
    if (dossier === undefined) {
      throw new Error('The test dossier does not exist.');
    }
    dossier.artifacts.delete(relativePath);
    const existingM5Artifacts = new Set(dossier.snapshot.existingM5Artifacts);
    existingM5Artifacts.delete(relativePath);
    const m5Artifacts = new Map(dossier.snapshot.m5Artifacts);
    m5Artifacts.delete(relativePath);
    dossier.snapshot = {
      ...dossier.snapshot,
      existingM5Artifacts,
      m5Artifacts,
    };
  }

  public advanceDocumentRevision(workItemId: string, documentType: ManagedDocumentType): number {
    const dossier = this.dossiers.get(workItemId);
    if (dossier === undefined) {
      throw new Error('The test dossier does not exist.');
    }
    const section = new ManifestSectionCompositor().parse(
      dossier.snapshot.manifest,
    ).documentLifecycle;
    if (section === undefined) {
      throw new Error('The test dossier has no M3 lifecycle inventory.');
    }
    const metadata = parseDocumentLifecycleInventorySection(section.content);
    const nextMetadata = metadata.map((entry) => {
      if (entry.documentType === documentType) {
        return manifestLifecycle.nextDocumentMetadata(entry, 'SUPPLIED');
      }
      if (entry.documentType === 'MANIFEST') {
        return manifestLifecycle.nextManifestMetadata(entry);
      }
      return entry;
    });
    dossier.snapshot = {
      ...dossier.snapshot,
      manifest: manifestLifecycle.render(dossier.snapshot.manifest, nextMetadata),
    };
    const revision = nextMetadata.find((entry) => entry.documentType === documentType)?.revision;
    if (revision === undefined) {
      throw new Error('The test document metadata does not exist.');
    }
    return revision;
  }

  private applyCommit(commit: KnowledgeBaseCommit): void {
    const nextDossiers = cloneStoredDossiers(this.dossiers);
    for (const replacement of commit.dossierReplacements ?? []) {
      const dossier = nextDossiers.get(replacement.workItemId);
      if (dossier === undefined) {
        throw new Error('A test commit referenced an unknown dossier.');
      }
      if (replacement.relativePath === '00_MANIFEST.md') {
        dossier.snapshot = {
          ...dossier.snapshot,
          manifest: replacement.content,
        };
      } else if (replacement.relativePath === 'WORK_ITEM.yml') {
        dossier.snapshot = {
          ...dossier.snapshot,
          workItemYml: replacement.content,
          workItem: parsePersistedWorkItem(replacement.content),
        };
      } else {
        dossier.artifacts.set(replacement.relativePath, replacement.content);
        dossier.snapshot = {
          ...dossier.snapshot,
          existingM5Artifacts: new Set([
            ...dossier.snapshot.existingM5Artifacts,
            replacement.relativePath,
          ]),
          m5Artifacts: new Map([
            ...dossier.snapshot.m5Artifacts,
            [replacement.relativePath, replacement.content],
          ]),
        };
      }
    }

    const committed = this.createSnapshot(commit.ledgerContent, nextDossiers);
    commit.validateCommitted?.(committed);
    this.ledgerContent = commit.ledgerContent;
    this.dossiers = nextDossiers;
    this.commitCount += 1;
  }

  private createSnapshot(
    ledgerContent: string | undefined,
    dossiers: ReadonlyMap<string, StoredDossier>,
  ): KnowledgeBaseRepositorySnapshot {
    const snapshotDossiers = cloneStoredDossiers(dossiers);
    return {
      ...(ledgerContent === undefined ? {} : { ledgerContent }),
      dossiers: new Map(
        [...snapshotDossiers].map(([workItemId, dossier]) => [workItemId, dossier.snapshot]),
      ),
    };
  }
}

interface Harness {
  service: KnowledgeBaseApplicationService;
  repository: InMemoryKnowledgeBaseRepository;
  ledgerService: KnowledgeBaseLedgerService;
  observation: SequentialProjectObservation;
}

function workItem(workItemId: string): WorkItem {
  return {
    schemaVersion: '2.0.0',
    id: workItemId,
    rallyId: workItemId,
    type: 'USER_STORY',
    status: 'DEVELOPMENT',
    title: `Title for ${workItemId}`,
    iteration: {
      iterationId: 'Iteration 91',
      displayName: 'Iteration 91',
      storageToken: 'Iteration_91',
    },
    dates: { startedAt: '2026-07-28' },
    salesforce: { developmentAlias: 'development' },
    functional: {
      definition: `Functional definition for ${workItemId}.`,
      acceptanceCriteria: ['The workflow preserves confirmed knowledge.'],
    },
    initialScope: { relatedComponents: ['knowledge-base'] },
    createdAt: '2026-07-28T08:00:00.000Z',
    updatedAt: '2026-07-28T08:00:00.000Z',
  };
}

function createHarness(observationEnabled = true): Harness {
  const clock = new SequentialClock();
  const idGenerator = new SequentialIdGenerator();
  const ledgerService = new KnowledgeBaseLedgerService(clock, idGenerator);
  const repository = new InMemoryKnowledgeBaseRepository([workItem('WI-1'), workItem('WI-2')]);
  const observation = new SequentialProjectObservation();
  return {
    service: new KnowledgeBaseApplicationService(
      repository,
      ledgerService,
      new M5ProjectionService(),
      observationEnabled ? observation : undefined,
      clock,
      idGenerator,
    ),
    repository,
    ledgerService,
    observation,
  };
}

function ledger(harness: Harness): KnowledgeBaseLedger {
  if (harness.repository.ledgerContent === undefined) {
    throw new Error('The test ledger is not initialized.');
  }
  return harness.ledgerService.parse(harness.repository.ledgerContent);
}

function state(harness: Harness): KnowledgeBaseState {
  return harness.ledgerService.projectState(ledger(harness));
}

function revision(harness: Harness): number {
  return harness.repository.ledgerContent === undefined ? 0 : ledger(harness).knowledgeRevision;
}

function mutation(harness: Harness, actor: ParticipantRef, sequence: number) {
  return {
    expectedKnowledgeRevision: revision(harness),
    idempotencyKey: idempotencyKey(sequence),
    actor,
  };
}

function initializationInput(
  harness: Harness,
  workItemId: string,
  actor: ParticipantRef,
  sequence: number,
) {
  return {
    workItemId,
    iteration: {
      iterationId: 'Iteration 91',
      displayName: 'Iteration 91',
      storageToken: 'Iteration_91',
    },
    responsible: actor,
    classification: 'STANDARD' as const,
    ...mutation(harness, actor, sequence),
  };
}

async function initializeTwoWorkItems(harness: Harness): Promise<void> {
  await harness.service.initializeWorkflow(initializationInput(harness, 'WI-1', owner, 1));
  await harness.service.initializeWorkflow(initializationInput(harness, 'WI-2', owner, 2));
}

async function createSuspendedSessionForFirstWorkItem(harness: Harness): Promise<void> {
  await harness.service.activateSession({
    workItemId: 'WI-1',
    ...mutation(harness, owner, 10),
  });
  await harness.service.recordSessionCheckpoint({
    workItemId: 'WI-1',
    observedWork: ['Implemented the application boundary.'],
    relevantContext: ['The ledger remains the source of truth.'],
    pendingQuestions: ['Confirm final completion.'],
    semanticSummary: 'A deterministic manual checkpoint.',
    ...mutation(harness, owner, 11),
  });
  await harness.service.switchSession({
    targetWorkItemId: 'WI-2',
    observedWork: ['Suspended WI-1 before changing context.'],
    relevantContext: ['WI-2 is now the active focus.'],
    pendingQuestions: [],
    semanticSummary: 'Automatic checkpoint during the switch.',
    ...mutation(harness, owner, 12),
  });
}

function completeConsolidationInput(
  harness: Harness,
  actor: ParticipantRef,
  sequence: number,
  workItemId = 'WI-1',
  actualBehavior = 'The application appends events and renders projections.',
) {
  return {
    workItemId,
    functionalOverview: {
      purpose: 'Preserve confirmed project knowledge.',
      actualBehavior,
      functionalFlow: ['Validate input.', 'Append events.', 'Render projections.'],
      entryConditions: ['M3 and M4 are initialized.'],
      businessRules: ['Only the principal confirms completion.'],
      testData: ['Two deterministic Work Items.'],
      relatedWorkItemIds: [workItemId === 'WI-1' ? 'WI-2' : 'WI-1'],
    },
    implementation: {
      components: [
        {
          name: 'KnowledgeBaseApplicationService',
          type: 'TypeScript service',
          responsibility: 'Coordinate Milestone 5 operations.',
          changes: ['Add deterministic application workflows.'],
        },
      ],
      dependencies: ['KnowledgeBaseLedgerService'],
      implementationDecisions: ['Keep the ledger workspace-level.'],
      technicalFlow: ['Read snapshot.', 'Build events.', 'Commit atomically.'],
    },
    testing: {
      preconditions: ['An initialized workflow.'],
      testData: ['Deterministic clock and identifiers.'],
      scenarios: [
        {
          title: 'Complete a reviewed Work Item',
          steps: ['Consolidate.', 'Review.', 'Confirm completion.'],
          expectedOutcome: 'The Work Item becomes COMPLETED.',
        },
      ],
      regressionChecks: ['M4 remains independent.'],
      evidenceReferenceIds: [],
      closureChecklist: ['The structural review passes.'],
    },
    provenance: {
      source: 'HUMAN_CONFIRMED' as const,
      introducedBy: actor,
      confirmedBy: actor,
    },
    ...mutation(harness, actor, sequence),
  };
}

describe('KnowledgeBaseApplicationService', () => {
  it('initializes workflows with their declared principals and resolves an exact retry before a stale revision', async () => {
    const harness = createHarness();
    const firstInput = initializationInput(harness, 'WI-1', owner, 100);

    const first = await harness.service.initializeWorkflow(firstInput);
    await harness.service.initializeWorkflow(initializationInput(harness, 'WI-2', successor, 101));
    const commitsBeforeRetry = harness.repository.commitCount;
    const retried = await harness.service.initializeWorkflow(firstInput);

    expect(first).toMatchObject({
      workItemId: 'WI-1',
      status: 'IN_PROGRESS',
      knowledgeRevision: 1,
      idempotent: false,
    });
    expect(retried).toMatchObject({
      workItemId: 'WI-1',
      status: 'IN_PROGRESS',
      knowledgeRevision: 1,
      idempotent: true,
    });
    expect(harness.repository.commitCount).toBe(commitsBeforeRetry);
    expect(revision(harness)).toBe(2);
    await expect(harness.service.getWorkflow({ workItemId: 'WI-1' })).resolves.toMatchObject({
      responsible: owner,
      collaborators: [],
      status: 'IN_PROGRESS',
    });
    expect(harness.repository.dossier('WI-1').manifest).toContain(
      '## Milestone 5 Workflow and Knowledge Inventory',
    );
    expect(harness.repository.artifact('WI-1', '09_FINAL_REPORT.md')).toContain('Owner Developer');
    harness.repository.deleteArtifact('WI-1', '09_FINAL_REPORT.md');
    await expect(
      harness.service.getActiveSession({ participantId: owner.participantId }),
    ).rejects.toMatchObject({
      code: 'WORKFLOW_CORRUPT',
    });
    await expect(harness.service.initializeWorkflow(firstInput)).rejects.toMatchObject({
      code: 'WORKFLOW_CORRUPT',
    });
  });

  it('keeps the initialized workflow unchanged when project observation is not configured', async () => {
    const harness = createHarness(false);
    await harness.service.initializeWorkflow(initializationInput(harness, 'WI-1', owner, 102));
    const revisionBeforeActivation = revision(harness);
    const commitsBeforeActivation = harness.repository.commitCount;

    await expect(
      harness.service.activateSession({
        workItemId: 'WI-1',
        ...mutation(harness, owner, 103),
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_SOURCE_NOT_CONFIGURED' });

    expect(revision(harness)).toBe(revisionBeforeActivation);
    expect(harness.repository.commitCount).toBe(commitsBeforeActivation);
    expect(state(harness).sessions).toEqual([]);
  });

  it('records an active session, deterministic snapshots, a checkpoint, and an atomic switch between Work Items', async () => {
    const harness = createHarness();
    await initializeTwoWorkItems(harness);

    const activation = await harness.service.activateSession({
      workItemId: 'WI-1',
      ...mutation(harness, owner, 110),
    });
    await expect(
      harness.service.activateSession({
        workItemId: 'WI-2',
        ...mutation(harness, owner, 150),
      }),
    ).rejects.toMatchObject({ code: 'WORK_SESSION_CONFLICT' });
    const checkpoint = await harness.service.recordSessionCheckpoint({
      workItemId: 'WI-1',
      observedWork: ['Changed the application service.'],
      relevantContext: ['The change is scoped to M5.'],
      pendingQuestions: ['Is another regression scenario required?'],
      semanticSummary: 'Manual deterministic checkpoint.',
      ...mutation(harness, owner, 111),
    });
    const switched = await harness.service.switchSession({
      targetWorkItemId: 'WI-2',
      observedWork: ['Checkpoint WI-1 before switching.'],
      relevantContext: ['WI-2 becomes active.'],
      pendingQuestions: [],
      ...mutation(harness, owner, 112),
    });

    expect(activation.snapshot).toMatchObject({
      sessionId: activation.sessionId,
      kind: 'ACTIVATION',
      changes: [
        expect.objectContaining({
          relativePath: 'src/application.ts',
          changeType: 'ADDED',
        }),
      ],
    });
    expect(activation).toMatchObject({
      lastCheckpoint: null,
      changesSinceLastCheckpoint: [],
      relevantContext: [],
      pendingQuestions: [],
      openSemanticObservations: [],
      review: { latest: null, current: false },
      dossier: {
        status: 'IN_PROGRESS',
        latestConsolidationId: null,
      },
    });
    expect(checkpoint.snapshot).toMatchObject({
      sessionId: activation.sessionId,
      kind: 'CHECKPOINT',
      changes: [
        expect.objectContaining({
          relativePath: 'src/application.ts',
          changeType: 'MODIFIED',
        }),
      ],
    });
    expect(switched).toMatchObject({
      sourceWorkItemId: 'WI-1',
      targetWorkItemId: 'WI-2',
    });
    expect(harness.observation.captures).toBe(4);

    const projected = state(harness);
    expect(projected.snapshots.map((snapshot) => snapshot.kind)).toEqual([
      'ACTIVATION',
      'CHECKPOINT',
      'SWITCH',
      'ACTIVATION',
    ]);
    expect(projected.checkpoints.map((entry) => entry.kind)).toEqual([
      'MANUAL',
      'AUTOMATIC_SWITCH',
    ]);
    expect(projected.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: activation.sessionId,
          workItemId: 'WI-1',
          status: 'SUSPENDED',
        }),
        expect.objectContaining({
          sessionId: switched.sessionId,
          workItemId: 'WI-2',
          status: 'ACTIVE',
        }),
      ]),
    );
    await expect(
      harness.service.getActiveSession({ participantId: owner.participantId }),
    ).resolves.toMatchObject({
      session: {
        sessionId: switched.sessionId,
        workItemId: 'WI-2',
        status: 'ACTIVE',
      },
    });
  });

  it('returns resumable checkpoint, review, and dossier context when reactivating', async () => {
    const harness = createHarness();
    await initializeTwoWorkItems(harness);
    await createSuspendedSessionForFirstWorkItem(harness);
    await harness.service.suspendSession({
      workItemId: 'WI-2',
      observedWork: ['Pause the second Work Item before resuming the first.'],
      relevantContext: [],
      pendingQuestions: [],
      ...mutation(harness, owner, 13),
    });
    const review = await harness.service.reviewWorkItem({
      workItemId: 'WI-1',
      semanticObservations: [
        {
          severity: 'WARNING',
          explanation: 'Confirm the remaining rollout question.',
          provenance: {
            source: 'MANUAL',
            introducedBy: owner,
          },
        },
      ],
      ...mutation(harness, owner, 14),
    });
    const activationInput = {
      workItemId: 'WI-1',
      ...mutation(harness, owner, 15),
    };

    const activation = await harness.service.activateSession(activationInput);
    await harness.service.recordSessionCheckpoint({
      workItemId: 'WI-1',
      observedWork: ['A later mutation must not alter the original activation response.'],
      relevantContext: ['Late checkpoint context.'],
      pendingQuestions: ['Late question.'],
      ...mutation(harness, owner, 16),
    });
    const retry = await harness.service.activateSession(activationInput);

    expect(activation).toMatchObject({
      workItemId: 'WI-1',
      snapshot: { kind: 'ACTIVATION' },
      lastCheckpoint: {
        kind: 'AUTOMATIC_SWITCH',
        relevantContext: ['WI-2 is now the active focus.'],
        pendingQuestions: [],
      },
      relevantContext: ['WI-2 is now the active focus.'],
      pendingQuestions: [],
      openSemanticObservations: [
        {
          observationId: review.semanticObservationIds[0],
          status: 'OPEN',
        },
      ],
      review: {
        latest: {
          reviewId: review.reviewId,
          result: 'FAILED',
        },
        current: false,
      },
      dossier: {
        status: 'IN_PROGRESS',
        workItemRevision: expect.any(Number),
        latestConsolidationId: null,
      },
      idempotent: false,
    });
    expect(activation.changesSinceLastCheckpoint).toEqual([
      expect.objectContaining({
        relativePath: 'src/application.ts',
        changeType: 'MODIFIED',
      }),
    ]);
    expect(retry).toMatchObject({
      ...activation,
      idempotent: true,
    });
  });

  it.each([
    {
      name: 'manual introducer',
      provenance: {
        source: 'MANUAL',
        introducedBy: collaborator,
      },
    },
    {
      name: 'human confirmer',
      provenance: {
        source: 'HUMAN_CONFIRMED',
        introducedBy: owner,
        confirmedBy: collaborator,
      },
    },
    {
      name: 'human introducer',
      provenance: {
        source: 'HUMAN_CONFIRMED',
        introducedBy: collaborator,
        confirmedBy: owner,
      },
    },
    {
      name: 'pending-import introducer',
      provenance: {
        source: 'IMPORTED_PENDING_VALIDATION',
        introducedBy: collaborator,
      },
    },
  ])(
    'rejects a semantic observation whose $name does not match the declared actor',
    async ({ provenance }) => {
      const harness = createHarness();
      await initializeTwoWorkItems(harness);
      const revisionBeforeReview = revision(harness);

      await expect(
        harness.service.reviewWorkItem({
          workItemId: 'WI-1',
          semanticObservations: [
            {
              severity: 'WARNING',
              explanation: 'The declared provenance identity must match the review actor.',
              provenance,
            },
          ],
          ...mutation(harness, owner, 150),
        }),
      ).rejects.toMatchObject({ code: 'PARTICIPANT_NOT_AUTHORIZED' });
      expect(revision(harness)).toBe(revisionBeforeReview);
    },
  );

  it('suspends a session with a closure checkpoint and preserves semantic observation resolution', async () => {
    const harness = createHarness();
    await initializeTwoWorkItems(harness);
    await harness.service.activateSession({
      workItemId: 'WI-1',
      ...mutation(harness, owner, 113),
    });
    const suspendInput = {
      workItemId: 'WI-1',
      checkpointKind: 'CLOSURE' as const,
      observedWork: ['Captured the last verified implementation state.'],
      relevantContext: ['The session can now be closed without switching Work Items.'],
      pendingQuestions: [],
      semanticSummary: 'Explicit closure checkpoint.',
      ...mutation(harness, owner, 114),
    };
    const suspended = await harness.service.suspendSession(suspendInput);
    const review = await harness.service.reviewWorkItem({
      workItemId: 'WI-1',
      semanticObservations: [
        {
          severity: 'WARNING',
          explanation: 'Confirm the operational rollout with IBM Bob.',
          provenance: {
            source: 'MANUAL',
            introducedBy: owner,
          },
        },
      ],
      ...mutation(harness, owner, 115),
    });
    const observationId = review.semanticObservationIds[0];
    if (observationId === undefined) {
      throw new Error('The semantic observation was not recorded.');
    }
    const resolutionInput = {
      workItemId: 'WI-1',
      observationId,
      resolution: 'The manual IBM Bob check remains explicitly pending.',
      confirmation: true,
      ...mutation(harness, owner, 116),
    };
    const resolved = await harness.service.resolveSemanticObservation(resolutionInput);
    const retried = await harness.service.suspendSession(suspendInput);
    const retriedResolution = await harness.service.resolveSemanticObservation(resolutionInput);

    expect(suspended).toMatchObject({
      workItemId: 'WI-1',
      checkpointId: expect.any(String),
      status: 'SUSPENDED',
      snapshot: { kind: 'CLOSURE' },
      idempotent: false,
    });
    expect(retried).toMatchObject({
      workItemId: 'WI-1',
      checkpointId: suspended.checkpointId,
      status: 'SUSPENDED',
      knowledgeRevision: suspended.knowledgeRevision,
      idempotent: true,
    });
    expect(resolved).toMatchObject({
      workItemId: 'WI-1',
      observationId,
      status: 'RESOLVED',
    });
    expect(retriedResolution).toMatchObject({
      workItemId: 'WI-1',
      observationId,
      status: 'RESOLVED',
      knowledgeRevision: resolved.knowledgeRevision,
      idempotent: true,
    });
    await expect(
      harness.service.getActiveSession({ participantId: owner.participantId }),
    ).resolves.toMatchObject({ session: null });
    await expect(
      harness.service.resumeSessionContext({
        workItemId: 'WI-1',
        participantId: owner.participantId,
      }),
    ).resolves.toMatchObject({
      lastCheckpoint: {
        checkpointId: suspended.checkpointId,
        kind: 'CLOSURE',
      },
      lastSnapshot: { kind: 'CLOSURE' },
      changesSinceLastCheckpoint: [],
      relevantContext: ['The session can now be closed without switching Work Items.'],
      pendingQuestions: [],
      openSemanticObservations: [],
      review: {
        latest: {
          reviewId: review.reviewId,
          result: 'FAILED',
        },
        current: false,
      },
      dossier: {
        status: 'IN_PROGRESS',
        latestConsolidationId: null,
      },
    });
    expect(
      state(harness).semanticObservations.find((entry) => entry.observationId === observationId),
    ).toMatchObject({
      status: 'RESOLVED',
      resolvedBy: owner,
      resolution: 'The manual IBM Bob check remains explicitly pending.',
    });
  });

  it('prevents participant removal, responsibility transfer, and cancellation from orphaning an active session', async () => {
    const harness = createHarness();
    await initializeTwoWorkItems(harness);
    await harness.service.addCollaborator({
      workItemId: 'WI-1',
      collaborator,
      ...mutation(harness, owner, 117),
    });
    await harness.service.activateSession({
      workItemId: 'WI-1',
      ...mutation(harness, collaborator, 118),
    });
    await expect(
      harness.service.removeCollaborator({
        workItemId: 'WI-1',
        collaboratorId: collaborator.participantId,
        reason: 'Attempted while the collaborator is active.',
        ...mutation(harness, owner, 119),
      }),
    ).rejects.toMatchObject({ code: 'WORK_SESSION_CONFLICT' });
    await harness.service.suspendSession({
      workItemId: 'WI-1',
      observedWork: [],
      relevantContext: [],
      pendingQuestions: [],
      ...mutation(harness, collaborator, 140),
    });
    await harness.service.activateSession({
      workItemId: 'WI-1',
      ...mutation(harness, owner, 141),
    });
    await expect(
      harness.service.transferResponsibility({
        workItemId: 'WI-1',
        newResponsible: successor,
        reason: 'Attempted while the principal is active.',
        confirmation: true,
        ...mutation(harness, owner, 142),
      }),
    ).rejects.toMatchObject({ code: 'WORK_SESSION_CONFLICT' });
    await expect(
      harness.service.cancelWorkItem({
        workItemId: 'WI-1',
        reason: 'Attempted while a session is active.',
        confirmation: true,
        ...mutation(harness, owner, 143),
      }),
    ).rejects.toMatchObject({ code: 'WORK_SESSION_CONFLICT' });
    await harness.service.suspendSession({
      workItemId: 'WI-1',
      observedWork: [],
      relevantContext: [],
      pendingQuestions: [],
      ...mutation(harness, owner, 144),
    });
    await expect(
      harness.service.transferResponsibility({
        workItemId: 'WI-1',
        newResponsible: successor,
        reason: 'The principal session is safely suspended.',
        confirmation: true,
        ...mutation(harness, owner, 145),
      }),
    ).resolves.toMatchObject({ workItemId: 'WI-1' });
  });

  it('cancels and explicitly reopens without deleting accumulated workflow state', async () => {
    const harness = createHarness();
    await harness.service.initializeWorkflow(initializationInput(harness, 'WI-1', owner, 147));
    const cancelled = await harness.service.cancelWorkItem({
      workItemId: 'WI-1',
      reason: 'The planned delivery is no longer required.',
      confirmation: true,
      ...mutation(harness, owner, 148),
    });
    const reopened = await harness.service.reopenWorkItem({
      workItemId: 'WI-1',
      reason: 'The Product Owner restored the requirement.',
      confirmation: true,
      ...mutation(harness, owner, 149),
    });

    expect(cancelled).toMatchObject({ status: 'CANCELLED' });
    expect(reopened).toMatchObject({ status: 'IN_PROGRESS' });
    await expect(harness.service.getWorkflow({ workItemId: 'WI-1' })).resolves.toMatchObject({
      status: 'IN_PROGRESS',
      cancelledAt: expect.any(String),
      lastReopenedAt: expect.any(String),
    });
    expect(harness.repository.dossier('WI-1').workItem.status).toBe('REOPENED');
  });

  it('authorizes a symmetric relation against its declared source before canonical storage', async () => {
    const harness = createHarness();
    await harness.service.initializeWorkflow(initializationInput(harness, 'WI-1', owner, 150));
    await harness.service.initializeWorkflow(initializationInput(harness, 'WI-2', successor, 151));

    const relation = await harness.service.addRelation({
      sourceWorkItemId: 'WI-2',
      targetWorkItemId: 'WI-1',
      relationType: 'RELATED_TO',
      explanation: 'The declared WI-2 participant confirms the symmetric relation.',
      provenance: {
        source: 'HUMAN_CONFIRMED',
        introducedBy: successor,
        confirmedBy: successor,
      },
      ...mutation(harness, successor, 152),
    });

    expect(
      state(harness).relations.find((entry) => entry.relationId === relation.relationId),
    ).toMatchObject({
      sourceWorkItemId: 'WI-1',
      targetWorkItemId: 'WI-2',
      relationType: 'RELATED_TO',
      status: 'ACTIVE',
    });
  });

  it('coordinates collaborators, responsibility transfer, semantic relations, and rejected and approved concepts without filesystem coupling', async () => {
    const harness = createHarness();
    await initializeTwoWorkItems(harness);
    const dossierPaths = harness.repository.dossierPaths();

    await harness.service.addCollaborator({
      workItemId: 'WI-1',
      collaborator,
      ...mutation(harness, owner, 120),
    });
    await harness.service.transferResponsibility({
      workItemId: 'WI-1',
      newResponsible: successor,
      reason: 'The successor owns final delivery.',
      confirmation: true,
      ...mutation(harness, owner, 121),
    });
    const relation = await harness.service.addRelation({
      sourceWorkItemId: 'WI-1',
      targetWorkItemId: 'WI-2',
      relationType: 'DEPENDS_ON',
      explanation: 'WI-1 consumes behavior delivered by WI-2.',
      provenance: {
        source: 'HUMAN_CONFIRMED',
        introducedBy: successor,
        confirmedBy: successor,
      },
      ...mutation(harness, successor, 122),
    });
    const unaffectedProjectionWatermark = harness.repository.dossier('WI-2').manifest;

    const rejectedProposal = await harness.service.proposeConcept({
      workItemId: 'WI-1',
      displayName: 'Application Boundary',
      explanation: 'The first evidence set is incomplete.',
      evidenceReferenceIds: [uuid('7', 1)],
      ...mutation(harness, successor, 123),
    });
    await harness.service.resolveConceptProposal({
      workItemId: 'WI-1',
      proposalId: rejectedProposal.proposalId,
      resolution: 'REJECTED',
      resolutionReason: 'More evidence is required.',
      confirmation: false,
      ...mutation(harness, successor, 124),
    });
    const revisionBeforeSuppression = revision(harness);
    const suppressedProposal = await harness.service.proposeConcept({
      workItemId: 'WI-1',
      displayName: 'Application Boundary',
      explanation: 'Different wording without any new evidence.',
      evidenceReferenceIds: [uuid('7', 1)],
      ...mutation(harness, successor, 146),
    });
    expect(suppressedProposal).toMatchObject({
      proposalId: rejectedProposal.proposalId,
      status: 'REJECTED',
      suppressed: true,
      knowledgeRevision: revisionBeforeSuppression,
      idempotent: true,
    });

    const approvedProposal = await harness.service.proposeConcept({
      workItemId: 'WI-1',
      displayName: 'Application Boundary',
      explanation: 'Deterministic application tests now confirm the concept.',
      evidenceReferenceIds: [uuid('7', 2)],
      ...mutation(harness, successor, 125),
    });
    await harness.service.resolveConceptProposal({
      workItemId: 'WI-1',
      proposalId: approvedProposal.proposalId,
      resolution: 'APPROVED',
      resolutionReason: 'The evidence is sufficient.',
      confirmation: true,
      ...mutation(harness, successor, 126),
    });

    const projected = state(harness);
    expect(projected.workItems.find((entry) => entry.workItemId === 'WI-1')).toMatchObject({
      responsible: successor,
      collaborators: [collaborator],
      responsibilityHistory: [
        expect.objectContaining({
          previousResponsible: owner,
          newResponsible: successor,
        }),
      ],
    });
    expect(projected.relations).toEqual([
      expect.objectContaining({
        relationId: relation.relationId,
        relationType: 'DEPENDS_ON',
        sourceWorkItemId: 'WI-1',
        targetWorkItemId: 'WI-2',
        status: 'ACTIVE',
      }),
    ]);
    expect(projected.conceptProposals.map((proposal) => proposal.status)).toEqual([
      'REJECTED',
      'APPROVED',
    ]);
    expect(projected.concepts).toEqual([
      expect.objectContaining({
        normalizedName: 'application boundary',
        approvedProposalId: approvedProposal.proposalId,
        approvedBy: successor,
      }),
    ]);
    await expect(
      harness.service.getRelatedKnowledge({
        workItemId: 'WI-1',
        concepts: ['Application Boundary'],
      }),
    ).resolves.toMatchObject({
      workItemId: 'WI-1',
      candidates: [
        expect.objectContaining({
          workItemId: 'WI-2',
          type: 'USER_STORY',
          iteration: expect.objectContaining({ iterationId: 'Iteration 91' }),
          relationIds: [relation.relationId],
          matchReasons: ['TYPE', 'ITERATION'],
          score: 100,
        }),
      ],
    });
    expect(harness.repository.dossier('WI-2').manifest).toBe(unaffectedProjectionWatermark);
    expect(unaffectedProjectionWatermark).toContain('- Knowledge revision: 5');
    expect(revision(harness)).toBeGreaterThan(5);
    await expect(harness.service.getWorkflow({ workItemId: 'WI-2' })).resolves.toMatchObject({
      status: 'IN_PROGRESS',
    });
    await harness.service.removeRelation({
      relationId: relation.relationId,
      reason: 'The dependency was removed after validation.',
      ...mutation(harness, successor, 127),
    });
    expect(
      state(harness).relations.find((entry) => entry.relationId === relation.relationId),
    ).toMatchObject({ status: 'REMOVED' });
    await expect(
      harness.service.getRelatedKnowledge({
        workItemId: 'WI-1',
        concepts: [],
      }),
    ).resolves.toMatchObject({
      candidates: [
        expect.objectContaining({
          workItemId: 'WI-2',
          relationIds: [],
          matchReasons: ['TYPE', 'ITERATION'],
          score: 0,
        }),
      ],
    });
    expect(harness.repository.dossierPaths()).toEqual(dossierPaths);
  });

  it('returns a self-contained related-knowledge view with catalog and signal provenance', async () => {
    const harness = createHarness();
    await initializeTwoWorkItems(harness);
    const applicationBoundary = await harness.service.proposeConcept({
      workItemId: 'WI-1',
      displayName: 'Application Boundary',
      explanation: 'Names the confirmed application coordination boundary.',
      evidenceReferenceIds: [uuid('7', 20)],
      ...mutation(harness, owner, 160),
    });
    await harness.service.resolveConceptProposal({
      workItemId: 'WI-1',
      proposalId: applicationBoundary.proposalId,
      resolution: 'APPROVED',
      resolutionReason: 'The project uses this exact official phrase.',
      confirmation: true,
      ...mutation(harness, owner, 161),
    });
    const auth = await harness.service.proposeConcept({
      workItemId: 'WI-1',
      displayName: 'Auth',
      explanation: 'A deliberately short concept used to verify exact matching.',
      evidenceReferenceIds: [uuid('7', 21)],
      ...mutation(harness, owner, 162),
    });
    await harness.service.resolveConceptProposal({
      workItemId: 'WI-1',
      proposalId: auth.proposalId,
      resolution: 'APPROVED',
      resolutionReason: 'Approved independently from the authorization wording.',
      confirmation: true,
      ...mutation(harness, owner, 163),
    });
    await harness.service.consolidateDossier(
      completeConsolidationInput(
        harness,
        owner,
        164,
        'WI-1',
        'The Application Boundary is the confirmed source-side concept.',
      ),
    );
    await harness.service.consolidateDossier(
      completeConsolidationInput(
        harness,
        owner,
        165,
        'WI-2',
        'The Application Boundary coordinates authorization; the shorter label is absent.',
      ),
    );
    const commitsBeforeQuery = harness.repository.commitCount;
    const ledgerBeforeQuery = harness.repository.ledgerContent;
    const manifestBeforeQuery = harness.repository.dossier('WI-2').manifest;

    const related = await harness.service.getRelatedKnowledge({
      workItemId: 'WI-1',
      concepts: ['Application Boundary', 'Auth'],
    });

    expect(related).not.toHaveProperty('title');
    expect(related.localConceptProposals).toHaveLength(2);
    expect(related.projectConcepts).toEqual([
      expect.objectContaining({
        normalizedName: 'application boundary',
        proposal: expect.objectContaining({
          evidenceReferenceIds: [uuid('7', 20)],
          provenance: expect.objectContaining({ source: 'MANUAL' }),
        }),
        approval: expect.objectContaining({
          approvedBy: owner,
          provenance: expect.objectContaining({ source: 'HUMAN_CONFIRMED' }),
        }),
      }),
      expect.objectContaining({ normalizedName: 'auth' }),
    ]);
    expect(related.candidates).toEqual([
      expect.objectContaining({
        workItemId: 'WI-2',
        relationIds: [],
        relations: [],
        sharedComponents: ['knowledgebaseapplicationservice'],
        componentMatches: [
          expect.objectContaining({
            normalizedName: 'knowledgebaseapplicationservice',
            sourceConsolidation: expect.objectContaining({
              provenance: expect.objectContaining({ source: 'HUMAN_CONFIRMED' }),
            }),
            candidateConsolidation: expect.objectContaining({
              provenance: expect.objectContaining({ source: 'HUMAN_CONFIRMED' }),
            }),
          }),
        ],
        conceptIds: [expect.any(String)],
        conceptMatches: [
          expect.objectContaining({
            normalizedName: 'application boundary',
            matchKind: 'CONFIRMED_TEXT_OCCURRENCE',
            candidateConsolidation: expect.objectContaining({
              provenance: expect.objectContaining({ source: 'HUMAN_CONFIRMED' }),
            }),
          }),
        ],
        score: 11,
      }),
    ]);
    expect(related.candidates[0]?.conceptMatches).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ normalizedName: 'auth' })]),
    );
    expect(harness.repository.commitCount).toBe(commitsBeforeQuery);
    expect(harness.repository.ledgerContent).toBe(ledgerBeforeQuery);
    expect(harness.repository.dossier('WI-2').manifest).toBe(manifestBeforeQuery);
  });

  it('blocks incomplete structural review, prevents collaborator completion, completes by the principal, and automatically reopens on a material M5 mutation', async () => {
    const harness = createHarness();
    await initializeTwoWorkItems(harness);
    await createSuspendedSessionForFirstWorkItem(harness);
    await harness.service.addCollaborator({
      workItemId: 'WI-1',
      collaborator,
      ...mutation(harness, owner, 130),
    });
    await harness.service.transferResponsibility({
      workItemId: 'WI-1',
      newResponsible: successor,
      reason: 'The successor confirms the closure.',
      confirmation: true,
      ...mutation(harness, owner, 131),
    });

    const failedReview = await harness.service.reviewWorkItem({
      workItemId: 'WI-1',
      semanticObservations: [],
      ...mutation(harness, successor, 132),
    });
    expect(failedReview).toMatchObject({
      result: 'FAILED',
      findings: [
        expect.objectContaining({
          code: 'CONSOLIDATION_MISSING',
        }),
      ],
    });
    await expect(
      harness.service.completeWorkItem({
        workItemId: 'WI-1',
        structuralReviewId: failedReview.reviewId,
        confirmation: true,
        ...mutation(harness, successor, 133),
      }),
    ).rejects.toMatchObject({ code: 'STRUCTURAL_REVIEW_FAILED' });

    const consolidation = await harness.service.consolidateDossier(
      completeConsolidationInput(harness, successor, 134),
    );
    const passedReview = await harness.service.reviewWorkItem({
      workItemId: 'WI-1',
      semanticObservations: [],
      ...mutation(harness, successor, 135),
    });
    expect(consolidation.consolidationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(passedReview).toMatchObject({ result: 'PASSED', findings: [] });

    await expect(
      harness.service.completeWorkItem({
        workItemId: 'WI-1',
        structuralReviewId: passedReview.reviewId,
        confirmation: true,
        ...mutation(harness, collaborator, 136),
      }),
    ).rejects.toMatchObject({ code: 'PARTICIPANT_NOT_AUTHORIZED' });

    const completed = await harness.service.completeWorkItem({
      workItemId: 'WI-1',
      structuralReviewId: passedReview.reviewId,
      confirmation: true,
      ...mutation(harness, successor, 137),
    });
    expect(completed).toMatchObject({
      workItemId: 'WI-1',
      status: 'COMPLETED',
      idempotent: false,
    });
    expect(harness.repository.dossier('WI-1').workItem).toMatchObject({
      status: 'CLOSED',
      responsibility: { responsiblePerson: successor.displayName },
    });

    await expect(
      harness.service.autoReopenForExternalMutation({
        workItemId: 'WI-1',
        trigger: 'update_work_item_document',
        idempotencyKey: idempotencyKey(147),
        cursor: {
          source: 'M3_DOCUMENT',
          documentType: 'FUNCTIONAL_ANALYSIS',
          revision: 1,
        },
      }),
    ).resolves.toEqual({ reopened: false });
    await expect(harness.service.getWorkflow({ workItemId: 'WI-1' })).resolves.toMatchObject({
      status: 'COMPLETED',
    });

    const postCompletionActivation = await harness.service.activateSession({
      workItemId: 'WI-1',
      ...mutation(harness, successor, 138),
    });
    expect(postCompletionActivation).toMatchObject({
      workItemId: 'WI-1',
      dossier: { status: 'IN_PROGRESS' },
    });
    expect(
      ledger(harness)
        .operations.at(-1)
        ?.events.map((event) => event.eventType),
    ).toEqual(['WORK_ITEM_REOPENED', 'TECHNICAL_SNAPSHOT_RECORDED', 'SESSION_ACTIVATED']);

    await expect(harness.service.getWorkflow({ workItemId: 'WI-1' })).resolves.toMatchObject({
      status: 'IN_PROGRESS',
      completedAt: completed.completedAt,
      lastReopenedAt: expect.any(String),
    });
    expect(harness.repository.dossier('WI-1').workItem).toMatchObject({
      status: 'REOPENED',
      dates: {
        actualCompletionAt: completed.completedAt.slice(0, 10),
      },
    });

    await harness.service.suspendSession({
      workItemId: 'WI-1',
      observedWork: ['Suspend the automatically reopened session.'],
      relevantContext: [],
      pendingQuestions: [],
      ...mutation(harness, successor, 166),
    });
    const secondReview = await harness.service.reviewWorkItem({
      workItemId: 'WI-1',
      semanticObservations: [],
      ...mutation(harness, successor, 167),
    });
    await harness.service.completeWorkItem({
      workItemId: 'WI-1',
      structuralReviewId: secondReview.reviewId,
      confirmation: true,
      ...mutation(harness, successor, 168),
    });
    const nextDocumentRevision = harness.repository.advanceDocumentRevision(
      'WI-1',
      'FUNCTIONAL_ANALYSIS',
    );
    const historicalBridgeInput = {
      workItemId: 'WI-1',
      trigger: 'update_work_item_document' as const,
      idempotencyKey: idempotencyKey(169),
      cursor: {
        source: 'M3_DOCUMENT' as const,
        documentType: 'FUNCTIONAL_ANALYSIS' as const,
        revision: nextDocumentRevision,
      },
    };
    const bridged = await harness.service.autoReopenForExternalMutation(historicalBridgeInput);
    expect(bridged).toMatchObject({ reopened: true, knowledgeRevision: revision(harness) });
    await expect(harness.service.getWorkflow({ workItemId: 'WI-1' })).resolves.toMatchObject({
      status: 'IN_PROGRESS',
      lastCompletionBoundary: {
        m3DocumentRevisions: { FUNCTIONAL_ANALYSIS: 1 },
      },
    });

    const thirdReview = await harness.service.reviewWorkItem({
      workItemId: 'WI-1',
      semanticObservations: [],
      ...mutation(harness, successor, 170),
    });
    await harness.service.completeWorkItem({
      workItemId: 'WI-1',
      structuralReviewId: thirdReview.reviewId,
      confirmation: true,
      ...mutation(harness, successor, 171),
    });
    const revisionBeforeOldRetry = revision(harness);
    await expect(
      harness.service.autoReopenForExternalMutation(historicalBridgeInput),
    ).resolves.toEqual({ reopened: false });
    expect(revision(harness)).toBe(revisionBeforeOldRetry);
    await expect(harness.service.getWorkflow({ workItemId: 'WI-1' })).resolves.toMatchObject({
      status: 'COMPLETED',
      lastCompletionBoundary: {
        m3DocumentRevisions: { FUNCTIONAL_ANALYSIS: nextDocumentRevision },
      },
    });
  });
});
