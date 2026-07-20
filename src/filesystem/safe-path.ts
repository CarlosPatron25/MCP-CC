import { isAbsolute, relative, resolve } from 'node:path';

import { PathSecurityError } from '../errors/workspace-error.js';

export function resolvePathWithinRoot(workspaceRoot: string, ...segments: string[]): string {
  const resolvedRoot = resolve(workspaceRoot);
  const candidate = resolve(resolvedRoot, ...segments);
  const relativePath = relative(resolvedRoot, candidate);

  if (
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    relativePath.startsWith('..\\') ||
    isAbsolute(relativePath)
  ) {
    throw new PathSecurityError('Resolved path is outside the authorized workspace root.');
  }

  return candidate;
}
