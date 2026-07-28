import { mkdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  diffTechnicalSnapshotFiles,
  netTechnicalSnapshotChanges,
} from '../src/domain/technical-snapshot.js';
import {
  type GitCommandResult,
  type GitCommandRunner,
  LocalProjectObservationAdapter,
} from '../src/filesystem/local-project-observation-adapter.js';
import {
  ProjectSourceConfigurationError,
  TechnicalSnapshotLimitError,
  type ProjectObservationLimits,
} from '../src/services/project-observation.js';
import { createTemporaryWorkspaceRoot, removeTemporaryWorkspaceRoot } from './helpers.js';

const temporaryRoots: string[] = [];

const absentGitCommandRunner = {
  run: async (): Promise<GitCommandResult> => {
    throw Object.assign(new Error('Git is not installed.'), { code: 'ENOENT' });
  },
} satisfies GitCommandRunner;

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryRoots.splice(0).map(removeTemporaryWorkspaceRoot));
});

async function createSourceRoot(): Promise<string> {
  const root = await createTemporaryWorkspaceRoot();
  temporaryRoots.push(root);
  return root;
}

function observer(
  projectSourceRoot: string,
  limits?: Partial<ProjectObservationLimits>,
  gitCommandRunner: GitCommandRunner = absentGitCommandRunner,
): LocalProjectObservationAdapter {
  return new LocalProjectObservationAdapter({
    projectSourceRoot,
    ...(limits === undefined ? {} : { limits }),
    gitCommandRunner,
  });
}

describe('LocalProjectObservationAdapter', () => {
  it('classifies added, modified, deleted, unchanged and reverted paths by hash', async () => {
    const root = await createSourceRoot();
    await writeFile(join(root, 'stable.txt'), 'stable\n', 'utf8');
    await writeFile(join(root, 'modified.txt'), 'baseline\n', 'utf8');
    await writeFile(join(root, 'deleted.txt'), 'delete me\n', 'utf8');
    await writeFile(join(root, 'reverted.txt'), 'original\n', 'utf8');
    const adapter = observer(root);
    const baseline = await adapter.capture();

    await writeFile(join(root, 'modified.txt'), 'intermediate\n', 'utf8');
    await writeFile(join(root, 'reverted.txt'), 'intermediate\n', 'utf8');
    await writeFile(join(root, 'ephemeral.txt'), 'temporary\n', 'utf8');
    const previous = await adapter.capture();

    await writeFile(join(root, 'modified.txt'), 'final\n', 'utf8');
    await unlink(join(root, 'deleted.txt'));
    await writeFile(join(root, 'reverted.txt'), 'original\n', 'utf8');
    await unlink(join(root, 'ephemeral.txt'));
    await writeFile(join(root, 'added.txt'), 'new\n', 'utf8');
    const current = await adapter.capture();

    const changes = diffTechnicalSnapshotFiles(current.files, previous.files, baseline.files);
    expect(
      Object.fromEntries(changes.map((change) => [change.relativePath, change.changeType])),
    ).toEqual({
      'added.txt': 'ADDED',
      'deleted.txt': 'DELETED',
      'ephemeral.txt': 'REVERTED',
      'modified.txt': 'MODIFIED',
      'reverted.txt': 'REVERTED',
      'stable.txt': 'UNCHANGED',
    });
    expect(netTechnicalSnapshotChanges(changes).map((change) => change.relativePath)).toEqual([
      'added.txt',
      'deleted.txt',
      'modified.txt',
    ]);
  });

  it('walks deterministically with POSIX paths and excludes approved directories', async () => {
    const root = await createSourceRoot();
    await mkdir(join(root, 'a', 'nested'), { recursive: true });
    await writeFile(join(root, 'z.txt'), 'z\n', 'utf8');
    await writeFile(join(root, 'a', 'nested', 'file.txt'), 'a\n', 'utf8');

    const excludedDirectories = [
      ['.git'],
      ['.ws-workspace'],
      ['node_modules'],
      ['dist'],
      ['coverage'],
      ['a', 'nested', 'dist'],
    ];
    for (const segments of excludedDirectories) {
      const directory = join(root, ...segments);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'secret.txt'), 'must not be observed\n', 'utf8');
    }

    const adapter = observer(root);
    const first = await adapter.capture();
    const second = await adapter.capture();

    expect(second).toEqual(first);
    expect(first.files.map((file) => file.relativePath)).toEqual(['a/nested/file.txt', 'z.txt']);
    expect(first.exclusions).toEqual([
      { relativePath: '.git', reason: 'EXCLUDED_DIRECTORY' },
      { relativePath: '.ws-workspace', reason: 'EXCLUDED_DIRECTORY' },
      { relativePath: 'a/nested/dist', reason: 'EXCLUDED_DIRECTORY' },
      { relativePath: 'coverage', reason: 'EXCLUDED_DIRECTORY' },
      { relativePath: 'dist', reason: 'EXCLUDED_DIRECTORY' },
      { relativePath: 'node_modules', reason: 'EXCLUDED_DIRECTORY' },
    ]);
    expect(JSON.stringify(first)).not.toContain(root);
    expect(JSON.stringify(first)).not.toContain('must not be observed');
  });

  it('records a filesystem link without following it outside the source root', async (context) => {
    const root = await createSourceRoot();
    const outsideRoot = await createSourceRoot();
    await writeFile(join(outsideRoot, 'outside-secret.txt'), 'outside\n', 'utf8');
    const linkPath = join(root, 'linked-directory');

    try {
      await symlink(outsideRoot, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        ['EPERM', 'EACCES', 'ENOSYS'].includes(String(error.code))
      ) {
        context.skip();
        return;
      }
      throw error;
    }

    const result = await observer(root).capture();

    expect(result.files).toEqual([]);
    expect(result.exclusions).toEqual([
      { relativePath: 'linked-directory', reason: 'FILESYSTEM_LINK' },
    ]);
    expect(JSON.stringify(result)).not.toContain(outsideRoot);
    expect(JSON.stringify(result)).not.toContain('outside-secret.txt');
  });

  it('fails the whole capture when an injected traversal or byte limit is exceeded', async () => {
    const root = await createSourceRoot();
    await writeFile(join(root, 'a.txt'), '1234', 'utf8');
    await writeFile(join(root, 'b.txt'), '5678', 'utf8');
    const gitRunner = {
      run: vi.fn<GitCommandRunner['run']>(),
    } satisfies GitCommandRunner;

    await expect(observer(root, { maxEntries: 1 }, gitRunner).capture()).rejects.toBeInstanceOf(
      TechnicalSnapshotLimitError,
    );
    expect(gitRunner.run).not.toHaveBeenCalled();

    await expect(observer(root, { maxTotalBytes: 3 }, gitRunner).capture()).rejects.toBeInstanceOf(
      TechnicalSnapshotLimitError,
    );
    expect(gitRunner.run).not.toHaveBeenCalled();
  });

  it('keeps a file snapshot valid when Git is absent', async () => {
    const root = await createSourceRoot();
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'index.ts'), 'export {};\n', 'utf8');

    const result = await observer(root).capture();

    expect(result.git).toEqual({ available: false });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      relativePath: 'src/index.ts',
      size: 11,
    });
    expect(result.files[0]?.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it('uses fixed local-only Git commands and returns only relative paths', async () => {
    const root = await createSourceRoot();
    await writeFile(join(root, 'tracked.txt'), 'tracked\n', 'utf8');
    const calls: Array<{
      sourceRoot: string;
      arguments_: readonly string[];
      maxOutputBytes: number;
    }> = [];
    const gitRunner: GitCommandRunner = {
      run: async (sourceRoot, arguments_, maxOutputBytes) => {
        calls.push({ sourceRoot, arguments_, maxOutputBytes });
        if (arguments_.includes('status')) {
          return {
            exitCode: 0,
            stdout: ' M src/app.ts\0R  renamed.ts\0old.ts\0?? node_modules/secret.txt\0',
          };
        }
        return { exitCode: 0, stdout: `${'A'.repeat(40)}\n` };
      },
    };

    const result = await observer(root, undefined, gitRunner).capture();

    expect(result.git).toEqual({
      available: true,
      headCommit: 'a'.repeat(40),
      files: [
        {
          relativePath: 'renamed.ts',
          originalRelativePath: 'old.ts',
          status: 'R ',
        },
        { relativePath: 'src/app.ts', status: ' M' },
      ],
    });
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.sourceRoot === root)).toBe(true);
    expect(
      calls.every(
        (call) =>
          call.arguments_.includes('core.fsmonitor=false') &&
          call.arguments_.includes('core.untrackedCache=false') &&
          !call.arguments_.some((argument) =>
            ['remote', 'fetch', 'pull', 'push', 'ls-remote'].includes(argument),
          ),
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it('rejects relative, missing, volume-root and linked source roots without leaking them', async () => {
    const root = await createSourceRoot();
    const missingRoot = join(root, 'missing-source-root');
    const volumeRoot = parse(root).root;

    for (const invalidRoot of ['relative/source', missingRoot, volumeRoot]) {
      let capturedError: unknown;
      try {
        await observer(invalidRoot).capture();
      } catch (error) {
        capturedError = error;
      }
      expect(capturedError).toBeInstanceOf(ProjectSourceConfigurationError);
      expect(String(capturedError)).not.toContain(invalidRoot);
      expect(String(capturedError)).not.toContain(root);
    }

    const linkedRoot = join(root, 'linked-root');
    try {
      await symlink(
        await createSourceRoot(),
        linkedRoot,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        ['EPERM', 'EACCES', 'ENOSYS'].includes(String(error.code))
      ) {
        return;
      }
      throw error;
    }

    await expect(observer(linkedRoot).capture()).rejects.toBeInstanceOf(
      ProjectSourceConfigurationError,
    );
  });
});
