import type {
  TechnicalSnapshotChange,
  TechnicalSnapshotExclusion,
  TechnicalSnapshotFile,
  TechnicalSnapshotGitObservation,
} from './technical-snapshot.js';
import type { ManagedDocumentType } from './work-item-document.js';

export const KNOWLEDGE_BASE_SCHEMA_VERSION = '1.0.0' as const;

export const CANONICAL_WORK_ITEM_STATUSES = ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type CanonicalWorkItemStatus = (typeof CANONICAL_WORK_ITEM_STATUSES)[number];

export const KNOWLEDGE_CLASSIFICATIONS = [
  'STANDARD',
  'GOLDEN',
  'IMPORTED_PENDING_VALIDATION',
] as const;
export type KnowledgeClassification = (typeof KNOWLEDGE_CLASSIFICATIONS)[number];

export const KNOWLEDGE_PROVENANCE_SOURCES = [
  'MANUAL',
  'AI_INFERRED',
  'HUMAN_CONFIRMED',
  'SYSTEM_CALCULATED',
  'IMPORTED_PENDING_VALIDATION',
] as const;
export type KnowledgeProvenanceSource = (typeof KNOWLEDGE_PROVENANCE_SOURCES)[number];

export const WORK_SESSION_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type WorkSessionStatus = (typeof WORK_SESSION_STATUSES)[number];

export const TECHNICAL_SNAPSHOT_KINDS = ['ACTIVATION', 'CHECKPOINT', 'SWITCH', 'CLOSURE'] as const;
export type TechnicalSnapshotKind = (typeof TECHNICAL_SNAPSHOT_KINDS)[number];

export const SESSION_CHECKPOINT_KINDS = ['MANUAL', 'AUTOMATIC_SWITCH', 'CLOSURE'] as const;
export type SessionCheckpointKind = (typeof SESSION_CHECKPOINT_KINDS)[number];

export const WORK_ITEM_RELATION_TYPES = [
  'RELATED_TO',
  'DEPENDS_ON',
  'PART_OF',
  'REPLACES',
] as const;
export type WorkItemRelationType = (typeof WORK_ITEM_RELATION_TYPES)[number];

export const CONCEPT_PROPOSAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ConceptProposalStatus = (typeof CONCEPT_PROPOSAL_STATUSES)[number];

export const STRUCTURAL_REVIEW_RESULTS = ['PASSED', 'FAILED'] as const;
export type StructuralReviewResult = (typeof STRUCTURAL_REVIEW_RESULTS)[number];

export const SEMANTIC_OBSERVATION_SEVERITIES = ['INFO', 'WARNING', 'CONCERN'] as const;
export type SemanticObservationSeverity = (typeof SEMANTIC_OBSERVATION_SEVERITIES)[number];

export const KNOWLEDGE_OPERATIONS = [
  'create_work_item_v2',
  'initialize_work_item_workflow',
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
  'complete_work_item',
  'cancel_work_item',
  'reopen_work_item',
] as const;
export type KnowledgeOperationName = (typeof KNOWLEDGE_OPERATIONS)[number];

export const KNOWLEDGE_EVENT_TYPES = [
  'WORKFLOW_INITIALIZED',
  'SESSION_ACTIVATED',
  'SESSION_SUSPENDED',
  'SESSION_CHECKPOINT_RECORDED',
  'TECHNICAL_SNAPSHOT_RECORDED',
  'COLLABORATOR_ADDED',
  'COLLABORATOR_REMOVED',
  'RESPONSIBILITY_TRANSFERRED',
  'KNOWLEDGE_CONSOLIDATED',
  'RELATION_ADDED',
  'RELATION_REMOVED',
  'CONCEPT_PROPOSED',
  'CONCEPT_PROPOSAL_RESOLVED',
  'STRUCTURAL_REVIEW_RECORDED',
  'SEMANTIC_OBSERVATION_RECORDED',
  'SEMANTIC_OBSERVATION_RESOLVED',
  'WORK_ITEM_COMPLETED',
  'WORK_ITEM_REOPENED',
  'WORK_ITEM_CANCELLED',
] as const;
export type KnowledgeEventType = (typeof KNOWLEDGE_EVENT_TYPES)[number];

export interface IterationRef {
  iterationId: string;
  displayName?: string;
  storageToken: string;
}

export interface ParticipantRef {
  participantId: string;
  displayName: string;
}

export const SYSTEM_KNOWLEDGE_ACTOR = 'SYSTEM' as const;
export type KnowledgeActor = ParticipantRef | typeof SYSTEM_KNOWLEDGE_ACTOR;

export interface KnowledgeProvenance {
  source: KnowledgeProvenanceSource;
  introducedBy?: ParticipantRef;
  confirmedBy?: ParticipantRef;
  evidenceReferenceIds?: string[];
  basedOnKnowledgeIds?: string[];
}

export interface TechnicalSnapshot {
  snapshotId: string;
  sessionId: string;
  kind: TechnicalSnapshotKind;
  capturedAt: string;
  files: TechnicalSnapshotFile[];
  changes: TechnicalSnapshotChange[];
  git: TechnicalSnapshotGitObservation;
  exclusions: TechnicalSnapshotExclusion[];
  totalBytes: number;
}

export interface WorkSession {
  sessionId: string;
  developer: ParticipantRef;
  workItemId: string;
  status: WorkSessionStatus;
  activatedAt: string;
  suspendedAt?: string;
  activationSnapshotId: string;
  lastCheckpointId?: string;
}

export interface SessionCheckpoint {
  checkpointId: string;
  sessionId: string;
  workItemId: string;
  snapshotId: string;
  kind: SessionCheckpointKind;
  observedWork: string[];
  relevantContext: string[];
  pendingQuestions: string[];
  semanticSummary?: string;
  provenance: KnowledgeProvenance;
  recordedAt: string;
}

export interface ConsolidatedFunctionalOverview {
  purpose?: string;
  actualBehavior?: string;
  functionalFlow: string[];
  entryConditions: string[];
  businessRules: string[];
  testData: string[];
  relatedWorkItemIds: string[];
}

export interface ConsolidatedComponent {
  name: string;
  type: string;
  responsibility: string;
  changes: string[];
}

export interface ConsolidatedImplementation {
  components: ConsolidatedComponent[];
  dependencies: string[];
  implementationDecisions: string[];
  technicalFlow: string[];
}

export interface ConsolidatedTestScenario {
  title: string;
  steps: string[];
  expectedOutcome: string;
}

export interface ConsolidatedTesting {
  preconditions: string[];
  testData: string[];
  scenarios: ConsolidatedTestScenario[];
  regressionChecks: string[];
  evidenceReferenceIds: string[];
  closureChecklist: string[];
}

export interface KnowledgeConsolidation {
  consolidationId: string;
  workItemId: string;
  functionalOverview: ConsolidatedFunctionalOverview;
  implementation: ConsolidatedImplementation;
  testing: ConsolidatedTesting;
}

export interface WorkItemRelation {
  relationId: string;
  relationType: WorkItemRelationType;
  sourceWorkItemId: string;
  targetWorkItemId: string;
  explanation: string;
  evidenceReferenceIds?: string[];
  provenance: KnowledgeProvenance;
  status: 'ACTIVE' | 'REMOVED';
  recordedAt: string;
  removedAt?: string;
  removalReason?: string;
}

export interface ConceptProposal {
  proposalId: string;
  workItemId: string;
  normalizedName: string;
  displayName: string;
  explanation: string;
  evidenceReferenceIds: string[];
  evidenceFingerprint: string;
  status: ConceptProposalStatus;
  proposedBy: ParticipantRef;
  resolvedBy?: ParticipantRef;
  resolutionReason?: string;
  recordedAt: string;
  resolvedAt?: string;
}

export interface ProjectConcept {
  conceptId: string;
  normalizedName: string;
  displayName: string;
  explanation: string;
  approvedProposalId: string;
  approvedBy: ParticipantRef;
  approvedAt: string;
}

export interface StructuralReviewFinding {
  code: string;
  message: string;
}

export interface StructuralReview {
  reviewId: string;
  workItemId: string;
  result: StructuralReviewResult;
  findings: StructuralReviewFinding[];
  recordedAt: string;
  workItemRevision: number;
}

export interface SemanticObservation {
  observationId: string;
  workItemId: string;
  severity: SemanticObservationSeverity;
  explanation: string;
  evidenceReferenceIds?: string[];
  provenance: KnowledgeProvenance;
  recordedAt: string;
  status: 'OPEN' | 'RESOLVED';
  resolvedAt?: string;
  resolvedBy?: ParticipantRef;
  resolution?: string;
}

export interface ResponsibilityHistoryEntry {
  previousResponsible: ParticipantRef;
  newResponsible: ParticipantRef;
  reason: string;
  transferredAt: string;
  actor: ParticipantRef;
}

export interface WorkItemKnowledgeState {
  workItemId: string;
  iteration: IterationRef;
  status: CanonicalWorkItemStatus;
  classification: KnowledgeClassification;
  responsible: ParticipantRef;
  collaborators: ParticipantRef[];
  responsibilityHistory: ResponsibilityHistoryEntry[];
  latestConsolidation?: KnowledgeConsolidation;
  latestStructuralReview?: StructuralReview;
  completedAt?: string;
  lastCompletionBoundary?: HistoricalMutationBoundary;
  cancelledAt?: string;
  lastReopenedAt?: string;
}

export interface HistoricalMutationBoundary {
  m3DocumentRevisions: Record<ManagedDocumentType, number>;
  m4AuditRevision: number;
}

export interface WorkflowInitializedPayload {
  workItemId: string;
  iteration: IterationRef;
  responsible: ParticipantRef;
  classification: KnowledgeClassification;
  initialStatus: 'IN_PROGRESS';
}

export interface SessionActivatedPayload {
  sessionId: string;
  developer: ParticipantRef;
  workItemId: string;
  activationSnapshotId: string;
  previousCheckpointId?: string;
}

export interface SessionSuspendedPayload {
  sessionId: string;
  checkpointId: string;
}

export interface SessionCheckpointRecordedPayload {
  checkpointId: string;
  sessionId: string;
  workItemId: string;
  snapshotId: string;
  kind: SessionCheckpointKind;
  observedWork: string[];
  relevantContext: string[];
  pendingQuestions: string[];
  semanticSummary?: string;
}

export interface TechnicalSnapshotRecordedPayload {
  snapshot: TechnicalSnapshot;
}

export interface CollaboratorAddedPayload {
  workItemId: string;
  collaborator: ParticipantRef;
}

export interface CollaboratorRemovedPayload {
  workItemId: string;
  participantId: string;
  reason: string;
}

export interface ResponsibilityTransferredPayload {
  workItemId: string;
  previousResponsibleId: string;
  newResponsible: ParticipantRef;
  reason: string;
  confirmation: true;
}

export interface KnowledgeConsolidatedPayload {
  consolidation: KnowledgeConsolidation;
}

export interface RelationAddedPayload {
  relationId: string;
  relationType: WorkItemRelationType;
  sourceWorkItemId: string;
  targetWorkItemId: string;
  explanation: string;
  evidenceReferenceIds?: string[];
}

export interface RelationRemovedPayload {
  relationId: string;
  reason: string;
}

export interface ConceptProposedPayload {
  proposalId: string;
  workItemId: string;
  normalizedName: string;
  displayName: string;
  explanation: string;
  evidenceReferenceIds: string[];
  evidenceFingerprint: string;
  proposedBy: ParticipantRef;
}

export interface ConceptProposalResolvedPayload {
  proposalId: string;
  resolution: 'APPROVED' | 'REJECTED';
  resolvedBy: ParticipantRef;
  resolutionReason: string;
  confirmation: boolean;
}

export interface StructuralReviewRecordedPayload {
  reviewId: string;
  workItemId: string;
  result: StructuralReviewResult;
  findings: StructuralReviewFinding[];
}

export interface SemanticObservationRecordedPayload {
  observationId: string;
  workItemId: string;
  severity: SemanticObservationSeverity;
  explanation: string;
  evidenceReferenceIds?: string[];
}

export interface SemanticObservationResolvedPayload {
  observationId: string;
  workItemId: string;
  resolvedBy: ParticipantRef;
  resolution: string;
}

export interface WorkItemCompletedPayload {
  workItemId: string;
  responsibleId: string;
  structuralReviewId: string;
  historicalMutationBoundary: HistoricalMutationBoundary;
  confirmation: true;
}

export interface WorkItemReopenedPayload {
  workItemId: string;
  reason: string;
  trigger: string;
  explicit: boolean;
  confirmation: boolean;
}

export interface WorkItemCancelledPayload {
  workItemId: string;
  responsibleId: string;
  reason: string;
  confirmation: true;
}

export interface KnowledgeEventPayloadMap {
  WORKFLOW_INITIALIZED: WorkflowInitializedPayload;
  SESSION_ACTIVATED: SessionActivatedPayload;
  SESSION_SUSPENDED: SessionSuspendedPayload;
  SESSION_CHECKPOINT_RECORDED: SessionCheckpointRecordedPayload;
  TECHNICAL_SNAPSHOT_RECORDED: TechnicalSnapshotRecordedPayload;
  COLLABORATOR_ADDED: CollaboratorAddedPayload;
  COLLABORATOR_REMOVED: CollaboratorRemovedPayload;
  RESPONSIBILITY_TRANSFERRED: ResponsibilityTransferredPayload;
  KNOWLEDGE_CONSOLIDATED: KnowledgeConsolidatedPayload;
  RELATION_ADDED: RelationAddedPayload;
  RELATION_REMOVED: RelationRemovedPayload;
  CONCEPT_PROPOSED: ConceptProposedPayload;
  CONCEPT_PROPOSAL_RESOLVED: ConceptProposalResolvedPayload;
  STRUCTURAL_REVIEW_RECORDED: StructuralReviewRecordedPayload;
  SEMANTIC_OBSERVATION_RECORDED: SemanticObservationRecordedPayload;
  SEMANTIC_OBSERVATION_RESOLVED: SemanticObservationResolvedPayload;
  WORK_ITEM_COMPLETED: WorkItemCompletedPayload;
  WORK_ITEM_REOPENED: WorkItemReopenedPayload;
  WORK_ITEM_CANCELLED: WorkItemCancelledPayload;
}

export type KnowledgeEventInput = {
  [EventType in KnowledgeEventType]: {
    eventType: EventType;
    provenance: KnowledgeProvenance;
    payload: KnowledgeEventPayloadMap[EventType];
  };
}[KnowledgeEventType];

export type KnowledgeEvent = {
  [EventType in KnowledgeEventType]: {
    eventId: string;
    eventType: EventType;
    provenance: KnowledgeProvenance;
    payload: KnowledgeEventPayloadMap[EventType];
  };
}[KnowledgeEventType];

export interface KnowledgeOperation {
  operationId: string;
  knowledgeRevision: number;
  operation: KnowledgeOperationName;
  idempotencyKey: string;
  payloadFingerprint: string;
  recordedAt: string;
  actor: KnowledgeActor;
  events: KnowledgeEvent[];
}

export interface KnowledgeIdempotencyEntry {
  idempotencyKey: string;
  operation: KnowledgeOperationName;
  operationId: string;
  payloadFingerprint: string;
  resultingKnowledgeRevision: number;
}

export interface KnowledgeBaseLedger {
  schemaVersion: typeof KNOWLEDGE_BASE_SCHEMA_VERSION;
  knowledgeRevision: number;
  updatedAt: string;
  operations: KnowledgeOperation[];
  idempotencyIndex: KnowledgeIdempotencyEntry[];
}

export interface AppendKnowledgeOperationRequest {
  expectedKnowledgeRevision: number;
  idempotencyKey: string;
  operation: KnowledgeOperationName;
  actor: KnowledgeActor;
  events: KnowledgeEventInput[];
}

export interface KnowledgeBaseMutationResult {
  ledger: KnowledgeBaseLedger;
  knowledgeOperation: KnowledgeOperation;
  knowledgeRevision: number;
  idempotent: boolean;
}

export interface KnowledgeBaseState {
  knowledgeRevision: number;
  workItems: WorkItemKnowledgeState[];
  sessions: WorkSession[];
  snapshots: TechnicalSnapshot[];
  checkpoints: SessionCheckpoint[];
  relations: WorkItemRelation[];
  conceptProposals: ConceptProposal[];
  concepts: ProjectConcept[];
  structuralReviews: StructuralReview[];
  semanticObservations: SemanticObservation[];
  workItemRevisions: Record<string, number>;
  developerRevisions: Record<string, number>;
  catalogRevision: number;
}

export function canonicalRelationEndpoints(
  relationType: WorkItemRelationType,
  sourceWorkItemId: string,
  targetWorkItemId: string,
): { sourceWorkItemId: string; targetWorkItemId: string } {
  if (relationType !== 'RELATED_TO' || sourceWorkItemId <= targetWorkItemId) {
    return { sourceWorkItemId, targetWorkItemId };
  }
  return { sourceWorkItemId: targetWorkItemId, targetWorkItemId: sourceWorkItemId };
}

export function inverseRelationType(
  relationType: WorkItemRelationType,
): 'RELATED_TO' | 'BLOCKS' | 'CONTAINS' | 'REPLACED_BY' {
  switch (relationType) {
    case 'RELATED_TO':
      return 'RELATED_TO';
    case 'DEPENDS_ON':
      return 'BLOCKS';
    case 'PART_OF':
      return 'CONTAINS';
    case 'REPLACES':
      return 'REPLACED_BY';
  }
}
