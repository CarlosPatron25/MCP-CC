import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  WorkItemAlreadyExistsError,
  WorkItemNotFoundError,
} from '../src/errors/workspace-error.js';
import { WorkItemLocator } from '../src/filesystem/work-item-locator.js';
import { initializeWorkspace } from '../src/filesystem/workspace-initializer.js';
import { isAllowedWorkspaceTransactionRelativePath } from '../src/filesystem/workspace-transaction-paths.js';
import { createTemporaryWorkspaceRoot, removeTemporaryWorkspaceRoot } from './helpers.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeTemporaryWorkspaceRoot));
});

describe('WorkItemLocator', () => {
  it('resolves historical and iteration/type dossiers without moving them', async () => {
    const root = await createTemporaryWorkspaceRoot();
    roots.push(root);
    await initializeWorkspace(root);
    const active = join(root, '.ws-workspace', 'active');
    const historical = join(active, 'US-100');
    const nested = join(active, 'Iteration_7', 'DEFECT', 'DE-200');
    await mkdir(historical);
    await mkdir(nested, { recursive: true });
    await writeFile(join(historical, 'WORK_ITEM.yml'), 'dossier\n', 'utf8');
    await writeFile(join(nested, 'WORK_ITEM.yml'), 'dossier\n', 'utf8');

    const locator = new WorkItemLocator(root);
    await expect(locator.locate('US-100')).resolves.toMatchObject({
      workItemId: 'US-100',
      layout: 'LEGACY',
      dossierRelativePath: '.ws-workspace/active/US-100',
    });
    await expect(locator.locate('DE-200')).resolves.toMatchObject({
      workItemId: 'DE-200',
      layout: 'ITERATION_TYPE',
      dossierRelativePath: '.ws-workspace/active/Iteration_7/DEFECT/DE-200',
    });
  });

  it('fails closed when the same identifier exists in both layouts', async () => {
    const root = await createTemporaryWorkspaceRoot();
    roots.push(root);
    await initializeWorkspace(root);
    const active = join(root, '.ws-workspace', 'active');
    await mkdir(join(active, 'US-300'));
    await mkdir(join(active, 'Iteration_8', 'USER_STORY', 'US-300'), { recursive: true });
    await writeFile(join(active, 'US-300', 'WORK_ITEM.yml'), 'dossier\n', 'utf8');
    await writeFile(
      join(active, 'Iteration_8', 'USER_STORY', 'US-300', 'WORK_ITEM.yml'),
      'dossier\n',
      'utf8',
    );

    await expect(new WorkItemLocator(root).locate('US-300')).rejects.toBeInstanceOf(
      WorkItemAlreadyExistsError,
    );
  });

  it('fails closed when a historical dossier also contains an iteration/type dossier', async () => {
    const root = await createTemporaryWorkspaceRoot();
    roots.push(root);
    await initializeWorkspace(root);
    const active = join(root, '.ws-workspace', 'active');
    const historical = join(active, 'LEGACY-1');
    const nested = join(historical, 'USER_STORY', 'US-401');
    await mkdir(nested, { recursive: true });
    await writeFile(join(historical, 'WORK_ITEM.yml'), 'legacy dossier\n', 'utf8');
    await writeFile(join(nested, 'WORK_ITEM.yml'), 'nested dossier\n', 'utf8');

    const locator = new WorkItemLocator(root);
    await expect(locator.listAll()).rejects.toBeInstanceOf(WorkItemAlreadyExistsError);
    await expect(locator.locate('US-401')).rejects.toBeInstanceOf(WorkItemAlreadyExistsError);
  });

  it('ignores links while scanning and rejects unknown identifiers', async () => {
    const root = await createTemporaryWorkspaceRoot();
    roots.push(root);
    await initializeWorkspace(root);
    const active = join(root, '.ws-workspace', 'active');
    await writeFile(join(active, 'ordinary-file'), 'not a dossier', 'utf8');

    await expect(new WorkItemLocator(root).locate('US-404')).rejects.toBeInstanceOf(
      WorkItemNotFoundError,
    );
  });

  it('finds recovery candidates from physical permitted layouts without requiring WORK_ITEM.yml', async () => {
    const root = await createTemporaryWorkspaceRoot();
    roots.push(root);
    await initializeWorkspace(root);
    const active = join(root, '.ws-workspace', 'active');
    await mkdir(join(active, 'RECOVERY-LEGACY'));
    await mkdir(join(active, 'Iteration_12', 'TECHNICAL_TASK', 'RECOVERY-NESTED'), {
      recursive: true,
    });
    await mkdir(join(active, 'Iteration_12', 'ARBITRARY', 'RECOVERY-UNSAFE'), {
      recursive: true,
    });
    await mkdir(join(active, 'Iteration_12', 'TECHNICAL_TASK', 'container', 'RECOVERY-TOO-DEEP'), {
      recursive: true,
    });
    const linkedTarget = join(root, 'linked-recovery-dossier');
    await mkdir(linkedTarget);
    await symlink(
      linkedTarget,
      join(active, 'RECOVERY-LINK'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(new WorkItemLocator(root).listPhysicalDossierPathsForRecovery()).resolves.toEqual([
      '.ws-workspace/active/Iteration_12/TECHNICAL_TASK/RECOVERY-NESTED',
      '.ws-workspace/active/RECOVERY-LEGACY',
    ]);
  });

  it('accepts only closed artifacts under permitted workspace dossier layouts', () => {
    expect(isAllowedWorkspaceTransactionRelativePath('active/US-100/WORK_ITEM.yml')).toBe(true);
    expect(
      isAllowedWorkspaceTransactionRelativePath(
        'active/Iteration_12/DEFECT/DE-200/context/AI_CONTEXT.md',
      ),
    ).toBe(true);
    expect(
      isAllowedWorkspaceTransactionRelativePath(
        'active/Iteration_12/ARBITRARY/DE-200/WORK_ITEM.yml',
      ),
    ).toBe(false);
    expect(
      isAllowedWorkspaceTransactionRelativePath('active/Iteration_12/DEFECT/DE-200/unmanaged.txt'),
    ).toBe(false);
    expect(
      isAllowedWorkspaceTransactionRelativePath('active/Iteration_12/DEFECT/../WORK_ITEM.yml'),
    ).toBe(false);
    expect(
      isAllowedWorkspaceTransactionRelativePath(
        'active\\Iteration_12\\DEFECT\\DE-200\\WORK_ITEM.yml',
      ),
    ).toBe(false);
  });
});
