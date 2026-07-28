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
  WorkspaceNotInitializedError,
  type WorkspaceError,
} from '../errors/workspace-error.js';
import { resolvePathWithinRoot } from './safe-path.js';
import { WorkItemLocator } from './work-item-locator.js';
import { WorkItemOperationCoordinator } from './work-item-operation-coordinator.js';
import { WorkspaceKnowledgeOperationGate } from './workspace-knowledge-operation-gate.js';
import { ALL_DOSSIER_TRANSACTION_RELATIVE_PATHS } from './workspace-transaction-paths.js';
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
import { workItemV2BootstrapAccessDecision } from '../services/work-item-v2-bootstrap-marker.js';

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

export const SHARED_TRANSACTION_RELATIVE_PATHS = ALL_DOSSIER_TRANSACTION_RELATIVE_PATHS;

const SAFE_WORK_ITEM_ID_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/u;
const SAFE_STORAGE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

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

type ParsedYamlValue = string | null | ParsedYamlMap | string[];
interface ParsedYamlMap {
  [key: string]: ParsedYamlValue;
}

interface ParsedYamlNode<T> {
  value: T;
  nextIndex: number;
}

function corruptWorkItem(field: string): DocumentUpdateError {
  return new DocumentUpdateError('The active Work Item dossier cannot be read safely.', { field });
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32);
}

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isCanonicalIsoTimestamp(value: string): boolean {
  if (!ISO_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
}

function canonicalIterationStorageToken(iterationId: string): string {
  return iterationId
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^A-Za-z0-9._-]+/gu, '_')
    .replace(/^[_\-.]+|[_\-.]+$/gu, '')
    .slice(0, 128);
}

function parseYamlString(value: string, field: string): string {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'string') {
      throw new Error('not a string');
    }
    return parsed;
  } catch {
    throw corruptWorkItem(field);
  }
}

function lineIndentation(line: string, field: string): number {
  if (line.includes('\t')) {
    throw corruptWorkItem(field);
  }
  return line.match(/^ */u)?.[0].length ?? 0;
}

function parseYamlList(
  lines: readonly string[],
  startIndex: number,
  indentation: number,
  field: string,
): ParsedYamlNode<string[]> {
  const firstLine = lines[startIndex];
  if (firstLine === undefined || lineIndentation(firstLine, field) !== indentation) {
    throw corruptWorkItem(field);
  }
  const firstContent = firstLine.slice(indentation);
  if (firstContent === '[]') {
    return { value: [], nextIndex: startIndex + 1 };
  }
  const values: string[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined || line.length === 0) {
      throw corruptWorkItem(field);
    }
    const actualIndentation = lineIndentation(line, field);
    if (actualIndentation < indentation) {
      break;
    }
    if (actualIndentation !== indentation) {
      throw corruptWorkItem(field);
    }
    const content = line.slice(indentation);
    if (!content.startsWith('- ')) {
      throw corruptWorkItem(field);
    }
    values.push(parseYamlString(content.slice(2), field));
    index += 1;
  }
  return { value: values, nextIndex: index };
}

function parseYamlMap(
  lines: readonly string[],
  startIndex: number,
  indentation: number,
  field: string,
): ParsedYamlNode<ParsedYamlMap> {
  const values: ParsedYamlMap = {};
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined || line.length === 0) {
      throw corruptWorkItem(field);
    }
    const actualIndentation = lineIndentation(line, field);
    if (actualIndentation < indentation) {
      break;
    }
    if (actualIndentation !== indentation) {
      throw corruptWorkItem(field);
    }
    const match = /^([A-Za-z][A-Za-z0-9]*):(.*)$/u.exec(line.slice(indentation));
    if (match === null) {
      throw corruptWorkItem(field);
    }
    const key = match[1] as string;
    const childField = field.length === 0 ? key : `${field}.${key}`;
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      throw corruptWorkItem(childField);
    }
    const suffix = match[2] as string;
    if (suffix === ' null') {
      values[key] = null;
      index += 1;
      continue;
    }
    if (suffix.startsWith(' ')) {
      values[key] = parseYamlString(suffix.slice(1), childField);
      index += 1;
      continue;
    }
    if (suffix !== '') {
      throw corruptWorkItem(childField);
    }
    const childIndex = index + 1;
    const childLine = lines[childIndex];
    if (
      childLine === undefined ||
      childLine.length === 0 ||
      lineIndentation(childLine, childField) !== indentation + 2
    ) {
      throw corruptWorkItem(childField);
    }
    const childContent = childLine.slice(indentation + 2);
    const child =
      childContent === '[]' || childContent.startsWith('- ')
        ? parseYamlList(lines, childIndex, indentation + 2, childField)
        : parseYamlMap(lines, childIndex, indentation + 2, childField);
    values[key] = child.value;
    index = child.nextIndex;
  }
  if (Object.keys(values).length === 0) {
    throw corruptWorkItem(field || 'input');
  }
  return { value: values, nextIndex: index };
}

function parseYamlDocument(content: string): ParsedYamlMap {
  const lines = content.split(/\r?\n/u);
  while (lines.at(-1) === '') {
    lines.pop();
  }
  if (lines.length === 0) {
    throw corruptWorkItem('input');
  }
  const parsed = parseYamlMap(lines, 0, 0, '');
  if (parsed.nextIndex !== lines.length) {
    throw corruptWorkItem('input');
  }
  return parsed.value;
}

function assertAllowedKeys(
  map: ParsedYamlMap,
  allowedKeys: readonly string[],
  field: string,
): void {
  const unknownKey = Object.keys(map).find((key) => !allowedKeys.includes(key));
  if (unknownKey !== undefined) {
    throw corruptWorkItem(field.length === 0 ? unknownKey : `${field}.${unknownKey}`);
  }
}

function requiredString(map: ParsedYamlMap, key: string, field = key): string {
  const value = map[key];
  if (typeof value !== 'string') {
    throw corruptWorkItem(field);
  }
  return value;
}

function optionalString(map: ParsedYamlMap, key: string, field = key): string | undefined {
  const value = map[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw corruptWorkItem(field);
  }
  return value;
}

function isParsedYamlMap(value: ParsedYamlValue | undefined): value is ParsedYamlMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredMap(map: ParsedYamlMap, key: string, field = key): ParsedYamlMap {
  const value = map[key];
  if (!isParsedYamlMap(value)) {
    throw corruptWorkItem(field);
  }
  return value;
}

function optionalMap(map: ParsedYamlMap, key: string, field = key): ParsedYamlMap | undefined {
  const value = map[key];
  if (value === undefined) {
    return undefined;
  }
  if (!isParsedYamlMap(value)) {
    throw corruptWorkItem(field);
  }
  return value;
}

function requiredList(map: ParsedYamlMap, key: string, field = key): string[] {
  const value = map[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw corruptWorkItem(field);
  }
  return value;
}

function optionalNullableMap(
  map: ParsedYamlMap,
  key: string,
  allowedKeys: readonly string[],
): ParsedYamlMap | undefined {
  const value = map[key];
  if (value === null) {
    return undefined;
  }
  if (!isParsedYamlMap(value)) {
    throw corruptWorkItem(key);
  }
  assertAllowedKeys(value, allowedKeys, key);
  return value;
}

function validatedWorkItemId(document: ParsedYamlMap): string {
  const value = requiredString(document, 'id');
  if (!SAFE_WORK_ITEM_ID_PATTERN.test(value)) {
    throw corruptWorkItem('id');
  }
  return value;
}

function validatedExternalId(map: ParsedYamlMap, key: string, field = key): string {
  const value = requiredString(map, key, field);
  if (value.trim().length === 0 || hasControlCharacter(value)) {
    throw corruptWorkItem(field);
  }
  return value;
}

function validatedIsoDate(map: ParsedYamlMap, key: string, field: string): string {
  const value = requiredString(map, key, field);
  if (!isValidIsoDate(value)) {
    throw corruptWorkItem(field);
  }
  return value;
}

function validatedOptionalIsoDate(
  map: ParsedYamlMap,
  key: string,
  field: string,
): string | undefined {
  const value = optionalString(map, key, field);
  if (value !== undefined && !isValidIsoDate(value)) {
    throw corruptWorkItem(field);
  }
  return value;
}

function validatedTimestamp(document: ParsedYamlMap, key: 'createdAt' | 'updatedAt'): string {
  const value = requiredString(document, key);
  if (!isCanonicalIsoTimestamp(value)) {
    throw corruptWorkItem(key);
  }
  return value;
}

export function parsePersistedWorkItem(content: string): WorkItem {
  const document = parseYamlDocument(content);
  assertAllowedKeys(
    document,
    [
      'schemaVersion',
      'id',
      'iteration',
      'rallyId',
      'type',
      'status',
      'title',
      'dates',
      'responsibility',
      'salesforce',
      'functional',
      'initialScope',
      'business',
      'createdAt',
      'updatedAt',
    ],
    '',
  );
  const schemaVersion = requiredString(document, 'schemaVersion');
  if (schemaVersion !== '1.0.0' && schemaVersion !== '2.0.0') {
    throw corruptWorkItem('schemaVersion');
  }
  if (schemaVersion === '1.0.0' && Object.prototype.hasOwnProperty.call(document, 'iteration')) {
    throw corruptWorkItem('iteration');
  }
  const type = requiredString(document, 'type');
  const status = requiredString(document, 'status');
  if (!(WORK_ITEM_TYPES as readonly string[]).includes(type)) {
    throw corruptWorkItem('type');
  }
  if (!(WORK_ITEM_STATUSES as readonly string[]).includes(status)) {
    throw corruptWorkItem('status');
  }

  const iterationMap = optionalMap(document, 'iteration');
  if (schemaVersion === '2.0.0' && iterationMap === undefined) {
    throw corruptWorkItem('iteration');
  }
  if (iterationMap !== undefined) {
    assertAllowedKeys(iterationMap, ['iterationId', 'displayName', 'storageToken'], 'iteration');
  }
  let iteration: WorkItem['iteration'];
  if (iterationMap !== undefined) {
    const iterationId = validatedExternalId(iterationMap, 'iterationId', 'iteration.iterationId');
    if (iterationId !== iterationId.trim() || iterationId.length > 128) {
      throw corruptWorkItem('iteration.iterationId');
    }
    const displayName = optionalString(iterationMap, 'displayName', 'iteration.displayName');
    if (
      displayName !== undefined &&
      (displayName !== displayName.trim() ||
        displayName.length === 0 ||
        displayName.length > 256 ||
        hasControlCharacter(displayName))
    ) {
      throw corruptWorkItem('iteration.displayName');
    }
    const storageToken = requiredString(iterationMap, 'storageToken', 'iteration.storageToken');
    if (
      !SAFE_STORAGE_TOKEN_PATTERN.test(storageToken) ||
      storageToken === '.' ||
      storageToken === '..' ||
      storageToken !== canonicalIterationStorageToken(iterationId)
    ) {
      throw corruptWorkItem('iteration.storageToken');
    }
    iteration = {
      iterationId,
      ...(displayName === undefined ? {} : { displayName }),
      storageToken,
    };
  }

  const dates = requiredMap(document, 'dates');
  assertAllowedKeys(dates, ['startedAt', 'plannedCompletionAt', 'actualCompletionAt'], 'dates');
  const startedAt = validatedIsoDate(dates, 'startedAt', 'dates.startedAt');
  const plannedCompletionAt = validatedOptionalIsoDate(
    dates,
    'plannedCompletionAt',
    'dates.plannedCompletionAt',
  );
  const actualCompletionAt = validatedOptionalIsoDate(
    dates,
    'actualCompletionAt',
    'dates.actualCompletionAt',
  );
  if (plannedCompletionAt !== undefined && plannedCompletionAt < startedAt) {
    throw corruptWorkItem('dates.plannedCompletionAt');
  }
  if (actualCompletionAt !== undefined && actualCompletionAt < startedAt) {
    throw corruptWorkItem('dates.actualCompletionAt');
  }
  const responsibility = optionalNullableMap(document, 'responsibility', ['responsiblePerson']);
  const responsiblePerson =
    responsibility === undefined
      ? undefined
      : requiredString(responsibility, 'responsiblePerson', 'responsibility.responsiblePerson');
  const salesforce = requiredMap(document, 'salesforce');
  assertAllowedKeys(salesforce, ['developmentAlias'], 'salesforce');
  const functional = requiredMap(document, 'functional');
  assertAllowedKeys(functional, ['definition', 'acceptanceCriteria'], 'functional');
  const initialScope = requiredMap(document, 'initialScope');
  assertAllowedKeys(initialScope, ['relatedComponents'], 'initialScope');
  const business = optionalNullableMap(document, 'business', ['additionalInformation']);
  const additionalInformation =
    business === undefined
      ? undefined
      : requiredString(business, 'additionalInformation', 'business.additionalInformation');
  const createdAt = validatedTimestamp(document, 'createdAt');
  const updatedAt = validatedTimestamp(document, 'updatedAt');
  if (updatedAt < createdAt) {
    throw corruptWorkItem('updatedAt');
  }

  return {
    schemaVersion,
    id: validatedWorkItemId(document),
    rallyId: validatedExternalId(document, 'rallyId'),
    type: type as WorkItemType,
    status: status as WorkItemStatus,
    title: requiredString(document, 'title'),
    ...(iteration === undefined ? {} : { iteration }),
    dates: {
      startedAt,
      ...(plannedCompletionAt === undefined ? {} : { plannedCompletionAt }),
      ...(actualCompletionAt === undefined ? {} : { actualCompletionAt }),
    },
    ...(responsiblePerson === undefined ? {} : { responsibility: { responsiblePerson } }),
    salesforce: {
      developmentAlias: requiredString(
        salesforce,
        'developmentAlias',
        'salesforce.developmentAlias',
      ),
    },
    functional: {
      definition: requiredString(functional, 'definition', 'functional.definition'),
      acceptanceCriteria: requiredList(
        functional,
        'acceptanceCriteria',
        'functional.acceptanceCriteria',
      ),
    },
    initialScope: {
      relatedComponents: requiredList(
        initialScope,
        'relatedComponents',
        'initialScope.relatedComponents',
      ),
    },
    ...(additionalInformation === undefined ? {} : { business: { additionalInformation } }),
    createdAt,
    updatedAt,
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
  private readonly workspaceGate: WorkspaceKnowledgeOperationGate;
  private readonly locator: WorkItemLocator;
  private readonly workspaceRoot: string;

  public constructor(options: LocalFilesystemWorkItemDossierRepositoryOptions) {
    this.beforeCommit = options.beforeCommit;
    this.afterOriginalsMoved = options.afterOriginalsMoved;
    this.workspaceRoot = options.workspaceRoot;
    this.locator = new WorkItemLocator(options.workspaceRoot);
    this.workspaceGate = new WorkspaceKnowledgeOperationGate({
      workspaceRoot: options.workspaceRoot,
      conflictError: () =>
        new DocumentLifecycleConflictError(
          'Another document lifecycle operation is already in progress for this Work Item.',
        ),
      updateError: () => new DocumentUpdateError('Could not update the document lifecycle safely.'),
      recoveryError: () =>
        new DocumentUpdateError('Could not recover the document lifecycle safely.'),
    });
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
    return this.withDossierLock(workItemId, async (dossierDirectory) => {
      const workItemPath = await this.documentPath(dossierDirectory, 'WORK_ITEM.yml');
      return parsePersistedWorkItem(await this.readTextFile(workItemPath, 'WORK_ITEM.yml'));
    });
  }

  public async readManifestContent(workItemId: string): Promise<string> {
    return this.withDossierLock(workItemId, async (dossierDirectory) => {
      const manifestPath = await this.managedDocumentPath(dossierDirectory, 'MANIFEST');
      return this.readTextFile(manifestPath, '00_MANIFEST.md');
    });
  }

  public async readDocument(
    workItemId: string,
    documentType: ManagedDocumentType,
  ): Promise<ManagedDocument> {
    return this.withDossierLock(workItemId, async (dossierDirectory) => {
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
    return this.withDossierLock(workItemId, (dossierDirectory) =>
      this.readLifecycleMetadataInternal(dossierDirectory),
    );
  }

  public async initializeDocuments(
    request: InitializeDossierDocumentsRequest,
  ): Promise<InitializeDossierDocumentsResult> {
    return this.withDossierLock(request.workItemId, async (dossierDirectory) => {
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
    return this.withDossierLock(request.workItemId, async (dossierDirectory) => {
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

  private async withDossierLock<Result>(
    workItemId: string,
    operation: (dossierDirectory: string) => Promise<Result>,
  ): Promise<Result> {
    return this.workspaceGate.runExclusive(async () => {
      const dossierDirectory = await this.dossierDirectory(workItemId);
      return this.coordinator.runExclusive(workItemId, dossierDirectory, async () => {
        await this.assertBootstrapAccess(workItemId, dossierDirectory);
        return operation(dossierDirectory);
      });
    });
  }

  private async dossierDirectory(workItemId: string): Promise<string> {
    return (await this.locator.locate(workItemId)).dossierDirectory;
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

  private async assertBootstrapAccess(workItemId: string, dossierDirectory: string): Promise<void> {
    const manifestPath = await this.managedDocumentPath(dossierDirectory, 'MANIFEST');
    const manifest = await this.readTextFile(manifestPath, '00_MANIFEST.md');
    const access = workItemV2BootstrapAccessDecision(this.workspaceRoot, workItemId, manifest);
    if (access === 'INVALID') {
      throw new DocumentUpdateError('The Work Item v2 bootstrap marker is invalid.');
    }
    if (access === 'DENY_PENDING') {
      throw new DocumentLifecycleConflictError('The Work Item v2 bootstrap is still in progress.');
    }
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
