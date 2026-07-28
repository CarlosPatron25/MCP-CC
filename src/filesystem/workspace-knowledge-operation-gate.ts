import { AsyncLocalStorage } from 'node:async_hooks';
import { lstat } from 'node:fs/promises';

import { WorkspaceError, WorkspaceNotInitializedError } from '../errors/workspace-error.js';
import { resolvePathWithinRoot } from './safe-path.js';
import { WorkItemLocator, type LocatedWorkItem } from './work-item-locator.js';
import {
  WorkItemOperationCoordinator,
  type WorkItemTransactionFailureMode,
  type WorkItemTransactionFailurePoint,
} from './work-item-operation-coordinator.js';
import {
  ALL_DOSSIER_TRANSACTION_RELATIVE_PATHS,
  isAllowedWorkspaceTransactionRelativePath,
  KNOWLEDGE_BASE_RELATIVE_PATH,
} from './workspace-transaction-paths.js';

export const WORKSPACE_KNOWLEDGE_COORDINATOR_ID = 'M5-KNOWLEDGE' as const;

export interface WorkspaceKnowledgeOperationGateOptions {
  workspaceRoot: string;
  conflictError: () => WorkspaceError;
  updateError: () => WorkspaceError;
  recoveryError: () => WorkspaceError;
  injectFailure?: (
    point: WorkItemTransactionFailurePoint,
    promotedCount: number,
  ) => WorkItemTransactionFailureMode | undefined;
}

export interface WorkspaceKnowledgeOperationContext {
  coordinator: WorkItemOperationCoordinator;
  workspaceDirectory: string;
  dossiers: readonly LocatedWorkItem[];
}

const activeWorkspaceGates = new AsyncLocalStorage<
  ReadonlyMap<string, WorkspaceKnowledgeOperationContext>
>();

/**
 * Serializes every M3/M4/M5 dossier access against the workspace-level M5
 * ledger transaction. Entering the gate also recovers an abandoned global
 * journal before any adapter can observe or overwrite a partially promoted
 * manifest.
 */
export class WorkspaceKnowledgeOperationGate {
  private readonly locator: WorkItemLocator;

  public constructor(private readonly options: WorkspaceKnowledgeOperationGateOptions) {
    this.locator = new WorkItemLocator(options.workspaceRoot);
  }

  public async runExclusive<Result>(
    operation: (context: WorkspaceKnowledgeOperationContext) => Promise<Result>,
    additionalAllowedRelativePaths: readonly string[] = [],
  ): Promise<Result> {
    this.assertAllowedWorkspacePaths(additionalAllowedRelativePaths);
    const activeContext = activeWorkspaceGates.getStore()?.get(this.options.workspaceRoot);
    if (activeContext !== undefined) {
      return operation(activeContext);
    }
    const workspaceDirectory = await this.workspaceDirectory();
    const physicalDossierPaths = await this.locator.listPhysicalDossierPathsForRecovery();
    const allowedRelativePaths = [
      ...new Set([
        ...this.allowedWorkspacePaths(physicalDossierPaths),
        ...additionalAllowedRelativePaths,
      ]),
    ];
    const coordinator = new WorkItemOperationCoordinator({
      workspaceRoot: this.options.workspaceRoot,
      allowedRelativePaths,
      recoveryAllowedRelativePaths: allowedRelativePaths,
      conflictError: this.options.conflictError,
      updateError: this.options.updateError,
      recoveryError: this.options.recoveryError,
      ...(this.options.injectFailure === undefined
        ? {}
        : { injectFailure: this.options.injectFailure }),
    });
    return coordinator.runExclusive(
      WORKSPACE_KNOWLEDGE_COORDINATOR_ID,
      workspaceDirectory,
      async () => {
        const dossiers = await this.locator.listAll();
        const context = { coordinator, workspaceDirectory, dossiers };
        const inherited = activeWorkspaceGates.getStore();
        const active = new Map(inherited ?? []);
        active.set(this.options.workspaceRoot, context);
        return activeWorkspaceGates.run(active, () => operation(context));
      },
    );
  }

  private allowedWorkspacePaths(dossierRelativePaths: readonly string[]): string[] {
    const paths: string[] = [KNOWLEDGE_BASE_RELATIVE_PATH];
    for (const dossierRelativePath of dossierRelativePaths) {
      const prefix = this.relativeToWorkspace(dossierRelativePath);
      for (const relativePath of ALL_DOSSIER_TRANSACTION_RELATIVE_PATHS) {
        paths.push(`${prefix}/${relativePath}`);
      }
    }
    this.assertAllowedWorkspacePaths(paths);
    return paths;
  }

  private assertAllowedWorkspacePaths(relativePaths: readonly string[]): void {
    if (
      relativePaths.some((relativePath) => !isAllowedWorkspaceTransactionRelativePath(relativePath))
    ) {
      throw this.options.recoveryError();
    }
  }

  private relativeToWorkspace(dossierRelativePath: string): string {
    const prefix = '.ws-workspace/';
    if (!dossierRelativePath.startsWith(prefix)) {
      throw this.options.recoveryError();
    }
    return dossierRelativePath.slice(prefix.length);
  }

  private async workspaceDirectory(): Promise<string> {
    const workspaceDirectory = resolvePathWithinRoot(this.options.workspaceRoot, '.ws-workspace');
    try {
      const entry = await lstat(workspaceDirectory);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new WorkspaceNotInitializedError(
          'The workspace must be initialized before accessing Work Item knowledge.',
        );
      }
      return workspaceDirectory;
    } catch (error) {
      if (error instanceof WorkspaceError) {
        throw error;
      }
      throw new WorkspaceNotInitializedError(
        'The workspace must be initialized before accessing Work Item knowledge.',
      );
    }
  }
}
