export const TECHNICAL_SNAPSHOT_CHANGE_TYPES = [
  'ADDED',
  'MODIFIED',
  'DELETED',
  'UNCHANGED',
  'REVERTED',
] as const;

export type TechnicalSnapshotChangeType = (typeof TECHNICAL_SNAPSHOT_CHANGE_TYPES)[number];

export const TECHNICAL_SNAPSHOT_EXCLUSION_REASONS = [
  'EXCLUDED_DIRECTORY',
  'FILESYSTEM_LINK',
  'NON_REGULAR_ENTRY',
] as const;

export type TechnicalSnapshotExclusionReason =
  (typeof TECHNICAL_SNAPSHOT_EXCLUSION_REASONS)[number];

export interface TechnicalSnapshotFile {
  relativePath: string;
  sha256: string;
  size: number;
  modifiedAt: string;
}

export interface TechnicalSnapshotExclusion {
  relativePath: string;
  reason: TechnicalSnapshotExclusionReason;
}

export interface TechnicalSnapshotGitFile {
  relativePath: string;
  status: string;
  originalRelativePath?: string;
}

export type TechnicalSnapshotGitObservation =
  | {
      available: false;
    }
  | {
      available: true;
      headCommit?: string;
      files: TechnicalSnapshotGitFile[];
    };

/**
 * Objective observation returned by the read-only source adapter. IDs,
 * session linkage and capture timestamps belong to the application operation
 * that appends this value to the M5 knowledge base.
 */
export interface TechnicalSnapshotObservation {
  files: TechnicalSnapshotFile[];
  exclusions: TechnicalSnapshotExclusion[];
  totalBytes: number;
  git: TechnicalSnapshotGitObservation;
}

export interface TechnicalSnapshotChange {
  relativePath: string;
  changeType: TechnicalSnapshotChangeType;
  previousSha256?: string;
  currentSha256?: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function indexedFiles(
  files: readonly TechnicalSnapshotFile[],
): ReadonlyMap<string, TechnicalSnapshotFile> {
  return new Map(files.map((file) => [file.relativePath, file]));
}

function hashesMatch(
  left: TechnicalSnapshotFile | undefined,
  right: TechnicalSnapshotFile | undefined,
): boolean {
  return left?.sha256 === right?.sha256;
}

function optionalHashes(
  previous: TechnicalSnapshotFile | undefined,
  current: TechnicalSnapshotFile | undefined,
): Omit<TechnicalSnapshotChange, 'relativePath' | 'changeType'> {
  return {
    ...(previous === undefined ? {} : { previousSha256: previous.sha256 }),
    ...(current === undefined ? {} : { currentSha256: current.sha256 }),
  };
}

/**
 * Compares the current observation with the immediately previous observation
 * and the session baseline. Returning to the baseline after an intermediate
 * change is REVERTED, including add-then-remove and delete-then-restore.
 */
export function diffTechnicalSnapshotFiles(
  currentFiles: readonly TechnicalSnapshotFile[],
  previousFiles: readonly TechnicalSnapshotFile[],
  baselineFiles: readonly TechnicalSnapshotFile[] = previousFiles,
): TechnicalSnapshotChange[] {
  const current = indexedFiles(currentFiles);
  const previous = indexedFiles(previousFiles);
  const baseline = indexedFiles(baselineFiles);
  const paths = [...new Set([...current.keys(), ...previous.keys(), ...baseline.keys()])].sort(
    compareText,
  );

  return paths.flatMap((relativePath): TechnicalSnapshotChange[] => {
    const currentFile = current.get(relativePath);
    const previousFile = previous.get(relativePath);
    const baselineFile = baseline.get(relativePath);

    if (currentFile === undefined && previousFile === undefined) {
      return [];
    }

    let changeType: TechnicalSnapshotChangeType;
    if (currentFile !== undefined && previousFile !== undefined) {
      if (hashesMatch(currentFile, previousFile)) {
        changeType = 'UNCHANGED';
      } else if (baselineFile !== undefined && hashesMatch(currentFile, baselineFile)) {
        changeType = 'REVERTED';
      } else {
        changeType = 'MODIFIED';
      }
    } else if (currentFile !== undefined) {
      changeType =
        baselineFile !== undefined && hashesMatch(currentFile, baselineFile) ? 'REVERTED' : 'ADDED';
    } else {
      changeType = baselineFile === undefined ? 'REVERTED' : 'DELETED';
    }

    return [
      {
        relativePath,
        changeType,
        ...optionalHashes(previousFile, currentFile),
      },
    ];
  });
}

/** Changes suitable for final implementation projections. */
export function netTechnicalSnapshotChanges(
  changes: readonly TechnicalSnapshotChange[],
): TechnicalSnapshotChange[] {
  return changes.filter(
    (change) => change.changeType !== 'UNCHANGED' && change.changeType !== 'REVERTED',
  );
}
