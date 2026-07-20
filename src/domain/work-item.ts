export const WORK_ITEM_TYPES = ['USER_STORY', 'DEFECT', 'INCIDENT', 'TECHNICAL_TASK'] as const;

export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];

export const WORK_ITEM_STATUSES = [
  'DRAFT',
  'ANALYSIS',
  'PLANNED',
  'DEVELOPMENT',
  'TESTING',
  'READY_FOR_REVIEW',
  'CLOSED',
  'BLOCKED',
  'REOPENED',
  'CANCELLED',
] as const;

export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export interface WorkItemDates {
  startedAt: string;
  plannedCompletionAt?: string;
  actualCompletionAt?: string;
}

export interface WorkItemResponsibility {
  responsiblePerson?: string;
}

export interface SalesforceContext {
  developmentAlias: string;
  sandboxName?: string;
}

export interface FunctionalContext {
  definition: string;
  acceptanceCriteria?: string[];
}

export interface InitialScope {
  relatedComponents: string[];
}

export interface BusinessContext {
  additionalInformation?: string;
}

export interface DecisionRecord {
  id: string;
  title: string;
  decision: string;
  decidedAt: string;
  rationale?: string;
}

export interface Checkpoint {
  id: string;
  recordedAt: string;
  summary: string;
  author?: string;
}

export interface TestCase {
  id: string;
  title: string;
  result: 'NOT_RUN' | 'PASSED' | 'FAILED' | 'BLOCKED';
  evidenceReferences?: string[];
}

export interface WorkItemManifest {
  schemaVersion: string;
  workItemId: string;
  generatedAt: string;
  documents?: string[];
}

export interface WorkItem {
  id: string;
  rallyId: string;
  type: WorkItemType;
  status: WorkItemStatus;
  title: string;
  dates: WorkItemDates;
  responsibility?: WorkItemResponsibility;
  salesforce: SalesforceContext;
  functional: FunctionalContext;
  initialScope: InitialScope;
  business?: BusinessContext;
  createdAt: string;
  updatedAt: string;
  decisions?: DecisionRecord[];
  checkpoints?: Checkpoint[];
  tests?: TestCase[];
}
