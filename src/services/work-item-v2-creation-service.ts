import { lstat, readFile, rm } from 'node:fs/promises';
import { z } from 'zod';

import type { WorkspaceConfig } from '../config/workspace-config.js';
import { WORK_ITEM_TYPES, type WorkItem } from '../domain/work-item.js';
import {
  WorkItemAlreadyExistsError,
  WorkItemNotFoundError,
  WorkItemValidationError,
} from '../errors/workspace-error.js';
import {
  assertWorkItemWorkspaceInitialized,
  createWorkItemDossier,
  type PersistedWorkItemDossier,
} from '../filesystem/work-item-dossier.js';
import { WorkItemLocator } from '../filesystem/work-item-locator.js';
import { parsePersistedWorkItem } from '../filesystem/local-filesystem-work-item-dossier-repository.js';
import { resolvePathWithinRoot } from '../filesystem/safe-path.js';
import { ensureWorkspaceDocumentLanguageConfiguration } from '../filesystem/workspace-document-language-configuration.js';
import { fingerprintAuditPayload } from './audit-ledger-service.js';
import type { Clock } from './clock.js';
import { UUID_V4_PATTERN } from './id-generator.js';
import { providerForDocumentLanguage } from './document-rendering.js';
import { M5_TEXT_SCHEMA } from './m5-text-policy.js';
import {
  inspectWorkItemV2BootstrapMarker,
  renderWorkItemV2BootstrapMarker,
} from './work-item-v2-bootstrap-marker.js';
import {
  buildWorkItemDossier,
  normalizeWorkItemId,
  WORK_ITEM_SCHEMA_VERSION_V2,
} from './work-item-creation-service.js';

const PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,128}$/;
const participantSchema = z
  .object({
    participantId: z.string().regex(PARTICIPANT_ID_PATTERN),
    displayName: M5_TEXT_SCHEMA.pipe(z.string().max(256)),
  })
  .strict();

export const CREATE_WORK_ITEM_V2_INPUT_SCHEMA = z
  .object({
    type: z.enum(WORK_ITEM_TYPES),
    rallyId: M5_TEXT_SCHEMA.pipe(z.string().max(128)),
    title: M5_TEXT_SCHEMA.pipe(z.string().max(512)),
    functionalDefinition: M5_TEXT_SCHEMA,
    iteration: z
      .object({
        iterationId: M5_TEXT_SCHEMA.pipe(z.string().max(128)),
        displayName: M5_TEXT_SCHEMA.pipe(z.string().max(256)).optional(),
      })
      .strict(),
    actor: participantSchema,
    expectedKnowledgeRevision: z.number().int().nonnegative(),
    idempotencyKey: z.string().regex(UUID_V4_PATTERN),
  })
  .strict();

export type CreateWorkItemV2Input = z.output<typeof CREATE_WORK_ITEM_V2_INPUT_SCHEMA>;

export interface CreateWorkItemV2DossierResult extends PersistedWorkItemDossier {
  workItem: WorkItem;
  iterationStorageToken: string;
  idempotencyKey: string;
}

export class WorkItemV2CreationService {
  private readonly locator: WorkItemLocator;

  public constructor(
    private readonly config: WorkspaceConfig,
    private readonly clock: Clock,
  ) {
    this.locator = new WorkItemLocator(config.workspaceRoot);
  }

  public async createDossier(input: unknown): Promise<CreateWorkItemV2DossierResult> {
    const parsed = CREATE_WORK_ITEM_V2_INPUT_SCHEMA.safeParse(input);
    if (!parsed.success) {
      throw new WorkItemValidationError('The Work Item v2 input is invalid.', {
        field: parsed.error.issues[0]?.path.join('.') || 'input',
      });
    }
    const value = parsed.data;
    const workItemId = normalizeWorkItemId(value.rallyId);
    const iterationStorageToken = normalizeIterationStorageToken(value.iteration.iterationId);
    await assertWorkItemWorkspaceInitialized(this.config.workspaceRoot);
    await this.locator.assertIdentifierAvailable(workItemId);
    await ensureWorkspaceDocumentLanguageConfiguration(this.config.workspaceRoot);

    const now = this.clock.now();
    const workItem: WorkItem = {
      schemaVersion: WORK_ITEM_SCHEMA_VERSION_V2,
      id: workItemId,
      rallyId: value.rallyId,
      type: value.type,
      status: 'DRAFT',
      title: value.title,
      iteration: {
        iterationId: value.iteration.iterationId,
        ...(value.iteration.displayName === undefined
          ? {}
          : { displayName: value.iteration.displayName }),
        storageToken: iterationStorageToken,
      },
      dates: { startedAt: now.slice(0, 10) },
      responsibility: { responsiblePerson: value.actor.displayName },
      salesforce: { developmentAlias: 'PENDING' },
      functional: { definition: value.functionalDefinition },
      initialScope: { relatedComponents: [] },
      createdAt: now,
      updatedAt: now,
    };
    const dossier = buildWorkItemDossier(workItem, providerForDocumentLanguage('es-ES'), [
      iterationStorageToken,
      value.type,
    ]);
    const requestFingerprint = fingerprintAuditPayload(value);
    const persisted = await createWorkItemDossier(this.config.workspaceRoot, {
      ...dossier,
      files: dossier.files.map((file) =>
        file.relativePath === '00_MANIFEST.md'
          ? {
              ...file,
              content: `${file.content.trimEnd()}\n\n${renderWorkItemV2BootstrapMarker(
                'PENDING',
                requestFingerprint,
              )}\n`,
            }
          : file,
      ),
    });
    return {
      ...persisted,
      workItem,
      iterationStorageToken,
      idempotencyKey: value.idempotencyKey,
    };
  }

  /**
   * Accepts only an exact v2 dossier left by an interrupted bootstrap. A
   * legacy dossier or any semantic mismatch remains a real global-ID
   * collision and is never silently upgraded.
   */
  public async assertRecoverableDossier(input: unknown): Promise<void> {
    if (!(await this.isExactRecoverableDossier(input))) {
      throw new WorkItemAlreadyExistsError(
        'A Work Item with this identifier is not a recoverable v2 bootstrap.',
      );
    }
  }

  public async isExactRecoverableDossier(input: unknown): Promise<boolean> {
    const parsed = CREATE_WORK_ITEM_V2_INPUT_SCHEMA.safeParse(input);
    if (!parsed.success) {
      throw new WorkItemValidationError('The Work Item v2 input is invalid.', {
        field: parsed.error.issues[0]?.path.join('.') || 'input',
      });
    }
    const value = parsed.data;
    const workItemId = normalizeWorkItemId(value.rallyId);
    let located: Awaited<ReturnType<WorkItemLocator['locate']>>;
    try {
      located = await this.locator.locate(workItemId);
    } catch (error) {
      if (error instanceof WorkItemNotFoundError) {
        return false;
      }
      throw new WorkItemAlreadyExistsError(
        'A Work Item with this identifier already exists and is not a recoverable v2 bootstrap.',
      );
    }
    try {
      const workItemPath = resolvePathWithinRoot(located.dossierDirectory, 'WORK_ITEM.yml');
      const entry = await lstat(workItemPath);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new WorkItemAlreadyExistsError(
          'A Work Item with this identifier already exists and is not recoverable.',
        );
      }
      const workItem = parsePersistedWorkItem(await readFile(workItemPath, 'utf8'));
      const manifestPath = resolvePathWithinRoot(located.dossierDirectory, '00_MANIFEST.md');
      const manifestEntry = await lstat(manifestPath);
      if (!manifestEntry.isFile() || manifestEntry.isSymbolicLink()) {
        throw new WorkItemAlreadyExistsError(
          'A Work Item with this identifier already exists and is not recoverable.',
        );
      }
      const manifest = await readFile(manifestPath, 'utf8');
      const bootstrapMarker = inspectWorkItemV2BootstrapMarker(manifest);
      const expectedStorageToken = normalizeIterationStorageToken(value.iteration.iterationId);
      if (
        bootstrapMarker.kind !== 'VALID' ||
        bootstrapMarker.status !== 'PENDING' ||
        bootstrapMarker.requestFingerprint !== fingerprintAuditPayload(value) ||
        workItem.schemaVersion !== WORK_ITEM_SCHEMA_VERSION_V2 ||
        workItem.id !== workItemId ||
        workItem.rallyId !== value.rallyId ||
        workItem.type !== value.type ||
        workItem.status !== 'DRAFT' ||
        workItem.title !== value.title ||
        workItem.functional.definition !== value.functionalDefinition ||
        workItem.responsibility?.responsiblePerson !== value.actor.displayName ||
        workItem.iteration?.iterationId !== value.iteration.iterationId ||
        workItem.iteration.storageToken !== expectedStorageToken ||
        workItem.iteration.displayName !== value.iteration.displayName
      ) {
        throw new WorkItemAlreadyExistsError(
          'A Work Item with this identifier already exists and does not match the retry.',
        );
      }
      return true;
    } catch (error) {
      if (error instanceof WorkItemAlreadyExistsError) {
        throw error;
      }
      throw new WorkItemAlreadyExistsError(
        'A Work Item with this identifier already exists and is not a recoverable v2 bootstrap.',
      );
    }
  }

  public async rollbackCreatedDossier(result: CreateWorkItemV2DossierResult): Promise<void> {
    const target = resolvePathWithinRoot(this.config.workspaceRoot, result.workItemPath);
    const located = await this.locator.locate(result.workItem.id);
    if (located.dossierDirectory !== target) {
      throw new WorkItemValidationError('The Work Item v2 rollback target is invalid.');
    }
    await rm(target, { recursive: true, force: false });
  }
}

export function normalizeIterationStorageToken(iterationId: string): string {
  const token = iterationId
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^A-Za-z0-9._-]+/gu, '_')
    .replace(/^[_\-.]+|[_\-.]+$/gu, '')
    .slice(0, 128);
  if (token.length === 0 || token === '.' || token === '..') {
    throw new WorkItemValidationError('The Work Item v2 input is invalid.', {
      field: 'iteration.iterationId',
    });
  }
  return token;
}
