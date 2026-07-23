import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

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

function parsedResult(result: unknown): Record<string, unknown> {
  const parsed: unknown = JSON.parse(textContent(result));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Expected an object MCP payload.');
  }
  return parsed as Record<string, unknown>;
}

function requireCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

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
    const creationPayload = parsedResult(creation);
    const workItemId = creationPayload.id;
    requireCondition(typeof workItemId === 'string', 'Work Item creation did not return an ID.');
    const documentInitialization = await client.callTool({
      name: 'initialize_work_item_documents',
      arguments: { workItemId },
    });
    const currentState = await client.callTool({
      name: 'get_work_item_document',
      arguments: { workItemId, documentType: 'CURRENT_STATE' },
    });
    const currentStatePayload = parsedResult(currentState);
    const currentStateDocument = currentStatePayload.document;
    if (
      typeof currentStateDocument !== 'object' ||
      currentStateDocument === null ||
      !('metadata' in currentStateDocument) ||
      typeof currentStateDocument.metadata !== 'object' ||
      currentStateDocument.metadata === null ||
      !('revision' in currentStateDocument.metadata) ||
      typeof currentStateDocument.metadata.revision !== 'number'
    ) {
      throw new Error('Current State did not return lifecycle revision metadata.');
    }
    const documentUpdate = await client.callTool({
      name: 'update_work_item_document',
      arguments: {
        workItemId,
        documentType: 'CURRENT_STATE',
        expectedRevision: currentStateDocument.metadata.revision,
        payload: {
          knownFacts: ['Smoke test exercised the controlled document lifecycle.'],
        },
      },
    });
    const aiContext = await client.callTool({
      name: 'get_work_item_document',
      arguments: { workItemId, documentType: 'AI_CONTEXT' },
    });
    const aiContextPayload = parsedResult(aiContext);
    const aiContextDocument = aiContextPayload.document;
    if (
      typeof aiContextDocument !== 'object' ||
      aiContextDocument === null ||
      !('metadata' in aiContextDocument) ||
      typeof aiContextDocument.metadata !== 'object' ||
      aiContextDocument.metadata === null ||
      !('revision' in aiContextDocument.metadata) ||
      typeof aiContextDocument.metadata.revision !== 'number'
    ) {
      throw new Error('AI context did not return lifecycle revision metadata.');
    }
    const aiContextRefresh = await client.callTool({
      name: 'refresh_ai_context',
      arguments: { workItemId, expectedRevision: aiContextDocument.metadata.revision },
    });
    const requiredTools = [
      'health_check',
      'get_server_capabilities',
      'initialize_workspace',
      'create_work_item',
      'initialize_work_item_documents',
      'get_work_item_document',
      'update_work_item_document',
      'refresh_ai_context',
    ];
    const discoveredTools = tools.tools.map((tool) => tool.name);
    requireCondition(
      requiredTools.every((tool) => discoveredTools.includes(tool)),
      'The required MCP tools were not discovered.',
    );
    const output = {
      discoveredTools,
      health,
      capabilities,
      initialization,
      creation,
      documentInitialization,
      currentState,
      documentUpdate,
      aiContextRefresh,
    };
    requireCondition(
      !JSON.stringify(output).includes(workspaceRoot),
      'A smoke result exposed an absolute workspace path.',
    );

    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  } finally {
    await client.close().catch(() => undefined);
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

run().catch((error: unknown) => {
  process.stderr.write('MCP smoke test failed: ' + String(error) + '\n');
  process.exitCode = 1;
});
