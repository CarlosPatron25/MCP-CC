import { open, lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { WorkspaceInitializationError } from '../errors/workspace-error.js';
import {
  providerForDocumentLanguage,
  type DocumentContentProvider,
} from '../services/document-rendering.js';
import { resolvePathWithinRoot } from './safe-path.js';
import { ensureWorkspaceDocumentLanguageConfiguration } from './workspace-document-language-configuration.js';

type CreationStatus = 'created' | 'existing';

export interface InitializationEntry {
  path: string;
  status: CreationStatus;
}

export interface WorkspaceInitializationResult {
  directories: InitializationEntry[];
  readme: InitializationEntry;
  configuration: InitializationEntry;
  created: string[];
  existing: string[];
}

async function ensureDirectory(directoryPath: string): Promise<CreationStatus> {
  try {
    const existing = await lstat(directoryPath);
    if (!existing.isDirectory()) {
      throw new WorkspaceInitializationError(
        'Expected a directory but found another filesystem entry.',
      );
    }
    return 'existing';
  } catch (error) {
    if (error instanceof WorkspaceInitializationError) {
      throw error;
    }

    try {
      await mkdir(directoryPath);
      return 'created';
    } catch (mkdirError) {
      if (isCode(mkdirError, 'EEXIST')) {
        const concurrentEntry = await lstat(directoryPath);
        if (concurrentEntry.isDirectory()) {
          return 'existing';
        }
      }
      throw new WorkspaceInitializationError('Could not create required workspace directory.');
    }
  }
}

function renderWorkspaceReadme(provider: DocumentContentProvider): string {
  return [
    `# ${provider.text('workspaceTitle')}`,
    '',
    provider.text('workspaceManaged'),
    provider.text('workspaceContents'),
    provider.text('workspaceSafety'),
    '',
  ].join('\n');
}

async function ensureReadme(
  readmePath: string,
  provider: DocumentContentProvider,
): Promise<CreationStatus> {
  try {
    const file = await open(readmePath, 'wx');
    await file.writeFile(renderWorkspaceReadme(provider), 'utf8');
    await file.close();
    return 'created';
  } catch (error) {
    if (isCode(error, 'EEXIST')) {
      return 'existing';
    }
    throw new WorkspaceInitializationError('Could not create workspace README.');
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

function toEntry(entryPath: string, status: CreationStatus): InitializationEntry {
  return { path: join('.ws-workspace', entryPath), status };
}

export async function initializeWorkspace(
  workspaceRoot: string,
): Promise<WorkspaceInitializationResult> {
  const workspaceDirectory = resolvePathWithinRoot(workspaceRoot, '.ws-workspace');
  const activeDirectory = resolvePathWithinRoot(workspaceDirectory, 'active');
  const archiveDirectory = resolvePathWithinRoot(workspaceDirectory, 'archive');
  const configDirectory = resolvePathWithinRoot(workspaceDirectory, 'config');
  const recordsDirectory = resolvePathWithinRoot(workspaceDirectory, 'records');
  const readmePath = resolvePathWithinRoot(workspaceDirectory, 'README.md');

  const directoryDefinitions = [
    { path: workspaceDirectory, displayPath: '' },
    { path: activeDirectory, displayPath: 'active' },
    { path: archiveDirectory, displayPath: 'archive' },
    { path: configDirectory, displayPath: 'config' },
    { path: recordsDirectory, displayPath: 'records' },
  ];

  const directories: InitializationEntry[] = [];
  for (const directory of directoryDefinitions) {
    const status = await ensureDirectory(directory.path);
    directories.push(toEntry(directory.displayPath, status));
  }

  const configurationStatus = await ensureWorkspaceDocumentLanguageConfiguration(workspaceRoot);
  const configuration = toEntry('config/workspace-config.json', configurationStatus);
  const readmeStatus = await ensureReadme(readmePath, providerForDocumentLanguage('es-ES'));
  const readme = toEntry('README.md', readmeStatus);
  const allEntries = [...directories, configuration, readme];

  return {
    directories,
    readme,
    configuration,
    created: allEntries.filter((entry) => entry.status === 'created').map((entry) => entry.path),
    existing: allEntries.filter((entry) => entry.status === 'existing').map((entry) => entry.path),
  };
}
