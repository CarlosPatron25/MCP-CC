/**
 * Milestone 4 audit contracts. These types are deliberately separate from the
 * historical placeholders in work-item.ts and from the closed M3 document
 * enumeration.
 */
export const AUDIT_LEDGER_SCHEMA_VERSION = '1.0.0' as const;

export const DECISION_KINDS = ['DECISION', 'CORRECTION', 'SUPERSESSION', 'WITHDRAWAL'] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

export const CHECKPOINT_KINDS = ['PROGRESS', 'RISK', 'BLOCKER', 'HANDOFF'] as const;
export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];

export const VERIFICATION_METHODS = ['MANUAL', 'AUTOMATED'] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export const EXECUTION_METHODS = ['MANUAL', 'AUTOMATED'] as const;
export type ExecutionMethod = (typeof EXECUTION_METHODS)[number];

export const TEST_EXECUTION_OUTCOMES = ['PASSED', 'FAILED', 'BLOCKED'] as const;
export type TestExecutionOutcome = (typeof TEST_EXECUTION_OUTCOMES)[number];

export const TRACKING_TYPES = [
  'DECISIONS',
  'CHECKPOINTS',
  'TESTING',
  'EVIDENCE_REFERENCES',
] as const;
export type TrackingType = (typeof TRACKING_TYPES)[number];

export const AUDIT_OPERATIONS = [
  'record_decision',
  'record_checkpoint',
  'define_test_plan',
  'record_test_execution',
  'register_evidence_reference',
] as const;
export type AuditOperation = (typeof AUDIT_OPERATIONS)[number];

export const AUDIT_LEDGER_RELATIVE_PATH = 'records/AUDIT_LEDGER.json' as const;

export const AUDIT_PROJECTION_RELATIVE_PATHS: Record<TrackingType, string> = {
  DECISIONS: '06_DECISIONS.md',
  CHECKPOINTS: '07_CHECKPOINTS.md',
  TESTING: '08_TEST_PLAN.md',
  EVIDENCE_REFERENCES: 'evidence/REFERENCES.md',
};

export const AUDIT_ARTIFACT_RELATIVE_PATHS = [
  AUDIT_LEDGER_RELATIVE_PATH,
  AUDIT_PROJECTION_RELATIVE_PATHS.DECISIONS,
  AUDIT_PROJECTION_RELATIVE_PATHS.CHECKPOINTS,
  AUDIT_PROJECTION_RELATIVE_PATHS.TESTING,
  AUDIT_PROJECTION_RELATIVE_PATHS.EVIDENCE_REFERENCES,
] as const;

export interface Decision {
  id: string;
  idempotencyKey: string;
  kind: DecisionKind;
  title: string;
  decision: string;
  rationale: string;
  declaredActor: string;
  recordedAt: string;
  relatedDecisionId?: string;
  evidenceReferenceIds?: string[];
}

export interface Checkpoint {
  id: string;
  idempotencyKey: string;
  kind: CheckpointKind;
  summary: string;
  declaredActor: string;
  recordedAt: string;
  correctsCheckpointId?: string;
  relatedDecisionIds?: string[];
  evidenceReferenceIds?: string[];
}

export interface TestCaseDefinition {
  testCaseId: string;
  title: string;
  objective: string;
  verificationMethod: VerificationMethod;
  expectedOutcome: string;
}

export interface TestPlanVersion {
  id: string;
  planId: string;
  planRevision: number;
  idempotencyKey: string;
  purpose: string;
  declaredActor: string;
  recordedAt: string;
  testCases: TestCaseDefinition[];
}

export interface TestExecution {
  id: string;
  idempotencyKey: string;
  planId: string;
  planRevision: number;
  testCaseId: string;
  executionMethod: ExecutionMethod;
  outcome: TestExecutionOutcome;
  summary: string;
  declaredActor: string;
  recordedAt: string;
  evidenceReferenceIds?: string[];
}

export interface EvidenceReference {
  id: string;
  idempotencyKey: string;
  label: string;
  description?: string;
  logicalPath: string;
  declaredActor: string;
  recordedAt: string;
}

export interface IdempotencyIndexEntry {
  idempotencyKey: string;
  operation: AuditOperation;
  entryId: string;
  payloadFingerprint: string;
}

export interface AuditLedger {
  schemaVersion: typeof AUDIT_LEDGER_SCHEMA_VERSION;
  revision: number;
  updatedAt: string;
  decisions: Decision[];
  checkpoints: Checkpoint[];
  testPlans: TestPlanVersion[];
  testExecutions: TestExecution[];
  evidenceReferences: EvidenceReference[];
  idempotencyIndex: IdempotencyIndexEntry[];
}

export type AuditEntry =
  Decision | Checkpoint | TestPlanVersion | TestExecution | EvidenceReference;

export interface RecordDecisionRequest {
  expectedAuditRevision: number;
  idempotencyKey: string;
  kind: DecisionKind;
  title: string;
  decision: string;
  rationale: string;
  declaredActor: string;
  relatedDecisionId?: string;
  evidenceReferenceIds?: string[];
}

export interface RecordCheckpointRequest {
  expectedAuditRevision: number;
  idempotencyKey: string;
  kind: CheckpointKind;
  summary: string;
  declaredActor: string;
  correctsCheckpointId?: string;
  relatedDecisionIds?: string[];
  evidenceReferenceIds?: string[];
}

export interface TestCaseDefinitionInput {
  title: string;
  objective: string;
  verificationMethod: VerificationMethod;
  expectedOutcome: string;
}

export interface DefineTestPlanRequest {
  expectedAuditRevision: number;
  idempotencyKey: string;
  planId?: string;
  expectedPlanRevision: number;
  purpose: string;
  declaredActor: string;
  testCases: TestCaseDefinitionInput[];
}

export interface RecordTestExecutionRequest {
  expectedAuditRevision: number;
  expectedPlanRevision: number;
  idempotencyKey: string;
  planId: string;
  planRevision: number;
  testCaseId: string;
  executionMethod: ExecutionMethod;
  outcome: TestExecutionOutcome;
  summary: string;
  declaredActor: string;
  evidenceReferenceIds?: string[];
}

export interface RegisterEvidenceReferenceRequest {
  expectedAuditRevision: number;
  idempotencyKey: string;
  label: string;
  description?: string;
  logicalPath: string;
  declaredActor: string;
}

export interface AuditLedgerMutationResult<TEntry extends AuditEntry> {
  ledger: AuditLedger;
  entry: TEntry;
  auditRevision: number;
  idempotent: boolean;
}
