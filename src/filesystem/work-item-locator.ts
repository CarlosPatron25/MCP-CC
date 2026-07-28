import { lstat, readdir } from 'node:fs/promises';
import { relative, sep } from 'node:path';

import {
  WorkItemAlreadyExistsError,
  WorkItemNotFoundError,
  WorkspaceNotInitializedError,
} from '../errors/workspace-error.js';
import { WORK_ITEM_TYPES } from '../domain/work-item.js';
import { resolvePathWithinRoot } from './safe-path.js';

const SAFE_WORK_ITEM_ID = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const SAFE_STORAGE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface LocatedWorkItem {
  workItemId: string;
  dossierDirectory: string;
  dossierRelativePath: string;
  layout: 'LEGACY' | 'ITERATION_TYPE';
}

function isCode(error: unknown, expectedCode: string): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === expectedCode
  );
}

/**
 * Resolves both the frozen flat layout and the M5 iteration/type layout
 * without following filesystem links or deriving hierarchy from relations.
 */
export class WorkItemLocator {
  public constructor(private readonly workspaceRoot: string) {}

  public async locate(workItemId: string): Promise<LocatedWorkItem> {
    this.assertWorkItemId(workItemId);
    const match = (await this.listAll()).find((entry) => entry.workItemId === workItemId);
    if (match === undefined) {
      throw new WorkItemNotFoundError('The requested active Work Item does not exist.');
    }
    return match;
  }

  public async listAll(): Promise<LocatedWorkItem[]> {
    const activeDirectory = await this.activeDirectory();
    const located: LocatedWorkItem[] = [];
    for (const firstLevel of await this.physicalChildDirectories(activeDirectory)) {
      const nested: LocatedWorkItem[] = [];
      for (const type of await this.physicalChildDirectories(firstLevel.path)) {
        for (const dossier of await this.physicalChildDirectories(type.path)) {
          if (
            SAFE_WORK_ITEM_ID.test(dossier.name) &&
            (await this.isDossierDirectory(dossier.path))
          ) {
            nested.push(
              this.toLocated(activeDirectory, dossier.path, dossier.name, 'ITERATION_TYPE'),
            );
          }
        }
      }
      if (
        SAFE_WORK_ITEM_ID.test(firstLevel.name) &&
        (await this.isDossierDirectory(firstLevel.path))
      ) {
        if (nested.length > 0) {
          throw new WorkItemAlreadyExistsError(
            'A Work Item dossier cannot also contain iteration/type dossiers.',
          );
        }
        located.push(this.toLocated(activeDirectory, firstLevel.path, firstLevel.name, 'LEGACY'));
      } else {
        located.push(...nested);
      }
    }

    const byId = new Map<string, LocatedWorkItem>();
    for (const entry of located) {
      if (byId.has(entry.workItemId)) {
        throw new WorkItemAlreadyExistsError(
          'The Work Item identifier resolves to more than one dossier.',
        );
      }
      byId.set(entry.workItemId, entry);
    }
    return [...byId.values()].sort((left, right) =>
      left.workItemId.localeCompare(right.workItemId),
    );
  }

  /**
   * Lists only fixed-depth dossier locations backed by real directories.
   * Unlike listAll(), this intentionally does not require WORK_ITEM.yml so a
   * workspace transaction can restore that file after moving originals.
   */
  public async listPhysicalDossierPathsForRecovery(): Promise<string[]> {
    const activeDirectory = await this.activeDirectory();
    const paths = new Set<string>();
    for (const firstLevel of await this.physicalChildDirectories(activeDirectory)) {
      if (SAFE_WORK_ITEM_ID.test(firstLevel.name)) {
        paths.add(this.toDossierRelativePath(activeDirectory, firstLevel.path));
      }
      if (!SAFE_STORAGE_SEGMENT.test(firstLevel.name)) {
        continue;
      }
      for (const type of await this.physicalChildDirectories(firstLevel.path)) {
        if (!(WORK_ITEM_TYPES as readonly string[]).includes(type.name)) {
          continue;
        }
        for (const dossier of await this.physicalChildDirectories(type.path)) {
          if (SAFE_WORK_ITEM_ID.test(dossier.name)) {
            paths.add(this.toDossierRelativePath(activeDirectory, dossier.path));
          }
        }
      }
    }
    return [...paths].sort((left, right) => left.localeCompare(right));
  }

  public async assertIdentifierAvailable(workItemId: string): Promise<void> {
    try {
      await this.locate(workItemId);
    } catch (error) {
      if (error instanceof WorkItemNotFoundError) {
        return;
      }
      throw error;
    }
    throw new WorkItemAlreadyExistsError('A Work Item with this identifier already exists.');
  }

  public async nestedTarget(
    iterationStorageToken: string,
    workItemTypeStorageToken: string,
    workItemId: string,
  ): Promise<LocatedWorkItem> {
    this.assertWorkItemId(workItemId);
    this.assertStorageSegment(iterationStorageToken);
    this.assertStorageSegment(workItemTypeStorageToken);
    await this.assertIdentifierAvailable(workItemId);
    const activeDirectory = await this.activeDirectory();
    const dossierDirectory = resolvePathWithinRoot(
      activeDirectory,
      iterationStorageToken,
      workItemTypeStorageToken,
      workItemId,
    );
    return this.toLocated(activeDirectory, dossierDirectory, workItemId, 'ITERATION_TYPE');
  }

  private async activeDirectory(): Promise<string> {
    const workspaceDirectory = resolvePathWithinRoot(this.workspaceRoot, '.ws-workspace');
    const activeDirectory = resolvePathWithinRoot(workspaceDirectory, 'active');
    for (const directory of [workspaceDirectory, activeDirectory]) {
      if (!(await this.isPhysicalDirectory(directory))) {
        throw new WorkspaceNotInitializedError(
          'The workspace must be initialized before accessing a Work Item.',
        );
      }
    }
    return activeDirectory;
  }

  private async physicalChildDirectories(
    parent: string,
  ): Promise<Array<{ name: string; path: string }>> {
    let entries;
    try {
      entries = await readdir(parent, { withFileTypes: true });
    } catch {
      throw new WorkspaceNotInitializedError(
        'The workspace must be initialized before accessing a Work Item.',
      );
    }
    const directories: Array<{ name: string; path: string }> = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }
      const path = resolvePathWithinRoot(parent, entry.name);
      if (await this.isPhysicalDirectory(path)) {
        directories.push({ name: entry.name, path });
      }
    }
    return directories;
  }

  private async isPhysicalDirectory(path: string): Promise<boolean> {
    try {
      const entry = await lstat(path);
      return entry.isDirectory() && !entry.isSymbolicLink();
    } catch (error) {
      if (isCode(error, 'ENOENT')) {
        return false;
      }
      throw error;
    }
  }

  private async isDossierDirectory(path: string): Promise<boolean> {
    if (!(await this.isPhysicalDirectory(path))) {
      return false;
    }
    try {
      const workItem = await lstat(resolvePathWithinRoot(path, 'WORK_ITEM.yml'));
      return workItem.isFile() && !workItem.isSymbolicLink();
    } catch (error) {
      if (isCode(error, 'ENOENT')) {
        return false;
      }
      throw error;
    }
  }

  private toLocated(
    activeDirectory: string,
    dossierDirectory: string,
    workItemId: string,
    layout: LocatedWorkItem['layout'],
  ): LocatedWorkItem {
    return {
      workItemId,
      dossierDirectory,
      dossierRelativePath: this.toDossierRelativePath(activeDirectory, dossierDirectory),
      layout,
    };
  }

  private toDossierRelativePath(activeDirectory: string, dossierDirectory: string): string {
    return ['.ws-workspace', 'active', relative(activeDirectory, dossierDirectory)]
      .join('/')
      .split(sep)
      .join('/');
  }

  private assertWorkItemId(workItemId: string): void {
    if (!SAFE_WORK_ITEM_ID.test(workItemId)) {
      throw new WorkItemNotFoundError('The requested active Work Item does not exist.');
    }
  }

  private assertStorageSegment(value: string): void {
    if (!SAFE_STORAGE_SEGMENT.test(value) || value === '.' || value === '..') {
      throw new WorkItemNotFoundError('The requested Work Item location is invalid.');
    }
  }
}
