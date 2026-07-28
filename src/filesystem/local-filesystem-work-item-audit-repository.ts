import { lstat, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  MANAGED_DOCUMENT_RELATIVE_PATHS,
  MANAGED_DOCUMENT_TYPES,
} from '../domain/work-item-document.js';
import {
  AuditLedgerCorruptError,
  AuditTrackingConflictError,
  AuditTrackingUpdateError,
  DocumentNotInitializedError,
  WorkItemNotFoundError,
  WorkspaceNotInitializedError,
} from '../errors/workspace-error.js';
import type {
  AuditCommitArtifacts,
  AuditRepositoryDecision,
  StoredAuditArtifacts,
  WorkItemAuditRepository,
  WorkItemAuditSnapshot,
} from '../services/work-item-audit-repository.js';
import {
  extractDocumentLifecycleInventorySection,
  parseDocumentLifecycleInventorySection,
} from '../services/manifest-section-compositor.js';
import { workItemV2BootstrapAccessDecision } from '../services/work-item-v2-bootstrap-marker.js';
import {
  parsePersistedWorkItem,
  SHARED_TRANSACTION_RELATIVE_PATHS,
} from './local-filesystem-work-item-dossier-repository.js';
import { resolvePathWithinRoot } from './safe-path.js';
import {
  WorkItemOperationCoordinator,
  type WorkItemTransactionFailureMode,
  type WorkItemTransactionFailurePoint,
} from './work-item-operation-coordinator.js';
import { WorkItemLocator } from './work-item-locator.js';
import { WorkspaceKnowledgeOperationGate } from './workspace-knowledge-operation-gate.js';

const M4_HEADING = '## Milestone 4 Audit Inventory';

export const AUDIT_ARTIFACT_RELATIVE_PATHS = {
  ledger: 'records/AUDIT_LEDGER.json',
  decisions: '06_DECISIONS.md',
  checkpoints: '07_CHECKPOINTS.md',
  testing: '08_TEST_PLAN.md',
  evidenceReferences: 'evidence/REFERENCES.md',
} as const;

const AUDIT_COMMIT_RELATIVE_PATHS = [
  AUDIT_ARTIFACT_RELATIVE_PATHS.ledger,
  AUDIT_ARTIFACT_RELATIVE_PATHS.decisions,
  AUDIT_ARTIFACT_RELATIVE_PATHS.checkpoints,
  AUDIT_ARTIFACT_RELATIVE_PATHS.testing,
  AUDIT_ARTIFACT_RELATIVE_PATHS.evidenceReferences,
  MANAGED_DOCUMENT_RELATIVE_PATHS.MANIFEST,
] as const;

export interface LocalFilesystemWorkItemAuditRepositoryOptions {
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

function countHeading(content: string, heading: string): number {
  return content
    .split('\n')
    .map((line) => line.replace(/\r$/u, ''))
    .filter((line) => line === heading).length;
}

/**
 * Local adapter for the M4 audit port. It owns physical files and invokes the
 * application decision callback only while the M3/M4 shared lock is held.
 */
export class LocalFilesystemWorkItemAuditRepository implements WorkItemAuditRepository {
  private readonly coordinator: WorkItemOperationCoordinator;
  private readonly workspaceGate: WorkspaceKnowledgeOperationGate;
  private readonly locator: WorkItemLocator;
  private readonly workspaceRoot: string;

  public constructor(options: LocalFilesystemWorkItemAuditRepositoryOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.locator = new WorkItemLocator(options.workspaceRoot);
    this.workspaceGate = new WorkspaceKnowledgeOperationGate({
      workspaceRoot: options.workspaceRoot,
      conflictError: () =>
        new AuditTrackingConflictError(
          'Another Work Item operation holds the shared exclusive lock.',
        ),
      updateError: () =>
        new AuditTrackingUpdateError('The audit tracking update could not be confirmed safely.'),
      recoveryError: () =>
        new AuditLedgerCorruptError('The audit tracking data cannot be read safely.'),
    });
    this.coordinator = new WorkItemOperationCoordinator({
      workspaceRoot: options.workspaceRoot,
      allowedRelativePaths: AUDIT_COMMIT_RELATIVE_PATHS,
      recoveryAllowedRelativePaths: SHARED_TRANSACTION_RELATIVE_PATHS,
      conflictError: () =>
        new AuditTrackingConflictError(
          'Another Work Item operation holds the shared exclusive lock.',
        ),
      updateError: () =>
        new AuditTrackingUpdateError('The audit tracking update could not be confirmed safely.'),
      recoveryError: () =>
        new AuditLedgerCorruptError('The audit tracking data cannot be read safely.'),
      ...(options.injectTransactionFailure === undefined
        ? {}
        : { injectFailure: options.injectTransactionFailure }),
    });
  }

  public async withSnapshot<Result>(
    workItemId: string,
    decide: (
      snapshot: WorkItemAuditSnapshot,
    ) => Promise<AuditRepositoryDecision<Result>> | AuditRepositoryDecision<Result>,
  ): Promise<Result> {
    return this.workspaceGate.runExclusive(async () => {
      const dossierDirectory = await this.dossierDirectory(workItemId);
      return this.coordinator.runExclusive(workItemId, dossierDirectory, async () => {
        const snapshot = await this.readSnapshot(workItemId, dossierDirectory);
        const decision = await decide(snapshot);
        if (decision.commit === undefined) {
          return decision.result;
        }

        this.assertCommitMatchesSnapshot(snapshot, decision.commit.initialization);
        const replacements = this.toReplacements(decision.commit.artifacts, snapshot);
        await this.coordinator.commit(workItemId, dossierDirectory, replacements, async () => {
          const committed = await this.readSnapshot(workItemId, dossierDirectory);
          if (committed.tracking.status !== 'INITIALIZED') {
            throw new AuditLedgerCorruptError('The audit tracking data cannot be read safely.');
          }
          decision.commit?.validateCommittedSnapshot(committed);
        });
        return decision.result;
      });
    });
  }

  private async readSnapshot(
    workItemId: string,
    dossierDirectory: string,
  ): Promise<WorkItemAuditSnapshot> {
    const workItemPath = resolvePathWithinRoot(dossierDirectory, 'WORK_ITEM.yml');
    const manifestPath = resolvePathWithinRoot(
      dossierDirectory,
      MANAGED_DOCUMENT_RELATIVE_PATHS.MANIFEST,
    );
    const workItem = parsePersistedWorkItem(
      await this.readRequiredFile(
        workItemPath,
        () => new WorkItemNotFoundError('The requested active Work Item does not exist.'),
      ),
    );
    const manifest = await this.readRequiredFile(
      manifestPath,
      () => new DocumentNotInitializedError('The document lifecycle has not been initialized.'),
    );
    const bootstrapAccess = workItemV2BootstrapAccessDecision(
      this.workspaceRoot,
      workItemId,
      manifest,
    );
    if (bootstrapAccess === 'INVALID') {
      throw new AuditLedgerCorruptError('The Work Item v2 bootstrap marker is invalid.');
    }
    if (bootstrapAccess === 'DENY_PENDING') {
      throw new AuditTrackingConflictError('The Work Item v2 bootstrap is still in progress.');
    }
    const lifecycleMetadata = this.readAndValidateM3Lifecycle(manifest);
    await this.assertManagedM3Files(dossierDirectory);
    await this.assertRequiredDirectory(
      resolvePathWithinRoot(dossierDirectory, 'evidence'),
      () => new AuditLedgerCorruptError('The audit tracking data cannot be read safely.'),
    );

    const artifactStates = await Promise.all(
      Object.values(AUDIT_ARTIFACT_RELATIVE_PATHS).map((relativePath) =>
        this.artifactExists(dossierDirectory, relativePath),
      ),
    );
    const existingArtifactCount = artifactStates.filter(Boolean).length;
    const m4HeadingCount = countHeading(manifest, M4_HEADING);

    if (existingArtifactCount === 0 && m4HeadingCount === 0) {
      return {
        workItem,
        manifest,
        lifecycleMetadata,
        tracking: { status: 'ABSENT' },
      };
    }
    if (
      existingArtifactCount !== Object.keys(AUDIT_ARTIFACT_RELATIVE_PATHS).length ||
      m4HeadingCount !== 1
    ) {
      throw new AuditLedgerCorruptError('The audit tracking data cannot be read safely.');
    }

    return {
      workItem,
      manifest,
      lifecycleMetadata,
      tracking: {
        status: 'INITIALIZED',
        artifacts: await this.readAuditArtifacts(dossierDirectory),
      },
    };
  }

  private readAndValidateM3Lifecycle(manifest: string) {
    const section = extractDocumentLifecycleInventorySection(manifest);
    if (section === undefined) {
      throw new DocumentNotInitializedError('The document lifecycle has not been initialized.');
    }
    return parseDocumentLifecycleInventorySection(section.content);
  }

  private async assertManagedM3Files(dossierDirectory: string): Promise<void> {
    for (const documentType of MANAGED_DOCUMENT_TYPES) {
      const relativePath = MANAGED_DOCUMENT_RELATIVE_PATHS[documentType];
      const path = resolvePathWithinRoot(dossierDirectory, relativePath);
      await this.assertParentDirectory(dossierDirectory, path, () => {
        return new DocumentNotInitializedError('The requested document has not been initialized.', {
          document: relativePath,
        });
      });
      await this.readRequiredFile(
        path,
        () =>
          new DocumentNotInitializedError('The requested document has not been initialized.', {
            document: relativePath,
          }),
      );
    }
  }

  private async artifactExists(dossierDirectory: string, relativePath: string): Promise<boolean> {
    const targetPath = resolvePathWithinRoot(dossierDirectory, relativePath);
    const parentPath = dirname(targetPath);
    if (parentPath !== dossierDirectory) {
      try {
        const parent = await lstat(parentPath);
        if (!parent.isDirectory() || parent.isSymbolicLink()) {
          throw new AuditLedgerCorruptError('The audit tracking data cannot be read safely.');
        }
      } catch (error) {
        if (error instanceof AuditLedgerCorruptError) {
          throw error;
        }
        if (isCode(error, 'ENOENT')) {
          return false;
        }
        throw new AuditLedgerCorruptError('The audit tracking data cannot be read safely.');
      }
    }

    try {
      const entry = await lstat(targetPath);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new AuditLedgerCorruptError('The audit tracking data cannot be read safely.');
      }
      return true;
    } catch (error) {
      if (error instanceof AuditLedgerCorruptError) {
        throw error;
      }
      if (isCode(error, 'ENOENT')) {
        return false;
      }
      throw new AuditLedgerCorruptError('The audit tracking data cannot be read safely.');
    }
  }

  private async readAuditArtifacts(dossierDirectory: string): Promise<StoredAuditArtifacts> {
    const read = async (relativePath: string): Promise<string> => {
      const targetPath = resolvePathWithinRoot(dossierDirectory, relativePath);
      return this.readRequiredFile(
        targetPath,
        () => new AuditLedgerCorruptError('The audit tracking data cannot be read safely.'),
      );
    };
    return {
      ledger: await read(AUDIT_ARTIFACT_RELATIVE_PATHS.ledger),
      decisions: await read(AUDIT_ARTIFACT_RELATIVE_PATHS.decisions),
      checkpoints: await read(AUDIT_ARTIFACT_RELATIVE_PATHS.checkpoints),
      testing: await read(AUDIT_ARTIFACT_RELATIVE_PATHS.testing),
      evidenceReferences: await read(AUDIT_ARTIFACT_RELATIVE_PATHS.evidenceReferences),
    };
  }

  private assertCommitMatchesSnapshot(
    snapshot: WorkItemAuditSnapshot,
    initialization: boolean,
  ): void {
    if (
      (initialization && snapshot.tracking.status !== 'ABSENT') ||
      (!initialization && snapshot.tracking.status !== 'INITIALIZED')
    ) {
      throw new AuditTrackingUpdateError(
        'The audit tracking update could not be confirmed safely.',
      );
    }
  }

  private toReplacements(artifacts: AuditCommitArtifacts, snapshot: WorkItemAuditSnapshot) {
    const originalExists = snapshot.tracking.status === 'INITIALIZED';
    return [
      {
        relativePath: AUDIT_ARTIFACT_RELATIVE_PATHS.ledger,
        content: artifacts.ledger,
        originalExists,
      },
      {
        relativePath: AUDIT_ARTIFACT_RELATIVE_PATHS.decisions,
        content: artifacts.decisions,
        originalExists,
      },
      {
        relativePath: AUDIT_ARTIFACT_RELATIVE_PATHS.checkpoints,
        content: artifacts.checkpoints,
        originalExists,
      },
      {
        relativePath: AUDIT_ARTIFACT_RELATIVE_PATHS.testing,
        content: artifacts.testing,
        originalExists,
      },
      {
        relativePath: AUDIT_ARTIFACT_RELATIVE_PATHS.evidenceReferences,
        content: artifacts.evidenceReferences,
        originalExists,
      },
      {
        relativePath: MANAGED_DOCUMENT_RELATIVE_PATHS.MANIFEST,
        content: artifacts.manifest,
        originalExists: true,
      },
    ];
  }

  private async dossierDirectory(workItemId: string): Promise<string> {
    return (await this.locator.locate(workItemId)).dossierDirectory;
  }

  private async assertParentDirectory(
    dossierDirectory: string,
    targetPath: string,
    errorFactory: () => Error,
  ): Promise<void> {
    const parent = dirname(targetPath);
    if (parent !== dossierDirectory) {
      await this.assertRequiredDirectory(parent, errorFactory);
    }
  }

  private async assertRequiredDirectory(path: string, errorFactory: () => Error): Promise<void> {
    try {
      const entry = await lstat(path);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw errorFactory();
      }
    } catch (error) {
      if (
        error instanceof WorkItemNotFoundError ||
        error instanceof WorkspaceNotInitializedError ||
        error instanceof DocumentNotInitializedError ||
        error instanceof AuditLedgerCorruptError
      ) {
        throw error;
      }
      throw errorFactory();
    }
  }

  private async readRequiredFile(path: string, errorFactory: () => Error): Promise<string> {
    try {
      const entry = await lstat(path);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw errorFactory();
      }
      return await readFile(path, 'utf8');
    } catch (error) {
      if (
        error instanceof WorkItemNotFoundError ||
        error instanceof DocumentNotInitializedError ||
        error instanceof AuditLedgerCorruptError
      ) {
        throw error;
      }
      throw errorFactory();
    }
  }
}
