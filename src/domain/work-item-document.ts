/**
 * Milestone 3 document lifecycle contracts. These contracts deliberately model
 * only the documents that are managed during the local MVP.
 */
export const MANAGED_DOCUMENT_TYPES = [
  'MANIFEST',
  'FUNCTIONAL_ANALYSIS',
  'CURRENT_STATE',
  'TECHNICAL_ANALYSIS',
  'IMPACT_ANALYSIS',
  'IMPLEMENTATION_PLAN',
  'AI_CONTEXT',
] as const;

export type ManagedDocumentType = (typeof MANAGED_DOCUMENT_TYPES)[number];

export const INITIALIZABLE_DOCUMENT_TYPES = [
  'CURRENT_STATE',
  'TECHNICAL_ANALYSIS',
  'IMPACT_ANALYSIS',
  'IMPLEMENTATION_PLAN',
] as const;

export type InitializableDocumentType = (typeof INITIALIZABLE_DOCUMENT_TYPES)[number];

export const MANAGED_DOCUMENT_RELATIVE_PATHS: Record<ManagedDocumentType, string> = {
  MANIFEST: '00_MANIFEST.md',
  FUNCTIONAL_ANALYSIS: '01_FUNCTIONAL_ANALYSIS.md',
  CURRENT_STATE: '02_CURRENT_STATE.md',
  TECHNICAL_ANALYSIS: '03_TECHNICAL_ANALYSIS.md',
  IMPACT_ANALYSIS: '04_IMPACT_ANALYSIS.md',
  IMPLEMENTATION_PLAN: '05_IMPLEMENTATION_PLAN.md',
  AI_CONTEXT: 'context/AI_CONTEXT.md',
};

export const EDITABLE_DOCUMENT_TYPES = [
  'FUNCTIONAL_ANALYSIS',
  'CURRENT_STATE',
  'TECHNICAL_ANALYSIS',
  'IMPACT_ANALYSIS',
  'IMPLEMENTATION_PLAN',
] as const;

export type EditableDocumentType = (typeof EDITABLE_DOCUMENT_TYPES)[number];

export const DOCUMENT_LIFECYCLE_STATUSES = ['CREATED', 'INITIALIZED', 'UPDATED'] as const;

export type DocumentLifecycleStatus = (typeof DOCUMENT_LIFECYCLE_STATUSES)[number];

export const DOCUMENT_CONTENT_TYPES = ['TEMPLATE', 'SUPPLIED', 'DERIVED'] as const;

export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];

export interface DocumentLifecycleMetadata {
  documentType: ManagedDocumentType;
  relativePath: string;
  status: DocumentLifecycleStatus;
  revision: number;
  updatedAt: string;
  /** SYSTEM identifies the lifecycle process, never a person or corporate user. */
  updatedBy: 'SYSTEM';
  contentType: DocumentContentType;
}

export interface ManagedDocument {
  metadata: DocumentLifecycleMetadata;
  content: string;
}

export interface FunctionalAnalysisDocumentPayload {
  documentType: 'FUNCTIONAL_ANALYSIS';
  functionalDefinition: string;
  acceptanceCriteria?: string[];
  additionalBusinessInformation?: string;
  relatedComponents: string[];
  developmentAlias: string;
  responsiblePerson?: string;
  startedAt: string;
  plannedCompletionAt?: string;
}

export interface CurrentStateDocumentPayload {
  documentType: 'CURRENT_STATE';
  knownFacts: string[];
  constraints?: string[];
  openQuestions?: string[];
}

export interface TechnicalAnalysisDocumentPayload {
  documentType: 'TECHNICAL_ANALYSIS';
  knownFacts: string[];
  declaredHypotheses?: string[];
  dependencies?: string[];
  openQuestions?: string[];
}

export interface ImpactAnalysisDocumentPayload {
  documentType: 'IMPACT_ANALYSIS';
  affectedComponents: string[];
  knownImpacts?: string[];
  openQuestions?: string[];
}

export interface ImplementationPlanDocumentPayload {
  documentType: 'IMPLEMENTATION_PLAN';
  plannedSteps: string[];
  prerequisites?: string[];
  openQuestions?: string[];
}

export type EditableDocumentPayload =
  | FunctionalAnalysisDocumentPayload
  | CurrentStateDocumentPayload
  | TechnicalAnalysisDocumentPayload
  | ImpactAnalysisDocumentPayload
  | ImplementationPlanDocumentPayload;

export interface DocumentUpdateRequest {
  workItemId: string;
  expectedRevision: number;
  payload: EditableDocumentPayload;
}

export type DocumentReadResult = ManagedDocument;

export interface DocumentMutationResult {
  documentType: ManagedDocumentType;
  relativePath: string;
  status: DocumentLifecycleStatus;
  revision: number;
  updatedAt: string;
  contentType: DocumentContentType;
}

export interface DocumentInitializationResult {
  created: DocumentMutationResult[];
  existing: DocumentMutationResult[];
}

export function isManagedDocumentType(value: string): value is ManagedDocumentType {
  return (MANAGED_DOCUMENT_TYPES as readonly string[]).includes(value);
}

export function isEditableDocumentType(value: string): value is EditableDocumentType {
  return (EDITABLE_DOCUMENT_TYPES as readonly string[]).includes(value);
}
