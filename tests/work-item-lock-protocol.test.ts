import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AuditLedgerCorruptError,
  AuditTrackingConflictError,
  AuditTrackingUpdateError,
} from '../src/errors/workspace-error.js';
import {
  WorkItemOperationCoordinator,
  type WorkItemLockProtocolFailurePoint,
  type WorkItemTransactionFailurePoint,
} from '../src/filesystem/work-item-operation-coordinator.js';
import { createTemporaryWorkspaceRoot, removeTemporaryWorkspaceRoot } from './helpers.js';

const workItemId = 'US-LOCK-PROTOCOL';
const instanceA = '11111111-1111-4111-8111-111111111111';
const instanceB = '22222222-2222-4222-8222-222222222222';
const instanceC = '33333333-3333-4333-8333-333333333333';
const operationA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const operationB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const lockTokenA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const claimTokenA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const acquiredAt = '2026-07-29T12:00:00.000Z';
const temporaryRoots: string[] = [];

interface Fixture {
  root: string;
  dossierDirectory: string;
  lockDirectory: string;
  lockPath: string;
  claimPath: string;
  transactionDirectory: string;
}

interface OwnerRecord {
  pid: number;
  instanceId: string;
  operationId: string;
  token: string;
  acquiredAt: string;
}

interface CoordinatorOverrides {
  instanceId?: string;
  processLivenessProbe?: (pid: number) => boolean;
  injectLockProtocolFailure?: (point: WorkItemLockProtocolFailurePoint) => boolean;
  injectFailure?: (point: WorkItemTransactionFailurePoint) => 'fail' | 'abandon' | undefined;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(removeTemporaryWorkspaceRoot));
});

async function createFixture(): Promise<Fixture> {
  const root = await createTemporaryWorkspaceRoot();
  temporaryRoots.push(root);
  const workspaceDirectory = join(root, '.ws-workspace');
  const dossierDirectory = join(workspaceDirectory, 'active', workItemId);
  const lockDirectory = join(workspaceDirectory, '.locks');
  await mkdir(dossierDirectory, { recursive: true });
  return {
    root,
    dossierDirectory,
    lockDirectory,
    lockPath: join(lockDirectory, `${workItemId}.lifecycle.lock`),
    claimPath: join(lockDirectory, `${workItemId}.recovery.claim`),
    transactionDirectory: join(workspaceDirectory, '.staging', `${workItemId}-shared-transaction`),
  };
}

function createCoordinator(
  fixture: Fixture,
  overrides: CoordinatorOverrides = {},
): WorkItemOperationCoordinator {
  return new WorkItemOperationCoordinator({
    workspaceRoot: fixture.root,
    allowedRelativePaths: ['00_MANIFEST.md'],
    conflictError: () => new AuditTrackingConflictError('shared operation conflict'),
    updateError: () => new AuditTrackingUpdateError('safe update failure'),
    recoveryError: () => new AuditLedgerCorruptError('safe recovery failure'),
    instanceId: overrides.instanceId ?? instanceB,
    ...(overrides.processLivenessProbe === undefined
      ? {}
      : { processLivenessProbe: overrides.processLivenessProbe }),
    ...(overrides.injectLockProtocolFailure === undefined
      ? {}
      : { injectLockProtocolFailure: overrides.injectLockProtocolFailure }),
    ...(overrides.injectFailure === undefined
      ? {}
      : {
          injectFailure: (point: WorkItemTransactionFailurePoint) =>
            overrides.injectFailure?.(point),
        }),
  });
}

function owner(instanceId = instanceA, token = lockTokenA): OwnerRecord {
  return {
    pid: process.pid,
    instanceId,
    operationId: operationA,
    token,
    acquiredAt,
  };
}

async function writeLock(fixture: Fixture, lockOwner: OwnerRecord): Promise<void> {
  await mkdir(fixture.lockDirectory, { recursive: true });
  await writeFile(
    fixture.lockPath,
    JSON.stringify({ schemaVersion: '2.0.0', ...lockOwner }) + '\n',
    'utf8',
  );
}

async function writeClaim(
  fixture: Fixture,
  purpose: 'RECOVERY' | 'RELEASE',
  lockOwner: OwnerRecord,
  claimant: OwnerRecord = lockOwner,
): Promise<void> {
  await mkdir(fixture.lockDirectory, { recursive: true });
  await writeFile(
    fixture.claimPath,
    JSON.stringify({
      schemaVersion: '2.0.0',
      pid: claimant.pid,
      instanceId: claimant.instanceId,
      operationId: claimant.operationId,
      token: claimTokenA,
      purpose,
      acquiredAt,
      lock: lockOwner,
    }) + '\n',
    'utf8',
  );
}

async function expectMissing(path: string): Promise<void> {
  await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
}

describe('WorkItemOperationCoordinator lock protocol v2', () => {
  it('propagates a release-claim creation failure and retains the owned lock', async () => {
    const fixture = await createFixture();
    const coordinator = createCoordinator(fixture, {
      injectLockProtocolFailure: (point) => point === 'before-release-claim-create',
    });

    await expect(
      coordinator.runExclusive(workItemId, fixture.dossierDirectory, async () => 'done'),
    ).rejects.toBeInstanceOf(AuditTrackingUpdateError);
    await expect(stat(fixture.lockPath)).resolves.toBeDefined();
    await expectMissing(fixture.claimPath);
  });

  it('propagates lifecycle-lock retirement failure without hiding the retained lock', async () => {
    const fixture = await createFixture();
    const coordinator = createCoordinator(fixture, {
      injectLockProtocolFailure: (point) => point === 'before-release-lock-retire',
    });

    await expect(
      coordinator.runExclusive(workItemId, fixture.dossierDirectory, async () => 'done'),
    ).rejects.toBeInstanceOf(AuditTrackingUpdateError);
    await expect(stat(fixture.lockPath)).resolves.toBeDefined();
    await expectMissing(fixture.claimPath);
  });

  it('propagates release-claim retirement failure after the lock was retired', async () => {
    const fixture = await createFixture();
    const coordinator = createCoordinator(fixture, {
      injectLockProtocolFailure: (point) => point === 'before-release-claim-retire',
    });

    await expect(
      coordinator.runExclusive(workItemId, fixture.dossierDirectory, async () => 'done'),
    ).rejects.toBeInstanceOf(AuditTrackingUpdateError);
    await expectMissing(fixture.lockPath);
    await expect(stat(fixture.claimPath)).resolves.toBeDefined();
  });

  it('reports both retirement failures and retains both correlated artifacts', async () => {
    const fixture = await createFixture();
    const coordinator = createCoordinator(fixture, {
      injectLockProtocolFailure: (point) =>
        point === 'before-release-lock-retire' || point === 'before-release-claim-retire',
    });

    const error = await coordinator
      .runExclusive(workItemId, fixture.dossierDirectory, async () => 'done')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuditTrackingUpdateError);
    expect(Array.isArray((error as Error & { cause?: unknown }).cause)).toBe(true);
    await expect(stat(fixture.lockPath)).resolves.toBeDefined();
    await expect(stat(fixture.claimPath)).resolves.toBeDefined();
  });

  it('preserves a primary functional error and attaches the cleanup failure', async () => {
    const fixture = await createFixture();
    const primary = new AuditTrackingConflictError('primary functional failure');
    const coordinator = createCoordinator(fixture, {
      injectLockProtocolFailure: (point) => point === 'before-release-claim-create',
    });

    const error = await coordinator
      .runExclusive(workItemId, fixture.dossierDirectory, async () => {
        throw primary;
      })
      .catch((caught: unknown) => caught);

    expect(error).toBe(primary);
    expect(
      (error as AuditTrackingConflictError & { cleanupError?: unknown }).cleanupError,
    ).toBeInstanceOf(AuditTrackingUpdateError);
    expect((error as Error & { cause?: unknown }).cause).toBeInstanceOf(AuditTrackingUpdateError);
  });

  it('replays the original failure window and lets a new instance reconcile it', async () => {
    const fixture = await createFixture();
    const abandoningCoordinator = createCoordinator(fixture, {
      instanceId: instanceA,
      injectLockProtocolFailure: (point) =>
        point === 'before-release-lock-retire' || point === 'before-release-claim-retire',
    });

    await expect(
      abandoningCoordinator.runExclusive(workItemId, fixture.dossierDirectory, async () => 'first'),
    ).rejects.toBeInstanceOf(AuditTrackingUpdateError);
    const retryingCoordinator = createCoordinator(fixture, {
      instanceId: instanceB,
      processLivenessProbe: () => true,
    });

    await expect(
      retryingCoordinator.runExclusive(workItemId, fixture.dossierDirectory, async () => 'retried'),
    ).resolves.toBe('retried');
    await expectMissing(fixture.lockPath);
    await expectMissing(fixture.claimPath);
  });

  it('reconciles a correlated RELEASE from a previous instance despite PID reuse', async () => {
    const fixture = await createFixture();
    const previousOwner = owner(instanceA);
    await mkdir(join(fixture.root, '.ws-workspace', '.staging'), { recursive: true });
    await writeLock(fixture, previousOwner);
    await writeClaim(fixture, 'RELEASE', previousOwner);
    const coordinator = createCoordinator(fixture, {
      instanceId: instanceB,
      processLivenessProbe: () => true,
    });

    await expect(
      coordinator.runExclusive(workItemId, fixture.dossierDirectory, async () => 'recovered'),
    ).resolves.toBe('recovered');
    await expectMissing(fixture.lockPath);
    await expectMissing(fixture.claimPath);
  });

  it('reconciles a current-instance RELEASE when no operation remains registered', async () => {
    const fixture = await createFixture();
    const residualOwner = owner(instanceB);
    await writeLock(fixture, residualOwner);
    await writeClaim(fixture, 'RELEASE', residualOwner);

    await expect(
      createCoordinator(fixture, { instanceId: instanceB }).runExclusive(
        workItemId,
        fixture.dossierDirectory,
        async () => 'recovered',
      ),
    ).resolves.toBe('recovered');
    await expectMissing(fixture.lockPath);
    await expectMissing(fixture.claimPath);
  });

  it('finalizes a correlated claim-only RELEASE left after lock retirement', async () => {
    const fixture = await createFixture();
    const previousOwner = owner(instanceA);
    await writeClaim(fixture, 'RELEASE', previousOwner);
    const coordinator = createCoordinator(fixture, {
      instanceId: instanceB,
      processLivenessProbe: () => true,
    });

    await expect(
      coordinator.runExclusive(workItemId, fixture.dossierDirectory, async () => 'recovered'),
    ).resolves.toBe('recovered');
    await expectMissing(fixture.claimPath);
  });

  it('reclaims an abandoned current-instance RECOVERY claim and its inactive lock', async () => {
    const fixture = await createFixture();
    const residualOwner = owner(instanceB);
    await writeLock(fixture, residualOwner);
    await writeClaim(fixture, 'RECOVERY', residualOwner);

    await expect(
      createCoordinator(fixture, { instanceId: instanceB }).runExclusive(
        workItemId,
        fixture.dossierDirectory,
        async () => 'recovered',
      ),
    ).resolves.toBe('recovered');
    await expectMissing(fixture.lockPath);
    await expectMissing(fixture.claimPath);
  });

  it('fails closed for a live RECOVERY claimant from another instance', async () => {
    const fixture = await createFixture();
    const previousOwner = owner(instanceA);
    const claimant = {
      ...owner(instanceC, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      operationId: operationB,
    };
    await writeLock(fixture, previousOwner);
    await writeClaim(fixture, 'RECOVERY', previousOwner, claimant);
    const coordinator = createCoordinator(fixture, {
      instanceId: instanceB,
      processLivenessProbe: () => true,
    });

    await expect(
      coordinator.runExclusive(workItemId, fixture.dossierDirectory, async () => undefined),
    ).rejects.toBeInstanceOf(AuditTrackingConflictError);
    await expect(stat(fixture.lockPath)).resolves.toBeDefined();
    await expect(stat(fixture.claimPath)).resolves.toBeDefined();
  });

  it('fails closed for a live lock from another instance without a RELEASE claim', async () => {
    const fixture = await createFixture();
    await writeLock(fixture, owner(instanceA));
    const coordinator = createCoordinator(fixture, {
      instanceId: instanceB,
      processLivenessProbe: () => true,
    });

    await expect(
      coordinator.runExclusive(workItemId, fixture.dossierDirectory, async () => undefined),
    ).rejects.toBeInstanceOf(AuditTrackingConflictError);
    await expect(stat(fixture.lockPath)).resolves.toBeDefined();
  });

  it('fails closed and preserves malformed or acquisition-divergent artifacts', async () => {
    const malformedFixture = await createFixture();
    await writeLock(malformedFixture, owner(instanceA));
    await mkdir(malformedFixture.lockDirectory, { recursive: true });
    await writeFile(malformedFixture.claimPath, '{"schemaVersion":"2.0.0","purpose":"RELEASE"}\n');

    await expect(
      createCoordinator(malformedFixture).runExclusive(
        workItemId,
        malformedFixture.dossierDirectory,
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(AuditTrackingConflictError);
    await expect(readFile(malformedFixture.claimPath, 'utf8')).resolves.toContain('RELEASE');

    const divergentFixture = await createFixture();
    const lockOwner = owner(instanceA);
    await writeLock(divergentFixture, lockOwner);
    await writeClaim(divergentFixture, 'RELEASE', {
      ...lockOwner,
      token: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    });

    await expect(
      createCoordinator(divergentFixture).runExclusive(
        workItemId,
        divergentFixture.dossierDirectory,
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(AuditTrackingConflictError);
    await expect(stat(divergentFixture.lockPath)).resolves.toBeDefined();
    await expect(stat(divergentFixture.claimPath)).resolves.toBeDefined();
  });

  it('recovers a valid journal when no lifecycle lock remains', async () => {
    const fixture = await createFixture();
    const targetPath = join(fixture.dossierDirectory, '00_MANIFEST.md');
    await writeFile(targetPath, 'committed state\n', 'utf8');
    const abandoningCoordinator = createCoordinator(fixture, {
      injectFailure: (point) => (point === 'after-originals-moved' ? 'abandon' : undefined),
    });

    await expect(
      abandoningCoordinator.runExclusive(workItemId, fixture.dossierDirectory, () =>
        abandoningCoordinator.commit(
          workItemId,
          fixture.dossierDirectory,
          [
            {
              relativePath: '00_MANIFEST.md',
              content: 'unconfirmed state\n',
              originalExists: true,
            },
          ],
          async () => undefined,
        ),
      ),
    ).rejects.toBeInstanceOf(AuditTrackingUpdateError);
    await expectMissing(fixture.lockPath);

    await expect(
      createCoordinator(fixture).runExclusive(
        workItemId,
        fixture.dossierDirectory,
        async () => 'recovered',
      ),
    ).resolves.toBe('recovered');
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('committed state\n');
    await expectMissing(fixture.transactionDirectory);
  });

  it('preserves a correlated lock and RELEASE claim when a valid journal is pending', async () => {
    const fixture = await createFixture();
    const targetPath = join(fixture.dossierDirectory, '00_MANIFEST.md');
    await writeFile(targetPath, 'committed state\n', 'utf8');
    const abandoningCoordinator = createCoordinator(fixture, {
      injectFailure: (point) => (point === 'after-originals-moved' ? 'abandon' : undefined),
    });
    await expect(
      abandoningCoordinator.runExclusive(workItemId, fixture.dossierDirectory, () =>
        abandoningCoordinator.commit(
          workItemId,
          fixture.dossierDirectory,
          [
            {
              relativePath: '00_MANIFEST.md',
              content: 'unconfirmed state\n',
              originalExists: true,
            },
          ],
          async () => undefined,
        ),
      ),
    ).rejects.toBeInstanceOf(AuditTrackingUpdateError);
    const residualOwner = owner(instanceA);
    await writeLock(fixture, residualOwner);
    await writeClaim(fixture, 'RELEASE', residualOwner);

    await expect(
      createCoordinator(fixture, {
        instanceId: instanceB,
        processLivenessProbe: () => false,
      }).runExclusive(workItemId, fixture.dossierDirectory, async () => undefined),
    ).rejects.toBeInstanceOf(AuditTrackingConflictError);
    await expect(stat(fixture.lockPath)).resolves.toBeDefined();
    await expect(stat(fixture.claimPath)).resolves.toBeDefined();
    await expect(stat(join(fixture.transactionDirectory, 'journal.json'))).resolves.toBeDefined();
  });

  it('discards safe staging without a journal but preserves unknown staging', async () => {
    const safeFixture = await createFixture();
    await mkdir(join(safeFixture.transactionDirectory, 'files'), { recursive: true });
    await mkdir(join(safeFixture.transactionDirectory, 'backups'));

    await expect(
      createCoordinator(safeFixture).runExclusive(
        workItemId,
        safeFixture.dossierDirectory,
        async () => 'clean',
      ),
    ).resolves.toBe('clean');
    await expectMissing(safeFixture.transactionDirectory);

    const unknownFixture = await createFixture();
    await mkdir(unknownFixture.transactionDirectory, { recursive: true });
    await writeFile(join(unknownFixture.transactionDirectory, 'unknown.bin'), 'retain\n');

    await expect(
      createCoordinator(unknownFixture).runExclusive(
        workItemId,
        unknownFixture.dossierDirectory,
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(AuditLedgerCorruptError);
    await expect(
      readFile(join(unknownFixture.transactionDirectory, 'unknown.bin'), 'utf8'),
    ).resolves.toBe('retain\n');
  });

  it('keeps a simultaneous legitimate owner exclusive', async () => {
    const fixture = await createFixture();
    const first = createCoordinator(fixture, { instanceId: instanceA });
    const second = createCoordinator(fixture, { instanceId: instanceA });
    let enteredResolve: (() => void) | undefined;
    let finishResolve: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredResolve = resolve;
    });
    const finish = new Promise<void>((resolve) => {
      finishResolve = resolve;
    });
    const active = first.runExclusive(workItemId, fixture.dossierDirectory, async () => {
      enteredResolve?.();
      await finish;
      return 'first';
    });
    await entered;

    await expect(
      second.runExclusive(workItemId, fixture.dossierDirectory, async () => 'second'),
    ).rejects.toBeInstanceOf(AuditTrackingConflictError);
    finishResolve?.();
    await expect(active).resolves.toBe('first');
  });

  it('does not reconcile a RELEASE while its exact current owner is active', async () => {
    const fixture = await createFixture();
    const first = createCoordinator(fixture, { instanceId: instanceA });
    const second = createCoordinator(fixture, { instanceId: instanceA });
    let enteredResolve: (() => void) | undefined;
    let finishResolve: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredResolve = resolve;
    });
    const finish = new Promise<void>((resolve) => {
      finishResolve = resolve;
    });
    const active = first.runExclusive(workItemId, fixture.dossierDirectory, async () => {
      enteredResolve?.();
      await finish;
      return 'first';
    });
    await entered;
    const activeOwner = JSON.parse(await readFile(fixture.lockPath, 'utf8')) as OwnerRecord & {
      schemaVersion: string;
    };
    await writeClaim(fixture, 'RELEASE', {
      pid: activeOwner.pid,
      instanceId: activeOwner.instanceId,
      operationId: activeOwner.operationId,
      token: activeOwner.token,
      acquiredAt: activeOwner.acquiredAt,
    });

    await expect(
      second.runExclusive(workItemId, fixture.dossierDirectory, async () => 'second'),
    ).rejects.toBeInstanceOf(AuditTrackingConflictError);
    await rm(fixture.claimPath);
    finishResolve?.();
    await expect(active).resolves.toBe('first');
  });
});
