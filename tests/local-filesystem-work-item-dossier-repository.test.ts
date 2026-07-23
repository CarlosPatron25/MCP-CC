import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  DocumentLifecycleMetadata,
  ManagedDocument,
  ManagedDocumentType,
} from '../src/domain/work-item-document.js';
import {
  DocumentAlreadyExistsError,
  DocumentLifecycleConflictError,
  DocumentRevisionConflictError,
  DocumentUpdateError,
  WorkItemNotFoundError,
} from '../src/errors/workspace-error.js';
import { LocalFilesystemWorkItemDossierRepository } from '../src/filesystem/local-filesystem-work-item-dossier-repository.js';
import { initializeWorkspace } from '../src/filesystem/workspace-initializer.js';
import type { Clock } from '../src/services/clock.js';
import { DocumentTemplateService } from '../src/services/document-template-service.js';
import { ManifestLifecycleService } from '../src/services/manifest-lifecycle-service.js';
import { WorkItemCreationService } from '../src/services/work-item-creation-service.js';
import type { InitializeDossierDocumentsRequest } from '../src/services/work-item-dossier-repository.js';
import { createTemporaryWorkspaceRoot, removeTemporaryWorkspaceRoot } from './helpers.js';

const temporaryRoots: string[] = [];
const fixedClock: Clock = { now: () => '2026-07-22T12:00:00.000Z' };

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(removeTemporaryWorkspaceRoot));
});

function metadataFor(
  metadata: readonly DocumentLifecycleMetadata[],
  documentType: ManagedDocumentType,
): DocumentLifecycleMetadata {
  const entry = metadata.find((candidate) => candidate.documentType === documentType);
  if (entry === undefined) {
    throw new Error(`Missing ${documentType} metadata in the test setup.`);
  }
  return entry;
}

async function createDossier(): Promise<{
  root: string;
  workItemId: string;
  repository: LocalFilesystemWorkItemDossierRepository;
  lifecycle: ManifestLifecycleService;
  initialization: InitializeDossierDocumentsRequest;
}> {
  const root = await createTemporaryWorkspaceRoot();
  temporaryRoots.push(root);
  await initializeWorkspace(root);
  const creation = new WorkItemCreationService({ workspaceRoot: root });
  const created = await creation.create({
    type: 'USER_STORY',
    rallyId: 'US-123',
    title: 'Create a controlled dossier',
    functionalDefinition: 'A user can create a controlled dossier.',
    developmentAlias: 'development',
    relatedComponents: ['workspace-mcp'],
    startedAt: '2026-07-22',
  });
  const repository = new LocalFilesystemWorkItemDossierRepository({ workspaceRoot: root });
  const workItem = await repository.readWorkItem(created.id);
  const lifecycle = new ManifestLifecycleService(fixedClock);
  const metadata = lifecycle.createInitialMetadata();
  const templates = new DocumentTemplateService().renderInitialDocuments(workItem);
  const existingManifest = await readFile(
    join(root, created.workItemPath, '00_MANIFEST.md'),
    'utf8',
  );
  const initialization: InitializeDossierDocumentsRequest = {
    workItemId: created.id,
    documents: [
      'CURRENT_STATE',
      'TECHNICAL_ANALYSIS',
      'IMPACT_ANALYSIS',
      'IMPLEMENTATION_PLAN',
    ].map((documentType) => ({
      metadata: metadataFor(metadata, documentType as ManagedDocumentType),
      content: templates[documentType as keyof typeof templates],
    })),
    manifest: {
      metadata: metadataFor(metadata, 'MANIFEST'),
      content: lifecycle.render(existingManifest, metadata),
    },
  };

  return { root, workItemId: created.id, repository, lifecycle, initialization };
}

async function commitCurrentState(
  root: string,
  repository: LocalFilesystemWorkItemDossierRepository,
  lifecycle: ManifestLifecycleService,
  workItemId: string,
): Promise<{ document: ManagedDocument; manifest: ManagedDocument }> {
  const lifecycleMetadata = await repository.readLifecycleMetadata(workItemId);
  const current = await repository.readDocument(workItemId, 'CURRENT_STATE');
  const manifest = await repository.readDocument(workItemId, 'MANIFEST');
  const nextDocumentMetadata = lifecycle.nextDocumentMetadata(current.metadata, 'SUPPLIED');
  const nextManifestMetadata = lifecycle.nextManifestMetadata(manifest.metadata);
  const nextLifecycleMetadata = lifecycleMetadata.map((entry) => {
    if (entry.documentType === 'CURRENT_STATE') {
      return nextDocumentMetadata;
    }
    if (entry.documentType === 'MANIFEST') {
      return nextManifestMetadata;
    }
    return entry;
  });
  const document = {
    metadata: nextDocumentMetadata,
    content: '# Current State\n\nUpdated supplied content.\n',
  };
  const nextManifest = {
    metadata: nextManifestMetadata,
    content: lifecycle.render(manifest.content, nextLifecycleMetadata),
  };

  await repository.commitDocument({
    workItemId,
    expectedRevision: current.metadata.revision,
    document,
    manifest: nextManifest,
  });
  expect(JSON.stringify({ document, manifest: nextManifest })).not.toContain(root);
  return { document, manifest: nextManifest };
}

describe('LocalFilesystemWorkItemDossierRepository', () => {
  it('creates exactly the four missing documents and a complete lifecycle inventory', async () => {
    const { root, workItemId, repository, initialization } = await createDossier();

    const result = await repository.initializeDocuments(initialization);
    const metadata = await repository.readLifecycleMetadata(workItemId);

    expect(result.created.map((entry) => entry.documentType)).toEqual([
      'CURRENT_STATE',
      'TECHNICAL_ANALYSIS',
      'IMPACT_ANALYSIS',
      'IMPLEMENTATION_PLAN',
    ]);
    expect(metadata).toHaveLength(7);
    await expect(
      stat(join(root, '.ws-workspace', 'active', workItemId, '02_CURRENT_STATE.md')),
    ).resolves.toMatchObject({ isFile: expect.any(Function) });
    await expect(
      stat(join(root, '.ws-workspace', 'active', workItemId, '06_TEST_PLAN.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('is idempotent after initialization and does not overwrite created documents', async () => {
    const { root, workItemId, repository, initialization } = await createDossier();
    await repository.initializeDocuments(initialization);
    const path = join(root, '.ws-workspace', 'active', workItemId, '02_CURRENT_STATE.md');
    const original = await readFile(path, 'utf8');

    const second = await repository.initializeDocuments(initialization);

    expect(second.created).toEqual([]);
    expect(second.existing).toHaveLength(7);
    await expect(readFile(path, 'utf8')).resolves.toBe(original);
  });

  it('preserves an unexpected pre-existing lifecycle file without changing the manifest', async () => {
    const { root, workItemId, repository, initialization } = await createDossier();
    const workItemDirectory = join(root, '.ws-workspace', 'active', workItemId);
    const protectedPath = join(workItemDirectory, '02_CURRENT_STATE.md');
    const manifestPath = join(workItemDirectory, '00_MANIFEST.md');
    const originalManifest = await readFile(manifestPath, 'utf8');
    await writeFile(protectedPath, 'protected content\n', 'utf8');

    await expect(repository.initializeDocuments(initialization)).rejects.toBeInstanceOf(
      DocumentAlreadyExistsError,
    );
    await expect(readFile(protectedPath, 'utf8')).resolves.toBe('protected content\n');
    await expect(readFile(manifestPath, 'utf8')).resolves.toBe(originalManifest);
  });

  it('commits a document and manifest together and rejects stale revisions', async () => {
    const { root, workItemId, repository, lifecycle, initialization } = await createDossier();
    await repository.initializeDocuments(initialization);

    const committed = await commitCurrentState(root, repository, lifecycle, workItemId);
    const current = await repository.readDocument(workItemId, 'CURRENT_STATE');
    const manifest = await repository.readDocument(workItemId, 'MANIFEST');

    expect(current).toEqual(committed.document);
    expect(manifest).toEqual(committed.manifest);
    await expect(
      repository.commitDocument({
        workItemId,
        expectedRevision: 1,
        document: committed.document,
        manifest: committed.manifest,
      }),
    ).rejects.toBeInstanceOf(DocumentRevisionConflictError);
    await expect(repository.readDocument(workItemId, 'CURRENT_STATE')).resolves.toEqual(current);
  });

  it('restores the last valid files and cleans staging when a commit fails', async () => {
    const { root, workItemId, repository, lifecycle, initialization } = await createDossier();
    await repository.initializeDocuments(initialization);
    const beforeDocument = await repository.readDocument(workItemId, 'CURRENT_STATE');
    const beforeManifest = await repository.readDocument(workItemId, 'MANIFEST');
    const failingRepository = new LocalFilesystemWorkItemDossierRepository({
      workspaceRoot: root,
      afterOriginalsMoved: () => {
        throw new Error('Injected failure.');
      },
    });
    const lifecycleMetadata = await repository.readLifecycleMetadata(workItemId);
    const updatedDocument = {
      metadata: lifecycle.nextDocumentMetadata(beforeDocument.metadata, 'SUPPLIED'),
      content: '# Current State\n\nUpdated supplied content.\n',
    };
    const updatedManifestMetadata = lifecycle.nextManifestMetadata(beforeManifest.metadata);
    const updatedManifest = {
      metadata: updatedManifestMetadata,
      content: lifecycle.render(
        beforeManifest.content,
        lifecycleMetadata.map((entry) =>
          entry.documentType === 'CURRENT_STATE'
            ? updatedDocument.metadata
            : entry.documentType === 'MANIFEST'
              ? updatedManifestMetadata
              : entry,
        ),
      ),
    };

    await expect(
      failingRepository.commitDocument({
        workItemId,
        expectedRevision: beforeDocument.metadata.revision,
        document: updatedDocument,
        manifest: updatedManifest,
      }),
    ).rejects.toBeInstanceOf(DocumentUpdateError);
    await expect(repository.readDocument(workItemId, 'CURRENT_STATE')).resolves.toEqual(
      beforeDocument,
    );
    await expect(repository.readDocument(workItemId, 'MANIFEST')).resolves.toEqual(beforeManifest);
    await expect(stat(join(root, '.ws-workspace', '.staging'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects unsafe identifiers and active lifecycle locks without exposing paths', async () => {
    const { root, workItemId, repository, initialization } = await createDossier();
    await repository.initializeDocuments(initialization);
    await mkdir(join(root, '.ws-workspace', '.locks'));
    await writeFile(
      join(root, '.ws-workspace', '.locks', `${workItemId}.lifecycle.lock`),
      '',
      'utf8',
    );

    await expect(repository.readLifecycleMetadata(workItemId)).rejects.toBeInstanceOf(
      DocumentLifecycleConflictError,
    );
    await expect(repository.readWorkItem('../outside')).rejects.toBeInstanceOf(
      WorkItemNotFoundError,
    );
  });
});
