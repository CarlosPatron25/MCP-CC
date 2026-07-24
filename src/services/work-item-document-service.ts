import { z } from 'zod';

import {
  INITIALIZABLE_DOCUMENT_TYPES,
  isEditableDocumentType,
  isManagedDocumentType,
  type DocumentInitializationResult,
  type DocumentMutationResult,
  type DocumentReadResult,
  type EditableDocumentPayload,
  type ManagedDocument,
} from '../domain/work-item-document.js';
import {
  AuditTrackingConflictError,
  DocumentLifecycleConflictError,
  DocumentNotInitializedError,
  DocumentRevisionConflictError,
  DocumentTypeUnsupportedError,
  DocumentValidationError,
} from '../errors/workspace-error.js';
import type { AIContextProjectionService } from './ai-context-projection-service.js';
import type { DocumentTemplateService } from './document-template-service.js';
import type { ManifestLifecycleService } from './manifest-lifecycle-service.js';
import type { WorkItemDossierRepository } from './work-item-dossier-repository.js';

const SAFE_WORK_ITEM_ID = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const requiredText = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1));
const optionalText = z
  .string()
  .optional()
  .transform((value) =>
    value === undefined || value.trim().length === 0 ? undefined : value.trim(),
  );
const requiredTextList = z
  .array(requiredText)
  .transform((values) => [...new Set(values)].sort((left, right) => left.localeCompare(right)))
  .pipe(z.array(z.string()).min(1));
const optionalTextList = z
  .array(requiredText)
  .optional()
  .transform((values) => {
    if (values === undefined) {
      return undefined;
    }
    const normalized = [...new Set(values)].sort((left, right) => left.localeCompare(right));
    return normalized.length === 0 ? undefined : normalized;
  });
const isoDate = z.string().regex(ISO_DATE_PATTERN);

const workItemIdSchema = z.string().regex(SAFE_WORK_ITEM_ID);
const expectedRevisionSchema = z.number().int().positive();

const functionalAnalysisPayloadSchema = z
  .object({
    functionalDefinition: requiredText,
    acceptanceCriteria: optionalTextList,
    additionalBusinessInformation: optionalText,
    relatedComponents: requiredTextList,
    developmentAlias: requiredText,
    responsiblePerson: optionalText,
    startedAt: isoDate,
    plannedCompletionAt: isoDate.optional(),
  })
  .strict()
  .superRefine((payload, context) => {
    if (
      payload.plannedCompletionAt !== undefined &&
      payload.plannedCompletionAt < payload.startedAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['plannedCompletionAt'],
        message: 'Must not be earlier than startedAt.',
      });
    }
  });
const currentStatePayloadSchema = z
  .object({
    knownFacts: requiredTextList,
    constraints: optionalTextList,
    openQuestions: optionalTextList,
  })
  .strict();
const technicalAnalysisPayloadSchema = z
  .object({
    knownFacts: requiredTextList,
    declaredHypotheses: optionalTextList,
    dependencies: optionalTextList,
    openQuestions: optionalTextList,
  })
  .strict();
const impactAnalysisPayloadSchema = z
  .object({
    affectedComponents: requiredTextList,
    knownImpacts: optionalTextList,
    openQuestions: optionalTextList,
  })
  .strict();
const implementationPlanPayloadSchema = z
  .object({
    plannedSteps: requiredTextList,
    prerequisites: optionalTextList,
    openQuestions: optionalTextList,
  })
  .strict();

const initializeInputSchema = z.object({ workItemId: workItemIdSchema }).strict();
const getDocumentInputSchema = z
  .object({ workItemId: workItemIdSchema, documentType: z.string() })
  .strict();
const updateDocumentInputSchema = z
  .object({
    workItemId: workItemIdSchema,
    documentType: z.string(),
    expectedRevision: expectedRevisionSchema,
    payload: z.unknown(),
  })
  .strict();
const refreshAiContextInputSchema = z
  .object({ workItemId: workItemIdSchema, expectedRevision: expectedRevisionSchema })
  .strict();

type UpdateInput = z.output<typeof updateDocumentInputSchema>;

export interface InitializeWorkItemDocumentsResult extends DocumentInitializationResult {
  workItemId: string;
}

export interface GetWorkItemDocumentResult {
  workItemId: string;
  document: DocumentReadResult;
}

export interface UpdateWorkItemDocumentResult {
  workItemId: string;
  document: DocumentMutationResult;
}

export interface AuditContextSummaryProvider {
  getContextSummary(workItemId: string): Promise<string | undefined>;
}

function toValidationError(error: z.ZodError): DocumentValidationError {
  const firstIssue = error.issues[0];
  const field = firstIssue?.path.join('.') || 'input';
  return new DocumentValidationError('The document request is invalid.', { field });
}

function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw toValidationError(parsed.error);
  }
  return parsed.data;
}

function toMutationResult(document: ManagedDocument): DocumentMutationResult {
  return {
    documentType: document.metadata.documentType,
    relativePath: document.metadata.relativePath,
    status: document.metadata.status,
    revision: document.metadata.revision,
    updatedAt: document.metadata.updatedAt,
    contentType: document.metadata.contentType,
  };
}

function parseEditablePayload(input: UpdateInput): EditableDocumentPayload {
  if (!isEditableDocumentType(input.documentType)) {
    throw new DocumentTypeUnsupportedError('The requested document type is not editable.');
  }

  switch (input.documentType) {
    case 'FUNCTIONAL_ANALYSIS': {
      const payload = parseWithSchema(functionalAnalysisPayloadSchema, input.payload);
      return {
        documentType: input.documentType,
        functionalDefinition: payload.functionalDefinition,
        relatedComponents: payload.relatedComponents,
        developmentAlias: payload.developmentAlias,
        startedAt: payload.startedAt,
        ...(payload.acceptanceCriteria === undefined
          ? {}
          : { acceptanceCriteria: payload.acceptanceCriteria }),
        ...(payload.additionalBusinessInformation === undefined
          ? {}
          : { additionalBusinessInformation: payload.additionalBusinessInformation }),
        ...(payload.responsiblePerson === undefined
          ? {}
          : { responsiblePerson: payload.responsiblePerson }),
        ...(payload.plannedCompletionAt === undefined
          ? {}
          : { plannedCompletionAt: payload.plannedCompletionAt }),
      };
    }
    case 'CURRENT_STATE': {
      const payload = parseWithSchema(currentStatePayloadSchema, input.payload);
      return {
        documentType: input.documentType,
        knownFacts: payload.knownFacts,
        ...(payload.constraints === undefined ? {} : { constraints: payload.constraints }),
        ...(payload.openQuestions === undefined ? {} : { openQuestions: payload.openQuestions }),
      };
    }
    case 'TECHNICAL_ANALYSIS': {
      const payload = parseWithSchema(technicalAnalysisPayloadSchema, input.payload);
      return {
        documentType: input.documentType,
        knownFacts: payload.knownFacts,
        ...(payload.declaredHypotheses === undefined
          ? {}
          : { declaredHypotheses: payload.declaredHypotheses }),
        ...(payload.dependencies === undefined ? {} : { dependencies: payload.dependencies }),
        ...(payload.openQuestions === undefined ? {} : { openQuestions: payload.openQuestions }),
      };
    }
    case 'IMPACT_ANALYSIS': {
      const payload = parseWithSchema(impactAnalysisPayloadSchema, input.payload);
      return {
        documentType: input.documentType,
        affectedComponents: payload.affectedComponents,
        ...(payload.knownImpacts === undefined ? {} : { knownImpacts: payload.knownImpacts }),
        ...(payload.openQuestions === undefined ? {} : { openQuestions: payload.openQuestions }),
      };
    }
    case 'IMPLEMENTATION_PLAN': {
      const payload = parseWithSchema(implementationPlanPayloadSchema, input.payload);
      return {
        documentType: input.documentType,
        plannedSteps: payload.plannedSteps,
        ...(payload.prerequisites === undefined ? {} : { prerequisites: payload.prerequisites }),
        ...(payload.openQuestions === undefined ? {} : { openQuestions: payload.openQuestions }),
      };
    }
  }
}

/** The application owner of all approved Milestone 3 document lifecycle rules. */
export class WorkItemDocumentService {
  public constructor(
    private readonly repository: WorkItemDossierRepository,
    private readonly templates: DocumentTemplateService,
    private readonly manifestLifecycle: ManifestLifecycleService,
    private readonly aiContextProjection: AIContextProjectionService,
    private readonly auditContextSummaryProvider?: AuditContextSummaryProvider,
  ) {}

  public async initialize(input: unknown): Promise<InitializeWorkItemDocumentsResult> {
    const request = parseWithSchema(initializeInputSchema, input);
    const workItem = await this.repository.readWorkItem(request.workItemId);

    try {
      const existing = await this.repository.readLifecycleMetadata(request.workItemId);
      return {
        workItemId: workItem.id,
        created: [],
        existing: existing.map((metadata) => ({
          documentType: metadata.documentType,
          relativePath: metadata.relativePath,
          status: metadata.status,
          revision: metadata.revision,
          updatedAt: metadata.updatedAt,
          contentType: metadata.contentType,
        })),
      };
    } catch (error) {
      if (!(error instanceof DocumentNotInitializedError)) {
        throw error;
      }
    }

    const metadata = this.manifestLifecycle.createInitialMetadata();
    const templates = this.templates.renderInitialDocuments(workItem);
    const manifestContent = await this.repository.readManifestContent(request.workItemId);
    const persisted = await this.repository.initializeDocuments({
      workItemId: request.workItemId,
      documents: INITIALIZABLE_DOCUMENT_TYPES.map((documentType) => {
        const documentMetadata = metadata.find((entry) => entry.documentType === documentType);
        if (documentMetadata === undefined) {
          throw new DocumentNotInitializedError('The document lifecycle metadata is incomplete.');
        }
        return { metadata: documentMetadata, content: templates[documentType] };
      }),
      manifest: {
        metadata: this.metadataFor(metadata, 'MANIFEST'),
        content: this.manifestLifecycle.render(manifestContent, metadata),
      },
    });

    return {
      workItemId: workItem.id,
      created: persisted.created.map((documentMetadata) => this.toMutationResult(documentMetadata)),
      existing: persisted.existing.map((documentMetadata) =>
        this.toMutationResult(documentMetadata),
      ),
    };
  }

  public async getDocument(input: unknown): Promise<GetWorkItemDocumentResult> {
    const request = parseWithSchema(getDocumentInputSchema, input);
    if (!isManagedDocumentType(request.documentType)) {
      throw new DocumentTypeUnsupportedError('The requested document type is not supported.');
    }
    const document = await this.repository.readDocument(request.workItemId, request.documentType);
    return { workItemId: request.workItemId, document };
  }

  public async update(input: unknown): Promise<UpdateWorkItemDocumentResult> {
    const request = parseWithSchema(updateDocumentInputSchema, input);
    const payload = parseEditablePayload(request);
    const workItem = await this.repository.readWorkItem(request.workItemId);
    const currentDocument = await this.repository.readDocument(
      request.workItemId,
      payload.documentType,
    );
    if (currentDocument.metadata.revision !== request.expectedRevision) {
      throw new DocumentRevisionConflictError(
        'The document revision does not match the current version.',
      );
    }

    const currentManifest = await this.repository.readDocument(request.workItemId, 'MANIFEST');
    const lifecycleMetadata = await this.repository.readLifecycleMetadata(request.workItemId);
    const nextDocument = {
      metadata: this.manifestLifecycle.nextDocumentMetadata(currentDocument.metadata, 'SUPPLIED'),
      content: this.templates.renderEditableDocument(workItem, payload),
    };
    const nextManifestMetadata = this.manifestLifecycle.nextManifestMetadata(
      currentManifest.metadata,
    );
    const nextLifecycleMetadata = lifecycleMetadata.map((metadata) => {
      if (metadata.documentType === payload.documentType) {
        return nextDocument.metadata;
      }
      if (metadata.documentType === 'MANIFEST') {
        return nextManifestMetadata;
      }
      return metadata;
    });
    const nextManifest = {
      metadata: nextManifestMetadata,
      content: this.manifestLifecycle.render(currentManifest.content, nextLifecycleMetadata),
    };

    await this.repository.commitDocument({
      workItemId: request.workItemId,
      expectedRevision: request.expectedRevision,
      document: nextDocument,
      manifest: nextManifest,
    });
    return { workItemId: workItem.id, document: toMutationResult(nextDocument) };
  }

  public async refreshAiContext(input: unknown): Promise<UpdateWorkItemDocumentResult> {
    const request = parseWithSchema(refreshAiContextInputSchema, input);
    const workItem = await this.repository.readWorkItem(request.workItemId);
    const functionalAnalysis = await this.repository.readDocument(
      request.workItemId,
      'FUNCTIONAL_ANALYSIS',
    );
    const currentAiContext = await this.repository.readDocument(request.workItemId, 'AI_CONTEXT');
    if (currentAiContext.metadata.revision !== request.expectedRevision) {
      throw new DocumentRevisionConflictError(
        'The document revision does not match the current version.',
      );
    }
    const currentManifest = await this.repository.readDocument(request.workItemId, 'MANIFEST');
    const lifecycleMetadata = await this.repository.readLifecycleMetadata(request.workItemId);
    const nextAiContext = {
      metadata: this.manifestLifecycle.nextDocumentMetadata(currentAiContext.metadata, 'DERIVED'),
      content: '',
    };
    const nextManifestMetadata = this.manifestLifecycle.nextManifestMetadata(
      currentManifest.metadata,
    );
    const nextLifecycleMetadata = lifecycleMetadata.map((metadata) => {
      if (metadata.documentType === 'AI_CONTEXT') {
        return nextAiContext.metadata;
      }
      if (metadata.documentType === 'MANIFEST') {
        return nextManifestMetadata;
      }
      return metadata;
    });
    let auditSummary: string | undefined;
    try {
      auditSummary = await this.auditContextSummaryProvider?.getContextSummary(request.workItemId);
    } catch (error) {
      if (error instanceof AuditTrackingConflictError) {
        throw new DocumentLifecycleConflictError(
          'Another document lifecycle operation is already in progress for this Work Item.',
        );
      }
      throw error;
    }
    nextAiContext.content = this.aiContextProjection.project(
      workItem,
      functionalAnalysis.content,
      nextLifecycleMetadata,
      auditSummary,
    );
    const nextManifest = {
      metadata: nextManifestMetadata,
      content: this.manifestLifecycle.render(currentManifest.content, nextLifecycleMetadata),
    };

    await this.repository.commitDocument({
      workItemId: request.workItemId,
      expectedRevision: request.expectedRevision,
      document: nextAiContext,
      manifest: nextManifest,
    });
    return { workItemId: workItem.id, document: toMutationResult(nextAiContext) };
  }

  private metadataFor(
    metadata: readonly ManagedDocument['metadata'][],
    documentType: 'MANIFEST',
  ): ManagedDocument['metadata'] {
    const entry = metadata.find((candidate) => candidate.documentType === documentType);
    if (entry === undefined) {
      throw new DocumentNotInitializedError('The document lifecycle metadata is incomplete.');
    }
    return entry;
  }

  private toMutationResult(metadata: ManagedDocument['metadata']): DocumentMutationResult {
    return {
      documentType: metadata.documentType,
      relativePath: metadata.relativePath,
      status: metadata.status,
      revision: metadata.revision,
      updatedAt: metadata.updatedAt,
      contentType: metadata.contentType,
    };
  }
}
