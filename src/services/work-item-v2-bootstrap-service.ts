import type { WorkspaceConfig } from '../config/workspace-config.js';
import {
  KnowledgeBaseConflictError,
  KnowledgeBaseCorruptError,
  KnowledgeBaseUpdateError,
} from '../filesystem/local-filesystem-knowledge-base-repository.js';
import { WorkspaceKnowledgeOperationGate } from '../filesystem/workspace-knowledge-operation-gate.js';
import { ALL_DOSSIER_TRANSACTION_RELATIVE_PATHS } from '../filesystem/workspace-transaction-paths.js';
import {
  WorkItemAlreadyExistsError,
  WorkItemValidationError,
  WorkspaceError,
} from '../errors/workspace-error.js';
import { fingerprintAuditPayload } from './audit-ledger-service.js';
import type { KnowledgeBaseApplicationService } from './knowledge-base-application-service.js';
import type { WorkItemAuditService } from './work-item-audit-service.js';
import type { WorkItemDocumentService } from './work-item-document-service.js';
import { withWorkItemV2BootstrapAccess } from './work-item-v2-bootstrap-marker.js';
import {
  CREATE_WORK_ITEM_V2_INPUT_SCHEMA,
  normalizeIterationStorageToken,
  type WorkItemV2CreationService,
} from './work-item-v2-creation-service.js';
import { normalizeWorkItemId } from './work-item-creation-service.js';

export interface WorkItemV2BootstrapResult {
  workItemId: string;
  status: 'IN_PROGRESS';
  knowledgeRevision: number;
  idempotent: boolean;
}

/**
 * Owns the phased, recoverable M2→M3→M4→M5 bootstrap boundary. Revision and
 * idempotency are checked while the workspace knowledge gate is held. A
 * crash-visible partial dossier is bound to the full normalized request by a
 * persisted fingerprint and can be resumed only by that exact request.
 */
export class WorkItemV2BootstrapService {
  private readonly gate: WorkspaceKnowledgeOperationGate;
  private readonly workspaceRoot: string;

  public constructor(
    config: WorkspaceConfig,
    private readonly creationService: WorkItemV2CreationService,
    private readonly documentService: WorkItemDocumentService,
    private readonly auditService: WorkItemAuditService,
    private readonly knowledgeService: KnowledgeBaseApplicationService,
  ) {
    this.workspaceRoot = config.workspaceRoot;
    this.gate = new WorkspaceKnowledgeOperationGate({
      workspaceRoot: config.workspaceRoot,
      conflictError: () => new KnowledgeBaseConflictError(),
      updateError: () => new KnowledgeBaseUpdateError(),
      recoveryError: () => new KnowledgeBaseCorruptError(),
    });
  }

  public async create(input: unknown): Promise<WorkItemV2BootstrapResult> {
    const parsed = CREATE_WORK_ITEM_V2_INPUT_SCHEMA.safeParse(input);
    if (!parsed.success) {
      throw new WorkItemValidationError('The Work Item v2 input is invalid.', {
        field: parsed.error.issues[0]?.path.join('.') || 'input',
      });
    }
    const value = parsed.data;
    const workItemId = normalizeWorkItemId(value.rallyId);
    const iterationStorageToken = normalizeIterationStorageToken(value.iteration.iterationId);
    const requestFingerprint = fingerprintAuditPayload(value);
    const workflowInput = {
      workItemId,
      iteration: {
        iterationId: value.iteration.iterationId,
        ...(value.iteration.displayName === undefined
          ? {}
          : { displayName: value.iteration.displayName }),
        storageToken: iterationStorageToken,
      },
      responsible: value.actor,
      classification: 'STANDARD' as const,
      expectedKnowledgeRevision: value.expectedKnowledgeRevision,
      idempotencyKey: value.idempotencyKey,
      actor: value.actor,
    };
    const dossierPrefix = `active/${iterationStorageToken}/${value.type}/${workItemId}`;
    const additionalAllowedPaths = ALL_DOSSIER_TRANSACTION_RELATIVE_PATHS.map(
      (relativePath) => `${dossierPrefix}/${relativePath}`,
    );

    return this.gate.runExclusive(async () => {
      let effectiveWorkflowInput = workflowInput;
      let recoverableStaleBootstrap = false;
      let retry: Record<string, unknown> | undefined;
      try {
        retry = await this.knowledgeService.preflightCreatedWorkflow(workflowInput, value);
      } catch (error) {
        if (
          !(error instanceof WorkspaceError) ||
          error.code !== 'WORKFLOW_REVISION_CONFLICT' ||
          !(await this.creationService.isExactRecoverableDossier(value))
        ) {
          throw error;
        }
        recoverableStaleBootstrap = true;
        effectiveWorkflowInput = {
          ...workflowInput,
          expectedKnowledgeRevision:
            await this.knowledgeService.currentKnowledgeRevisionForBootstrap(),
        };
      }
      if (retry !== undefined) {
        return {
          workItemId,
          status: 'IN_PROGRESS',
          knowledgeRevision: Number(retry.knowledgeRevision),
          idempotent: true,
        };
      }

      return withWorkItemV2BootstrapAccess(
        this.workspaceRoot,
        workItemId,
        requestFingerprint,
        async () => {
          let created: Awaited<ReturnType<WorkItemV2CreationService['createDossier']>> | undefined;
          if (!recoverableStaleBootstrap) {
            try {
              created = await this.creationService.createDossier(value);
            } catch (error) {
              if (!(error instanceof WorkItemAlreadyExistsError)) {
                throw error;
              }
              await this.creationService.assertRecoverableDossier(value);
            }
          }

          try {
            await this.documentService.initialize({ workItemId });
            await this.auditService.initialize({ workItemId });
            const workflow = await this.knowledgeService.initializeCreatedWorkflow(
              effectiveWorkflowInput,
              value,
            );
            return {
              workItemId,
              status: workflow.status,
              knowledgeRevision: workflow.knowledgeRevision,
              idempotent: workflow.idempotent,
            };
          } catch (error) {
            if (created !== undefined) {
              try {
                await this.creationService.rollbackCreatedDossier(created);
              } catch {
                throw new KnowledgeBaseUpdateError(
                  'The failed Work Item v2 bootstrap could not be rolled back safely.',
                );
              }
            }
            throw error;
          }
        },
      );
    }, additionalAllowedPaths);
  }
}
