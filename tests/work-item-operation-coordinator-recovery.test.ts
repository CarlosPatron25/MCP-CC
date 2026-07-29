import { lstat, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import type * as FileSystemPromises from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AuditLedgerCorruptError,
  AuditTrackingConflictError,
  AuditTrackingUpdateError,
} from '../src/errors/workspace-error.js';
import { LocalFilesystemWorkItemAuditRepository } from '../src/filesystem/local-filesystem-work-item-audit-repository.js';
import {
  WorkItemOperationCoordinator,
  type WorkItemTransactionFailureMode,
  type WorkItemTransactionFailurePoint,
} from '../src/filesystem/work-item-operation-coordinator.js';
import { createTemporaryWorkspaceRoot, removeTemporaryWorkspaceRoot } from './helpers.js';

const filesystemFaults = vi.hoisted(() => ({
  failCommittedCleanupOnce: false,
  failPreparedFilesDirectoryOnce: false,
  destructiveJournalOpenCount: 0,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystemPromises>();
  return {
    ...actual,
    mkdir: async (path: string, options?: { recursive?: boolean }) => {
      const normalized = path.replaceAll('\\', '/');
      if (
        filesystemFaults.failPreparedFilesDirectoryOnce &&
        normalized.endsWith('-shared-transaction/files')
      ) {
        filesystemFaults.failPreparedFilesDirectoryOnce = false;
        throw Object.assign(new Error('simulated files-directory failure'), { code: 'EIO' });
      }
      return options === undefined ? actual.mkdir(path) : actual.mkdir(path, options);
    },
    open: async (path: string, flags: string, mode?: number) => {
      const normalized = path.replaceAll('\\', '/');
      if (flags === 'w' && normalized.endsWith('/journal.json')) {
        filesystemFaults.destructiveJournalOpenCount += 1;
      }
      return mode === undefined ? actual.open(path, flags) : actual.open(path, flags, mode);
    },
    rm: async (
      path: string,
      options?: {
        force?: boolean;
        maxRetries?: number;
        recursive?: boolean;
        retryDelay?: number;
      },
    ) => {
      const normalized = path.replaceAll('\\', '/');
      if (
        filesystemFaults.failCommittedCleanupOnce &&
        /-committed-[0-9a-f-]+$/iu.test(normalized)
      ) {
        try {
          await actual.stat(`${path}/commit.marker`);
          filesystemFaults.failCommittedCleanupOnce = false;
          throw Object.assign(new Error('simulated committed cleanup failure'), { code: 'EIO' });
        } catch (error) {
          if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code !== 'ENOENT'
          ) {
            throw error;
          }
        }
      }
      return options === undefined ? actual.rm(path) : actual.rm(path, options);
    },
  };
});

const temporaryRoots: string[] = [];
const workItemId = 'US-RECOVERY';

interface CoordinatorFixture {
  root: string;
  dossierDirectory: string;
  transactionDirectory: string;
}

beforeEach(() => {
  filesystemFaults.failCommittedCleanupOnce = false;
  filesystemFaults.failPreparedFilesDirectoryOnce = false;
  filesystemFaults.destructiveJournalOpenCount = 0;
});

afterEach(async () => {
  filesystemFaults.failCommittedCleanupOnce = false;
  filesystemFaults.failPreparedFilesDirectoryOnce = false;
  await Promise.all(temporaryRoots.splice(0).map(removeTemporaryWorkspaceRoot));
});

async function createFixture(): Promise<CoordinatorFixture> {
  const root = await createTemporaryWorkspaceRoot();
  temporaryRoots.push(root);
  const workspaceDirectory = join(root, '.ws-workspace');
  const dossierDirectory = join(workspaceDirectory, 'active', workItemId);
  await mkdir(dossierDirectory, { recursive: true });
  return {
    root,
    dossierDirectory,
    transactionDirectory: join(workspaceDirectory, '.staging', `${workItemId}-shared-transaction`),
  };
}

function createCoordinator(
  root: string,
  allowedRelativePaths: readonly string[],
  injectFailure?: (
    point: WorkItemTransactionFailurePoint,
    promotedCount: number,
  ) => WorkItemTransactionFailureMode | undefined,
): WorkItemOperationCoordinator {
  return new WorkItemOperationCoordinator({
    workspaceRoot: root,
    allowedRelativePaths,
    conflictError: () => new AuditTrackingConflictError('shared operation conflict'),
    updateError: () => new AuditTrackingUpdateError('safe update failure'),
    recoveryError: () => new AuditLedgerCorruptError('safe recovery failure'),
    ...(injectFailure === undefined ? {} : { injectFailure }),
  });
}

async function abandonAfterOriginalsMoved(
  coordinator: WorkItemOperationCoordinator,
  fixture: CoordinatorFixture,
  relativePath: string,
  nextContent: string,
): Promise<void> {
  await expect(
    coordinator.runExclusive(workItemId, fixture.dossierDirectory, () =>
      coordinator.commit(
        workItemId,
        fixture.dossierDirectory,
        [
          {
            relativePath,
            content: nextContent,
            originalExists: true,
          },
        ],
        async () => undefined,
      ),
    ),
  ).rejects.toBeInstanceOf(AuditTrackingUpdateError);
}

describe('WorkItemOperationCoordinator recovery regressions', () => {
  it('reclaims a well-formed dead owned lock when no transaction journal exists', async () => {
    const fixture = await createFixture();
    const lockDirectory = join(fixture.root, '.ws-workspace', '.locks');
    const lockPath = join(lockDirectory, `${workItemId}.lifecycle.lock`);
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        schemaVersion: '1.0.0',
        pid: 2147483647,
        token: '00000000-0000-4000-8000-000000000111',
        acquiredAt: '2026-07-28T10:00:00.000Z',
      }) + '\n',
      'utf8',
    );
    const coordinator = createCoordinator(fixture.root, ['00_MANIFEST.md']);

    await expect(
      coordinator.runExclusive(workItemId, fixture.dossierDirectory, async () => 'recovered'),
    ).resolves.toBe('recovered');
    await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(fixture.transactionDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains live and malformed locks without transaction journals', async () => {
    const liveFixture = await createFixture();
    const liveLockDirectory = join(liveFixture.root, '.ws-workspace', '.locks');
    const liveLockPath = join(liveLockDirectory, `${workItemId}.lifecycle.lock`);
    const liveContent =
      JSON.stringify({
        schemaVersion: '1.0.0',
        pid: process.pid,
        token: '00000000-0000-4000-8000-000000000222',
        acquiredAt: '2026-07-28T10:00:00.000Z',
      }) + '\n';
    await mkdir(liveLockDirectory, { recursive: true });
    await writeFile(liveLockPath, liveContent, 'utf8');

    await expect(
      createCoordinator(liveFixture.root, ['00_MANIFEST.md']).runExclusive(
        workItemId,
        liveFixture.dossierDirectory,
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(AuditTrackingConflictError);
    await expect(readFile(liveLockPath, 'utf8')).resolves.toBe(liveContent);

    const malformedFixture = await createFixture();
    const malformedLockDirectory = join(malformedFixture.root, '.ws-workspace', '.locks');
    const malformedLockPath = join(malformedLockDirectory, `${workItemId}.lifecycle.lock`);
    const malformedContent = '{"schemaVersion":"1.0.0","pid":2147483647}\n';
    await mkdir(malformedLockDirectory, { recursive: true });
    await writeFile(malformedLockPath, malformedContent, 'utf8');

    await expect(
      createCoordinator(malformedFixture.root, ['00_MANIFEST.md']).runExclusive(
        workItemId,
        malformedFixture.dossierDirectory,
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(AuditTrackingConflictError);
    await expect(readFile(malformedLockPath, 'utf8')).resolves.toBe(malformedContent);
  });

  it('retains a replacement lock that is not owned by the releasing operation', async () => {
    const fixture = await createFixture();
    const coordinator = createCoordinator(fixture.root, ['00_MANIFEST.md']);
    let enteredResolve: (() => void) | undefined;
    let releaseResolve: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredResolve = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseResolve = resolve;
    });

    const operation = coordinator.runExclusive(workItemId, fixture.dossierDirectory, async () => {
      enteredResolve?.();
      await release;
      return 'finished';
    });
    await entered;

    const lockPath = join(fixture.root, '.ws-workspace', '.locks', `${workItemId}.lifecycle.lock`);
    await rm(lockPath);
    await writeFile(lockPath, 'retained replacement lock\n', 'utf8');
    releaseResolve?.();

    await expect(operation).rejects.toBeInstanceOf(AuditTrackingUpdateError);
    await expect(readFile(lockPath, 'utf8')).resolves.toBe('retained replacement lock\n');
  });

  it('does not remove a replacement lock that copies the owned lock content', async () => {
    const fixture = await createFixture();
    const coordinator = createCoordinator(fixture.root, ['00_MANIFEST.md']);
    let enteredResolve: (() => void) | undefined;
    let releaseResolve: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredResolve = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseResolve = resolve;
    });

    const operation = coordinator.runExclusive(workItemId, fixture.dossierDirectory, async () => {
      enteredResolve?.();
      await release;
      return 'finished';
    });
    await entered;

    const lockPath = join(fixture.root, '.ws-workspace', '.locks', `${workItemId}.lifecycle.lock`);
    const copiedContent = await readFile(lockPath, 'utf8');
    await rm(lockPath);
    await writeFile(lockPath, copiedContent, 'utf8');
    releaseResolve?.();

    await expect(operation).rejects.toBeInstanceOf(AuditTrackingUpdateError);
    await expect(readFile(lockPath, 'utf8')).resolves.toBe(copiedContent);
  });

  it('does not move or dereference a replacement filesystem link during release', async () => {
    const fixture = await createFixture();
    const coordinator = createCoordinator(fixture.root, ['00_MANIFEST.md']);
    let enteredResolve: (() => void) | undefined;
    let releaseResolve: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredResolve = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseResolve = resolve;
    });

    const operation = coordinator.runExclusive(workItemId, fixture.dossierDirectory, async () => {
      enteredResolve?.();
      await release;
      return 'finished';
    });
    await entered;

    const lockPath = join(fixture.root, '.ws-workspace', '.locks', `${workItemId}.lifecycle.lock`);
    const outsideDirectory = join(fixture.root, 'outside-lock-target');
    const sentinel = join(outsideDirectory, 'sentinel.txt');
    await mkdir(outsideDirectory);
    await writeFile(sentinel, 'unchanged\n', 'utf8');
    await rm(lockPath);
    await symlink(outsideDirectory, lockPath, process.platform === 'win32' ? 'junction' : 'dir');
    releaseResolve?.();

    await expect(operation).rejects.toBeInstanceOf(AuditTrackingUpdateError);
    expect((await lstat(lockPath)).isSymbolicLink()).toBe(true);
    await expect(readFile(sentinel, 'utf8')).resolves.toBe('unchanged\n');
  });

  it('lets an M4 operation recover an abandoned transaction containing an approved M3 path', async () => {
    const fixture = await createFixture();
    const m3RelativePath = '02_CURRENT_STATE.md';
    const targetPath = join(fixture.dossierDirectory, m3RelativePath);
    await writeFile(targetPath, 'last committed M3 content\n', 'utf8');
    const abandoningM3Coordinator = createCoordinator(fixture.root, [m3RelativePath], (point) =>
      point === 'after-originals-moved' ? 'abandon' : undefined,
    );

    await abandonAfterOriginalsMoved(
      abandoningM3Coordinator,
      fixture,
      m3RelativePath,
      'unconfirmed M3 content\n',
    );

    const m4Repository = new LocalFilesystemWorkItemAuditRepository({
      workspaceRoot: fixture.root,
    });
    const m4Coordinator = (m4Repository as unknown as { coordinator: WorkItemOperationCoordinator })
      .coordinator;

    await expect(
      m4Coordinator.runExclusive(workItemId, fixture.dossierDirectory, async () => 'recovered'),
    ).resolves.toBe('recovered');
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('last committed M3 content\n');
    await expect(stat(fixture.transactionDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not roll back a confirmed visible set when post-marker cleanup fails once', async () => {
    const fixture = await createFixture();
    const relativePath = '00_MANIFEST.md';
    const targetPath = join(fixture.dossierDirectory, relativePath);
    await writeFile(targetPath, 'old manifest\n', 'utf8');
    const coordinator = createCoordinator(fixture.root, [relativePath]);
    filesystemFaults.failCommittedCleanupOnce = true;

    await expect(
      coordinator.runExclusive(workItemId, fixture.dossierDirectory, async () => {
        await coordinator.commit(
          workItemId,
          fixture.dossierDirectory,
          [
            {
              relativePath,
              content: 'confirmed manifest\n',
              originalExists: true,
            },
          ],
          async () => undefined,
        );
        return 'confirmed';
      }),
    ).resolves.toBe('confirmed');
    expect(filesystemFaults.failCommittedCleanupOnce).toBe(false);
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('confirmed manifest\n');

    await expect(
      coordinator.runExclusive(workItemId, fixture.dossierDirectory, async () => 'cleaned'),
    ).resolves.toBe('cleaned');
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('confirmed manifest\n');
    await expect(stat(fixture.transactionDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cleans partial transaction preparation and returns only the safe update error', async () => {
    const fixture = await createFixture();
    const relativePath = '00_MANIFEST.md';
    const targetPath = join(fixture.dossierDirectory, relativePath);
    await writeFile(targetPath, 'old manifest\n', 'utf8');
    const coordinator = createCoordinator(fixture.root, [relativePath]);
    filesystemFaults.failPreparedFilesDirectoryOnce = true;

    await expect(
      coordinator.runExclusive(workItemId, fixture.dossierDirectory, () =>
        coordinator.commit(
          workItemId,
          fixture.dossierDirectory,
          [
            {
              relativePath,
              content: 'unconfirmed manifest\n',
              originalExists: true,
            },
          ],
          async () => undefined,
        ),
      ),
    ).rejects.toBeInstanceOf(AuditTrackingUpdateError);

    await expect(readFile(targetPath, 'utf8')).resolves.toBe('old manifest\n');
    await expect(stat(fixture.transactionDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(fixture.root, '.ws-workspace', '.staging'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('never opens the established journal with a truncating write mode', async () => {
    const fixture = await createFixture();
    const relativePath = '00_MANIFEST.md';
    const targetPath = join(fixture.dossierDirectory, relativePath);
    await writeFile(targetPath, 'old manifest\n', 'utf8');
    const coordinator = createCoordinator(fixture.root, [relativePath]);

    await coordinator.runExclusive(workItemId, fixture.dossierDirectory, () =>
      coordinator.commit(
        workItemId,
        fixture.dossierDirectory,
        [
          {
            relativePath,
            content: 'new manifest\n',
            originalExists: true,
          },
        ],
        async () => undefined,
      ),
    );

    expect(filesystemFaults.destructiveJournalOpenCount).toBe(0);
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('new manifest\n');
  });

  it('fails closed without deleting an unrecognized visible repair during rollback', async () => {
    const fixture = await createFixture();
    const relativePath = '00_MANIFEST.md';
    const targetPath = join(fixture.dossierDirectory, relativePath);
    await writeFile(targetPath, 'last committed manifest\n', 'utf8');
    const abandoningCoordinator = createCoordinator(fixture.root, [relativePath], (point) =>
      point === 'after-originals-moved' ? 'abandon' : undefined,
    );
    await abandonAfterOriginalsMoved(
      abandoningCoordinator,
      fixture,
      relativePath,
      'unconfirmed manifest\n',
    );
    await writeFile(targetPath, 'manual repair that recovery does not recognize\n', 'utf8');
    const recoveringCoordinator = createCoordinator(fixture.root, [relativePath]);

    await expect(
      recoveringCoordinator.runExclusive(
        workItemId,
        fixture.dossierDirectory,
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(AuditLedgerCorruptError);
    await expect(readFile(targetPath, 'utf8')).resolves.toBe(
      'manual repair that recovery does not recognize\n',
    );
    expect((await stat(fixture.transactionDirectory)).isDirectory()).toBe(true);
  });

  it('fails closed when a target parent is replaced by a filesystem link', async () => {
    const fixture = await createFixture();
    const relativePath = 'records/audit-ledger.jsonl';
    const nextContent = 'unconfirmed audit ledger\n';
    const abandoningCoordinator = createCoordinator(fixture.root, [relativePath], (point) =>
      point === 'before-confirm' ? 'abandon' : undefined,
    );

    await expect(
      abandoningCoordinator.runExclusive(workItemId, fixture.dossierDirectory, () =>
        abandoningCoordinator.commit(
          workItemId,
          fixture.dossierDirectory,
          [
            {
              relativePath,
              content: nextContent,
              originalExists: false,
            },
          ],
          async () => undefined,
        ),
      ),
    ).rejects.toBeInstanceOf(AuditTrackingUpdateError);

    const outsideRoot = await createTemporaryWorkspaceRoot();
    temporaryRoots.push(outsideRoot);
    const outsideRecords = join(outsideRoot, 'records');
    const outsideTarget = join(outsideRecords, 'audit-ledger.jsonl');
    await mkdir(outsideRecords, { recursive: true });
    await writeFile(outsideTarget, nextContent, 'utf8');

    const recordsDirectory = join(fixture.dossierDirectory, 'records');
    await rm(recordsDirectory, { recursive: true });
    await symlink(
      outsideRecords,
      recordsDirectory,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const recoveringCoordinator = createCoordinator(fixture.root, [relativePath]);
    await expect(
      recoveringCoordinator.runExclusive(
        workItemId,
        fixture.dossierDirectory,
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(AuditLedgerCorruptError);
    await expect(readFile(outsideTarget, 'utf8')).resolves.toBe(nextContent);
    expect((await stat(fixture.transactionDirectory)).isDirectory()).toBe(true);
  });

  it('reclaims a dead orphan recovery claim and then recovers its matching journal', async () => {
    const fixture = await createFixture();
    const relativePath = '00_MANIFEST.md';
    const targetPath = join(fixture.dossierDirectory, relativePath);
    await writeFile(targetPath, 'last committed manifest\n', 'utf8');
    const abandoningCoordinator = createCoordinator(fixture.root, [relativePath], (point) =>
      point === 'after-originals-moved' ? 'abandon' : undefined,
    );
    await abandonAfterOriginalsMoved(
      abandoningCoordinator,
      fixture,
      relativePath,
      'unconfirmed manifest\n',
    );

    const lockDirectory = join(fixture.root, '.ws-workspace', '.locks');
    const recoveryClaimPath = join(lockDirectory, `${workItemId}.recovery.claim`);
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(recoveryClaimPath, '2147483647\n', 'utf8');
    const recoveringCoordinator = createCoordinator(fixture.root, [relativePath]);

    await expect(
      recoveringCoordinator.runExclusive(
        workItemId,
        fixture.dossierDirectory,
        async () => 'recovered',
      ),
    ).resolves.toBe('recovered');
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('last committed manifest\n');
    await expect(stat(recoveryClaimPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(fixture.transactionDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reclaims a dead release claim even when no transaction journal remains', async () => {
    const fixture = await createFixture();
    const lockDirectory = join(fixture.root, '.ws-workspace', '.locks');
    const recoveryClaimPath = join(lockDirectory, `${workItemId}.recovery.claim`);
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(
      recoveryClaimPath,
      JSON.stringify({
        schemaVersion: '1.0.0',
        pid: 2147483647,
        token: '00000000-0000-4000-8000-000000000999',
        purpose: 'RELEASE',
        acquiredAt: '2026-07-24T10:00:00.000Z',
      }) + '\n',
      'utf8',
    );
    const coordinator = createCoordinator(fixture.root, ['00_MANIFEST.md']);

    await expect(
      coordinator.runExclusive(workItemId, fixture.dossierDirectory, async () => 'recovered'),
    ).resolves.toBe('recovered');
    await expect(stat(recoveryClaimPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reclaims a dead recovery claim even when no transaction journal remains', async () => {
    const fixture = await createFixture();
    const lockDirectory = join(fixture.root, '.ws-workspace', '.locks');
    const recoveryClaimPath = join(lockDirectory, `${workItemId}.recovery.claim`);
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(
      recoveryClaimPath,
      JSON.stringify({
        schemaVersion: '1.0.0',
        pid: 2147483647,
        token: '00000000-0000-4000-8000-000000000998',
        purpose: 'RECOVERY',
        acquiredAt: '2026-07-28T10:00:00.000Z',
      }) + '\n',
      'utf8',
    );
    const coordinator = createCoordinator(fixture.root, ['00_MANIFEST.md']);

    await expect(
      coordinator.runExclusive(workItemId, fixture.dossierDirectory, async () => 'recovered'),
    ).resolves.toBe('recovered');
    await expect(stat(recoveryClaimPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains a live recovery claim and fails closed without touching its journal', async () => {
    const fixture = await createFixture();
    const relativePath = '00_MANIFEST.md';
    const targetPath = join(fixture.dossierDirectory, relativePath);
    await writeFile(targetPath, 'last committed manifest\n', 'utf8');
    const abandoningCoordinator = createCoordinator(fixture.root, [relativePath], (point) =>
      point === 'after-originals-moved' ? 'abandon' : undefined,
    );
    await abandonAfterOriginalsMoved(
      abandoningCoordinator,
      fixture,
      relativePath,
      'unconfirmed manifest\n',
    );

    const lockDirectory = join(fixture.root, '.ws-workspace', '.locks');
    const recoveryClaimPath = join(lockDirectory, `${workItemId}.recovery.claim`);
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(recoveryClaimPath, `${process.pid}\n`, 'utf8');
    const blockedCoordinator = createCoordinator(fixture.root, [relativePath]);

    await expect(
      blockedCoordinator.runExclusive(workItemId, fixture.dossierDirectory, async () => undefined),
    ).rejects.toBeInstanceOf(AuditTrackingConflictError);
    await expect(readFile(recoveryClaimPath, 'utf8')).resolves.toBe(`${process.pid}\n`);
    expect((await stat(fixture.transactionDirectory)).isDirectory()).toBe(true);
  });
});
