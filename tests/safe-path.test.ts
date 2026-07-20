import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PathSecurityError } from '../src/errors/workspace-error.js';
import { resolvePathWithinRoot } from '../src/filesystem/safe-path.js';

describe('resolvePathWithinRoot', () => {
  it('resolves a child path inside the authorized root', () => {
    const root = resolve('safe-root');

    expect(resolvePathWithinRoot(root, '.ws-workspace', 'active')).toBe(
      resolve(root, '.ws-workspace', 'active'),
    );
  });

  it('rejects traversal outside the authorized root', () => {
    const root = resolve('safe-root');

    expect(() => resolvePathWithinRoot(root, '..', 'outside')).toThrow(PathSecurityError);
  });

  it('rejects an absolute path outside the authorized root', () => {
    const root = resolve('safe-root');
    const outside = resolve(root, '..', 'outside');

    expect(() => resolvePathWithinRoot(root, outside)).toThrow(PathSecurityError);
  });
});
