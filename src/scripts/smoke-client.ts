import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const ABSOLUTE_PATH_PATTERN =
  /(?:^|[^\p{L}\p{N}._#:/\\-])(?:file:[\\/]+|[a-z]:[\\/]|[\\/]{2}[^\s]|\\[^\\\s]+\\[^\s]|\/(?!\/)[^\s])|:(?:\\(?!\\)|\/(?!\/))[^\s]/iu;

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

function isToolError(result: unknown): boolean {
  return (
    typeof result === 'object' && result !== null && 'isError' in result && result.isError === true
  );
}

function requireToolSuccess(result: unknown, operation: string): void {
  requireCondition(!isToolError(result), `${operation} returned an MCP tool error.`);
}

function requireCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function nestedValue(value: Record<string, unknown>, key: string): unknown {
  const nested = value[key];
  if (nested === undefined) {
    throw new Error(`Expected MCP payload field ${key}.`);
  }
  return nested;
}

function hasAbsolutePath(value: unknown, workspaceRoot: string): boolean {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return hasAbsolutePath(JSON.parse(trimmed) as unknown, workspaceRoot);
      } catch {
        // Ordinary text can happen to begin and end with JSON punctuation.
      }
    }

    const escaped = JSON.stringify(workspaceRoot).slice(1, -1);
    const normalized = value.replaceAll('\\', '/');
    return (
      value.includes(workspaceRoot) ||
      value.includes(escaped) ||
      normalized.toLowerCase().includes(workspaceRoot.replaceAll('\\', '/').toLowerCase()) ||
      ABSOLUTE_PATH_PATTERN.test(value)
    );
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasAbsolutePath(entry, workspaceRoot));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some((entry) => hasAbsolutePath(entry, workspaceRoot));
  }
  return false;
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
    requireToolSuccess(health, 'health_check');
    const capabilities = await client.callTool({
      name: 'get_server_capabilities',
      arguments: {},
    });
    requireToolSuccess(capabilities, 'get_server_capabilities');
    const initialization = await client.callTool({
      name: 'initialize_workspace',
      arguments: {},
    });
    requireToolSuccess(initialization, 'initialize_workspace');
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
    requireToolSuccess(creation, 'create_work_item');
    const creationPayload = parsedResult(creation);
    const workItemId = creationPayload.id;
    requireCondition(typeof workItemId === 'string', 'Work Item creation did not return an ID.');
    const documentInitialization = await client.callTool({
      name: 'initialize_work_item_documents',
      arguments: { workItemId },
    });
    requireToolSuccess(documentInitialization, 'initialize_work_item_documents');
    const currentState = await client.callTool({
      name: 'get_work_item_document',
      arguments: { workItemId, documentType: 'CURRENT_STATE' },
    });
    requireToolSuccess(currentState, 'get_work_item_document CURRENT_STATE');
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
    requireToolSuccess(documentUpdate, 'update_work_item_document');
    const aiContextBeforeM4 = await client.callTool({
      name: 'get_work_item_document',
      arguments: { workItemId, documentType: 'AI_CONTEXT' },
    });
    requireToolSuccess(aiContextBeforeM4, 'get_work_item_document AI_CONTEXT before M4');
    const aiContextBeforeM4Payload = parsedResult(aiContextBeforeM4);
    const aiContextDocument = aiContextBeforeM4Payload.document;
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
    const trackingInitialization = await client.callTool({
      name: 'initialize_work_item_tracking',
      arguments: { workItemId },
    });
    requireToolSuccess(trackingInitialization, 'initialize_work_item_tracking');
    requireCondition(
      parsedResult(trackingInitialization).auditRevision === 0,
      'Tracking initialization did not return audit revision zero.',
    );
    const evidenceRequest = {
      workItemId,
      expectedAuditRevision: 0,
      idempotencyKey: 'smoke-evidence-1',
      label: 'Smoke evidence reference',
      description: 'Logical metadata only.',
      logicalPath: 'evidence/smoke-result.txt',
      declaredActor: 'SMOKE_CLIENT',
    };
    const evidence = await client.callTool({
      name: 'register_evidence_reference',
      arguments: evidenceRequest,
    });
    requireToolSuccess(evidence, 'register_evidence_reference');
    const evidencePayload = parsedResult(evidence);
    const evidenceReferenceId = nestedValue(evidencePayload, 'evidenceReferenceId');
    requireCondition(
      typeof evidenceReferenceId === 'string',
      'Evidence registration did not return an ID.',
    );
    requireCondition(
      evidencePayload.auditRevision === 1 && evidencePayload.idempotent === false,
      'Evidence registration did not commit audit revision one.',
    );
    const decision = await client.callTool({
      name: 'record_decision',
      arguments: {
        workItemId,
        expectedAuditRevision: 1,
        idempotencyKey: 'smoke-decision-1',
        kind: 'DECISION',
        title: 'Use the frozen M4 contract',
        decision: 'Exercise the approved local audit flow.',
        rationale: 'The smoke test validates the compiled MCP server.',
        declaredActor: 'SMOKE_CLIENT',
        evidenceReferenceIds: [evidenceReferenceId],
      },
    });
    requireToolSuccess(decision, 'record_decision');
    const decisionPayload = parsedResult(decision);
    const decisionId = nestedValue(decisionPayload, 'decisionId');
    requireCondition(typeof decisionId === 'string', 'Decision did not return an ID.');
    requireCondition(
      decisionPayload.auditRevision === 2 && decisionPayload.idempotent === false,
      'Decision did not commit audit revision two.',
    );
    const checkpoint = await client.callTool({
      name: 'record_checkpoint',
      arguments: {
        workItemId,
        expectedAuditRevision: 2,
        idempotencyKey: 'smoke-checkpoint-1',
        kind: 'PROGRESS',
        summary: 'The M4 smoke flow reached audit revision three.',
        declaredActor: 'SMOKE_CLIENT',
        relatedDecisionIds: [decisionId],
        evidenceReferenceIds: [evidenceReferenceId],
      },
    });
    requireToolSuccess(checkpoint, 'record_checkpoint');
    const checkpointPayload = parsedResult(checkpoint);
    requireCondition(
      typeof checkpointPayload.checkpointId === 'string' &&
        checkpointPayload.auditRevision === 3 &&
        checkpointPayload.idempotent === false,
      'Checkpoint did not commit audit revision three.',
    );
    const testPlan = await client.callTool({
      name: 'define_test_plan',
      arguments: {
        workItemId,
        expectedAuditRevision: 3,
        idempotencyKey: 'smoke-test-plan-1',
        expectedPlanRevision: 0,
        purpose: 'Validate the compiled Milestone 4 MCP flow.',
        declaredActor: 'SMOKE_CLIENT',
        testCases: [
          {
            title: 'Compiled protocol flow',
            objective: 'Exercise all approved M4 record categories.',
            verificationMethod: 'AUTOMATED',
            expectedOutcome: 'Every call succeeds without exposing an absolute path.',
          },
        ],
      },
    });
    requireToolSuccess(testPlan, 'define_test_plan');
    const testPlanPayload = parsedResult(testPlan);
    const planId = nestedValue(testPlanPayload, 'planId');
    const testCases = nestedValue(testPlanPayload, 'testCases');
    requireCondition(typeof planId === 'string', 'Test plan did not return a plan ID.');
    requireCondition(
      testPlanPayload.auditRevision === 4 &&
        testPlanPayload.planRevision === 1 &&
        testPlanPayload.idempotent === false,
      'Test plan did not commit audit revision four and plan revision one.',
    );
    requireCondition(
      Array.isArray(testCases) &&
        typeof testCases[0] === 'object' &&
        testCases[0] !== null &&
        'testCaseId' in testCases[0] &&
        typeof testCases[0].testCaseId === 'string',
      'Test plan did not return a generated test case ID.',
    );
    const testCaseId =
      Array.isArray(testCases) &&
      typeof testCases[0] === 'object' &&
      testCases[0] !== null &&
      'testCaseId' in testCases[0] &&
      typeof testCases[0].testCaseId === 'string'
        ? testCases[0].testCaseId
        : '';
    const testExecution = await client.callTool({
      name: 'record_test_execution',
      arguments: {
        workItemId,
        expectedAuditRevision: 4,
        expectedPlanRevision: 1,
        idempotencyKey: 'smoke-test-execution-1',
        planId,
        planRevision: 1,
        testCaseId,
        executionMethod: 'AUTOMATED',
        outcome: 'PASSED',
        summary: 'The compiled M4 flow passed.',
        declaredActor: 'SMOKE_CLIENT',
        evidenceReferenceIds: [evidenceReferenceId],
      },
    });
    requireToolSuccess(testExecution, 'record_test_execution');
    const testExecutionPayload = parsedResult(testExecution);
    const testExecutionId = nestedValue(testExecutionPayload, 'testExecutionId');
    if (typeof testExecutionId !== 'string') {
      throw new Error('Test execution did not return an ID.');
    }
    requireCondition(
      testExecutionPayload.auditRevision === 5 && testExecutionPayload.idempotent === false,
      'Test execution did not commit audit revision five.',
    );
    const trackingViews: unknown[] = [];
    for (const trackingType of ['DECISIONS', 'CHECKPOINTS', 'TESTING', 'EVIDENCE_REFERENCES']) {
      const view = await client.callTool({
        name: 'get_work_item_tracking',
        arguments: { workItemId, trackingType },
      });
      requireToolSuccess(view, `get_work_item_tracking ${trackingType}`);
      const viewPayload = parsedResult(view);
      requireCondition(
        viewPayload.trackingType === trackingType && viewPayload.auditRevision === 5,
        `The ${trackingType} tracking view could not be read.`,
      );
      if (trackingType === 'TESTING') {
        requireCondition(
          typeof viewPayload.content === 'string' && viewPayload.content.includes(testExecutionId),
          'The TESTING projection did not contain the recorded execution.',
        );
      }
      trackingViews.push(view);
    }
    const aiContextAfterM4 = await client.callTool({
      name: 'get_work_item_document',
      arguments: { workItemId, documentType: 'AI_CONTEXT' },
    });
    requireToolSuccess(aiContextAfterM4, 'get_work_item_document AI_CONTEXT after M4');
    requireCondition(
      textContent(aiContextAfterM4) === textContent(aiContextBeforeM4),
      'An M4 mutation refreshed AI context automatically.',
    );
    const aiContextRefresh = await client.callTool({
      name: 'refresh_ai_context',
      arguments: { workItemId, expectedRevision: aiContextDocument.metadata.revision },
    });
    requireToolSuccess(aiContextRefresh, 'refresh_ai_context');
    const refreshedAiContext = await client.callTool({
      name: 'get_work_item_document',
      arguments: { workItemId, documentType: 'AI_CONTEXT' },
    });
    requireToolSuccess(refreshedAiContext, 'get_work_item_document refreshed AI_CONTEXT');
    requireCondition(
      textContent(refreshedAiContext).includes('Milestone 4 Audit Summary'),
      'Explicit AI-context refresh did not include the bounded M4 summary.',
    );
    const manifest = await client.callTool({
      name: 'get_work_item_document',
      arguments: { workItemId, documentType: 'MANIFEST' },
    });
    requireToolSuccess(manifest, 'get_work_item_document MANIFEST');
    const manifestText = textContent(manifest);
    requireCondition(
      (manifestText.match(/## Milestone 4 Audit Inventory/g) ?? []).length === 1 &&
        (manifestText.match(/## Document Lifecycle Inventory/g) ?? []).length === 1,
      'The shared manifest inventories were not preserved.',
    );
    const idempotentRetry = await client.callTool({
      name: 'register_evidence_reference',
      arguments: evidenceRequest,
    });
    requireToolSuccess(idempotentRetry, 'register_evidence_reference exact retry');
    const idempotentRetryPayload = parsedResult(idempotentRetry);
    requireCondition(
      idempotentRetryPayload.idempotent === true &&
        idempotentRetryPayload.auditRevision === 1 &&
        idempotentRetryPayload.evidenceReferenceId === evidenceReferenceId,
      'The exact retry did not resolve before its stale revision.',
    );
    const idempotencyConflict = await client.callTool({
      name: 'register_evidence_reference',
      arguments: { ...evidenceRequest, label: 'Conflicting label' },
    });
    requireCondition(
      isToolError(idempotencyConflict),
      'Conflicting idempotency reuse did not return an MCP tool error.',
    );
    const idempotencyConflictPayload = parsedResult(idempotencyConflict);
    const conflictError = idempotencyConflictPayload.error;
    requireCondition(
      typeof conflictError === 'object' &&
        conflictError !== null &&
        'code' in conflictError &&
        conflictError.code === 'AUDIT_IDEMPOTENCY_CONFLICT',
      'The smoke test did not observe the expected idempotency conflict.',
    );
    const requiredTools = [
      'health_check',
      'get_server_capabilities',
      'initialize_workspace',
      'create_work_item',
      'initialize_work_item_documents',
      'get_work_item_document',
      'update_work_item_document',
      'refresh_ai_context',
      'initialize_work_item_tracking',
      'record_decision',
      'record_checkpoint',
      'define_test_plan',
      'record_test_execution',
      'register_evidence_reference',
      'get_work_item_tracking',
    ];
    const discoveredTools = tools.tools.map((tool) => tool.name);
    requireCondition(
      [...requiredTools].sort().join('\n') === [...discoveredTools].sort().join('\n'),
      'The discovered MCP tools did not exactly match the approved 15-tool surface.',
    );
    const capabilitiesPayload = parsedResult(capabilities);
    const availableTools = capabilitiesPayload.availableTools;
    const availableToolNames = Array.isArray(availableTools)
      ? availableTools.flatMap((entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          'name' in entry &&
          typeof entry.name === 'string'
            ? [entry.name]
            : [],
        )
      : [];
    requireCondition(
      [...requiredTools].sort().join('\n') === [...availableToolNames].sort().join('\n'),
      'Capability discovery did not exactly match the approved 15-tool surface.',
    );
    const notImplemented = capabilitiesPayload.notImplemented;
    requireCondition(
      Array.isArray(notImplemented) &&
        ![
          'initialize_work_item_tracking',
          'record_decision',
          'record_checkpoint',
          'define_test_plan',
          'record_test_execution',
          'register_evidence_reference',
          'get_work_item_tracking',
        ].some((tool) => notImplemented.includes(tool)),
      'Capability discovery still classified an implemented M4 tool as unavailable.',
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
      trackingInitialization,
      evidence,
      decision,
      checkpoint,
      testPlan,
      testExecution,
      trackingViews,
      aiContextBeforeM4,
      aiContextAfterM4,
      aiContextRefresh,
      refreshedAiContext,
      manifest,
      idempotentRetry,
      idempotencyConflict,
    };
    requireCondition(
      !hasAbsolutePath(output, workspaceRoot),
      'A smoke result exposed an absolute path.',
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
