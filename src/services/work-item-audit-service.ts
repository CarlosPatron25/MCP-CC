import {
  AUDIT_ARTIFACT_RELATIVE_PATHS,
  AUDIT_PROJECTION_RELATIVE_PATHS,
  TRACKING_TYPES,
  type AuditLedger,
  type AuditLedgerMutationResult,
  type Checkpoint,
  type Decision,
  type EvidenceReference,
  type TestExecution,
  type TestPlanVersion,
  type TrackingType,
} from '../domain/work-item-audit.js';
import {
  AuditEntryValidationError,
  AuditLedgerCorruptError,
  AuditTrackingNotInitializedError,
} from '../errors/workspace-error.js';
import type { AuditContextSummaryService } from './audit-context-summary-service.js';
import { providerForManifest } from './document-rendering.js';
import type { AuditProjectionService } from './audit-projection-service.js';
import type { AuditLedgerService } from './audit-ledger-service.js';
import type { M4ManifestInventoryService } from './m4-manifest-inventory-service.js';
import type {
  AuditCommitArtifacts,
  AuditRepositoryDecision,
  WorkItemAuditRepository,
  WorkItemAuditSnapshot,
} from './work-item-audit-repository.js';

type MutableAuditEntry =
  Decision | Checkpoint | TestPlanVersion | TestExecution | EvidenceReference;

export interface InitializeWorkItemTrackingResult {
  workItemId: string;
  auditRevision: number;
  created: string[];
  existing: string[];
}

export interface RecordDecisionResult {
  workItemId: string;
  decisionId: string;
  recordedAt: string;
  auditRevision: number;
  idempotent: boolean;
}

export interface RecordCheckpointResult {
  workItemId: string;
  checkpointId: string;
  recordedAt: string;
  auditRevision: number;
  idempotent: boolean;
}

export interface DefineTestPlanResult {
  workItemId: string;
  planVersionId: string;
  planId: string;
  planRevision: number;
  testCases: Array<{ testCaseId: string; title: string }>;
  recordedAt: string;
  auditRevision: number;
  idempotent: boolean;
}

export interface RecordTestExecutionResult {
  workItemId: string;
  testExecutionId: string;
  recordedAt: string;
  auditRevision: number;
  idempotent: boolean;
}

export interface RegisterEvidenceReferenceResult {
  workItemId: string;
  evidenceReferenceId: string;
  recordedAt: string;
  auditRevision: number;
  idempotent: boolean;
}

export interface GetWorkItemTrackingResult {
  workItemId: string;
  trackingType: TrackingType;
  relativePath: string;
  auditRevision: number;
  content: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validationError(field = 'input'): AuditEntryValidationError {
  return new AuditEntryValidationError('The audit entry request is invalid.', { field });
}

function extractWorkItemId(input: unknown): string {
  if (!isRecord(input) || typeof input.workItemId !== 'string') {
    throw validationError('workItemId');
  }
  return input.workItemId;
}

function payloadWithoutWorkItemId(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) {
    throw validationError();
  }
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key !== 'workItemId') {
      payload[key] = value;
    }
  }
  return payload;
}

function assertExactKeys(input: unknown, keys: readonly string[]): void {
  if (!isRecord(input)) {
    throw validationError();
  }
  const actual = Object.keys(input).sort((left, right) => left.localeCompare(right));
  const expected = [...keys].sort((left, right) => left.localeCompare(right));
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw validationError();
  }
}

function artifactPaths(): string[] {
  return [...AUDIT_ARTIFACT_RELATIVE_PATHS];
}

/**
 * Application owner of the seven M4 use cases. Input validation and every
 * ledger decision execute inside the repository's shared Work Item lock.
 */
export class WorkItemAuditService {
  public constructor(
    private readonly repository: WorkItemAuditRepository,
    private readonly ledgerService: AuditLedgerService,
    private readonly projectionService: AuditProjectionService,
    private readonly manifestInventory: M4ManifestInventoryService,
    private readonly contextSummary: AuditContextSummaryService,
  ) {}

  public async initialize(input: unknown): Promise<InitializeWorkItemTrackingResult> {
    const workItemId = extractWorkItemId(input);
    return this.repository.withSnapshot(workItemId, (snapshot) => {
      if (snapshot.tracking.status === 'INITIALIZED') {
        const ledger = this.validateInitializedSnapshot(snapshot);
        assertExactKeys(input, ['workItemId']);
        return {
          result: {
            workItemId: snapshot.workItem.id,
            auditRevision: ledger.revision,
            created: [],
            existing: artifactPaths(),
          },
        };
      }

      assertExactKeys(input, ['workItemId']);
      const ledger = this.ledgerService.createEmptyLedger();
      const artifacts = this.buildCommitArtifacts(snapshot.manifest, ledger);
      const result: InitializeWorkItemTrackingResult = {
        workItemId: snapshot.workItem.id,
        auditRevision: 0,
        created: artifactPaths(),
        existing: [],
      };
      return {
        result,
        commit: {
          initialization: true,
          artifacts,
          validateCommittedSnapshot: (committed) => {
            this.assertCommittedArtifacts(committed, artifacts, ledger);
          },
        },
      };
    });
  }

  public async recordDecision(input: unknown): Promise<RecordDecisionResult> {
    return this.mutate(
      input,
      (ledger, payload) => this.ledgerService.appendDecision(ledger, payload),
      (workItemId, mutation) => ({
        workItemId,
        decisionId: mutation.entry.id,
        recordedAt: mutation.entry.recordedAt,
        auditRevision: mutation.auditRevision,
        idempotent: mutation.idempotent,
      }),
    );
  }

  public async recordCheckpoint(input: unknown): Promise<RecordCheckpointResult> {
    return this.mutate(
      input,
      (ledger, payload) => this.ledgerService.appendCheckpoint(ledger, payload),
      (workItemId, mutation) => ({
        workItemId,
        checkpointId: mutation.entry.id,
        recordedAt: mutation.entry.recordedAt,
        auditRevision: mutation.auditRevision,
        idempotent: mutation.idempotent,
      }),
    );
  }

  public async defineTestPlan(input: unknown): Promise<DefineTestPlanResult> {
    return this.mutate(
      input,
      (ledger, payload) => this.ledgerService.appendTestPlan(ledger, payload),
      (workItemId, mutation) => ({
        workItemId,
        planVersionId: mutation.entry.id,
        planId: mutation.entry.planId,
        planRevision: mutation.entry.planRevision,
        testCases: mutation.entry.testCases.map((testCase) => ({
          testCaseId: testCase.testCaseId,
          title: testCase.title,
        })),
        recordedAt: mutation.entry.recordedAt,
        auditRevision: mutation.auditRevision,
        idempotent: mutation.idempotent,
      }),
    );
  }

  public async recordTestExecution(input: unknown): Promise<RecordTestExecutionResult> {
    return this.mutate(
      input,
      (ledger, payload) => this.ledgerService.appendTestExecution(ledger, payload),
      (workItemId, mutation) => ({
        workItemId,
        testExecutionId: mutation.entry.id,
        recordedAt: mutation.entry.recordedAt,
        auditRevision: mutation.auditRevision,
        idempotent: mutation.idempotent,
      }),
    );
  }

  public async registerEvidenceReference(input: unknown): Promise<RegisterEvidenceReferenceResult> {
    return this.mutate(
      input,
      (ledger, payload) => this.ledgerService.appendEvidenceReference(ledger, payload),
      (workItemId, mutation) => ({
        workItemId,
        evidenceReferenceId: mutation.entry.id,
        recordedAt: mutation.entry.recordedAt,
        auditRevision: mutation.auditRevision,
        idempotent: mutation.idempotent,
      }),
    );
  }

  public async getTracking(input: unknown): Promise<GetWorkItemTrackingResult> {
    const workItemId = extractWorkItemId(input);
    return this.repository.withSnapshot(workItemId, (snapshot) => {
      const ledger = this.requireInitializedSnapshot(snapshot);
      assertExactKeys(input, ['workItemId', 'trackingType']);
      if (
        !isRecord(input) ||
        typeof input.trackingType !== 'string' ||
        !(TRACKING_TYPES as readonly string[]).includes(input.trackingType)
      ) {
        throw validationError('trackingType');
      }
      const trackingType = input.trackingType as TrackingType;
      const artifacts = snapshot.tracking;
      if (artifacts.status !== 'INITIALIZED') {
        throw new AuditTrackingNotInitializedError(
          'Audit tracking has not been initialized for this Work Item.',
        );
      }
      const content = this.contentForTrackingType(artifacts.artifacts, trackingType);
      return {
        result: {
          workItemId: snapshot.workItem.id,
          trackingType,
          relativePath: AUDIT_PROJECTION_RELATIVE_PATHS[trackingType],
          auditRevision: ledger.revision,
          content,
        },
      };
    });
  }

  /** Supplies only the bounded M4 summary used by explicit AI-context refresh. */
  public async getContextSummary(workItemId: string): Promise<string | undefined> {
    return this.repository.withSnapshot(workItemId, (snapshot) => {
      if (snapshot.tracking.status === 'ABSENT') {
        return { result: undefined };
      }
      const ledger = this.validateInitializedSnapshot(snapshot);
      return {
        result: this.contextSummary.project(ledger, providerForManifest(snapshot.manifest)),
      };
    });
  }

  private async mutate<Entry extends MutableAuditEntry, Result>(
    input: unknown,
    append: (
      ledger: AuditLedger,
      payload: Record<string, unknown>,
    ) => AuditLedgerMutationResult<Entry>,
    resultFor: (workItemId: string, mutation: AuditLedgerMutationResult<Entry>) => Result,
  ): Promise<Result> {
    const workItemId = extractWorkItemId(input);
    return this.repository.withSnapshot(workItemId, (snapshot) => {
      const ledger = this.requireInitializedSnapshot(snapshot);
      const mutation = append(ledger, payloadWithoutWorkItemId(input));
      const result = resultFor(snapshot.workItem.id, mutation);
      if (mutation.idempotent) {
        return { result };
      }
      const artifacts = this.buildCommitArtifacts(snapshot.manifest, mutation.ledger);
      const decision: AuditRepositoryDecision<Result> = {
        result,
        commit: {
          initialization: false,
          artifacts,
          validateCommittedSnapshot: (committed) => {
            this.assertCommittedArtifacts(committed, artifacts, mutation.ledger);
          },
        },
      };
      return decision;
    });
  }

  private requireInitializedSnapshot(snapshot: WorkItemAuditSnapshot): AuditLedger {
    if (snapshot.tracking.status === 'ABSENT') {
      throw new AuditTrackingNotInitializedError(
        'Audit tracking has not been initialized for this Work Item.',
      );
    }
    return this.validateInitializedSnapshot(snapshot);
  }

  private validateInitializedSnapshot(snapshot: WorkItemAuditSnapshot): AuditLedger {
    if (snapshot.tracking.status !== 'INITIALIZED') {
      throw new AuditLedgerCorruptError('The audit tracking data cannot be read safely.');
    }
    const ledger = this.ledgerService.parse(snapshot.tracking.artifacts.ledger);
    const projected = this.projectionService.project(
      ledger,
      providerForManifest(snapshot.manifest),
    );
    if (
      snapshot.tracking.artifacts.decisions !== projected.decisions ||
      snapshot.tracking.artifacts.checkpoints !== projected.checkpoints ||
      snapshot.tracking.artifacts.testing !== projected.testPlan ||
      snapshot.tracking.artifacts.evidenceReferences !== projected.evidenceReferences
    ) {
      throw new AuditLedgerCorruptError('The audit tracking data cannot be read safely.');
    }

    const inventory = this.manifestInventory.parse(snapshot.manifest);
    if (inventory === undefined) {
      throw new AuditLedgerCorruptError('The audit tracking data cannot be read safely.');
    }
    const expectedInventory = this.manifestInventory.fromLedger(ledger, inventory.generatedAt);
    if (JSON.stringify(inventory) !== JSON.stringify(expectedInventory)) {
      throw new AuditLedgerCorruptError('The audit tracking data cannot be read safely.');
    }
    return ledger;
  }

  private buildCommitArtifacts(manifest: string, ledger: AuditLedger): AuditCommitArtifacts {
    const projections = this.projectionService.project(ledger, providerForManifest(manifest));
    const inventory = this.manifestInventory.fromLedger(ledger, ledger.updatedAt);
    return {
      ledger: this.ledgerService.serialize(ledger),
      decisions: projections.decisions,
      checkpoints: projections.checkpoints,
      testing: projections.testPlan,
      evidenceReferences: projections.evidenceReferences,
      manifest: this.manifestInventory.render(manifest, inventory),
    };
  }

  private assertCommittedArtifacts(
    snapshot: WorkItemAuditSnapshot,
    expected: AuditCommitArtifacts,
    expectedLedger: AuditLedger,
  ): void {
    const actualLedger = this.validateInitializedSnapshot(snapshot);
    if (
      actualLedger.revision !== expectedLedger.revision ||
      snapshot.tracking.status !== 'INITIALIZED' ||
      snapshot.tracking.artifacts.ledger !== expected.ledger ||
      snapshot.tracking.artifacts.decisions !== expected.decisions ||
      snapshot.tracking.artifacts.checkpoints !== expected.checkpoints ||
      snapshot.tracking.artifacts.testing !== expected.testing ||
      snapshot.tracking.artifacts.evidenceReferences !== expected.evidenceReferences ||
      snapshot.manifest !== expected.manifest
    ) {
      throw new AuditLedgerCorruptError('The audit tracking data cannot be read safely.');
    }
  }

  private contentForTrackingType(
    artifacts: {
      decisions: string;
      checkpoints: string;
      testing: string;
      evidenceReferences: string;
    },
    trackingType: TrackingType,
  ): string {
    switch (trackingType) {
      case 'DECISIONS':
        return artifacts.decisions;
      case 'CHECKPOINTS':
        return artifacts.checkpoints;
      case 'TESTING':
        return artifacts.testing;
      case 'EVIDENCE_REFERENCES':
        return artifacts.evidenceReferences;
    }
  }
}
