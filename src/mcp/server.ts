import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import type { WorkspaceConfig } from '../config/workspace-config.js';
import { FoundationService, SERVER_NAME, SERVER_VERSION } from '../services/foundation-service.js';
import {
  CREATE_WORK_ITEM_INPUT_SCHEMA,
  WorkItemCreationService,
} from '../services/work-item-creation-service.js';

const EMPTY_INPUT = z.object({}).strict();

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
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      instructions:
        'WS Workspace MCP provides foundation tools and secure Work Item creation. Do not assume later lifecycle tools exist.',
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

  return server;
}

export async function startStdioServer(config: WorkspaceConfig): Promise<void> {
  const server = createMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
