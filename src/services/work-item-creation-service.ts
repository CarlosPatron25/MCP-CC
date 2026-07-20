import { z } from 'zod';

import type { WorkspaceConfig } from '../config/workspace-config.js';
import {
  WORK_ITEM_TYPES,
  type WorkItem,
  type WorkItemStatus,
  type WorkItemType,
} from '../domain/work-item.js';
import { WorkItemValidationError } from '../errors/workspace-error.js';
import {
  createWorkItemDossier,
  type PersistedWorkItemDossier,
} from '../filesystem/work-item-dossier.js';

export const WORK_ITEM_SCHEMA_VERSION = '1.0.0';

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

function normalizeWorkItemId(rallyId: string): string {
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
  return [
    `schemaVersion: ${yamlString(WORK_ITEM_SCHEMA_VERSION)}`,
    `id: ${yamlString(workItem.id)}`,
    `rallyId: ${yamlString(workItem.rallyId)}`,
    `type: ${yamlString(workItem.type)}`,
    `status: ${yamlString(workItem.status)}`,
    `title: ${yamlString(workItem.title)}`,
    'dates:',
    `  startedAt: ${yamlString(workItem.dates.startedAt)}`,
    ...(workItem.dates.plannedCompletionAt === undefined
      ? []
      : [`  plannedCompletionAt: ${yamlString(workItem.dates.plannedCompletionAt)}`]),
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

function markdownText(value: string | undefined): string {
  return value === undefined ? '_Not provided._' : value;
}

function markdownList(values: string[] | undefined): string {
  return values === undefined || values.length === 0
    ? '_Not provided._'
    : values.map((value) => `- ${value}`).join('\n');
}

function buildManifest(workItem: WorkItem): string {
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
    '# Work Item Manifest',
    '',
    `- Work Item ID: ${workItem.id}`,
    `- Rally ID: ${workItem.rallyId}`,
    `- Type: ${workItem.type}`,
    `- Status: ${workItem.status}`,
    `- Created at: ${workItem.createdAt}`,
    `- Schema version: ${WORK_ITEM_SCHEMA_VERSION}`,
    '',
    '## Created documents',
    '',
    '| Path | Initial status |',
    '| --- | --- |',
    ...documents.map((path) => `| ${path} | CREATED |`),
    '',
    '## Created directories',
    '',
    '| Path | Initial status |',
    '| --- | --- |',
    ...directories.map((path) => `| ${path} | CREATED |`),
    '',
  ].join('\n');
}

function buildFunctionalAnalysis(workItem: WorkItem): string {
  return [
    '# Functional Analysis',
    '',
    `## ${workItem.title}`,
    '',
    `- Work Item ID: ${workItem.id}`,
    `- Rally ID: ${workItem.rallyId}`,
    `- Type: ${workItem.type}`,
    `- Status: ${workItem.status}`,
    '',
    '## Functional definition',
    '',
    workItem.functional.definition,
    '',
    '## Acceptance criteria',
    '',
    markdownList(workItem.functional.acceptanceCriteria),
    '',
    '## Additional business information',
    '',
    markdownText(workItem.business?.additionalInformation),
    '',
    '## Initially related components',
    '',
    markdownList(workItem.initialScope.relatedComponents),
    '',
    '## Salesforce context',
    '',
    `- Development alias: ${workItem.salesforce.developmentAlias}`,
    '',
    '## Responsibility',
    '',
    markdownText(workItem.responsibility?.responsiblePerson),
    '',
    '## Dates',
    '',
    `- Started at: ${workItem.dates.startedAt}`,
    `- Planned completion at: ${markdownText(workItem.dates.plannedCompletionAt)}`,
    '',
  ].join('\n');
}

function buildAiContext(workItem: WorkItem): string {
  return [
    '# AI Context',
    '',
    '## Work Item',
    '',
    `- ID: ${workItem.id}`,
    `- Rally ID: ${workItem.rallyId}`,
    `- Type: ${workItem.type}`,
    `- Current status: ${workItem.status}`,
    '',
    '## Known functional context',
    '',
    workItem.functional.definition,
    '',
    '## Initial scope',
    '',
    markdownList(workItem.initialScope.relatedComponents),
    '',
    '## Current boundary',
    '',
    'No technical implementation decisions have been recorded yet.',
    '',
  ].join('\n');
}

function buildAiRules(): string {
  return [
    '# AI Rules',
    '',
    '- Do not invent requirements or missing business information.',
    '- Preserve traceability to the Work Item and its supplied context.',
    '- Record relevant decisions in the dossier when the appropriate lifecycle tool exists.',
    '- Do not modify files outside this Work Item dossier.',
    '- Keep dossier documents current as verified information becomes available.',
    '',
  ].join('\n');
}

function buildNextTask(): string {
  return [
    '# Next Task',
    '',
    'Review the supplied functional context and identify open questions before making technical decisions.',
    '',
  ].join('\n');
}

function buildDossier(workItem: WorkItem) {
  return {
    id: workItem.id,
    directories: ['context', 'evidence', 'snapshots'],
    files: [
      { relativePath: 'WORK_ITEM.yml', content: serializeWorkItemYml(workItem) },
      { relativePath: '00_MANIFEST.md', content: buildManifest(workItem) },
      { relativePath: '01_FUNCTIONAL_ANALYSIS.md', content: buildFunctionalAnalysis(workItem) },
      { relativePath: 'context/AI_CONTEXT.md', content: buildAiContext(workItem) },
      { relativePath: 'context/AI_RULES.md', content: buildAiRules() },
      { relativePath: 'context/NEXT_TASK.md', content: buildNextTask() },
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
  public constructor(private readonly config: WorkspaceConfig) {}

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

    const dossier = await createWorkItemDossier(this.config.workspaceRoot, buildDossier(workItem));
    return toCreateWorkItemResult(workItem, dossier);
  }
}
