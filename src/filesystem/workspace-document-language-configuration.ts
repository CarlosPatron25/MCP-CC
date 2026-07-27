import { randomUUID } from 'node:crypto';
import { link, lstat, open, readFile, rm } from 'node:fs/promises';

import { WorkspaceConfigurationInvalidError } from '../errors/workspace-error.js';
import { resolvePathWithinRoot } from './safe-path.js';

export const WORKSPACE_DOCUMENT_CONFIGURATION_RELATIVE_PATH =
  '.ws-workspace/config/workspace-config.json';
export const WORKSPACE_DOCUMENT_CONFIGURATION_MAX_BYTES = 4 * 1024;
export const WORKSPACE_DOCUMENT_CONFIGURATION_CONTENT =
  '{\n  "schemaVersion": "1.0.0",\n  "documentLanguage": "es-ES"\n}\n';

export interface WorkspaceDocumentLanguageConfiguration {
  schemaVersion: '1.0.0';
  documentLanguage: 'es-ES';
}

export type WorkspaceDocumentConfigurationStatus = 'created' | 'existing';

function configurationError(): WorkspaceConfigurationInvalidError {
  return new WorkspaceConfigurationInvalidError(
    'The workspace document configuration cannot be read safely.',
  );
}

function isCode(error: unknown, expectedCode: string): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === expectedCode
  );
}

async function assertDirectory(path: string): Promise<void> {
  try {
    const entry = await lstat(path);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw configurationError();
    }
  } catch (error) {
    if (error instanceof WorkspaceConfigurationInvalidError) {
      throw error;
    }
    throw configurationError();
  }
}

function parseConfiguration(content: string): WorkspaceDocumentLanguageConfiguration {
  if (Buffer.byteLength(content, 'utf8') > WORKSPACE_DOCUMENT_CONFIGURATION_MAX_BYTES) {
    throw configurationError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw configurationError();
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(parsed, 'schemaVersion') ||
    !Object.prototype.hasOwnProperty.call(parsed, 'documentLanguage') ||
    (parsed as { schemaVersion?: unknown }).schemaVersion !== '1.0.0' ||
    (parsed as { documentLanguage?: unknown }).documentLanguage !== 'es-ES'
  ) {
    throw configurationError();
  }

  return { schemaVersion: '1.0.0', documentLanguage: 'es-ES' };
}

async function readConfiguration(
  configurationPath: string,
): Promise<WorkspaceDocumentLanguageConfiguration> {
  try {
    const entry = await lstat(configurationPath);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw configurationError();
    }
    return parseConfiguration(await readFile(configurationPath, 'utf8'));
  } catch (error) {
    if (error instanceof WorkspaceConfigurationInvalidError) {
      throw error;
    }
    throw configurationError();
  }
}

async function publishConfiguration(
  configurationDirectory: string,
  configurationPath: string,
): Promise<WorkspaceDocumentConfigurationStatus> {
  const temporaryPath = resolvePathWithinRoot(
    configurationDirectory,
    '.workspace-config-' + randomUUID() + '.tmp',
  );

  try {
    const temporary = await open(temporaryPath, 'wx');
    try {
      await temporary.writeFile(WORKSPACE_DOCUMENT_CONFIGURATION_CONTENT, 'utf8');
    } finally {
      await temporary.close();
    }

    try {
      await link(temporaryPath, configurationPath);
      return 'created';
    } catch (error) {
      if (!isCode(error, 'EEXIST')) {
        throw error;
      }
      await readConfiguration(configurationPath);
      return 'existing';
    }
  } catch (error) {
    if (error instanceof WorkspaceConfigurationInvalidError) {
      throw error;
    }
    throw configurationError();
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

/** Reads an immutable configuration after physical directory validation. */
export async function readWorkspaceDocumentLanguageConfiguration(
  workspaceRoot: string,
): Promise<WorkspaceDocumentLanguageConfiguration> {
  const workspaceDirectory = resolvePathWithinRoot(workspaceRoot, '.ws-workspace');
  const configurationDirectory = resolvePathWithinRoot(workspaceDirectory, 'config');
  const configurationPath = resolvePathWithinRoot(
    workspaceRoot,
    WORKSPACE_DOCUMENT_CONFIGURATION_RELATIVE_PATH,
  );
  await assertDirectory(workspaceRoot);
  await assertDirectory(workspaceDirectory);
  await assertDirectory(configurationDirectory);
  return readConfiguration(configurationPath);
}

/** Creates the canonical configuration only when absent, without replacement. */
export async function ensureWorkspaceDocumentLanguageConfiguration(
  workspaceRoot: string,
): Promise<WorkspaceDocumentConfigurationStatus> {
  const workspaceDirectory = resolvePathWithinRoot(workspaceRoot, '.ws-workspace');
  const configurationDirectory = resolvePathWithinRoot(workspaceDirectory, 'config');
  const configurationPath = resolvePathWithinRoot(
    workspaceRoot,
    WORKSPACE_DOCUMENT_CONFIGURATION_RELATIVE_PATH,
  );
  await assertDirectory(workspaceRoot);
  await assertDirectory(workspaceDirectory);
  await assertDirectory(configurationDirectory);

  try {
    await readConfiguration(configurationPath);
    return 'existing';
  } catch (error) {
    if (!(error instanceof WorkspaceConfigurationInvalidError)) {
      throw error;
    }
    try {
      await lstat(configurationPath);
      throw error;
    } catch (statError) {
      if (statError === error || !isCode(statError, 'ENOENT')) {
        throw error;
      }
    }
  }

  return publishConfiguration(configurationDirectory, configurationPath);
}
