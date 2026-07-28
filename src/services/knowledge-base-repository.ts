import type { WorkItem } from '../domain/work-item.js';

export interface KnowledgeDossierSnapshot {
  workItem: WorkItem;
  workItemYml: string;
  manifest: string;
  dossierRelativePath: string;
  existingM5Artifacts: ReadonlySet<string>;
  m5Artifacts: ReadonlyMap<string, string>;
}

export interface KnowledgeBaseRepositorySnapshot {
  ledgerContent?: string;
  dossiers: ReadonlyMap<string, KnowledgeDossierSnapshot>;
}

export interface KnowledgeDossierReplacement {
  workItemId: string;
  relativePath: string;
  content: string;
}

export interface KnowledgeBaseCommit {
  ledgerContent: string;
  dossierReplacements?: readonly KnowledgeDossierReplacement[];
  validateCommitted?: (snapshot: KnowledgeBaseRepositorySnapshot) => void;
}

export interface KnowledgeBaseRepositoryDecision<Result> {
  result: Result;
  commit?: KnowledgeBaseCommit;
}

export interface KnowledgeBaseRepository {
  withSnapshot<Result>(
    affectedWorkItemIds: readonly string[],
    decide: (
      snapshot: KnowledgeBaseRepositorySnapshot,
    ) => Promise<KnowledgeBaseRepositoryDecision<Result>> | KnowledgeBaseRepositoryDecision<Result>,
  ): Promise<Result>;
}
