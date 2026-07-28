import { AUDIT_ARTIFACT_RELATIVE_PATHS } from '../domain/work-item-audit.js';
import { MANAGED_DOCUMENT_RELATIVE_PATHS } from '../domain/work-item-document.js';
import { WORK_ITEM_TYPES } from '../domain/work-item.js';

export const KNOWLEDGE_BASE_RELATIVE_PATH = 'records/KNOWLEDGE_BASE.json' as const;

const SAFE_WORK_ITEM_ID = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const SAFE_STORAGE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const M5_DOSSIER_ARTIFACTS = [
  'WORK_ITEM.yml',
  '00_MANIFEST.md',
  '09_FINAL_REPORT.md',
  '10_FUNCTIONAL_OVERVIEW.md',
  '11_IMPLEMENTATION.md',
  '12_TESTING.md',
] as const;

/**
 * Closed recovery allowlist for every transaction whose journal is scoped to
 * one Work Item dossier. This lets any historical adapter safely finish or
 * roll back an abandoned M3/M4 transaction before M5 reads the same dossier.
 */
export const ALL_DOSSIER_TRANSACTION_RELATIVE_PATHS = [
  ...new Set([
    'WORK_ITEM.yml',
    ...Object.values(MANAGED_DOCUMENT_RELATIVE_PATHS),
    ...AUDIT_ARTIFACT_RELATIVE_PATHS,
    ...M5_DOSSIER_ARTIFACTS,
  ]),
] as const;

/**
 * Accepts only the frozen legacy layout or the M5 iteration/type layout and
 * one artifact from the closed transaction set. This is also used to validate
 * bootstrap paths whose dossier does not exist yet.
 */
export function isAllowedWorkspaceTransactionRelativePath(relativePath: string): boolean {
  if (relativePath === KNOWLEDGE_BASE_RELATIVE_PATH) {
    return true;
  }
  if (
    relativePath.length === 0 ||
    relativePath.includes('\\') ||
    relativePath.startsWith('/') ||
    relativePath.endsWith('/')
  ) {
    return false;
  }

  const artifact = ALL_DOSSIER_TRANSACTION_RELATIVE_PATHS.find((candidate) =>
    relativePath.endsWith(`/${candidate}`),
  );
  if (artifact === undefined) {
    return false;
  }

  const prefix = relativePath.slice(0, -(artifact.length + 1));
  const segments = prefix.split('/');
  if (
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..') ||
    segments[0] !== 'active'
  ) {
    return false;
  }
  if (segments.length === 2) {
    return SAFE_WORK_ITEM_ID.test(segments[1] ?? '');
  }
  return (
    segments.length === 4 &&
    SAFE_STORAGE_SEGMENT.test(segments[1] ?? '') &&
    (WORK_ITEM_TYPES as readonly string[]).includes(segments[2] ?? '') &&
    SAFE_WORK_ITEM_ID.test(segments[3] ?? '')
  );
}
