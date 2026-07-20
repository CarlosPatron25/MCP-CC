import { writeFile } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadWorkspaceConfig, resolveWorkspaceConfig } from '../src/config/workspace-config.js';
import { ConfigurationError, FilesystemAccessError } from '../src/errors/workspace-error.js';
import { createTemporaryWorkspaceRoot, removeTemporaryWorkspaceRoot } from './helpers.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(removeTemporaryWorkspaceRoot));
});

describe('workspace configuration', () => {
  it('rejects a missing root', () => {
    expect(() => resolveWorkspaceConfig({})).toThrow(ConfigurationError);
  });

  it('rejects a relative root', () => {
    expect(() => resolveWorkspaceConfig({ WS_WORKSPACE_ROOT: 'relative/path' })).toThrow(
      ConfigurationError,
    );
  });

  it('rejects a filesystem volume root', () => {
    const volumeRoot = parse(process.cwd()).root;

    expect(() => resolveWorkspaceConfig({ WS_WORKSPACE_ROOT: volumeRoot })).toThrow(
      ConfigurationError,
    );
  });

  it('accepts an existing readable and writable directory', async () => {
    const root = await createTemporaryWorkspaceRoot();
    temporaryRoots.push(root);

    await expect(loadWorkspaceConfig({ WS_WORKSPACE_ROOT: root })).resolves.toEqual({
      workspaceRoot: root,
    });
  });

  it('rejects a root that does not exist', async () => {
    const root = await createTemporaryWorkspaceRoot();
    temporaryRoots.push(root);
    const missingRoot = join(root, 'missing');

    await expect(loadWorkspaceConfig({ WS_WORKSPACE_ROOT: missingRoot })).rejects.toBeInstanceOf(
      FilesystemAccessError,
    );
  });

  it('rejects an existing file as a root', async () => {
    const root = await createTemporaryWorkspaceRoot();
    temporaryRoots.push(root);
    const fileRoot = join(root, 'file');
    await writeFile(fileRoot, 'not a directory', 'utf8');

    await expect(loadWorkspaceConfig({ WS_WORKSPACE_ROOT: fileRoot })).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });
});
