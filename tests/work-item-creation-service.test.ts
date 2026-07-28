import { mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  WorkItemAlreadyExistsError,
  WorkItemValidationError,
} from '../src/errors/workspace-error.js';
import { initializeWorkspace } from '../src/filesystem/workspace-initializer.js';
import { WorkItemCreationService } from '../src/services/work-item-creation-service.js';
import { createTemporaryWorkspaceRoot, removeTemporaryWorkspaceRoot } from './helpers.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(removeTemporaryWorkspaceRoot));
});

function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'USER_STORY',
    rallyId: 'US-123',
    title: 'Create a secure dossier',
    functionalDefinition: 'A user can create an initial Work Item dossier.',
    developmentAlias: 'dev-sandbox',
    relatedComponents: ['workspace-mcp'],
    startedAt: '2026-07-20',
    ...overrides,
  };
}

async function createService(): Promise<{
  root: string;
  service: WorkItemCreationService;
}> {
  const root = await createTemporaryWorkspaceRoot();
  temporaryRoots.push(root);
  await initializeWorkspace(root);
  return { root, service: new WorkItemCreationService({ workspaceRoot: root }) };
}

describe('WorkItemCreationService', () => {
  it('creates a valid DRAFT Work Item with only the required fields', async () => {
    const { root, service } = await createService();

    const result = await service.create(validInput());

    expect(result).toMatchObject({
      id: 'US-123',
      rallyId: 'US-123',
      type: 'USER_STORY',
      status: 'DRAFT',
      workItemPath: join('.ws-workspace', 'active', 'US-123'),
    });
    expect(JSON.stringify(result)).not.toContain(root);
    expect(result.createdFiles).toHaveLength(6);
  });

  it('creates a Work Item with all optional fields and preserves the Rally ID', async () => {
    const { root, service } = await createService();

    const result = await service.create(
      validInput({
        rallyId: 'US 123',
        acceptanceCriteria: ['The dossier is created', 'The result is safe'],
        plannedCompletionAt: '2026-07-21',
        responsiblePerson: '  Ada Lovelace  ',
        additionalBusinessInformation: '  Customer-visible behavior.  ',
      }),
    );
    const yml = await readFile(join(root, result.workItemPath, 'WORK_ITEM.yml'), 'utf8');

    expect(result.id).toBe('US-123');
    expect(result.rallyId).toBe('US 123');
    expect(yml).toContain('rallyId: "US 123"');
    expect(yml).toContain('plannedCompletionAt: "2026-07-21"');
    expect(yml).toContain('responsiblePerson: "Ada Lovelace"');
    expect(yml).toContain('additionalInformation: "Customer-visible behavior."');
    expect(yml).toContain('- "The dossier is created"');
  });

  it('normalizes empty optional fields consistently', async () => {
    const { root, service } = await createService();

    const result = await service.create(
      validInput({
        acceptanceCriteria: [' ', ''],
        responsiblePerson: ' ',
        additionalBusinessInformation: '',
      }),
    );
    const yml = await readFile(join(root, result.workItemPath, 'WORK_ITEM.yml'), 'utf8');

    expect(yml).toContain('responsibility: null');
    expect(yml).toContain('business: null');
    expect(yml).toContain('acceptanceCriteria:\n    []');
  });

  it('rejects a Work Item type that is not allowed', async () => {
    const { service } = await createService();

    await expect(service.create(validInput({ type: 'FEATURE' }))).rejects.toBeInstanceOf(
      WorkItemValidationError,
    );
  });

  it('rejects an empty Rally ID', async () => {
    const { service } = await createService();

    await expect(service.create(validInput({ rallyId: '   ' }))).rejects.toMatchObject({
      code: 'WORK_ITEM_VALIDATION_FAILED',
      details: { field: 'rallyId' },
    });
  });

  it('rejects an empty related-components collection', async () => {
    const { service } = await createService();

    await expect(service.create(validInput({ relatedComponents: [' '] }))).rejects.toMatchObject({
      code: 'WORK_ITEM_VALIDATION_FAILED',
      details: { field: 'relatedComponents' },
    });
  });

  it('rejects invalid ISO dates', async () => {
    const { service } = await createService();

    await expect(service.create(validInput({ startedAt: '2026-02-30' }))).rejects.toMatchObject({
      code: 'WORK_ITEM_VALIDATION_FAILED',
      details: { field: 'startedAt' },
    });
    await expect(
      service.create(validInput({ plannedCompletionAt: '20 July 2026' })),
    ).rejects.toMatchObject({
      code: 'WORK_ITEM_VALIDATION_FAILED',
      details: { field: 'plannedCompletionAt' },
    });
  });

  it('rejects a planned completion date before the start date', async () => {
    const { service } = await createService();

    await expect(
      service.create(validInput({ plannedCompletionAt: '2026-07-19' })),
    ).rejects.toMatchObject({
      code: 'WORK_ITEM_VALIDATION_FAILED',
      details: { field: 'plannedCompletionAt' },
    });
  });

  it('rejects actualCompletionAt during creation', async () => {
    const { service } = await createService();

    await expect(
      service.create(validInput({ actualCompletionAt: '2026-07-21' })),
    ).rejects.toMatchObject({
      code: 'WORK_ITEM_VALIDATION_FAILED',
      details: { field: 'input' },
    });
  });

  it('rejects duplicates without overwriting the existing Work Item', async () => {
    const { root, service } = await createService();
    const first = await service.create(validInput());
    const ymlPath = join(root, first.workItemPath, 'WORK_ITEM.yml');
    const original = await readFile(ymlPath, 'utf8');

    await expect(service.create(validInput())).rejects.toBeInstanceOf(WorkItemAlreadyExistsError);
    await expect(readFile(ymlPath, 'utf8')).resolves.toBe(original);
  });

  it('rejects an ID that already exists in the iteration/type layout', async () => {
    const { root, service } = await createService();
    const nestedDossier = join(
      root,
      '.ws-workspace',
      'active',
      'Sprint_2026.07',
      'USER_STORY',
      'US-123',
    );
    const nestedYml = join(nestedDossier, 'WORK_ITEM.yml');
    await mkdir(nestedDossier, { recursive: true });
    await writeFile(nestedYml, 'nested v2 dossier\n', 'utf8');

    await expect(service.create(validInput())).rejects.toBeInstanceOf(WorkItemAlreadyExistsError);
    await expect(readFile(nestedYml, 'utf8')).resolves.toBe('nested v2 dossier\n');
    await expect(stat(join(root, '.ws-workspace', 'active', 'US-123'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects path traversal attempts in a Rally ID', async () => {
    const { root, service } = await createService();

    await expect(service.create(validInput({ rallyId: '../outside' }))).rejects.toMatchObject({
      code: 'WORK_ITEM_VALIDATION_FAILED',
      details: { field: 'rallyId' },
    });
    await expect(stat(join(root, 'outside'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a linked active directory without writing through it', async () => {
    const { root, service } = await createService();
    const externalRoot = await createTemporaryWorkspaceRoot();
    temporaryRoots.push(externalRoot);
    const activeDirectory = join(root, '.ws-workspace', 'active');
    await rm(activeDirectory, { recursive: true });
    await symlink(externalRoot, activeDirectory, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(service.create(validInput())).rejects.toMatchObject({
      code: 'WORKSPACE_NOT_INITIALIZED',
    });
    await expect(readdir(externalRoot)).resolves.toEqual([]);
  });

  it('does not overwrite files in a pre-existing target directory', async () => {
    const { root, service } = await createService();
    const target = join(root, '.ws-workspace', 'active', 'US-123');
    await mkdir(target);
    const ymlPath = join(target, 'WORK_ITEM.yml');
    await writeFile(ymlPath, 'protected content\n', 'utf8');

    await expect(service.create(validInput())).rejects.toBeInstanceOf(WorkItemAlreadyExistsError);
    await expect(readFile(ymlPath, 'utf8')).resolves.toBe('protected content\n');
  });

  it('creates the required directory structure and initial dossier files', async () => {
    const { root, service } = await createService();
    const result = await service.create(validInput());
    const workItemDirectory = join(root, result.workItemPath);

    await expect(stat(join(workItemDirectory, 'context'))).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
    await expect(stat(join(workItemDirectory, 'evidence'))).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
    await expect(stat(join(workItemDirectory, 'snapshots'))).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
    await expect(
      readFile(join(workItemDirectory, 'context', 'AI_CONTEXT.md'), 'utf8'),
    ).resolves.toContain('# Contexto de IA');
    await expect(
      readFile(join(workItemDirectory, 'context', 'AI_RULES.md'), 'utf8'),
    ).resolves.toContain('No invente requisitos');
    await expect(
      readFile(join(workItemDirectory, 'context', 'NEXT_TASK.md'), 'utf8'),
    ).resolves.toContain('antes de tomar decisiones técnicas');
    await expect(stat(join(root, '.ws-workspace', '.staging'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('persists the required WORK_ITEM.yml fields deterministically', async () => {
    const { root, service } = await createService();
    const result = await service.create(validInput());
    const yml = await readFile(join(root, result.workItemPath, 'WORK_ITEM.yml'), 'utf8');

    expect(yml).toContain('schemaVersion: "1.0.0"');
    expect(yml).toContain('id: "US-123"');
    expect(yml).toContain('status: "DRAFT"');
    expect(yml).toContain('salesforce:');
    expect(yml).toContain('functional:');
    expect(yml).toContain('initialScope:');
    expect(yml).toContain('createdAt:');
    expect(yml).toContain('updatedAt:');
  });

  it('writes the initial manifest and functional analysis without invented optional values', async () => {
    const { root, service } = await createService();
    const result = await service.create(validInput());
    const workItemDirectory = join(root, result.workItemPath);
    const manifest = await readFile(join(workItemDirectory, '00_MANIFEST.md'), 'utf8');
    const analysis = await readFile(join(workItemDirectory, '01_FUNCTIONAL_ANALYSIS.md'), 'utf8');

    expect(manifest).toContain('| WORK_ITEM.yml | CREATED |');
    expect(manifest).toContain('| snapshots/ | CREATED |');
    expect(manifest).toContain(
      '<!-- WS-WORKSPACE-MCP:DOCUMENT_RENDERING_SNAPSHOT schemaVersion=1.0.0 documentLanguage=es-ES renderingProfile=ES_ES_V1 -->',
    );
    expect(analysis).toContain('A user can create an initial Work Item dossier.');
    expect(analysis).toContain('_No proporcionado._');
  });

  it('requires the workspace to be initialized before creation', async () => {
    const root = await createTemporaryWorkspaceRoot();
    temporaryRoots.push(root);
    const service = new WorkItemCreationService({ workspaceRoot: root });

    await expect(service.create(validInput())).rejects.toMatchObject({
      code: 'WORKSPACE_NOT_INITIALIZED',
    });
  });
});
