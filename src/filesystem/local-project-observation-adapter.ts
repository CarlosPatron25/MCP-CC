import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { access, lstat, open, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { isAbsolute, join, parse, resolve } from 'node:path';

import type {
  TechnicalSnapshotExclusion,
  TechnicalSnapshotFile,
  TechnicalSnapshotGitFile,
  TechnicalSnapshotGitObservation,
  TechnicalSnapshotObservation,
} from '../domain/technical-snapshot.js';
import {
  DEFAULT_PROJECT_OBSERVATION_LIMITS,
  ProjectObservationError,
  ProjectSourceConfigurationError,
  TechnicalSnapshotError,
  TechnicalSnapshotLimitError,
  type ProjectObservation,
  type ProjectObservationLimits,
} from '../services/project-observation.js';

const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git',
  '.ws-workspace',
  'node_modules',
  'dist',
  'coverage',
]);

const HASH_BUFFER_BYTES = 64 * 1024;

const GIT_COMMON_ARGUMENTS = [
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.untrackedCache=false',
  '-c',
  'maintenance.auto=false',
] as const;

const GIT_STATUS_ARGUMENTS = [
  ...GIT_COMMON_ARGUMENTS,
  'status',
  '--porcelain=v1',
  '-z',
  '--untracked-files=all',
] as const;

const GIT_HEAD_ARGUMENTS = [...GIT_COMMON_ARGUMENTS, 'rev-parse', '--verify', 'HEAD'] as const;

export interface GitCommandResult {
  exitCode: number | null;
  stdout: string;
}

export interface GitCommandRunner {
  run(
    sourceRoot: string,
    arguments_: readonly string[],
    maxOutputBytes: number,
  ): Promise<GitCommandResult>;
}

export interface LocalProjectObservationAdapterOptions {
  projectSourceRoot: string;
  limits?: Partial<ProjectObservationLimits>;
  gitCommandRunner?: GitCommandRunner;
}

interface ObservationState {
  entries: number;
  totalBytes: number;
  files: TechnicalSnapshotFile[];
  exclusions: TechnicalSnapshotExclusion[];
}

interface FileIdentity {
  dev: number | bigint;
  ino: number | bigint;
}

class GitOutputLimitError extends Error {}

class SpawnGitCommandRunner implements GitCommandRunner {
  public async run(
    sourceRoot: string,
    arguments_: readonly string[],
    maxOutputBytes: number,
  ): Promise<GitCommandResult> {
    return new Promise((resolveResult, rejectResult) => {
      const child = spawn('git', [...arguments_], {
        cwd: sourceRoot,
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: '0',
          GIT_TERMINAL_PROMPT: '0',
        },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const stdout: Buffer[] = [];
      let stdoutBytes = 0;
      let outputBytes = 0;
      let exceededLimit = false;
      let settled = false;

      const rejectOnce = (error: unknown): void => {
        if (!settled) {
          settled = true;
          rejectResult(error);
        }
      };

      const accountForOutput = (chunk: Buffer, preserve: boolean): void => {
        outputBytes += chunk.length;
        if (outputBytes > maxOutputBytes) {
          exceededLimit = true;
          child.kill();
          return;
        }
        if (preserve) {
          stdout.push(chunk);
          stdoutBytes += chunk.length;
        }
      };

      child.stdout.on('data', (chunk: Buffer) => {
        accountForOutput(chunk, true);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        accountForOutput(chunk, false);
      });
      child.once('error', (error) => {
        rejectOnce(exceededLimit ? new GitOutputLimitError() : error);
      });
      child.once('close', (exitCode) => {
        if (settled) {
          return;
        }
        settled = true;
        if (exceededLimit) {
          rejectResult(new GitOutputLimitError());
          return;
        }
        resolveResult({
          exitCode,
          stdout: Buffer.concat(stdout, stdoutBytes).toString('utf8'),
        });
      });
    });
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function isErrorCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function validateLimits(
  configured: Partial<ProjectObservationLimits> | undefined,
): ProjectObservationLimits {
  const limits: ProjectObservationLimits = {
    ...DEFAULT_PROJECT_OBSERVATION_LIMITS,
    ...configured,
  };
  const values = Object.values(limits);
  if (values.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new ProjectSourceConfigurationError();
  }
  return limits;
}

function posixRelativePath(segments: readonly string[]): string {
  return segments.join('/');
}

function isExcludedRelativePath(relativePath: string): boolean {
  return relativePath.split('/').some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment));
}

function normalizedGitPath(value: string, maxRelativePathBytes: number): string {
  const normalizedSeparators = value.replaceAll('\\', '/');
  if (
    normalizedSeparators.length === 0 ||
    normalizedSeparators.startsWith('/') ||
    /^[A-Za-z]:/u.test(normalizedSeparators) ||
    normalizedSeparators
      .split('/')
      .some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new TechnicalSnapshotError();
  }
  if (Buffer.byteLength(normalizedSeparators, 'utf8') > maxRelativePathBytes) {
    throw new TechnicalSnapshotLimitError();
  }
  return normalizedSeparators;
}

function parseGitStatus(output: string, maxRelativePathBytes: number): TechnicalSnapshotGitFile[] {
  if (output.length === 0) {
    return [];
  }

  const records = output.split('\0');
  if (records.at(-1) !== '') {
    throw new TechnicalSnapshotError();
  }
  records.pop();

  const files: TechnicalSnapshotGitFile[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (
      record === undefined ||
      record.length < 4 ||
      record[2] !== ' ' ||
      !/^[ MADRCUT?!]{2}$/u.test(record.slice(0, 2))
    ) {
      throw new TechnicalSnapshotError();
    }
    const status = record.slice(0, 2);
    const relativePath = normalizedGitPath(record.slice(3), maxRelativePathBytes);
    let originalRelativePath: string | undefined;

    if (status.includes('R') || status.includes('C')) {
      index += 1;
      const originalRecord = records[index];
      if (originalRecord === undefined) {
        throw new TechnicalSnapshotError();
      }
      originalRelativePath = normalizedGitPath(originalRecord, maxRelativePathBytes);
    }

    if (isExcludedRelativePath(relativePath)) {
      continue;
    }
    files.push({
      relativePath,
      status,
      ...(originalRelativePath === undefined || isExcludedRelativePath(originalRelativePath)
        ? {}
        : { originalRelativePath }),
    });
  }

  return files.sort((left, right) => {
    const pathOrder = compareText(left.relativePath, right.relativePath);
    return pathOrder === 0 ? compareText(left.status, right.status) : pathOrder;
  });
}

/**
 * Read-only adapter for the explicitly authorized project source tree.
 * It never discovers a root, persists source content, or returns absolute paths.
 */
export class LocalProjectObservationAdapter implements ProjectObservation {
  readonly #projectSourceRoot: string;
  readonly #limits: ProjectObservationLimits;
  readonly #gitCommandRunner: GitCommandRunner;

  public constructor(options: LocalProjectObservationAdapterOptions) {
    if (
      typeof options !== 'object' ||
      options === null ||
      typeof options.projectSourceRoot !== 'string' ||
      options.projectSourceRoot.trim().length === 0
    ) {
      throw new ProjectSourceConfigurationError();
    }
    this.#projectSourceRoot = options.projectSourceRoot;
    this.#limits = validateLimits(options.limits);
    this.#gitCommandRunner = options.gitCommandRunner ?? new SpawnGitCommandRunner();
  }

  public async capture(): Promise<TechnicalSnapshotObservation> {
    const sourceRoot = await this.validateSourceRoot();
    const state: ObservationState = {
      entries: 0,
      totalBytes: 0,
      files: [],
      exclusions: [],
    };

    try {
      const rootStats = await lstat(sourceRoot, { bigint: true });
      await this.walkDirectory(sourceRoot, [], rootStats, state);
      const git = await this.observeGit(sourceRoot);
      return {
        files: state.files.sort((left, right) =>
          compareText(left.relativePath, right.relativePath),
        ),
        exclusions: state.exclusions.sort((left, right) => {
          const pathOrder = compareText(left.relativePath, right.relativePath);
          return pathOrder === 0 ? compareText(left.reason, right.reason) : pathOrder;
        }),
        totalBytes: state.totalBytes,
        git,
      };
    } catch (error) {
      if (error instanceof ProjectObservationError) {
        throw error;
      }
      throw new TechnicalSnapshotError();
    }
  }

  private async validateSourceRoot(): Promise<string> {
    try {
      const configuredRoot = this.#projectSourceRoot.trim();
      if (!isAbsolute(configuredRoot)) {
        throw new ProjectSourceConfigurationError();
      }
      const sourceRoot = resolve(configuredRoot);
      const parsed = parse(sourceRoot);
      if (sourceRoot === parsed.root) {
        throw new ProjectSourceConfigurationError();
      }

      let current = parsed.root;
      const components = sourceRoot
        .slice(parsed.root.length)
        .split(/[\\/]+/u)
        .filter((component) => component.length > 0);
      for (const component of components) {
        current = join(current, component);
        const stats = await lstat(current);
        if (stats.isSymbolicLink()) {
          throw new ProjectSourceConfigurationError();
        }
      }

      const rootStats = await lstat(sourceRoot);
      if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
        throw new ProjectSourceConfigurationError();
      }
      await access(sourceRoot, constants.R_OK);
      return sourceRoot;
    } catch (error) {
      if (error instanceof ProjectSourceConfigurationError) {
        throw error;
      }
      throw new ProjectSourceConfigurationError();
    }
  }

  private recordEntry(relativePath: string, state: ObservationState): void {
    state.entries += 1;
    if (
      state.entries > this.#limits.maxEntries ||
      Buffer.byteLength(relativePath, 'utf8') > this.#limits.maxRelativePathBytes
    ) {
      throw new TechnicalSnapshotLimitError();
    }
  }

  private async walkDirectory(
    absoluteDirectory: string,
    relativeSegments: readonly string[],
    expectedStats: BigIntStats,
    state: ObservationState,
  ): Promise<void> {
    const currentStats = await lstat(absoluteDirectory, { bigint: true });
    if (
      !currentStats.isDirectory() ||
      currentStats.isSymbolicLink() ||
      !sameIdentity(currentStats, expectedStats)
    ) {
      throw new TechnicalSnapshotError();
    }

    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => compareText(left.name, right.name));

    for (const entry of entries) {
      const entrySegments = [...relativeSegments, entry.name];
      const relativePath = posixRelativePath(entrySegments);
      this.recordEntry(relativePath, state);
      const absolutePath = join(absoluteDirectory, entry.name);
      const stats = await lstat(absolutePath, { bigint: true });

      if (stats.isSymbolicLink()) {
        state.exclusions.push({ relativePath, reason: 'FILESYSTEM_LINK' });
      } else if (stats.isDirectory()) {
        if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
          state.exclusions.push({ relativePath, reason: 'EXCLUDED_DIRECTORY' });
        } else {
          await this.walkDirectory(absolutePath, entrySegments, stats, state);
        }
      } else if (stats.isFile()) {
        state.files.push(await this.hashFile(absolutePath, relativePath, stats, state));
      } else {
        state.exclusions.push({ relativePath, reason: 'NON_REGULAR_ENTRY' });
      }
    }
  }

  private async hashFile(
    absolutePath: string,
    relativePath: string,
    expectedStats: BigIntStats,
    state: ObservationState,
  ): Promise<TechnicalSnapshotFile> {
    if (
      expectedStats.size > BigInt(Number.MAX_SAFE_INTEGER) ||
      expectedStats.size > BigInt(this.#limits.maxTotalBytes - state.totalBytes)
    ) {
      throw new TechnicalSnapshotLimitError();
    }

    const noFollowFlag = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    const handle = await open(absolutePath, constants.O_RDONLY | noFollowFlag);
    try {
      const before = await handle.stat({ bigint: true });
      if (
        !before.isFile() ||
        !sameIdentity(before, expectedStats) ||
        before.size !== expectedStats.size ||
        before.mtimeNs !== expectedStats.mtimeNs
      ) {
        throw new TechnicalSnapshotError();
      }

      const hash = createHash('sha256');
      const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
      let position = 0;
      while (true) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (bytesRead === 0) {
          break;
        }
        if (bytesRead > this.#limits.maxTotalBytes - state.totalBytes) {
          throw new TechnicalSnapshotLimitError();
        }
        state.totalBytes += bytesRead;
        hash.update(buffer.subarray(0, bytesRead));
        position += bytesRead;
      }

      const after = await handle.stat({ bigint: true });
      if (
        !sameIdentity(after, before) ||
        after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs ||
        BigInt(position) !== after.size
      ) {
        throw new TechnicalSnapshotError();
      }
      return {
        relativePath,
        sha256: hash.digest('hex'),
        size: position,
        modifiedAt: new Date(Number(after.mtimeMs)).toISOString(),
      };
    } finally {
      await handle.close();
    }
  }

  private async observeGit(sourceRoot: string): Promise<TechnicalSnapshotGitObservation> {
    let statusResult: GitCommandResult;
    try {
      statusResult = await this.#gitCommandRunner.run(
        sourceRoot,
        [...GIT_STATUS_ARGUMENTS],
        this.#limits.maxGitOutputBytes,
      );
    } catch (error) {
      if (error instanceof GitOutputLimitError) {
        throw new TechnicalSnapshotLimitError();
      }
      if (isErrorCode(error, 'ENOENT') || isErrorCode(error, 'EACCES')) {
        return { available: false };
      }
      throw new TechnicalSnapshotError();
    }

    if (statusResult.exitCode !== 0) {
      return { available: false };
    }
    if (Buffer.byteLength(statusResult.stdout, 'utf8') > this.#limits.maxGitOutputBytes) {
      throw new TechnicalSnapshotLimitError();
    }
    const files = parseGitStatus(statusResult.stdout, this.#limits.maxRelativePathBytes);

    let headCommit: string | undefined;
    try {
      const headResult = await this.#gitCommandRunner.run(
        sourceRoot,
        [...GIT_HEAD_ARGUMENTS],
        this.#limits.maxGitOutputBytes,
      );
      if (headResult.exitCode === 0) {
        if (Buffer.byteLength(headResult.stdout, 'utf8') > this.#limits.maxGitOutputBytes) {
          throw new TechnicalSnapshotLimitError();
        }
        const candidate = headResult.stdout.trim();
        if (!/^[0-9a-fA-F]{40,64}$/u.test(candidate)) {
          throw new TechnicalSnapshotError();
        }
        headCommit = candidate.toLowerCase();
      }
    } catch (error) {
      if (error instanceof TechnicalSnapshotLimitError || error instanceof TechnicalSnapshotError) {
        throw error;
      }
      if (error instanceof GitOutputLimitError) {
        throw new TechnicalSnapshotLimitError();
      }
      if (!isErrorCode(error, 'ENOENT') && !isErrorCode(error, 'EACCES')) {
        throw new TechnicalSnapshotError();
      }
    }

    return {
      available: true,
      ...(headCommit === undefined ? {} : { headCommit }),
      files,
    };
  }
}
