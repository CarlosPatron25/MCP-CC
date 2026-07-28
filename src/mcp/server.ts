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
import { DocumentRevisionConflictError } from '../errors/workspace-error.js';
import { LocalFilesystemWorkItemAuditRepository } from '../filesystem/local-filesystem-work-item-audit-repository.js';
import { LocalFilesystemWorkItemDossierRepository } from '../filesystem/local-filesystem-work-item-dossier-repository.js';
import { LocalFilesystemKnowledgeBaseRepository } from '../filesystem/local-filesystem-knowledge-base-repository.js';
import { LocalProjectObservationAdapter } from '../filesystem/local-project-observation-adapter.js';
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
import { KnowledgeBaseLedgerService } from '../services/knowledge-base-ledger-service.js';
import { KnowledgeBaseApplicationService } from '../services/knowledge-base-application-service.js';
import {
  CombinedContextSummaryProvider,
  KnowledgeContextSummaryService,
} from '../services/knowledge-context-summary-service.js';
import { M5ProjectionService } from '../services/m5-projection-service.js';
import {
  CREATE_WORK_ITEM_V2_INPUT_SCHEMA,
  WorkItemV2CreationService,
} from '../services/work-item-v2-creation-service.js';
import { WorkItemV2BootstrapService } from '../services/work-item-v2-bootstrap-service.js';
import {
  ACTIVATE_SESSION_SCHEMA,
  ADD_COLLABORATOR_SCHEMA,
  ADD_RELATION_SCHEMA,
  CANCEL_WORK_ITEM_SCHEMA,
  COMPLETE_WORK_ITEM_SCHEMA,
  CONSOLIDATE_DOSSIER_SCHEMA,
  GET_ACTIVE_SESSION_SCHEMA,
  GET_RELATED_KNOWLEDGE_SCHEMA,
  GET_WORKFLOW_SCHEMA,
  INITIALIZE_WORKFLOW_SCHEMA,
  PROPOSE_CONCEPT_SCHEMA,
  RECORD_SESSION_CHECKPOINT_SCHEMA,
  REMOVE_COLLABORATOR_SCHEMA,
  REMOVE_RELATION_SCHEMA,
  REOPEN_WORK_ITEM_SCHEMA,
  RESOLVE_CONCEPT_SCHEMA,
  RESOLVE_SEMANTIC_OBSERVATION_SCHEMA,
  RESUME_SESSION_CONTEXT_SCHEMA,
  REVIEW_WORK_ITEM_SCHEMA,
  SUSPEND_SESSION_SCHEMA,
  SWITCH_SESSION_SCHEMA,
  TRANSFER_RESPONSIBILITY_SCHEMA,
} from './m5-input-schemas.js';

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
  const idGenerator = new SystemIdGenerator();
  const knowledgeRepository = new LocalFilesystemKnowledgeBaseRepository({
    workspaceRoot: config.workspaceRoot,
  });
  const knowledgeLedgerService = new KnowledgeBaseLedgerService(clock, idGenerator);
  const workItemDocumentService = new WorkItemDocumentService(
    new LocalFilesystemWorkItemDossierRepository({ workspaceRoot: config.workspaceRoot }),
    new DocumentTemplateService(),
    new ManifestLifecycleService(clock),
    new AIContextProjectionService(),
    new CombinedContextSummaryProvider([
      auditService,
      new KnowledgeContextSummaryService(knowledgeRepository, knowledgeLedgerService),
    ]),
  );
  const knowledgeService = new KnowledgeBaseApplicationService(
    knowledgeRepository,
    knowledgeLedgerService,
    new M5ProjectionService(),
    config.projectSourceRoot === undefined
      ? undefined
      : new LocalProjectObservationAdapter({
          projectSourceRoot: config.projectSourceRoot,
        }),
    clock,
    idGenerator,
    auditService,
  );
  const workItemV2CreationService = new WorkItemV2CreationService(config, clock);
  const workItemV2BootstrapService = new WorkItemV2BootstrapService(
    config,
    workItemV2CreationService,
    workItemDocumentService,
    auditService,
    knowledgeService,
  );
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      instructions:
        'WS Workspace MCP provides secure local Work Item creation, controlled document lifecycle, auditable tracking, and Milestone 5 living-knowledge workflows. Identity is declared, project-source observation is read-only, and external integrations are not available.',
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
        const result = await workItemDocumentService.initialize(input);
        return asToolResult(result);
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
        const result = await workItemDocumentService.update(input);
        await knowledgeService.autoReopenForExternalMutation({
          workItemId: result.workItemId,
          trigger: 'update_work_item_document',
          idempotencyKey: idGenerator.generate(),
          cursor: {
            source: 'M3_DOCUMENT',
            documentType: result.document.documentType,
            revision: result.document.revision,
          },
        });
        return asToolResult(result);
      } catch (error) {
        if (error instanceof DocumentRevisionConflictError) {
          try {
            const current = await workItemDocumentService.getDocument({
              workItemId: input.workItemId,
              documentType: input.documentType,
            });
            await knowledgeService.autoReopenForExternalMutation({
              workItemId: current.workItemId,
              trigger: 'update_work_item_document',
              idempotencyKey: idGenerator.generate(),
              cursor: {
                source: 'M3_DOCUMENT',
                documentType: current.document.metadata.documentType,
                revision: current.document.metadata.revision,
              },
            });
          } catch (reconciliationError) {
            return asToolResult(foundationService.serializeError(reconciliationError), true);
          }
        }
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
        const result = await auditService.recordDecision(input);
        await knowledgeService.autoReopenForExternalMutation({
          workItemId: result.workItemId,
          trigger: 'record_decision',
          idempotencyKey: result.decisionId,
          cursor: {
            source: 'M4_AUDIT_ENTRY',
            entryId: result.decisionId,
            auditRevision: result.auditRevision,
          },
        });
        return asToolResult(result);
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
        const result = await auditService.recordCheckpoint(input);
        await knowledgeService.autoReopenForExternalMutation({
          workItemId: result.workItemId,
          trigger: 'record_checkpoint',
          idempotencyKey: result.checkpointId,
          cursor: {
            source: 'M4_AUDIT_ENTRY',
            entryId: result.checkpointId,
            auditRevision: result.auditRevision,
          },
        });
        return asToolResult(result);
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
        const result = await auditService.defineTestPlan(input);
        await knowledgeService.autoReopenForExternalMutation({
          workItemId: result.workItemId,
          trigger: 'define_test_plan',
          idempotencyKey: result.planVersionId,
          cursor: {
            source: 'M4_AUDIT_ENTRY',
            entryId: result.planVersionId,
            auditRevision: result.auditRevision,
          },
        });
        return asToolResult(result);
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
        const result = await auditService.recordTestExecution(input);
        await knowledgeService.autoReopenForExternalMutation({
          workItemId: result.workItemId,
          trigger: 'record_test_execution',
          idempotencyKey: result.testExecutionId,
          cursor: {
            source: 'M4_AUDIT_ENTRY',
            entryId: result.testExecutionId,
            auditRevision: result.auditRevision,
          },
        });
        return asToolResult(result);
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
        const result = await auditService.registerEvidenceReference(input);
        await knowledgeService.autoReopenForExternalMutation({
          workItemId: result.workItemId,
          trigger: 'register_evidence_reference',
          idempotencyKey: result.evidenceReferenceId,
          cursor: {
            source: 'M4_AUDIT_ENTRY',
            entryId: result.evidenceReferenceId,
            auditRevision: result.auditRevision,
          },
        });
        return asToolResult(result);
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

  const registerM5Tool = <Schema extends z.ZodObject>(
    name: string,
    description: string,
    inputSchema: Schema,
    handler: (input: z.output<Schema>) => Promise<unknown>,
  ): void => {
    const callback = async (input: z.output<Schema>) => {
      try {
        return asToolResult(await handler(input));
      } catch (error) {
        return asToolResult(foundationService.serializeError(error), true);
      }
    };
    server.registerTool(
      name,
      {
        description,
        inputSchema,
      } as never,
      callback as never,
    );
  };

  registerM5Tool(
    'create_work_item_v2',
    'Create a minimal es-ES Work Item in the iteration/type layout and initialize M3, M4, and M5.',
    CREATE_WORK_ITEM_V2_INPUT_SCHEMA,
    (input) => workItemV2BootstrapService.create(input),
  );

  registerM5Tool(
    'initialize_work_item_workflow',
    'Explicitly add a historical M3/M4 dossier to the M5 workflow without moving it.',
    INITIALIZE_WORKFLOW_SCHEMA,
    (input) => knowledgeService.initializeWorkflow(input),
  );
  registerM5Tool(
    'get_work_item_workflow',
    'Read canonical M5 state, iteration, participants, and lifecycle review.',
    GET_WORKFLOW_SCHEMA,
    (input) => knowledgeService.getWorkflow(input),
  );
  registerM5Tool(
    'activate_work_session',
    'Activate one developer session and atomically record its required technical snapshot.',
    ACTIVATE_SESSION_SCHEMA,
    (input) => knowledgeService.activateSession(input),
  );
  registerM5Tool(
    'switch_work_session',
    'Atomically checkpoint and suspend the active session, then snapshot and activate the target.',
    SWITCH_SESSION_SCHEMA,
    (input) => knowledgeService.switchSession(input),
  );
  registerM5Tool(
    'record_session_checkpoint',
    'Record a technical snapshot and immutable checkpoint for the active session.',
    RECORD_SESSION_CHECKPOINT_SCHEMA,
    (input) => knowledgeService.recordSessionCheckpoint(input),
  );
  registerM5Tool(
    'suspend_work_session',
    'Record a checkpoint and technical snapshot, then suspend the active session.',
    SUSPEND_SESSION_SCHEMA,
    (input) => knowledgeService.suspendSession(input),
  );
  registerM5Tool(
    'get_active_work_session',
    'Read the one active session for a declared participant.',
    GET_ACTIVE_SESSION_SCHEMA,
    (input) => knowledgeService.getActiveSession(input),
  );
  registerM5Tool(
    'resume_work_session_context',
    'Read the latest checkpoint, technical delta, and open semantic context for resumption.',
    RESUME_SESSION_CONTEXT_SCHEMA,
    (input) => knowledgeService.resumeSessionContext(input),
  );
  registerM5Tool(
    'add_work_item_collaborator',
    'Add one declared collaborator while preserving the single principal invariant.',
    ADD_COLLABORATOR_SCHEMA,
    (input) => knowledgeService.addCollaborator(input),
  );
  registerM5Tool(
    'remove_work_item_collaborator',
    'Remove one declared collaborator with an audited reason.',
    REMOVE_COLLABORATOR_SCHEMA,
    (input) => knowledgeService.removeCollaborator(input),
  );
  registerM5Tool(
    'transfer_work_item_responsibility',
    'Transfer principal responsibility with explicit confirmation and immutable history.',
    TRANSFER_RESPONSIBILITY_SCHEMA,
    (input) => knowledgeService.transferResponsibility(input),
  );
  registerM5Tool(
    'add_work_item_relation',
    'Add one semantic relation without changing either Work Item folder.',
    ADD_RELATION_SCHEMA,
    (input) => knowledgeService.addRelation(input),
  );
  registerM5Tool(
    'remove_work_item_relation',
    'Retire one relation append-only with an audited reason.',
    REMOVE_RELATION_SCHEMA,
    (input) => knowledgeService.removeRelation(input),
  );
  registerM5Tool(
    'propose_project_concept',
    'Propose a project concept with evidence; this never changes the official catalogue.',
    PROPOSE_CONCEPT_SCHEMA,
    (input) => knowledgeService.proposeConcept(input),
  );
  registerM5Tool(
    'resolve_project_concept_proposal',
    'Approve or reject a concept proposal with declared human authorization.',
    RESOLVE_CONCEPT_SCHEMA,
    (input) => knowledgeService.resolveConceptProposal(input),
  );
  registerM5Tool(
    'consolidate_work_item_dossier',
    'Persist structured human knowledge and regenerate the four protected M5 documents.',
    CONSOLIDATE_DOSSIER_SCHEMA,
    (input) => knowledgeService.consolidateDossier(input),
  );
  registerM5Tool(
    'review_work_item',
    'Record a blocking structural review and non-blocking semantic observations.',
    REVIEW_WORK_ITEM_SCHEMA,
    (input) => knowledgeService.reviewWorkItem(input),
  );
  registerM5Tool(
    'resolve_semantic_observation',
    'Resolve an open semantic observation with explicit declared-human confirmation.',
    RESOLVE_SEMANTIC_OBSERVATION_SCHEMA,
    (input) => knowledgeService.resolveSemanticObservation(input),
  );
  registerM5Tool(
    'complete_work_item',
    'Complete a structurally reviewed Work Item after explicit confirmation by its principal.',
    COMPLETE_WORK_ITEM_SCHEMA,
    (input) => knowledgeService.completeWorkItem(input),
  );
  registerM5Tool(
    'cancel_work_item',
    'Cancel an IN_PROGRESS Work Item without deleting its accumulated knowledge.',
    CANCEL_WORK_ITEM_SCHEMA,
    (input) => knowledgeService.cancelWorkItem(input),
  );
  registerM5Tool(
    'reopen_work_item',
    'Explicitly reopen a completed or cancelled Work Item while preserving lifecycle history.',
    REOPEN_WORK_ITEM_SCHEMA,
    (input) => knowledgeService.reopenWorkItem(input),
  );
  registerM5Tool(
    'get_related_knowledge',
    'Return deterministic related Work Items, concepts, components, and Golden candidates.',
    GET_RELATED_KNOWLEDGE_SCHEMA,
    (input) => knowledgeService.getRelatedKnowledge(input),
  );

  return server;
}

export async function startStdioServer(config: WorkspaceConfig): Promise<void> {
  const server = createMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
