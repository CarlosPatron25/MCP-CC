import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile } from 'node:fs/promises';
import { sep } from 'node:path';

import { AUDIT_ARTIFACT_RELATIVE_PATHS } from '../domain/work-item-audit.js';
import {
  WorkItemNotFoundError,
  WorkspaceError,
  WorkspaceNotInitializedError,
} from '../errors/workspace-error.js';
import type {
  KnowledgeBaseRepository,
  KnowledgeBaseRepositoryDecision,
  KnowledgeBaseRepositorySnapshot,
  KnowledgeDossierSnapshot,
} from '../services/knowledge-base-repository.js';
import {
  M5_KNOWLEDGE_INVENTORY_HEADING,
  ManifestSectionCompositor,
  parseDocumentLifecycleInventorySection,
} from '../services/manifest-section-compositor.js';
import { parseM4ManifestInventorySection } from '../services/m4-manifest-inventory-service.js';
import {
  inspectWorkItemV2BootstrapMarker,
  workItemV2BootstrapAccessDecision,
} from '../services/work-item-v2-bootstrap-marker.js';
import { parsePersistedWorkItem } from './local-filesystem-work-item-dossier-repository.js';
import { resolvePathWithinRoot } from './safe-path.js';
import { WorkItemLocator, type LocatedWorkItem } from './work-item-locator.js';
import {
  WorkItemOperationCoordinator,
  type WorkItemTransactionReplacement,
  type WorkItemTransactionFailureMode,
  type WorkItemTransactionFailurePoint,
} from './work-item-operation-coordinator.js';
import { WorkspaceKnowledgeOperationGate } from './workspace-knowledge-operation-gate.js';
import {
  ALL_DOSSIER_TRANSACTION_RELATIVE_PATHS,
  KNOWLEDGE_BASE_RELATIVE_PATH,
  M5_DOSSIER_ARTIFACTS,
} from './workspace-transaction-paths.js';

export { KNOWLEDGE_BASE_RELATIVE_PATH, M5_DOSSIER_ARTIFACTS };

export class KnowledgeBaseConflictError extends WorkspaceError {
  public constructor(message = 'Another Milestone 5 knowledge operation is in progress.') {
    super('KNOWLEDGE_BASE_CONFLICT', message);
    this.name = 'KnowledgeBaseConflictError';
  }
}

export class KnowledgeBaseUpdateError extends WorkspaceError {
  public constructor(message = 'The Milestone 5 knowledge update could not be confirmed safely.') {
    super('KNOWLEDGE_BASE_UPDATE_FAILED', message);
    this.name = 'KnowledgeBaseUpdateError';
  }
}

export class KnowledgeBaseCorruptError extends WorkspaceError {
  public constructor(message = 'The Milestone 5 knowledge base cannot be read safely.') {
    super('KNOWLEDGE_BASE_CORRUPT', message);
    this.name = 'KnowledgeBaseCorruptError';
  }
}

export interface LocalFilesystemKnowledgeBaseRepositoryOptions {
  workspaceRoot: string;
  injectTransactionFailure?: (
    point: WorkItemTransactionFailurePoint,
    promotedCount: number,
  ) => WorkItemTransactionFailureMode | undefined;
}

function isCode(error: unknown, expectedCode: string): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === expectedCode
  );
}

export class LocalFilesystemKnowledgeBaseRepository implements KnowledgeBaseRepository {
  private readonly locator: WorkItemLocator;
  private readonly gate: WorkspaceKnowledgeOperationGate;
  private readonly dossierCoordinator: WorkItemOperationCoordinator;

  public constructor(private readonly options: LocalFilesystemKnowledgeBaseRepositoryOptions) {
    this.locator = new WorkItemLocator(options.workspaceRoot);
    this.gate = new WorkspaceKnowledgeOperationGate({
      workspaceRoot: options.workspaceRoot,
      conflictError: () => new KnowledgeBaseConflictError(),
      updateError: () => new KnowledgeBaseUpdateError(),
      recoveryError: () => new KnowledgeBaseCorruptError(),
      ...(options.injectTransactionFailure === undefined
        ? {}
        : { injectFailure: options.injectTransactionFailure }),
    });
    this.dossierCoordinator = new WorkItemOperationCoordinator({
      workspaceRoot: options.workspaceRoot,
      allowedRelativePaths: ALL_DOSSIER_TRANSACTION_RELATIVE_PATHS,
      recoveryAllowedRelativePaths: ALL_DOSSIER_TRANSACTION_RELATIVE_PATHS,
      conflictError: () => new KnowledgeBaseConflictError(),
      updateError: () => new KnowledgeBaseUpdateError(),
      recoveryError: () => new KnowledgeBaseCorruptError(),
    });
  }

  public async withSnapshot<Result>(
    affectedWorkItemIds: readonly string[],
    decide: (
      snapshot: KnowledgeBaseRepositorySnapshot,
    ) => Promise<KnowledgeBaseRepositoryDecision<Result>> | KnowledgeBaseRepositoryDecision<Result>,
  ): Promise<Result> {
    const uniqueIds = [...new Set(affectedWorkItemIds)].sort((left, right) =>
      left.localeCompare(right),
    );
    return this.gate.runExclusive(
      ({ coordinator, workspaceDirectory, dossiers: locatedDossiers }) =>
        this.withDossierLocks(uniqueIds, async () => {
          const snapshot = await this.readSnapshot(uniqueIds, locatedDossiers);
          const decision = await decide(snapshot);
          if (decision.commit === undefined) {
            return decision.result;
          }

          const commit = decision.commit;
          const replacements = await this.toReplacements(snapshot, commit);
          await coordinator.commit('M5-KNOWLEDGE', workspaceDirectory, replacements, async () => {
            const committed = await this.readSnapshot(uniqueIds, locatedDossiers);
            if (committed.ledgerContent !== commit.ledgerContent) {
              throw new KnowledgeBaseCorruptError();
            }
            commit.validateCommitted?.(committed);
          });
          return decision.result;
        }),
    );
  }

  private async withDossierLocks<Result>(
    workItemIds: readonly string[],
    operation: () => Promise<Result>,
    index = 0,
  ): Promise<Result> {
    const workItemId = workItemIds[index];
    if (workItemId === undefined) {
      return operation();
    }
    const located = await this.locator.locate(workItemId);
    return this.dossierCoordinator.runExclusive(workItemId, located.dossierDirectory, () =>
      this.withDossierLocks(workItemIds, operation, index + 1),
    );
  }

  private async readSnapshot(
    workItemIds: readonly string[],
    locatedDossiers: readonly LocatedWorkItem[],
  ): Promise<KnowledgeBaseRepositorySnapshot> {
    const dossiers = new Map<string, KnowledgeDossierSnapshot>();
    for (const workItemId of workItemIds) {
      const located = await this.locator.locate(workItemId);
      dossiers.set(workItemId, await this.readDossier(located));
    }
    const ledgerContent = await this.readOptionalLedger();
    if (ledgerContent === undefined) {
      await this.assertNoOrphanedM5State(locatedDossiers);
    }
    return {
      ...(ledgerContent === undefined ? {} : { ledgerContent }),
      dossiers,
    };
  }

  private async assertNoOrphanedM5State(
    locatedDossiers: readonly LocatedWorkItem[],
  ): Promise<void> {
    for (const located of locatedDossiers) {
      const manifest = await this.readRequiredRegularFile(
        resolvePathWithinRoot(located.dossierDirectory, '00_MANIFEST.md'),
        () => new KnowledgeBaseCorruptError(),
      );
      const marker = inspectWorkItemV2BootstrapMarker(manifest);
      if (marker.kind === 'INVALID') {
        throw new KnowledgeBaseCorruptError('The Work Item v2 bootstrap marker is invalid.');
      }
      let hasM5Artifacts = false;
      for (const relativePath of M5_DOSSIER_ARTIFACTS.slice(2)) {
        if (
          await this.regularFileExists(
            resolvePathWithinRoot(located.dossierDirectory, relativePath),
          )
        ) {
          hasM5Artifacts = true;
        }
      }
      const hasM5Inventory = manifest.includes(M5_KNOWLEDGE_INVENTORY_HEADING);
      if (marker.kind === 'VALID' && marker.status === 'PENDING') {
        if (hasM5Inventory || hasM5Artifacts) {
          throw new KnowledgeBaseCorruptError();
        }
        continue;
      }
      if (
        hasM5Inventory ||
        hasM5Artifacts ||
        (marker.kind === 'VALID' && marker.status === 'COMPLETE')
      ) {
        throw new KnowledgeBaseCorruptError(
          'Milestone 5 dossier projections exist without the workspace knowledge ledger.',
        );
      }
    }
  }

  private async readDossier(located: LocatedWorkItem): Promise<KnowledgeDossierSnapshot> {
    const workItemPath = resolvePathWithinRoot(located.dossierDirectory, 'WORK_ITEM.yml');
    const manifestPath = resolvePathWithinRoot(located.dossierDirectory, '00_MANIFEST.md');
    const workItemYml = await this.readRequiredRegularFile(
      workItemPath,
      () => new WorkItemNotFoundError('The requested active Work Item does not exist.'),
    );
    const manifest = await this.readRequiredRegularFile(
      manifestPath,
      () => new KnowledgeBaseCorruptError(),
    );
    const bootstrapAccess = workItemV2BootstrapAccessDecision(
      this.options.workspaceRoot,
      located.workItemId,
      manifest,
    );
    if (bootstrapAccess === 'INVALID') {
      throw new KnowledgeBaseCorruptError('The Work Item v2 bootstrap marker is invalid.');
    }
    if (bootstrapAccess === 'DENY_PENDING') {
      throw new KnowledgeBaseConflictError('The Work Item v2 bootstrap is still in progress.');
    }
    await this.assertHistoricalInventory(located.dossierDirectory, manifest);
    const existingM5Artifacts = new Set<string>();
    const m5Artifacts = new Map<string, string>();
    for (const relativePath of M5_DOSSIER_ARTIFACTS.slice(2)) {
      const path = resolvePathWithinRoot(located.dossierDirectory, relativePath);
      if (await this.regularFileExists(path)) {
        existingM5Artifacts.add(relativePath);
        m5Artifacts.set(relativePath, await readFile(path, 'utf8'));
      }
    }
    this.assertProjectionInventory(manifest, m5Artifacts);
    return {
      workItem: parsePersistedWorkItem(workItemYml),
      workItemYml,
      manifest,
      dossierRelativePath: located.dossierRelativePath,
      existingM5Artifacts,
      m5Artifacts,
    };
  }

  private async assertHistoricalInventory(
    dossierDirectory: string,
    manifest: string,
  ): Promise<void> {
    try {
      const sections = new ManifestSectionCompositor().parse(manifest);
      if (sections.documentLifecycle !== undefined) {
        const documents = parseDocumentLifecycleInventorySection(
          sections.documentLifecycle.content,
        );
        for (const document of documents) {
          if (
            !(await this.regularFileExists(
              resolvePathWithinRoot(dossierDirectory, document.relativePath),
            ))
          ) {
            throw new KnowledgeBaseCorruptError();
          }
        }
      }
      if (sections.m4AuditInventory !== undefined) {
        parseM4ManifestInventorySection(sections.m4AuditInventory.content);
        for (const relativePath of AUDIT_ARTIFACT_RELATIVE_PATHS) {
          if (
            !(await this.regularFileExists(resolvePathWithinRoot(dossierDirectory, relativePath)))
          ) {
            throw new KnowledgeBaseCorruptError();
          }
        }
      }
    } catch (error) {
      if (error instanceof KnowledgeBaseCorruptError) {
        throw error;
      }
      throw new KnowledgeBaseCorruptError();
    }
  }

  private assertProjectionInventory(
    manifest: string,
    artifacts: ReadonlyMap<string, string>,
  ): void {
    if (artifacts.size === 0) {
      if (manifest.includes(M5_KNOWLEDGE_INVENTORY_HEADING)) {
        throw new KnowledgeBaseCorruptError();
      }
      return;
    }
    if (artifacts.size !== M5_DOSSIER_ARTIFACTS.length - 2) {
      throw new KnowledgeBaseCorruptError();
    }
    try {
      const section = new ManifestSectionCompositor().parse(manifest).m5KnowledgeInventory;
      if (section === undefined) {
        throw new KnowledgeBaseCorruptError();
      }
      const hashes = new Map<string, string>();
      for (const line of section.content.split(/\r?\n/gu)) {
        const match = /^\| ([^|]+) \| PROTECTED \| ([0-9a-f]{64}) \|$/u.exec(line);
        if (match?.[1] !== undefined && match[2] !== undefined) {
          if (hashes.has(match[1])) {
            throw new KnowledgeBaseCorruptError();
          }
          hashes.set(match[1], match[2]);
        }
      }
      if (
        hashes.size !== artifacts.size ||
        [...artifacts].some(
          ([relativePath, content]) =>
            hashes.get(relativePath) !== createHash('sha256').update(content, 'utf8').digest('hex'),
        )
      ) {
        throw new KnowledgeBaseCorruptError();
      }
    } catch (error) {
      if (error instanceof KnowledgeBaseCorruptError) {
        throw error;
      }
      throw new KnowledgeBaseCorruptError();
    }
  }

  private async readOptionalLedger(): Promise<string | undefined> {
    const workspaceDirectory = await this.workspaceDirectory();
    const path = resolvePathWithinRoot(workspaceDirectory, KNOWLEDGE_BASE_RELATIVE_PATH);
    try {
      const entry = await lstat(path);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new KnowledgeBaseCorruptError();
      }
      return await readFile(path, 'utf8');
    } catch (error) {
      if (error instanceof KnowledgeBaseCorruptError) {
        throw error;
      }
      if (isCode(error, 'ENOENT')) {
        return undefined;
      }
      throw new KnowledgeBaseCorruptError();
    }
  }

  private async toReplacements(
    snapshot: KnowledgeBaseRepositorySnapshot,
    commit: NonNullable<KnowledgeBaseRepositoryDecision<unknown>['commit']>,
  ) {
    const replacements: WorkItemTransactionReplacement[] = [
      {
        relativePath: KNOWLEDGE_BASE_RELATIVE_PATH,
        content: commit.ledgerContent,
        originalExists: snapshot.ledgerContent !== undefined,
      },
    ];
    for (const replacement of commit.dossierReplacements ?? []) {
      if (!M5_DOSSIER_ARTIFACTS.includes(replacement.relativePath as never)) {
        throw new KnowledgeBaseUpdateError();
      }
      const dossier = snapshot.dossiers.get(replacement.workItemId);
      if (dossier === undefined) {
        throw new KnowledgeBaseUpdateError();
      }
      const relativePath = `${this.relativeToWorkspace(dossier.dossierRelativePath)}/${replacement.relativePath}`;
      replacements.push({
        relativePath,
        content: replacement.content,
        originalExists:
          replacement.relativePath === 'WORK_ITEM.yml' ||
          replacement.relativePath === '00_MANIFEST.md' ||
          dossier.existingM5Artifacts.has(replacement.relativePath),
      });
    }
    return replacements;
  }

  private relativeToWorkspace(dossierRelativePath: string): string {
    const prefix = '.ws-workspace/';
    if (!dossierRelativePath.startsWith(prefix)) {
      throw new KnowledgeBaseCorruptError();
    }
    return dossierRelativePath.slice(prefix.length).split(sep).join('/');
  }

  private async workspaceDirectory(): Promise<string> {
    const workspaceDirectory = resolvePathWithinRoot(this.options.workspaceRoot, '.ws-workspace');
    try {
      const entry = await lstat(workspaceDirectory);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new WorkspaceNotInitializedError(
          'The workspace must be initialized before using Milestone 5.',
        );
      }
      const recordsDirectory = resolvePathWithinRoot(workspaceDirectory, 'records');
      try {
        await mkdir(recordsDirectory);
      } catch (error) {
        if (!isCode(error, 'EEXIST')) {
          throw error;
        }
      }
      const recordsEntry = await lstat(recordsDirectory);
      if (!recordsEntry.isDirectory() || recordsEntry.isSymbolicLink()) {
        throw new KnowledgeBaseCorruptError();
      }
      return workspaceDirectory;
    } catch (error) {
      if (error instanceof WorkspaceError) {
        throw error;
      }
      throw new WorkspaceNotInitializedError(
        'The workspace must be initialized before using Milestone 5.',
      );
    }
  }

  private async readRequiredRegularFile(path: string, errorFactory: () => Error): Promise<string> {
    try {
      const entry = await lstat(path);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw errorFactory();
      }
      return await readFile(path, 'utf8');
    } catch (error) {
      if (error instanceof WorkspaceError) {
        throw error;
      }
      throw errorFactory();
    }
  }

  private async regularFileExists(path: string): Promise<boolean> {
    try {
      const entry = await lstat(path);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new KnowledgeBaseCorruptError();
      }
      return true;
    } catch (error) {
      if (error instanceof KnowledgeBaseCorruptError) {
        throw error;
      }
      if (isCode(error, 'ENOENT')) {
        return false;
      }
      throw new KnowledgeBaseCorruptError();
    }
  }
}
