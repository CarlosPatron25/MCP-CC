import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, parse, resolve } from 'node:path';

import { ConfigurationError, FilesystemAccessError } from '../errors/workspace-error.js';

export interface WorkspaceConfig {
  workspaceRoot: string;
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

  return { workspaceRoot };
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

  return config;
}
