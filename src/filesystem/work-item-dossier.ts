import { lstat, mkdir, open, rename, rm, rmdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

import {
  WorkItemAlreadyExistsError,
  WorkItemCreationError,
  WorkspaceNotInitializedError,
} from '../errors/workspace-error.js';
import { resolvePathWithinRoot } from './safe-path.js';

const SAFE_WORK_ITEM_ID = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export interface WorkItemDossier {
  id: string;
  /**
   * Optional safe storage hierarchy below `active`. Omitted for the frozen M2
   * flat layout; M5 supplies `[iterationStorageToken, workItemType]`.
   */
  parentSegments?: string[];
  files: Array<{
    relativePath: string;
    content: string;
  }>;
  directories: string[];
}

export interface PersistedWorkItemDossier {
  workItemPath: string;
  createdFiles: string[];
  createdDirectories: string[];
}

async function assertExistingDirectory(path: string, message: string): Promise<void> {
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
    throw new WorkItemCreationError('Could not verify the workspace structure safely.');
  }
}

/** Verifies the M1 workspace preconditions without creating Work Item state. */
export async function assertWorkItemWorkspaceInitialized(workspaceRoot: string): Promise<void> {
  const workspaceDirectory = resolvePathWithinRoot(workspaceRoot, '.ws-workspace');
  const activeDirectory = resolvePathWithinRoot(workspaceDirectory, 'active');
  await assertExistingDirectory(
    workspaceDirectory,
    'The workspace must be initialized before creating a Work Item.',
  );
  await assertExistingDirectory(
    activeDirectory,
    'The workspace must be initialized before creating a Work Item.',
  );
}

async function ensureDirectory(path: string): Promise<void> {
  try {
    await mkdir(path);
  } catch (error) {
    if (!isCode(error, 'EEXIST')) {
      throw error;
    }
  }

  const entry = await lstat(path);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new WorkItemCreationError('Could not prepare the Work Item directory safely.');
  }
}

async function assertNotDossierContainer(path: string): Promise<void> {
  const workItemPath = resolvePathWithinRoot(path, 'WORK_ITEM.yml');
  try {
    const entry = await lstat(workItemPath);
    if (entry.isFile() && !entry.isSymbolicLink()) {
      throw new WorkItemAlreadyExistsError(
        'A Work Item dossier cannot also be used as a hierarchy container.',
      );
    }
    throw new WorkItemCreationError('The Work Item hierarchy contains an invalid dossier marker.');
  } catch (error) {
    if (error instanceof WorkItemAlreadyExistsError || error instanceof WorkItemCreationError) {
      throw error;
    }
    if (isCode(error, 'ENOENT')) {
      return;
    }
    throw new WorkItemCreationError('Could not verify the Work Item hierarchy safely.');
  }
}

async function ensurePhysicalDirectoryChain(
  trustedDirectory: string,
  segments: readonly string[],
): Promise<string> {
  await assertExistingDirectory(
    trustedDirectory,
    'The workspace must be initialized before creating a Work Item.',
  );
  let current = trustedDirectory;
  for (const segment of segments) {
    current = resolvePathWithinRoot(current, segment);
    await ensureDirectory(current);
    await assertNotDossierContainer(current);
  }
  return current;
}

async function assertPhysicalDirectoryChain(
  trustedDirectory: string,
  segments: readonly string[],
  rejectDossierContainers = false,
): Promise<void> {
  await assertExistingDirectory(
    trustedDirectory,
    'The workspace must be initialized before creating a Work Item.',
  );
  let current = trustedDirectory;
  for (const segment of segments) {
    current = resolvePathWithinRoot(current, segment);
    try {
      const entry = await lstat(current);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new WorkItemCreationError('The Work Item hierarchy is not a physical directory.');
      }
    } catch (error) {
      if (error instanceof WorkItemCreationError) {
        throw error;
      }
      throw new WorkItemCreationError('Could not verify the Work Item hierarchy safely.');
    }
    if (rejectDossierContainers) {
      await assertNotDossierContainer(current);
    }
  }
}

async function assertTargetDoesNotExist(path: string): Promise<void> {
  try {
    await lstat(path);
    throw new WorkItemAlreadyExistsError('A Work Item with this identifier already exists.');
  } catch (error) {
    if (error instanceof WorkItemAlreadyExistsError) {
      throw error;
    }
    if (isCode(error, 'ENOENT')) {
      return;
    }
    throw new WorkItemCreationError('Could not verify whether the Work Item already exists.');
  }
}

async function writeFileExclusive(path: string, content: string): Promise<void> {
  const file = await open(path, 'wx');
  try {
    await file.writeFile(content, 'utf8');
  } finally {
    await file.close();
  }
}

async function targetExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isCode(error, 'ENOENT')) {
      return false;
    }
    return false;
  }
}

function isCode(error: unknown, expectedCode: string): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === expectedCode
  );
}

export async function createWorkItemDossier(
  workspaceRoot: string,
  dossier: WorkItemDossier,
): Promise<PersistedWorkItemDossier> {
  if (!SAFE_WORK_ITEM_ID.test(dossier.id)) {
    throw new WorkItemCreationError('The generated Work Item identifier is not safe.');
  }

  const workspaceDirectory = resolvePathWithinRoot(workspaceRoot, '.ws-workspace');
  const activeDirectory = resolvePathWithinRoot(workspaceDirectory, 'active');
  await assertWorkItemWorkspaceInitialized(workspaceRoot);

  const parentSegments = dossier.parentSegments ?? [];
  if (
    parentSegments.some(
      (segment) =>
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(segment) || segment === '.' || segment === '..',
    )
  ) {
    throw new WorkItemCreationError('The generated Work Item hierarchy is not safe.');
  }
  const targetParent = await ensurePhysicalDirectoryChain(activeDirectory, parentSegments);
  const targetDirectory = resolvePathWithinRoot(targetParent, dossier.id);
  await assertTargetDoesNotExist(targetDirectory);

  const stagingParent = resolvePathWithinRoot(workspaceDirectory, '.staging');
  await ensureDirectory(stagingParent);
  const stagingDirectory = resolvePathWithinRoot(stagingParent, `${dossier.id}-${randomUUID()}`);
  let stagingCreated = false;

  try {
    await mkdir(stagingDirectory);
    stagingCreated = true;

    for (const relativeDirectory of dossier.directories) {
      const directory = resolvePathWithinRoot(stagingDirectory, relativeDirectory);
      await mkdir(directory, { recursive: true });
    }

    for (const file of dossier.files) {
      const filePath = resolvePathWithinRoot(stagingDirectory, file.relativePath);
      await ensureDirectory(dirname(filePath));
      await writeFileExclusive(filePath, file.content);
    }

    await assertWorkItemWorkspaceInitialized(workspaceRoot);
    await assertPhysicalDirectoryChain(activeDirectory, parentSegments, true);
    await assertPhysicalDirectoryChain(workspaceDirectory, ['.staging']);
    await assertExistingDirectory(
      stagingDirectory,
      'The Work Item staging directory is unavailable.',
    );
    await rename(stagingDirectory, targetDirectory);
    stagingCreated = false;
    await rmdir(stagingParent).catch(() => undefined);
  } catch (error) {
    if (stagingCreated) {
      await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
    }

    if (error instanceof WorkItemAlreadyExistsError || error instanceof WorkItemCreationError) {
      throw error;
    }
    if (await targetExists(targetDirectory)) {
      throw new WorkItemAlreadyExistsError('A Work Item with this identifier already exists.');
    }
    throw new WorkItemCreationError('Could not create the Work Item safely.');
  }

  const workItemPath = join('.ws-workspace', 'active', ...parentSegments, dossier.id);
  return {
    workItemPath,
    createdFiles: dossier.files.map((file) => join(workItemPath, file.relativePath)),
    createdDirectories: [
      workItemPath,
      ...dossier.directories.map((directory) => join(workItemPath, directory)),
    ],
  };
}
