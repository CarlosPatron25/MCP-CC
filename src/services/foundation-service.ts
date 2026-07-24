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
    name:
      | 'health_check'
      | 'get_server_capabilities'
      | 'initialize_workspace'
      | 'create_work_item'
      | 'initialize_work_item_documents'
      | 'get_work_item_document'
      | 'update_work_item_document'
      | 'refresh_ai_context'
      | 'initialize_work_item_tracking'
      | 'record_decision'
      | 'record_checkpoint'
      | 'define_test_plan'
      | 'record_test_execution'
      | 'register_evidence_reference'
      | 'get_work_item_tracking';
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
      ],
      notImplemented: [
        'close_work_item',
        'reopen_work_item',
        'rally-integration',
        'copado-integration',
      ],
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
