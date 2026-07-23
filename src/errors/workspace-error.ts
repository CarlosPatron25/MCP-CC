export type WorkspaceErrorCode =
  | 'CONFIGURATION_INVALID'
  | 'FILESYSTEM_ACCESS_DENIED'
  | 'PATH_OUTSIDE_WORKSPACE'
  | 'WORKSPACE_INITIALIZATION_FAILED'
  | 'WORKSPACE_NOT_INITIALIZED'
  | 'WORK_ITEM_VALIDATION_FAILED'
  | 'WORK_ITEM_ALREADY_EXISTS'
  | 'WORK_ITEM_CREATION_FAILED'
  | 'WORK_ITEM_NOT_FOUND'
  | 'DOCUMENT_TYPE_UNSUPPORTED'
  | 'DOCUMENT_NOT_INITIALIZED'
  | 'DOCUMENT_ALREADY_EXISTS'
  | 'DOCUMENT_VALIDATION_FAILED'
  | 'DOCUMENT_REVISION_CONFLICT'
  | 'DOCUMENT_LIFECYCLE_CONFLICT'
  | 'DOCUMENT_UPDATE_FAILED'
  | 'MANIFEST_UPDATE_FAILED';

export interface StructuredError {
  error: {
    code: WorkspaceErrorCode | 'UNEXPECTED_ERROR';
    message: string;
    details?: Record<string, string>;
  };
}

export class WorkspaceError extends Error {
  public constructor(
    public readonly code: WorkspaceErrorCode,
    message: string,
    public readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

export class ConfigurationError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('CONFIGURATION_INVALID', message, details);
    this.name = 'ConfigurationError';
  }
}

export class FilesystemAccessError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('FILESYSTEM_ACCESS_DENIED', message, details);
    this.name = 'FilesystemAccessError';
  }
}

export class PathSecurityError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('PATH_OUTSIDE_WORKSPACE', message, details);
    this.name = 'PathSecurityError';
  }
}

export class WorkspaceInitializationError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('WORKSPACE_INITIALIZATION_FAILED', message, details);
    this.name = 'WorkspaceInitializationError';
  }
}

export class WorkspaceNotInitializedError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('WORKSPACE_NOT_INITIALIZED', message, details);
    this.name = 'WorkspaceNotInitializedError';
  }
}

export class WorkItemValidationError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('WORK_ITEM_VALIDATION_FAILED', message, details);
    this.name = 'WorkItemValidationError';
  }
}

export class WorkItemAlreadyExistsError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('WORK_ITEM_ALREADY_EXISTS', message, details);
    this.name = 'WorkItemAlreadyExistsError';
  }
}

export class WorkItemCreationError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('WORK_ITEM_CREATION_FAILED', message, details);
    this.name = 'WorkItemCreationError';
  }
}

export class WorkItemNotFoundError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('WORK_ITEM_NOT_FOUND', message, details);
    this.name = 'WorkItemNotFoundError';
  }
}

export class DocumentTypeUnsupportedError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('DOCUMENT_TYPE_UNSUPPORTED', message, details);
    this.name = 'DocumentTypeUnsupportedError';
  }
}

export class DocumentNotInitializedError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('DOCUMENT_NOT_INITIALIZED', message, details);
    this.name = 'DocumentNotInitializedError';
  }
}

export class DocumentAlreadyExistsError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('DOCUMENT_ALREADY_EXISTS', message, details);
    this.name = 'DocumentAlreadyExistsError';
  }
}

export class DocumentValidationError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('DOCUMENT_VALIDATION_FAILED', message, details);
    this.name = 'DocumentValidationError';
  }
}

export class DocumentRevisionConflictError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('DOCUMENT_REVISION_CONFLICT', message, details);
    this.name = 'DocumentRevisionConflictError';
  }
}

export class DocumentLifecycleConflictError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('DOCUMENT_LIFECYCLE_CONFLICT', message, details);
    this.name = 'DocumentLifecycleConflictError';
  }
}

export class DocumentUpdateError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('DOCUMENT_UPDATE_FAILED', message, details);
    this.name = 'DocumentUpdateError';
  }
}

export class ManifestUpdateError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('MANIFEST_UPDATE_FAILED', message, details);
    this.name = 'ManifestUpdateError';
  }
}

export function toStructuredError(error: unknown): StructuredError {
  if (error instanceof WorkspaceError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    };
  }

  return {
    error: {
      code: 'UNEXPECTED_ERROR',
      message: 'An unexpected error occurred while processing the request.',
    },
  };
}
