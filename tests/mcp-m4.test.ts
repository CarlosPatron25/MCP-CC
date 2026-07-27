import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createTemporaryWorkspaceRoot, removeTemporaryWorkspaceRoot } from './helpers.js';

const EXPECTED_TOOLS = [
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
] as const;

const M4_TOOLS = [
  'initialize_work_item_tracking',
  'record_decision',
  'record_checkpoint',
  'define_test_plan',
  'record_test_execution',
  'register_evidence_reference',
  'get_work_item_tracking',
] as const;

const TRACKING_PATHS = {
  DECISIONS: '06_DECISIONS.md',
  CHECKPOINTS: '07_CHECKPOINTS.md',
  TESTING: '08_TEST_PLAN.md',
  EVIDENCE_REFERENCES: 'evidence/REFERENCES.md',
} as const;

const ABSOLUTE_PATH_PATTERN =
  /(?:^|[^\p{L}\p{N}._#:/\\-])(?:file:[\\/]+|[a-z]:[\\/]|[\\/]{2}[^\s]|\\[^\\\s]+\\[^\s]|\/(?!\/)[^\s])|:(?:\\(?!\\)|\/(?!\/))[^\s]/iu;

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
    name: 'ws-workspace-mcp-m4-test-client',
    version: '0.1.0',
  });
  await client.connect(createTransport(root));
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

function payload<T>(result: unknown): T {
  return JSON.parse(textContent(result)) as T;
}

function isToolError(result: unknown): boolean {
  return (
    typeof result === 'object' && result !== null && 'isError' in result && result.isError === true
  );
}

function expectStructuredError(result: unknown, code: string): Record<string, unknown> {
  expect(isToolError(result)).toBe(true);
  const parsed = payload<{ error?: Record<string, unknown> }>(result);
  expect(parsed.error).toMatchObject({ code });
  return parsed.error ?? {};
}

function assertNoAbsolutePaths(root: string, ...values: unknown[]): void {
  const normalizedRoot = root.replaceAll('\\', '/').toLowerCase();
  const visited = new Set<object>();

  const inspect = (value: unknown): void => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ) {
        try {
          inspect(JSON.parse(trimmed) as unknown);
          return;
        } catch {
          // It is ordinary text rather than a JSON-encoded MCP payload.
        }
      }

      const normalized = value.replaceAll('\\', '/');
      if (normalized.toLowerCase().includes(normalizedRoot) || ABSOLUTE_PATH_PATTERN.test(value)) {
        throw new Error(`An MCP result exposed an absolute path: ${value}`);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(inspect);
      return;
    }
    if (typeof value === 'object' && value !== null) {
      if (visited.has(value)) {
        return;
      }
      visited.add(value);
      Object.values(value).forEach(inspect);
    }
  };

  values.forEach(inspect);
}

interface CapabilitiesPayload {
  capabilities: string[];
  availableTools: Array<{ name: string; mutatesFilesystem: boolean }>;
  notImplemented: string[];
}

interface CreationPayload {
  id: string;
}

interface ManagedDocumentPayload {
  workItemId: string;
  document: {
    metadata: { revision: number };
    content: string;
  };
}

interface InitializeTrackingPayload {
  workItemId: string;
  auditRevision: number;
  created: string[];
  existing: string[];
}

interface EvidencePayload {
  workItemId: string;
  evidenceReferenceId: string;
  recordedAt: string;
  auditRevision: number;
  idempotent: boolean;
}

interface DecisionPayload {
  workItemId: string;
  decisionId: string;
  recordedAt: string;
  auditRevision: number;
  idempotent: boolean;
}

interface CheckpointPayload {
  workItemId: string;
  checkpointId: string;
  recordedAt: string;
  auditRevision: number;
  idempotent: boolean;
}

interface TestPlanPayload {
  workItemId: string;
  planVersionId: string;
  planId: string;
  planRevision: number;
  testCases: Array<{ testCaseId: string; title: string }>;
  recordedAt: string;
  auditRevision: number;
  idempotent: boolean;
}

interface TestExecutionPayload {
  workItemId: string;
  testExecutionId: string;
  recordedAt: string;
  auditRevision: number;
  idempotent: boolean;
}

interface TrackingPayload {
  workItemId: string;
  trackingType: keyof typeof TRACKING_PATHS;
  relativePath: string;
  auditRevision: number;
  content: string;
}

async function createM3WorkItem(
  client: Client,
  rallyId: string,
): Promise<{ workItemId: string; aiContext: ManagedDocumentPayload }> {
  await client.callTool({ name: 'initialize_workspace', arguments: {} });
  const creation = await client.callTool({
    name: 'create_work_item',
    arguments: {
      type: 'TECHNICAL_TASK',
      rallyId,
      title: 'M4 MCP integration test',
      functionalDefinition: 'Exercise Milestone 4 through the real MCP stdio adapter.',
      developmentAlias: 'mcp-m4-test',
      relatedComponents: ['mcp', 'audit-ledger'],
      startedAt: '2026-07-24',
    },
  });
  const workItemId = payload<CreationPayload>(creation).id;
  await client.callTool({
    name: 'initialize_work_item_documents',
    arguments: { workItemId },
  });
  const aiContext = payload<ManagedDocumentPayload>(
    await client.callTool({
      name: 'get_work_item_document',
      arguments: { workItemId, documentType: 'AI_CONTEXT' },
    }),
  );
  return { workItemId, aiContext };
}

describe('Milestone 4 MCP stdio adapter', () => {
  it('discovers exactly 15 tools, reports matching capabilities, and rejects unknown fields', async () => {
    const root = await createTemporaryWorkspaceRoot();
    temporaryRoots.push(root);
    const client = await connectClient(root);

    try {
      for (const absolutePath of [
        '//server/share/file.txt',
        '\\rooted\\secret.txt',
        'see|/etc/passwd',
        'see]/etc/passwd',
        'see>/etc/passwd',
        '**/etc/passwd',
      ]) {
        expect(() => assertNoAbsolutePaths(root, absolutePath)).toThrow(
          'An MCP result exposed an absolute path',
        );
      }

      const tools = await client.listTools();
      const discoveredNames = tools.tools.map((tool) => tool.name);
      expect(discoveredNames).toHaveLength(15);
      expect([...discoveredNames].sort()).toEqual([...EXPECTED_TOOLS].sort());

      for (const name of M4_TOOLS) {
        const tool = tools.tools.find((candidate) => candidate.name === name);
        expect(tool?.inputSchema).toMatchObject({
          type: 'object',
          additionalProperties: false,
        });
      }

      const capabilitiesResult = await client.callTool({
        name: 'get_server_capabilities',
        arguments: {},
      });
      const capabilities = payload<CapabilitiesPayload>(capabilitiesResult);
      expect(capabilities.availableTools).toHaveLength(15);
      expect(capabilities.availableTools.map((tool) => tool.name).sort()).toEqual(
        [...EXPECTED_TOOLS].sort(),
      );
      expect(capabilities.availableTools).toEqual(
        expect.arrayContaining([
          { name: 'initialize_work_item_tracking', mutatesFilesystem: true },
          { name: 'record_decision', mutatesFilesystem: true },
          { name: 'record_checkpoint', mutatesFilesystem: true },
          { name: 'define_test_plan', mutatesFilesystem: true },
          { name: 'record_test_execution', mutatesFilesystem: true },
          { name: 'register_evidence_reference', mutatesFilesystem: true },
          { name: 'get_work_item_tracking', mutatesFilesystem: false },
        ]),
      );
      expect(capabilities.capabilities).toEqual(
        expect.arrayContaining([
          'append-only-audit-tracking',
          'idempotent-audit-mutations',
          'versioned-test-planning',
          'controlled-evidence-references',
        ]),
      );
      expect(capabilities.notImplemented).not.toContain('record_decision');
      expect(capabilities.notImplemented).not.toContain('record_checkpoint');

      await client.callTool({ name: 'initialize_workspace', arguments: {} });
      const unknownTopLevel = await client.callTool({
        name: 'initialize_work_item_tracking',
        arguments: { workItemId: 'UNKNOWN-1', unexpected: true },
      });
      expectStructuredError(unknownTopLevel, 'WORK_ITEM_NOT_FOUND');

      const unknownNested = await client.callTool({
        name: 'define_test_plan',
        arguments: {
          workItemId: 'UNKNOWN-1',
          expectedAuditRevision: 0,
          idempotencyKey: 'unknown-nested-field',
          expectedPlanRevision: 0,
          purpose: 'Verify strict nested schemas.',
          declaredActor: 'mcp-test',
          testCases: [
            {
              title: 'Strict case',
              objective: 'Reject an unknown nested field.',
              verificationMethod: 'AUTOMATED',
              expectedOutcome: 'The request is rejected.',
              unexpected: true,
            },
          ],
        },
      });
      expectStructuredError(unknownNested, 'WORK_ITEM_NOT_FOUND');

      const m3MissingCreation = await client.callTool({
        name: 'create_work_item',
        arguments: {
          type: 'TECHNICAL_TASK',
          rallyId: 'MCP-M4-M3-MISSING',
          title: 'M3 precedence test',
          functionalDefinition: 'Verify M3 initialization precedes M4 payload validation.',
          developmentAlias: 'mcp-m4-m3-missing',
          relatedComponents: ['mcp'],
          startedAt: '2026-07-24',
        },
      });
      const m3MissingWorkItemId = payload<CreationPayload>(m3MissingCreation).id;
      const m3Missing = await client.callTool({
        name: 'initialize_work_item_tracking',
        arguments: { workItemId: m3MissingWorkItemId, unexpected: true },
      });
      expectStructuredError(m3Missing, 'DOCUMENT_NOT_INITIALIZED');

      const { workItemId } = await createM3WorkItem(client, 'MCP-M4-STRICT');
      const m4Missing = await client.callTool({
        name: 'record_decision',
        arguments: { workItemId, unexpected: true },
      });
      expectStructuredError(m4Missing, 'AUDIT_TRACKING_NOT_INITIALIZED');
      await client.callTool({
        name: 'initialize_work_item_tracking',
        arguments: { workItemId },
      });
      const strictTopLevel = await client.callTool({
        name: 'initialize_work_item_tracking',
        arguments: { workItemId, unexpected: true },
      });
      expectStructuredError(strictTopLevel, 'AUDIT_ENTRY_VALIDATION_FAILED');
      const strictNested = await client.callTool({
        name: 'define_test_plan',
        arguments: {
          workItemId,
          expectedAuditRevision: 0,
          idempotencyKey: 'strict-nested-field',
          expectedPlanRevision: 0,
          purpose: 'Verify strict nested schemas.',
          declaredActor: 'mcp-test',
          testCases: [
            {
              title: 'Strict case',
              objective: 'Reject an unknown nested field.',
              verificationMethod: 'AUTOMATED',
              expectedOutcome: 'The request is rejected.',
              unexpected: true,
            },
          ],
        },
      });
      expectStructuredError(strictNested, 'AUDIT_ENTRY_VALIDATION_FAILED');

      const unsafeLocationResults: unknown[] = [];
      for (const [index, unsafeLocation] of [
        '/',
        '\\',
        'custom:(secret)',
        '_www.example.invalid',
      ].entries()) {
        const result = await client.callTool({
          name: 'record_decision',
          arguments: {
            workItemId,
            expectedAuditRevision: 0,
            idempotencyKey: `unsafe-location-${index}`,
            kind: 'DECISION',
            title: 'Reject unsafe audit text',
            decision: `Inspect ${unsafeLocation} before continuing.`,
            rationale: 'Audit text must not persist unsafe locations.',
            declaredActor: 'mcp-test',
          },
        });
        expectStructuredError(result, 'AUDIT_ENTRY_VALIDATION_FAILED');
        unsafeLocationResults.push(result);
      }

      assertNoAbsolutePaths(
        root,
        tools,
        capabilitiesResult,
        unknownTopLevel,
        unknownNested,
        m3MissingCreation,
        m3Missing,
        m4Missing,
        strictTopLevel,
        strictNested,
        unsafeLocationResults,
      );
    } finally {
      await client.close();
    }
  });

  it('executes the complete M4 flow with revisions, idempotency, closed views, and safe errors', async () => {
    const root = await createTemporaryWorkspaceRoot();
    temporaryRoots.push(root);
    const client = await connectClient(root);
    const observedResults: unknown[] = [];

    try {
      const { workItemId, aiContext: aiContextBefore } = await createM3WorkItem(
        client,
        'MCP-M4-001',
      );

      const notInitialized = await client.callTool({
        name: 'get_work_item_tracking',
        arguments: { workItemId, trackingType: 'DECISIONS' },
      });
      expectStructuredError(notInitialized, 'AUDIT_TRACKING_NOT_INITIALIZED');
      observedResults.push(notInitialized);

      const initializationResult = await client.callTool({
        name: 'initialize_work_item_tracking',
        arguments: { workItemId },
      });
      const initialization = payload<InitializeTrackingPayload>(initializationResult);
      expect(initialization).toEqual({
        workItemId,
        auditRevision: 0,
        created: [
          'records/AUDIT_LEDGER.json',
          '06_DECISIONS.md',
          '07_CHECKPOINTS.md',
          '08_TEST_PLAN.md',
          'evidence/REFERENCES.md',
        ],
        existing: [],
      });
      observedResults.push(initializationResult);

      const secondInitialization = payload<InitializeTrackingPayload>(
        await client.callTool({
          name: 'initialize_work_item_tracking',
          arguments: { workItemId },
        }),
      );
      expect(secondInitialization).toMatchObject({
        workItemId,
        auditRevision: 0,
        created: [],
        existing: initialization.created,
      });
      observedResults.push(secondInitialization);

      const evidenceArguments = {
        workItemId,
        expectedAuditRevision: 0,
        idempotencyKey: 'mcp-m4-evidence-1',
        label: 'MCP execution output',
        description: 'Logical reference only; the file need not exist.',
        logicalPath: 'evidence/mcp/execution-output.txt',
        declaredActor: 'mcp-test',
      };
      const evidenceResult = await client.callTool({
        name: 'register_evidence_reference',
        arguments: evidenceArguments,
      });
      const evidence = payload<EvidencePayload>(evidenceResult);
      expect(evidence).toMatchObject({
        workItemId,
        auditRevision: 1,
        idempotent: false,
      });
      observedResults.push(evidenceResult);

      const decisionResult = await client.callTool({
        name: 'record_decision',
        arguments: {
          workItemId,
          expectedAuditRevision: 1,
          idempotencyKey: 'mcp-m4-decision-1',
          kind: 'DECISION',
          title: 'Use real MCP integration coverage',
          decision: 'Exercise every M4 mutation through stdio.',
          rationale: 'Validate the public adapter and persistence together.',
          declaredActor: 'mcp-test',
          evidenceReferenceIds: [evidence.evidenceReferenceId],
        },
      });
      const decision = payload<DecisionPayload>(decisionResult);
      expect(decision).toMatchObject({
        workItemId,
        auditRevision: 2,
        idempotent: false,
      });
      observedResults.push(decisionResult);

      const checkpointResult = await client.callTool({
        name: 'record_checkpoint',
        arguments: {
          workItemId,
          expectedAuditRevision: 2,
          idempotencyKey: 'mcp-m4-checkpoint-1',
          kind: 'PROGRESS',
          summary: 'Evidence and decision records are committed.',
          declaredActor: 'mcp-test',
          relatedDecisionIds: [decision.decisionId],
          evidenceReferenceIds: [evidence.evidenceReferenceId],
        },
      });
      const checkpoint = payload<CheckpointPayload>(checkpointResult);
      expect(checkpoint).toMatchObject({
        workItemId,
        auditRevision: 3,
        idempotent: false,
      });
      observedResults.push(checkpointResult);

      const planResult = await client.callTool({
        name: 'define_test_plan',
        arguments: {
          workItemId,
          expectedAuditRevision: 3,
          idempotencyKey: 'mcp-m4-plan-1',
          expectedPlanRevision: 0,
          purpose: 'Validate the complete M4 MCP flow.',
          declaredActor: 'mcp-test',
          testCases: [
            {
              title: 'MCP happy path',
              objective: 'Verify all M4 record types and closed views.',
              verificationMethod: 'AUTOMATED',
              expectedOutcome: 'Every operation succeeds with safe output.',
            },
          ],
        },
      });
      const plan = payload<TestPlanPayload>(planResult);
      expect(plan).toMatchObject({
        workItemId,
        auditRevision: 4,
        planRevision: 1,
        idempotent: false,
      });
      expect(plan.testCases).toHaveLength(1);
      observedResults.push(planResult);

      const testCase = plan.testCases[0];
      expect(testCase).toBeDefined();
      const executionResult = await client.callTool({
        name: 'record_test_execution',
        arguments: {
          workItemId,
          expectedAuditRevision: 4,
          expectedPlanRevision: 1,
          idempotencyKey: 'mcp-m4-execution-1',
          planId: plan.planId,
          planRevision: plan.planRevision,
          testCaseId: testCase!.testCaseId,
          executionMethod: 'AUTOMATED',
          outcome: 'PASSED',
          summary: 'The MCP happy path completed successfully.',
          declaredActor: 'mcp-test',
          evidenceReferenceIds: [evidence.evidenceReferenceId],
        },
      });
      const execution = payload<TestExecutionPayload>(executionResult);
      expect(execution).toMatchObject({
        workItemId,
        auditRevision: 5,
        idempotent: false,
      });
      observedResults.push(executionResult);

      const retryResult = await client.callTool({
        name: 'register_evidence_reference',
        arguments: evidenceArguments,
      });
      const retry = payload<EvidencePayload>(retryResult);
      expect(retry).toEqual({ ...evidence, idempotent: true });
      observedResults.push(retryResult);

      const idempotencyConflict = await client.callTool({
        name: 'record_decision',
        arguments: {
          workItemId,
          expectedAuditRevision: 5,
          idempotencyKey: evidenceArguments.idempotencyKey,
          kind: 'DECISION',
          title: 'Conflicting key',
          decision: 'This must not be persisted.',
          rationale: 'Exercise the global idempotency index.',
          declaredActor: 'mcp-test',
        },
      });
      expectStructuredError(idempotencyConflict, 'AUDIT_IDEMPOTENCY_CONFLICT');
      observedResults.push(idempotencyConflict);

      const staleRevision = await client.callTool({
        name: 'record_checkpoint',
        arguments: {
          workItemId,
          expectedAuditRevision: 0,
          idempotencyKey: 'mcp-m4-stale-revision',
          kind: 'PROGRESS',
          summary: 'This stale mutation must not be persisted.',
          declaredActor: 'mcp-test',
        },
      });
      expectStructuredError(staleRevision, 'AUDIT_REVISION_CONFLICT');
      observedResults.push(staleRevision);

      const trackingResults: Partial<Record<keyof typeof TRACKING_PATHS, TrackingPayload>> = {};
      for (const trackingType of Object.keys(TRACKING_PATHS) as Array<
        keyof typeof TRACKING_PATHS
      >) {
        const result = await client.callTool({
          name: 'get_work_item_tracking',
          arguments: { workItemId, trackingType },
        });
        const tracking = payload<TrackingPayload>(result);
        expect(tracking).toMatchObject({
          workItemId,
          trackingType,
          relativePath: TRACKING_PATHS[trackingType],
          auditRevision: 5,
        });
        trackingResults[trackingType] = tracking;
        observedResults.push(result);
      }

      expect(trackingResults.DECISIONS?.content).toContain(decision.decisionId);
      expect(trackingResults.DECISIONS?.content).toContain('Use real MCP integration coverage');
      expect(trackingResults.CHECKPOINTS?.content).toContain(checkpoint.checkpointId);
      expect(trackingResults.TESTING?.content).toContain(plan.planId);
      expect(trackingResults.TESTING?.content).toContain(testCase!.testCaseId);
      expect(trackingResults.TESTING?.content).toContain(execution.testExecutionId);
      expect(trackingResults.EVIDENCE_REFERENCES?.content).toContain(evidence.evidenceReferenceId);
      expect(trackingResults.EVIDENCE_REFERENCES?.content).toContain('MCP execution output');

      const aiContextAfterM4Result = await client.callTool({
        name: 'get_work_item_document',
        arguments: { workItemId, documentType: 'AI_CONTEXT' },
      });
      const aiContextAfterM4 = payload<ManagedDocumentPayload>(aiContextAfterM4Result);
      expect(aiContextAfterM4.document.metadata.revision).toBe(
        aiContextBefore.document.metadata.revision,
      );
      expect(aiContextAfterM4.document.content).toBe(aiContextBefore.document.content);
      observedResults.push(aiContextAfterM4Result);

      const refreshResult = await client.callTool({
        name: 'refresh_ai_context',
        arguments: {
          workItemId,
          expectedRevision: aiContextAfterM4.document.metadata.revision,
        },
      });
      expect(isToolError(refreshResult)).toBe(false);
      observedResults.push(refreshResult);
      const refreshedAiResult = await client.callTool({
        name: 'get_work_item_document',
        arguments: { workItemId, documentType: 'AI_CONTEXT' },
      });
      const refreshedAi = payload<ManagedDocumentPayload>(refreshedAiResult);
      expect(refreshedAi.document.metadata.revision).toBe(
        aiContextBefore.document.metadata.revision + 1,
      );
      expect(refreshedAi.document.content).toContain('## Resumen de auditoría de Milestone 4');
      expect(refreshedAi.document.content).toContain('Use real MCP integration coverage');
      expect(refreshedAi.document.content).toContain('MCP execution output');
      observedResults.push(refreshedAiResult);

      const manifestResult = await client.callTool({
        name: 'get_work_item_document',
        arguments: { workItemId, documentType: 'MANIFEST' },
      });
      const manifest = payload<ManagedDocumentPayload>(manifestResult);
      expect(manifest.document.content).toContain('## Milestone 4 Audit Inventory');
      expect(manifest.document.content).toContain('## Document Lifecycle Inventory');
      expect(manifest.document.content.match(/## Milestone 4 Audit Inventory/g)).toHaveLength(1);
      expect(manifest.document.content.match(/## Document Lifecycle Inventory/g)).toHaveLength(1);
      observedResults.push(manifestResult);

      assertNoAbsolutePaths(root, observedResults);
    } finally {
      await client.close();
    }
  });
});
