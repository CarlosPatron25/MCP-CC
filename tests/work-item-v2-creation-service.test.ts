import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { WorkItemAlreadyExistsError } from '../src/errors/workspace-error.js';
import { initializeWorkspace } from '../src/filesystem/workspace-initializer.js';
import type { Clock } from '../src/services/clock.js';
import { WorkItemV2CreationService } from '../src/services/work-item-v2-creation-service.js';
import { createTemporaryWorkspaceRoot, removeTemporaryWorkspaceRoot } from './helpers.js';

const FIXED_NOW = '2026-07-28T10:11:12.000Z';
const FIXED_CLOCK: Clock = {
  now: () => FIXED_NOW,
};
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(removeTemporaryWorkspaceRoot));
});

function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'USER_STORY',
    rallyId: 'US-501',
    title: 'Crear un dossier M5',
    functionalDefinition: 'El Work Item se crea en el layout de iteración y tipo.',
    iteration: {
      iterationId: 'Sprint 2026.07',
    },
    actor: {
      participantId: 'developer:ada',
      displayName: 'Ada Lovelace',
    },
    expectedKnowledgeRevision: 0,
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    ...overrides,
  };
}

async function createService(): Promise<{
  root: string;
  service: WorkItemV2CreationService;
}> {
  const root = await createTemporaryWorkspaceRoot();
  temporaryRoots.push(root);
  await initializeWorkspace(root);
  return {
    root,
    service: new WorkItemV2CreationService({ workspaceRoot: root }, FIXED_CLOCK),
  };
}

describe('WorkItemV2CreationService', () => {
  it('creates a minimal v2 dossier in the iteration/type layout with an es-ES manifest', async () => {
    const { root, service } = await createService();

    const result = await service.createDossier(validInput());
    const expectedPath = join('.ws-workspace', 'active', 'Sprint_2026.07', 'USER_STORY', 'US-501');
    const yml = await readFile(join(root, expectedPath, 'WORK_ITEM.yml'), 'utf8');
    const manifest = await readFile(join(root, expectedPath, '00_MANIFEST.md'), 'utf8');

    expect(result).toMatchObject({
      workItemPath: expectedPath,
      iterationStorageToken: 'Sprint_2026.07',
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      workItem: {
        schemaVersion: '2.0.0',
        id: 'US-501',
        type: 'USER_STORY',
        status: 'DRAFT',
        iteration: {
          iterationId: 'Sprint 2026.07',
          storageToken: 'Sprint_2026.07',
        },
        dates: {
          startedAt: '2026-07-28',
        },
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      },
    });
    expect(JSON.stringify(result)).not.toContain(root);
    expect(yml).toContain('schemaVersion: "2.0.0"');
    expect(yml).toContain('iteration:\n  iterationId: "Sprint 2026.07"');
    expect(yml).toContain('  storageToken: "Sprint_2026.07"');
    expect(yml).toContain('  responsiblePerson: "Ada Lovelace"');
    expect(yml).toContain('createdAt: "2026-07-28T10:11:12.000Z"');
    expect(manifest).toContain('# Manifiesto del Work Item');
    expect(manifest).toContain(
      '<!-- WS-WORKSPACE-MCP:DOCUMENT_RENDERING_SNAPSHOT schemaVersion=1.0.0 documentLanguage=es-ES renderingProfile=ES_ES_V1 -->',
    );
    expect(manifest).toMatch(
      /^<!-- WS-WORKSPACE-MCP:M5_V2_BOOTSTRAP schemaVersion=1\.0\.0 status=PENDING requestFingerprint=[a-f0-9]{64} -->$/mu,
    );
    expect(manifest).not.toContain('11111111-1111-4111-8111-111111111111');
    expect(manifest).not.toContain('developer:ada');
    expect(manifest).toContain('- Versión de esquema: 2.0.0');
  });

  it('recovers only the exact fingerprint-bound v2 bootstrap request', async () => {
    const { service } = await createService();
    const input = validInput();
    await service.createDossier(input);

    await expect(service.assertRecoverableDossier(input)).resolves.toBeUndefined();
    await expect(
      service.assertRecoverableDossier({
        ...input,
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
      }),
    ).rejects.toBeInstanceOf(WorkItemAlreadyExistsError);
    await expect(
      service.assertRecoverableDossier({
        ...input,
        actor: {
          participantId: 'developer:grace',
          displayName: 'Ada Lovelace',
        },
      }),
    ).rejects.toBeInstanceOf(WorkItemAlreadyExistsError);
  });

  it('rejects a globally duplicated ID in the legacy layout or another iteration', async () => {
    const legacy = await createService();
    const legacyDossier = join(legacy.root, '.ws-workspace', 'active', 'US-501');
    await mkdir(legacyDossier);
    await writeFile(join(legacyDossier, 'WORK_ITEM.yml'), 'legacy dossier\n', 'utf8');

    await expect(legacy.service.createDossier(validInput())).rejects.toBeInstanceOf(
      WorkItemAlreadyExistsError,
    );
    await expect(readFile(join(legacyDossier, 'WORK_ITEM.yml'), 'utf8')).resolves.toBe(
      'legacy dossier\n',
    );

    const nested = await createService();
    const first = await nested.service.createDossier(validInput());
    const originalYml = await readFile(
      join(nested.root, first.workItemPath, 'WORK_ITEM.yml'),
      'utf8',
    );

    await expect(
      nested.service.createDossier(
        validInput({
          iteration: {
            iterationId: 'Sprint 2026.08',
          },
          idempotencyKey: '22222222-2222-4222-8222-222222222222',
        }),
      ),
    ).rejects.toBeInstanceOf(WorkItemAlreadyExistsError);
    await expect(
      readFile(join(nested.root, first.workItemPath, 'WORK_ITEM.yml'), 'utf8'),
    ).resolves.toBe(originalYml);
  });

  it('rejects an iteration container that is already a historical dossier', async () => {
    const { root, service } = await createService();
    const historicalDossier = join(root, '.ws-workspace', 'active', 'LEGACY-1');
    await mkdir(historicalDossier);
    await writeFile(join(historicalDossier, 'WORK_ITEM.yml'), 'legacy dossier\n', 'utf8');

    await expect(
      service.createDossier(
        validInput({
          iteration: {
            iterationId: 'LEGACY-1',
          },
        }),
      ),
    ).rejects.toBeInstanceOf(WorkItemAlreadyExistsError);
    await expect(readFile(join(historicalDossier, 'WORK_ITEM.yml'), 'utf8')).resolves.toBe(
      'legacy dossier\n',
    );
    await expect(readdir(historicalDossier)).resolves.toEqual(['WORK_ITEM.yml']);
  });

  it('rejects a linked iteration parent without writing through it', async () => {
    const { root, service } = await createService();
    const externalRoot = await createTemporaryWorkspaceRoot();
    temporaryRoots.push(externalRoot);
    await symlink(
      externalRoot,
      join(root, '.ws-workspace', 'active', 'Sprint_2026.07'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(service.createDossier(validInput())).rejects.toMatchObject({
      code: 'WORK_ITEM_CREATION_FAILED',
    });
    await expect(readdir(externalRoot)).resolves.toEqual([]);
  });
});
