import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { z as z3 } from 'zod/v3';

import type { WorkspaceConfig } from '../config/workspace-config.js';
import {
  CHECKPOINT_KINDS,
  DECISION_KINDS,
  EXECUTION_METHODS,
  TEST_EXECUTION_OUTCOMES,
  TRACKING_TYPES,
  VERIFICATION_METHODS,
} from '../domain/work-item-audit.js';
import { LocalFilesystemWorkItemAuditRepository } from '../filesystem/local-filesystem-work-item-audit-repository.js';
import { LocalFilesystemWorkItemDossierRepository } from '../filesystem/local-filesystem-work-item-dossier-repository.js';
import { AuditContextSummaryService } from '../services/audit-context-summary-service.js';
import { AIContextProjectionService } from '../services/ai-context-projection-service.js';
import { AuditLedgerService } from '../services/audit-ledger-service.js';
import { AuditProjectionService } from '../services/audit-projection-service.js';
import { SystemClock } from '../services/clock.js';
import { DocumentTemplateService } from '../services/document-template-service.js';
import { FoundationService, SERVER_NAME, SERVER_VERSION } from '../services/foundation-service.js';
import { SystemIdGenerator } from '../services/id-generator.js';
import { M4ManifestInventoryService } from '../services/m4-manifest-inventory-service.js';
import { ManifestLifecycleService } from '../services/manifest-lifecycle-service.js';
import {
  CREATE_WORK_ITEM_INPUT_SCHEMA,
  WorkItemCreationService,
} from '../services/work-item-creation-service.js';
import { WorkItemAuditService } from '../services/work-item-audit-service.js';
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

/**
 * The SDK normally parses a tool schema before invoking its handler. M4 must
 * advertise a strict schema while applying request validation only after the
 * repository has enforced the frozen Work Item -> M3 -> M4 precedence. A
 * Zod-v3 proxy keeps the strict JSON Schema metadata but defers the actual
 * parse to the application service, which performs the same closed validation.
 */
function deferM4ValidationToApplication<T extends z3.AnyZodObject>(schema: T): T {
  return new Proxy(schema, {
    get(target, property, receiver) {
      if (property === 'safeParse') {
        return (data: unknown) => ({ success: true as const, data });
      }
      if (property === 'safeParseAsync') {
        return async (data: unknown) => ({ success: true as const, data });
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}

const M4_REQUIRED_TEXT = z3.string().min(1);
const M4_REVISION = z3.number().int().nonnegative();
const M4_UUID = z3.string().uuid();
const M4_EVIDENCE_IDS = z3.array(M4_UUID).optional();
const INITIALIZE_TRACKING_INPUT = deferM4ValidationToApplication(
  z3.object({ workItemId: M4_REQUIRED_TEXT }).strict(),
);
const RECORD_DECISION_INPUT = deferM4ValidationToApplication(
  z3
    .object({
      workItemId: M4_REQUIRED_TEXT,
      expectedAuditRevision: M4_REVISION,
      idempotencyKey: M4_REQUIRED_TEXT,
      kind: z3.enum(DECISION_KINDS),
      title: M4_REQUIRED_TEXT,
      decision: M4_REQUIRED_TEXT,
      rationale: M4_REQUIRED_TEXT,
      declaredActor: M4_REQUIRED_TEXT,
      relatedDecisionId: M4_UUID.optional(),
      evidenceReferenceIds: M4_EVIDENCE_IDS,
    })
    .strict(),
);
const RECORD_CHECKPOINT_INPUT = deferM4ValidationToApplication(
  z3
    .object({
      workItemId: M4_REQUIRED_TEXT,
      expectedAuditRevision: M4_REVISION,
      idempotencyKey: M4_REQUIRED_TEXT,
      kind: z3.enum(CHECKPOINT_KINDS),
      summary: M4_REQUIRED_TEXT,
      declaredActor: M4_REQUIRED_TEXT,
      correctsCheckpointId: M4_UUID.optional(),
      relatedDecisionIds: z3.array(M4_UUID).optional(),
      evidenceReferenceIds: M4_EVIDENCE_IDS,
    })
    .strict(),
);
const TEST_CASE_DEFINITION_INPUT = z3
  .object({
    title: M4_REQUIRED_TEXT,
    objective: M4_REQUIRED_TEXT,
    verificationMethod: z3.enum(VERIFICATION_METHODS),
    expectedOutcome: M4_REQUIRED_TEXT,
  })
  .strict();
const DEFINE_TEST_PLAN_INPUT = deferM4ValidationToApplication(
  z3
    .object({
      workItemId: M4_REQUIRED_TEXT,
      expectedAuditRevision: M4_REVISION,
      idempotencyKey: M4_REQUIRED_TEXT,
      planId: M4_UUID.optional(),
      expectedPlanRevision: M4_REVISION,
      purpose: M4_REQUIRED_TEXT,
      declaredActor: M4_REQUIRED_TEXT,
      testCases: z3.array(TEST_CASE_DEFINITION_INPUT).min(1),
    })
    .strict(),
);
const RECORD_TEST_EXECUTION_INPUT = deferM4ValidationToApplication(
  z3
    .object({
      workItemId: M4_REQUIRED_TEXT,
      expectedAuditRevision: M4_REVISION,
      expectedPlanRevision: M4_REVISION,
      idempotencyKey: M4_REQUIRED_TEXT,
      planId: M4_UUID,
      planRevision: z3.number().int().positive(),
      testCaseId: M4_UUID,
      executionMethod: z3.enum(EXECUTION_METHODS),
      outcome: z3.enum(TEST_EXECUTION_OUTCOMES),
      summary: M4_REQUIRED_TEXT,
      declaredActor: M4_REQUIRED_TEXT,
      evidenceReferenceIds: M4_EVIDENCE_IDS,
    })
    .strict(),
);
const REGISTER_EVIDENCE_REFERENCE_INPUT = deferM4ValidationToApplication(
  z3
    .object({
      workItemId: M4_REQUIRED_TEXT,
      expectedAuditRevision: M4_REVISION,
      idempotencyKey: M4_REQUIRED_TEXT,
      label: M4_REQUIRED_TEXT,
      description: z3.string().optional(),
      logicalPath: M4_REQUIRED_TEXT,
      declaredActor: M4_REQUIRED_TEXT,
    })
    .strict(),
);
const GET_TRACKING_INPUT = deferM4ValidationToApplication(
  z3
    .object({
      workItemId: M4_REQUIRED_TEXT,
      trackingType: z3.enum(TRACKING_TYPES),
    })
    .strict(),
);

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
  const clock = new SystemClock();
  const auditRepository = new LocalFilesystemWorkItemAuditRepository({
    workspaceRoot: config.workspaceRoot,
  });
  const auditService = new WorkItemAuditService(
    auditRepository,
    new AuditLedgerService(clock, new SystemIdGenerator()),
    new AuditProjectionService(),
    new M4ManifestInventoryService(),
    new AuditContextSummaryService(),
  );
  const workItemDocumentService = new WorkItemDocumentService(
    new LocalFilesystemWorkItemDossierRepository({ workspaceRoot: config.workspaceRoot }),
    new DocumentTemplateService(),
    new ManifestLifecycleService(clock),
    new AIContextProjectionService(),
    auditService,
  );
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      instructions:
        'WS Workspace MCP provides secure local Work Item creation, controlled document lifecycle, and auditable Milestone 4 tracking tools. Do not assume closing or external integrations exist.',
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

  server.registerTool(
    'initialize_work_item_tracking',
    {
      description:
        'Atomically initialize the approved structured audit ledger and four protected projections.',
      inputSchema: INITIALIZE_TRACKING_INPUT,
    },
    async (input) => {
      try {
        return asToolResult(await auditService.initialize(input));
      } catch (error) {
        return asToolResult(foundationService.serializeError(error), true);
      }
    },
  );

  server.registerTool(
    'record_decision',
    {
      description: 'Append one immutable, idempotent decision event to audit tracking.',
      inputSchema: RECORD_DECISION_INPUT,
    },
    async (input) => {
      try {
        return asToolResult(await auditService.recordDecision(input));
      } catch (error) {
        return asToolResult(foundationService.serializeError(error), true);
      }
    },
  );

  server.registerTool(
    'record_checkpoint',
    {
      description: 'Append one immutable, idempotent progress checkpoint.',
      inputSchema: RECORD_CHECKPOINT_INPUT,
    },
    async (input) => {
      try {
        return asToolResult(await auditService.recordCheckpoint(input));
      } catch (error) {
        return asToolResult(foundationService.serializeError(error), true);
      }
    },
  );

  server.registerTool(
    'define_test_plan',
    {
      description: 'Append the initial or next immutable version of the one logical test plan.',
      inputSchema: DEFINE_TEST_PLAN_INPUT,
    },
    async (input) => {
      try {
        return asToolResult(await auditService.defineTestPlan(input));
      } catch (error) {
        return asToolResult(foundationService.serializeError(error), true);
      }
    },
  );

  server.registerTool(
    'record_test_execution',
    {
      description: 'Append one execution for a test case in the active test-plan version.',
      inputSchema: RECORD_TEST_EXECUTION_INPUT,
    },
    async (input) => {
      try {
        return asToolResult(await auditService.recordTestExecution(input));
      } catch (error) {
        return asToolResult(foundationService.serializeError(error), true);
      }
    },
  );

  server.registerTool(
    'register_evidence_reference',
    {
      description:
        'Register controlled evidence metadata without reading or validating physical evidence.',
      inputSchema: REGISTER_EVIDENCE_REFERENCE_INPUT,
    },
    async (input) => {
      try {
        return asToolResult(await auditService.registerEvidenceReference(input));
      } catch (error) {
        return asToolResult(foundationService.serializeError(error), true);
      }
    },
  );

  server.registerTool(
    'get_work_item_tracking',
    {
      description: 'Return exactly one approved closed audit-tracking projection.',
      inputSchema: GET_TRACKING_INPUT,
    },
    async (input) => {
      try {
        return asToolResult(await auditService.getTracking(input));
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
