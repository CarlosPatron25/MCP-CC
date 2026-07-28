import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, parse, relative, resolve } from 'node:path';

import { ConfigurationError, FilesystemAccessError } from '../errors/workspace-error.js';

export interface WorkspaceConfig {
  workspaceRoot: string;
  /**
   * Optional, explicitly authorized read-only source tree used by Milestone 5
   * technical observations. The server never writes below this root.
   */
  projectSourceRoot?: string;
}

export function resolveWorkspaceConfig(environment: NodeJS.ProcessEnv): WorkspaceConfig {
  const configuredRoot = environment.WS_WORKSPACE_ROOT?.trim();

  if (configuredRoot === undefined || configuredRoot.length === 0) {
    throw new ConfigurationError('WS_WORKSPACE_ROOT must be set to an authorized directory.');
  }

  if (!isAbsolute(configuredRoot)) {
    throw new ConfigurationError('WS_WORKSPACE_ROOT must be an absolute path.');
  }

  const workspaceRoot = resolve(configuredRoot);
  if (workspaceRoot === parse(workspaceRoot).root) {
    throw new ConfigurationError('WS_WORKSPACE_ROOT must not be a filesystem volume root.');
  }

  const configuredSourceRoot = environment.WS_PROJECT_SOURCE_ROOT?.trim();
  if (configuredSourceRoot === undefined || configuredSourceRoot.length === 0) {
    return { workspaceRoot };
  }
  if (!isAbsolute(configuredSourceRoot)) {
    throw new ConfigurationError('WS_PROJECT_SOURCE_ROOT must be an absolute path.');
  }

  const projectSourceRoot = resolve(configuredSourceRoot);
  if (projectSourceRoot === parse(projectSourceRoot).root) {
    throw new ConfigurationError('WS_PROJECT_SOURCE_ROOT must not be a filesystem volume root.');
  }
  if (
    workspaceRoot === projectSourceRoot ||
    isContainedPath(workspaceRoot, projectSourceRoot) ||
    isContainedPath(projectSourceRoot, workspaceRoot)
  ) {
    throw new ConfigurationError(
      'WS_WORKSPACE_ROOT and WS_PROJECT_SOURCE_ROOT must be separate, non-overlapping directories.',
    );
  }

  return { workspaceRoot, projectSourceRoot };
}

export async function loadWorkspaceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<WorkspaceConfig> {
  const config = resolveWorkspaceConfig(environment);

  try {
    const rootStats = await stat(config.workspaceRoot);
    if (!rootStats.isDirectory()) {
      throw new ConfigurationError('WS_WORKSPACE_ROOT must point to an existing directory.');
    }
    await access(config.workspaceRoot, constants.R_OK | constants.W_OK);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    throw new FilesystemAccessError(
      'WS_WORKSPACE_ROOT must exist and be readable and writable before the server starts.',
    );
  }

  if (config.projectSourceRoot !== undefined) {
    try {
      const sourceStats = await stat(config.projectSourceRoot);
      if (!sourceStats.isDirectory()) {
        throw new ConfigurationError('WS_PROJECT_SOURCE_ROOT must point to an existing directory.');
      }
      await access(config.projectSourceRoot, constants.R_OK);
    } catch (error) {
      if (error instanceof ConfigurationError) {
        throw error;
      }
      throw new FilesystemAccessError(
        'WS_PROJECT_SOURCE_ROOT must exist and be readable before the server starts.',
      );
    }
  }

  return config;
}

function isContainedPath(parent: string, candidate: string): boolean {
  const relativePath = relative(parent, candidate);
  return (
    relativePath.length > 0 &&
    relativePath !== '..' &&
    !relativePath.startsWith('../') &&
    !relativePath.startsWith('..\\') &&
    !isAbsolute(relativePath)
  );
}
