import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

async function run(): Promise<void> {
  const workspaceRoot = await mkdtemp(resolve(tmpdir(), 'ws-workspace-mcp-smoke-'));

  const client = new Client({
    name: 'ws-workspace-mcp-smoke-client',
    version: '0.1.0',
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(process.cwd(), 'dist/index.js')],
    env: {
      WS_WORKSPACE_ROOT: workspaceRoot,
    },
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const health = await client.callTool({ name: 'health_check', arguments: {} });
    const capabilities = await client.callTool({
      name: 'get_server_capabilities',
      arguments: {},
    });
    const initialization = await client.callTool({
      name: 'initialize_workspace',
      arguments: {},
    });
    const creation = await client.callTool({
      name: 'create_work_item',
      arguments: {
        type: 'USER_STORY',
        rallyId: 'SMOKE-1',
        title: 'Smoke-test Work Item',
        functionalDefinition: 'Verify secure Work Item creation through MCP.',
        developmentAlias: 'smoke',
        relatedComponents: ['smoke-client'],
        startedAt: '2026-07-20',
      },
    });

    process.stdout.write(
      JSON.stringify(
        {
          discoveredTools: tools.tools.map((tool) => tool.name),
          health,
          capabilities,
          initialization,
          creation,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await client.close().catch(() => undefined);
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

run().catch((error: unknown) => {
  process.stderr.write('MCP smoke test failed: ' + String(error) + '\n');
  process.exitCode = 1;
});
