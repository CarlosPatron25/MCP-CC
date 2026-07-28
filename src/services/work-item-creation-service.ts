import { z } from 'zod';

import type { WorkspaceConfig } from '../config/workspace-config.js';
import {
  WORK_ITEM_TYPES,
  type WorkItem,
  type WorkItemStatus,
  type WorkItemType,
} from '../domain/work-item.js';
import { WorkItemCreationError, WorkItemValidationError } from '../errors/workspace-error.js';
import { providerForDocumentLanguage, type DocumentContentProvider } from './document-rendering.js';
import { ensureWorkspaceDocumentLanguageConfiguration } from '../filesystem/workspace-document-language-configuration.js';
import {
  assertWorkItemWorkspaceInitialized,
  createWorkItemDossier,
  type PersistedWorkItemDossier,
} from '../filesystem/work-item-dossier.js';
import { WorkItemLocator } from '../filesystem/work-item-locator.js';
import { WorkspaceKnowledgeOperationGate } from '../filesystem/workspace-knowledge-operation-gate.js';

export const WORK_ITEM_SCHEMA_VERSION = '1.0.0';
export const WORK_ITEM_SCHEMA_VERSION_V2 = '2.0.0';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32);
}

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
const isoDate = z.string().refine(isValidIsoDate, 'Must be an ISO date in YYYY-MM-DD format.');

export const CREATE_WORK_ITEM_INPUT_SCHEMA = z
  .object({
    type: z.enum(WORK_ITEM_TYPES),
    rallyId: z
      .string()
      .refine((value) => value.trim().length > 0, 'Must not be empty.')
      .refine(
        (value) => !/[\\/]/.test(value) && !value.includes('..') && !hasControlCharacter(value),
        'Contains unsafe path characters.',
      ),
    title: requiredText,
    functionalDefinition: requiredText,
    developmentAlias: requiredText,
    relatedComponents: z
      .array(z.string())
      .transform((values) =>
        values.map((value) => value.trim()).filter((value) => value.length > 0),
      )
      .refine((values) => values.length > 0, 'Must include at least one valid component.'),
    startedAt: isoDate,
    acceptanceCriteria: z
      .array(z.string())
      .optional()
      .transform((values) => {
        const normalized = values?.map((value) => value.trim()).filter((value) => value.length > 0);
        return normalized === undefined || normalized.length === 0 ? undefined : normalized;
      }),
    plannedCompletionAt: isoDate.optional(),
    responsiblePerson: optionalText,
    additionalBusinessInformation: optionalText,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.plannedCompletionAt !== undefined && input.plannedCompletionAt < input.startedAt) {
      context.addIssue({
        code: 'custom',
        path: ['plannedCompletionAt'],
        message: 'Must not be earlier than startedAt.',
      });
    }
  });

type NormalizedCreateWorkItemInput = z.output<typeof CREATE_WORK_ITEM_INPUT_SCHEMA>;

export interface CreateWorkItemResult {
  id: string;
  rallyId: string;
  type: WorkItemType;
  status: WorkItemStatus;
  createdAt: string;
  updatedAt: string;
  workItemPath: string;
  createdFiles: string[];
  createdDirectories: string[];
}

function toValidationError(error: z.ZodError): WorkItemValidationError {
  const firstIssue = error.issues[0];
  const field = firstIssue?.path.join('.') || 'input';
  return new WorkItemValidationError('The Work Item input is invalid.', { field });
}

export function normalizeWorkItemId(rallyId: string): string {
  const normalized = rallyId
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (normalized.length === 0) {
    throw new WorkItemValidationError('The Work Item input is invalid.', { field: 'rallyId' });
  }

  return normalized;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlStringList(values: string[] | undefined, indent: string): string[] {
  if (values === undefined || values.length === 0) {
    return [`${indent}[]`];
  }
  return values.map((value) => `${indent}- ${yamlString(value)}`);
}

function optionalYamlObject(name: string, property: string, value: string | undefined): string[] {
  if (value === undefined) {
    return [`${name}: null`];
  }
  return [`${name}:`, `  ${property}: ${yamlString(value)}`];
}

export function serializeWorkItemYml(workItem: WorkItem): string {
  const schemaVersion = workItem.schemaVersion ?? WORK_ITEM_SCHEMA_VERSION;
  return [
    `schemaVersion: ${yamlString(schemaVersion)}`,
    `id: ${yamlString(workItem.id)}`,
    ...(workItem.iteration === undefined
      ? []
      : [
          'iteration:',
          `  iterationId: ${yamlString(workItem.iteration.iterationId)}`,
          ...(workItem.iteration.displayName === undefined
            ? []
            : [`  displayName: ${yamlString(workItem.iteration.displayName)}`]),
          `  storageToken: ${yamlString(workItem.iteration.storageToken)}`,
        ]),
    `rallyId: ${yamlString(workItem.rallyId)}`,
    `type: ${yamlString(workItem.type)}`,
    `status: ${yamlString(workItem.status)}`,
    `title: ${yamlString(workItem.title)}`,
    'dates:',
    `  startedAt: ${yamlString(workItem.dates.startedAt)}`,
    ...(workItem.dates.plannedCompletionAt === undefined
      ? []
      : [`  plannedCompletionAt: ${yamlString(workItem.dates.plannedCompletionAt)}`]),
    ...(workItem.dates.actualCompletionAt === undefined
      ? []
      : [`  actualCompletionAt: ${yamlString(workItem.dates.actualCompletionAt)}`]),
    ...optionalYamlObject(
      'responsibility',
      'responsiblePerson',
      workItem.responsibility?.responsiblePerson,
    ),
    'salesforce:',
    `  developmentAlias: ${yamlString(workItem.salesforce.developmentAlias)}`,
    'functional:',
    `  definition: ${yamlString(workItem.functional.definition)}`,
    '  acceptanceCriteria:',
    ...yamlStringList(workItem.functional.acceptanceCriteria, '    '),
    'initialScope:',
    '  relatedComponents:',
    ...yamlStringList(workItem.initialScope.relatedComponents, '    '),
    ...optionalYamlObject(
      'business',
      'additionalInformation',
      workItem.business?.additionalInformation,
    ),
    `createdAt: ${yamlString(workItem.createdAt)}`,
    `updatedAt: ${yamlString(workItem.updatedAt)}`,
    '',
  ].join('\n');
}

function markdownText(value: string | undefined, provider: DocumentContentProvider): string {
  return value === undefined ? `_${provider.text('notProvided')}._` : value;
}

function markdownList(values: string[] | undefined, provider: DocumentContentProvider): string {
  return values === undefined || values.length === 0
    ? `_${provider.text('notProvided')}._`
    : values.map((value) => `- ${value}`).join('\n');
}

function buildManifest(workItem: WorkItem, provider: DocumentContentProvider): string {
  const documents = [
    'WORK_ITEM.yml',
    '00_MANIFEST.md',
    '01_FUNCTIONAL_ANALYSIS.md',
    'context/AI_CONTEXT.md',
    'context/AI_RULES.md',
    'context/NEXT_TASK.md',
  ];
  const directories = ['context/', 'evidence/', 'snapshots/'];

  return [
    `# ${provider.text('manifestTitle')}`,
    '',
    '<!-- WS-WORKSPACE-MCP:DOCUMENT_RENDERING_SNAPSHOT schemaVersion=1.0.0 documentLanguage=es-ES renderingProfile=ES_ES_V1 -->',
    '',
    `- ${provider.text('workItemId')}: ${workItem.id}`,
    `- ${provider.text('rallyId')}: ${workItem.rallyId}`,
    `- ${provider.text('type')}: ${workItem.type}`,
    `- ${provider.text('status')}: ${workItem.status}`,
    `- ${provider.text('createdAt')}: ${workItem.createdAt}`,
    `- ${provider.text('schemaVersion')}: ${workItem.schemaVersion ?? WORK_ITEM_SCHEMA_VERSION}`,
    '',
    `## ${provider.text('createdDocuments')}`,
    '',
    `| ${provider.text('relativePath')} | ${provider.text('initialStatus')} |`,
    '| --- | --- |',
    ...documents.map((path) => `| ${path} | CREATED |`),
    '',
    `## ${provider.text('createdDirectories')}`,
    '',
    `| ${provider.text('relativePath')} | ${provider.text('initialStatus')} |`,
    '| --- | --- |',
    ...directories.map((path) => `| ${path} | CREATED |`),
    '',
  ].join('\n');
}

function buildFunctionalAnalysis(workItem: WorkItem, provider: DocumentContentProvider): string {
  return [
    `# ${provider.text('functionalAnalysis')}`,
    '',
    `## ${workItem.title}`,
    '',
    `- ${provider.text('workItemId')}: ${workItem.id}`,
    `- ${provider.text('rallyId')}: ${workItem.rallyId}`,
    `- ${provider.text('type')}: ${workItem.type}`,
    `- ${provider.text('status')}: ${workItem.status}`,
    '',
    `## ${provider.text('functionalDefinition')}`,
    '',
    workItem.functional.definition,
    '',
    `## ${provider.text('acceptanceCriteria')}`,
    '',
    markdownList(workItem.functional.acceptanceCriteria, provider),
    '',
    `## ${provider.text('additionalBusinessInformation')}`,
    '',
    markdownText(workItem.business?.additionalInformation, provider),
    '',
    `## ${provider.text('initiallyRelatedComponents')}`,
    '',
    markdownList(workItem.initialScope.relatedComponents, provider),
    '',
    `## ${provider.text('salesforceContext')}`,
    '',
    `- ${provider.text('developmentAlias')}: ${workItem.salesforce.developmentAlias}`,
    '',
    `## ${provider.text('responsibility')}`,
    '',
    markdownText(workItem.responsibility?.responsiblePerson, provider),
    '',
    `## ${provider.text('dates')}`,
    '',
    `- ${provider.text('startedAt')}: ${workItem.dates.startedAt}`,
    `- ${provider.text('plannedCompletionAt')}: ${markdownText(workItem.dates.plannedCompletionAt, provider)}`,
    '',
  ].join('\n');
}

function buildAiContext(workItem: WorkItem, provider: DocumentContentProvider): string {
  return [
    `# ${provider.text('aiContext')}`,
    '',
    `## ${provider.text('workItem')}`,
    '',
    `- ID: ${workItem.id}`,
    `- ${provider.text('rallyId')}: ${workItem.rallyId}`,
    `- ${provider.text('type')}: ${workItem.type}`,
    `- ${provider.text('currentStatus')}: ${workItem.status}`,
    '',
    `## ${provider.text('knownFunctionalContext')}`,
    '',
    workItem.functional.definition,
    '',
    `## ${provider.text('initialScope')}`,
    '',
    markdownList(workItem.initialScope.relatedComponents, provider),
    '',
    `## ${provider.text('currentBoundary')}`,
    '',
    provider.text('noTechnicalDecisions'),
    '',
  ].join('\n');
}

function buildAiRules(provider: DocumentContentProvider): string {
  return [
    `# ${provider.text('aiRules')}`,
    '',
    `- ${provider.text('aiRuleOne')}`,
    `- ${provider.text('aiRuleTwo')}`,
    `- ${provider.text('aiRuleThree')}`,
    `- ${provider.text('aiRuleFour')}`,
    `- ${provider.text('aiRuleFive')}`,
    '',
  ].join('\n');
}

function buildNextTask(provider: DocumentContentProvider): string {
  return [`# ${provider.text('nextTask')}`, '', provider.text('nextTaskInstruction'), ''].join(
    '\n',
  );
}

export function buildWorkItemDossier(
  workItem: WorkItem,
  provider: DocumentContentProvider,
  parentSegments?: string[],
) {
  return {
    id: workItem.id,
    ...(parentSegments === undefined ? {} : { parentSegments }),
    directories: ['context', 'evidence', 'snapshots'],
    files: [
      { relativePath: 'WORK_ITEM.yml', content: serializeWorkItemYml(workItem) },
      { relativePath: '00_MANIFEST.md', content: buildManifest(workItem, provider) },
      {
        relativePath: '01_FUNCTIONAL_ANALYSIS.md',
        content: buildFunctionalAnalysis(workItem, provider),
      },
      { relativePath: 'context/AI_CONTEXT.md', content: buildAiContext(workItem, provider) },
      { relativePath: 'context/AI_RULES.md', content: buildAiRules(provider) },
      { relativePath: 'context/NEXT_TASK.md', content: buildNextTask(provider) },
    ],
  };
}

function toCreateWorkItemResult(
  workItem: WorkItem,
  dossier: PersistedWorkItemDossier,
): CreateWorkItemResult {
  return {
    id: workItem.id,
    rallyId: workItem.rallyId,
    type: workItem.type,
    status: workItem.status,
    createdAt: workItem.createdAt,
    updatedAt: workItem.updatedAt,
    ...dossier,
  };
}

export class WorkItemCreationService {
  private readonly locator: WorkItemLocator;
  private readonly gate: WorkspaceKnowledgeOperationGate;

  public constructor(private readonly config: WorkspaceConfig) {
    this.locator = new WorkItemLocator(config.workspaceRoot);
    this.gate = new WorkspaceKnowledgeOperationGate({
      workspaceRoot: config.workspaceRoot,
      conflictError: () => new WorkItemCreationError('Could not create the Work Item safely.'),
      updateError: () => new WorkItemCreationError('Could not create the Work Item safely.'),
      recoveryError: () => new WorkItemCreationError('Could not create the Work Item safely.'),
    });
  }

  public async create(input: unknown): Promise<CreateWorkItemResult> {
    const parsed = CREATE_WORK_ITEM_INPUT_SCHEMA.safeParse(input);
    if (!parsed.success) {
      throw toValidationError(parsed.error);
    }

    const normalized = parsed.data as NormalizedCreateWorkItemInput;
    const now = new Date().toISOString();
    const workItem: WorkItem = {
      id: normalizeWorkItemId(normalized.rallyId),
      rallyId: normalized.rallyId,
      type: normalized.type,
      status: 'DRAFT',
      title: normalized.title,
      dates: {
        startedAt: normalized.startedAt,
        ...(normalized.plannedCompletionAt === undefined
          ? {}
          : { plannedCompletionAt: normalized.plannedCompletionAt }),
      },
      ...(normalized.responsiblePerson === undefined
        ? {}
        : { responsibility: { responsiblePerson: normalized.responsiblePerson } }),
      salesforce: {
        developmentAlias: normalized.developmentAlias,
      },
      functional: {
        definition: normalized.functionalDefinition,
        ...(normalized.acceptanceCriteria === undefined
          ? {}
          : { acceptanceCriteria: normalized.acceptanceCriteria }),
      },
      initialScope: {
        relatedComponents: normalized.relatedComponents,
      },
      ...(normalized.additionalBusinessInformation === undefined
        ? {}
        : { business: { additionalInformation: normalized.additionalBusinessInformation } }),
      createdAt: now,
      updatedAt: now,
    };

    await assertWorkItemWorkspaceInitialized(this.config.workspaceRoot);
    await ensureWorkspaceDocumentLanguageConfiguration(this.config.workspaceRoot);
    return this.gate.runExclusive(async () => {
      await this.locator.assertIdentifierAvailable(workItem.id);
      const dossier = await createWorkItemDossier(
        this.config.workspaceRoot,
        buildWorkItemDossier(workItem, providerForDocumentLanguage('es-ES')),
      );
      return toCreateWorkItemResult(workItem, dossier);
    });
  }
}
