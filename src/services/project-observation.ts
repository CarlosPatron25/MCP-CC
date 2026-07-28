import type { TechnicalSnapshotObservation } from '../domain/technical-snapshot.js';

export const DEFAULT_PROJECT_OBSERVATION_LIMITS = {
  maxEntries: 100_000,
  maxRelativePathBytes: 512,
  maxTotalBytes: 5 * 1024 * 1024 * 1024,
  maxGitOutputBytes: 16 * 1024 * 1024,
} as const;

export interface ProjectObservationLimits {
  maxEntries: number;
  maxRelativePathBytes: number;
  maxTotalBytes: number;
  maxGitOutputBytes: number;
}

export interface ProjectObservation {
  capture(): Promise<TechnicalSnapshotObservation>;
}

export type ProjectObservationErrorCode =
  | 'PROJECT_SOURCE_CONFIGURATION_INVALID'
  | 'TECHNICAL_SNAPSHOT_FAILED'
  | 'TECHNICAL_SNAPSHOT_LIMIT_EXCEEDED';

export class ProjectObservationError extends Error {
  public constructor(
    public readonly code: ProjectObservationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectObservationError';
  }
}

export class ProjectSourceConfigurationError extends ProjectObservationError {
  public constructor() {
    super(
      'PROJECT_SOURCE_CONFIGURATION_INVALID',
      'The project source root is not configured as a safe readable directory.',
    );
    this.name = 'ProjectSourceConfigurationError';
  }
}

export class TechnicalSnapshotError extends ProjectObservationError {
  public constructor() {
    super('TECHNICAL_SNAPSHOT_FAILED', 'The technical snapshot could not be captured safely.');
    this.name = 'TechnicalSnapshotError';
  }
}

export class TechnicalSnapshotLimitError extends ProjectObservationError {
  public constructor() {
    super(
      'TECHNICAL_SNAPSHOT_LIMIT_EXCEEDED',
      'The technical snapshot exceeds an approved observation limit.',
    );
    this.name = 'TechnicalSnapshotLimitError';
  }
}
