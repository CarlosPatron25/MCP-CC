export type WorkspaceErrorCode =
  | 'CONFIGURATION_INVALID'
  | 'WORKSPACE_CONFIGURATION_INVALID'
  | 'DOCUMENT_RENDERING_SNAPSHOT_INVALID'
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
  | 'MANIFEST_UPDATE_FAILED'
  | 'AUDIT_TRACKING_NOT_INITIALIZED'
  | 'AUDIT_ENTRY_VALIDATION_FAILED'
  | 'AUDIT_IDEMPOTENCY_CONFLICT'
  | 'AUDIT_REVISION_CONFLICT'
  | 'TEST_PLAN_REVISION_CONFLICT'
  | 'TEST_PLAN_CONFLICT'
  | 'AUDIT_ENTRY_NOT_FOUND'
  | 'TEST_CASE_NOT_FOUND'
  | 'EVIDENCE_REFERENCE_DUPLICATE'
  | 'AUDIT_TRACKING_CONFLICT'
  | 'AUDIT_LEDGER_CORRUPT'
  | 'AUDIT_TRACKING_UPDATE_FAILED';

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

export class WorkspaceConfigurationInvalidError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('WORKSPACE_CONFIGURATION_INVALID', message, details);
    this.name = 'WorkspaceConfigurationInvalidError';
  }
}

export class DocumentRenderingSnapshotInvalidError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('DOCUMENT_RENDERING_SNAPSHOT_INVALID', message, details);
    this.name = 'DocumentRenderingSnapshotInvalidError';
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

export class AuditTrackingNotInitializedError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('AUDIT_TRACKING_NOT_INITIALIZED', message, details);
    this.name = 'AuditTrackingNotInitializedError';
  }
}

export class AuditEntryValidationError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('AUDIT_ENTRY_VALIDATION_FAILED', message, details);
    this.name = 'AuditEntryValidationError';
  }
}

export class AuditIdempotencyConflictError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('AUDIT_IDEMPOTENCY_CONFLICT', message, details);
    this.name = 'AuditIdempotencyConflictError';
  }
}

export class AuditRevisionConflictError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('AUDIT_REVISION_CONFLICT', message, details);
    this.name = 'AuditRevisionConflictError';
  }
}

export class TestPlanRevisionConflictError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('TEST_PLAN_REVISION_CONFLICT', message, details);
    this.name = 'TestPlanRevisionConflictError';
  }
}

export class TestPlanConflictError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('TEST_PLAN_CONFLICT', message, details);
    this.name = 'TestPlanConflictError';
  }
}

export class AuditEntryNotFoundError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('AUDIT_ENTRY_NOT_FOUND', message, details);
    this.name = 'AuditEntryNotFoundError';
  }
}

export class TestCaseNotFoundError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('TEST_CASE_NOT_FOUND', message, details);
    this.name = 'TestCaseNotFoundError';
  }
}

export class EvidenceReferenceDuplicateError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('EVIDENCE_REFERENCE_DUPLICATE', message, details);
    this.name = 'EvidenceReferenceDuplicateError';
  }
}

export class AuditTrackingConflictError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('AUDIT_TRACKING_CONFLICT', message, details);
    this.name = 'AuditTrackingConflictError';
  }
}

export class AuditLedgerCorruptError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('AUDIT_LEDGER_CORRUPT', message, details);
    this.name = 'AuditLedgerCorruptError';
  }
}

export class AuditTrackingUpdateError extends WorkspaceError {
  public constructor(message: string, details?: Record<string, string>) {
    super('AUDIT_TRACKING_UPDATE_FAILED', message, details);
    this.name = 'AuditTrackingUpdateError';
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
