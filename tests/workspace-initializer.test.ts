import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { initializeWorkspace } from '../src/filesystem/workspace-initializer.js';
import { WORKSPACE_DOCUMENT_CONFIGURATION_CONTENT } from '../src/filesystem/workspace-document-language-configuration.js';
import { createTemporaryWorkspaceRoot, removeTemporaryWorkspaceRoot } from './helpers.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(removeTemporaryWorkspaceRoot));
});

describe('initializeWorkspace', () => {
  it('creates the expected minimal structure inside the root', async () => {
    const root = await createTemporaryWorkspaceRoot();
    temporaryRoots.push(root);

    const result = await initializeWorkspace(root);

    expect(JSON.stringify(result)).not.toContain(root);
    expect(result.created).toEqual([
      join('.ws-workspace', ''),
      join('.ws-workspace', 'active'),
      join('.ws-workspace', 'archive'),
      join('.ws-workspace', 'config'),
      join('.ws-workspace', 'records'),
      join('.ws-workspace', 'config', 'workspace-config.json'),
      join('.ws-workspace', 'README.md'),
    ]);
    await expect(readFile(join(root, '.ws-workspace', 'README.md'), 'utf8')).resolves.toContain(
      'WS Workspace',
    );
    await expect(
      readFile(join(root, '.ws-workspace', 'config', 'workspace-config.json'), 'utf8'),
    ).resolves.toBe(WORKSPACE_DOCUMENT_CONFIGURATION_CONTENT);
  });

  it('is idempotent and does not overwrite a user-modified README', async () => {
    const root = await createTemporaryWorkspaceRoot();
    temporaryRoots.push(root);

    await initializeWorkspace(root);
    const readmePath = join(root, '.ws-workspace', 'README.md');
    await writeFile(readmePath, 'User-controlled content\n', 'utf8');

    const result = await initializeWorkspace(root);

    expect(result.created).toEqual([]);
    expect(result.existing).toHaveLength(7);
    await expect(readFile(readmePath, 'utf8')).resolves.toBe('User-controlled content\n');
  });
});
