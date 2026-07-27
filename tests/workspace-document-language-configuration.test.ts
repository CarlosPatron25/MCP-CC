import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { initializeWorkspace } from '../src/filesystem/workspace-initializer.js';
import {
  ensureWorkspaceDocumentLanguageConfiguration,
  readWorkspaceDocumentLanguageConfiguration,
  WORKSPACE_DOCUMENT_CONFIGURATION_CONTENT,
  WORKSPACE_DOCUMENT_CONFIGURATION_MAX_BYTES,
} from '../src/filesystem/workspace-document-language-configuration.js';
import { createTemporaryWorkspaceRoot, removeTemporaryWorkspaceRoot } from './helpers.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(removeTemporaryWorkspaceRoot));
});

async function initializedRoot(): Promise<{ root: string; configurationPath: string }> {
  const root = await createTemporaryWorkspaceRoot();
  temporaryRoots.push(root);
  await initializeWorkspace(root);
  return {
    root,
    configurationPath: join(root, '.ws-workspace', 'config', 'workspace-config.json'),
  };
}

describe('workspace document language configuration', () => {
  it('accepts whitespace and key order without rewriting an existing valid file', async () => {
    const { root, configurationPath } = await initializedRoot();
    const acceptedVariant = '{\n  "documentLanguage": "es-ES",\n  "schemaVersion": "1.0.0"\n}\n';
    await writeFile(configurationPath, acceptedVariant, 'utf8');

    await expect(readWorkspaceDocumentLanguageConfiguration(root)).resolves.toEqual({
      schemaVersion: '1.0.0',
      documentLanguage: 'es-ES',
    });
    await expect(ensureWorkspaceDocumentLanguageConfiguration(root)).resolves.toBe('existing');
    await expect(readFile(configurationPath, 'utf8')).resolves.toBe(acceptedVariant);
  });

  it('creates the canonical file once under concurrent create-if-absent calls', async () => {
    const { root, configurationPath } = await initializedRoot();
    await rm(configurationPath);

    const statuses = await Promise.all([
      ensureWorkspaceDocumentLanguageConfiguration(root),
      ensureWorkspaceDocumentLanguageConfiguration(root),
    ]);

    expect(statuses.sort()).toEqual(['created', 'existing']);
    await expect(readFile(configurationPath, 'utf8')).resolves.toBe(
      WORKSPACE_DOCUMENT_CONFIGURATION_CONTENT,
    );
  });

  it.each([
    '{"schemaVersion":"1.0.0","documentLanguage":"es-ES","unexpected":true}\n',
    '{"schemaVersion":"1.0.0","documentLanguage":"es"}\n',
    '{"schemaVersion":"2.0.0","documentLanguage":"es-ES"}\n',
    `${WORKSPACE_DOCUMENT_CONFIGURATION_CONTENT}${' '.repeat(
      WORKSPACE_DOCUMENT_CONFIGURATION_MAX_BYTES,
    )}`,
  ])(
    'rejects an invalid configuration without repairing or replacing it',
    async (invalidContent) => {
      const { root, configurationPath } = await initializedRoot();
      await writeFile(configurationPath, invalidContent, 'utf8');

      await expect(ensureWorkspaceDocumentLanguageConfiguration(root)).rejects.toMatchObject({
        code: 'WORKSPACE_CONFIGURATION_INVALID',
      });
      await expect(readFile(configurationPath, 'utf8')).resolves.toBe(invalidContent);
    },
  );
});
