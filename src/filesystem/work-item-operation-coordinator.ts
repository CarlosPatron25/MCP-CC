import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, rename, rm, rmdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative } from 'node:path';

import { WorkspaceError } from '../errors/workspace-error.js';
import { resolvePathWithinRoot } from './safe-path.js';

const JOURNAL_SCHEMA_VERSION = '1.0.0';
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRANSACTION_PHASES = [
  'PREPARED',
  'ORIGINALS_MOVED',
  'PROMOTING',
  'READY_TO_CONFIRM',
] as const;

type TransactionPhase = (typeof TRANSACTION_PHASES)[number];

export type WorkItemTransactionFailurePoint =
  | 'after-staging-prepared'
  | 'before-promotion'
  | 'after-originals-moved'
  | 'between-replacements'
  | 'before-confirm';

export type WorkItemTransactionFailureMode = 'fail' | 'abandon';

export interface WorkItemTransactionReplacement {
  relativePath: string;
  content: string;
  originalExists: boolean;
}

export interface WorkItemOperationCoordinatorOptions {
  workspaceRoot: string;
  allowedRelativePaths: readonly string[];
  recoveryAllowedRelativePaths?: readonly string[];
  conflictError: () => WorkspaceError;
  updateError: () => WorkspaceError;
  recoveryError: () => WorkspaceError;
  injectFailure?: (
    point: WorkItemTransactionFailurePoint,
    promotedCount: number,
  ) => WorkItemTransactionFailureMode | undefined;
}

interface JournalReplacement {
  relativePath: string;
  originalExists: boolean;
  createdParent: boolean;
  originalHash?: string;
  nextHash: string;
  backupName: string;
}

interface TransactionJournal {
  schemaVersion: typeof JOURNAL_SCHEMA_VERSION;
  transactionId: string;
  workItemId: string;
  phase: TransactionPhase;
  promotedCount: number;
  replacements: JournalReplacement[];
}

interface PreparedReplacement extends JournalReplacement {
  targetPath: string;
  stagedPath: string;
  backupPath: string;
}

interface RecoveryClaim {
  pid: number;
  token?: string;
  purpose?: 'RECOVERY' | 'RELEASE';
}

interface OwnedFile {
  content: string;
  device: number;
  inode: number;
  birthtimeMs: number;
}

const activeOperationLocks = new AsyncLocalStorage<ReadonlyMap<string, string>>();

interface RestorationAction {
  replacement: JournalReplacement;
  targetPath: string;
  backupPath: string;
  action: 'NONE' | 'RESTORE_BACKUP' | 'REMOVE_NEW';
}

class AbandonedTransactionSimulation extends Error {
  public constructor() {
    super('Simulated abandoned transaction.');
    this.name = 'AbandonedTransactionSimulation';
  }
}

function isCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right));
  const expected = [...keys].sort((left, right) => left.localeCompare(right));
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

/**
 * Owns the physical Work Item exclusion boundary and crash-recoverable
 * multi-file promotion. Callers supply only an explicitly closed set of safe
 * dossier-relative artifact names.
 */
export class WorkItemOperationCoordinator {
  private readonly allowedRelativePaths: ReadonlySet<string>;
  private readonly recoveryAllowedRelativePaths: ReadonlySet<string>;

  public constructor(private readonly options: WorkItemOperationCoordinatorOptions) {
    this.allowedRelativePaths = new Set(options.allowedRelativePaths);
    this.recoveryAllowedRelativePaths = new Set(
      options.recoveryAllowedRelativePaths ?? options.allowedRelativePaths,
    );
  }

  public async runExclusive<T>(
    workItemId: string,
    dossierDirectory: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const lockIdentity = `${this.options.workspaceRoot}\u0000${workItemId}`;
    const activeDossier = activeOperationLocks.getStore()?.get(lockIdentity);
    if (activeDossier !== undefined) {
      if (activeDossier !== dossierDirectory) {
        throw this.options.recoveryError();
      }
      return operation();
    }
    const release = await this.acquireLock(workItemId);
    try {
      await this.assertRealDirectoryChain(this.options.workspaceRoot, dossierDirectory);
      await this.recoverAbandonedTransaction(workItemId, dossierDirectory);
      const inherited = activeOperationLocks.getStore();
      const active = new Map(inherited ?? []);
      active.set(lockIdentity, dossierDirectory);
      return await activeOperationLocks.run(active, operation);
    } finally {
      await release();
    }
  }

  public async commit(
    workItemId: string,
    dossierDirectory: string,
    replacements: readonly WorkItemTransactionReplacement[],
    validateVisibleState: () => Promise<void>,
  ): Promise<void> {
    this.validateReplacementRequest(replacements);
    await this.assertRealDirectoryChain(this.options.workspaceRoot, dossierDirectory);
    const transactionDirectory = this.transactionDirectory(workItemId);
    let journal: TransactionJournal | undefined;
    let commitConfirmed = false;
    let transactionDirectoryCreated = false;

    try {
      await this.prepareTransactionDirectory(transactionDirectory, () => {
        transactionDirectoryCreated = true;
      });
      const prepared = await this.stageReplacements(
        workItemId,
        dossierDirectory,
        transactionDirectory,
        replacements,
      );
      journal = {
        schemaVersion: JOURNAL_SCHEMA_VERSION,
        transactionId: randomUUID(),
        workItemId,
        phase: 'PREPARED',
        promotedCount: 0,
        replacements: prepared.map((replacement) => ({
          relativePath: replacement.relativePath,
          originalExists: replacement.originalExists,
          createdParent: replacement.createdParent,
          ...(replacement.originalHash === undefined
            ? {}
            : { originalHash: replacement.originalHash }),
          nextHash: replacement.nextHash,
          backupName: replacement.backupName,
        })),
      };
      await this.writeInitialJournal(transactionDirectory, journal);
      this.maybeInject('after-staging-prepared', 0);
      this.maybeInject('before-promotion', 0);

      await this.moveOriginals(dossierDirectory, transactionDirectory, prepared);
      journal = { ...journal, phase: 'ORIGINALS_MOVED' };
      await this.writeProgressRecord(transactionDirectory, journal, 1);
      this.maybeInject('after-originals-moved', 0);

      for (let index = 0; index < prepared.length; index += 1) {
        const replacement = prepared[index];
        if (replacement === undefined) {
          throw this.options.updateError();
        }
        await this.ensureTargetParent(dossierDirectory, replacement.targetPath);
        await this.assertRealDirectoryChain(transactionDirectory, dirname(replacement.stagedPath));
        await this.assertRegularFile(replacement.stagedPath);
        await rename(replacement.stagedPath, replacement.targetPath);
        journal = {
          ...journal,
          phase: 'PROMOTING',
          promotedCount: index + 1,
        };
        await this.writeProgressRecord(transactionDirectory, journal, index + 2);
        if (index + 1 < prepared.length) {
          this.maybeInject('between-replacements', index + 1);
        }
      }

      journal = { ...journal, phase: 'READY_TO_CONFIRM', promotedCount: prepared.length };
      await this.writeProgressRecord(transactionDirectory, journal, prepared.length + 2);
      this.maybeInject('before-confirm', prepared.length);
      await validateVisibleState();
      await this.writeCommitMarker(transactionDirectory, journal);
      commitConfirmed = true;
      await this.retireCommittedTransaction(transactionDirectory, journal).catch(() => false);
      await this.removeEmptyStagingParent();
    } catch (error) {
      if (error instanceof AbandonedTransactionSimulation) {
        throw this.options.updateError();
      }

      if (commitConfirmed) {
        throw this.options.updateError();
      }

      if (
        journal === undefined &&
        !transactionDirectoryCreated &&
        error instanceof WorkspaceError
      ) {
        throw error;
      }

      if (journal !== undefined) {
        const restored = await this.restorePreviousState(
          dossierDirectory,
          transactionDirectory,
          journal,
        );
        if (restored) {
          await this.retireRolledBackTransaction(transactionDirectory, journal).catch(() => false);
          await this.removeEmptyStagingParent();
        }
      } else {
        await this.cleanupTransactionDirectory(transactionDirectory).catch(() => undefined);
        await this.removeEmptyStagingParent();
      }
      throw this.options.updateError();
    }
  }

  public async recoverAbandonedTransaction(
    workItemId: string,
    dossierDirectory: string,
  ): Promise<void> {
    const transactionDirectory = this.transactionDirectory(workItemId);
    const stagingParent = dirname(transactionDirectory);
    if (!(await this.assertExistingRealDirectoryChain(this.options.workspaceRoot, stagingParent))) {
      return;
    }
    if (!(await this.pathExists(transactionDirectory))) {
      return;
    }
    await this.assertRealDirectoryChain(stagingParent, transactionDirectory);

    let journal: TransactionJournal;
    try {
      journal = await this.readJournal(transactionDirectory, workItemId);
    } catch {
      if (await this.canDiscardUncommittedPreparation(transactionDirectory)) {
        await this.cleanupTransactionDirectory(transactionDirectory).catch(() => {
          throw this.options.recoveryError();
        });
        await this.removeEmptyStagingParent();
        return;
      }
      throw this.options.recoveryError();
    }

    const markerPath = resolvePathWithinRoot(transactionDirectory, 'commit.marker');
    if (await this.pathExists(markerPath)) {
      try {
        await this.assertRegularFile(markerPath);
        const marker = await readFile(markerPath, 'utf8');
        if (marker !== `${journal.transactionId}\n`) {
          throw new Error('invalid marker');
        }
        if (!(await this.matchesNextVisibleState(dossierDirectory, journal))) {
          throw new Error('invalid committed state');
        }
        if (!(await this.retireCommittedTransaction(transactionDirectory, journal))) {
          throw new Error('committed transaction cleanup could not be claimed');
        }
        await this.removeEmptyStagingParent();
        return;
      } catch {
        throw this.options.recoveryError();
      }
    }

    const restored = await this.restorePreviousState(
      dossierDirectory,
      transactionDirectory,
      journal,
    );
    if (!restored) {
      throw this.options.recoveryError();
    }
    if (!(await this.retireRolledBackTransaction(transactionDirectory, journal))) {
      throw this.options.recoveryError();
    }
    await this.removeEmptyStagingParent();
  }

  private async acquireLock(workItemId: string): Promise<() => Promise<void>> {
    const workspaceDirectory = resolvePathWithinRoot(this.options.workspaceRoot, '.ws-workspace');
    await this.assertRealDirectoryChain(this.options.workspaceRoot, workspaceDirectory);
    const lockDirectory = resolvePathWithinRoot(workspaceDirectory, '.locks');
    await this.ensureContainedDirectory(lockDirectory);
    const lockPath = resolvePathWithinRoot(lockDirectory, `${workItemId}.lifecycle.lock`);
    const recoveryClaimPath = resolvePathWithinRoot(lockDirectory, `${workItemId}.recovery.claim`);

    if (
      (await this.safeLockPathExists(recoveryClaimPath)) &&
      !(await this.clearAbandonedRecoveryClaim(workItemId, recoveryClaimPath))
    ) {
      throw this.options.conflictError();
    }
    let ownedLock = await this.createLockFile(lockPath);
    if (ownedLock === undefined) {
      const recoveryClaim = await this.claimAbandonedLock(lockPath, recoveryClaimPath);
      if (recoveryClaim === undefined) {
        throw this.options.conflictError();
      }
      try {
        ownedLock = await this.createLockFile(lockPath);
        if (ownedLock === undefined) {
          throw this.options.conflictError();
        }
      } catch (error) {
        await this.releaseRecoveryClaim(recoveryClaimPath, recoveryClaim);
        throw error;
      }
      if (!(await this.releaseRecoveryClaim(recoveryClaimPath, recoveryClaim))) {
        await this.removeOwnedFile(lockPath, ownedLock).catch(() => false);
        throw this.options.conflictError();
      }
    }

    if (ownedLock === undefined) {
      throw this.options.conflictError();
    }
    const expectedLock = ownedLock;
    return async () => {
      const released = await this.releaseOwnedLock(lockPath, recoveryClaimPath, expectedLock).catch(
        () => false,
      );
      if (released) {
        const safeDirectory = await this.assertRealDirectoryChain(workspaceDirectory, lockDirectory)
          .then(() => true)
          .catch(() => false);
        if (safeDirectory) {
          await rmdir(lockDirectory).catch(() => undefined);
        }
      }
    };
  }

  private async createLockFile(lockPath: string): Promise<OwnedFile | undefined> {
    const lockContent =
      JSON.stringify({
        schemaVersion: JOURNAL_SCHEMA_VERSION,
        pid: process.pid,
        token: randomUUID(),
        acquiredAt: new Date().toISOString(),
      }) + '\n';
    let lock;
    let ownedLock: OwnedFile | undefined;
    try {
      lock = await open(lockPath, 'wx');
    } catch (error) {
      if (isCode(error, 'EEXIST')) {
        return undefined;
      }
      throw this.options.conflictError();
    }

    try {
      const identity = await lock.stat();
      ownedLock = this.ownedFile(lockContent, identity);
      await lock.writeFile(lockContent, 'utf8');
      await lock.sync();
      const confirmedIdentity = await lock.stat();
      if (!this.sameFileIdentity(ownedLock, confirmedIdentity)) {
        throw new Error('lock identity changed');
      }
      return ownedLock;
    } catch {
      await lock.close().catch(() => undefined);
      lock = undefined;
      if (ownedLock !== undefined) {
        await this.removeOwnedFile(lockPath, ownedLock).catch(() => false);
      }
      throw this.options.conflictError();
    } finally {
      if (lock !== undefined) {
        await lock.close().catch(() => undefined);
      }
    }
  }

  /**
   * A lock is recoverable only when it was created by this coordinator, its
   * recorded process is no longer alive, and its physical identity remains
   * unchanged while it is claimed. A journal is not required because a
   * process can exit while holding the gate before starting a transaction.
   * Empty or malformed historical lock markers remain retained.
   */
  private async claimAbandonedLock(
    lockPath: string,
    recoveryClaimPath: string,
  ): Promise<OwnedFile | undefined> {
    let expectedLock: OwnedFile;
    try {
      expectedLock = await this.readOwnedRegularFile(lockPath);
      if (!this.isAbandonedLockContent(expectedLock.content)) {
        return undefined;
      }
    } catch {
      return undefined;
    }

    const recoveryClaimContent =
      JSON.stringify({
        schemaVersion: JOURNAL_SCHEMA_VERSION,
        pid: process.pid,
        token: randomUUID(),
        purpose: 'RECOVERY',
        acquiredAt: new Date().toISOString(),
      }) + '\n';
    const recoveryClaim = await this.createOwnedClaim(recoveryClaimPath, recoveryClaimContent);
    if (recoveryClaim === undefined) {
      return undefined;
    }

    try {
      const currentLock = await this.readOwnedRegularFile(lockPath);
      if (
        currentLock.content !== expectedLock.content ||
        !this.sameFileIdentity(expectedLock, currentLock) ||
        !this.isAbandonedLockContent(currentLock.content)
      ) {
        await this.releaseRecoveryClaim(recoveryClaimPath, recoveryClaim);
        return undefined;
      }
      if (!(await this.removeOwnedFile(lockPath, expectedLock))) {
        await this.releaseRecoveryClaim(recoveryClaimPath, recoveryClaim);
        return undefined;
      }
      return recoveryClaim;
    } catch {
      await this.releaseRecoveryClaim(recoveryClaimPath, recoveryClaim);
      return undefined;
    }
  }

  private async clearAbandonedRecoveryClaim(
    workItemId: string,
    recoveryClaimPath: string,
  ): Promise<boolean> {
    try {
      const expectedClaim = await this.readOwnedRegularFile(recoveryClaimPath);
      const claim = this.parseRecoveryClaim(expectedClaim.content);
      if (claim === undefined || this.isProcessAlive(claim.pid)) {
        return false;
      }
      if (
        claim.purpose === undefined &&
        !(await this.safeLockPathExists(this.transactionDirectory(workItemId)))
      ) {
        return false;
      }
      const confirmedClaim = await this.readOwnedRegularFile(recoveryClaimPath);
      if (
        confirmedClaim.content !== expectedClaim.content ||
        !this.sameFileIdentity(expectedClaim, confirmedClaim)
      ) {
        return false;
      }
      return this.removeOwnedFile(recoveryClaimPath, expectedClaim);
    } catch {
      return false;
    }
  }

  private parseRecoveryClaim(content: string): RecoveryClaim | undefined {
    const legacyPid = content.match(/^([1-9]\d*)\r?\n?$/)?.[1];
    if (legacyPid !== undefined) {
      const pid = Number(legacyPid);
      return Number.isSafeInteger(pid) ? { pid } : undefined;
    }

    try {
      const parsed: unknown = JSON.parse(content);
      const hasPurpose = isRecord(parsed) && 'purpose' in parsed;
      if (
        !isRecord(parsed) ||
        !hasExactKeys(
          parsed,
          hasPurpose
            ? ['schemaVersion', 'pid', 'token', 'purpose', 'acquiredAt']
            : ['schemaVersion', 'pid', 'token', 'acquiredAt'],
        ) ||
        parsed.schemaVersion !== JOURNAL_SCHEMA_VERSION ||
        typeof parsed.pid !== 'number' ||
        !Number.isSafeInteger(parsed.pid) ||
        parsed.pid <= 0 ||
        typeof parsed.token !== 'string' ||
        !UUID_V4_PATTERN.test(parsed.token) ||
        (hasPurpose && parsed.purpose !== 'RECOVERY' && parsed.purpose !== 'RELEASE') ||
        typeof parsed.acquiredAt !== 'string' ||
        parsed.acquiredAt.length === 0
      ) {
        return undefined;
      }
      return {
        pid: parsed.pid,
        token: parsed.token,
        ...(hasPurpose ? { purpose: parsed.purpose as 'RECOVERY' | 'RELEASE' } : {}),
      };
    } catch {
      return undefined;
    }
  }

  private async releaseRecoveryClaim(
    recoveryClaimPath: string,
    expectedClaim: OwnedFile,
  ): Promise<boolean> {
    try {
      const confirmedClaim = await this.readOwnedRegularFile(recoveryClaimPath);
      if (
        confirmedClaim.content !== expectedClaim.content ||
        !this.sameFileIdentity(expectedClaim, confirmedClaim)
      ) {
        return false;
      }
      return this.removeOwnedFile(recoveryClaimPath, expectedClaim);
    } catch {
      return false;
    }
  }

  private isAbandonedLockContent(content: string): boolean {
    try {
      const parsed: unknown = JSON.parse(content);
      const keys =
        isRecord(parsed) && 'token' in parsed
          ? ['schemaVersion', 'pid', 'token', 'acquiredAt']
          : ['schemaVersion', 'pid', 'acquiredAt'];
      if (
        !isRecord(parsed) ||
        !hasExactKeys(parsed, keys) ||
        parsed.schemaVersion !== JOURNAL_SCHEMA_VERSION ||
        typeof parsed.pid !== 'number' ||
        !Number.isSafeInteger(parsed.pid) ||
        parsed.pid <= 0 ||
        ('token' in parsed &&
          (typeof parsed.token !== 'string' || !UUID_V4_PATTERN.test(parsed.token))) ||
        typeof parsed.acquiredAt !== 'string' ||
        parsed.acquiredAt.length === 0
      ) {
        return false;
      }
      return !this.isProcessAlive(parsed.pid);
    } catch {
      return false;
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return !isCode(error, 'ESRCH');
    }
  }

  private async safeLockPathExists(path: string): Promise<boolean> {
    try {
      return await this.pathExists(path);
    } catch {
      throw this.options.conflictError();
    }
  }

  private validateReplacementRequest(
    replacements: readonly WorkItemTransactionReplacement[],
  ): void {
    if (replacements.length === 0) {
      throw this.options.updateError();
    }
    const paths = replacements.map((replacement) => replacement.relativePath);
    if (
      new Set(paths).size !== paths.length ||
      paths.some(
        (relativePath) =>
          !this.allowedRelativePaths.has(relativePath) ||
          !this.isCanonicalRelativePath(relativePath),
      )
    ) {
      throw this.options.updateError();
    }
  }

  private async prepareTransactionDirectory(
    transactionDirectory: string,
    markCreated: () => void,
  ): Promise<void> {
    const workspaceDirectory = resolvePathWithinRoot(this.options.workspaceRoot, '.ws-workspace');
    const stagingParent = resolvePathWithinRoot(workspaceDirectory, '.staging');
    await this.ensureRealDirectoryChain(this.options.workspaceRoot, stagingParent);
    if (await this.pathExists(transactionDirectory)) {
      throw this.options.recoveryError();
    }
    await mkdir(transactionDirectory);
    markCreated();
    await this.assertRealDirectoryChain(stagingParent, transactionDirectory);
    await this.ensureRealDirectoryChain(
      transactionDirectory,
      resolvePathWithinRoot(transactionDirectory, 'files'),
    );
    await this.ensureRealDirectoryChain(
      transactionDirectory,
      resolvePathWithinRoot(transactionDirectory, 'backups'),
    );
  }

  private transactionDirectory(workItemId: string): string {
    const workspaceDirectory = resolvePathWithinRoot(this.options.workspaceRoot, '.ws-workspace');
    const stagingParent = resolvePathWithinRoot(workspaceDirectory, '.staging');
    return resolvePathWithinRoot(stagingParent, `${workItemId}-shared-transaction`);
  }

  private async stageReplacements(
    workItemId: string,
    dossierDirectory: string,
    transactionDirectory: string,
    replacements: readonly WorkItemTransactionReplacement[],
  ): Promise<PreparedReplacement[]> {
    const prepared: PreparedReplacement[] = [];
    for (let index = 0; index < replacements.length; index += 1) {
      const replacement = replacements[index];
      if (replacement === undefined) {
        throw this.options.updateError();
      }
      const targetPath = resolvePathWithinRoot(dossierDirectory, replacement.relativePath);
      const stagedPath = resolvePathWithinRoot(
        transactionDirectory,
        'files',
        replacement.relativePath,
      );
      const backupName = `${index}.bak`;
      const backupPath = resolvePathWithinRoot(transactionDirectory, 'backups', backupName);
      let originalHash: string | undefined;
      const targetParent = dirname(targetPath);
      const createdParent =
        targetParent !== dossierDirectory &&
        !(await this.assertExistingRealDirectoryChain(dossierDirectory, targetParent));

      if (replacement.originalExists) {
        await this.assertRealDirectoryChain(dossierDirectory, targetParent);
        await this.assertRegularFile(targetPath);
        originalHash = sha256(await readFile(targetPath));
      } else if (await this.pathExists(targetPath)) {
        await this.assertRealDirectoryChain(dossierDirectory, targetParent);
        throw this.options.updateError();
      }

      await this.ensureRealDirectoryChain(transactionDirectory, dirname(stagedPath));
      await this.writeExclusiveFile(stagedPath, replacement.content);
      prepared.push({
        relativePath: replacement.relativePath,
        originalExists: replacement.originalExists,
        createdParent,
        ...(originalHash === undefined ? {} : { originalHash }),
        nextHash: sha256(replacement.content),
        backupName,
        targetPath,
        stagedPath,
        backupPath,
      });
    }

    if (prepared.length !== replacements.length || workItemId.length === 0) {
      throw this.options.updateError();
    }
    return prepared;
  }

  private async moveOriginals(
    dossierDirectory: string,
    transactionDirectory: string,
    replacements: readonly PreparedReplacement[],
  ): Promise<void> {
    for (const replacement of replacements) {
      if (replacement.originalExists) {
        await this.assertRealDirectoryChain(dossierDirectory, dirname(replacement.targetPath));
        await this.assertRealDirectoryChain(transactionDirectory, dirname(replacement.backupPath));
        await this.assertRegularFile(replacement.targetPath);
        await rename(replacement.targetPath, replacement.backupPath);
      }
    }
  }

  private async restorePreviousState(
    dossierDirectory: string,
    transactionDirectory: string,
    journal: TransactionJournal,
  ): Promise<boolean> {
    try {
      const actions = await this.planRestoration(dossierDirectory, transactionDirectory, journal);
      if (actions === undefined) {
        return false;
      }

      for (const action of [...actions].reverse()) {
        if (action.action === 'RESTORE_BACKUP') {
          if (
            action.replacement.originalHash === undefined ||
            (await this.fileHashIfPresent(transactionDirectory, action.backupPath)) !==
              action.replacement.originalHash
          ) {
            return false;
          }
          const targetHash = await this.fileHashIfPresent(dossierDirectory, action.targetPath);
          if (targetHash !== undefined && targetHash !== action.replacement.nextHash) {
            return false;
          }
          if (targetHash !== undefined) {
            await this.assertRealDirectoryChain(dossierDirectory, dirname(action.targetPath));
            await rm(action.targetPath);
          }
          await this.ensureTargetParent(dossierDirectory, action.targetPath);
          await this.assertRealDirectoryChain(transactionDirectory, dirname(action.backupPath));
          await this.assertRegularFile(action.backupPath);
          await rename(action.backupPath, action.targetPath);
        } else if (action.action === 'REMOVE_NEW') {
          if (
            (await this.fileHashIfPresent(dossierDirectory, action.targetPath)) !==
            action.replacement.nextHash
          ) {
            return false;
          }
          await this.assertRealDirectoryChain(dossierDirectory, dirname(action.targetPath));
          await rm(action.targetPath);
        }
      }

      return await this.matchesPreviousVisibleState(
        dossierDirectory,
        transactionDirectory,
        journal,
      );
    } catch {
      return false;
    }
  }

  private async planRestoration(
    dossierDirectory: string,
    transactionDirectory: string,
    journal: TransactionJournal,
  ): Promise<RestorationAction[] | undefined> {
    const actions: RestorationAction[] = [];
    for (const replacement of journal.replacements) {
      const targetPath = resolvePathWithinRoot(dossierDirectory, replacement.relativePath);
      const backupPath = resolvePathWithinRoot(
        transactionDirectory,
        'backups',
        replacement.backupName,
      );
      const targetHash = await this.fileHashIfPresent(dossierDirectory, targetPath);
      const backupHash = await this.fileHashIfPresent(transactionDirectory, backupPath);

      if (replacement.originalExists) {
        if (replacement.originalHash === undefined) {
          return undefined;
        }
        if (backupHash === undefined) {
          if (targetHash !== replacement.originalHash) {
            return undefined;
          }
          actions.push({ replacement, targetPath, backupPath, action: 'NONE' });
        } else {
          if (
            backupHash !== replacement.originalHash ||
            (targetHash !== undefined && targetHash !== replacement.nextHash)
          ) {
            return undefined;
          }
          actions.push({
            replacement,
            targetPath,
            backupPath,
            action: 'RESTORE_BACKUP',
          });
        }
      } else {
        if (backupHash !== undefined) {
          return undefined;
        }
        if (targetHash === undefined) {
          actions.push({ replacement, targetPath, backupPath, action: 'NONE' });
        } else if (targetHash === replacement.nextHash) {
          actions.push({ replacement, targetPath, backupPath, action: 'REMOVE_NEW' });
        } else {
          return undefined;
        }
      }
    }
    return actions;
  }

  private async matchesPreviousVisibleState(
    dossierDirectory: string,
    transactionDirectory: string,
    journal: TransactionJournal,
  ): Promise<boolean> {
    for (const replacement of journal.replacements) {
      const targetPath = resolvePathWithinRoot(dossierDirectory, replacement.relativePath);
      const backupPath = resolvePathWithinRoot(
        transactionDirectory,
        'backups',
        replacement.backupName,
      );
      const targetHash = await this.fileHashIfPresent(dossierDirectory, targetPath);
      const backupHash = await this.fileHashIfPresent(transactionDirectory, backupPath);
      if (
        backupHash !== undefined ||
        (replacement.originalExists
          ? replacement.originalHash === undefined || targetHash !== replacement.originalHash
          : targetHash !== undefined)
      ) {
        return false;
      }
    }
    return true;
  }

  private async fileHashIfPresent(
    trustedDirectory: string,
    path: string,
  ): Promise<string | undefined> {
    await this.assertRealDirectoryChain(trustedDirectory, dirname(path));
    if (!(await this.pathExists(path))) {
      return undefined;
    }
    await this.assertRegularFile(path);
    return sha256(await readFile(path));
  }

  private async matchesNextVisibleState(
    dossierDirectory: string,
    journal: TransactionJournal,
  ): Promise<boolean> {
    for (const replacement of journal.replacements) {
      const targetPath = resolvePathWithinRoot(dossierDirectory, replacement.relativePath);
      try {
        await this.assertRealDirectoryChain(dossierDirectory, dirname(targetPath));
        await this.assertRegularFile(targetPath);
        if (sha256(await readFile(targetPath)) !== replacement.nextHash) {
          return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  }

  private async writeInitialJournal(
    transactionDirectory: string,
    journal: TransactionJournal,
  ): Promise<void> {
    await this.writeAtomicTransactionFile(
      transactionDirectory,
      'journal.json',
      `journal-${journal.transactionId}.tmp`,
      JSON.stringify(journal, null, 2) + '\n',
    );
  }

  private async writeProgressRecord(
    transactionDirectory: string,
    journal: TransactionJournal,
    sequence: number,
  ): Promise<void> {
    const suffix = sequence.toString().padStart(6, '0');
    await this.writeAtomicTransactionFile(
      transactionDirectory,
      `progress-${suffix}.json`,
      `progress-${suffix}-${journal.transactionId}.tmp`,
      JSON.stringify(journal, null, 2) + '\n',
    );
  }

  private async readJournal(
    transactionDirectory: string,
    expectedWorkItemId: string,
  ): Promise<TransactionJournal> {
    const journalPath = resolvePathWithinRoot(transactionDirectory, 'journal.json');
    await this.assertRegularFile(journalPath);
    const parsed: unknown = JSON.parse(await readFile(journalPath, 'utf8'));
    if (
      !isRecord(parsed) ||
      !hasExactKeys(parsed, [
        'schemaVersion',
        'transactionId',
        'workItemId',
        'phase',
        'promotedCount',
        'replacements',
      ]) ||
      parsed.schemaVersion !== JOURNAL_SCHEMA_VERSION ||
      typeof parsed.transactionId !== 'string' ||
      !UUID_V4_PATTERN.test(parsed.transactionId) ||
      parsed.workItemId !== expectedWorkItemId ||
      typeof parsed.phase !== 'string' ||
      !(TRANSACTION_PHASES as readonly string[]).includes(parsed.phase) ||
      typeof parsed.promotedCount !== 'number' ||
      !Number.isSafeInteger(parsed.promotedCount) ||
      parsed.promotedCount < 0 ||
      !Array.isArray(parsed.replacements)
    ) {
      throw this.options.recoveryError();
    }

    const replacements = parsed.replacements.map((value) => this.parseJournalReplacement(value));
    if (
      replacements.length === 0 ||
      replacements.length < parsed.promotedCount ||
      new Set(replacements.map((replacement) => replacement.relativePath)).size !==
        replacements.length ||
      new Set(replacements.map((replacement) => replacement.backupName)).size !==
        replacements.length ||
      replacements.some((replacement, index) => replacement.backupName !== `${index}.bak`)
    ) {
      throw this.options.recoveryError();
    }
    return {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      transactionId: parsed.transactionId,
      workItemId: expectedWorkItemId,
      phase: parsed.phase as TransactionPhase,
      promotedCount: parsed.promotedCount,
      replacements,
    };
  }

  private parseJournalReplacement(value: unknown): JournalReplacement {
    if (!isRecord(value)) {
      throw this.options.recoveryError();
    }
    const originalExists = value.originalExists;
    const expectedKeys =
      originalExists === true
        ? [
            'relativePath',
            'originalExists',
            'createdParent',
            'originalHash',
            'nextHash',
            'backupName',
          ]
        : ['relativePath', 'originalExists', 'createdParent', 'nextHash', 'backupName'];
    if (
      !hasExactKeys(value, expectedKeys) ||
      typeof value.relativePath !== 'string' ||
      !this.recoveryAllowedRelativePaths.has(value.relativePath) ||
      !this.isCanonicalRelativePath(value.relativePath) ||
      typeof originalExists !== 'boolean' ||
      typeof value.createdParent !== 'boolean' ||
      (originalExists &&
        (typeof value.originalHash !== 'string' || !HASH_PATTERN.test(value.originalHash))) ||
      typeof value.nextHash !== 'string' ||
      !HASH_PATTERN.test(value.nextHash) ||
      typeof value.backupName !== 'string' ||
      !/^\d+\.bak$/.test(value.backupName)
    ) {
      throw this.options.recoveryError();
    }
    return {
      relativePath: value.relativePath,
      originalExists,
      createdParent: value.createdParent,
      ...(originalExists ? { originalHash: value.originalHash as string } : {}),
      nextHash: value.nextHash,
      backupName: value.backupName,
    };
  }

  private async writeCommitMarker(
    transactionDirectory: string,
    journal: TransactionJournal,
  ): Promise<void> {
    await this.writeAtomicTransactionFile(
      transactionDirectory,
      'commit.marker',
      `commit-${journal.transactionId}.tmp`,
      `${journal.transactionId}\n`,
    );
  }

  private async writeAtomicTransactionFile(
    transactionDirectory: string,
    finalName: string,
    temporaryName: string,
    content: string,
  ): Promise<void> {
    await this.assertRealDirectoryChain(dirname(transactionDirectory), transactionDirectory);
    const temporaryPath = resolvePathWithinRoot(transactionDirectory, temporaryName);
    const finalPath = resolvePathWithinRoot(transactionDirectory, finalName);
    await this.writeExclusiveFile(temporaryPath, content);
    try {
      await rename(temporaryPath, finalPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async canDiscardUncommittedPreparation(transactionDirectory: string): Promise<boolean> {
    try {
      const entries = await readdir(transactionDirectory, { withFileTypes: true });
      if (
        entries.some(
          (entry) =>
            entry.name === 'journal.json' ||
            entry.name === 'commit.marker' ||
            entry.name.startsWith('progress-') ||
            !(
              entry.name === 'files' ||
              entry.name === 'backups' ||
              /^journal-[0-9a-f-]+\.tmp$/i.test(entry.name)
            ),
        )
      ) {
        return false;
      }

      const filesEntry = entries.find((entry) => entry.name === 'files');
      if (
        filesEntry !== undefined &&
        (!filesEntry.isDirectory() ||
          filesEntry.isSymbolicLink() ||
          !(await this.treeContainsNoLinks(resolvePathWithinRoot(transactionDirectory, 'files'))))
      ) {
        return false;
      }

      const backupsEntry = entries.find((entry) => entry.name === 'backups');
      if (backupsEntry !== undefined) {
        if (!backupsEntry.isDirectory() || backupsEntry.isSymbolicLink()) {
          return false;
        }
        if ((await readdir(resolvePathWithinRoot(transactionDirectory, 'backups'))).length !== 0) {
          return false;
        }
      }

      return entries
        .filter((entry) => /^journal-[0-9a-f-]+\.tmp$/i.test(entry.name))
        .every((entry) => entry.isFile() && !entry.isSymbolicLink());
    } catch {
      return false;
    }
  }

  private async treeContainsNoLinks(path: string): Promise<boolean> {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
        return false;
      }
      if (
        entry.isDirectory() &&
        !(await this.treeContainsNoLinks(resolvePathWithinRoot(path, entry.name)))
      ) {
        return false;
      }
    }
    return true;
  }

  private async retireCommittedTransaction(
    transactionDirectory: string,
    journal: TransactionJournal,
  ): Promise<boolean> {
    return this.retireTransaction(transactionDirectory, journal, 'committed');
  }

  private async retireRolledBackTransaction(
    transactionDirectory: string,
    journal: TransactionJournal,
  ): Promise<boolean> {
    return this.retireTransaction(transactionDirectory, journal, 'rolled-back');
  }

  private async retireTransaction(
    transactionDirectory: string,
    journal: TransactionJournal,
    outcome: 'committed' | 'rolled-back',
  ): Promise<boolean> {
    const stagingParent = resolvePathWithinRoot(
      this.options.workspaceRoot,
      '.ws-workspace',
      '.staging',
    );
    const retiredDirectory = resolvePathWithinRoot(
      stagingParent,
      `${journal.workItemId}-${outcome}-${journal.transactionId}`,
    );
    try {
      await this.assertRealDirectoryChain(this.options.workspaceRoot, stagingParent);
      await this.assertRealDirectoryChain(stagingParent, transactionDirectory);
      if (await this.pathExists(retiredDirectory)) {
        return false;
      }
      await rename(transactionDirectory, retiredDirectory);
      await this.assertRealDirectoryChain(stagingParent, retiredDirectory);
    } catch {
      return false;
    }
    try {
      await this.cleanupTransactionDirectory(retiredDirectory);
    } catch {
      // The canonical transaction name has already been retired atomically.
      // Never put a possibly partially cleaned committed journal back where
      // recovery could mistake it for an unconfirmed transaction.
      await this.cleanupTransactionDirectory(retiredDirectory).catch(() => undefined);
    }
    return true;
  }

  private maybeInject(point: WorkItemTransactionFailurePoint, promotedCount: number): void {
    const mode = this.options.injectFailure?.(point, promotedCount);
    if (mode === 'abandon') {
      throw new AbandonedTransactionSimulation();
    }
    if (mode === 'fail') {
      throw this.options.updateError();
    }
  }

  private async ensureTargetParent(dossierDirectory: string, targetPath: string): Promise<void> {
    const parent = dirname(targetPath);
    if (parent === dossierDirectory) {
      await this.assertRealDirectoryChain(this.options.workspaceRoot, dossierDirectory);
      return;
    }
    await this.ensureRealDirectoryChain(dossierDirectory, parent);
  }

  private async ensureContainedDirectory(path: string): Promise<void> {
    const parent = dirname(path);
    await this.assertRealDirectoryChain(this.options.workspaceRoot, parent);
    try {
      await mkdir(path);
    } catch (error) {
      if (!isCode(error, 'EEXIST')) {
        throw this.options.updateError();
      }
    }
    await this.assertDirectory(path);
  }

  private async ensureRealDirectoryChain(
    trustedDirectory: string,
    targetDirectory: string,
  ): Promise<void> {
    const trusted = resolvePathWithinRoot(this.options.workspaceRoot, trustedDirectory);
    const target = resolvePathWithinRoot(trusted, targetDirectory);
    await this.assertRealDirectoryChain(this.options.workspaceRoot, trusted);
    if (target === trusted) {
      return;
    }

    let current = trusted;
    for (const segment of this.relativeSegments(trusted, target)) {
      current = resolvePathWithinRoot(current, segment);
      try {
        await mkdir(current);
      } catch (error) {
        if (!isCode(error, 'EEXIST')) {
          throw this.options.updateError();
        }
      }
      await this.assertDirectory(current);
    }
  }

  private async assertExistingRealDirectoryChain(
    trustedDirectory: string,
    targetDirectory: string,
  ): Promise<boolean> {
    const trusted = resolvePathWithinRoot(this.options.workspaceRoot, trustedDirectory);
    const target = resolvePathWithinRoot(trusted, targetDirectory);
    await this.assertRealDirectoryChain(this.options.workspaceRoot, trusted);
    if (target === trusted) {
      return true;
    }

    let current = trusted;
    for (const segment of this.relativeSegments(trusted, target)) {
      current = resolvePathWithinRoot(current, segment);
      if (!(await this.pathExists(current))) {
        return false;
      }
      await this.assertDirectory(current);
    }
    return true;
  }

  private async assertRealDirectoryChain(
    trustedDirectory: string,
    targetDirectory: string,
  ): Promise<void> {
    const trusted = resolvePathWithinRoot(this.options.workspaceRoot, trustedDirectory);
    const target = resolvePathWithinRoot(trusted, targetDirectory);
    await this.assertDirectory(trusted);
    if (target === trusted) {
      return;
    }

    let current = trusted;
    for (const segment of this.relativeSegments(trusted, target)) {
      current = resolvePathWithinRoot(current, segment);
      await this.assertDirectory(current);
    }
  }

  private relativeSegments(trustedDirectory: string, targetDirectory: string): string[] {
    const relativePath = relative(trustedDirectory, targetDirectory);
    if (
      relativePath.length === 0 ||
      relativePath === '..' ||
      relativePath.startsWith('../') ||
      relativePath.startsWith('..\\') ||
      isAbsolute(relativePath)
    ) {
      return [];
    }
    return relativePath.split(/[\\/]/u);
  }

  private async assertDirectory(path: string): Promise<void> {
    const entry = await lstat(path);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw this.options.recoveryError();
    }
  }

  private async assertRegularFile(path: string): Promise<void> {
    const entry = await lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw this.options.recoveryError();
    }
  }

  private async writeExclusiveFile(path: string, content: string): Promise<void> {
    const file = await open(path, 'wx');
    try {
      await file.writeFile(content, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
  }

  private async cleanupTransactionDirectory(transactionDirectory: string): Promise<void> {
    const expectedParent = resolvePathWithinRoot(
      this.options.workspaceRoot,
      '.ws-workspace',
      '.staging',
    );
    const resolved = resolvePathWithinRoot(expectedParent, transactionDirectory);
    if (resolved !== transactionDirectory) {
      throw this.options.recoveryError();
    }
    await this.assertRealDirectoryChain(this.options.workspaceRoot, expectedParent);
    if (!(await this.pathExists(transactionDirectory))) {
      return;
    }
    await this.assertRealDirectoryChain(expectedParent, transactionDirectory);
    if (!(await this.treeContainsNoLinks(transactionDirectory))) {
      throw this.options.recoveryError();
    }
    await rm(transactionDirectory, { recursive: true, force: true });
  }

  private async removeEmptyStagingParent(): Promise<void> {
    const stagingParent = resolvePathWithinRoot(
      this.options.workspaceRoot,
      '.ws-workspace',
      '.staging',
    );
    if (!(await this.assertExistingRealDirectoryChain(this.options.workspaceRoot, stagingParent))) {
      return;
    }
    await rmdir(stagingParent).catch(() => undefined);
  }

  private async releaseOwnedLock(
    lockPath: string,
    recoveryClaimPath: string,
    expectedLock: OwnedFile,
  ): Promise<boolean> {
    const releaseClaimContent =
      JSON.stringify({
        schemaVersion: JOURNAL_SCHEMA_VERSION,
        pid: process.pid,
        token: randomUUID(),
        purpose: 'RELEASE',
        acquiredAt: new Date().toISOString(),
      }) + '\n';
    const releaseClaim = await this.createOwnedClaim(recoveryClaimPath, releaseClaimContent);
    if (releaseClaim === undefined) {
      return false;
    }

    const released = await this.removeOwnedFile(lockPath, expectedLock).catch(() => false);
    const canonicalLockPresent = await this.pathExists(lockPath).catch(() => true);
    if (released || canonicalLockPresent) {
      await this.releaseRecoveryClaim(recoveryClaimPath, releaseClaim);
    }
    return released;
  }

  private async createOwnedClaim(path: string, content: string): Promise<OwnedFile | undefined> {
    let file;
    let ownedClaim: OwnedFile | undefined;
    try {
      file = await open(path, 'wx');
    } catch (error) {
      if (isCode(error, 'EEXIST')) {
        return undefined;
      }
      return undefined;
    }

    try {
      ownedClaim = this.ownedFile(content, await file.stat());
      await file.writeFile(content, 'utf8');
      await file.sync();
      if (!this.sameFileIdentity(ownedClaim, await file.stat())) {
        throw new Error('claim identity changed');
      }
      return ownedClaim;
    } catch {
      await file.close().catch(() => undefined);
      file = undefined;
      if (ownedClaim !== undefined) {
        await this.removeOwnedFile(path, ownedClaim).catch(() => false);
      }
      return undefined;
    } finally {
      if (file !== undefined) {
        await file.close().catch(() => undefined);
      }
    }
  }

  private async readOwnedRegularFile(path: string): Promise<OwnedFile> {
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink()) {
      throw this.options.recoveryError();
    }
    const content = await readFile(path, 'utf8');
    const after = await lstat(path);
    if (!after.isFile() || after.isSymbolicLink() || !this.sameFileIdentity(before, after)) {
      throw this.options.recoveryError();
    }
    return this.ownedFile(content, after);
  }

  private ownedFile(
    content: string,
    identity: { dev: number; ino: number; birthtimeMs: number },
  ): OwnedFile {
    return {
      content,
      device: identity.dev,
      inode: identity.ino,
      birthtimeMs: identity.birthtimeMs,
    };
  }

  private sameFileIdentity(
    left: OwnedFile | { dev: number; ino: number; birthtimeMs: number },
    right: OwnedFile | { dev: number; ino: number; birthtimeMs: number },
  ): boolean {
    const leftDevice = 'device' in left ? left.device : left.dev;
    const leftInode = 'inode' in left ? left.inode : left.ino;
    const rightDevice = 'device' in right ? right.device : right.dev;
    const rightInode = 'inode' in right ? right.inode : right.ino;
    return (
      leftDevice === rightDevice &&
      leftInode === rightInode &&
      left.birthtimeMs === right.birthtimeMs
    );
  }

  private async removeOwnedFile(path: string, expected: OwnedFile): Promise<boolean> {
    const parent = dirname(path);
    await this.assertRealDirectoryChain(this.options.workspaceRoot, parent);
    let current: OwnedFile;
    try {
      current = await this.readOwnedRegularFile(path);
    } catch {
      return false;
    }
    if (current.content !== expected.content || !this.sameFileIdentity(current, expected)) {
      return false;
    }

    const capturedPath = resolvePathWithinRoot(parent, `.captured-${randomUUID()}.tmp`);
    try {
      await rename(path, capturedPath);
    } catch {
      return false;
    }

    try {
      const captured = await this.readOwnedRegularFile(capturedPath);
      if (captured.content !== expected.content || !this.sameFileIdentity(captured, expected)) {
        await this.ensureCanonicalBlocker(path, captured.content);
        return false;
      }
      await rm(capturedPath);
      return true;
    } catch {
      await this.ensureCanonicalBlocker(path, 'retained non-owned lock\n');
      return false;
    }
  }

  private async ensureCanonicalBlocker(path: string, content: string): Promise<void> {
    if (await this.pathExists(path)) {
      return;
    }
    await this.writeExclusiveFile(path, content).catch(() => undefined);
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await lstat(path);
      return true;
    } catch (error) {
      if (isCode(error, 'ENOENT')) {
        return false;
      }
      throw this.options.recoveryError();
    }
  }

  private isCanonicalRelativePath(relativePath: string): boolean {
    return (
      relativePath.length > 0 &&
      !isAbsolute(relativePath) &&
      !relativePath.includes('\\') &&
      !relativePath.startsWith('/') &&
      relativePath.split('/').every((segment) => segment.length > 0 && segment !== '..')
    );
  }
}
