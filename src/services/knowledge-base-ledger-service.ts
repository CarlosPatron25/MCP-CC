import { z } from 'zod';

import {
  KNOWLEDGE_BASE_SCHEMA_VERSION,
  KNOWLEDGE_CLASSIFICATIONS,
  KNOWLEDGE_EVENT_TYPES,
  KNOWLEDGE_OPERATIONS,
  KNOWLEDGE_PROVENANCE_SOURCES,
  SEMANTIC_OBSERVATION_SEVERITIES,
  SESSION_CHECKPOINT_KINDS,
  STRUCTURAL_REVIEW_RESULTS,
  TECHNICAL_SNAPSHOT_KINDS,
  WORK_ITEM_RELATION_TYPES,
  type AppendKnowledgeOperationRequest,
  type ConceptProposal,
  type KnowledgeBaseLedger,
  type KnowledgeBaseMutationResult,
  type KnowledgeBaseState,
  type KnowledgeEvent,
  type KnowledgeIdempotencyEntry,
  type KnowledgeOperation,
  type KnowledgeOperationName,
  type ParticipantRef,
  type ProjectConcept,
  type SemanticObservation,
  type SessionCheckpoint,
  type StructuralReview,
  type TechnicalSnapshot,
  type WorkItemKnowledgeState,
  type WorkItemRelation,
  type WorkSession,
} from '../domain/work-item-knowledge.js';
import { TECHNICAL_SNAPSHOT_CHANGE_TYPES } from '../domain/technical-snapshot.js';
import type { Clock } from './clock.js';
import { canonicalizeAuditPayload, fingerprintAuditPayload } from './audit-ledger-service.js';
import { isCanonicalUuidV4, type IdGenerator } from './id-generator.js';

const uuid = z.string().refine(isCanonicalUuidV4);
const isoTimestamp = z.string().refine((value) => {
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
});
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positiveInteger = safeInteger.refine((value) => value > 0);
const text = z.string().min(1).max(16_384);
const shortText = z.string().min(1).max(512);
const textList = z.array(text).max(100_000);
const uuidList = z.array(uuid).max(100_000);
const participantSchema = z
  .object({
    participantId: z.string().regex(/^[A-Za-z0-9._:@-]{1,128}$/u),
    displayName: shortText,
  })
  .strict();
const actorSchema = z.union([participantSchema, z.literal('SYSTEM')]);
const provenanceSchema = z
  .object({
    source: z.enum(KNOWLEDGE_PROVENANCE_SOURCES),
    introducedBy: participantSchema.optional(),
    confirmedBy: participantSchema.optional(),
    evidenceReferenceIds: uuidList.optional(),
    basedOnKnowledgeIds: uuidList.optional(),
  })
  .strict();
const iterationSchema = z
  .object({
    iterationId: shortText,
    displayName: shortText.optional(),
    storageToken: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
  })
  .strict();
const historicalMutationBoundarySchema = z
  .object({
    m3DocumentRevisions: z
      .object({
        MANIFEST: positiveInteger,
        FUNCTIONAL_ANALYSIS: positiveInteger,
        CURRENT_STATE: positiveInteger,
        TECHNICAL_ANALYSIS: positiveInteger,
        IMPACT_ANALYSIS: positiveInteger,
        IMPLEMENTATION_PLAN: positiveInteger,
        AI_CONTEXT: positiveInteger,
      })
      .strict(),
    m4AuditRevision: safeInteger,
  })
  .strict();
const snapshotFileSchema = z
  .object({
    relativePath: text,
    sha256,
    size: safeInteger,
    modifiedAt: isoTimestamp,
  })
  .strict();
const snapshotChangeSchema = z
  .object({
    relativePath: text,
    changeType: z.enum(TECHNICAL_SNAPSHOT_CHANGE_TYPES),
    previousSha256: sha256.optional(),
    currentSha256: sha256.optional(),
    baselineSha256: sha256.optional(),
  })
  .strict();
const snapshotExclusionSchema = z
  .object({
    relativePath: text,
    reason: z.enum(['EXCLUDED_DIRECTORY', 'FILESYSTEM_LINK', 'NON_REGULAR_ENTRY']),
  })
  .strict();
const gitFileSchema = z
  .object({
    relativePath: text,
    status: shortText,
    originalRelativePath: text.optional(),
  })
  .strict();
const gitSchema = z.union([
  z.object({ available: z.literal(false) }).strict(),
  z
    .object({
      available: z.literal(true),
      headCommit: z
        .string()
        .regex(/^[0-9a-f]{40,64}$/u)
        .optional(),
      files: z.array(gitFileSchema).max(100_000),
    })
    .strict(),
]);
const technicalSnapshotSchema = z
  .object({
    snapshotId: uuid,
    sessionId: uuid,
    kind: z.enum(TECHNICAL_SNAPSHOT_KINDS),
    capturedAt: isoTimestamp,
    files: z.array(snapshotFileSchema).max(100_000),
    changes: z.array(snapshotChangeSchema).max(100_000),
    git: gitSchema,
    exclusions: z.array(snapshotExclusionSchema).max(100_000),
    totalBytes: safeInteger,
  })
  .strict();
const consolidatedFunctionalSchema = z
  .object({
    purpose: text.optional(),
    actualBehavior: text.optional(),
    functionalFlow: textList,
    entryConditions: textList,
    businessRules: textList,
    testData: textList,
    relatedWorkItemIds: z.array(shortText).max(100_000),
  })
  .strict();
const consolidatedComponentSchema = z
  .object({
    name: shortText,
    type: shortText,
    responsibility: text,
    changes: textList,
  })
  .strict();
const consolidatedImplementationSchema = z
  .object({
    components: z.array(consolidatedComponentSchema).max(100_000),
    dependencies: textList,
    implementationDecisions: textList,
    technicalFlow: textList,
  })
  .strict();
const consolidatedTestScenarioSchema = z
  .object({
    title: shortText,
    steps: textList,
    expectedOutcome: text,
  })
  .strict();
const consolidatedTestingSchema = z
  .object({
    preconditions: textList,
    testData: textList,
    scenarios: z.array(consolidatedTestScenarioSchema).max(100_000),
    regressionChecks: textList,
    evidenceReferenceIds: uuidList,
    closureChecklist: textList,
  })
  .strict();
const consolidationSchema = z
  .object({
    consolidationId: uuid,
    workItemId: shortText,
    functionalOverview: consolidatedFunctionalSchema,
    implementation: consolidatedImplementationSchema,
    testing: consolidatedTestingSchema,
  })
  .strict();
const findingSchema = z.object({ code: shortText, message: text }).strict();

const eventPayloadSchemas = {
  WORKFLOW_INITIALIZED: z
    .object({
      workItemId: shortText,
      iteration: iterationSchema,
      responsible: participantSchema,
      classification: z.enum(KNOWLEDGE_CLASSIFICATIONS),
      initialStatus: z.literal('IN_PROGRESS'),
    })
    .strict(),
  SESSION_ACTIVATED: z
    .object({
      sessionId: uuid,
      developer: participantSchema,
      workItemId: shortText,
      activationSnapshotId: uuid,
      previousCheckpointId: uuid.optional(),
    })
    .strict(),
  SESSION_SUSPENDED: z.object({ sessionId: uuid, checkpointId: uuid }).strict(),
  SESSION_CHECKPOINT_RECORDED: z
    .object({
      checkpointId: uuid,
      sessionId: uuid,
      workItemId: shortText,
      snapshotId: uuid,
      kind: z.enum(SESSION_CHECKPOINT_KINDS),
      observedWork: textList,
      relevantContext: textList,
      pendingQuestions: textList,
      semanticSummary: text.optional(),
    })
    .strict(),
  TECHNICAL_SNAPSHOT_RECORDED: z.object({ snapshot: technicalSnapshotSchema }).strict(),
  COLLABORATOR_ADDED: z.object({ workItemId: shortText, collaborator: participantSchema }).strict(),
  COLLABORATOR_REMOVED: z
    .object({ workItemId: shortText, participantId: shortText, reason: text })
    .strict(),
  RESPONSIBILITY_TRANSFERRED: z
    .object({
      workItemId: shortText,
      previousResponsibleId: shortText,
      newResponsible: participantSchema,
      reason: text,
      confirmation: z.literal(true),
    })
    .strict(),
  KNOWLEDGE_CONSOLIDATED: z.object({ consolidation: consolidationSchema }).strict(),
  RELATION_ADDED: z
    .object({
      relationId: uuid,
      relationType: z.enum(WORK_ITEM_RELATION_TYPES),
      sourceWorkItemId: shortText,
      targetWorkItemId: shortText,
      explanation: text,
      evidenceReferenceIds: uuidList.optional(),
    })
    .strict(),
  RELATION_REMOVED: z.object({ relationId: uuid, reason: text }).strict(),
  CONCEPT_PROPOSED: z
    .object({
      proposalId: uuid,
      workItemId: shortText,
      normalizedName: shortText,
      displayName: shortText,
      explanation: text,
      evidenceReferenceIds: uuidList,
      evidenceFingerprint: sha256,
      proposedBy: participantSchema,
    })
    .strict(),
  CONCEPT_PROPOSAL_RESOLVED: z
    .object({
      proposalId: uuid,
      resolution: z.enum(['APPROVED', 'REJECTED']),
      resolvedBy: participantSchema,
      resolutionReason: text,
      confirmation: z.boolean(),
    })
    .strict(),
  STRUCTURAL_REVIEW_RECORDED: z
    .object({
      reviewId: uuid,
      workItemId: shortText,
      result: z.enum(STRUCTURAL_REVIEW_RESULTS),
      findings: z.array(findingSchema).max(10_000),
    })
    .strict(),
  SEMANTIC_OBSERVATION_RECORDED: z
    .object({
      observationId: uuid,
      workItemId: shortText,
      severity: z.enum(SEMANTIC_OBSERVATION_SEVERITIES),
      explanation: text,
      evidenceReferenceIds: uuidList.optional(),
    })
    .strict(),
  SEMANTIC_OBSERVATION_RESOLVED: z
    .object({
      observationId: uuid,
      workItemId: shortText,
      resolvedBy: participantSchema,
      resolution: text,
    })
    .strict(),
  WORK_ITEM_COMPLETED: z
    .object({
      workItemId: shortText,
      responsibleId: shortText,
      structuralReviewId: uuid,
      historicalMutationBoundary: historicalMutationBoundarySchema,
      confirmation: z.literal(true),
    })
    .strict(),
  WORK_ITEM_REOPENED: z
    .object({
      workItemId: shortText,
      reason: text,
      trigger: shortText,
      explicit: z.boolean(),
      confirmation: z.boolean(),
    })
    .strict(),
  WORK_ITEM_CANCELLED: z
    .object({
      workItemId: shortText,
      responsibleId: shortText,
      reason: text,
      confirmation: z.literal(true),
    })
    .strict(),
} satisfies Record<(typeof KNOWLEDGE_EVENT_TYPES)[number], z.ZodType>;

const persistedEventSchema = z
  .object({
    eventId: uuid,
    eventType: z.enum(KNOWLEDGE_EVENT_TYPES),
    provenance: provenanceSchema,
    payload: z.unknown(),
  })
  .strict()
  .superRefine((event, context) => {
    const parsed = eventPayloadSchemas[event.eventType].safeParse(event.payload);
    if (!parsed.success) {
      context.addIssue({ code: 'custom', path: ['payload'], message: 'Invalid event payload.' });
    }
  });
const operationSchema = z
  .object({
    operationId: uuid,
    knowledgeRevision: positiveInteger,
    operation: z.enum(KNOWLEDGE_OPERATIONS),
    idempotencyKey: uuid,
    payloadFingerprint: sha256,
    recordedAt: isoTimestamp,
    actor: actorSchema,
    events: z.array(persistedEventSchema).min(1).max(100_000),
  })
  .strict();
const idempotencySchema = z
  .object({
    idempotencyKey: uuid,
    operation: z.enum(KNOWLEDGE_OPERATIONS),
    operationId: uuid,
    payloadFingerprint: sha256,
    resultingKnowledgeRevision: positiveInteger,
  })
  .strict();
const ledgerSchema = z
  .object({
    schemaVersion: z.literal(KNOWLEDGE_BASE_SCHEMA_VERSION),
    knowledgeRevision: safeInteger,
    updatedAt: isoTimestamp,
    operations: z.array(operationSchema).max(1_000_000),
    idempotencyIndex: z.array(idempotencySchema).max(1_000_000),
  })
  .strict();
const eventInputSchema = z
  .object({
    eventType: z.enum(KNOWLEDGE_EVENT_TYPES),
    provenance: provenanceSchema,
    payload: z.unknown(),
  })
  .strict()
  .superRefine((event, context) => {
    const parsed = eventPayloadSchemas[event.eventType].safeParse(event.payload);
    if (!parsed.success) {
      context.addIssue({ code: 'custom', path: ['payload'], message: 'Invalid event payload.' });
    }
  });

export type KnowledgeBaseLedgerErrorCode =
  'WORKFLOW_CORRUPT' | 'WORKFLOW_REVISION_CONFLICT' | 'WORKFLOW_IDEMPOTENCY_CONFLICT';

export class KnowledgeBaseLedgerError extends Error {
  public constructor(
    public readonly code: KnowledgeBaseLedgerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'KnowledgeBaseLedgerError';
  }
}

function corrupt(): KnowledgeBaseLedgerError {
  return new KnowledgeBaseLedgerError(
    'WORKFLOW_CORRUPT',
    'The Milestone 5 knowledge ledger cannot be read safely.',
  );
}

function cloneParticipant(value: ParticipantRef): ParticipantRef {
  return { participantId: value.participantId, displayName: value.displayName };
}

function workItemIdsForEvent(event: KnowledgeEvent): string[] {
  const payload = event.payload as unknown as Record<string, unknown>;
  if (event.eventType === 'RELATION_ADDED') {
    return [String(payload.sourceWorkItemId), String(payload.targetWorkItemId)];
  }
  if (event.eventType === 'RELATION_REMOVED' || event.eventType.startsWith('CONCEPT_')) {
    return [];
  }
  if (event.eventType === 'TECHNICAL_SNAPSHOT_RECORDED') {
    return [];
  }
  return typeof payload.workItemId === 'string' ? [payload.workItemId] : [];
}

/**
 * Strict, filesystem-independent owner of the single M5 append-only ledger.
 */
export class KnowledgeBaseLedgerService {
  public constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  public createEmptyLedger(): KnowledgeBaseLedger {
    return {
      schemaVersion: KNOWLEDGE_BASE_SCHEMA_VERSION,
      knowledgeRevision: 0,
      updatedAt: this.timestamp(),
      operations: [],
      idempotencyIndex: [],
    };
  }

  public parse(content: string): KnowledgeBaseLedger {
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      throw corrupt();
    }
    const parsed = ledgerSchema.safeParse(value);
    if (
      !parsed.success ||
      canonicalizeAuditPayload(value) !== canonicalizeAuditPayload(parsed.data)
    ) {
      throw corrupt();
    }
    const ledger = parsed.data as unknown as KnowledgeBaseLedger;
    this.validate(ledger);
    return ledger;
  }

  public serialize(ledger: KnowledgeBaseLedger): string {
    this.validate(ledger);
    return JSON.stringify(ledger, null, 2) + '\n';
  }

  public validate(ledger: KnowledgeBaseLedger): void {
    const parsed = ledgerSchema.safeParse(ledger);
    if (
      !parsed.success ||
      canonicalizeAuditPayload(ledger) !== canonicalizeAuditPayload(parsed.data)
    ) {
      throw corrupt();
    }
    if (
      ledger.knowledgeRevision !== ledger.operations.length ||
      ledger.idempotencyIndex.length !== ledger.operations.length ||
      (ledger.operations.length > 0 && ledger.updatedAt !== ledger.operations.at(-1)?.recordedAt)
    ) {
      throw corrupt();
    }
    const operationIds = new Set<string>();
    const eventIds = new Set<string>();
    const idempotencyKeys = new Set<string>();
    for (let index = 0; index < ledger.operations.length; index += 1) {
      const operation = ledger.operations[index];
      const idempotency = ledger.idempotencyIndex[index];
      if (
        operation === undefined ||
        idempotency === undefined ||
        operation.knowledgeRevision !== index + 1 ||
        idempotency.resultingKnowledgeRevision !== index + 1 ||
        operation.operationId !== idempotency.operationId ||
        operation.operation !== idempotency.operation ||
        operation.idempotencyKey !== idempotency.idempotencyKey ||
        operation.payloadFingerprint !== idempotency.payloadFingerprint ||
        operationIds.has(operation.operationId) ||
        idempotencyKeys.has(operation.idempotencyKey)
      ) {
        throw corrupt();
      }
      operationIds.add(operation.operationId);
      idempotencyKeys.add(operation.idempotencyKey);
      for (const event of operation.events) {
        if (eventIds.has(event.eventId)) {
          throw corrupt();
        }
        eventIds.add(event.eventId);
      }
    }
    this.projectStateUnchecked(ledger);
  }

  public appendOperation(
    ledger: KnowledgeBaseLedger,
    request: AppendKnowledgeOperationRequest,
    fingerprintPayload?: unknown,
  ): KnowledgeBaseMutationResult {
    this.validate(ledger);
    if (
      !isCanonicalUuidV4(request.idempotencyKey) ||
      !(KNOWLEDGE_OPERATIONS as readonly string[]).includes(request.operation) ||
      !Number.isSafeInteger(request.expectedKnowledgeRevision) ||
      request.expectedKnowledgeRevision < 0 ||
      request.events.length === 0 ||
      request.events.some((event) => !eventInputSchema.safeParse(event).success) ||
      !actorSchema.safeParse(request.actor).success
    ) {
      throw corrupt();
    }
    const payloadFingerprint = this.operationFingerprint(
      request.operation,
      fingerprintPayload ?? request,
    );
    const retry = this.findIdempotentOperation(
      ledger,
      request.operation,
      request.idempotencyKey,
      fingerprintPayload ?? request,
    );
    if (retry !== undefined) {
      return retry;
    }
    if (request.expectedKnowledgeRevision !== ledger.knowledgeRevision) {
      throw new KnowledgeBaseLedgerError(
        'WORKFLOW_REVISION_CONFLICT',
        'The expected Milestone 5 knowledge revision is stale.',
      );
    }
    const recordedAt = this.timestamp();
    const operation: KnowledgeOperation = {
      operationId: this.uuid(),
      knowledgeRevision: ledger.knowledgeRevision + 1,
      operation: request.operation,
      idempotencyKey: request.idempotencyKey,
      payloadFingerprint,
      recordedAt,
      actor: request.actor === 'SYSTEM' ? 'SYSTEM' : cloneParticipant(request.actor),
      events: request.events.map(
        (event): KnowledgeEvent =>
          ({
            eventId: this.uuid(),
            eventType: event.eventType,
            provenance: event.provenance,
            payload: event.payload,
          }) as KnowledgeEvent,
      ),
    };
    const index: KnowledgeIdempotencyEntry = {
      idempotencyKey: request.idempotencyKey,
      operation: request.operation,
      operationId: operation.operationId,
      payloadFingerprint,
      resultingKnowledgeRevision: operation.knowledgeRevision,
    };
    const next: KnowledgeBaseLedger = {
      schemaVersion: KNOWLEDGE_BASE_SCHEMA_VERSION,
      knowledgeRevision: operation.knowledgeRevision,
      updatedAt: recordedAt,
      operations: [...ledger.operations, operation],
      idempotencyIndex: [...ledger.idempotencyIndex, index],
    };
    this.validate(next);
    return {
      ledger: next,
      knowledgeOperation: operation,
      knowledgeRevision: next.knowledgeRevision,
      idempotent: false,
    };
  }

  public findIdempotentOperation(
    ledger: KnowledgeBaseLedger,
    operationName: KnowledgeOperationName,
    idempotencyKey: string,
    fingerprintPayload: unknown,
  ): KnowledgeBaseMutationResult | undefined {
    this.validate(ledger);
    const existingIndex = ledger.idempotencyIndex.find(
      (entry) => entry.idempotencyKey === idempotencyKey,
    );
    if (existingIndex === undefined) {
      return undefined;
    }
    const payloadFingerprint = this.operationFingerprint(operationName, fingerprintPayload);
    if (
      existingIndex.operation !== operationName ||
      existingIndex.payloadFingerprint !== payloadFingerprint
    ) {
      throw new KnowledgeBaseLedgerError(
        'WORKFLOW_IDEMPOTENCY_CONFLICT',
        'The Milestone 5 idempotency key was reused with a different payload.',
      );
    }
    const operation = ledger.operations.find(
      (entry) => entry.operationId === existingIndex.operationId,
    );
    if (operation === undefined) {
      throw corrupt();
    }
    const operations = ledger.operations.slice(0, existingIndex.resultingKnowledgeRevision);
    const operationAtRevision = operations.at(-1);
    if (
      operationAtRevision === undefined ||
      operationAtRevision.knowledgeRevision !== existingIndex.resultingKnowledgeRevision
    ) {
      throw corrupt();
    }
    const ledgerAtResultRevision: KnowledgeBaseLedger = {
      schemaVersion: ledger.schemaVersion,
      knowledgeRevision: existingIndex.resultingKnowledgeRevision,
      updatedAt: operationAtRevision.recordedAt,
      operations,
      idempotencyIndex: ledger.idempotencyIndex.filter(
        (entry) => entry.resultingKnowledgeRevision <= existingIndex.resultingKnowledgeRevision,
      ),
    };
    this.validate(ledgerAtResultRevision);
    return {
      ledger: ledgerAtResultRevision,
      knowledgeOperation: operation,
      knowledgeRevision: existingIndex.resultingKnowledgeRevision,
      idempotent: true,
    };
  }

  public projectState(ledger: KnowledgeBaseLedger): KnowledgeBaseState {
    this.validate(ledger);
    return this.projectStateUnchecked(ledger);
  }

  private projectStateUnchecked(ledger: KnowledgeBaseLedger): KnowledgeBaseState {
    const workItems = new Map<string, WorkItemKnowledgeState>();
    const sessions = new Map<string, WorkSession>();
    const snapshots: TechnicalSnapshot[] = [];
    const checkpoints: SessionCheckpoint[] = [];
    const relations = new Map<string, WorkItemRelation>();
    const proposals = new Map<string, ConceptProposal>();
    const concepts = new Map<string, ProjectConcept>();
    const reviews: StructuralReview[] = [];
    const observations = new Map<string, SemanticObservation>();
    const workItemRevisions: Record<string, number> = {};
    const developerRevisions: Record<string, number> = {};
    let catalogRevision = 0;

    for (const operation of ledger.operations) {
      const affectedWorkItems = new Set<string>();
      const affectedDevelopers = new Set<string>();
      let catalogChanged = false;
      for (const event of operation.events) {
        for (const workItemId of workItemIdsForEvent(event)) {
          affectedWorkItems.add(workItemId);
        }
        switch (event.eventType) {
          case 'WORKFLOW_INITIALIZED': {
            const payload = event.payload;
            if (workItems.has(payload.workItemId)) {
              throw corrupt();
            }
            workItems.set(payload.workItemId, {
              workItemId: payload.workItemId,
              iteration: payload.iteration,
              status: payload.initialStatus,
              classification: payload.classification,
              responsible: payload.responsible,
              collaborators: [],
              responsibilityHistory: [],
            });
            break;
          }
          case 'TECHNICAL_SNAPSHOT_RECORDED': {
            if (snapshots.some((entry) => entry.snapshotId === event.payload.snapshot.snapshotId)) {
              throw corrupt();
            }
            snapshots.push(event.payload.snapshot);
            break;
          }
          case 'SESSION_ACTIVATED': {
            const payload = event.payload;
            if (
              !workItems.has(payload.workItemId) ||
              sessions.has(payload.sessionId) ||
              !snapshots.some(
                (entry) =>
                  entry.snapshotId === payload.activationSnapshotId &&
                  entry.sessionId === payload.sessionId &&
                  entry.kind === 'ACTIVATION',
              ) ||
              [...sessions.values()].some(
                (entry) =>
                  entry.status === 'ACTIVE' &&
                  entry.developer.participantId === payload.developer.participantId,
              )
            ) {
              throw corrupt();
            }
            const workflow = this.requireWorkItem(workItems, payload.workItemId);
            if (
              workflow.status !== 'IN_PROGRESS' ||
              (workflow.responsible.participantId !== payload.developer.participantId &&
                !workflow.collaborators.some(
                  (entry) => entry.participantId === payload.developer.participantId,
                ))
            ) {
              throw corrupt();
            }
            sessions.set(payload.sessionId, {
              sessionId: payload.sessionId,
              developer: payload.developer,
              workItemId: payload.workItemId,
              status: 'ACTIVE',
              activatedAt: operation.recordedAt,
              activationSnapshotId: payload.activationSnapshotId,
              ...(payload.previousCheckpointId === undefined
                ? {}
                : { lastCheckpointId: payload.previousCheckpointId }),
            });
            affectedDevelopers.add(payload.developer.participantId);
            break;
          }
          case 'SESSION_CHECKPOINT_RECORDED': {
            const payload = event.payload;
            const session = sessions.get(payload.sessionId);
            if (
              session === undefined ||
              session.workItemId !== payload.workItemId ||
              !snapshots.some((entry) => entry.snapshotId === payload.snapshotId) ||
              checkpoints.some((entry) => entry.checkpointId === payload.checkpointId)
            ) {
              throw corrupt();
            }
            const checkpoint: SessionCheckpoint = {
              ...payload,
              provenance: event.provenance,
              recordedAt: operation.recordedAt,
            };
            checkpoints.push(checkpoint);
            sessions.set(payload.sessionId, { ...session, lastCheckpointId: payload.checkpointId });
            affectedDevelopers.add(session.developer.participantId);
            break;
          }
          case 'SESSION_SUSPENDED': {
            const payload = event.payload;
            const session = sessions.get(payload.sessionId);
            if (
              session === undefined ||
              session.status !== 'ACTIVE' ||
              !checkpoints.some(
                (entry) =>
                  entry.checkpointId === payload.checkpointId &&
                  entry.sessionId === payload.sessionId,
              )
            ) {
              throw corrupt();
            }
            sessions.set(payload.sessionId, {
              ...session,
              status: 'SUSPENDED',
              suspendedAt: operation.recordedAt,
              lastCheckpointId: payload.checkpointId,
            });
            affectedWorkItems.add(session.workItemId);
            affectedDevelopers.add(session.developer.participantId);
            break;
          }
          case 'COLLABORATOR_ADDED': {
            const payload = event.payload;
            const item = this.requireWorkItem(workItems, payload.workItemId);
            if (
              item.responsible.participantId === payload.collaborator.participantId ||
              item.collaborators.some(
                (entry) => entry.participantId === payload.collaborator.participantId,
              )
            ) {
              throw corrupt();
            }
            workItems.set(payload.workItemId, {
              ...item,
              collaborators: [...item.collaborators, payload.collaborator].sort((left, right) =>
                left.participantId.localeCompare(right.participantId),
              ),
            });
            break;
          }
          case 'COLLABORATOR_REMOVED': {
            const payload = event.payload;
            const item = this.requireWorkItem(workItems, payload.workItemId);
            if (
              !item.collaborators.some((entry) => entry.participantId === payload.participantId)
            ) {
              throw corrupt();
            }
            workItems.set(payload.workItemId, {
              ...item,
              collaborators: item.collaborators.filter(
                (entry) => entry.participantId !== payload.participantId,
              ),
            });
            break;
          }
          case 'RESPONSIBILITY_TRANSFERRED': {
            const payload = event.payload;
            const item = this.requireWorkItem(workItems, payload.workItemId);
            if (item.responsible.participantId !== payload.previousResponsibleId) {
              throw corrupt();
            }
            workItems.set(payload.workItemId, {
              ...item,
              responsible: payload.newResponsible,
              collaborators: item.collaborators.filter(
                (entry) => entry.participantId !== payload.newResponsible.participantId,
              ),
              responsibilityHistory: [
                ...item.responsibilityHistory,
                {
                  previousResponsible: item.responsible,
                  newResponsible: payload.newResponsible,
                  reason: payload.reason,
                  transferredAt: operation.recordedAt,
                  actor: operation.actor === 'SYSTEM' ? item.responsible : operation.actor,
                },
              ],
            });
            break;
          }
          case 'KNOWLEDGE_CONSOLIDATED': {
            const payload = event.payload;
            const item = this.requireWorkItem(workItems, payload.consolidation.workItemId);
            workItems.set(item.workItemId, {
              ...item,
              latestConsolidation: payload.consolidation,
            });
            break;
          }
          case 'RELATION_ADDED': {
            const payload = event.payload;
            if (
              !workItems.has(payload.sourceWorkItemId) ||
              !workItems.has(payload.targetWorkItemId) ||
              relations.has(payload.relationId)
            ) {
              throw corrupt();
            }
            if (
              payload.relationType === 'RELATED_TO' &&
              payload.sourceWorkItemId > payload.targetWorkItemId
            ) {
              throw corrupt();
            }
            relations.set(payload.relationId, {
              ...payload,
              provenance: event.provenance,
              status: 'ACTIVE',
              recordedAt: operation.recordedAt,
            });
            break;
          }
          case 'RELATION_REMOVED': {
            const payload = event.payload;
            const relation = relations.get(payload.relationId);
            if (relation === undefined || relation.status !== 'ACTIVE') {
              throw corrupt();
            }
            relations.set(payload.relationId, {
              ...relation,
              status: 'REMOVED',
              removedAt: operation.recordedAt,
              removalReason: payload.reason,
            });
            affectedWorkItems.add(relation.sourceWorkItemId);
            affectedWorkItems.add(relation.targetWorkItemId);
            break;
          }
          case 'CONCEPT_PROPOSED': {
            const payload = event.payload;
            if (!workItems.has(payload.workItemId) || proposals.has(payload.proposalId)) {
              throw corrupt();
            }
            proposals.set(payload.proposalId, {
              ...payload,
              status: 'PENDING',
              recordedAt: operation.recordedAt,
            });
            affectedWorkItems.add(payload.workItemId);
            catalogChanged = true;
            break;
          }
          case 'CONCEPT_PROPOSAL_RESOLVED': {
            const payload = event.payload;
            const proposal = proposals.get(payload.proposalId);
            if (
              proposal === undefined ||
              proposal.status !== 'PENDING' ||
              (payload.resolution === 'APPROVED' && !payload.confirmation)
            ) {
              throw corrupt();
            }
            proposals.set(payload.proposalId, {
              ...proposal,
              status: payload.resolution,
              resolvedBy: payload.resolvedBy,
              resolutionReason: payload.resolutionReason,
              resolvedAt: operation.recordedAt,
            });
            affectedWorkItems.add(proposal.workItemId);
            if (payload.resolution === 'APPROVED') {
              if (
                [...concepts.values()].some(
                  (entry) => entry.normalizedName === proposal.normalizedName,
                )
              ) {
                throw corrupt();
              }
              concepts.set(event.eventId, {
                conceptId: event.eventId,
                normalizedName: proposal.normalizedName,
                displayName: proposal.displayName,
                explanation: proposal.explanation,
                approvedProposalId: proposal.proposalId,
                approvedBy: payload.resolvedBy,
                approvedAt: operation.recordedAt,
              });
            }
            catalogChanged = true;
            break;
          }
          case 'STRUCTURAL_REVIEW_RECORDED': {
            const payload = event.payload;
            const item = this.requireWorkItem(workItems, payload.workItemId);
            const review: StructuralReview = {
              ...payload,
              recordedAt: operation.recordedAt,
              workItemRevision: (workItemRevisions[payload.workItemId] ?? 0) + 1,
            };
            reviews.push(review);
            workItems.set(payload.workItemId, { ...item, latestStructuralReview: review });
            break;
          }
          case 'SEMANTIC_OBSERVATION_RECORDED': {
            const payload = event.payload;
            this.requireWorkItem(workItems, payload.workItemId);
            if (observations.has(payload.observationId)) {
              throw corrupt();
            }
            observations.set(payload.observationId, {
              ...payload,
              provenance: event.provenance,
              recordedAt: operation.recordedAt,
              status: 'OPEN',
            });
            break;
          }
          case 'SEMANTIC_OBSERVATION_RESOLVED': {
            const payload = event.payload;
            const observation = observations.get(payload.observationId);
            if (
              observation === undefined ||
              observation.workItemId !== payload.workItemId ||
              observation.status !== 'OPEN'
            ) {
              throw corrupt();
            }
            observations.set(payload.observationId, {
              ...observation,
              status: 'RESOLVED',
              resolvedAt: operation.recordedAt,
              resolvedBy: payload.resolvedBy,
              resolution: payload.resolution,
            });
            affectedWorkItems.add(observation.workItemId);
            break;
          }
          case 'WORK_ITEM_COMPLETED': {
            const payload = event.payload;
            const item = this.requireWorkItem(workItems, payload.workItemId);
            if (
              item.status !== 'IN_PROGRESS' ||
              item.responsible.participantId !== payload.responsibleId ||
              item.latestStructuralReview?.reviewId !== payload.structuralReviewId ||
              item.latestStructuralReview.result !== 'PASSED' ||
              item.latestStructuralReview.workItemRevision !==
                (workItemRevisions[payload.workItemId] ?? 0) ||
              [...sessions.values()].some(
                (session) =>
                  session.workItemId === payload.workItemId && session.status === 'ACTIVE',
              )
            ) {
              throw corrupt();
            }
            workItems.set(payload.workItemId, {
              ...item,
              status: 'COMPLETED',
              completedAt: operation.recordedAt,
              lastCompletionBoundary: payload.historicalMutationBoundary,
            });
            break;
          }
          case 'WORK_ITEM_REOPENED': {
            const payload = event.payload;
            const item = this.requireWorkItem(workItems, payload.workItemId);
            if (item.status === 'IN_PROGRESS') {
              throw corrupt();
            }
            workItems.set(payload.workItemId, {
              ...item,
              status: 'IN_PROGRESS',
              lastReopenedAt: operation.recordedAt,
            });
            break;
          }
          case 'WORK_ITEM_CANCELLED': {
            const payload = event.payload;
            const item = this.requireWorkItem(workItems, payload.workItemId);
            if (
              item.status !== 'IN_PROGRESS' ||
              item.responsible.participantId !== payload.responsibleId
            ) {
              throw corrupt();
            }
            workItems.set(payload.workItemId, {
              ...item,
              status: 'CANCELLED',
              cancelledAt: operation.recordedAt,
            });
            break;
          }
        }
      }
      for (const workItemId of affectedWorkItems) {
        if (!workItems.has(workItemId)) {
          throw corrupt();
        }
        workItemRevisions[workItemId] = (workItemRevisions[workItemId] ?? 0) + 1;
      }
      for (const developerId of affectedDevelopers) {
        developerRevisions[developerId] = (developerRevisions[developerId] ?? 0) + 1;
      }
      if (catalogChanged) {
        catalogRevision += 1;
      }
    }

    return {
      knowledgeRevision: ledger.knowledgeRevision,
      workItems: [...workItems.values()].sort((left, right) =>
        left.workItemId.localeCompare(right.workItemId),
      ),
      sessions: [...sessions.values()].sort((left, right) =>
        left.sessionId.localeCompare(right.sessionId),
      ),
      snapshots: [...snapshots],
      checkpoints: [...checkpoints],
      relations: [...relations.values()].sort((left, right) =>
        left.relationId.localeCompare(right.relationId),
      ),
      conceptProposals: [...proposals.values()].sort((left, right) =>
        left.proposalId.localeCompare(right.proposalId),
      ),
      concepts: [...concepts.values()].sort((left, right) =>
        left.normalizedName.localeCompare(right.normalizedName),
      ),
      structuralReviews: reviews,
      semanticObservations: [...observations.values()].sort((left, right) =>
        left.observationId.localeCompare(right.observationId),
      ),
      workItemRevisions,
      developerRevisions,
      catalogRevision,
    };
  }

  private requireWorkItem(
    workItems: ReadonlyMap<string, WorkItemKnowledgeState>,
    workItemId: string,
  ): WorkItemKnowledgeState {
    const item = workItems.get(workItemId);
    if (item === undefined) {
      throw corrupt();
    }
    return item;
  }

  private timestamp(): string {
    const value = this.clock.now();
    if (!isoTimestamp.safeParse(value).success) {
      throw corrupt();
    }
    return value;
  }

  private uuid(): string {
    const value = this.idGenerator.generate();
    if (!isCanonicalUuidV4(value)) {
      throw corrupt();
    }
    return value;
  }

  private operationFingerprint(
    operation: KnowledgeOperationName,
    fingerprintPayload: unknown,
  ): string {
    return fingerprintAuditPayload({ operation, payload: fingerprintPayload });
  }
}
