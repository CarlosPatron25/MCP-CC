import { randomUUID } from 'node:crypto';
import { access, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

import { initializeWorkspace } from '../src/filesystem/workspace-initializer.js';
import { WorkItemV2CreationService } from '../src/services/work-item-v2-creation-service.js';
import { createTemporaryWorkspaceRoot, removeTemporaryWorkspaceRoot } from './helpers.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeTemporaryWorkspaceRoot));
});

function payload<T>(result: unknown): T {
  if (
    typeof result !== 'object' ||
    result === null ||
    !('content' in result) ||
    !Array.isArray(result.content) ||
    result.content[0]?.type !== 'text'
  ) {
    throw new Error('Expected an MCP text result.');
  }
  return JSON.parse(result.content[0].text) as T;
}

function isError(result: unknown): boolean {
  return (
    typeof result === 'object' && result !== null && 'isError' in result && result.isError === true
  );
}

function textContent(result: unknown): string {
  if (
    typeof result !== 'object' ||
    result === null ||
    !('content' in result) ||
    !Array.isArray(result.content) ||
    result.content[0]?.type !== 'text'
  ) {
    throw new Error('Expected an MCP text result.');
  }
  return result.content[0].text;
}

describe('Milestone 5 MCP stdio flow', () => {
  it('creates, observes, switches, suspends, governs, reviews, completes, and reopens', async () => {
    const workspaceRoot = await createTemporaryWorkspaceRoot();
    const sourceRoot = await createTemporaryWorkspaceRoot();
    roots.push(workspaceRoot, sourceRoot);
    await writeFile(resolve(sourceRoot, 'feature.ts'), 'export const feature = true;\n', 'utf8');
    const client = new Client({ name: 'm5-test-client', version: '0.1.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
          resolve(process.cwd(), 'src', 'index.ts'),
        ],
        env: {
          WS_WORKSPACE_ROOT: workspaceRoot,
          WS_PROJECT_SOURCE_ROOT: sourceRoot,
        },
      }),
    );

    const principal = { participantId: 'dev:carlos', displayName: 'Carlos' };
    const collaborator = { participantId: 'dev:ana', displayName: 'Ana' };
    let revision = 0;
    try {
      await client.callTool({ name: 'initialize_workspace', arguments: {} });
      const createAKey = randomUUID();
      const createAArguments = {
        type: 'USER_STORY' as const,
        rallyId: 'M5-101',
        title: 'Flujo M5',
        functionalDefinition: 'Validar el ciclo de conocimiento vivo.',
        iteration: { iterationId: 'Iteration 91', displayName: 'Iteración 91' },
        actor: principal,
        expectedKnowledgeRevision: revision,
        idempotencyKey: createAKey,
      };
      const createA = await client.callTool({
        name: 'create_work_item_v2',
        arguments: createAArguments,
      });
      expect(isError(createA), JSON.stringify(createA)).toBe(false);
      revision = payload<{ knowledgeRevision: number }>(createA).knowledgeRevision;
      expect(revision).toBe(1);
      expect(
        payload<{ knowledgeRevision: number; idempotent: boolean }>(
          await client.callTool({
            name: 'create_work_item_v2',
            arguments: createAArguments,
          }),
        ),
      ).toMatchObject({ knowledgeRevision: 1, idempotent: true });
      for (const changedRequest of [
        { ...createAArguments, type: 'DEFECT' as const },
        { ...createAArguments, rallyId: 'M5-101-CHANGED' },
        { ...createAArguments, title: 'Otro título' },
        {
          ...createAArguments,
          functionalDefinition: 'Una definición funcional diferente.',
        },
      ]) {
        const incompatibleRetry = await client.callTool({
          name: 'create_work_item_v2',
          arguments: changedRequest,
        });
        expect(isError(incompatibleRetry)).toBe(true);
        expect(payload<{ error: { code: string } }>(incompatibleRetry).error.code).toBe(
          'WORKFLOW_IDEMPOTENCY_CONFLICT',
        );
      }

      const legacyCollisionWithV2 = await client.callTool({
        name: 'create_work_item',
        arguments: {
          type: 'USER_STORY',
          rallyId: 'M5-101',
          title: 'No debe duplicarse',
          functionalDefinition: 'El alta legacy debe respetar la unicidad global.',
          developmentAlias: 'collision',
          relatedComponents: ['knowledge-base'],
          startedAt: '2026-07-28',
        },
      });
      expect(isError(legacyCollisionWithV2)).toBe(true);
      expect(payload<{ error: { code: string } }>(legacyCollisionWithV2).error.code).toBe(
        'WORK_ITEM_ALREADY_EXISTS',
      );

      const staleCreate = await client.callTool({
        name: 'create_work_item_v2',
        arguments: {
          type: 'DEFECT',
          rallyId: 'M5-STALE',
          title: 'No debe crearse',
          functionalDefinition: 'Una revisión obsoleta no puede dejar un dossier parcial.',
          iteration: { iterationId: 'Iteration 91' },
          actor: principal,
          expectedKnowledgeRevision: 0,
          idempotencyKey: randomUUID(),
        },
      });
      expect(isError(staleCreate)).toBe(true);
      expect(payload<{ error: { code: string } }>(staleCreate).error.code).toBe(
        'WORKFLOW_REVISION_CONFLICT',
      );
      await expect(
        access(
          resolve(workspaceRoot, '.ws-workspace', 'active', 'Iteration_91', 'DEFECT', 'M5-STALE'),
        ),
      ).rejects.toBeDefined();
      await client.callTool({
        name: 'create_work_item',
        arguments: {
          type: 'TECHNICAL_TASK',
          rallyId: 'M5-COLLIDE',
          title: 'Colisión histórica',
          functionalDefinition: 'El alta v2 no debe apropiarse de un dossier existente.',
          developmentAlias: 'collision',
          relatedComponents: ['knowledge-base'],
          startedAt: '2026-07-28',
        },
      });
      const historicalCollision = await client.callTool({
        name: 'create_work_item_v2',
        arguments: {
          type: 'TECHNICAL_TASK',
          rallyId: 'M5-COLLIDE',
          title: 'Colisión histórica',
          functionalDefinition: 'El alta v2 no debe apropiarse de un dossier existente.',
          iteration: { iterationId: 'Iteration 91' },
          actor: principal,
          expectedKnowledgeRevision: revision,
          idempotencyKey: randomUUID(),
        },
      });
      expect(isError(historicalCollision)).toBe(true);
      expect(payload<{ error: { code: string } }>(historicalCollision).error.code).toBe(
        'WORK_ITEM_ALREADY_EXISTS',
      );

      const activationKey = randomUUID();
      const activationArguments = {
        workItemId: 'M5-101',
        actor: principal,
        expectedKnowledgeRevision: revision,
        idempotencyKey: activationKey,
      };
      const activated = await client.callTool({
        name: 'activate_work_session',
        arguments: activationArguments,
      });
      expect(isError(activated)).toBe(false);
      const activation = payload<{
        knowledgeRevision: number;
        idempotent: boolean;
        snapshot: { files: Array<{ relativePath: string }> };
        lastCheckpoint: null;
        changesSinceLastCheckpoint: unknown[];
        relevantContext: string[];
        pendingQuestions: string[];
        openSemanticObservations: unknown[];
        review: { latest: null; current: boolean };
        dossier: { status: string; workItemRevision: number; latestConsolidationId: null };
      }>(activated);
      expect(activation.snapshot.files.map((entry) => entry.relativePath)).toContain('feature.ts');
      expect(activation).toMatchObject({
        lastCheckpoint: null,
        changesSinceLastCheckpoint: [],
        relevantContext: [],
        pendingQuestions: [],
        openSemanticObservations: [],
        review: { latest: null, current: false },
        dossier: {
          status: 'IN_PROGRESS',
          workItemRevision: expect.any(Number),
          latestConsolidationId: null,
        },
      });
      revision = activation.knowledgeRevision;

      const retry = payload<{ knowledgeRevision: number; idempotent: boolean }>(
        await client.callTool({
          name: 'activate_work_session',
          arguments: activationArguments,
        }),
      );
      expect(retry).toMatchObject({ knowledgeRevision: revision, idempotent: true });

      const added = await client.callTool({
        name: 'add_work_item_collaborator',
        arguments: {
          workItemId: 'M5-101',
          collaborator,
          actor: principal,
          expectedKnowledgeRevision: revision,
          idempotencyKey: randomUUID(),
        },
      });
      revision = payload<{ knowledgeRevision: number }>(added).knowledgeRevision;

      const createB = await client.callTool({
        name: 'create_work_item_v2',
        arguments: {
          type: 'TECHNICAL_TASK',
          rallyId: 'M5-102',
          title: 'Segundo contexto',
          functionalDefinition: 'Permitir el cambio de sesión.',
          iteration: { iterationId: 'Iteration 91' },
          actor: principal,
          expectedKnowledgeRevision: revision,
          idempotencyKey: randomUUID(),
        },
      });
      revision = payload<{ knowledgeRevision: number }>(createB).knowledgeRevision;

      const switched = await client.callTool({
        name: 'switch_work_session',
        arguments: {
          targetWorkItemId: 'M5-102',
          observedWork: ['Se observó feature.ts.'],
          relevantContext: ['Validación del ciclo M5.'],
          pendingQuestions: [],
          actor: principal,
          expectedKnowledgeRevision: revision,
          idempotencyKey: randomUUID(),
        },
      });
      const switchResult = payload<{
        sourceWorkItemId: string;
        targetWorkItemId: string;
        checkpointId: string;
        knowledgeRevision: number;
      }>(switched);
      expect(switchResult).toMatchObject({
        sourceWorkItemId: 'M5-101',
        targetWorkItemId: 'M5-102',
      });
      revision = switchResult.knowledgeRevision;

      const suspended = payload<{
        workItemId: string;
        status: string;
        snapshot: { kind: string };
        knowledgeRevision: number;
      }>(
        await client.callTool({
          name: 'suspend_work_session',
          arguments: {
            workItemId: 'M5-102',
            checkpointKind: 'CLOSURE',
            observedWork: ['Se cerró el segundo contexto de trabajo.'],
            relevantContext: ['No queda ninguna sesión activa.'],
            pendingQuestions: [],
            actor: principal,
            expectedKnowledgeRevision: revision,
            idempotencyKey: randomUUID(),
          },
        }),
      );
      expect(suspended).toMatchObject({
        workItemId: 'M5-102',
        status: 'SUSPENDED',
        snapshot: { kind: 'CLOSURE' },
      });
      revision = suspended.knowledgeRevision;

      const evidenceReferenceId = payload<{ evidenceReferenceId: string }>(
        await client.callTool({
          name: 'register_evidence_reference',
          arguments: {
            workItemId: 'M5-101',
            expectedAuditRevision: 0,
            idempotencyKey: 'm5-knowledge-evidence-1',
            label: 'M5 knowledge evidence',
            description: 'Logical evidence used by concept and relation knowledge.',
            logicalPath: 'evidence/m5/knowledge-evidence.txt',
            declaredActor: 'Carlos',
          },
        }),
      ).evidenceReferenceId;

      const relation = await client.callTool({
        name: 'add_work_item_relation',
        arguments: {
          sourceWorkItemId: 'M5-101',
          targetWorkItemId: 'M5-102',
          relationType: 'DEPENDS_ON',
          explanation: 'El flujo principal depende del segundo contexto.',
          evidenceReferenceIds: [evidenceReferenceId],
          provenance: {
            source: 'HUMAN_CONFIRMED',
            introducedBy: principal,
            confirmedBy: principal,
            evidenceReferenceIds: [evidenceReferenceId],
          },
          actor: principal,
          expectedKnowledgeRevision: revision,
          idempotencyKey: randomUUID(),
        },
      });
      expect(isError(relation), textContent(relation)).toBe(false);
      revision = payload<{ knowledgeRevision: number }>(relation).knowledgeRevision;

      const proposal = payload<{ proposalId: string; knowledgeRevision: number }>(
        await client.callTool({
          name: 'propose_project_concept',
          arguments: {
            workItemId: 'M5-101',
            displayName: 'Autenticación',
            explanation: 'Concepto detectado durante la validación.',
            evidenceReferenceIds: [evidenceReferenceId],
            actor: principal,
            expectedKnowledgeRevision: revision,
            idempotencyKey: randomUUID(),
          },
        }),
      );
      revision = proposal.knowledgeRevision;
      const rejected = await client.callTool({
        name: 'resolve_project_concept_proposal',
        arguments: {
          workItemId: 'M5-101',
          proposalId: proposal.proposalId,
          resolution: 'REJECTED',
          resolutionReason: 'La evidencia todavía no es suficiente.',
          confirmation: false,
          actor: principal,
          expectedKnowledgeRevision: revision,
          idempotencyKey: randomUUID(),
        },
      });
      revision = payload<{ knowledgeRevision: number }>(rejected).knowledgeRevision;

      const relatedResult = await client.callTool({
        name: 'get_related_knowledge',
        arguments: {
          workItemId: 'M5-101',
          concepts: ['Autenticación'],
        },
      });
      expect(isError(relatedResult), textContent(relatedResult)).toBe(false);
      const related = payload<{
        title?: string;
        knowledgeRevision: number;
        localConceptProposals: Array<{
          status: string;
          provenance: { source: string };
        }>;
        projectConcepts: unknown[];
        candidates: Array<{
          workItemId: string;
          relations: Array<{
            relationType: string;
            perspective: string;
            perspectiveRelationType: string;
            evidenceReferenceIds: string[];
            provenance: { source: string };
          }>;
        }>;
      }>(relatedResult);
      expect(related).not.toHaveProperty('title');
      expect(related.knowledgeRevision).toBe(revision);
      expect(related.localConceptProposals).toEqual([
        expect.objectContaining({
          status: 'REJECTED',
          provenance: expect.objectContaining({ source: 'MANUAL' }),
        }),
      ]);
      expect(related.projectConcepts).toEqual([]);
      expect(related.candidates).toEqual([
        expect.objectContaining({
          workItemId: 'M5-102',
          relations: [
            expect.objectContaining({
              relationType: 'DEPENDS_ON',
              perspective: 'OUTGOING',
              perspectiveRelationType: 'DEPENDS_ON',
              evidenceReferenceIds: [evidenceReferenceId],
              provenance: expect.objectContaining({ source: 'HUMAN_CONFIRMED' }),
            }),
          ],
        }),
      ]);
      expect(JSON.stringify(related)).not.toContain(workspaceRoot);
      expect(JSON.stringify(related)).not.toContain(sourceRoot);

      const preliminaryReview = payload<{
        result: string;
        semanticObservationIds: string[];
        knowledgeRevision: number;
      }>(
        await client.callTool({
          name: 'review_work_item',
          arguments: {
            workItemId: 'M5-101',
            semanticObservations: [
              {
                severity: 'INFO',
                explanation: 'La explicación puede ampliarse más adelante.',
                provenance: { source: 'AI_INFERRED' },
              },
            ],
            actor: principal,
            expectedKnowledgeRevision: revision,
            idempotencyKey: randomUUID(),
          },
        }),
      );
      expect(preliminaryReview.result).toBe('FAILED');
      revision = preliminaryReview.knowledgeRevision;
      const observationId = preliminaryReview.semanticObservationIds[0];
      expect(observationId).toEqual(expect.any(String));
      const resumableContext = payload<{
        lastCheckpoint: {
          checkpointId: string;
          kind: string;
          relevantContext: string[];
          pendingQuestions: string[];
        };
        lastSnapshot: { kind: string };
        changesSinceLastCheckpoint: unknown[];
        relevantContext: string[];
        pendingQuestions: string[];
        openSemanticObservations: Array<{ observationId: string; status: string }>;
        review: { latest: { reviewId: string; result: string }; current: boolean };
        dossier: { status: string; workItemRevision: number; latestConsolidationId: null };
      }>(
        await client.callTool({
          name: 'resume_work_session_context',
          arguments: {
            workItemId: 'M5-101',
            participantId: principal.participantId,
          },
        }),
      );
      expect(resumableContext).toMatchObject({
        lastCheckpoint: {
          checkpointId: switchResult.checkpointId,
          kind: 'AUTOMATIC_SWITCH',
          relevantContext: ['Validación del ciclo M5.'],
          pendingQuestions: [],
        },
        lastSnapshot: { kind: 'SWITCH' },
        changesSinceLastCheckpoint: [],
        relevantContext: ['Validación del ciclo M5.'],
        pendingQuestions: [],
        openSemanticObservations: [{ observationId, status: 'OPEN' }],
        review: {
          latest: {
            reviewId: expect.any(String),
            result: 'FAILED',
          },
          current: true,
        },
        dossier: {
          status: 'IN_PROGRESS',
          workItemRevision: expect.any(Number),
          latestConsolidationId: null,
        },
      });
      const resolvedObservation = payload<{
        status: string;
        observationId: string;
        knowledgeRevision: number;
      }>(
        await client.callTool({
          name: 'resolve_semantic_observation',
          arguments: {
            workItemId: 'M5-101',
            observationId,
            resolution: 'La observación queda preservada y resuelta por el principal.',
            confirmation: true,
            actor: principal,
            expectedKnowledgeRevision: revision,
            idempotencyKey: randomUUID(),
          },
        }),
      );
      expect(resolvedObservation).toMatchObject({
        status: 'RESOLVED',
        observationId,
      });
      revision = resolvedObservation.knowledgeRevision;

      const plan = payload<{
        planId: string;
        planRevision: number;
        testCases: Array<{ testCaseId: string }>;
        auditRevision: number;
      }>(
        await client.callTool({
          name: 'define_test_plan',
          arguments: {
            workItemId: 'M5-101',
            expectedAuditRevision: 1,
            idempotencyKey: 'm5-plan',
            expectedPlanRevision: 0,
            purpose: 'Validar el cierre M5.',
            declaredActor: 'Carlos',
            testCases: [
              {
                title: 'Flujo completo',
                objective: 'Comprobar el resultado.',
                verificationMethod: 'AUTOMATED',
                expectedOutcome: 'El flujo termina correctamente.',
              },
            ],
          },
        }),
      );
      await client.callTool({
        name: 'record_test_execution',
        arguments: {
          workItemId: 'M5-101',
          expectedAuditRevision: plan.auditRevision,
          expectedPlanRevision: plan.planRevision,
          idempotencyKey: 'm5-execution',
          planId: plan.planId,
          planRevision: plan.planRevision,
          testCaseId: plan.testCases[0]?.testCaseId,
          executionMethod: 'AUTOMATED',
          outcome: 'PASSED',
          summary: 'La batería M5 pasa.',
          declaredActor: 'Carlos',
        },
      });

      const consolidation = await client.callTool({
        name: 'consolidate_work_item_dossier',
        arguments: {
          workItemId: 'M5-101',
          functionalOverview: {
            purpose: 'Conservar conocimiento útil.',
            actualBehavior: 'Gestiona una sesión y sus checkpoints.',
            functionalFlow: ['Activar', 'Trabajar', 'Cambiar'],
            entryConditions: ['Workspace inicializado'],
            businessRules: ['Una sesión activa por desarrollador'],
            testData: ['Dos Work Items'],
            relatedWorkItemIds: ['M5-102'],
          },
          implementation: {
            components: [
              {
                name: 'KnowledgeBaseApplicationService',
                type: 'TypeScript',
                responsibility: 'Aplicar el ciclo M5.',
                changes: ['Añade sesiones y cierre.'],
              },
            ],
            dependencies: ['Ledger M4'],
            implementationDecisions: ['Ledger M5 separado.'],
            technicalFlow: ['MCP → aplicación → repositorio'],
          },
          testing: {
            preconditions: ['Workspace temporal'],
            testData: ['M5-101'],
            scenarios: [
              {
                title: 'Cambio seguro',
                steps: ['Activar', 'Cambiar'],
                expectedOutcome: 'Checkpoint confirmado.',
              },
            ],
            regressionChecks: ['Herramientas históricas'],
            evidenceReferenceIds: [],
            closureChecklist: ['Plan M4 superado'],
          },
          provenance: {
            source: 'HUMAN_CONFIRMED',
            introducedBy: principal,
            confirmedBy: principal,
          },
          actor: principal,
          expectedKnowledgeRevision: revision,
          idempotencyKey: randomUUID(),
        },
      });
      revision = payload<{ knowledgeRevision: number }>(consolidation).knowledgeRevision;

      const reviewed = payload<{
        reviewId: string;
        result: string;
        findings: unknown[];
        knowledgeRevision: number;
      }>(
        await client.callTool({
          name: 'review_work_item',
          arguments: {
            workItemId: 'M5-101',
            semanticObservations: [],
            actor: principal,
            expectedKnowledgeRevision: revision,
            idempotencyKey: randomUUID(),
          },
        }),
      );
      expect(reviewed).toMatchObject({ result: 'PASSED', findings: [] });
      revision = reviewed.knowledgeRevision;

      const unauthorized = await client.callTool({
        name: 'complete_work_item',
        arguments: {
          workItemId: 'M5-101',
          structuralReviewId: reviewed.reviewId,
          confirmation: true,
          actor: collaborator,
          expectedKnowledgeRevision: revision,
          idempotencyKey: randomUUID(),
        },
      });
      expect(isError(unauthorized)).toBe(true);
      expect(payload<{ error: { code: string } }>(unauthorized).error.code).toBe(
        'PARTICIPANT_NOT_AUTHORIZED',
      );

      const completed = payload<{ status: string; knowledgeRevision: number }>(
        await client.callTool({
          name: 'complete_work_item',
          arguments: {
            workItemId: 'M5-101',
            structuralReviewId: reviewed.reviewId,
            confirmation: true,
            actor: principal,
            expectedKnowledgeRevision: revision,
            idempotencyKey: randomUUID(),
          },
        }),
      );
      expect(completed.status).toBe('COMPLETED');
      revision = completed.knowledgeRevision;

      const initializationAfterCompletion = await client.callTool({
        name: 'initialize_work_item_documents',
        arguments: { workItemId: 'M5-101' },
      });
      expect(isError(initializationAfterCompletion)).toBe(false);
      const unchangedAfterInitialization = payload<{
        status: string;
        knowledgeRevision: number;
      }>(
        await client.callTool({
          name: 'get_work_item_workflow',
          arguments: { workItemId: 'M5-101' },
        }),
      );
      expect(unchangedAfterInitialization).toMatchObject({
        status: 'COMPLETED',
        knowledgeRevision: revision,
      });

      const historicalMutationArguments = {
        workItemId: 'M5-101',
        expectedAuditRevision: 3,
        idempotencyKey: 'm5-post-completion-decision',
        kind: 'DECISION',
        title: 'Ajuste posterior',
        decision: 'Conservar el puente de reapertura M4/M5.',
        rationale: 'Una mutación sustantiva histórica debe reabrir.',
        declaredActor: 'Carlos',
      };
      const historicalMutation = await client.callTool({
        name: 'record_decision',
        arguments: historicalMutationArguments,
      });
      expect(isError(historicalMutation)).toBe(false);
      const reopened = payload<{ status: string; knowledgeRevision: number }>(
        await client.callTool({
          name: 'get_work_item_workflow',
          arguments: { workItemId: 'M5-101' },
        }),
      );
      expect(reopened.status).toBe('IN_PROGRESS');
      expect(reopened.knowledgeRevision).toBe(revision + 1);
      expect(
        payload<{ idempotent: boolean }>(
          await client.callTool({
            name: 'record_decision',
            arguments: historicalMutationArguments,
          }),
        ).idempotent,
      ).toBe(true);
      await expect(
        client
          .callTool({
            name: 'get_work_item_workflow',
            arguments: { workItemId: 'M5-101' },
          })
          .then((result) => payload<{ status: string; knowledgeRevision: number }>(result)),
      ).resolves.toMatchObject({
        status: 'IN_PROGRESS',
        knowledgeRevision: reopened.knowledgeRevision,
      });
      const aiContext = payload<{
        document: { metadata: { revision: number } };
      }>(
        await client.callTool({
          name: 'get_work_item_document',
          arguments: { workItemId: 'M5-101', documentType: 'AI_CONTEXT' },
        }),
      );
      await expect(
        access(resolve(workspaceRoot, '.ws-workspace', '.locks', 'M5-KNOWLEDGE.lifecycle.lock')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        access(resolve(workspaceRoot, '.ws-workspace', '.locks', 'M5-101.lifecycle.lock')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      const refreshContextResult = await client.callTool({
        name: 'refresh_ai_context',
        arguments: {
          workItemId: 'M5-101',
          expectedRevision: aiContext.document.metadata.revision,
        },
      });
      expect(isError(refreshContextResult), JSON.stringify(refreshContextResult)).toBe(false);
      const refreshedContextResult = await client.callTool({
        name: 'get_work_item_document',
        arguments: { workItemId: 'M5-101', documentType: 'AI_CONTEXT' },
      });
      expect(isError(refreshedContextResult), JSON.stringify(refreshedContextResult)).toBe(false);
      const refreshedContext = payload<{ document: { content: string } }>(refreshedContextResult);
      expect(refreshedContext.document.content).toContain('Resumen de conocimiento de Milestone 5');
      expect(JSON.stringify(reopened)).not.toContain(workspaceRoot);
      expect(JSON.stringify(reopened)).not.toContain(sourceRoot);

      await unlink(
        resolve(
          workspaceRoot,
          '.ws-workspace',
          'active',
          'Iteration_91',
          'USER_STORY',
          'M5-101',
          '09_FINAL_REPORT.md',
        ),
      );
      const corruptExactRetry = await client.callTool({
        name: 'create_work_item_v2',
        arguments: createAArguments,
      });
      expect(isError(corruptExactRetry)).toBe(true);
      expect(payload<{ error: { code: string } }>(corruptExactRetry).error.code).toBe(
        'KNOWLEDGE_BASE_CORRUPT',
      );
    } finally {
      await client.close();
    }
  }, 30_000);

  it('returns standard MCP InvalidParams before application validation for a malformed M5 input', async () => {
    const workspaceRoot = await createTemporaryWorkspaceRoot();
    roots.push(workspaceRoot);
    const client = new Client({ name: 'm5-schema-test-client', version: '0.1.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
          resolve(process.cwd(), 'src', 'index.ts'),
        ],
        env: {
          WS_WORKSPACE_ROOT: workspaceRoot,
        },
      }),
    );

    try {
      const result = await client.callTool({
        name: 'create_work_item_v2',
        arguments: { unexpected: true },
      });
      expect(isError(result)).toBe(true);
      const text = textContent(result);
      expect(text).toContain('Input validation error');
      expect(text).not.toContain(workspaceRoot);
    } finally {
      await client.close();
    }
  });

  it('resumes an exact crash-visible v2 bootstrap after the global revision advances', async () => {
    const workspaceRoot = await createTemporaryWorkspaceRoot();
    roots.push(workspaceRoot);
    await initializeWorkspace(workspaceRoot);
    const actor = { participantId: 'dev:recovery', displayName: 'Recovery Developer' };
    const partialArguments = {
      type: 'DEFECT' as const,
      rallyId: 'M5-RECOVER',
      title: 'Recover an interrupted bootstrap',
      functionalDefinition: 'Resume only the exact request after a process crash.',
      iteration: { iterationId: 'Recovery Iteration' },
      actor,
      expectedKnowledgeRevision: 0,
      idempotencyKey: '70000000-0000-4000-8000-000000000001',
    };
    await new WorkItemV2CreationService(
      { workspaceRoot },
      { now: () => '2026-07-28T12:00:00.000Z' },
    ).createDossier(partialArguments);

    const client = new Client({ name: 'm5-recovery-test-client', version: '0.1.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
          resolve(process.cwd(), 'src', 'index.ts'),
        ],
        env: { WS_WORKSPACE_ROOT: workspaceRoot },
      }),
    );

    try {
      const pendingDocuments = await client.callTool({
        name: 'initialize_work_item_documents',
        arguments: { workItemId: 'M5-RECOVER' },
      });
      expect(isError(pendingDocuments)).toBe(true);
      expect(payload<{ error: { code: string } }>(pendingDocuments).error.code).toBe(
        'DOCUMENT_LIFECYCLE_CONFLICT',
      );

      const pendingTracking = await client.callTool({
        name: 'initialize_work_item_tracking',
        arguments: { workItemId: 'M5-RECOVER' },
      });
      expect(isError(pendingTracking)).toBe(true);
      expect(payload<{ error: { code: string } }>(pendingTracking).error.code).toBe(
        'AUDIT_TRACKING_CONFLICT',
      );

      const otherActor = { participantId: 'dev:other', displayName: 'Other Developer' };
      const attemptedAdoption = await client.callTool({
        name: 'initialize_work_item_workflow',
        arguments: {
          workItemId: 'M5-RECOVER',
          iteration: {
            iterationId: 'Recovery Iteration',
            storageToken: 'Recovery_Iteration',
          },
          responsible: otherActor,
          classification: 'STANDARD',
          actor: otherActor,
          expectedKnowledgeRevision: 0,
          idempotencyKey: '70000000-0000-4000-8000-000000000003',
        },
      });
      expect(isError(attemptedAdoption)).toBe(true);
      expect(payload<{ error: { code: string } }>(attemptedAdoption).error.code).toBe(
        'KNOWLEDGE_BASE_CONFLICT',
      );

      const intervening = await client.callTool({
        name: 'create_work_item_v2',
        arguments: {
          type: 'TECHNICAL_TASK',
          rallyId: 'M5-INTERVENING',
          title: 'Advance the global revision',
          functionalDefinition: 'Create a distinct workflow before the interrupted retry.',
          iteration: { iterationId: 'Recovery Iteration' },
          actor,
          expectedKnowledgeRevision: 0,
          idempotencyKey: '70000000-0000-4000-8000-000000000002',
        },
      });
      expect(payload<{ knowledgeRevision: number }>(intervening).knowledgeRevision).toBe(1);

      const recovered = await client.callTool({
        name: 'create_work_item_v2',
        arguments: partialArguments,
      });
      expect(isError(recovered), JSON.stringify(recovered)).toBe(false);
      expect(payload<{ knowledgeRevision: number }>(recovered).knowledgeRevision).toBe(2);
      const recoveredManifest = await readFile(
        resolve(
          workspaceRoot,
          '.ws-workspace',
          'active',
          'Recovery_Iteration',
          'DEFECT',
          'M5-RECOVER',
          '00_MANIFEST.md',
        ),
        'utf8',
      );
      expect(recoveredManifest).toContain('status=COMPLETE');
      expect(recoveredManifest).not.toContain('status=PENDING');
    } finally {
      await client.close();
    }
  });
});
