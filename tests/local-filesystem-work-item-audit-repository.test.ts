import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  rmdir,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AUDIT_ARTIFACT_RELATIVE_PATHS as M4_ARTIFACT_PATHS,
  type AuditLedger,
} from '../src/domain/work-item-audit.js';
import {
  AuditLedgerCorruptError,
  AuditTrackingConflictError,
  AuditTrackingUpdateError,
  DocumentLifecycleConflictError,
  ManifestUpdateError,
  WorkItemNotFoundError,
} from '../src/errors/workspace-error.js';
import { LocalFilesystemWorkItemAuditRepository } from '../src/filesystem/local-filesystem-work-item-audit-repository.js';
import {
  LocalFilesystemWorkItemDossierRepository,
  parseLifecycleMetadata,
} from '../src/filesystem/local-filesystem-work-item-dossier-repository.js';
import type {
  WorkItemTransactionFailureMode,
  WorkItemTransactionFailurePoint,
} from '../src/filesystem/work-item-operation-coordinator.js';
import { AIContextProjectionService } from '../src/services/ai-context-projection-service.js';
import { AuditContextSummaryService } from '../src/services/audit-context-summary-service.js';
import { AuditLedgerService } from '../src/services/audit-ledger-service.js';
import { AuditProjectionService } from '../src/services/audit-projection-service.js';
import type { Clock } from '../src/services/clock.js';
import { DocumentTemplateService } from '../src/services/document-template-service.js';
import type { IdGenerator } from '../src/services/id-generator.js';
import { M4ManifestInventoryService } from '../src/services/m4-manifest-inventory-service.js';
import { ManifestLifecycleService } from '../src/services/manifest-lifecycle-service.js';
import { WorkItemAuditService } from '../src/services/work-item-audit-service.js';
import { WorkItemCreationService } from '../src/services/work-item-creation-service.js';
import { WorkItemDocumentService } from '../src/services/work-item-document-service.js';
import { initializeWorkspace } from '../src/filesystem/workspace-initializer.js';
import { createTemporaryWorkspaceRoot, removeTemporaryWorkspaceRoot } from './helpers.js';

const temporaryRoots: string[] = [];
const fixedM3Clock: Clock = { now: () => '2026-07-24T09:00:00.000Z' };
const COMMITTED_RELATIVE_PATHS = [...M4_ARTIFACT_PATHS, '00_MANIFEST.md'] as const;
const FAILURE_POINTS = [
  'after-staging-prepared',
  'before-promotion',
  'after-originals-moved',
  'between-replacements',
  'before-confirm',
] as const satisfies readonly WorkItemTransactionFailurePoint[];

class SequentialClock implements Clock {
  private nextOffset = 0;

  public now(): string {
    const timestamp = new Date(Date.UTC(2026, 6, 24, 12, 0, this.nextOffset));
    this.nextOffset += 1;
    return timestamp.toISOString();
  }
}

class SequentialIdGenerator implements IdGenerator {
  private nextId = 1;

  public generate(): string {
    const suffix = String(this.nextId).padStart(12, '0');
    this.nextId += 1;
    return `00000000-0000-4000-8000-${suffix}`;
  }
}

interface M3Fixture {
  root: string;
  workItemId: string;
  dossierDirectory: string;
  repository: LocalFilesystemWorkItemDossierRepository;
  service: WorkItemDocumentService;
}

interface AuditHarness {
  repository: LocalFilesystemWorkItemAuditRepository;
  service: WorkItemAuditService;
  ledgerService: AuditLedgerService;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(removeTemporaryWorkspaceRoot));
});

async function createM3Fixture(): Promise<M3Fixture> {
  const root = await createTemporaryWorkspaceRoot();
  temporaryRoots.push(root);
  await initializeWorkspace(root);
  const created = await new WorkItemCreationService({ workspaceRoot: root }).create({
    type: 'USER_STORY',
    rallyId: 'US-4242',
    title: 'Exercise M4 filesystem persistence',
    functionalDefinition: 'M4 data is persisted as one consistent local snapshot.',
    developmentAlias: 'local-development',
    relatedComponents: ['workspace-mcp'],
    startedAt: '2026-07-24',
  });
  const repository = new LocalFilesystemWorkItemDossierRepository({ workspaceRoot: root });
  const service = new WorkItemDocumentService(
    repository,
    new DocumentTemplateService(),
    new ManifestLifecycleService(fixedM3Clock),
    new AIContextProjectionService(),
  );
  await service.initialize({ workItemId: created.id });
  return {
    root,
    workItemId: created.id,
    dossierDirectory: join(root, '.ws-workspace', 'active', created.id),
    repository,
    service,
  };
}

function createAuditHarness(
  root: string,
  injectTransactionFailure?: (
    point: WorkItemTransactionFailurePoint,
    promotedCount: number,
  ) => WorkItemTransactionFailureMode | undefined,
): AuditHarness {
  const repository = new LocalFilesystemWorkItemAuditRepository({
    workspaceRoot: root,
    ...(injectTransactionFailure === undefined ? {} : { injectTransactionFailure }),
  });
  const ledgerService = new AuditLedgerService(new SequentialClock(), new SequentialIdGenerator());
  return {
    repository,
    ledgerService,
    service: new WorkItemAuditService(
      repository,
      ledgerService,
      new AuditProjectionService(),
      new M4ManifestInventoryService(),
      new AuditContextSummaryService(),
    ),
  };
}

function dossierPath(fixture: M3Fixture, relativePath: string): string {
  return join(fixture.dossierDirectory, relativePath);
}

async function readCommittedSet(fixture: M3Fixture): Promise<Record<string, string>> {
  const entries = await Promise.all(
    COMMITTED_RELATIVE_PATHS.map(async (relativePath) => {
      return [relativePath, await readFile(dossierPath(fixture, relativePath), 'utf8')] as const;
    }),
  );
  return Object.fromEntries(entries);
}

async function expectAuditArtifactsAbsent(fixture: M3Fixture): Promise<void> {
  for (const relativePath of M4_ARTIFACT_PATHS) {
    await expect(stat(dossierPath(fixture, relativePath))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  }
}

function decisionInput(workItemId: string, idempotencyKey: string, expectedAuditRevision = 0) {
  return {
    workItemId,
    expectedAuditRevision,
    idempotencyKey,
    kind: 'DECISION',
    title: 'Keep the transaction local',
    decision: 'Use the contained multi-file transaction.',
    rationale: 'All visible artifacts must describe one ledger revision.',
    declaredActor: 'Persistence test',
  };
}

describe('LocalFilesystemWorkItemAuditRepository persistence', () => {
  it('accepts a valid CRLF M3 manifest and preserves its newline convention', async () => {
    const fixture = await createM3Fixture();
    const manifestPath = dossierPath(fixture, '00_MANIFEST.md');
    const manifest = await readFile(manifestPath, 'utf8');
    await writeFile(manifestPath, manifest.replace(/\n/g, '\r\n'), 'utf8');
    const audit = createAuditHarness(fixture.root);

    await expect(
      audit.service.initialize({ workItemId: fixture.workItemId }),
    ).resolves.toMatchObject({ auditRevision: 0 });
    const updatedManifest = await readFile(manifestPath, 'utf8');
    expect(updatedManifest).toContain('\r\n## Milestone 4 Audit Inventory\r\n');
    expect(updatedManifest.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('supports an M3 update after M4 initialization on a CRLF manifest', async () => {
    const fixture = await createM3Fixture();
    const manifestPath = dossierPath(fixture, '00_MANIFEST.md');
    const manifest = await readFile(manifestPath, 'utf8');
    await writeFile(manifestPath, manifest.replace(/\n/g, '\r\n'), 'utf8');
    const audit = createAuditHarness(fixture.root);

    await audit.service.initialize({ workItemId: fixture.workItemId });
    await expect(
      fixture.service.update({
        workItemId: fixture.workItemId,
        documentType: 'CURRENT_STATE',
        expectedRevision: 1,
        payload: { knownFacts: ['CRLF remains valid across M3 and M4.'] },
      }),
    ).resolves.toMatchObject({
      workItemId: fixture.workItemId,
      document: { revision: 2 },
    });

    const updatedManifest = await readFile(manifestPath, 'utf8');
    expect(updatedManifest).toContain('\r\n## Milestone 4 Audit Inventory\r\n');
    expect(parseLifecycleMetadata(updatedManifest)).toHaveLength(7);
    expect(new M4ManifestInventoryService().parse(updatedManifest)).toMatchObject({
      auditRevision: 0,
    });
  });

  it.each([
    ['separator', '| --- | --- | --- | --- | --- | --- | --- |', '| --- | invalid |'],
    ['generated timestamp', '- Generated at: 2026-07-24T09:00:00.000Z', '- Generated at: invalid'],
  ])('returns the historical manifest error for corrupt M3 %s', async (_case, valid, corrupt) => {
    const fixture = await createM3Fixture();
    const manifestPath = dossierPath(fixture, '00_MANIFEST.md');
    const manifest = await readFile(manifestPath, 'utf8');
    await writeFile(manifestPath, manifest.replace(valid, corrupt), 'utf8');
    const audit = createAuditHarness(fixture.root);

    await expect(
      audit.service.initialize({ workItemId: fixture.workItemId }),
    ).rejects.toBeInstanceOf(ManifestUpdateError);
    await expectAuditArtifactsAbsent(fixture);
  });

  it('initializes exactly five M4 artifacts and is structurally idempotent without overwriting', async () => {
    const fixture = await createM3Fixture();
    const audit = createAuditHarness(fixture.root);
    const workItemBefore = await readFile(dossierPath(fixture, 'WORK_ITEM.yml'), 'utf8');

    const initialized = await audit.service.initialize({ workItemId: fixture.workItemId });
    const firstCommittedSet = await readCommittedSet(fixture);
    const second = await audit.service.initialize({ workItemId: fixture.workItemId });
    const secondCommittedSet = await readCommittedSet(fixture);

    expect(initialized).toEqual({
      workItemId: fixture.workItemId,
      auditRevision: 0,
      created: [...M4_ARTIFACT_PATHS],
      existing: [],
    });
    expect(second).toEqual({
      workItemId: fixture.workItemId,
      auditRevision: 0,
      created: [],
      existing: [...M4_ARTIFACT_PATHS],
    });
    expect(secondCommittedSet).toEqual(firstCommittedSet);
    expect(await readFile(dossierPath(fixture, 'WORK_ITEM.yml'), 'utf8')).toBe(workItemBefore);
    expect(JSON.stringify(initialized)).not.toContain(fixture.root);
    expect(await stat(dossierPath(fixture, 'records'))).toMatchObject({
      isDirectory: expect.any(Function),
    });
    await expect(stat(dossierPath(fixture, '09_FINAL_REPORT.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const ledger = audit.ledgerService.parse(firstCommittedSet['records/AUDIT_LEDGER.json'] ?? '');
    expect(ledger.revision).toBe(0);
    expect(
      firstCommittedSet['00_MANIFEST.md']?.match(/## Milestone 4 Audit Inventory/g),
    ).toHaveLength(1);
    expect(
      firstCommittedSet['00_MANIFEST.md']!.indexOf('## Milestone 4 Audit Inventory'),
    ).toBeLessThan(firstCommittedSet['00_MANIFEST.md']!.indexOf('## Document Lifecycle Inventory'));
  });

  it('rejects a partial pre-existing M4 set without overwriting or completing it', async () => {
    const fixture = await createM3Fixture();
    const audit = createAuditHarness(fixture.root);
    const protectedContent = 'manually protected content\n';
    const manifestBefore = await readFile(dossierPath(fixture, '00_MANIFEST.md'), 'utf8');
    await writeFile(dossierPath(fixture, '06_DECISIONS.md'), protectedContent, 'utf8');

    await expect(
      audit.service.initialize({ workItemId: fixture.workItemId }),
    ).rejects.toBeInstanceOf(AuditLedgerCorruptError);

    await expect(readFile(dossierPath(fixture, '06_DECISIONS.md'), 'utf8')).resolves.toBe(
      protectedContent,
    );
    await expect(readFile(dossierPath(fixture, '00_MANIFEST.md'), 'utf8')).resolves.toBe(
      manifestBefore,
    );
    for (const relativePath of M4_ARTIFACT_PATHS.filter((path) => path !== '06_DECISIONS.md')) {
      await expect(stat(dossierPath(fixture, relativePath))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }
  });

  it('uses one physical exclusion boundary for M3 and M4 in both directions', async () => {
    const fixture = await createM3Fixture();
    const audit = createAuditHarness(fixture.root);
    await audit.service.initialize({ workItemId: fixture.workItemId });
    let enteredResolve: (() => void) | undefined;
    let releaseResolve: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredResolve = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseResolve = resolve;
    });
    const heldAuditOperation = audit.repository.withSnapshot(
      fixture.workItemId,
      async (snapshot) => {
        enteredResolve?.();
        await release;
        return { result: snapshot.workItem.id };
      },
    );
    await entered;

    try {
      await expect(fixture.repository.readWorkItem(fixture.workItemId)).rejects.toBeInstanceOf(
        DocumentLifecycleConflictError,
      );
    } finally {
      releaseResolve?.();
    }
    await expect(heldAuditOperation).resolves.toBe(fixture.workItemId);

    const lockDirectory = join(fixture.root, '.ws-workspace', '.locks');
    const lockPath = join(lockDirectory, `${fixture.workItemId}.lifecycle.lock`);
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(lockPath, 'simulated M3 holder\n', 'utf8');
    try {
      await expect(
        audit.service.getTracking({
          workItemId: fixture.workItemId,
          trackingType: 'DECISIONS',
        }),
      ).rejects.toBeInstanceOf(AuditTrackingConflictError);
    } finally {
      await rm(lockPath, { force: true });
      await rmdir(lockDirectory).catch(() => undefined);
    }
  });

  it('rejects traversal before filesystem use and preserves an outside sentinel', async () => {
    const fixture = await createM3Fixture();
    const audit = createAuditHarness(fixture.root);
    const outsideSentinel = join(fixture.root, 'outside-sentinel.txt');
    await writeFile(outsideSentinel, 'unchanged\n', 'utf8');

    await expect(audit.service.initialize({ workItemId: '../OUTSIDE' })).rejects.toBeInstanceOf(
      WorkItemNotFoundError,
    );

    await expect(readFile(outsideSentinel, 'utf8')).resolves.toBe('unchanged\n');
  });

  it('rejects a symlinked dossier evidence directory without writing through it', async () => {
    const fixture = await createM3Fixture();
    const audit = createAuditHarness(fixture.root);
    const outsideEvidence = join(fixture.root, 'outside-evidence');
    const evidenceDirectory = dossierPath(fixture, 'evidence');
    await mkdir(outsideEvidence);
    await rmdir(evidenceDirectory);
    await symlink(outsideEvidence, evidenceDirectory, 'junction');
    expect((await lstat(evidenceDirectory)).isSymbolicLink()).toBe(true);

    await expect(
      audit.service.initialize({ workItemId: fixture.workItemId }),
    ).rejects.toBeInstanceOf(AuditLedgerCorruptError);

    await expect(readdir(outsideEvidence)).resolves.toEqual([]);
  });

  it('rejects a symlinked staging parent without creating external transaction material', async () => {
    const fixture = await createM3Fixture();
    const audit = createAuditHarness(fixture.root);
    const outsideStaging = join(fixture.root, 'outside-staging');
    const stagingParent = join(fixture.root, '.ws-workspace', '.staging');
    await mkdir(outsideStaging);
    await symlink(outsideStaging, stagingParent, 'junction');
    expect((await lstat(stagingParent)).isSymbolicLink()).toBe(true);

    await expect(
      audit.service.initialize({ workItemId: fixture.workItemId }),
    ).rejects.toBeInstanceOf(AuditLedgerCorruptError);

    await expect(readdir(outsideStaging)).resolves.toEqual([]);
    await expectAuditArtifactsAbsent(fixture);
  });

  it.each(FAILURE_POINTS)(
    'rolls back every visible file after an injected %s failure',
    async (failurePoint) => {
      const fixture = await createM3Fixture();
      const normal = createAuditHarness(fixture.root);
      await normal.service.initialize({ workItemId: fixture.workItemId });
      const committedBefore = await readCommittedSet(fixture);
      const observedPromotedCounts: number[] = [];
      const failing = createAuditHarness(fixture.root, (point, promotedCount) => {
        if (point === failurePoint) {
          observedPromotedCounts.push(promotedCount);
          return 'fail';
        }
        return undefined;
      });

      await expect(
        failing.service.recordDecision(
          decisionInput(fixture.workItemId, `failure-${failurePoint}`),
        ),
      ).rejects.toBeInstanceOf(AuditTrackingUpdateError);

      expect(observedPromotedCounts).toHaveLength(1);
      await expect(readCommittedSet(fixture)).resolves.toEqual(committedBefore);
      await expect(
        normal.service.getTracking({
          workItemId: fixture.workItemId,
          trackingType: 'DECISIONS',
        }),
      ).resolves.toMatchObject({ auditRevision: 0 });
      await expect(stat(join(fixture.root, '.ws-workspace', '.staging'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it('rolls back failed initialization without removing historical dossier directories', async () => {
    const fixture = await createM3Fixture();
    const manifestBefore = await readFile(dossierPath(fixture, '00_MANIFEST.md'), 'utf8');
    const failing = createAuditHarness(fixture.root, (point) =>
      point === 'before-confirm' ? 'fail' : undefined,
    );

    await expect(
      failing.service.initialize({ workItemId: fixture.workItemId }),
    ).rejects.toBeInstanceOf(AuditTrackingUpdateError);

    await expectAuditArtifactsAbsent(fixture);
    await expect(readFile(dossierPath(fixture, '00_MANIFEST.md'), 'utf8')).resolves.toBe(
      manifestBefore,
    );
    const evidence = await stat(dossierPath(fixture, 'evidence'));
    expect(evidence.isDirectory()).toBe(true);
    const records = await stat(dossierPath(fixture, 'records'));
    expect(records.isDirectory()).toBe(true);
    await expect(readdir(dossierPath(fixture, 'records'))).resolves.toEqual([]);
  });

  it('recovers an abandoned journal before the next read and restores the prior revision', async () => {
    const fixture = await createM3Fixture();
    const normal = createAuditHarness(fixture.root);
    await normal.service.initialize({ workItemId: fixture.workItemId });
    const committedBefore = await readCommittedSet(fixture);
    const abandoning = createAuditHarness(fixture.root, (point) =>
      point === 'between-replacements' ? 'abandon' : undefined,
    );

    await expect(
      abandoning.service.recordDecision(decisionInput(fixture.workItemId, 'abandoned-decision')),
    ).rejects.toBeInstanceOf(AuditTrackingUpdateError);
    const transactionDirectory = join(
      fixture.root,
      '.ws-workspace',
      '.staging',
      `${fixture.workItemId}-shared-transaction`,
    );
    expect((await stat(transactionDirectory)).isDirectory()).toBe(true);

    await expect(
      normal.service.getTracking({
        workItemId: fixture.workItemId,
        trackingType: 'DECISIONS',
      }),
    ).resolves.toMatchObject({ auditRevision: 0 });
    await expect(readCommittedSet(fixture)).resolves.toEqual(committedBefore);
    await expect(stat(transactionDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(fixture.root, '.ws-workspace', '.staging'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects a corrupt traversal journal without touching its claimed target', async () => {
    const fixture = await createM3Fixture();
    const audit = createAuditHarness(fixture.root);
    await audit.service.initialize({ workItemId: fixture.workItemId });
    const committedBefore = await readCommittedSet(fixture);
    const outsideSentinel = join(fixture.root, 'outside-journal-target.txt');
    await writeFile(outsideSentinel, 'unchanged\n', 'utf8');
    const transactionDirectory = join(
      fixture.root,
      '.ws-workspace',
      '.staging',
      `${fixture.workItemId}-shared-transaction`,
    );
    await mkdir(transactionDirectory, { recursive: true });
    await writeFile(
      join(transactionDirectory, 'journal.json'),
      JSON.stringify(
        {
          schemaVersion: '1.0.0',
          transactionId: 'corrupt-transaction',
          workItemId: fixture.workItemId,
          phase: 'PREPARED',
          promotedCount: 0,
          replacements: [
            {
              relativePath: '../../outside-journal-target.txt',
              originalExists: false,
              nextHash: '0'.repeat(64),
              backupName: '0.bak',
            },
          ],
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );

    await expect(
      audit.service.getTracking({
        workItemId: fixture.workItemId,
        trackingType: 'DECISIONS',
      }),
    ).rejects.toBeInstanceOf(AuditLedgerCorruptError);

    await expect(readFile(outsideSentinel, 'utf8')).resolves.toBe('unchanged\n');
    await expect(readCommittedSet(fixture)).resolves.toEqual(committedBefore);
    expect((await stat(transactionDirectory)).isDirectory()).toBe(true);
  });

  it('detects a corrupt ledger and never reconstructs it from Markdown projections', async () => {
    const fixture = await createM3Fixture();
    const audit = createAuditHarness(fixture.root);
    await audit.service.initialize({ workItemId: fixture.workItemId });
    const corruptLedger = '{"schemaVersion":"1.0.0","revision":99}\n';
    await writeFile(dossierPath(fixture, 'records/AUDIT_LEDGER.json'), corruptLedger, 'utf8');

    await expect(
      audit.service.getTracking({
        workItemId: fixture.workItemId,
        trackingType: 'DECISIONS',
      }),
    ).rejects.toBeInstanceOf(AuditLedgerCorruptError);

    await expect(readFile(dossierPath(fixture, 'records/AUDIT_LEDGER.json'), 'utf8')).resolves.toBe(
      corruptLedger,
    );
  });

  it('detects an altered projection and does not silently regenerate it on read', async () => {
    const fixture = await createM3Fixture();
    const audit = createAuditHarness(fixture.root);
    await audit.service.initialize({ workItemId: fixture.workItemId });
    const alteredProjection = '# Manually altered decisions\n';
    await writeFile(dossierPath(fixture, '06_DECISIONS.md'), alteredProjection, 'utf8');

    await expect(
      audit.service.getTracking({
        workItemId: fixture.workItemId,
        trackingType: 'DECISIONS',
      }),
    ).rejects.toBeInstanceOf(AuditLedgerCorruptError);

    await expect(readFile(dossierPath(fixture, '06_DECISIONS.md'), 'utf8')).resolves.toBe(
      alteredProjection,
    );
  });

  it('rejects a duplicate M4 manifest block without modifying the manifest', async () => {
    const fixture = await createM3Fixture();
    const audit = createAuditHarness(fixture.root);
    await audit.service.initialize({ workItemId: fixture.workItemId });
    const currentManifest = await readFile(dossierPath(fixture, '00_MANIFEST.md'), 'utf8');
    const duplicateManifest = `${currentManifest}\n## Milestone 4 Audit Inventory\n\ncorrupt duplicate\n`;
    await writeFile(dossierPath(fixture, '00_MANIFEST.md'), duplicateManifest, 'utf8');

    await expect(
      audit.service.getTracking({
        workItemId: fixture.workItemId,
        trackingType: 'DECISIONS',
      }),
    ).rejects.toBeInstanceOf(AuditLedgerCorruptError);

    await expect(readFile(dossierPath(fixture, '00_MANIFEST.md'), 'utf8')).resolves.toBe(
      duplicateManifest,
    );
  });

  it('preserves M3, M4, and foreign manifest sections through alternating mutations', async () => {
    const fixture = await createM3Fixture();
    const audit = createAuditHarness(fixture.root);
    const workItemBefore = await readFile(dossierPath(fixture, 'WORK_ITEM.yml'), 'utf8');
    const manifestPath = dossierPath(fixture, '00_MANIFEST.md');
    const manifestAfterM3Initialization = await readFile(manifestPath, 'utf8');
    const foreignSuffix = [
      '## External Notes',
      '',
      'This section is owned by neither the M3 nor M4 renderer.',
      '',
    ].join('\n');
    await writeFile(
      manifestPath,
      `${manifestAfterM3Initialization.trimEnd()}\n\n${foreignSuffix}`,
      'utf8',
    );

    await fixture.service.update({
      workItemId: fixture.workItemId,
      documentType: 'CURRENT_STATE',
      expectedRevision: 1,
      payload: { knownFacts: ['The first M3 mutation is confirmed.'] },
    });
    await audit.service.initialize({ workItemId: fixture.workItemId });
    await audit.service.recordDecision(decisionInput(fixture.workItemId, 'alternating-decision'));
    await fixture.service.update({
      workItemId: fixture.workItemId,
      documentType: 'CURRENT_STATE',
      expectedRevision: 2,
      payload: { knownFacts: ['The second M3 mutation is confirmed.'] },
    });
    await audit.service.recordCheckpoint({
      workItemId: fixture.workItemId,
      expectedAuditRevision: 1,
      idempotencyKey: 'alternating-checkpoint',
      kind: 'PROGRESS',
      summary: 'The alternating manifest sequence is confirmed.',
      declaredActor: 'Persistence test',
    });

    const finalManifest = await readFile(manifestPath, 'utf8');
    const lifecycle = parseLifecycleMetadata(finalManifest);
    const inventory = new M4ManifestInventoryService().parse(finalManifest);
    const manifestMetadata = lifecycle.find((entry) => entry.documentType === 'MANIFEST');
    const currentStateMetadata = lifecycle.find((entry) => entry.documentType === 'CURRENT_STATE');
    const untouchedMetadata = lifecycle.filter(
      (entry) => entry.documentType !== 'MANIFEST' && entry.documentType !== 'CURRENT_STATE',
    );

    expect(finalManifest.match(/## Milestone 4 Audit Inventory/g)).toHaveLength(1);
    expect(finalManifest.match(/## Document Lifecycle Inventory/g)).toHaveLength(1);
    expect(finalManifest.slice(finalManifest.indexOf('## External Notes'))).toBe(foreignSuffix);
    expect(manifestMetadata?.revision).toBe(6);
    expect(currentStateMetadata?.revision).toBe(3);
    expect(untouchedMetadata.every((entry) => entry.revision === 1)).toBe(true);
    expect(inventory).toMatchObject({
      auditRevision: 2,
      projectionRevision: 2,
      counters: {
        decisions: 1,
        checkpoints: 1,
        planVersions: 0,
        testCases: 0,
        testExecutions: 0,
        evidenceReferences: 0,
      },
    });
    await expect(
      audit.service.getTracking({
        workItemId: fixture.workItemId,
        trackingType: 'CHECKPOINTS',
      }),
    ).resolves.toMatchObject({ auditRevision: 2 });
    await expect(
      fixture.repository.readDocument(fixture.workItemId, 'CURRENT_STATE'),
    ).resolves.toMatchObject({
      metadata: { revision: 3 },
      content: expect.stringContaining('The second M3 mutation is confirmed.'),
    });
    expect(await readFile(dossierPath(fixture, 'WORK_ITEM.yml'), 'utf8')).toBe(workItemBefore);

    const parsedLedger: AuditLedger = audit.ledgerService.parse(
      await readFile(dossierPath(fixture, 'records/AUDIT_LEDGER.json'), 'utf8'),
    );
    expect(parsedLedger.revision).toBe(2);
  });
});
