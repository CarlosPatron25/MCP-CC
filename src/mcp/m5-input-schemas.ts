import { z } from 'zod';

import {
  KNOWLEDGE_CLASSIFICATIONS,
  SEMANTIC_OBSERVATION_SEVERITIES,
  WORK_ITEM_RELATION_TYPES,
} from '../domain/work-item-knowledge.js';
import { UUID_V4_PATTERN } from '../services/id-generator.js';
import { M5_SHORT_TEXT_SCHEMA, M5_TEXT_SCHEMA } from '../services/m5-text-policy.js';

const text = M5_TEXT_SCHEMA;
const shortText = M5_SHORT_TEXT_SCHEMA;
const participantId = z.string().regex(/^[A-Za-z0-9._:@-]{1,128}$/);
export const M5_PARTICIPANT_SCHEMA = z
  .object({
    participantId,
    displayName: shortText,
  })
  .strict();
const revision = z.number().int().nonnegative();
const idempotencyKey = z.string().regex(UUID_V4_PATTERN);
const stringList = z.array(text).max(500).default([]);
const evidenceIds = z.array(z.string().regex(UUID_V4_PATTERN)).max(500).optional();
const basedOnKnowledgeIds = z.array(z.string().regex(UUID_V4_PATTERN)).max(500).optional();
const absentParticipant = z.never().optional();
const provenanceReferences = {
  evidenceReferenceIds: evidenceIds,
  basedOnKnowledgeIds,
} as const;

export const M5_PROVENANCE_SCHEMA = z.discriminatedUnion('source', [
  z
    .object({
      source: z.literal('MANUAL'),
      introducedBy: M5_PARTICIPANT_SCHEMA,
      confirmedBy: absentParticipant,
      ...provenanceReferences,
    })
    .strict(),
  z
    .object({
      source: z.literal('AI_INFERRED'),
      introducedBy: absentParticipant,
      confirmedBy: absentParticipant,
      ...provenanceReferences,
    })
    .strict(),
  z
    .object({
      source: z.literal('HUMAN_CONFIRMED'),
      introducedBy: M5_PARTICIPANT_SCHEMA.optional(),
      confirmedBy: M5_PARTICIPANT_SCHEMA,
      ...provenanceReferences,
    })
    .strict(),
  z
    .object({
      source: z.literal('SYSTEM_CALCULATED'),
      introducedBy: absentParticipant,
      confirmedBy: absentParticipant,
      ...provenanceReferences,
    })
    .strict(),
  z
    .object({
      source: z.literal('IMPORTED_PENDING_VALIDATION'),
      introducedBy: M5_PARTICIPANT_SCHEMA.optional(),
      confirmedBy: absentParticipant,
      ...provenanceReferences,
    })
    .strict(),
]);
const provenance = M5_PROVENANCE_SCHEMA;
const mutationBase = {
  expectedKnowledgeRevision: revision,
  idempotencyKey,
  actor: M5_PARTICIPANT_SCHEMA,
} as const;

export const INITIALIZE_WORKFLOW_SCHEMA = z
  .object({
    workItemId: shortText,
    iteration: z
      .object({
        iterationId: shortText,
        displayName: shortText.optional(),
        storageToken: shortText,
      })
      .strict(),
    responsible: M5_PARTICIPANT_SCHEMA,
    classification: z.enum(KNOWLEDGE_CLASSIFICATIONS).default('STANDARD'),
    ...mutationBase,
  })
  .strict();

export const GET_WORKFLOW_SCHEMA = z.object({ workItemId: shortText }).strict();

export const ACTIVATE_SESSION_SCHEMA = z
  .object({ workItemId: shortText, ...mutationBase })
  .strict();

export const SWITCH_SESSION_SCHEMA = z
  .object({
    targetWorkItemId: shortText,
    observedWork: stringList,
    relevantContext: stringList,
    pendingQuestions: stringList,
    semanticSummary: text.optional(),
    ...mutationBase,
  })
  .strict();

export const RECORD_SESSION_CHECKPOINT_SCHEMA = z
  .object({
    workItemId: shortText,
    observedWork: stringList,
    relevantContext: stringList,
    pendingQuestions: stringList,
    semanticSummary: text.optional(),
    ...mutationBase,
  })
  .strict();

export const SUSPEND_SESSION_SCHEMA = z
  .object({
    workItemId: shortText,
    checkpointKind: z.enum(['MANUAL', 'CLOSURE']).default('MANUAL'),
    observedWork: stringList,
    relevantContext: stringList,
    pendingQuestions: stringList,
    semanticSummary: text.optional(),
    ...mutationBase,
  })
  .strict();

export const GET_ACTIVE_SESSION_SCHEMA = z.object({ participantId }).strict();

export const RESUME_SESSION_CONTEXT_SCHEMA = z
  .object({ workItemId: shortText, participantId })
  .strict();

export const ADD_COLLABORATOR_SCHEMA = z
  .object({
    workItemId: shortText,
    collaborator: M5_PARTICIPANT_SCHEMA,
    ...mutationBase,
  })
  .strict();

export const REMOVE_COLLABORATOR_SCHEMA = z
  .object({
    workItemId: shortText,
    collaboratorId: participantId,
    reason: text,
    ...mutationBase,
  })
  .strict();

export const TRANSFER_RESPONSIBILITY_SCHEMA = z
  .object({
    workItemId: shortText,
    newResponsible: M5_PARTICIPANT_SCHEMA,
    reason: text,
    confirmation: z.literal(true),
    ...mutationBase,
  })
  .strict();

export const ADD_RELATION_SCHEMA = z
  .object({
    sourceWorkItemId: shortText,
    targetWorkItemId: shortText,
    relationType: z.enum(WORK_ITEM_RELATION_TYPES),
    explanation: text,
    evidenceReferenceIds: evidenceIds,
    provenance,
    ...mutationBase,
  })
  .strict();

export const REMOVE_RELATION_SCHEMA = z
  .object({
    relationId: z.string().regex(UUID_V4_PATTERN),
    reason: text,
    ...mutationBase,
  })
  .strict();

export const PROPOSE_CONCEPT_SCHEMA = z
  .object({
    workItemId: shortText,
    displayName: shortText,
    explanation: text,
    evidenceReferenceIds: z.array(z.string().regex(UUID_V4_PATTERN)).min(1).max(500),
    ...mutationBase,
  })
  .strict();

export const RESOLVE_CONCEPT_SCHEMA = z
  .object({
    workItemId: shortText,
    proposalId: z.string().regex(UUID_V4_PATTERN),
    resolution: z.enum(['APPROVED', 'REJECTED']),
    resolutionReason: text,
    confirmation: z.boolean(),
    ...mutationBase,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.resolution === 'APPROVED' && !value.confirmation) {
      context.addIssue({
        code: 'custom',
        path: ['confirmation'],
        message: 'Approval requires explicit confirmation.',
      });
    }
  });

const consolidatedComponent = z
  .object({
    name: shortText,
    type: shortText,
    responsibility: text,
    changes: stringList,
  })
  .strict();
const testScenario = z
  .object({
    title: shortText,
    steps: stringList,
    expectedOutcome: text,
  })
  .strict();
export const CONSOLIDATE_DOSSIER_SCHEMA = z
  .object({
    workItemId: shortText,
    functionalOverview: z
      .object({
        purpose: text.optional(),
        actualBehavior: text.optional(),
        functionalFlow: stringList,
        entryConditions: stringList,
        businessRules: stringList,
        testData: stringList,
        relatedWorkItemIds: z.array(shortText).max(500).default([]),
      })
      .strict(),
    implementation: z
      .object({
        components: z.array(consolidatedComponent).max(500).default([]),
        dependencies: stringList,
        implementationDecisions: stringList,
        technicalFlow: stringList,
      })
      .strict(),
    testing: z
      .object({
        preconditions: stringList,
        testData: stringList,
        scenarios: z.array(testScenario).max(500).default([]),
        regressionChecks: stringList,
        evidenceReferenceIds: z.array(z.string().regex(UUID_V4_PATTERN)).max(500).default([]),
        closureChecklist: stringList,
      })
      .strict(),
    provenance,
    ...mutationBase,
  })
  .strict();

export const REVIEW_WORK_ITEM_SCHEMA = z
  .object({
    workItemId: shortText,
    semanticObservations: z
      .array(
        z
          .object({
            severity: z.enum(SEMANTIC_OBSERVATION_SEVERITIES),
            explanation: text,
            evidenceReferenceIds: evidenceIds,
            provenance,
          })
          .strict(),
      )
      .max(100)
      .default([]),
    ...mutationBase,
  })
  .strict();

export const RESOLVE_SEMANTIC_OBSERVATION_SCHEMA = z
  .object({
    workItemId: shortText,
    observationId: z.string().regex(UUID_V4_PATTERN),
    resolution: text,
    confirmation: z.literal(true),
    ...mutationBase,
  })
  .strict();

export const COMPLETE_WORK_ITEM_SCHEMA = z
  .object({
    workItemId: shortText,
    structuralReviewId: z.string().regex(UUID_V4_PATTERN),
    confirmation: z.literal(true),
    ...mutationBase,
  })
  .strict();

export const CANCEL_WORK_ITEM_SCHEMA = z
  .object({
    workItemId: shortText,
    reason: text,
    confirmation: z.literal(true),
    ...mutationBase,
  })
  .strict();

export const REOPEN_WORK_ITEM_SCHEMA = z
  .object({
    workItemId: shortText,
    reason: text,
    confirmation: z.literal(true),
    ...mutationBase,
  })
  .strict();

export const GET_RELATED_KNOWLEDGE_SCHEMA = z
  .object({
    workItemId: shortText,
    concepts: z.array(shortText).max(100).default([]),
  })
  .strict();
