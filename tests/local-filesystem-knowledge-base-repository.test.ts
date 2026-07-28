import { createHash } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DocumentLifecycleConflictError,
  DocumentUpdateError,
} from '../src/errors/workspace-error.js';
import { LocalFilesystemWorkItemAuditRepository } from '../src/filesystem/local-filesystem-work-item-audit-repository.js';
import {
  KNOWLEDGE_BASE_RELATIVE_PATH,
  KnowledgeBaseConflictError,
  KnowledgeBaseCorruptError,
  KnowledgeBaseUpdateError,
  LocalFilesystemKnowledgeBaseRepository,
} from '../src/filesystem/local-filesystem-knowledge-base-repository.js';
import { LocalFilesystemWorkItemDossierRepository } from '../src/filesystem/local-filesystem-work-item-dossier-repository.js';
import { initializeWorkspace } from '../src/filesystem/workspace-initializer.js';
import { WorkItemOperationCoordinator } from '../src/filesystem/work-item-operation-coordinator.js';
import {
  WORKSPACE_KNOWLEDGE_COORDINATOR_ID,
  WorkspaceKnowledgeOperationGate,
} from '../src/filesystem/workspace-knowledge-operation-gate.js';
import { AIContextProjectionService } from '../src/services/ai-context-projection-service.js';
import { AuditContextSummaryService } from '../src/services/audit-context-summary-service.js';
import { AuditLedgerService } from '../src/services/audit-ledger-service.js';
import { AuditProjectionService } from '../src/services/audit-projection-service.js';
import { SystemClock } from '../src/services/clock.js';
import { DocumentTemplateService } from '../src/services/document-template-service.js';
import { M5_PROJECTION_PATHS } from '../src/services/m5-projection-service.js';
import { ManifestSectionCompositor } from '../src/services/manifest-section-compositor.js';
import { ManifestLifecycleService } from '../src/services/manifest-lifecycle-service.js';
import { M4ManifestInventoryService } from '../src/services/m4-manifest-inventory-service.js';
import { SystemIdGenerator } from '../src/services/id-generator.js';
import { WorkItemAuditService } from '../src/services/work-item-audit-service.js';
import { WorkItemCreationService } from '../src/services/work-item-creation-service.js';
import { WorkItemDocumentService } from '../src/services/work-item-document-service.js';
import { createTemporaryWorkspaceRoot, removeTemporaryWorkspaceRoot } from './helpers.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(removeTemporaryWorkspaceRoot));
});

function workItemInput(rallyId: string): Record<string, unknown> {
  return {
    type: 'USER_STORY',
    rallyId,
    title: `Knowledge repository fixture ${rallyId}`,
    functionalDefinition: 'Exercise one atomic Milestone 5 knowledge commit.',
    developmentAlias: 'knowledge-test',
    relatedComponents: ['knowledge-base'],
    startedAt: '2026-07-28',
  };
}

interface RepositoryFixture {
  root: string;
  workItemIds: string[];
}

async function createFixture(...workItemIds: string[]): Promise<RepositoryFixture> {
  const root = await createTemporaryWorkspaceRoot();
  temporaryRoots.push(root);
  await initializeWorkspace(root);
  const creation = new WorkItemCreationService({ workspaceRoot: root });
  for (const workItemId of workItemIds) {
    await creation.create(workItemInput(workItemId));
    await new WorkItemDocumentService(
      new LocalFilesystemWorkItemDossierRepository({ workspaceRoot: root }),
      new DocumentTemplateService(),
      new ManifestLifecycleService(new SystemClock()),
      new AIContextProjectionService(),
    ).initialize({ workItemId });
  }
  return { root, workItemIds };
}

async function initializeTracking(fixture: RepositoryFixture, workItemId: string): Promise<void> {
  await new WorkItemAuditService(
    new LocalFilesystemWorkItemAuditRepository({ workspaceRoot: fixture.root }),
    new AuditLedgerService(new SystemClock(), new SystemIdGenerator()),
    new AuditProjectionService(),
    new M4ManifestInventoryService(),
    new AuditContextSummaryService(),
  ).initialize({ workItemId });
}

function dossierArtifactPath(
  fixture: RepositoryFixture,
  workItemId: string,
  relativePath: string,
): string {
  return join(fixture.root, '.ws-workspace', 'active', workItemId, relativePath);
}

function ledgerPath(fixture: RepositoryFixture): string {
  return join(fixture.root, '.ws-workspace', ...KNOWLEDGE_BASE_RELATIVE_PATH.split('/'));
}

function fullProjectionReplacements(workItemId: string, manifest: string, label: string) {
  const artifacts = Object.fromEntries(
    M5_PROJECTION_PATHS.map((relativePath) => [relativePath, `# ${relativePath}\n\n${label}\n`]),
  ) as Record<(typeof M5_PROJECTION_PATHS)[number], string>;
  const inventory = [
    '## Milestone 5 Workflow and Knowledge Inventory',
    '',
    '- Schema version: 1.0.0',
    '- Knowledge revision: 1',
    '- Work Item revision: 1',
    '- Canonical status: IN_PROGRESS',
    '',
    '| Relative path | Projection | SHA-256 |',
    '| --- | --- | --- |',
    ...M5_PROJECTION_PATHS.map(
      (relativePath) =>
        `| ${relativePath} | PROTECTED | ${createHash('sha256').update(artifacts[relativePath], 'utf8').digest('hex')} |`,
    ),
  ].join('\n');
  const manifestWithInventory = new ManifestSectionCompositor().upsertM5KnowledgeInventory(
    manifest,
    inventory,
  );
  return {
    artifacts,
    replacements: [
      { workItemId, relativePath: '00_MANIFEST.md', content: manifestWithInventory },
      ...M5_PROJECTION_PATHS.map((relativePath) => ({
        workItemId,
        relativePath,
        content: artifacts[relativePath],
      })),
    ],
  };
}

describe('LocalFilesystemKnowledgeBaseRepository', () => {
  it('commits the workspace ledger and a protected dossier projection atomically', async () => {
    const fixture = await createFixture('KB-ATOMIC-1');
    const repository = new LocalFilesystemKnowledgeBaseRepository({
      workspaceRoot: fixture.root,
    });
    const ledgerContent = '{"schemaVersion":"1.0.0","knowledgeRevision":1}\n';
    let projectionContent = '';

    const result = await repository.withSnapshot(['KB-ATOMIC-1'], (snapshot) => {
      const dossier = snapshot.dossiers.get('KB-ATOMIC-1');
      expect(snapshot.ledgerContent).toBeUndefined();
      expect(dossier).toBeDefined();
      expect(dossier?.dossierRelativePath).toBe('.ws-workspace/active/KB-ATOMIC-1');
      expect(dossier?.existingM5Artifacts.size).toBe(0);
      const projection = fullProjectionReplacements(
        'KB-ATOMIC-1',
        dossier!.manifest,
        'Confirmed projection revision 1.',
      );
      projectionContent = projection.artifacts['10_FUNCTIONAL_OVERVIEW.md'];
      return {
        result: {
          ledgerPath: KNOWLEDGE_BASE_RELATIVE_PATH,
          dossierPath: `${dossier!.dossierRelativePath}/10_FUNCTIONAL_OVERVIEW.md`,
        },
        commit: {
          ledgerContent,
          dossierReplacements: projection.replacements,
          validateCommitted: (committed) => {
            expect(committed.ledgerContent).toBe(ledgerContent);
            expect(
              committed.dossiers
                .get('KB-ATOMIC-1')
                ?.existingM5Artifacts.has('10_FUNCTIONAL_OVERVIEW.md'),
            ).toBe(true);
          },
        },
      };
    });

    expect(result).toEqual({
      ledgerPath: 'records/KNOWLEDGE_BASE.json',
      dossierPath: '.ws-workspace/active/KB-ATOMIC-1/10_FUNCTIONAL_OVERVIEW.md',
    });
    expect(JSON.stringify(result)).not.toContain(fixture.root);
    await expect(readFile(ledgerPath(fixture), 'utf8')).resolves.toBe(ledgerContent);
    await expect(
      readFile(dossierArtifactPath(fixture, 'KB-ATOMIC-1', '10_FUNCTIONAL_OVERVIEW.md'), 'utf8'),
    ).resolves.toBe(projectionContent);
  });

  it('fails closed when dossier projections survive a missing workspace ledger', async () => {
    const fixture = await createFixture('KB-ORPHANED-LEDGER');
    const repository = new LocalFilesystemKnowledgeBaseRepository({
      workspaceRoot: fixture.root,
    });
    await repository.withSnapshot(['KB-ORPHANED-LEDGER'], (snapshot) => ({
      result: undefined,
      commit: {
        ledgerContent: '{"schemaVersion":"1.0.0","knowledgeRevision":1}\n',
        dossierReplacements: fullProjectionReplacements(
          'KB-ORPHANED-LEDGER',
          snapshot.dossiers.get('KB-ORPHANED-LEDGER')!.manifest,
          'Projection whose canonical ledger must remain present.',
        ).replacements,
      },
    }));

    await unlink(ledgerPath(fixture));

    await expect(repository.withSnapshot([], () => ({ result: undefined }))).rejects.toBeInstanceOf(
      KnowledgeBaseCorruptError,
    );
  });

  it('recovers an abandoned between-replacements commit before confirming the next operation', async () => {
    const fixture = await createFixture('KB-RECOVERY-1');
    const normal = new LocalFilesystemKnowledgeBaseRepository({
      workspaceRoot: fixture.root,
    });
    const baselineLedger = '{"schemaVersion":"1.0.0","knowledgeRevision":1}\n';
    let baselineProjection = '';

    await normal.withSnapshot(['KB-RECOVERY-1'], (snapshot) => {
      const projection = fullProjectionReplacements(
        'KB-RECOVERY-1',
        snapshot.dossiers.get('KB-RECOVERY-1')!.manifest,
        'Confirmed baseline.',
      );
      baselineProjection = projection.artifacts['11_IMPLEMENTATION.md'];
      return {
        result: undefined,
        commit: {
          ledgerContent: baselineLedger,
          dossierReplacements: projection.replacements,
        },
      };
    });
    const baselineManifest = await readFile(
      dossierArtifactPath(fixture, 'KB-RECOVERY-1', '00_MANIFEST.md'),
      'utf8',
    );

    const abandoning = new LocalFilesystemKnowledgeBaseRepository({
      workspaceRoot: fixture.root,
      injectTransactionFailure: (point) =>
        point === 'between-replacements' ? 'abandon' : undefined,
    });
    const unconfirmedLedger = '{"schemaVersion":"1.0.0","knowledgeRevision":2}\n';
    let failure: unknown;
    try {
      await abandoning.withSnapshot(['KB-RECOVERY-1'], (snapshot) => {
        const projection = fullProjectionReplacements(
          'KB-RECOVERY-1',
          snapshot.dossiers.get('KB-RECOVERY-1')!.manifest,
          'Unconfirmed partial replacement.',
        );
        return {
          result: undefined,
          commit: {
            ledgerContent: unconfirmedLedger,
            dossierReplacements: projection.replacements,
          },
        };
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(KnowledgeBaseUpdateError);
    expect(String(failure)).not.toContain(fixture.root);
    await expect(
      new LocalFilesystemWorkItemDossierRepository({
        workspaceRoot: fixture.root,
      }).readManifestContent('KB-RECOVERY-1'),
    ).resolves.toBe(baselineManifest);

    const nextLedger = '{"schemaVersion":"1.0.0","knowledgeRevision":2}\n';
    let nextProjection = '';
    const recovered = await normal.withSnapshot(['KB-RECOVERY-1'], async (snapshot) => {
      expect(snapshot.ledgerContent).toBe(baselineLedger);
      await expect(
        readFile(dossierArtifactPath(fixture, 'KB-RECOVERY-1', '11_IMPLEMENTATION.md'), 'utf8'),
      ).resolves.toBe(baselineProjection);
      const projection = fullProjectionReplacements(
        'KB-RECOVERY-1',
        snapshot.dossiers.get('KB-RECOVERY-1')!.manifest,
        'Next confirmed operation after recovery.',
      );
      nextProjection = projection.artifacts['11_IMPLEMENTATION.md'];
      return {
        result: {
          ledgerPath: KNOWLEDGE_BASE_RELATIVE_PATH,
          workItemId: 'KB-RECOVERY-1',
        },
        commit: {
          ledgerContent: nextLedger,
          dossierReplacements: projection.replacements,
        },
      };
    });

    expect(JSON.stringify(recovered)).not.toContain(fixture.root);
    await expect(readFile(ledgerPath(fixture), 'utf8')).resolves.toBe(nextLedger);
    await expect(
      readFile(dossierArtifactPath(fixture, 'KB-RECOVERY-1', '11_IMPLEMENTATION.md'), 'utf8'),
    ).resolves.toBe(nextProjection);
  });

  it('rejects partial or hash-divergent protected projection sets', async () => {
    const partialFixture = await createFixture('KB-CORRUPT-PARTIAL');
    await writeFile(
      dossierArtifactPath(partialFixture, 'KB-CORRUPT-PARTIAL', '10_FUNCTIONAL_OVERVIEW.md'),
      '# Partial\n',
      'utf8',
    );
    await expect(
      new LocalFilesystemKnowledgeBaseRepository({
        workspaceRoot: partialFixture.root,
      }).withSnapshot(['KB-CORRUPT-PARTIAL'], () => ({ result: undefined })),
    ).rejects.toBeInstanceOf(KnowledgeBaseCorruptError);

    const tamperedFixture = await createFixture('KB-CORRUPT-HASH');
    const repository = new LocalFilesystemKnowledgeBaseRepository({
      workspaceRoot: tamperedFixture.root,
    });
    await repository.withSnapshot(['KB-CORRUPT-HASH'], (snapshot) => ({
      result: undefined,
      commit: {
        ledgerContent: '{"schemaVersion":"1.0.0","knowledgeRevision":1}\n',
        dossierReplacements: fullProjectionReplacements(
          'KB-CORRUPT-HASH',
          snapshot.dossiers.get('KB-CORRUPT-HASH')!.manifest,
          'Confirmed before tampering.',
        ).replacements,
      },
    }));
    await writeFile(
      dossierArtifactPath(tamperedFixture, 'KB-CORRUPT-HASH', '11_IMPLEMENTATION.md'),
      '# Tampered\n',
      'utf8',
    );
    await expect(
      repository.withSnapshot(['KB-CORRUPT-HASH'], () => ({ result: undefined })),
    ).rejects.toBeInstanceOf(KnowledgeBaseCorruptError);
  });

  it('rejects a historical M4 inventory whose declared artifact is missing', async () => {
    const fixture = await createFixture('KB-CORRUPT-M4');
    await initializeTracking(fixture, 'KB-CORRUPT-M4');
    await unlink(dossierArtifactPath(fixture, 'KB-CORRUPT-M4', '08_TEST_PLAN.md'));

    await expect(
      new LocalFilesystemKnowledgeBaseRepository({
        workspaceRoot: fixture.root,
      }).withSnapshot(['KB-CORRUPT-M4'], () => ({ result: undefined })),
    ).rejects.toBeInstanceOf(KnowledgeBaseCorruptError);
  });

  it('recovers an abandoned historical dossier journal before an M5 read', async () => {
    const fixture = await createFixture('KB-CROSS-RECOVERY');
    const dossierDirectory = join(fixture.root, '.ws-workspace', 'active', 'KB-CROSS-RECOVERY');
    const manifestPath = join(dossierDirectory, '00_MANIFEST.md');
    const baselineManifest = await readFile(manifestPath, 'utf8');
    const historicalCoordinator = new WorkItemOperationCoordinator({
      workspaceRoot: fixture.root,
      allowedRelativePaths: ['00_MANIFEST.md'],
      recoveryAllowedRelativePaths: ['00_MANIFEST.md'],
      conflictError: () => new DocumentLifecycleConflictError('Historical lock conflict.'),
      updateError: () => new DocumentUpdateError('Historical update interrupted.'),
      recoveryError: () => new DocumentUpdateError('Historical recovery failed.'),
      injectFailure: (point) => (point === 'after-originals-moved' ? 'abandon' : undefined),
    });

    await expect(
      historicalCoordinator.runExclusive('KB-CROSS-RECOVERY', dossierDirectory, () =>
        historicalCoordinator.commit(
          'KB-CROSS-RECOVERY',
          dossierDirectory,
          [
            {
              relativePath: '00_MANIFEST.md',
              content: `${baselineManifest}\nUnconfirmed historical mutation.\n`,
              originalExists: true,
            },
          ],
          async () => undefined,
        ),
      ),
    ).rejects.toBeInstanceOf(DocumentUpdateError);

    const recoveredManifest = await new LocalFilesystemKnowledgeBaseRepository({
      workspaceRoot: fixture.root,
    }).withSnapshot(['KB-CROSS-RECOVERY'], (snapshot) => ({
      result: snapshot.dossiers.get('KB-CROSS-RECOVERY')!.manifest,
    }));
    expect(recoveredManifest).toBe(baselineManifest);
    await expect(readFile(manifestPath, 'utf8')).resolves.toBe(baselineManifest);
  });

  it('recovers a global journal after WORK_ITEM.yml was moved out of the dossier', async () => {
    const fixture = await createFixture('KB-GLOBAL-ORIGINALS');
    const workItemPath = dossierArtifactPath(fixture, 'KB-GLOBAL-ORIGINALS', 'WORK_ITEM.yml');
    const manifestPath = dossierArtifactPath(fixture, 'KB-GLOBAL-ORIGINALS', '00_MANIFEST.md');
    const baselineWorkItem = await readFile(workItemPath, 'utf8');
    const baselineManifest = await readFile(manifestPath, 'utf8');
    const abandoningGate = new WorkspaceKnowledgeOperationGate({
      workspaceRoot: fixture.root,
      conflictError: () => new KnowledgeBaseConflictError(),
      updateError: () => new KnowledgeBaseUpdateError(),
      recoveryError: () => new KnowledgeBaseCorruptError(),
      injectFailure: (point) => (point === 'after-originals-moved' ? 'abandon' : undefined),
    });

    await expect(
      abandoningGate.runExclusive(({ coordinator, workspaceDirectory }) =>
        coordinator.commit(
          WORKSPACE_KNOWLEDGE_COORDINATOR_ID,
          workspaceDirectory,
          [
            {
              relativePath: 'active/KB-GLOBAL-ORIGINALS/WORK_ITEM.yml',
              content: `${baselineWorkItem}\n# Unconfirmed mutation.\n`,
              originalExists: true,
            },
            {
              relativePath: 'active/KB-GLOBAL-ORIGINALS/00_MANIFEST.md',
              content: `${baselineManifest}\nUnconfirmed mutation.\n`,
              originalExists: true,
            },
          ],
          async () => undefined,
        ),
      ),
    ).rejects.toBeInstanceOf(KnowledgeBaseUpdateError);
    await expect(readFile(workItemPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(manifestPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    const recovered = await new LocalFilesystemKnowledgeBaseRepository({
      workspaceRoot: fixture.root,
    }).withSnapshot(['KB-GLOBAL-ORIGINALS'], (snapshot) => {
      const dossier = snapshot.dossiers.get('KB-GLOBAL-ORIGINALS');
      return {
        result: {
          workItemId: dossier?.workItem.id,
          workItemYml: dossier?.workItemYml,
          manifest: dossier?.manifest,
        },
      };
    });

    expect(recovered).toEqual({
      workItemId: 'KB-GLOBAL-ORIGINALS',
      workItemYml: baselineWorkItem,
      manifest: baselineManifest,
    });
    await expect(readFile(workItemPath, 'utf8')).resolves.toBe(baselineWorkItem);
    await expect(readFile(manifestPath, 'utf8')).resolves.toBe(baselineManifest);
  });

  it('rejects arbitrary additions to the workspace recovery allowlist', async () => {
    const fixture = await createFixture('KB-ALLOWLIST');
    const gate = new WorkspaceKnowledgeOperationGate({
      workspaceRoot: fixture.root,
      conflictError: () => new KnowledgeBaseConflictError(),
      updateError: () => new KnowledgeBaseUpdateError(),
      recoveryError: () => new KnowledgeBaseCorruptError(),
    });
    let entered = false;

    await expect(
      gate.runExclusive(async () => {
        entered = true;
      }, ['active/KB-ALLOWLIST/unmanaged.txt']),
    ).rejects.toBeInstanceOf(KnowledgeBaseCorruptError);
    expect(entered).toBe(false);
  });

  it('serializes concurrent mutations through one global knowledge lock', async () => {
    const fixture = await createFixture('KB-LOCK-A', 'KB-LOCK-B');
    const holder = new LocalFilesystemKnowledgeBaseRepository({
      workspaceRoot: fixture.root,
    });
    const contender = new LocalFilesystemKnowledgeBaseRepository({
      workspaceRoot: fixture.root,
    });
    let enteredResolve: (() => void) | undefined;
    let releaseResolve: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredResolve = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseResolve = resolve;
    });
    const held = holder.withSnapshot(['KB-LOCK-A'], async (snapshot) => {
      enteredResolve?.();
      await release;
      return {
        result: snapshot.dossiers.get('KB-LOCK-A')?.dossierRelativePath,
      };
    });
    await entered;

    await expect(
      new LocalFilesystemWorkItemDossierRepository({
        workspaceRoot: fixture.root,
      }).readManifestContent('KB-LOCK-A'),
    ).rejects.toBeInstanceOf(DocumentLifecycleConflictError);

    let conflict: unknown;
    try {
      await contender.withSnapshot(['KB-LOCK-B'], () => ({
        result: 'must-not-run',
      }));
    } catch (error) {
      conflict = error;
    } finally {
      releaseResolve?.();
    }

    expect(conflict).toBeInstanceOf(KnowledgeBaseConflictError);
    expect(String(conflict)).not.toContain(fixture.root);
    await expect(held).resolves.toBe('.ws-workspace/active/KB-LOCK-A');
  });
});
