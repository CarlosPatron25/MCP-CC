import { lstat, mkdir, open, readFile, rename, rm, rmdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  WORK_ITEM_STATUSES,
  WORK_ITEM_TYPES,
  type WorkItem,
  type WorkItemStatus,
  type WorkItemType,
} from '../domain/work-item.js';
import {
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_LIFECYCLE_STATUSES,
  MANAGED_DOCUMENT_RELATIVE_PATHS,
  MANAGED_DOCUMENT_TYPES,
  isManagedDocumentType,
  type DocumentContentType,
  type DocumentLifecycleMetadata,
  type DocumentLifecycleStatus,
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
import type {
  CommitDossierDocumentRequest,
  InitializeDossierDocumentsRequest,
  InitializeDossierDocumentsResult,
  WorkItemDossierRepository,
} from '../services/work-item-dossier-repository.js';

const SAFE_WORK_ITEM_ID = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const LIFECYCLE_HEADING = '## Document Lifecycle Inventory';
const LIFECYCLE_HEADER =
  '| Document type | Relative path | Status | Revision | Updated at | Updated by | Content type |';

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
  targetPath: string;
  originalExists: boolean;
}

interface MovedOriginal {
  targetPath: string;
  backupPath: string;
}

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

function isDocumentLifecycleStatus(value: string): value is DocumentLifecycleStatus {
  return (DOCUMENT_LIFECYCLE_STATUSES as readonly string[]).includes(value);
}

function isDocumentContentType(value: string): value is DocumentContentType {
  return (DOCUMENT_CONTENT_TYPES as readonly string[]).includes(value);
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

function parseWorkItem(content: string): WorkItem {
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

function parseLifecycleMetadata(manifest: string): DocumentLifecycleMetadata[] {
  const lines = manifest.split('\n');
  const headingIndex = lines.indexOf(LIFECYCLE_HEADING);
  if (headingIndex === -1) {
    throw new DocumentNotInitializedError('The document lifecycle has not been initialized.');
  }

  const headerIndex = lines.indexOf(LIFECYCLE_HEADER, headingIndex);
  if (headerIndex === -1 || lines[headerIndex + 1] === undefined) {
    throw new ManifestUpdateError('The document lifecycle inventory cannot be read safely.');
  }

  const metadata: DocumentLifecycleMetadata[] = [];
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || line.trim().length === 0) {
      break;
    }
    if (!line.startsWith('|') || !line.endsWith('|')) {
      throw new ManifestUpdateError('The document lifecycle inventory cannot be read safely.');
    }

    const cells = line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
    const [documentType, relativePath, status, revisionText, updatedAt, updatedBy, contentType] =
      cells;
    if (
      documentType === undefined ||
      relativePath === undefined ||
      status === undefined ||
      revisionText === undefined ||
      updatedAt === undefined ||
      updatedBy === undefined ||
      contentType === undefined ||
      cells.length !== 7 ||
      !isManagedDocumentType(documentType) ||
      MANAGED_DOCUMENT_RELATIVE_PATHS[documentType] !== relativePath ||
      !isDocumentLifecycleStatus(status) ||
      !isDocumentContentType(contentType) ||
      updatedBy !== 'SYSTEM'
    ) {
      throw new ManifestUpdateError('The document lifecycle inventory cannot be read safely.');
    }

    const revision = Number(revisionText);
    if (!Number.isSafeInteger(revision) || revision < 1 || updatedAt.length === 0) {
      throw new ManifestUpdateError('The document lifecycle inventory cannot be read safely.');
    }

    metadata.push({
      documentType,
      relativePath,
      status,
      revision,
      updatedAt,
      updatedBy: 'SYSTEM',
      contentType,
    });
  }

  if (
    metadata.length !== MANAGED_DOCUMENT_TYPES.length ||
    new Set(metadata.map((entry) => entry.documentType)).size !== MANAGED_DOCUMENT_TYPES.length
  ) {
    throw new ManifestUpdateError('The document lifecycle inventory cannot be read safely.');
  }

  return metadata;
}

/** Local persistence adapter for the active, authorized Work Item workspace. */
export class LocalFilesystemWorkItemDossierRepository implements WorkItemDossierRepository {
  private readonly beforeCommit: (() => void) | undefined;
  private readonly afterOriginalsMoved: (() => void) | undefined;

  public constructor(private readonly options: LocalFilesystemWorkItemDossierRepositoryOptions) {
    this.beforeCommit = options.beforeCommit;
    this.afterOriginalsMoved = options.afterOriginalsMoved;
  }

  public async readWorkItem(workItemId: string): Promise<WorkItem> {
    const dossierDirectory = await this.dossierDirectory(workItemId);
    await this.assertNotLocked(workItemId);
    const workItemPath = await this.documentPath(dossierDirectory, 'WORK_ITEM.yml');
    return parseWorkItem(await this.readTextFile(workItemPath, 'WORK_ITEM.yml'));
  }

  public async readManifestContent(workItemId: string): Promise<string> {
    const dossierDirectory = await this.dossierDirectory(workItemId);
    await this.assertNotLocked(workItemId);
    const manifestPath = await this.managedDocumentPath(dossierDirectory, 'MANIFEST');
    const content = await this.readTextFile(manifestPath, '00_MANIFEST.md');
    await this.assertNotLocked(workItemId);
    return content;
  }

  public async readDocument(
    workItemId: string,
    documentType: ManagedDocumentType,
  ): Promise<ManagedDocument> {
    const dossierDirectory = await this.dossierDirectory(workItemId);
    await this.assertNotLocked(workItemId);
    const metadata = await this.readLifecycleMetadataInternal(dossierDirectory);
    const documentMetadata = metadata.find((entry) => entry.documentType === documentType);
    if (documentMetadata === undefined) {
      throw new DocumentNotInitializedError('The requested document has not been initialized.');
    }
    const documentPath = await this.managedDocumentPath(dossierDirectory, documentType);
    const document = {
      metadata: documentMetadata,
      content: await this.readTextFile(documentPath, documentMetadata.relativePath),
    };
    await this.assertNotLocked(workItemId);
    return document;
  }

  public async readLifecycleMetadata(workItemId: string): Promise<DocumentLifecycleMetadata[]> {
    const dossierDirectory = await this.dossierDirectory(workItemId);
    await this.assertNotLocked(workItemId);
    return this.readLifecycleMetadataInternal(dossierDirectory);
  }

  public async initializeDocuments(
    request: InitializeDossierDocumentsRequest,
  ): Promise<InitializeDossierDocumentsResult> {
    const dossierDirectory = await this.dossierDirectory(request.workItemId);
    const releaseLock = await this.acquireLock(request.workItemId);
    try {
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
          targetPath,
          originalExists: false,
        });
      }

      const manifestPath = await this.managedDocumentPath(dossierDirectory, 'MANIFEST');
      replacements.push({
        relativePath: request.manifest.metadata.relativePath,
        content: request.manifest.content,
        targetPath: manifestPath,
        originalExists: true,
      });

      await this.commitReplacements(request.workItemId, replacements, 'initialization');
      return { created: request.documents.map((document) => document.metadata), existing: [] };
    } finally {
      await releaseLock();
    }
  }

  public async commitDocument(request: CommitDossierDocumentRequest): Promise<void> {
    const dossierDirectory = await this.dossierDirectory(request.workItemId);
    const releaseLock = await this.acquireLock(request.workItemId);
    try {
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
        [
          {
            relativePath: request.document.metadata.relativePath,
            content: request.document.content,
            targetPath: documentPath,
            originalExists: true,
          },
          {
            relativePath: request.manifest.metadata.relativePath,
            content: request.manifest.content,
            targetPath: manifestPath,
            originalExists: true,
          },
        ],
        'update',
      );
    } finally {
      await releaseLock();
    }
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

  private async acquireLock(workItemId: string): Promise<() => Promise<void>> {
    const workspaceDirectory = resolvePathWithinRoot(this.options.workspaceRoot, '.ws-workspace');
    const lockDirectory = resolvePathWithinRoot(workspaceDirectory, '.locks');
    await this.ensureDirectory(lockDirectory, 'Could not prepare the document lifecycle lock.');
    const lockPath = resolvePathWithinRoot(lockDirectory, `${workItemId}.lifecycle.lock`);

    try {
      const lock = await open(lockPath, 'wx');
      await lock.close();
    } catch (error) {
      if (isCode(error, 'EEXIST')) {
        throw new DocumentLifecycleConflictError(
          'Another document lifecycle operation is already in progress for this Work Item.',
        );
      }
      throw new DocumentUpdateError('Could not start the document lifecycle operation safely.');
    }

    return async () => {
      await rm(lockPath, { force: true }).catch(() => undefined);
      await rmdir(lockDirectory).catch(() => undefined);
    };
  }

  private async assertNotLocked(workItemId: string): Promise<void> {
    const workspaceDirectory = resolvePathWithinRoot(this.options.workspaceRoot, '.ws-workspace');
    const lockPath = resolvePathWithinRoot(
      workspaceDirectory,
      '.locks',
      `${workItemId}.lifecycle.lock`,
    );
    try {
      await lstat(lockPath);
      throw new DocumentLifecycleConflictError(
        'Another document lifecycle operation is already in progress for this Work Item.',
      );
    } catch (error) {
      if (error instanceof DocumentLifecycleConflictError) {
        throw error;
      }
      if (isCode(error, 'ENOENT')) {
        return;
      }
      throw new DocumentLifecycleConflictError(
        'Another document lifecycle operation is already in progress for this Work Item.',
      );
    }
  }

  private async commitReplacements(
    workItemId: string,
    replacements: readonly Replacement[],
    operation: 'initialization' | 'update',
  ): Promise<void> {
    const stagingDirectory = await this.prepareStagingDirectory(workItemId);
    const movedOriginals: MovedOriginal[] = [];
    const movedReplacements: Replacement[] = [];

    try {
      for (const replacement of replacements) {
        const stagedPath = resolvePathWithinRoot(
          stagingDirectory,
          'files',
          replacement.relativePath,
        );
        await mkdir(dirname(stagedPath), { recursive: true });
        await this.writeFileExclusive(stagedPath, replacement.content);
      }

      this.beforeCommit?.();

      for (let index = 0; index < replacements.length; index += 1) {
        const replacement = replacements[index];
        if (replacement === undefined || !replacement.originalExists) {
          continue;
        }
        const backupPath = resolvePathWithinRoot(stagingDirectory, 'backups', `${index}.bak`);
        await mkdir(dirname(backupPath), { recursive: true });
        await rename(replacement.targetPath, backupPath);
        movedOriginals.push({ targetPath: replacement.targetPath, backupPath });
      }

      this.afterOriginalsMoved?.();

      for (const replacement of replacements) {
        const stagedPath = resolvePathWithinRoot(
          stagingDirectory,
          'files',
          replacement.relativePath,
        );
        await rename(stagedPath, replacement.targetPath);
        movedReplacements.push(replacement);
      }
    } catch (error) {
      await this.restoreVisibleState(movedReplacements, movedOriginals);
      if (isWorkspaceError(error)) {
        throw error;
      }
      if (operation === 'initialization') {
        throw new ManifestUpdateError('Could not initialize the document lifecycle safely.');
      }
      throw new DocumentUpdateError('Could not update the document lifecycle safely.');
    } finally {
      await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
      await this.removeEmptyStagingParent();
    }
  }

  private async restoreVisibleState(
    movedReplacements: readonly Replacement[],
    movedOriginals: readonly MovedOriginal[],
  ): Promise<void> {
    for (const replacement of [...movedReplacements].reverse()) {
      await rm(replacement.targetPath, { force: true }).catch(() => undefined);
    }
    for (const original of [...movedOriginals].reverse()) {
      await rename(original.backupPath, original.targetPath).catch(() => undefined);
    }
  }

  private async prepareStagingDirectory(workItemId: string): Promise<string> {
    const workspaceDirectory = resolvePathWithinRoot(this.options.workspaceRoot, '.ws-workspace');
    const stagingParent = resolvePathWithinRoot(workspaceDirectory, '.staging');
    await this.ensureDirectory(
      stagingParent,
      'Could not prepare the document lifecycle staging area.',
    );
    const stagingDirectory = resolvePathWithinRoot(
      stagingParent,
      `${workItemId}-document-lifecycle`,
    );
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
    await mkdir(stagingDirectory);
    return stagingDirectory;
  }

  private async removeEmptyStagingParent(): Promise<void> {
    const workspaceDirectory = resolvePathWithinRoot(this.options.workspaceRoot, '.ws-workspace');
    const stagingParent = resolvePathWithinRoot(workspaceDirectory, '.staging');
    await rmdir(stagingParent).catch(() => undefined);
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

  private async ensureDirectory(path: string, message: string): Promise<void> {
    try {
      await mkdir(path);
    } catch (error) {
      if (!isCode(error, 'EEXIST')) {
        throw new DocumentUpdateError(message);
      }
    }
    try {
      const entry = await lstat(path);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new DocumentUpdateError(message);
      }
    } catch (error) {
      if (error instanceof DocumentUpdateError) {
        throw error;
      }
      throw new DocumentUpdateError(message);
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

  private async writeFileExclusive(path: string, content: string): Promise<void> {
    const file = await open(path, 'wx');
    try {
      await file.writeFile(content, 'utf8');
    } finally {
      await file.close();
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
