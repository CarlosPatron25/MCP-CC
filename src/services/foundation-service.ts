import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename } from 'node:path';

import type { WorkspaceConfig } from '../config/workspace-config.js';
import { WORK_ITEM_TYPES } from '../domain/work-item.js';
import {
  FilesystemAccessError,
  type StructuredError,
  toStructuredError,
} from '../errors/workspace-error.js';
import {
  initializeWorkspace,
  type WorkspaceInitializationResult,
} from '../filesystem/workspace-initializer.js';

export const SERVER_NAME = 'ws-workspace-mcp';
export const SERVER_VERSION = '0.1.0';
export const SCHEMA_VERSION = '1.0.0';

export interface HealthCheckResult {
  serverName: string;
  version: string;
  status: 'ok';
  checkedAt: string;
  nodeVersion: string;
  authorizedRoot: {
    displayName: string;
    absolutePathHidden: true;
  };
  filesystemAccess: 'read-write';
}

export interface ServerCapabilitiesResult {
  schemaVersion: string;
  capabilities: string[];
  availableTools: Array<{
    name: string;
    mutatesFilesystem: boolean;
  }>;
  notImplemented: string[];
  supportedWorkItemTypes: readonly string[];
}

export class FoundationService {
  public constructor(private readonly config: WorkspaceConfig) {}

  public async healthCheck(): Promise<HealthCheckResult> {
    try {
      await access(this.config.workspaceRoot, constants.R_OK | constants.W_OK);
    } catch {
      throw new FilesystemAccessError('The authorized workspace root is no longer accessible.');
    }

    return {
      serverName: SERVER_NAME,
      version: SERVER_VERSION,
      status: 'ok',
      checkedAt: new Date().toISOString(),
      nodeVersion: process.version,
      authorizedRoot: {
        displayName: basename(this.config.workspaceRoot) || 'filesystem-root',
        absolutePathHidden: true,
      },
      filesystemAccess: 'read-write',
    };
  }

  public getServerCapabilities(): ServerCapabilitiesResult {
    return {
      schemaVersion: SCHEMA_VERSION,
      capabilities: [
        'local-stdio-mcp',
        'secure-workspace-initialization',
        'foundation-work-item-domain-model',
        'secure-work-item-creation',
        'controlled-document-lifecycle',
        'document-revision-control',
        'derived-ai-context-projection',
        'append-only-audit-tracking',
        'idempotent-audit-mutations',
        'versioned-test-planning',
        'controlled-evidence-references',
        'crash-recoverable-multi-file-commits',
        'living-project-knowledge-base',
        'declared-participant-workflow',
        'single-active-developer-session',
        'deterministic-read-only-technical-snapshots',
        'work-item-relations-and-project-concepts',
        'review-complete-reopen-lifecycle',
      ],
      availableTools: [
        { name: 'health_check', mutatesFilesystem: false },
        { name: 'get_server_capabilities', mutatesFilesystem: false },
        { name: 'initialize_workspace', mutatesFilesystem: true },
        { name: 'create_work_item', mutatesFilesystem: true },
        { name: 'initialize_work_item_documents', mutatesFilesystem: true },
        { name: 'get_work_item_document', mutatesFilesystem: false },
        { name: 'update_work_item_document', mutatesFilesystem: true },
        { name: 'refresh_ai_context', mutatesFilesystem: true },
        { name: 'initialize_work_item_tracking', mutatesFilesystem: true },
        { name: 'record_decision', mutatesFilesystem: true },
        { name: 'record_checkpoint', mutatesFilesystem: true },
        { name: 'define_test_plan', mutatesFilesystem: true },
        { name: 'record_test_execution', mutatesFilesystem: true },
        { name: 'register_evidence_reference', mutatesFilesystem: true },
        { name: 'get_work_item_tracking', mutatesFilesystem: false },
        { name: 'create_work_item_v2', mutatesFilesystem: true },
        { name: 'initialize_work_item_workflow', mutatesFilesystem: true },
        { name: 'get_work_item_workflow', mutatesFilesystem: false },
        { name: 'activate_work_session', mutatesFilesystem: true },
        { name: 'switch_work_session', mutatesFilesystem: true },
        { name: 'record_session_checkpoint', mutatesFilesystem: true },
        { name: 'suspend_work_session', mutatesFilesystem: true },
        { name: 'get_active_work_session', mutatesFilesystem: false },
        { name: 'resume_work_session_context', mutatesFilesystem: false },
        { name: 'add_work_item_collaborator', mutatesFilesystem: true },
        { name: 'remove_work_item_collaborator', mutatesFilesystem: true },
        { name: 'transfer_work_item_responsibility', mutatesFilesystem: true },
        { name: 'add_work_item_relation', mutatesFilesystem: true },
        { name: 'remove_work_item_relation', mutatesFilesystem: true },
        { name: 'propose_project_concept', mutatesFilesystem: true },
        { name: 'resolve_project_concept_proposal', mutatesFilesystem: true },
        { name: 'consolidate_work_item_dossier', mutatesFilesystem: true },
        { name: 'review_work_item', mutatesFilesystem: true },
        { name: 'resolve_semantic_observation', mutatesFilesystem: true },
        { name: 'complete_work_item', mutatesFilesystem: true },
        { name: 'cancel_work_item', mutatesFilesystem: true },
        { name: 'reopen_work_item', mutatesFilesystem: true },
        { name: 'get_related_knowledge', mutatesFilesystem: false },
      ],
      notImplemented: ['rally-integration', 'copado-integration', 'shared-knowledge-service'],
      supportedWorkItemTypes: WORK_ITEM_TYPES,
    };
  }

  public async initializeWorkspace(): Promise<WorkspaceInitializationResult> {
    return initializeWorkspace(this.config.workspaceRoot);
  }

  public serializeError(error: unknown): StructuredError {
    return toStructuredError(error);
  }
}
