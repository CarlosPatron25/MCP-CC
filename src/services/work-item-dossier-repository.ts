import type { WorkItem } from '../domain/work-item.js';
import type {
  DocumentLifecycleMetadata,
  ManagedDocument,
  ManagedDocumentType,
} from '../domain/work-item-document.js';

/**
 * Application port for the active Work Item dossier. Implementations own all
 * filesystem details, including containment, staging, locking, and recovery.
 */
export interface WorkItemDossierRepository {
  readWorkItem(workItemId: string): Promise<WorkItem>;
  readManifestContent(workItemId: string): Promise<string>;
  readDocument(workItemId: string, documentType: ManagedDocumentType): Promise<ManagedDocument>;
  readLifecycleMetadata(workItemId: string): Promise<DocumentLifecycleMetadata[]>;
  initializeDocuments(
    request: InitializeDossierDocumentsRequest,
  ): Promise<InitializeDossierDocumentsResult>;
  commitDocument(request: CommitDossierDocumentRequest): Promise<void>;
}

export type DossierDocumentToCreate = ManagedDocument;

export interface InitializeDossierDocumentsRequest {
  workItemId: string;
  documents: DossierDocumentToCreate[];
  manifest: ManagedDocument;
}

export interface InitializeDossierDocumentsResult {
  created: DocumentLifecycleMetadata[];
  existing: DocumentLifecycleMetadata[];
}

export interface CommitDossierDocumentRequest {
  workItemId: string;
  expectedRevision: number;
  document: ManagedDocument;
  manifest: ManagedDocument;
}
