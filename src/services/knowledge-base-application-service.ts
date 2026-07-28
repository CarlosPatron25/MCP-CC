import type { z } from 'zod';

import type { WorkItem } from '../domain/work-item.js';
import { MANAGED_DOCUMENT_TYPES, type ManagedDocumentType } from '../domain/work-item-document.js';
import {
  canonicalRelationEndpoints,
  inverseRelationType,
  type AppendKnowledgeOperationRequest,
  type KnowledgeBaseLedger,
  type KnowledgeBaseMutationResult,
  type KnowledgeBaseState,
  type KnowledgeClassification,
  type KnowledgeEventInput,
  type KnowledgeEventPayloadMap,
  type KnowledgeEventType,
  type KnowledgeOperation,
  type KnowledgeOperationName,
  type KnowledgeProvenance,
  type ParticipantRef,
  type TechnicalSnapshot,
  type WorkItemKnowledgeState,
} from '../domain/work-item-knowledge.js';
import { WorkspaceError } from '../errors/workspace-error.js';
import type {
  KnowledgeBaseRepository,
  KnowledgeBaseRepositorySnapshot,
  KnowledgeDossierReplacement,
} from './knowledge-base-repository.js';
import { diffTechnicalSnapshotFiles } from '../domain/technical-snapshot.js';
import {
  ADD_COLLABORATOR_SCHEMA,
  ADD_RELATION_SCHEMA,
  ACTIVATE_SESSION_SCHEMA,
  CANCEL_WORK_ITEM_SCHEMA,
  COMPLETE_WORK_ITEM_SCHEMA,
  CONSOLIDATE_DOSSIER_SCHEMA,
  GET_ACTIVE_SESSION_SCHEMA,
  GET_RELATED_KNOWLEDGE_SCHEMA,
  GET_WORKFLOW_SCHEMA,
  INITIALIZE_WORKFLOW_SCHEMA,
  PROPOSE_CONCEPT_SCHEMA,
  RECORD_SESSION_CHECKPOINT_SCHEMA,
  REMOVE_COLLABORATOR_SCHEMA,
  REMOVE_RELATION_SCHEMA,
  REOPEN_WORK_ITEM_SCHEMA,
  RESOLVE_CONCEPT_SCHEMA,
  RESOLVE_SEMANTIC_OBSERVATION_SCHEMA,
  RESUME_SESSION_CONTEXT_SCHEMA,
  REVIEW_WORK_ITEM_SCHEMA,
  SUSPEND_SESSION_SCHEMA,
  SWITCH_SESSION_SCHEMA,
  TRANSFER_RESPONSIBILITY_SCHEMA,
} from '../mcp/m5-input-schemas.js';
import { fingerprintAuditPayload } from './audit-ledger-service.js';
import type { Clock } from './clock.js';
import type { IdGenerator } from './id-generator.js';
import type { KnowledgeBaseLedgerService } from './knowledge-base-ledger-service.js';
import {
  ManifestSectionCompositor,
  parseDocumentLifecycleInventorySection,
} from './manifest-section-compositor.js';
import { parseM4ManifestInventorySection } from './m4-manifest-inventory-service.js';
import { M5_PROJECTION_PATHS, type M5ProjectionService } from './m5-projection-service.js';
import type { ProjectObservation } from './project-observation.js';
import { serializeWorkItemYml } from './work-item-creation-service.js';
import type { WorkItemAuditService } from './work-item-audit-service.js';
import { inspectWorkItemV2BootstrapMarker } from './work-item-v2-bootstrap-marker.js';

interface MutationInput {
  expectedKnowledgeRevision: number;
  idempotencyKey: string;
  actor: ParticipantRef;
}

interface BuiltMutation<Result> {
  events: KnowledgeEventInput[];
  affectedWorkItemIds: string[];
  result: (mutation: KnowledgeBaseMutationResult) => Result;
}

type M4ExternalMutationTrigger =
  | 'record_decision'
  | 'record_checkpoint'
  | 'define_test_plan'
  | 'record_test_execution'
  | 'register_evidence_reference';

type ExternalMutationBridgeInput = {
  workItemId: string;
  idempotencyKey: string;
} & (
  | {
      trigger: 'update_work_item_document';
      cursor: {
        source: 'M3_DOCUMENT';
        documentType: ManagedDocumentType;
        revision: number;
      };
    }
  | {
      trigger: M4ExternalMutationTrigger;
      cursor: {
        source: 'M4_AUDIT_ENTRY';
        entryId: string;
        auditRevision: number;
      };
    }
);

const MATERIAL_OPERATIONS = new Set<KnowledgeOperationName>([
  'activate_work_session',
  'switch_work_session',
  'record_session_checkpoint',
  'suspend_work_session',
  'add_work_item_collaborator',
  'remove_work_item_collaborator',
  'transfer_work_item_responsibility',
  'consolidate_work_item_dossier',
  'add_work_item_relation',
  'remove_work_item_relation',
  'propose_project_concept',
  'resolve_project_concept_proposal',
  'review_work_item',
  'resolve_semantic_observation',
]);

function classificationPriority(classification: KnowledgeClassification): number {
  return classification === 'GOLDEN' ? 2 : classification === 'IMPORTED_PENDING_VALIDATION' ? 1 : 0;
}

function affectedWorkItemIds(operation: KnowledgeOperation): string[] {
  const workItemIds = new Set<string>();
  for (const event of operation.events) {
    const payload = event.payload as unknown as Record<string, unknown>;
    for (const field of ['workItemId', 'sourceWorkItemId', 'targetWorkItemId'] as const) {
      const value = payload[field];
      if (typeof value === 'string') {
        workItemIds.add(value);
      }
    }
  }
  return [...workItemIds].sort((left, right) => left.localeCompare(right));
}

function collectEvidenceReferenceIds(value: unknown, target: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectEvidenceReferenceIds(entry, target);
    }
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'evidenceReferenceIds' && Array.isArray(entry)) {
      for (const identifier of entry) {
        if (typeof identifier === 'string') {
          target.add(identifier);
        }
      }
    } else {
      collectEvidenceReferenceIds(entry, target);
    }
  }
}

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new WorkspaceError('M5_UPDATE_FAILED', 'The Milestone 5 request is invalid.', {
      field: parsed.error.issues[0]?.path.join('.') || 'input',
    });
  }
  return parsed.data;
}

function workflowNotInitialized(workItemId: string): WorkspaceError {
  return new WorkspaceError(
    'WORKFLOW_NOT_INITIALIZED',
    'Milestone 5 workflow has not been initialized for this Work Item.',
    { workItemId },
  );
}

function workflowFor(state: KnowledgeBaseState, workItemId: string): WorkItemKnowledgeState {
  const workflow = state.workItems.find((entry) => entry.workItemId === workItemId);
  if (workflow === undefined) {
    throw workflowNotInitialized(workItemId);
  }
  return workflow;
}

function actorMatches(left: ParticipantRef, right: ParticipantRef): boolean {
  return left.participantId === right.participantId;
}

function requireResponsible(workflow: WorkItemKnowledgeState, actor: ParticipantRef): void {
  if (!actorMatches(workflow.responsible, actor)) {
    throw new WorkspaceError(
      'PARTICIPANT_NOT_AUTHORIZED',
      'Only the declared principal may perform this operation.',
    );
  }
}

function requireParticipant(workflow: WorkItemKnowledgeState, actor: ParticipantRef): void {
  if (
    !actorMatches(workflow.responsible, actor) &&
    !workflow.collaborators.some((entry) => actorMatches(entry, actor))
  ) {
    throw new WorkspaceError(
      'PARTICIPANT_NOT_AUTHORIZED',
      'The declared actor is not a participant in this Work Item.',
    );
  }
}

function manualProvenance(actor: ParticipantRef): KnowledgeProvenance {
  return { source: 'MANUAL', introducedBy: actor };
}

function systemProvenance(): KnowledgeProvenance {
  return { source: 'SYSTEM_CALCULATED' };
}

function normalizeConceptName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('es-ES')
    .replace(/\s+/gu, ' ')
    .trim();
}

function containsNormalizedConceptPhrase(value: string, normalizedConcept: string): boolean {
  const escaped = normalizedConcept.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'u').test(
    normalizeConceptName(value),
  );
}

function operationEvent<ResultType extends KnowledgeEventType>(
  eventType: ResultType,
  payload: KnowledgeEventPayloadMap[ResultType],
  provenance: KnowledgeProvenance,
): KnowledgeEventInput {
  return { eventType, payload, provenance } as KnowledgeEventInput;
}

function normalizedProvenance(
  value: z.output<typeof ADD_RELATION_SCHEMA>['provenance'],
): KnowledgeProvenance {
  return {
    source: value.source,
    ...(value.introducedBy === undefined ? {} : { introducedBy: value.introducedBy }),
    ...(value.confirmedBy === undefined ? {} : { confirmedBy: value.confirmedBy }),
    ...(value.evidenceReferenceIds === undefined
      ? {}
      : { evidenceReferenceIds: value.evidenceReferenceIds }),
    ...(value.basedOnKnowledgeIds === undefined
      ? {}
      : { basedOnKnowledgeIds: value.basedOnKnowledgeIds }),
  };
}

function requireSemanticObservationProvenanceActor(
  provenance: {
    introducedBy?: ParticipantRef | undefined;
    confirmedBy?: ParticipantRef | undefined;
  },
  actor: ParticipantRef,
): void {
  if (
    (provenance.introducedBy !== undefined && !actorMatches(provenance.introducedBy, actor)) ||
    (provenance.confirmedBy !== undefined && !actorMatches(provenance.confirmedBy, actor))
  ) {
    throw new WorkspaceError(
      'PARTICIPANT_NOT_AUTHORIZED',
      'Semantic observation provenance must match the declared actor.',
    );
  }
}

export class KnowledgeBaseApplicationService {
  public constructor(
    private readonly repository: KnowledgeBaseRepository,
    private readonly ledgerService: KnowledgeBaseLedgerService,
    private readonly projectionService: M5ProjectionService,
    private readonly observation: ProjectObservation | undefined,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly auditService?: WorkItemAuditService,
  ) {}

  public async initializeWorkflow(input: unknown) {
    return this.initializeWorkflowAs(input, 'initialize_work_item_workflow');
  }

  public async initializeCreatedWorkflow(input: unknown, fingerprintPayload: unknown) {
    return this.initializeWorkflowAs(input, 'create_work_item_v2', fingerprintPayload);
  }

  /**
   * Validates the global M5 revision and idempotency contract before a v2
   * bootstrap creates any dossier files. The caller must keep the workspace
   * knowledge gate for the subsequent M2/M3/M4/M5 orchestration.
   */
  public async preflightCreatedWorkflow(
    input: unknown,
    fingerprintPayload: unknown,
  ): Promise<Record<string, unknown> | undefined> {
    const value = parseInput(INITIALIZE_WORKFLOW_SCHEMA, input);
    if (!actorMatches(value.actor, value.responsible)) {
      throw new WorkspaceError(
        'PARTICIPANT_NOT_AUTHORIZED',
        'The initial principal must confirm workflow initialization.',
      );
    }
    const retryResult = await this.repository.withSnapshot<Record<string, unknown> | undefined>(
      [],
      (snapshot) => {
        const ledger = this.readLedger(snapshot);
        let retry: KnowledgeBaseMutationResult | undefined;
        try {
          retry = this.ledgerService.findIdempotentOperation(
            ledger,
            'create_work_item_v2',
            value.idempotencyKey,
            fingerprintPayload,
          );
        } catch (error) {
          throw this.normalizeLedgerError(error);
        }
        if (retry !== undefined) {
          return {
            result: this.idempotentResult('create_work_item_v2', retry),
          };
        }
        if (value.expectedKnowledgeRevision !== ledger.knowledgeRevision) {
          throw new WorkspaceError(
            'WORKFLOW_REVISION_CONFLICT',
            'The expected Milestone 5 knowledge revision is stale.',
          );
        }
        const state = this.ledgerService.projectState(ledger);
        if (state.workItems.some((entry) => entry.workItemId === value.workItemId)) {
          throw new WorkspaceError(
            'WORK_ITEM_STATE_CONFLICT',
            'Milestone 5 workflow is already initialized for this Work Item.',
          );
        }
        return { result: undefined };
      },
    );
    if (retryResult !== undefined) {
      // Idempotency must not turn a physically missing or divergent dossier
      // into a reported success. The read validates its full M5 projection.
      await this.getWorkflow({ workItemId: value.workItemId });
    }
    return retryResult;
  }

  public async currentKnowledgeRevisionForBootstrap(): Promise<number> {
    return this.read([], (state) => state.knowledgeRevision);
  }

  private async initializeWorkflowAs(
    input: unknown,
    operation: 'initialize_work_item_workflow' | 'create_work_item_v2',
    fingerprintPayload?: unknown,
  ) {
    const value = parseInput(INITIALIZE_WORKFLOW_SCHEMA, input);
    if (!actorMatches(value.actor, value.responsible)) {
      throw new WorkspaceError(
        'PARTICIPANT_NOT_AUTHORIZED',
        'The initial principal must confirm workflow initialization.',
      );
    }
    return this.mutate(
      operation,
      value,
      [value.workItemId],
      (state, snapshot) => {
        if (state.workItems.some((entry) => entry.workItemId === value.workItemId)) {
          // The ledger service will resolve an exact retry before the stale
          // revision. A different key is a real initialization conflict.
          if (!this.hasIdempotencyKey(snapshot, value.idempotencyKey)) {
            throw new WorkspaceError(
              'WORK_ITEM_STATE_CONFLICT',
              'Milestone 5 workflow is already initialized for this Work Item.',
            );
          }
        }
        const dossier = snapshot.dossiers.get(value.workItemId);
        if (
          dossier === undefined ||
          !dossier.manifest.includes('## Document Lifecycle Inventory') ||
          !dossier.manifest.includes('## Milestone 4 Audit Inventory')
        ) {
          throw new WorkspaceError(
            'WORKFLOW_CORRUPT',
            'M3 and M4 must be initialized before Milestone 5 workflow.',
          );
        }
        const bootstrapMarker = inspectWorkItemV2BootstrapMarker(dossier.manifest);
        if (bootstrapMarker.kind === 'INVALID') {
          throw new WorkspaceError(
            'WORKFLOW_CORRUPT',
            'The Work Item v2 bootstrap marker is invalid.',
          );
        }
        if (operation === 'create_work_item_v2') {
          if (
            bootstrapMarker.kind !== 'VALID' ||
            bootstrapMarker.status !== 'PENDING' ||
            bootstrapMarker.requestFingerprint !== fingerprintAuditPayload(fingerprintPayload)
          ) {
            throw new WorkspaceError(
              'WORKFLOW_CORRUPT',
              'The Work Item v2 bootstrap is not bound to this creation request.',
            );
          }
        } else if (bootstrapMarker.kind === 'VALID') {
          throw new WorkspaceError(
            'WORK_ITEM_STATE_CONFLICT',
            'A Work Item v2 bootstrap cannot be adopted as a historical workflow.',
          );
        }
        const events = [
          operationEvent(
            'WORKFLOW_INITIALIZED',
            {
              workItemId: value.workItemId,
              iteration: {
                iterationId: value.iteration.iterationId,
                storageToken: value.iteration.storageToken,
                ...(value.iteration.displayName === undefined
                  ? {}
                  : { displayName: value.iteration.displayName }),
              },
              responsible: value.responsible,
              classification: value.classification,
              initialStatus: 'IN_PROGRESS',
            },
            { source: 'HUMAN_CONFIRMED', introducedBy: value.actor, confirmedBy: value.actor },
          ),
        ];
        return {
          events: this.withAutomaticReopen(state, operation, [value.workItemId], events),
          affectedWorkItemIds: [value.workItemId],
          result: (mutation: KnowledgeBaseMutationResult) => ({
            workItemId: value.workItemId,
            status: 'IN_PROGRESS' as const,
            knowledgeRevision: mutation.knowledgeRevision,
            idempotent: mutation.idempotent,
          }),
        };
      },
      undefined,
      fingerprintPayload,
    );
  }

  public async getWorkflow(input: unknown) {
    const value = parseInput(GET_WORKFLOW_SCHEMA, input);
    return this.read([value.workItemId], (state) => {
      const workflow = workflowFor(state, value.workItemId);
      return {
        ...workflow,
        knowledgeRevision: state.knowledgeRevision,
        workItemRevision: state.workItemRevisions[value.workItemId] ?? 0,
      };
    });
  }

  public async activateSession(input: unknown) {
    const value = parseInput(ACTIVATE_SESSION_SCHEMA, input);
    return this.mutate('activate_work_session', value, [value.workItemId], async (state) => {
      const workflow = workflowFor(state, value.workItemId);
      requireParticipant(workflow, value.actor);
      if (workflow.status === 'CANCELLED') {
        throw new WorkspaceError(
          'WORK_ITEM_STATE_CONFLICT',
          'A CANCELLED Work Item must be explicitly reopened before activation.',
        );
      }
      if (
        state.sessions.some(
          (entry) =>
            entry.status === 'ACTIVE' &&
            entry.developer.participantId === value.actor.participantId,
        )
      ) {
        throw new WorkspaceError(
          'WORK_SESSION_CONFLICT',
          'The declared developer already has an active session.',
        );
      }
      const observation = await this.captureObservation();
      const sessionId = this.idGenerator.generate();
      const snapshot = this.toTechnicalSnapshot(
        observation,
        state,
        sessionId,
        value.workItemId,
        'ACTIVATION',
      );
      return {
        events: this.withAutomaticReopen(
          state,
          'activate_work_session',
          [value.workItemId],
          [
            operationEvent('TECHNICAL_SNAPSHOT_RECORDED', { snapshot }, systemProvenance()),
            operationEvent(
              'SESSION_ACTIVATED',
              {
                sessionId,
                developer: value.actor,
                workItemId: value.workItemId,
                activationSnapshotId: snapshot.snapshotId,
                ...this.previousCheckpointFor(state, value.actor, value.workItemId),
              },
              manualProvenance(value.actor),
            ),
          ],
        ),
        affectedWorkItemIds: [value.workItemId],
        result: (mutation: KnowledgeBaseMutationResult) =>
          this.activatedSessionResult(mutation, mutation.idempotent),
      };
    });
  }

  public async switchSession(input: unknown) {
    const value = parseInput(SWITCH_SESSION_SCHEMA, input);
    return this.mutate(
      'switch_work_session',
      value,
      [],
      async (state, snapshot) => {
        const active = state.sessions.find(
          (entry) =>
            entry.status === 'ACTIVE' &&
            entry.developer.participantId === value.actor.participantId,
        );
        if (active === undefined) {
          throw new WorkspaceError(
            'WORK_SESSION_NOT_ACTIVE',
            'The declared developer has no active session to switch.',
          );
        }
        const target = workflowFor(state, value.targetWorkItemId);
        requireParticipant(target, value.actor);
        if (target.status !== 'IN_PROGRESS' || active.workItemId === value.targetWorkItemId) {
          throw new WorkspaceError(
            'WORK_SESSION_CONFLICT',
            'The requested session switch is not valid.',
          );
        }
        this.requireDossiers(snapshot, [active.workItemId, value.targetWorkItemId]);
        const sourceObservation = await this.captureObservation();
        const sourceSnapshot = this.toTechnicalSnapshot(
          sourceObservation,
          state,
          active.sessionId,
          active.workItemId,
          'SWITCH',
        );
        const checkpointId = this.idGenerator.generate();
        const targetObservation = await this.captureObservation();
        const targetSessionId = this.idGenerator.generate();
        const targetSnapshot = this.toTechnicalSnapshot(
          targetObservation,
          state,
          targetSessionId,
          value.targetWorkItemId,
          'ACTIVATION',
        );
        const events: KnowledgeEventInput[] = [
          operationEvent(
            'TECHNICAL_SNAPSHOT_RECORDED',
            { snapshot: sourceSnapshot },
            systemProvenance(),
          ),
          operationEvent(
            'SESSION_CHECKPOINT_RECORDED',
            {
              checkpointId,
              sessionId: active.sessionId,
              workItemId: active.workItemId,
              snapshotId: sourceSnapshot.snapshotId,
              kind: 'AUTOMATIC_SWITCH',
              observedWork: value.observedWork,
              relevantContext: value.relevantContext,
              pendingQuestions: value.pendingQuestions,
              ...(value.semanticSummary === undefined
                ? {}
                : { semanticSummary: value.semanticSummary }),
            },
            manualProvenance(value.actor),
          ),
          operationEvent(
            'SESSION_SUSPENDED',
            { sessionId: active.sessionId, checkpointId },
            systemProvenance(),
          ),
          operationEvent(
            'TECHNICAL_SNAPSHOT_RECORDED',
            { snapshot: targetSnapshot },
            systemProvenance(),
          ),
          operationEvent(
            'SESSION_ACTIVATED',
            {
              sessionId: targetSessionId,
              developer: value.actor,
              workItemId: value.targetWorkItemId,
              activationSnapshotId: targetSnapshot.snapshotId,
              ...this.previousCheckpointFor(state, value.actor, value.targetWorkItemId),
            },
            manualProvenance(value.actor),
          ),
        ];
        const affected = [active.workItemId, value.targetWorkItemId];
        return {
          events: this.withAutomaticReopen(state, 'switch_work_session', affected, events),
          affectedWorkItemIds: affected,
          result: (mutation: KnowledgeBaseMutationResult) => ({
            sourceWorkItemId: active.workItemId,
            targetWorkItemId: value.targetWorkItemId,
            checkpointId: this.payloadFromMutation(mutation, 'SESSION_CHECKPOINT_RECORDED')
              .checkpointId,
            sessionId: this.payloadsFromMutation(mutation, 'SESSION_ACTIVATED').at(-1)?.sessionId,
            knowledgeRevision: mutation.knowledgeRevision,
            idempotent: mutation.idempotent,
          }),
        };
      },
      async (state) => {
        const active = state.sessions.find(
          (entry) =>
            entry.status === 'ACTIVE' &&
            entry.developer.participantId === value.actor.participantId,
        );
        return active === undefined
          ? [value.targetWorkItemId]
          : [active.workItemId, value.targetWorkItemId];
      },
    );
  }

  public async recordSessionCheckpoint(input: unknown) {
    const value = parseInput(RECORD_SESSION_CHECKPOINT_SCHEMA, input);
    return this.mutate('record_session_checkpoint', value, [value.workItemId], async (state) => {
      const workflow = workflowFor(state, value.workItemId);
      requireParticipant(workflow, value.actor);
      const active = state.sessions.find(
        (entry) =>
          entry.status === 'ACTIVE' &&
          entry.workItemId === value.workItemId &&
          entry.developer.participantId === value.actor.participantId,
      );
      if (active === undefined) {
        throw new WorkspaceError(
          'WORK_SESSION_NOT_ACTIVE',
          'The requested Work Item session is not active.',
        );
      }
      const observation = await this.captureObservation();
      const snapshot = this.toTechnicalSnapshot(
        observation,
        state,
        active.sessionId,
        value.workItemId,
        'CHECKPOINT',
      );
      const checkpointId = this.idGenerator.generate();
      return {
        events: this.withAutomaticReopen(
          state,
          'record_session_checkpoint',
          [value.workItemId],
          [
            operationEvent('TECHNICAL_SNAPSHOT_RECORDED', { snapshot }, systemProvenance()),
            operationEvent(
              'SESSION_CHECKPOINT_RECORDED',
              {
                checkpointId,
                sessionId: active.sessionId,
                workItemId: value.workItemId,
                snapshotId: snapshot.snapshotId,
                kind: 'MANUAL',
                observedWork: value.observedWork,
                relevantContext: value.relevantContext,
                pendingQuestions: value.pendingQuestions,
                ...(value.semanticSummary === undefined
                  ? {}
                  : { semanticSummary: value.semanticSummary }),
              },
              manualProvenance(value.actor),
            ),
          ],
        ),
        affectedWorkItemIds: [value.workItemId],
        result: (mutation: KnowledgeBaseMutationResult) => ({
          workItemId: value.workItemId,
          checkpointId: this.payloadFromMutation(mutation, 'SESSION_CHECKPOINT_RECORDED')
            .checkpointId,
          snapshot: this.payloadFromMutation(mutation, 'TECHNICAL_SNAPSHOT_RECORDED').snapshot,
          knowledgeRevision: mutation.knowledgeRevision,
          idempotent: mutation.idempotent,
        }),
      };
    });
  }

  public async suspendSession(input: unknown) {
    const value = parseInput(SUSPEND_SESSION_SCHEMA, input);
    return this.mutate('suspend_work_session', value, [value.workItemId], async (state) => {
      const workflow = workflowFor(state, value.workItemId);
      requireParticipant(workflow, value.actor);
      const active = state.sessions.find(
        (entry) =>
          entry.status === 'ACTIVE' &&
          entry.workItemId === value.workItemId &&
          entry.developer.participantId === value.actor.participantId,
      );
      if (active === undefined) {
        throw new WorkspaceError(
          'WORK_SESSION_NOT_ACTIVE',
          'The requested Work Item session is not active.',
        );
      }
      const observation = await this.captureObservation();
      const snapshot = this.toTechnicalSnapshot(
        observation,
        state,
        active.sessionId,
        value.workItemId,
        value.checkpointKind === 'CLOSURE' ? 'CLOSURE' : 'CHECKPOINT',
      );
      const checkpointId = this.idGenerator.generate();
      return {
        events: this.withAutomaticReopen(
          state,
          'suspend_work_session',
          [value.workItemId],
          [
            operationEvent('TECHNICAL_SNAPSHOT_RECORDED', { snapshot }, systemProvenance()),
            operationEvent(
              'SESSION_CHECKPOINT_RECORDED',
              {
                checkpointId,
                sessionId: active.sessionId,
                workItemId: value.workItemId,
                snapshotId: snapshot.snapshotId,
                kind: value.checkpointKind,
                observedWork: value.observedWork,
                relevantContext: value.relevantContext,
                pendingQuestions: value.pendingQuestions,
                ...(value.semanticSummary === undefined
                  ? {}
                  : { semanticSummary: value.semanticSummary }),
              },
              manualProvenance(value.actor),
            ),
            operationEvent(
              'SESSION_SUSPENDED',
              { sessionId: active.sessionId, checkpointId },
              systemProvenance(),
            ),
          ],
        ),
        affectedWorkItemIds: [value.workItemId],
        result: (mutation: KnowledgeBaseMutationResult) => ({
          workItemId: value.workItemId,
          sessionId: active.sessionId,
          checkpointId: this.payloadFromMutation(mutation, 'SESSION_CHECKPOINT_RECORDED')
            .checkpointId,
          snapshot: this.payloadFromMutation(mutation, 'TECHNICAL_SNAPSHOT_RECORDED').snapshot,
          status: 'SUSPENDED' as const,
          knowledgeRevision: mutation.knowledgeRevision,
          idempotent: mutation.idempotent,
        }),
      };
    });
  }

  public async getActiveSession(input: unknown) {
    const value = parseInput(GET_ACTIVE_SESSION_SCHEMA, input);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const selection = await this.read([], (state) => ({
        knowledgeRevision: state.knowledgeRevision,
        workItemIds: state.workItems.map((entry) => entry.workItemId),
      }));
      const projected = await this.read(selection.workItemIds, (state) => {
        const currentWorkItemIds = state.workItems.map((entry) => entry.workItemId);
        if (
          state.knowledgeRevision !== selection.knowledgeRevision ||
          currentWorkItemIds.join('\n') !== selection.workItemIds.join('\n')
        ) {
          return { stable: false as const };
        }
        return {
          stable: true as const,
          result: {
            knowledgeRevision: state.knowledgeRevision,
            session:
              state.sessions.find(
                (entry) =>
                  entry.status === 'ACTIVE' &&
                  entry.developer.participantId === value.participantId,
              ) ?? null,
          },
        };
      });
      if (projected.stable) {
        return projected.result;
      }
    }
    throw new WorkspaceError(
      'KNOWLEDGE_BASE_CONFLICT',
      'The Milestone 5 knowledge base changed while the active session was read; retry the request.',
    );
  }

  public async resumeSessionContext(input: unknown) {
    const value = parseInput(RESUME_SESSION_CONTEXT_SCHEMA, input);
    return this.read([value.workItemId], (state) => {
      return {
        workItemId: value.workItemId,
        knowledgeRevision: state.knowledgeRevision,
        ...this.sessionContextFor(state, value.workItemId, value.participantId),
      };
    });
  }

  public async addCollaborator(input: unknown) {
    const value = parseInput(ADD_COLLABORATOR_SCHEMA, input);
    return this.simpleWorkItemMutation(
      'add_work_item_collaborator',
      value,
      value.workItemId,
      (_state, workflow) => {
        requireResponsible(workflow, value.actor);
        if (
          actorMatches(workflow.responsible, value.collaborator) ||
          workflow.collaborators.some((entry) => actorMatches(entry, value.collaborator))
        ) {
          throw new WorkspaceError(
            'WORK_ITEM_STATE_CONFLICT',
            'The collaborator is already assigned to this Work Item.',
          );
        }
        return [
          operationEvent(
            'COLLABORATOR_ADDED',
            { workItemId: value.workItemId, collaborator: value.collaborator },
            manualProvenance(value.actor),
          ),
        ];
      },
    );
  }

  public async removeCollaborator(input: unknown) {
    const value = parseInput(REMOVE_COLLABORATOR_SCHEMA, input);
    return this.simpleWorkItemMutation(
      'remove_work_item_collaborator',
      value,
      value.workItemId,
      (state, workflow) => {
        requireResponsible(workflow, value.actor);
        if (!workflow.collaborators.some((entry) => entry.participantId === value.collaboratorId)) {
          throw new WorkspaceError(
            'WORK_ITEM_STATE_CONFLICT',
            'The collaborator is not assigned to this Work Item.',
          );
        }
        if (
          state.sessions.some(
            (entry) =>
              entry.status === 'ACTIVE' &&
              entry.workItemId === value.workItemId &&
              entry.developer.participantId === value.collaboratorId,
          )
        ) {
          throw new WorkspaceError(
            'WORK_SESSION_CONFLICT',
            'An active session must be suspended before removing its collaborator.',
          );
        }
        return [
          operationEvent(
            'COLLABORATOR_REMOVED',
            {
              workItemId: value.workItemId,
              participantId: value.collaboratorId,
              reason: value.reason,
            },
            manualProvenance(value.actor),
          ),
        ];
      },
    );
  }

  public async transferResponsibility(input: unknown) {
    const value = parseInput(TRANSFER_RESPONSIBILITY_SCHEMA, input);
    return this.simpleWorkItemMutation(
      'transfer_work_item_responsibility',
      value,
      value.workItemId,
      (state, workflow) => {
        requireResponsible(workflow, value.actor);
        if (actorMatches(workflow.responsible, value.newResponsible)) {
          throw new WorkspaceError(
            'WORK_ITEM_STATE_CONFLICT',
            'The new principal must be different from the current principal.',
          );
        }
        if (
          state.sessions.some(
            (entry) =>
              entry.status === 'ACTIVE' &&
              entry.workItemId === value.workItemId &&
              entry.developer.participantId === workflow.responsible.participantId,
          )
        ) {
          throw new WorkspaceError(
            'WORK_SESSION_CONFLICT',
            'The principal session must be suspended before transferring responsibility.',
          );
        }
        return [
          operationEvent(
            'RESPONSIBILITY_TRANSFERRED',
            {
              workItemId: value.workItemId,
              previousResponsibleId: workflow.responsible.participantId,
              newResponsible: value.newResponsible,
              reason: value.reason,
              confirmation: true,
            },
            { source: 'HUMAN_CONFIRMED', introducedBy: value.actor, confirmedBy: value.actor },
          ),
        ];
      },
    );
  }

  public async addRelation(input: unknown) {
    const value = parseInput(ADD_RELATION_SCHEMA, input);
    const endpoints = canonicalRelationEndpoints(
      value.relationType,
      value.sourceWorkItemId,
      value.targetWorkItemId,
    );
    return this.mutate(
      'add_work_item_relation',
      value,
      [endpoints.sourceWorkItemId, endpoints.targetWorkItemId],
      (state) => {
        const declaredSource = workflowFor(state, value.sourceWorkItemId);
        workflowFor(state, value.targetWorkItemId);
        requireParticipant(declaredSource, value.actor);
        if (
          value.provenance.source !== 'HUMAN_CONFIRMED' ||
          value.provenance.confirmedBy?.participantId !== value.actor.participantId ||
          (value.provenance.introducedBy !== undefined &&
            value.provenance.introducedBy.participantId !== value.actor.participantId)
        ) {
          throw new WorkspaceError(
            'PARTICIPANT_NOT_AUTHORIZED',
            'A critical Work Item relation requires matching declared human provenance.',
          );
        }
        if (endpoints.sourceWorkItemId === endpoints.targetWorkItemId) {
          throw new WorkspaceError(
            'WORK_ITEM_RELATION_CONFLICT',
            'A Work Item cannot relate to itself.',
          );
        }
        if (
          state.relations.some(
            (entry) =>
              entry.status === 'ACTIVE' &&
              entry.relationType === value.relationType &&
              entry.sourceWorkItemId === endpoints.sourceWorkItemId &&
              entry.targetWorkItemId === endpoints.targetWorkItemId,
          )
        ) {
          throw new WorkspaceError('WORK_ITEM_RELATION_CONFLICT', 'The relation already exists.');
        }
        const relationId = this.idGenerator.generate();
        const event = operationEvent(
          'RELATION_ADDED',
          {
            relationId,
            relationType: value.relationType,
            sourceWorkItemId: endpoints.sourceWorkItemId,
            targetWorkItemId: endpoints.targetWorkItemId,
            explanation: value.explanation,
            ...(value.evidenceReferenceIds === undefined
              ? {}
              : { evidenceReferenceIds: value.evidenceReferenceIds }),
          },
          normalizedProvenance(value.provenance),
        );
        const affected = [endpoints.sourceWorkItemId, endpoints.targetWorkItemId];
        return {
          events: this.withAutomaticReopen(state, 'add_work_item_relation', affected, [event]),
          affectedWorkItemIds: affected,
          result: (mutation: KnowledgeBaseMutationResult) => ({
            relationId: this.payloadFromMutation(mutation, 'RELATION_ADDED').relationId,
            knowledgeRevision: mutation.knowledgeRevision,
            idempotent: mutation.idempotent,
          }),
        };
      },
    );
  }

  public async removeRelation(input: unknown) {
    const value = parseInput(REMOVE_RELATION_SCHEMA, input);
    return this.mutate(
      'remove_work_item_relation',
      value,
      [],
      (state) => {
        const relation = state.relations.find(
          (entry) => entry.relationId === value.relationId && entry.status === 'ACTIVE',
        );
        if (relation === undefined) {
          throw new WorkspaceError(
            'WORK_ITEM_RELATION_CONFLICT',
            'The active relation does not exist.',
          );
        }
        requireParticipant(workflowFor(state, relation.sourceWorkItemId), value.actor);
        const affected = [relation.sourceWorkItemId, relation.targetWorkItemId];
        return {
          events: this.withAutomaticReopen(state, 'remove_work_item_relation', affected, [
            operationEvent(
              'RELATION_REMOVED',
              { relationId: relation.relationId, reason: value.reason },
              manualProvenance(value.actor),
            ),
          ]),
          affectedWorkItemIds: affected,
          result: (mutation: KnowledgeBaseMutationResult) => ({
            relationId: value.relationId,
            knowledgeRevision: mutation.knowledgeRevision,
            idempotent: mutation.idempotent,
          }),
        };
      },
      (state) => {
        const relation = state.relations.find(
          (entry) => entry.relationId === value.relationId && entry.status === 'ACTIVE',
        );
        return relation === undefined ? [] : [relation.sourceWorkItemId, relation.targetWorkItemId];
      },
    );
  }

  public async proposeConcept(input: unknown) {
    const value = parseInput(PROPOSE_CONCEPT_SCHEMA, input);
    return this.mutate('propose_project_concept', value, [value.workItemId], (state) => {
      requireParticipant(workflowFor(state, value.workItemId), value.actor);
      const normalizedName = normalizeConceptName(value.displayName);
      const evidenceFingerprint = fingerprintAuditPayload({
        normalizedName,
        evidenceReferenceIds: [...value.evidenceReferenceIds].sort(),
      });
      const prior = state.conceptProposals.find(
        (entry) => entry.evidenceFingerprint === evidenceFingerprint && entry.status === 'REJECTED',
      );
      if (prior !== undefined) {
        return {
          events: [],
          affectedWorkItemIds: [],
          result: () => ({
            proposalId: prior.proposalId,
            status: prior.status,
            suppressed: true,
            knowledgeRevision: state.knowledgeRevision,
            idempotent: true,
          }),
        };
      }
      const proposalId = this.idGenerator.generate();
      return {
        events: this.withAutomaticReopen(
          state,
          'propose_project_concept',
          [value.workItemId],
          [
            operationEvent(
              'CONCEPT_PROPOSED',
              {
                proposalId,
                workItemId: value.workItemId,
                normalizedName,
                displayName: value.displayName,
                explanation: value.explanation,
                evidenceReferenceIds: value.evidenceReferenceIds,
                evidenceFingerprint,
                proposedBy: value.actor,
              },
              manualProvenance(value.actor),
            ),
          ],
        ),
        affectedWorkItemIds: [value.workItemId],
        result: (mutation: KnowledgeBaseMutationResult) => ({
          proposalId: this.payloadFromMutation(mutation, 'CONCEPT_PROPOSED').proposalId,
          status: 'PENDING' as const,
          suppressed: false,
          knowledgeRevision: mutation.knowledgeRevision,
          idempotent: mutation.idempotent,
        }),
      };
    });
  }

  public async resolveConceptProposal(input: unknown) {
    const value = parseInput(RESOLVE_CONCEPT_SCHEMA, input);
    return this.mutate('resolve_project_concept_proposal', value, [value.workItemId], (state) => {
      const proposal = state.conceptProposals.find(
        (entry) =>
          entry.proposalId === value.proposalId &&
          entry.workItemId === value.workItemId &&
          entry.status === 'PENDING',
      );
      if (proposal === undefined) {
        throw new WorkspaceError(
          'CONCEPT_PROPOSAL_CONFLICT',
          'The pending concept proposal does not exist.',
        );
      }
      const isProjectParticipant = state.workItems.some(
        (entry) =>
          actorMatches(entry.responsible, value.actor) ||
          entry.collaborators.some((participant) => actorMatches(participant, value.actor)),
      );
      if (!isProjectParticipant) {
        throw new WorkspaceError(
          'PARTICIPANT_NOT_AUTHORIZED',
          'The declared actor cannot resolve project concept proposals.',
        );
      }
      if (value.resolution === 'APPROVED' && !value.confirmation) {
        throw new WorkspaceError(
          'PARTICIPANT_NOT_AUTHORIZED',
          'Concept approval requires explicit human confirmation.',
        );
      }
      return {
        events: this.withAutomaticReopen(
          state,
          'resolve_project_concept_proposal',
          [proposal.workItemId],
          [
            operationEvent(
              'CONCEPT_PROPOSAL_RESOLVED',
              {
                proposalId: proposal.proposalId,
                resolution: value.resolution,
                resolvedBy: value.actor,
                resolutionReason: value.resolutionReason,
                confirmation: value.confirmation,
              },
              {
                source: 'HUMAN_CONFIRMED',
                introducedBy: value.actor,
                confirmedBy: value.actor,
              },
            ),
          ],
        ),
        affectedWorkItemIds: [proposal.workItemId],
        result: (mutation: KnowledgeBaseMutationResult) => ({
          proposalId: proposal.proposalId,
          status: value.resolution,
          knowledgeRevision: mutation.knowledgeRevision,
          idempotent: mutation.idempotent,
        }),
      };
    });
  }

  public async consolidateDossier(input: unknown) {
    const value = parseInput(CONSOLIDATE_DOSSIER_SCHEMA, input);
    return this.mutate('consolidate_work_item_dossier', value, [value.workItemId], (state) => {
      requireParticipant(workflowFor(state, value.workItemId), value.actor);
      if (
        value.provenance.source !== 'HUMAN_CONFIRMED' ||
        value.provenance.confirmedBy?.participantId !== value.actor.participantId ||
        (value.provenance.introducedBy !== undefined &&
          value.provenance.introducedBy.participantId !== value.actor.participantId)
      ) {
        throw new WorkspaceError(
          'PARTICIPANT_NOT_AUTHORIZED',
          'Official dossier consolidation requires matching human confirmation.',
        );
      }
      const consolidationId = this.idGenerator.generate();
      return {
        events: this.withAutomaticReopen(
          state,
          'consolidate_work_item_dossier',
          [value.workItemId],
          [
            operationEvent(
              'KNOWLEDGE_CONSOLIDATED',
              {
                consolidation: {
                  consolidationId,
                  workItemId: value.workItemId,
                  functionalOverview: {
                    functionalFlow: value.functionalOverview.functionalFlow,
                    entryConditions: value.functionalOverview.entryConditions,
                    businessRules: value.functionalOverview.businessRules,
                    testData: value.functionalOverview.testData,
                    relatedWorkItemIds: value.functionalOverview.relatedWorkItemIds,
                    ...(value.functionalOverview.purpose === undefined
                      ? {}
                      : { purpose: value.functionalOverview.purpose }),
                    ...(value.functionalOverview.actualBehavior === undefined
                      ? {}
                      : { actualBehavior: value.functionalOverview.actualBehavior }),
                  },
                  implementation: value.implementation,
                  testing: value.testing,
                },
              },
              normalizedProvenance(value.provenance),
            ),
          ],
        ),
        affectedWorkItemIds: [value.workItemId],
        result: (mutation: KnowledgeBaseMutationResult) => ({
          workItemId: value.workItemId,
          consolidationId: this.payloadFromMutation(mutation, 'KNOWLEDGE_CONSOLIDATED')
            .consolidation.consolidationId,
          knowledgeRevision: mutation.knowledgeRevision,
          idempotent: mutation.idempotent,
        }),
      };
    });
  }

  public async reviewWorkItem(input: unknown) {
    const value = parseInput(REVIEW_WORK_ITEM_SCHEMA, input);
    return this.mutate('review_work_item', value, [value.workItemId], async (state, snapshot) => {
      const workflow = workflowFor(state, value.workItemId);
      requireParticipant(workflow, value.actor);
      for (const observation of value.semanticObservations) {
        requireSemanticObservationProvenanceActor(observation.provenance, value.actor);
      }
      const findings = await this.structuralFindings(value.workItemId, workflow, state, snapshot);
      const reviewId = this.idGenerator.generate();
      const events: KnowledgeEventInput[] = [
        operationEvent(
          'STRUCTURAL_REVIEW_RECORDED',
          {
            reviewId,
            workItemId: value.workItemId,
            result: findings.length === 0 ? 'PASSED' : 'FAILED',
            findings,
          },
          systemProvenance(),
        ),
        ...value.semanticObservations.map((observation) =>
          operationEvent(
            'SEMANTIC_OBSERVATION_RECORDED',
            {
              observationId: this.idGenerator.generate(),
              workItemId: value.workItemId,
              severity: observation.severity,
              explanation: observation.explanation,
              ...(observation.evidenceReferenceIds === undefined
                ? {}
                : { evidenceReferenceIds: observation.evidenceReferenceIds }),
            },
            normalizedProvenance(observation.provenance),
          ),
        ),
      ];
      return {
        events: this.withAutomaticReopen(state, 'review_work_item', [value.workItemId], events),
        affectedWorkItemIds: [value.workItemId],
        result: (mutation: KnowledgeBaseMutationResult) => {
          const review = this.payloadFromMutation(mutation, 'STRUCTURAL_REVIEW_RECORDED');
          return {
            reviewId: review.reviewId,
            result: review.result,
            findings: review.findings,
            semanticObservationIds: this.payloadsFromMutation(
              mutation,
              'SEMANTIC_OBSERVATION_RECORDED',
            ).map((entry) => entry.observationId),
            knowledgeRevision: mutation.knowledgeRevision,
            idempotent: mutation.idempotent,
          };
        },
      };
    });
  }

  public async resolveSemanticObservation(input: unknown) {
    const value = parseInput(RESOLVE_SEMANTIC_OBSERVATION_SCHEMA, input);
    return this.mutate('resolve_semantic_observation', value, [value.workItemId], (state) => {
      const workflow = workflowFor(state, value.workItemId);
      requireParticipant(workflow, value.actor);
      const observation = state.semanticObservations.find(
        (entry) => entry.observationId === value.observationId,
      );
      if (
        observation === undefined ||
        observation.workItemId !== value.workItemId ||
        observation.status !== 'OPEN'
      ) {
        throw new WorkspaceError(
          'WORK_ITEM_STATE_CONFLICT',
          'The semantic observation is unavailable or is no longer open.',
        );
      }
      return {
        events: this.withAutomaticReopen(
          state,
          'resolve_semantic_observation',
          [value.workItemId],
          [
            operationEvent(
              'SEMANTIC_OBSERVATION_RESOLVED',
              {
                observationId: value.observationId,
                workItemId: value.workItemId,
                resolvedBy: value.actor,
                resolution: value.resolution,
              },
              {
                source: 'HUMAN_CONFIRMED',
                introducedBy: value.actor,
                confirmedBy: value.actor,
              },
            ),
          ],
        ),
        affectedWorkItemIds: [value.workItemId],
        result: (mutation: KnowledgeBaseMutationResult) => ({
          workItemId: value.workItemId,
          observationId: value.observationId,
          status: 'RESOLVED' as const,
          knowledgeRevision: mutation.knowledgeRevision,
          idempotent: mutation.idempotent,
        }),
      };
    });
  }

  public async completeWorkItem(input: unknown) {
    const value = parseInput(COMPLETE_WORK_ITEM_SCHEMA, input);
    return this.mutate('complete_work_item', value, [value.workItemId], async (state, snapshot) => {
      const workflow = workflowFor(state, value.workItemId);
      requireResponsible(workflow, value.actor);
      if (
        workflow.status !== 'IN_PROGRESS' ||
        workflow.latestStructuralReview?.reviewId !== value.structuralReviewId ||
        workflow.latestStructuralReview.result !== 'PASSED' ||
        state.sessions.some(
          (entry) => entry.workItemId === value.workItemId && entry.status === 'ACTIVE',
        )
      ) {
        throw new WorkspaceError(
          'STRUCTURAL_REVIEW_FAILED',
          'The Work Item cannot be completed until the current structural review passes.',
        );
      }
      if (!this.reviewIsCurrent(state, value.workItemId, value.structuralReviewId)) {
        throw new WorkspaceError(
          'STRUCTURAL_REVIEW_FAILED',
          'The structural review is stale for the current Work Item knowledge.',
        );
      }
      const historicalMutationBoundary = await this.captureHistoricalMutationBoundary(
        snapshot,
        value.workItemId,
      );
      return {
        events: [
          operationEvent(
            'WORK_ITEM_COMPLETED',
            {
              workItemId: value.workItemId,
              responsibleId: value.actor.participantId,
              structuralReviewId: value.structuralReviewId,
              historicalMutationBoundary,
              confirmation: true,
            },
            { source: 'HUMAN_CONFIRMED', introducedBy: value.actor, confirmedBy: value.actor },
          ),
        ],
        affectedWorkItemIds: [value.workItemId],
        result: (mutation: KnowledgeBaseMutationResult) => ({
          workItemId: value.workItemId,
          status: 'COMPLETED' as const,
          completedAt: mutation.knowledgeOperation.recordedAt,
          knowledgeRevision: mutation.knowledgeRevision,
          idempotent: mutation.idempotent,
        }),
      };
    });
  }

  public async cancelWorkItem(input: unknown) {
    const value = parseInput(CANCEL_WORK_ITEM_SCHEMA, input);
    return this.mutate('cancel_work_item', value, [value.workItemId], (state) => {
      const workflow = workflowFor(state, value.workItemId);
      requireResponsible(workflow, value.actor);
      if (workflow.status !== 'IN_PROGRESS') {
        throw new WorkspaceError(
          'WORK_ITEM_STATE_CONFLICT',
          'Only an IN_PROGRESS Work Item can be cancelled.',
        );
      }
      if (
        state.sessions.some(
          (entry) => entry.workItemId === value.workItemId && entry.status === 'ACTIVE',
        )
      ) {
        throw new WorkspaceError(
          'WORK_SESSION_CONFLICT',
          'All Work Item sessions must be suspended before cancellation.',
        );
      }
      return {
        events: [
          operationEvent(
            'WORK_ITEM_CANCELLED',
            {
              workItemId: value.workItemId,
              responsibleId: value.actor.participantId,
              reason: value.reason,
              confirmation: true,
            },
            { source: 'HUMAN_CONFIRMED', introducedBy: value.actor, confirmedBy: value.actor },
          ),
        ],
        affectedWorkItemIds: [value.workItemId],
        result: (mutation: KnowledgeBaseMutationResult) => ({
          workItemId: value.workItemId,
          status: 'CANCELLED' as const,
          knowledgeRevision: mutation.knowledgeRevision,
          idempotent: mutation.idempotent,
        }),
      };
    });
  }

  public async reopenWorkItem(input: unknown) {
    const value = parseInput(REOPEN_WORK_ITEM_SCHEMA, input);
    return this.mutate('reopen_work_item', value, [value.workItemId], (state) => {
      const workflow = workflowFor(state, value.workItemId);
      requireResponsible(workflow, value.actor);
      if (workflow.status === 'IN_PROGRESS') {
        throw new WorkspaceError(
          'WORK_ITEM_STATE_CONFLICT',
          'The Work Item is already IN_PROGRESS.',
        );
      }
      return {
        events: [
          operationEvent(
            'WORK_ITEM_REOPENED',
            {
              workItemId: value.workItemId,
              reason: value.reason,
              trigger: 'reopen_work_item',
              explicit: true,
              confirmation: true,
            },
            { source: 'HUMAN_CONFIRMED', introducedBy: value.actor, confirmedBy: value.actor },
          ),
        ],
        affectedWorkItemIds: [value.workItemId],
        result: (mutation: KnowledgeBaseMutationResult) => ({
          workItemId: value.workItemId,
          status: 'IN_PROGRESS' as const,
          knowledgeRevision: mutation.knowledgeRevision,
          idempotent: mutation.idempotent,
        }),
      };
    });
  }

  public async getRelatedKnowledge(input: unknown) {
    const value = parseInput(GET_RELATED_KNOWLEDGE_SCHEMA, input);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const selection = await this.read([value.workItemId], (state) => {
        workflowFor(state, value.workItemId);
        return {
          knowledgeRevision: state.knowledgeRevision,
          workItemIds: state.workItems
            .map((entry) => entry.workItemId)
            .sort((left, right) => left.localeCompare(right)),
        };
      });
      const projected = await this.read(selection.workItemIds, (state, snapshot) => {
        const currentWorkItemIds = state.workItems
          .map((entry) => entry.workItemId)
          .sort((left, right) => left.localeCompare(right));
        if (
          state.knowledgeRevision !== selection.knowledgeRevision ||
          currentWorkItemIds.join('\n') !== selection.workItemIds.join('\n')
        ) {
          return { stable: false as const };
        }
        const workflow = workflowFor(state, value.workItemId);
        const dossier = snapshot.dossiers.get(value.workItemId);
        if (dossier === undefined) {
          throw new WorkspaceError(
            'WORKFLOW_CORRUPT',
            'The requested Milestone 5 dossier is unavailable.',
          );
        }
        const ledger = this.readLedger(snapshot);
        const proposalTraces = new Map<
          string,
          { eventId: string; recordedAt: string; provenance: KnowledgeProvenance }
        >();
        const approvalTraces = new Map<
          string,
          { eventId: string; recordedAt: string; provenance: KnowledgeProvenance }
        >();
        const consolidationTraces = new Map<
          string,
          { eventId: string; recordedAt: string; provenance: KnowledgeProvenance }
        >();
        for (const operation of ledger.operations) {
          for (const event of operation.events) {
            if (event.eventType === 'CONCEPT_PROPOSED') {
              proposalTraces.set(event.payload.proposalId, {
                eventId: event.eventId,
                recordedAt: operation.recordedAt,
                provenance: event.provenance,
              });
            } else if (
              event.eventType === 'CONCEPT_PROPOSAL_RESOLVED' &&
              event.payload.resolution === 'APPROVED'
            ) {
              approvalTraces.set(event.payload.proposalId, {
                eventId: event.eventId,
                recordedAt: operation.recordedAt,
                provenance: event.provenance,
              });
            } else if (event.eventType === 'KNOWLEDGE_CONSOLIDATED') {
              consolidationTraces.set(event.payload.consolidation.consolidationId, {
                eventId: event.eventId,
                recordedAt: operation.recordedAt,
                provenance: event.provenance,
              });
            }
          }
        }
        const requireTrace = <Trace>(
          traces: ReadonlyMap<string, Trace>,
          identifier: string,
          kind: string,
        ): Trace => {
          const trace = traces.get(identifier);
          if (trace === undefined) {
            throw new WorkspaceError('WORKFLOW_CORRUPT', `The ${kind} audit trace is unavailable.`);
          }
          return trace;
        };
        const projectConcepts = state.concepts
          .map((concept) => {
            const proposal = state.conceptProposals.find(
              (entry) => entry.proposalId === concept.approvedProposalId,
            );
            if (proposal === undefined) {
              throw new WorkspaceError(
                'WORKFLOW_CORRUPT',
                'An approved project concept has no proposal history.',
              );
            }
            return {
              conceptId: concept.conceptId,
              normalizedName: concept.normalizedName,
              displayName: concept.displayName,
              explanation: concept.explanation,
              proposal: {
                proposalId: proposal.proposalId,
                workItemId: proposal.workItemId,
                evidenceReferenceIds: proposal.evidenceReferenceIds,
                proposedBy: proposal.proposedBy,
                proposedAt: proposal.recordedAt,
                ...requireTrace(proposalTraces, proposal.proposalId, 'concept proposal'),
              },
              approval: {
                approvedBy: concept.approvedBy,
                approvedAt: concept.approvedAt,
                ...requireTrace(approvalTraces, proposal.proposalId, 'concept approval'),
              },
            };
          })
          .sort(
            (left, right) =>
              left.normalizedName.localeCompare(right.normalizedName) ||
              left.conceptId.localeCompare(right.conceptId),
          );
        const localConceptProposals = state.conceptProposals
          .filter((proposal) => proposal.workItemId === value.workItemId)
          .map((proposal) => ({
            ...proposal,
            ...requireTrace(proposalTraces, proposal.proposalId, 'concept proposal'),
          }))
          .sort(
            (left, right) =>
              left.recordedAt.localeCompare(right.recordedAt) ||
              left.proposalId.localeCompare(right.proposalId),
          );
        const sourceConsolidation = workflow.latestConsolidation;
        const sourceComponents = new Map(
          (sourceConsolidation?.implementation.components ?? []).map(
            (component) => [component.name.toLocaleLowerCase('es-ES'), component] as const,
          ),
        );
        const queryConcepts = new Set(value.concepts.map(normalizeConceptName));
        const candidates = state.workItems
          .filter((entry) => entry.workItemId !== value.workItemId)
          .map((entry) => {
            const candidateDossier = snapshot.dossiers.get(entry.workItemId);
            if (candidateDossier === undefined) {
              throw new WorkspaceError(
                'WORKFLOW_CORRUPT',
                'A related Milestone 5 dossier is unavailable.',
              );
            }
            const explicitRelations = state.relations
              .filter(
                (relation) =>
                  relation.status === 'ACTIVE' &&
                  (relation.sourceWorkItemId === value.workItemId ||
                    relation.targetWorkItemId === value.workItemId) &&
                  (relation.sourceWorkItemId === entry.workItemId ||
                    relation.targetWorkItemId === entry.workItemId),
              )
              .sort((left, right) => left.relationId.localeCompare(right.relationId));
            const relations = explicitRelations.map((relation) => ({
              relationId: relation.relationId,
              relationType: relation.relationType,
              perspective:
                relation.relationType === 'RELATED_TO'
                  ? ('UNDIRECTED' as const)
                  : relation.sourceWorkItemId === value.workItemId
                    ? ('OUTGOING' as const)
                    : ('INCOMING' as const),
              perspectiveRelationType:
                relation.sourceWorkItemId === value.workItemId
                  ? relation.relationType
                  : inverseRelationType(relation.relationType),
              sourceWorkItemId: relation.sourceWorkItemId,
              targetWorkItemId: relation.targetWorkItemId,
              explanation: relation.explanation,
              evidenceReferenceIds: relation.evidenceReferenceIds ?? [],
              provenance: relation.provenance,
              recordedAt: relation.recordedAt,
            }));
            const candidateConsolidation = entry.latestConsolidation;
            const candidateComponents = new Map(
              (candidateConsolidation?.implementation.components ?? []).map(
                (component) => [component.name.toLocaleLowerCase('es-ES'), component] as const,
              ),
            );
            const sharedComponents = [...sourceComponents.keys()]
              .filter((name) => candidateComponents.has(name))
              .sort((left, right) => left.localeCompare(right));
            const componentMatches =
              sourceConsolidation === undefined || candidateConsolidation === undefined
                ? []
                : sharedComponents.map((normalizedName) => ({
                    normalizedName,
                    sourceComponentName: sourceComponents.get(normalizedName)?.name,
                    candidateComponentName: candidateComponents.get(normalizedName)?.name,
                    sourceConsolidation: {
                      consolidationId: sourceConsolidation.consolidationId,
                      ...requireTrace(
                        consolidationTraces,
                        sourceConsolidation.consolidationId,
                        'source consolidation',
                      ),
                    },
                    candidateConsolidation: {
                      consolidationId: candidateConsolidation.consolidationId,
                      ...requireTrace(
                        consolidationTraces,
                        candidateConsolidation.consolidationId,
                        'candidate consolidation',
                      ),
                    },
                  }));
            const conceptMatches =
              candidateConsolidation === undefined
                ? []
                : state.concepts
                    .filter(
                      (concept) =>
                        queryConcepts.has(concept.normalizedName) &&
                        containsNormalizedConceptPhrase(
                          candidateConsolidation.functionalOverview.actualBehavior ?? '',
                          concept.normalizedName,
                        ),
                    )
                    .sort(
                      (left, right) =>
                        left.normalizedName.localeCompare(right.normalizedName) ||
                        left.conceptId.localeCompare(right.conceptId),
                    )
                    .map((concept) => ({
                      conceptId: concept.conceptId,
                      normalizedName: concept.normalizedName,
                      displayName: concept.displayName,
                      matchKind: 'CONFIRMED_TEXT_OCCURRENCE' as const,
                      matchedField: 'functionalOverview.actualBehavior' as const,
                      candidateConsolidation: {
                        consolidationId: candidateConsolidation.consolidationId,
                        ...requireTrace(
                          consolidationTraces,
                          candidateConsolidation.consolidationId,
                          'candidate consolidation',
                        ),
                      },
                    }));
            const score =
              relations.length * 100 + conceptMatches.length * 10 + componentMatches.length;
            const matchReasons = [
              ...(candidateDossier.workItem.type === dossier.workItem.type ? ['TYPE'] : []),
              ...(entry.iteration.iterationId === workflow.iteration.iterationId
                ? ['ITERATION']
                : []),
            ];
            return {
              workItemId: entry.workItemId,
              type: candidateDossier.workItem.type,
              iteration: entry.iteration,
              classification: entry.classification,
              relationIds: relations.map((relation) => relation.relationId),
              relations,
              sharedComponents,
              componentMatches,
              conceptIds: conceptMatches.map((concept) => concept.conceptId),
              conceptMatches,
              matchReasons,
              score,
            };
          })
          .filter(
            (entry) =>
              entry.score > 0 ||
              entry.matchReasons.length > 0 ||
              entry.classification === 'GOLDEN' ||
              entry.classification === 'IMPORTED_PENDING_VALIDATION',
          )
          .sort(
            (left, right) =>
              right.relationIds.length - left.relationIds.length ||
              right.conceptIds.length - left.conceptIds.length ||
              right.sharedComponents.length - left.sharedComponents.length ||
              right.matchReasons.length - left.matchReasons.length ||
              classificationPriority(right.classification) -
                classificationPriority(left.classification) ||
              left.workItemId.localeCompare(right.workItemId),
          );
        return {
          stable: true as const,
          result: {
            workItemId: value.workItemId,
            knowledgeRevision: state.knowledgeRevision,
            catalogRevision: state.catalogRevision,
            localConceptProposals,
            projectConcepts,
            candidates,
          },
        };
      });
      if (projected.stable) {
        return projected.result;
      }
    }
    throw new WorkspaceError(
      'KNOWLEDGE_BASE_CONFLICT',
      'The Milestone 5 knowledge base changed while related knowledge was read; retry the request.',
    );
  }

  /**
   * Compatibility bridge for confirmed M3/M4 mutations. Historical contracts
   * carry no M5 revision. The bridge serializes on the M5 knowledge lock,
   * compares the typed historical cursor with the latest completion boundary,
   * and appends only for a newer mutation while the Work Item is completed.
   */
  public async autoReopenForExternalMutation(
    input: ExternalMutationBridgeInput,
  ): Promise<{ reopened: boolean; knowledgeRevision?: number }> {
    return this.repository.withSnapshot<{ reopened: boolean; knowledgeRevision?: number }>(
      [input.workItemId],
      (snapshot) => {
        if (snapshot.ledgerContent === undefined) {
          return { result: { reopened: false } };
        }
        const ledger = this.readLedger(snapshot);
        const fingerprintPayload = {
          workItemId: input.workItemId,
          trigger: input.trigger,
          cursor: input.cursor,
        };
        const state = this.ledgerService.projectState(ledger);
        this.assertDossierConsistency(snapshot, state);
        const workflow = state.workItems.find((entry) => entry.workItemId === input.workItemId);
        if (workflow === undefined || workflow.lastCompletionBoundary === undefined) {
          if (workflow?.status === 'COMPLETED') {
            throw new WorkspaceError(
              'WORKFLOW_CORRUPT',
              'The completed Work Item has no historical mutation boundary.',
            );
          }
          return { result: { reopened: false } };
        }
        const cursorIsAfterBoundary =
          input.cursor.source === 'M3_DOCUMENT'
            ? input.cursor.revision >
              workflow.lastCompletionBoundary.m3DocumentRevisions[input.cursor.documentType]
            : input.cursor.auditRevision > workflow.lastCompletionBoundary.m4AuditRevision;
        if (!cursorIsAfterBoundary) {
          return { result: { reopened: false } };
        }
        const retry = this.ledgerService.findIdempotentOperation(
          ledger,
          'reopen_work_item',
          input.idempotencyKey,
          fingerprintPayload,
        );
        if (retry !== undefined) {
          return {
            result: { reopened: false, knowledgeRevision: retry.knowledgeRevision },
          };
        }
        if (workflow.status !== 'COMPLETED') {
          return { result: { reopened: false } };
        }
        const mutation = this.ledgerService.appendOperation(
          ledger,
          {
            expectedKnowledgeRevision: ledger.knowledgeRevision,
            idempotencyKey: input.idempotencyKey,
            operation: 'reopen_work_item',
            actor: 'SYSTEM',
            events: [
              operationEvent(
                'WORK_ITEM_REOPENED',
                {
                  workItemId: input.workItemId,
                  reason: 'Substantive historical-contract mutation after completion.',
                  trigger: input.trigger,
                  explicit: false,
                  confirmation: false,
                },
                systemProvenance(),
              ),
            ],
          },
          fingerprintPayload,
        );
        const nextState = this.ledgerService.projectState(mutation.ledger);
        return {
          result: { reopened: true, knowledgeRevision: mutation.knowledgeRevision },
          commit: {
            ledgerContent: this.ledgerService.serialize(mutation.ledger),
            dossierReplacements: this.buildDossierReplacements(
              snapshot,
              nextState,
              [input.workItemId],
              mutation.knowledgeOperation.recordedAt,
            ),
          },
        };
      },
    );
  }

  private async simpleWorkItemMutation<TInput extends MutationInput & { workItemId: string }>(
    operation: KnowledgeOperationName,
    value: TInput,
    workItemId: string,
    buildEvents: (
      state: KnowledgeBaseState,
      workflow: WorkItemKnowledgeState,
    ) => KnowledgeEventInput[],
  ) {
    return this.mutate(operation, value, [workItemId], (state) => {
      const workflow = workflowFor(state, workItemId);
      const events = buildEvents(state, workflow);
      return {
        events: this.withAutomaticReopen(state, operation, [workItemId], events),
        affectedWorkItemIds: [workItemId],
        result: (mutation: KnowledgeBaseMutationResult) => ({
          workItemId,
          knowledgeRevision: mutation.knowledgeRevision,
          idempotent: mutation.idempotent,
        }),
      };
    });
  }

  private async mutate<Result>(
    operation: KnowledgeOperationName,
    input: MutationInput,
    initialWorkItemIds: readonly string[],
    build: (
      state: KnowledgeBaseState,
      snapshot: KnowledgeBaseRepositorySnapshot,
    ) => Promise<BuiltMutation<Result>> | BuiltMutation<Result>,
    resolveWorkItemIds?: (state: KnowledgeBaseState) => Promise<string[]> | string[],
    fingerprintPayload: unknown = input,
  ): Promise<Result> {
    let resolvedIds = [...initialWorkItemIds];
    if (resolveWorkItemIds !== undefined) {
      resolvedIds = await this.read([], (state) => resolveWorkItemIds(state));
    }
    const retryWorkItemIds = await this.repository.withSnapshot([], (snapshot) => {
      const ledger = this.readLedger(snapshot);
      const index = ledger.idempotencyIndex.find(
        (entry) => entry.idempotencyKey === input.idempotencyKey,
      );
      if (index === undefined) {
        return { result: [] };
      }
      const priorOperation = ledger.operations.find(
        (entry) => entry.operationId === index.operationId,
      );
      if (priorOperation === undefined) {
        throw new WorkspaceError(
          'WORKFLOW_CORRUPT',
          'The Milestone 5 idempotency index is inconsistent.',
        );
      }
      return { result: affectedWorkItemIds(priorOperation) };
    });
    resolvedIds = [...new Set([...resolvedIds, ...retryWorkItemIds])].sort((left, right) =>
      left.localeCompare(right),
    );
    return this.repository.withSnapshot(resolvedIds, async (snapshot) => {
      const ledger = this.readLedger(snapshot);
      const state = this.ledgerService.projectState(ledger);
      this.assertDossierConsistency(snapshot, state);
      let retry: KnowledgeBaseMutationResult | undefined;
      try {
        retry = this.ledgerService.findIdempotentOperation(
          ledger,
          operation,
          input.idempotencyKey,
          fingerprintPayload,
        );
      } catch (error) {
        throw this.normalizeLedgerError(error);
      }
      if (retry !== undefined) {
        return {
          result: this.idempotentResult(operation, retry) as unknown as Result,
        };
      }
      const built = await build(state, snapshot);
      if (built.events.length === 0) {
        // Suppressed knowledge proposal: this is a read-equivalent outcome and
        // deliberately does not consume a revision or idempotency key.
        return {
          result: built.result({
            ledger,
            knowledgeOperation: ledger.operations.at(-1) as never,
            knowledgeRevision: ledger.knowledgeRevision,
            idempotent: true,
          }),
        };
      }
      const request: AppendKnowledgeOperationRequest = {
        expectedKnowledgeRevision: input.expectedKnowledgeRevision,
        idempotencyKey: input.idempotencyKey,
        operation,
        actor: input.actor,
        events: built.events,
      };
      let mutation: KnowledgeBaseMutationResult;
      try {
        mutation = this.ledgerService.appendOperation(ledger, request, fingerprintPayload);
      } catch (error) {
        throw this.normalizeLedgerError(error);
      }
      const result = built.result(mutation);
      if (mutation.idempotent) {
        return { result };
      }
      const nextState = this.ledgerService.projectState(mutation.ledger);
      const affected = [...new Set(built.affectedWorkItemIds)].sort((left, right) =>
        left.localeCompare(right),
      );
      const replacements = this.buildDossierReplacements(
        snapshot,
        nextState,
        affected,
        mutation.knowledgeOperation.recordedAt,
      );
      return {
        result,
        commit: {
          ledgerContent: this.ledgerService.serialize(mutation.ledger),
          dossierReplacements: replacements,
          validateCommitted: (committed: KnowledgeBaseRepositorySnapshot) => {
            const persisted = this.ledgerService.parse(committed.ledgerContent ?? '');
            if (persisted.knowledgeRevision !== mutation.knowledgeRevision) {
              throw new WorkspaceError(
                'KNOWLEDGE_BASE_CORRUPT',
                'The committed Milestone 5 revision is inconsistent.',
              );
            }
            this.assertDossierConsistency(committed, this.ledgerService.projectState(persisted));
          },
        },
      };
    });
  }

  private async read<Result>(
    workItemIds: readonly string[],
    project: (
      state: KnowledgeBaseState,
      snapshot: KnowledgeBaseRepositorySnapshot,
    ) => Promise<Result> | Result,
  ): Promise<Result> {
    return this.repository.withSnapshot(workItemIds, async (snapshot) => {
      const ledger = this.readLedger(snapshot);
      const state = this.ledgerService.projectState(ledger);
      this.assertDossierConsistency(snapshot, state);
      return { result: await project(state, snapshot) };
    });
  }

  private readLedger(snapshot: KnowledgeBaseRepositorySnapshot): KnowledgeBaseLedger {
    if (snapshot.ledgerContent === undefined) {
      return this.ledgerService.createEmptyLedger();
    }
    try {
      return this.ledgerService.parse(snapshot.ledgerContent);
    } catch (error) {
      throw this.normalizeLedgerError(error);
    }
  }

  private assertDossierConsistency(
    snapshot: KnowledgeBaseRepositorySnapshot,
    state: KnowledgeBaseState,
  ): void {
    for (const [workItemId, dossier] of snapshot.dossiers) {
      const workflow = state.workItems.find((entry) => entry.workItemId === workItemId);
      if (workflow === undefined) {
        if (dossier.m5Artifacts.size > 0) {
          throw new WorkspaceError(
            'WORKFLOW_CORRUPT',
            'Milestone 5 projections exist without an initialized workflow.',
          );
        }
        continue;
      }
      const expectedStatus =
        workflow.status === 'COMPLETED'
          ? 'CLOSED'
          : workflow.status === 'CANCELLED'
            ? 'CANCELLED'
            : dossier.workItem.status === 'CLOSED' || dossier.workItem.status === 'CANCELLED'
              ? 'REOPENED'
              : dossier.workItem.status;
      if (
        dossier.workItem.status !== expectedStatus ||
        dossier.workItem.responsibility?.responsiblePerson !== workflow.responsible.displayName ||
        (workflow.completedAt !== undefined &&
          dossier.workItem.dates.actualCompletionAt !== workflow.completedAt.slice(0, 10)) ||
        (dossier.workItem.schemaVersion === '2.0.0' &&
          (dossier.workItem.iteration?.iterationId !== workflow.iteration.iterationId ||
            dossier.workItem.iteration.storageToken !== workflow.iteration.storageToken ||
            dossier.workItem.iteration.displayName !== workflow.iteration.displayName))
      ) {
        throw new WorkspaceError(
          'WORKFLOW_CORRUPT',
          'The Work Item YAML diverges from canonical Milestone 5 state.',
        );
      }
      const projected = this.projectionService.render(
        dossier.workItem,
        workflow,
        state,
        dossier.manifest,
      );
      const mismatchedArtifact = M5_PROJECTION_PATHS.find(
        (relativePath) =>
          dossier.m5Artifacts.get(relativePath) !== projected.artifacts[relativePath],
      );
      const normalizedProjectedManifest = projected.manifest.replace(
        /^- Knowledge revision: \d+$/mu,
        '- Knowledge revision: <projection-ledger-revision>',
      );
      const normalizedStoredManifest = dossier.manifest.replace(
        /^- Knowledge revision: \d+$/mu,
        '- Knowledge revision: <projection-ledger-revision>',
      );
      if (
        normalizedProjectedManifest !== normalizedStoredManifest ||
        mismatchedArtifact !== undefined
      ) {
        const field =
          mismatchedArtifact ??
          (normalizedProjectedManifest !== normalizedStoredManifest
            ? '00_MANIFEST.md'
            : 'M5_PROJECTION');
        throw new WorkspaceError(
          'WORKFLOW_CORRUPT',
          `Milestone 5 projection ${field} diverges from canonical knowledge.`,
          { field },
        );
      }
    }
  }

  private buildDossierReplacements(
    snapshot: KnowledgeBaseRepositorySnapshot,
    state: KnowledgeBaseState,
    affectedWorkItemIds: readonly string[],
    updatedAt: string,
  ): KnowledgeDossierReplacement[] {
    const replacements: KnowledgeDossierReplacement[] = [];
    for (const workItemId of affectedWorkItemIds) {
      const dossier = snapshot.dossiers.get(workItemId);
      const workflow = state.workItems.find((entry) => entry.workItemId === workItemId);
      if (dossier === undefined || workflow === undefined) {
        throw new WorkspaceError(
          'WORKFLOW_CORRUPT',
          'The affected Milestone 5 dossier is unavailable.',
        );
      }
      const projected = this.projectionService.render(
        dossier.workItem,
        workflow,
        state,
        dossier.manifest,
      );
      for (const relativePath of M5_PROJECTION_PATHS) {
        replacements.push({
          workItemId,
          relativePath,
          content: projected.artifacts[relativePath],
        });
      }
      replacements.push({
        workItemId,
        relativePath: '00_MANIFEST.md',
        content: projected.manifest,
      });
      replacements.push({
        workItemId,
        relativePath: 'WORK_ITEM.yml',
        content: serializeWorkItemYml(
          this.projectLegacyWorkItem(dossier.workItem, workflow, updatedAt),
        ),
      });
    }
    return replacements;
  }

  private projectLegacyWorkItem(
    workItem: WorkItem,
    workflow: WorkItemKnowledgeState,
    updatedAt: string,
  ): WorkItem {
    const status =
      workflow.status === 'COMPLETED'
        ? 'CLOSED'
        : workflow.status === 'CANCELLED'
          ? 'CANCELLED'
          : workItem.status === 'CLOSED' || workItem.status === 'CANCELLED'
            ? 'REOPENED'
            : workItem.status;
    return {
      ...workItem,
      status,
      dates: {
        ...workItem.dates,
        ...(workflow.completedAt === undefined
          ? {}
          : { actualCompletionAt: workflow.completedAt.slice(0, 10) }),
      },
      responsibility: { responsiblePerson: workflow.responsible.displayName },
      updatedAt,
    };
  }

  private withAutomaticReopen(
    state: KnowledgeBaseState,
    operation: KnowledgeOperationName,
    affectedWorkItemIds: readonly string[],
    events: KnowledgeEventInput[],
  ): KnowledgeEventInput[] {
    if (!MATERIAL_OPERATIONS.has(operation)) {
      return events;
    }
    const reopenEvents = affectedWorkItemIds.flatMap((workItemId) => {
      const workflow = state.workItems.find((entry) => entry.workItemId === workItemId);
      return workflow?.status === 'COMPLETED'
        ? [
            operationEvent(
              'WORK_ITEM_REOPENED',
              {
                workItemId,
                reason: 'Substantive Milestone 5 mutation after completion.',
                trigger: operation,
                explicit: false,
                confirmation: false,
              },
              systemProvenance(),
            ),
          ]
        : [];
    });
    return [...reopenEvents, ...events];
  }

  private async captureObservation() {
    if (this.observation === undefined) {
      throw new WorkspaceError(
        'PROJECT_SOURCE_NOT_CONFIGURED',
        'WS_PROJECT_SOURCE_ROOT is required to activate or checkpoint an M5 session.',
      );
    }
    try {
      return await this.observation.capture();
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : 'TECHNICAL_SNAPSHOT_FAILED';
      if (
        code === 'PROJECT_SOURCE_CONFIGURATION_INVALID' ||
        code === 'TECHNICAL_SNAPSHOT_LIMIT_EXCEEDED'
      ) {
        throw new WorkspaceError(code, 'The technical project observation failed safely.');
      }
      throw new WorkspaceError(
        'TECHNICAL_SNAPSHOT_FAILED',
        'The technical project observation failed safely.',
      );
    }
  }

  private toTechnicalSnapshot(
    observation: Awaited<ReturnType<ProjectObservation['capture']>>,
    state: KnowledgeBaseState,
    sessionId: string,
    workItemId: string,
    kind: TechnicalSnapshot['kind'],
  ): TechnicalSnapshot {
    const sessionIds = new Set(
      state.sessions
        .filter((session) => session.workItemId === workItemId)
        .map((session) => session.sessionId),
    );
    sessionIds.add(sessionId);
    const priorSnapshots = state.snapshots
      .filter((snapshot) => sessionIds.has(snapshot.sessionId))
      .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
    const previous = priorSnapshots.at(-1);
    const baseline =
      priorSnapshots
        .filter((snapshot) => snapshot.sessionId === sessionId && snapshot.kind === 'ACTIVATION')
        .at(-1) ?? previous;
    return {
      snapshotId: this.idGenerator.generate(),
      sessionId,
      kind,
      capturedAt: this.clock.now(),
      files: observation.files,
      changes: diffTechnicalSnapshotFiles(
        observation.files,
        previous?.files ?? [],
        baseline?.files ?? [],
      ),
      git: observation.git,
      exclusions: observation.exclusions,
      totalBytes: observation.totalBytes,
    };
  }

  private previousCheckpointFor(
    state: KnowledgeBaseState,
    actor: ParticipantRef,
    workItemId: string,
  ): { previousCheckpointId?: string } {
    const sessionIds = new Set(
      state.sessions
        .filter(
          (session) =>
            session.workItemId === workItemId &&
            session.developer.participantId === actor.participantId,
        )
        .map((session) => session.sessionId),
    );
    const checkpoint = state.checkpoints
      .filter((entry) => sessionIds.has(entry.sessionId))
      .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt))
      .at(-1);
    return checkpoint === undefined ? {} : { previousCheckpointId: checkpoint.checkpointId };
  }

  private sessionContextFor(state: KnowledgeBaseState, workItemId: string, participantId: string) {
    const workflow = workflowFor(state, workItemId);
    const workItemRevision = state.workItemRevisions[workItemId] ?? 0;
    const sessionIds = new Set(
      state.sessions
        .filter(
          (entry) =>
            entry.workItemId === workItemId && entry.developer.participantId === participantId,
        )
        .map((entry) => entry.sessionId),
    );
    const lastCheckpoint =
      state.checkpoints
        .filter((entry) => sessionIds.has(entry.sessionId))
        .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt))
        .at(-1) ?? null;
    const lastSnapshot =
      state.snapshots
        .filter((entry) => sessionIds.has(entry.sessionId))
        .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt))
        .at(-1) ?? null;
    const openSemanticObservations = state.semanticObservations.filter(
      (entry) => entry.workItemId === workItemId && entry.status === 'OPEN',
    );
    const latestReview = workflow.latestStructuralReview ?? null;
    return {
      lastCheckpoint,
      lastSnapshot,
      changesSinceLastCheckpoint:
        lastCheckpoint === null ||
        lastSnapshot === null ||
        lastSnapshot.snapshotId === lastCheckpoint.snapshotId
          ? []
          : lastSnapshot.changes,
      relevantContext: lastCheckpoint?.relevantContext ?? [],
      pendingQuestions: lastCheckpoint?.pendingQuestions ?? [],
      openSemanticObservations,
      review: {
        latest: latestReview,
        current: latestReview !== null && latestReview.workItemRevision === workItemRevision,
      },
      dossier: {
        status: workflow.status,
        workItemRevision,
        latestConsolidationId: workflow.latestConsolidation?.consolidationId ?? null,
      },
    };
  }

  private activatedSessionResult(mutation: KnowledgeBaseMutationResult, idempotent: boolean) {
    const session = this.payloadFromMutation(mutation, 'SESSION_ACTIVATED');
    const snapshot = this.payloadFromMutation(mutation, 'TECHNICAL_SNAPSHOT_RECORDED').snapshot;
    const state = this.ledgerService.projectState(mutation.ledger);
    const context = this.sessionContextFor(
      state,
      session.workItemId,
      session.developer.participantId,
    );
    return {
      workItemId: session.workItemId,
      sessionId: session.sessionId,
      snapshot,
      lastCheckpoint: context.lastCheckpoint,
      changesSinceLastCheckpoint: context.changesSinceLastCheckpoint,
      relevantContext: context.relevantContext,
      pendingQuestions: context.pendingQuestions,
      openSemanticObservations: context.openSemanticObservations,
      review: context.review,
      dossier: context.dossier,
      knowledgeRevision: mutation.knowledgeRevision,
      idempotent,
    };
  }

  private async captureHistoricalMutationBoundary(
    snapshot: KnowledgeBaseRepositorySnapshot,
    workItemId: string,
  ) {
    const dossier = snapshot.dossiers.get(workItemId);
    if (dossier === undefined) {
      throw new WorkspaceError(
        'WORKFLOW_CORRUPT',
        'The Work Item dossier is unavailable at completion.',
      );
    }
    let m3DocumentRevisions: Record<ManagedDocumentType, number>;
    let m4AuditRevision: number;
    try {
      const sections = new ManifestSectionCompositor().parse(dossier.manifest);
      if (sections.documentLifecycle === undefined || sections.m4AuditInventory === undefined) {
        throw new Error('missing historical inventory');
      }
      const lifecycle = parseDocumentLifecycleInventorySection(sections.documentLifecycle.content);
      m3DocumentRevisions = Object.fromEntries(
        MANAGED_DOCUMENT_TYPES.map((documentType) => {
          const metadata = lifecycle.find((entry) => entry.documentType === documentType);
          if (metadata === undefined) {
            throw new Error('missing document lifecycle revision');
          }
          return [documentType, metadata.revision];
        }),
      ) as Record<ManagedDocumentType, number>;
      m4AuditRevision = parseM4ManifestInventorySection(
        sections.m4AuditInventory.content,
      ).auditRevision;
    } catch {
      throw new WorkspaceError(
        'WORKFLOW_CORRUPT',
        'Historical M3/M4 revisions cannot be captured safely at completion.',
      );
    }
    if (this.auditService !== undefined) {
      const readiness = await this.auditService.getClosureReadiness(workItemId);
      if (!readiness.ready) {
        throw new WorkspaceError(
          'STRUCTURAL_REVIEW_FAILED',
          'The current Milestone 4 test state no longer permits completion.',
        );
      }
      if (readiness.auditRevision !== m4AuditRevision) {
        throw new WorkspaceError(
          'WORKFLOW_CORRUPT',
          'The Milestone 4 revision diverges from its manifest inventory.',
        );
      }
    }
    return { m3DocumentRevisions, m4AuditRevision };
  }

  private async structuralFindings(
    workItemId: string,
    workflow: WorkItemKnowledgeState,
    state: KnowledgeBaseState,
    snapshot: KnowledgeBaseRepositorySnapshot,
  ): Promise<Array<{ code: string; message: string }>> {
    const findings: Array<{ code: string; message: string }> = [];
    const dossier = snapshot.dossiers.get(workItemId);
    if (dossier === undefined) {
      findings.push({ code: 'DOSSIER_MISSING', message: 'The Work Item dossier is unavailable.' });
      return findings;
    }
    if (!dossier.manifest.includes('## Document Lifecycle Inventory')) {
      findings.push({ code: 'M3_NOT_INITIALIZED', message: 'M3 documents are not initialized.' });
    }
    if (!dossier.manifest.includes('## Milestone 4 Audit Inventory')) {
      findings.push({ code: 'M4_NOT_INITIALIZED', message: 'M4 tracking is not initialized.' });
    }
    if (workflow.latestConsolidation === undefined) {
      findings.push({
        code: 'CONSOLIDATION_MISSING',
        message: 'The human-oriented dossier has not been consolidated.',
      });
    } else {
      const consolidation = workflow.latestConsolidation;
      if (
        !consolidation.functionalOverview.purpose ||
        !consolidation.functionalOverview.actualBehavior ||
        consolidation.implementation.components.length === 0 ||
        consolidation.testing.scenarios.length === 0 ||
        consolidation.testing.closureChecklist.length === 0
      ) {
        findings.push({
          code: 'CONSOLIDATION_INCOMPLETE',
          message: 'Functional, implementation, and testing knowledge must be complete.',
        });
      }
    }
    const sessions = state.sessions.filter((entry) => entry.workItemId === workItemId);
    const sessionIds = new Set(sessions.map((entry) => entry.sessionId));
    if (!state.snapshots.some((entry) => sessionIds.has(entry.sessionId))) {
      findings.push({ code: 'SNAPSHOT_MISSING', message: 'No technical snapshot is recorded.' });
    }
    if (!state.checkpoints.some((entry) => sessionIds.has(entry.sessionId))) {
      findings.push({ code: 'CHECKPOINT_MISSING', message: 'No session checkpoint is recorded.' });
    }
    if (sessions.some((entry) => entry.status === 'ACTIVE')) {
      findings.push({
        code: 'ACTIVE_SESSION',
        message: 'An active session must be suspended before completion.',
      });
    }
    if (this.auditService !== undefined) {
      try {
        const readiness = await this.auditService.getClosureReadiness(workItemId);
        if (!readiness.ready) {
          findings.push({
            code: 'M4_TESTS_NOT_PASSED',
            message: 'Every active M4 test case must have a latest PASSED execution.',
          });
        }
        const knownEvidenceIds = new Set(readiness.evidenceReferenceIds);
        const referencedEvidenceIds = new Set<string>();
        const ledger = this.readLedger(snapshot);
        for (const operation of ledger.operations) {
          if (affectedWorkItemIds(operation).includes(workItemId)) {
            for (const event of operation.events) {
              collectEvidenceReferenceIds(event.payload, referencedEvidenceIds);
              collectEvidenceReferenceIds(event.provenance, referencedEvidenceIds);
            }
          }
        }
        if ([...referencedEvidenceIds].some((evidenceId) => !knownEvidenceIds.has(evidenceId))) {
          findings.push({
            code: 'EVIDENCE_REFERENCE_UNKNOWN',
            message: 'Milestone 5 knowledge references an unknown M4 evidence identifier.',
          });
        }
      } catch {
        findings.push({
          code: 'M4_TESTING_UNAVAILABLE',
          message: 'The M4 testing projection cannot be validated.',
        });
      }
    }
    return findings;
  }

  private reviewIsCurrent(
    state: KnowledgeBaseState,
    workItemId: string,
    reviewId: string,
  ): boolean {
    const reviewRevision = state.structuralReviews.find(
      (entry) => entry.reviewId === reviewId && entry.workItemId === workItemId,
    );
    if (reviewRevision === undefined) {
      return false;
    }
    // The projected workItemRevision increases once per operation affecting
    // this Work Item. A review is current when no later substantive operation
    // changed its latest review in the derived state.
    return (
      state.workItems.find((entry) => entry.workItemId === workItemId)?.latestStructuralReview
        ?.reviewId === reviewId &&
      reviewRevision.workItemRevision === state.workItemRevisions[workItemId]
    );
  }

  private payloadFromMutation<EventType extends KnowledgeEventType>(
    mutation: KnowledgeBaseMutationResult,
    eventType: EventType,
  ): KnowledgeEventPayloadMap[EventType] {
    const event = mutation.knowledgeOperation.events.find(
      (candidate) => candidate.eventType === eventType,
    );
    if (event === undefined) {
      throw new WorkspaceError('WORKFLOW_CORRUPT', 'The M5 operation result is inconsistent.');
    }
    return event.payload as unknown as KnowledgeEventPayloadMap[EventType];
  }

  private payloadsFromMutation<EventType extends KnowledgeEventType>(
    mutation: KnowledgeBaseMutationResult,
    eventType: EventType,
  ): Array<KnowledgeEventPayloadMap[EventType]> {
    return mutation.knowledgeOperation.events
      .filter((candidate) => candidate.eventType === eventType)
      .map((event) => event.payload as unknown as KnowledgeEventPayloadMap[EventType]);
  }

  private normalizeLedgerError(error: unknown): WorkspaceError {
    if (error instanceof WorkspaceError) {
      return error;
    }
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : 'WORKFLOW_CORRUPT';
    if (code === 'WORKFLOW_REVISION_CONFLICT' || code === 'WORKFLOW_IDEMPOTENCY_CONFLICT') {
      return new WorkspaceError(code, error instanceof Error ? error.message : 'M5 conflict.');
    }
    return new WorkspaceError(
      'WORKFLOW_CORRUPT',
      'The Milestone 5 knowledge ledger cannot be read safely.',
    );
  }

  private idempotentResult(
    operation: KnowledgeOperationName,
    mutation: KnowledgeBaseMutationResult,
  ): Record<string, unknown> {
    const common = {
      knowledgeRevision: mutation.knowledgeRevision,
      idempotent: true,
    };
    switch (operation) {
      case 'initialize_work_item_workflow':
      case 'create_work_item_v2': {
        const payload = this.payloadFromMutation(mutation, 'WORKFLOW_INITIALIZED');
        return { workItemId: payload.workItemId, status: 'IN_PROGRESS', ...common };
      }
      case 'activate_work_session': {
        return this.activatedSessionResult(mutation, true);
      }
      case 'switch_work_session': {
        const checkpoint = this.payloadFromMutation(mutation, 'SESSION_CHECKPOINT_RECORDED');
        const activation = this.payloadsFromMutation(mutation, 'SESSION_ACTIVATED').at(-1);
        return {
          sourceWorkItemId: checkpoint.workItemId,
          targetWorkItemId: activation?.workItemId,
          checkpointId: checkpoint.checkpointId,
          sessionId: activation?.sessionId,
          ...common,
        };
      }
      case 'record_session_checkpoint': {
        const checkpoint = this.payloadFromMutation(mutation, 'SESSION_CHECKPOINT_RECORDED');
        return {
          workItemId: checkpoint.workItemId,
          checkpointId: checkpoint.checkpointId,
          snapshot: this.payloadFromMutation(mutation, 'TECHNICAL_SNAPSHOT_RECORDED').snapshot,
          ...common,
        };
      }
      case 'suspend_work_session': {
        const checkpoint = this.payloadFromMutation(mutation, 'SESSION_CHECKPOINT_RECORDED');
        return {
          workItemId: checkpoint.workItemId,
          sessionId: checkpoint.sessionId,
          checkpointId: checkpoint.checkpointId,
          snapshot: this.payloadFromMutation(mutation, 'TECHNICAL_SNAPSHOT_RECORDED').snapshot,
          status: 'SUSPENDED',
          ...common,
        };
      }
      case 'add_work_item_collaborator':
        return {
          workItemId: this.payloadFromMutation(mutation, 'COLLABORATOR_ADDED').workItemId,
          ...common,
        };
      case 'remove_work_item_collaborator':
        return {
          workItemId: this.payloadFromMutation(mutation, 'COLLABORATOR_REMOVED').workItemId,
          ...common,
        };
      case 'transfer_work_item_responsibility':
        return {
          workItemId: this.payloadFromMutation(mutation, 'RESPONSIBILITY_TRANSFERRED').workItemId,
          ...common,
        };
      case 'add_work_item_relation':
        return {
          relationId: this.payloadFromMutation(mutation, 'RELATION_ADDED').relationId,
          ...common,
        };
      case 'remove_work_item_relation':
        return {
          relationId: this.payloadFromMutation(mutation, 'RELATION_REMOVED').relationId,
          ...common,
        };
      case 'propose_project_concept': {
        const proposal = this.payloadFromMutation(mutation, 'CONCEPT_PROPOSED');
        return {
          proposalId: proposal.proposalId,
          status: 'PENDING',
          suppressed: false,
          ...common,
        };
      }
      case 'resolve_project_concept_proposal': {
        const resolution = this.payloadFromMutation(mutation, 'CONCEPT_PROPOSAL_RESOLVED');
        return {
          proposalId: resolution.proposalId,
          status: resolution.resolution,
          ...common,
        };
      }
      case 'consolidate_work_item_dossier': {
        const consolidation = this.payloadFromMutation(
          mutation,
          'KNOWLEDGE_CONSOLIDATED',
        ).consolidation;
        return {
          workItemId: consolidation.workItemId,
          consolidationId: consolidation.consolidationId,
          ...common,
        };
      }
      case 'review_work_item': {
        const review = this.payloadFromMutation(mutation, 'STRUCTURAL_REVIEW_RECORDED');
        return {
          reviewId: review.reviewId,
          result: review.result,
          findings: review.findings,
          semanticObservationIds: this.payloadsFromMutation(
            mutation,
            'SEMANTIC_OBSERVATION_RECORDED',
          ).map((entry) => entry.observationId),
          ...common,
        };
      }
      case 'resolve_semantic_observation': {
        const resolution = this.payloadFromMutation(mutation, 'SEMANTIC_OBSERVATION_RESOLVED');
        return {
          workItemId: resolution.workItemId,
          observationId: resolution.observationId,
          status: 'RESOLVED',
          ...common,
        };
      }
      case 'complete_work_item': {
        const completion = this.payloadFromMutation(mutation, 'WORK_ITEM_COMPLETED');
        return {
          workItemId: completion.workItemId,
          status: 'COMPLETED',
          completedAt: mutation.knowledgeOperation.recordedAt,
          ...common,
        };
      }
      case 'cancel_work_item':
        return {
          workItemId: this.payloadFromMutation(mutation, 'WORK_ITEM_CANCELLED').workItemId,
          status: 'CANCELLED',
          ...common,
        };
      case 'reopen_work_item':
        return {
          workItemId: this.payloadFromMutation(mutation, 'WORK_ITEM_REOPENED').workItemId,
          status: 'IN_PROGRESS',
          ...common,
        };
    }
  }

  private hasIdempotencyKey(
    snapshot: KnowledgeBaseRepositorySnapshot,
    idempotencyKey: string,
  ): boolean {
    if (snapshot.ledgerContent === undefined) {
      return false;
    }
    const ledger = this.ledgerService.parse(snapshot.ledgerContent);
    return ledger.idempotencyIndex.some(
      (entry: { idempotencyKey: string }) => entry.idempotencyKey === idempotencyKey,
    );
  }

  private requireDossiers(
    snapshot: KnowledgeBaseRepositorySnapshot,
    workItemIds: readonly string[],
  ): void {
    if (workItemIds.some((workItemId) => !snapshot.dossiers.has(workItemId))) {
      throw new WorkspaceError('WORKFLOW_CORRUPT', 'An affected Work Item dossier is unavailable.');
    }
  }
}
