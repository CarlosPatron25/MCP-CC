import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import type { WorkspaceConfig } from '../config/workspace-config.js';
import { LocalFilesystemWorkItemDossierRepository } from '../filesystem/local-filesystem-work-item-dossier-repository.js';
import { AIContextProjectionService } from '../services/ai-context-projection-service.js';
import { SystemClock } from '../services/clock.js';
import { DocumentTemplateService } from '../services/document-template-service.js';
import { FoundationService, SERVER_NAME, SERVER_VERSION } from '../services/foundation-service.js';
import { ManifestLifecycleService } from '../services/manifest-lifecycle-service.js';
import {
  CREATE_WORK_ITEM_INPUT_SCHEMA,
  WorkItemCreationService,
} from '../services/work-item-creation-service.js';
import { WorkItemDocumentService } from '../services/work-item-document-service.js';

const EMPTY_INPUT = z.object({}).strict();
const INITIALIZE_DOCUMENTS_INPUT = z.object({ workItemId: z.unknown() }).passthrough();
const GET_DOCUMENT_INPUT = z
  .object({ workItemId: z.unknown(), documentType: z.unknown() })
  .passthrough();
const UPDATE_DOCUMENT_INPUT = z
  .object({
    workItemId: z.unknown(),
    documentType: z.unknown(),
    expectedRevision: z.unknown(),
    payload: z.unknown(),
  })
  .passthrough();
const REFRESH_AI_CONTEXT_INPUT = z
  .object({ workItemId: z.unknown(), expectedRevision: z.unknown() })
  .passthrough();

function asToolResult(payload: unknown, isError = false) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

export function createMcpServer(config: WorkspaceConfig): McpServer {
  const foundationService = new FoundationService(config);
  const workItemCreationService = new WorkItemCreationService(config);
  const workItemDocumentService = new WorkItemDocumentService(
    new LocalFilesystemWorkItemDossierRepository({ workspaceRoot: config.workspaceRoot }),
    new DocumentTemplateService(),
    new ManifestLifecycleService(new SystemClock()),
    new AIContextProjectionService(),
  );
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      instructions:
        'WS Workspace MCP provides secure local Work Item creation and controlled document lifecycle tools. Do not assume later lifecycle tools exist.',
    },
  );

  server.registerTool(
    'health_check',
    {
      description: 'Return read-only server and authorized-filesystem health information.',
      inputSchema: EMPTY_INPUT,
    },
    async () => {
      try {
        return asToolResult(await foundationService.healthCheck());
      } catch (error) {
        return asToolResult(foundationService.serializeError(error), true);
      }
    },
  );

  server.registerTool(
    'get_server_capabilities',
    {
      description: 'Return the currently available and explicitly deferred MCP capabilities.',
      inputSchema: EMPTY_INPUT,
    },
    () => asToolResult(foundationService.getServerCapabilities()),
  );

  server.registerTool(
    'initialize_workspace',
    {
      description:
        'Safely and idempotently create .ws-workspace under the configured authorized root.',
      inputSchema: EMPTY_INPUT,
    },
    async () => {
      try {
        return asToolResult(await foundationService.initializeWorkspace());
      } catch (error) {
        return asToolResult(foundationService.serializeError(error), true);
      }
    },
  );

  server.registerTool(
    'create_work_item',
    {
      description:
        'Validate and create a DRAFT Work Item dossier inside the initialized authorized workspace.',
      inputSchema: CREATE_WORK_ITEM_INPUT_SCHEMA,
    },
    async (input) => {
      try {
        return asToolResult(await workItemCreationService.create(input));
      } catch (error) {
        return asToolResult(foundationService.serializeError(error), true);
      }
    },
  );

  server.registerTool(
    'initialize_work_item_documents',
    {
      description:
        'Idempotently create only the four approved missing lifecycle documents for one active Work Item.',
      inputSchema: INITIALIZE_DOCUMENTS_INPUT,
    },
    async (input) => {
      try {
        return asToolResult(await workItemDocumentService.initialize(input));
      } catch (error) {
        return asToolResult(foundationService.serializeError(error), true);
      }
    },
  );

  server.registerTool(
    'get_work_item_document',
    {
      description:
        'Return exactly one approved managed Work Item document with safe lifecycle metadata.',
      inputSchema: GET_DOCUMENT_INPUT,
    },
    async (input) => {
      try {
        return asToolResult(await workItemDocumentService.getDocument(input));
      } catch (error) {
        return asToolResult(foundationService.serializeError(error), true);
      }
    },
  );

  server.registerTool(
    'update_work_item_document',
    {
      description:
        'Replace one editable initialized document from a typed payload and matching revision.',
      inputSchema: UPDATE_DOCUMENT_INPUT,
    },
    async (input) => {
      try {
        return asToolResult(await workItemDocumentService.update(input));
      } catch (error) {
        return asToolResult(foundationService.serializeError(error), true);
      }
    },
  );

  server.registerTool(
    'refresh_ai_context',
    {
      description:
        'Regenerate only derived AI context from approved persisted Work Item dossier facts.',
      inputSchema: REFRESH_AI_CONTEXT_INPUT,
    },
    async (input) => {
      try {
        return asToolResult(await workItemDocumentService.refreshAiContext(input));
      } catch (error) {
        return asToolResult(foundationService.serializeError(error), true);
      }
    },
  );

  return server;
}

export async function startStdioServer(config: WorkspaceConfig): Promise<void> {
  const server = createMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
