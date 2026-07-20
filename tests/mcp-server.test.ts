import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createTemporaryWorkspaceRoot, removeTemporaryWorkspaceRoot } from './helpers.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(removeTemporaryWorkspaceRoot));
});

function createTransport(root: string): StdioClientTransport {
  return new StdioClientTransport({
    command: process.execPath,
    args: [
      resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      resolve(process.cwd(), 'src', 'index.ts'),
    ],
    env: {
      WS_WORKSPACE_ROOT: root,
    },
  });
}

async function connectClient(root: string): Promise<Client> {
  const client = new Client({
    name: 'ws-workspace-mcp-test-client',
    version: '0.1.0',
  });
  const transport = createTransport(root);
  await client.connect(transport);
  return client;
}

function textContent(result: unknown): string {
  if (typeof result !== 'object' || result === null || !('content' in result)) {
    throw new Error('Expected an MCP tool result.');
  }
  const content = result.content;
  if (
    !Array.isArray(content) ||
    content[0]?.type !== 'text' ||
    typeof content[0].text !== 'string'
  ) {
    throw new Error('Expected an MCP text result.');
  }
  return content[0].text;
}

describe('MCP Work Item creation', () => {
  it('exposes create_work_item and returns safe structured results and errors', async () => {
    const root = await createTemporaryWorkspaceRoot();
    temporaryRoots.push(root);
    const client = await connectClient(root);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain('create_work_item');

      await client.callTool({ name: 'initialize_workspace', arguments: {} });
      const creation = await client.callTool({
        name: 'create_work_item',
        arguments: {
          type: 'DEFECT',
          rallyId: 'DEF-42',
          title: 'MCP creation test',
          functionalDefinition: 'Exercise the real MCP adapter.',
          developmentAlias: 'test',
          relatedComponents: ['mcp'],
          startedAt: '2026-07-20',
        },
      });
      const creationText = textContent(creation);
      expect(creationText).toContain('"status": "DRAFT"');
      expect(creationText).not.toContain(root);

      const duplicate = await client.callTool({
        name: 'create_work_item',
        arguments: {
          type: 'DEFECT',
          rallyId: 'DEF-42',
          title: 'MCP creation test',
          functionalDefinition: 'Exercise the real MCP adapter.',
          developmentAlias: 'test',
          relatedComponents: ['mcp'],
          startedAt: '2026-07-20',
        },
      });
      const duplicateText = textContent(duplicate);
      expect(duplicate.isError).toBe(true);
      expect(JSON.parse(duplicateText)).toEqual({
        error: {
          code: 'WORK_ITEM_ALREADY_EXISTS',
          message: 'A Work Item with this identifier already exists.',
        },
      });
      expect(duplicateText).not.toContain(root);
    } finally {
      await client.close();
    }
  });
});
