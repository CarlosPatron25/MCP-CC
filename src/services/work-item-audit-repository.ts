import type { WorkItem } from '../domain/work-item.js';
import type { DocumentLifecycleMetadata } from '../domain/work-item-document.js';

export interface StoredAuditArtifacts {
  ledger: string;
  decisions: string;
  checkpoints: string;
  testing: string;
  evidenceReferences: string;
}

export type StoredAuditTrackingState =
  { status: 'ABSENT' } | { status: 'INITIALIZED'; artifacts: StoredAuditArtifacts };

export interface WorkItemAuditSnapshot {
  workItem: WorkItem;
  manifest: string;
  lifecycleMetadata: DocumentLifecycleMetadata[];
  tracking: StoredAuditTrackingState;
}

export interface AuditCommitArtifacts extends StoredAuditArtifacts {
  manifest: string;
}

export interface AuditRepositoryCommit {
  initialization: boolean;
  artifacts: AuditCommitArtifacts;
  validateCommittedSnapshot: (snapshot: WorkItemAuditSnapshot) => void;
}

export interface AuditRepositoryDecision<Result> {
  result: Result;
  commit?: AuditRepositoryCommit;
}

/**
 * Application port for one consistent M4 snapshot. The local implementation
 * invokes the callback while holding the shared Work Item exclusion lock.
 */
export interface WorkItemAuditRepository {
  withSnapshot<Result>(
    workItemId: string,
    decide: (
      snapshot: WorkItemAuditSnapshot,
    ) => Promise<AuditRepositoryDecision<Result>> | AuditRepositoryDecision<Result>,
  ): Promise<Result>;
}
