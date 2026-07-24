import { lstat, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  WORK_ITEM_STATUSES,
  WORK_ITEM_TYPES,
  type WorkItem,
  type WorkItemStatus,
  type WorkItemType,
} from '../domain/work-item.js';
import {
  MANAGED_DOCUMENT_RELATIVE_PATHS,
  type DocumentLifecycleMetadata,
  type ManagedDocument,
  type ManagedDocumentType,
} from '../domain/work-item-document.js';
import {
  DocumentAlreadyExistsError,
  DocumentLifecycleConflictError,
  DocumentNotInitializedError,
  DocumentRevisionConflictError,
  DocumentUpdateError,
  ManifestUpdateError,
  WorkItemNotFoundError,
  WorkspaceNotInitializedError,
  type WorkspaceError,
} from '../errors/workspace-error.js';
import { resolvePathWithinRoot } from './safe-path.js';
import { WorkItemOperationCoordinator } from './work-item-operation-coordinator.js';
import type {
  CommitDossierDocumentRequest,
  InitializeDossierDocumentsRequest,
  InitializeDossierDocumentsResult,
  WorkItemDossierRepository,
} from '../services/work-item-dossier-repository.js';
import {
  extractDocumentLifecycleInventorySection,
  parseDocumentLifecycleInventorySection,
} from '../services/manifest-section-compositor.js';

const SAFE_WORK_ITEM_ID = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export interface LocalFilesystemWorkItemDossierRepositoryOptions {
  workspaceRoot: string;
  /** Test-only hook for verifying that a failed commit restores visible state. */
  beforeCommit?: () => void;
  /** Test-only hook invoked after originals are staged and before replacements are visible. */
  afterOriginalsMoved?: () => void;
}

interface Replacement {
  relativePath: string;
  content: string;
  originalExists: boolean;
}

const DOCUMENT_COMMIT_RELATIVE_PATHS = [...Object.values(MANAGED_DOCUMENT_RELATIVE_PATHS)] as const;

export const SHARED_TRANSACTION_RELATIVE_PATHS = [
  ...Object.values(MANAGED_DOCUMENT_RELATIVE_PATHS),
  'records/AUDIT_LEDGER.json',
  '06_DECISIONS.md',
  '07_CHECKPOINTS.md',
  '08_TEST_PLAN.md',
  'evidence/REFERENCES.md',
] as const;

function isCode(error: unknown, expectedCode: string): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === expectedCode
  );
}

function isWorkspaceError(error: unknown): error is WorkspaceError {
  return error instanceof Error && 'code' in error && typeof error.code === 'string';
}

function yamlString(value: string | undefined, field: string): string {
  if (value === undefined) {
    throw new DocumentUpdateError('The active Work Item dossier cannot be read safely.', { field });
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'string') {
      throw new Error('not a string');
    }
    return parsed;
  } catch {
    throw new DocumentUpdateError('The active Work Item dossier cannot be read safely.', { field });
  }
}

function yamlValue(lines: readonly string[], prefix: string, field: string): string {
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  return yamlString(line?.slice(prefix.length), field);
}

function yamlOptionalValue(
  lines: readonly string[],
  prefix: string,
  field: string,
): string | undefined {
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  return line === undefined ? undefined : yamlString(line.slice(prefix.length), field);
}

function yamlList(
  lines: readonly string[],
  header: string,
  itemPrefix: string,
  field: string,
): string[] {
  const headerIndex = lines.indexOf(header);
  if (headerIndex === -1) {
    throw new DocumentUpdateError('The active Work Item dossier cannot be read safely.', { field });
  }

  const values: string[] = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || !line.startsWith(itemPrefix)) {
      break;
    }
    values.push(yamlString(line.slice(itemPrefix.length), field));
  }
  return values;
}

export function parsePersistedWorkItem(content: string): WorkItem {
  const lines = content.split('\n');
  const type = yamlValue(lines, 'type: ', 'type');
  const status = yamlValue(lines, 'status: ', 'status');
  if (!(WORK_ITEM_TYPES as readonly string[]).includes(type)) {
    throw new DocumentUpdateError('The active Work Item dossier cannot be read safely.', {
      field: 'type',
    });
  }
  if (!(WORK_ITEM_STATUSES as readonly string[]).includes(status)) {
    throw new DocumentUpdateError('The active Work Item dossier cannot be read safely.', {
      field: 'status',
    });
  }

  const responsibilityIndex = lines.indexOf('responsibility: null');
  const businessIndex = lines.indexOf('business: null');
  const plannedCompletionAt = yamlOptionalValue(
    lines,
    '  plannedCompletionAt: ',
    'plannedCompletionAt',
  );
  const responsiblePerson =
    responsibilityIndex === -1
      ? yamlOptionalValue(lines, '  responsiblePerson: ', 'responsiblePerson')
      : undefined;
  const additionalInformation =
    businessIndex === -1
      ? yamlOptionalValue(lines, '  additionalInformation: ', 'additionalInformation')
      : undefined;

  return {
    id: yamlValue(lines, 'id: ', 'id'),
    rallyId: yamlValue(lines, 'rallyId: ', 'rallyId'),
    type: type as WorkItemType,
    status: status as WorkItemStatus,
    title: yamlValue(lines, 'title: ', 'title'),
    dates: {
      startedAt: yamlValue(lines, '  startedAt: ', 'startedAt'),
      ...(plannedCompletionAt === undefined ? {} : { plannedCompletionAt }),
    },
    ...(responsiblePerson === undefined ? {} : { responsibility: { responsiblePerson } }),
    salesforce: {
      developmentAlias: yamlValue(lines, '  developmentAlias: ', 'developmentAlias'),
    },
    functional: {
      definition: yamlValue(lines, '  definition: ', 'functional.definition'),
      acceptanceCriteria: yamlList(
        lines,
        '  acceptanceCriteria:',
        '    - ',
        'functional.acceptanceCriteria',
      ),
    },
    initialScope: {
      relatedComponents: yamlList(
        lines,
        '  relatedComponents:',
        '    - ',
        'initialScope.relatedComponents',
      ),
    },
    ...(additionalInformation === undefined ? {} : { business: { additionalInformation } }),
    createdAt: yamlValue(lines, 'createdAt: ', 'createdAt'),
    updatedAt: yamlValue(lines, 'updatedAt: ', 'updatedAt'),
  };
}

export function parseLifecycleMetadata(manifest: string): DocumentLifecycleMetadata[] {
  const section = extractDocumentLifecycleInventorySection(manifest);
  if (section === undefined) {
    throw new DocumentNotInitializedError('The document lifecycle has not been initialized.');
  }
  return parseDocumentLifecycleInventorySection(section.content);
}

/** Local persistence adapter for the active, authorized Work Item workspace. */
export class LocalFilesystemWorkItemDossierRepository implements WorkItemDossierRepository {
  private readonly beforeCommit: (() => void) | undefined;
  private readonly afterOriginalsMoved: (() => void) | undefined;
  private readonly coordinator: WorkItemOperationCoordinator;

  public constructor(private readonly options: LocalFilesystemWorkItemDossierRepositoryOptions) {
    this.beforeCommit = options.beforeCommit;
    this.afterOriginalsMoved = options.afterOriginalsMoved;
    this.coordinator = new WorkItemOperationCoordinator({
      workspaceRoot: options.workspaceRoot,
      allowedRelativePaths: DOCUMENT_COMMIT_RELATIVE_PATHS,
      recoveryAllowedRelativePaths: SHARED_TRANSACTION_RELATIVE_PATHS,
      conflictError: () =>
        new DocumentLifecycleConflictError(
          'Another document lifecycle operation is already in progress for this Work Item.',
        ),
      updateError: () => new DocumentUpdateError('Could not update the document lifecycle safely.'),
      recoveryError: () =>
        new DocumentUpdateError('Could not recover the document lifecycle safely.'),
      injectFailure: (point) => {
        if (point === 'after-staging-prepared') {
          this.beforeCommit?.();
        }
        if (point === 'after-originals-moved') {
          this.afterOriginalsMoved?.();
        }
        return undefined;
      },
    });
  }

  public async readWorkItem(workItemId: string): Promise<WorkItem> {
    const dossierDirectory = await this.dossierDirectory(workItemId);
    return this.coordinator.runExclusive(workItemId, dossierDirectory, async () => {
      const workItemPath = await this.documentPath(dossierDirectory, 'WORK_ITEM.yml');
      return parsePersistedWorkItem(await this.readTextFile(workItemPath, 'WORK_ITEM.yml'));
    });
  }

  public async readManifestContent(workItemId: string): Promise<string> {
    const dossierDirectory = await this.dossierDirectory(workItemId);
    return this.coordinator.runExclusive(workItemId, dossierDirectory, async () => {
      const manifestPath = await this.managedDocumentPath(dossierDirectory, 'MANIFEST');
      return this.readTextFile(manifestPath, '00_MANIFEST.md');
    });
  }

  public async readDocument(
    workItemId: string,
    documentType: ManagedDocumentType,
  ): Promise<ManagedDocument> {
    const dossierDirectory = await this.dossierDirectory(workItemId);
    return this.coordinator.runExclusive(workItemId, dossierDirectory, async () => {
      const metadata = await this.readLifecycleMetadataInternal(dossierDirectory);
      const documentMetadata = metadata.find((entry) => entry.documentType === documentType);
      if (documentMetadata === undefined) {
        throw new DocumentNotInitializedError('The requested document has not been initialized.');
      }
      const documentPath = await this.managedDocumentPath(dossierDirectory, documentType);
      return {
        metadata: documentMetadata,
        content: await this.readTextFile(documentPath, documentMetadata.relativePath),
      };
    });
  }

  public async readLifecycleMetadata(workItemId: string): Promise<DocumentLifecycleMetadata[]> {
    const dossierDirectory = await this.dossierDirectory(workItemId);
    return this.coordinator.runExclusive(workItemId, dossierDirectory, () =>
      this.readLifecycleMetadataInternal(dossierDirectory),
    );
  }

  public async initializeDocuments(
    request: InitializeDossierDocumentsRequest,
  ): Promise<InitializeDossierDocumentsResult> {
    const dossierDirectory = await this.dossierDirectory(request.workItemId);
    return this.coordinator.runExclusive(request.workItemId, dossierDirectory, async () => {
      try {
        const existing = await this.readLifecycleMetadataInternal(dossierDirectory);
        return { created: [], existing };
      } catch (error) {
        if (!(error instanceof DocumentNotInitializedError)) {
          throw error;
        }
      }

      this.assertInitializationRequest(request);
      const replacements: Replacement[] = [];
      for (const document of request.documents) {
        const targetPath = await this.managedDocumentPath(
          dossierDirectory,
          document.metadata.documentType,
        );
        if (await this.pathExists(targetPath)) {
          throw new DocumentAlreadyExistsError(
            'A lifecycle document already exists and will not be overwritten.',
          );
        }
        replacements.push({
          relativePath: document.metadata.relativePath,
          content: document.content,
          originalExists: false,
        });
      }

      await this.managedDocumentPath(dossierDirectory, 'MANIFEST');
      replacements.push({
        relativePath: request.manifest.metadata.relativePath,
        content: request.manifest.content,
        originalExists: true,
      });

      await this.commitReplacements(
        request.workItemId,
        dossierDirectory,
        replacements,
        'initialization',
      );
      return { created: request.documents.map((document) => document.metadata), existing: [] };
    });
  }

  public async commitDocument(request: CommitDossierDocumentRequest): Promise<void> {
    const dossierDirectory = await this.dossierDirectory(request.workItemId);
    return this.coordinator.runExclusive(request.workItemId, dossierDirectory, async () => {
      const lifecycle = await this.readLifecycleMetadataInternal(dossierDirectory);
      const currentDocument = lifecycle.find(
        (entry) => entry.documentType === request.document.metadata.documentType,
      );
      const currentManifest = lifecycle.find((entry) => entry.documentType === 'MANIFEST');
      if (currentDocument === undefined || currentManifest === undefined) {
        throw new DocumentNotInitializedError('The requested document has not been initialized.');
      }
      if (currentDocument.revision !== request.expectedRevision) {
        throw new DocumentRevisionConflictError(
          'The document revision does not match the current version.',
        );
      }
      if (
        request.document.metadata.revision !== currentDocument.revision + 1 ||
        request.manifest.metadata.documentType !== 'MANIFEST' ||
        request.manifest.metadata.revision !== currentManifest.revision + 1
      ) {
        throw new DocumentUpdateError('The document lifecycle update is invalid.');
      }

      const documentPath = await this.managedDocumentPath(
        dossierDirectory,
        request.document.metadata.documentType,
      );
      const manifestPath = await this.managedDocumentPath(dossierDirectory, 'MANIFEST');
      await this.assertExistingFile(documentPath, request.document.metadata.relativePath);
      await this.assertExistingFile(manifestPath, request.manifest.metadata.relativePath);
      await this.commitReplacements(
        request.workItemId,
        dossierDirectory,
        [
          {
            relativePath: request.document.metadata.relativePath,
            content: request.document.content,
            originalExists: true,
          },
          {
            relativePath: request.manifest.metadata.relativePath,
            content: request.manifest.content,
            originalExists: true,
          },
        ],
        'update',
      );
    });
  }

  private async dossierDirectory(workItemId: string): Promise<string> {
    if (!SAFE_WORK_ITEM_ID.test(workItemId)) {
      throw new WorkItemNotFoundError('The requested active Work Item does not exist.');
    }

    const workspaceDirectory = resolvePathWithinRoot(this.options.workspaceRoot, '.ws-workspace');
    const activeDirectory = resolvePathWithinRoot(workspaceDirectory, 'active');
    await this.assertExistingDirectory(
      workspaceDirectory,
      'The workspace must be initialized before accessing a Work Item.',
    );
    await this.assertExistingDirectory(
      activeDirectory,
      'The workspace must be initialized before accessing a Work Item.',
    );
    const dossierDirectory = resolvePathWithinRoot(activeDirectory, workItemId);
    try {
      const entry = await lstat(dossierDirectory);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new WorkItemNotFoundError('The requested active Work Item does not exist.');
      }
      return dossierDirectory;
    } catch (error) {
      if (error instanceof WorkItemNotFoundError) {
        throw error;
      }
      if (isCode(error, 'ENOENT')) {
        throw new WorkItemNotFoundError('The requested active Work Item does not exist.');
      }
      throw new WorkItemNotFoundError('The requested active Work Item does not exist.');
    }
  }

  private async managedDocumentPath(
    dossierDirectory: string,
    documentType: ManagedDocumentType,
  ): Promise<string> {
    const relativePath = MANAGED_DOCUMENT_RELATIVE_PATHS[documentType];
    return this.documentPath(dossierDirectory, relativePath);
  }

  private async documentPath(dossierDirectory: string, relativePath: string): Promise<string> {
    const targetPath = resolvePathWithinRoot(dossierDirectory, relativePath);
    const parentDirectory = dirname(targetPath);
    if (parentDirectory !== dossierDirectory) {
      await this.assertExistingDirectory(
        parentDirectory,
        'The active Work Item dossier cannot be read safely.',
      );
    }
    return targetPath;
  }

  private async readLifecycleMetadataInternal(
    dossierDirectory: string,
  ): Promise<DocumentLifecycleMetadata[]> {
    const manifestPath = await this.managedDocumentPath(dossierDirectory, 'MANIFEST');
    return parseLifecycleMetadata(await this.readTextFile(manifestPath, '00_MANIFEST.md'));
  }

  private async commitReplacements(
    workItemId: string,
    dossierDirectory: string,
    replacements: readonly Replacement[],
    operation: 'initialization' | 'update',
  ): Promise<void> {
    try {
      await this.coordinator.commit(workItemId, dossierDirectory, replacements, async () => {
        for (const replacement of replacements) {
          const targetPath = await this.documentPath(dossierDirectory, replacement.relativePath);
          const visibleContent = await this.readTextFile(targetPath, replacement.relativePath);
          if (visibleContent !== replacement.content) {
            throw new DocumentUpdateError('Could not update the document lifecycle safely.');
          }
        }
        await this.readLifecycleMetadataInternal(dossierDirectory);
      });
    } catch (error) {
      if (operation === 'initialization') {
        throw new ManifestUpdateError('Could not initialize the document lifecycle safely.');
      }
      if (isWorkspaceError(error)) {
        throw error;
      }
      throw new DocumentUpdateError('Could not update the document lifecycle safely.');
    }
  }

  private assertInitializationRequest(request: InitializeDossierDocumentsRequest): void {
    const documentTypes = request.documents.map((document) => document.metadata.documentType);
    const expectedTypes = [
      'CURRENT_STATE',
      'TECHNICAL_ANALYSIS',
      'IMPACT_ANALYSIS',
      'IMPLEMENTATION_PLAN',
    ];
    if (
      documentTypes.length !== expectedTypes.length ||
      expectedTypes.some(
        (documentType) => !documentTypes.includes(documentType as ManagedDocumentType),
      ) ||
      new Set(documentTypes).size !== expectedTypes.length ||
      request.manifest.metadata.documentType !== 'MANIFEST'
    ) {
      throw new ManifestUpdateError('The document lifecycle initialization is invalid.');
    }
  }

  private async assertExistingDirectory(path: string, message: string): Promise<void> {
    try {
      const entry = await lstat(path);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new WorkspaceNotInitializedError(message);
      }
    } catch (error) {
      if (error instanceof WorkspaceNotInitializedError) {
        throw error;
      }
      if (isCode(error, 'ENOENT')) {
        throw new WorkspaceNotInitializedError(message);
      }
      throw new WorkspaceNotInitializedError(message);
    }
  }

  private async assertExistingFile(path: string, relativePath: string): Promise<void> {
    try {
      const entry = await lstat(path);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new DocumentNotInitializedError('The requested document has not been initialized.');
      }
    } catch (error) {
      if (error instanceof DocumentNotInitializedError) {
        throw error;
      }
      throw new DocumentNotInitializedError('The requested document has not been initialized.', {
        document: relativePath,
      });
    }
  }

  private async readTextFile(path: string, relativePath: string): Promise<string> {
    await this.assertExistingFile(path, relativePath);
    try {
      return await readFile(path, 'utf8');
    } catch {
      throw new DocumentNotInitializedError('The requested document has not been initialized.', {
        document: relativePath,
      });
    }
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await lstat(path);
      return true;
    } catch (error) {
      return !isCode(error, 'ENOENT');
    }
  }
}
