import { describe, expect, it } from 'vitest';

import {
  AUDIT_LEDGER_RELATIVE_PATH,
  AUDIT_LEDGER_SCHEMA_VERSION,
  AUDIT_PROJECTION_RELATIVE_PATHS,
  type AuditLedger,
} from '../src/domain/work-item-audit.js';
import { AuditLedgerCorruptError } from '../src/errors/workspace-error.js';
import type { Clock } from '../src/services/clock.js';
import { ManifestLifecycleService } from '../src/services/manifest-lifecycle-service.js';
import {
  M4_AUDIT_INVENTORY_HEADING,
  ManifestSectionCompositor,
  parseDocumentLifecycleInventorySection,
} from '../src/services/manifest-section-compositor.js';
import { M4ManifestInventoryService } from '../src/services/m4-manifest-inventory-service.js';

const timestamp = '2026-07-22T12:00:00.000Z';
const fixedClock: Clock = { now: () => timestamp };
const baseManifest = [
  '# Work Item Manifest',
  '',
  '## Created documents',
  '',
  '| Path | Initial status |',
  '| --- | --- |',
  '| WORK_ITEM.yml | CREATED |',
  '',
  '## Unmanaged notes',
  '',
  'This exact section belongs to neither M3 nor M4.',
  '',
].join('\n');

function initializedM3Manifest(): string {
  const lifecycle = new ManifestLifecycleService(fixedClock);
  return lifecycle.render(baseManifest, lifecycle.createInitialMetadata());
}

describe('M4ManifestInventoryService', () => {
  it('inserts and parses the complete empty M4 inventory immediately before M3', () => {
    const service = new M4ManifestInventoryService();
    const initial = service.createInitialInventory(timestamp);
    const manifest = service.render(initializedM3Manifest(), initial);
    const parsed = service.parse(manifest);

    expect(parsed).toEqual(initial);
    expect(parsed).toMatchObject({
      ledgerSchemaVersion: AUDIT_LEDGER_SCHEMA_VERSION,
      auditRevision: 0,
      ledgerRelativePath: AUDIT_LEDGER_RELATIVE_PATH,
      projectionRelativePaths: AUDIT_PROJECTION_RELATIVE_PATHS,
      projectionRevision: 0,
      counters: {
        decisions: 0,
        checkpoints: 0,
        planVersions: 0,
        testCases: 0,
        testExecutions: 0,
        evidenceReferences: 0,
      },
    });
    expect(manifest.indexOf(M4_AUDIT_INVENTORY_HEADING)).toBeLessThan(
      manifest.indexOf('## Document Lifecycle Inventory'),
    );
    expect(manifest.match(/## Milestone 4 Audit Inventory/g)).toHaveLength(1);
    expect(manifest).toContain('| MANIFEST | 00_MANIFEST.md | UPDATED | 2 |');
  });

  it('derives revisions and counters from one ledger snapshot', () => {
    const service = new M4ManifestInventoryService();
    const ledger: AuditLedger = {
      schemaVersion: AUDIT_LEDGER_SCHEMA_VERSION,
      revision: 7,
      updatedAt: timestamp,
      decisions: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          idempotencyKey: 'decision-1',
          kind: 'DECISION',
          title: 'Use an append-only ledger',
          decision: 'Keep audit records immutable.',
          rationale: 'Preserve history.',
          declaredActor: 'developer',
          recordedAt: timestamp,
        },
      ],
      checkpoints: [],
      testPlans: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          planId: '33333333-3333-4333-8333-333333333333',
          planRevision: 1,
          idempotencyKey: 'plan-1',
          purpose: 'Verify M4.',
          declaredActor: 'developer',
          recordedAt: timestamp,
          testCases: [
            {
              testCaseId: '44444444-4444-4444-8444-444444444444',
              title: 'Manifest coexistence',
              objective: 'Preserve both inventories.',
              verificationMethod: 'AUTOMATED',
              expectedOutcome: 'Both inventories remain valid.',
            },
          ],
        },
      ],
      testExecutions: [],
      evidenceReferences: [],
      idempotencyIndex: [],
    };

    expect(service.fromLedger(ledger)).toMatchObject({
      auditRevision: 7,
      projectionRevision: 7,
      lastActivityAt: timestamp,
      counters: {
        decisions: 1,
        checkpoints: 0,
        planVersions: 1,
        testCases: 1,
        testExecutions: 0,
        evidenceReferences: 0,
      },
    });
  });

  it('updates M4 and only the M3 MANIFEST row while preserving unmanaged content', () => {
    const service = new M4ManifestInventoryService();
    const compositor = new ManifestSectionCompositor();
    const m3Manifest = initializedM3Manifest();
    const initial = service.createInitialInventory(timestamp);
    const withM4 = service.render(m3Manifest, initial);
    const beforeSections = compositor.parse(withM4);
    const next = {
      ...initial,
      auditRevision: 1,
      generatedAt: '2026-07-22T13:00:00.000Z',
      lastActivityAt: '2026-07-22T13:00:00.000Z',
      projectionRevision: 1,
      counters: { ...initial.counters, decisions: 1 },
    };

    const updated = service.render(withM4, next);
    const updatedAgain = service.render(updated, next);
    const afterSections = compositor.parse(updated);
    const beforeLifecycle = parseDocumentLifecycleInventorySection(
      beforeSections.documentLifecycle!.content,
    );
    const afterLifecycle = parseDocumentLifecycleInventorySection(
      afterSections.documentLifecycle!.content,
    );
    const beforeManifest = beforeLifecycle.find((entry) => entry.documentType === 'MANIFEST');
    const afterManifest = afterLifecycle.find((entry) => entry.documentType === 'MANIFEST');

    expect(updatedAgain).toBe(updated);
    expect(afterManifest?.revision).toBe((beforeManifest?.revision ?? 0) + 1);
    expect(afterManifest?.updatedAt).toBe(next.generatedAt);
    expect(afterLifecycle.filter((entry) => entry.documentType !== 'MANIFEST')).toEqual(
      beforeLifecycle.filter((entry) => entry.documentType !== 'MANIFEST'),
    );
    expect(updated).toContain('This exact section belongs to neither M3 nor M4.');
    expect(service.parse(updated)).toMatchObject({
      auditRevision: 1,
      projectionRevision: 1,
      counters: { decisions: 1 },
    });
  });

  it('rejects duplicate, malformed, or M3-corrupt inventory state', () => {
    const service = new M4ManifestInventoryService();
    const withM4 = service.render(
      initializedM3Manifest(),
      service.createInitialInventory(timestamp),
    );

    expect(() => service.parse(withM4 + `${M4_AUDIT_INVENTORY_HEADING}\n`)).toThrow(
      AuditLedgerCorruptError,
    );
    expect(() =>
      service.parse(withM4.replace('- Audit revision: 0', '- Audit revision: -1')),
    ).toThrow(AuditLedgerCorruptError);
    expect(() =>
      service.parse(
        withM4.replace(
          '| AI_CONTEXT | context/AI_CONTEXT.md | CREATED | 1 | 2026-07-22T12:00:00.000Z | SYSTEM | DERIVED |',
          '',
        ),
      ),
    ).toThrow(AuditLedgerCorruptError);
  });

  it('preserves both inventories through the mandatory alternating M3/M4 sequence', () => {
    const lifecycle = new ManifestLifecycleService(fixedClock);
    const m4Service = new M4ManifestInventoryService();
    const compositor = new ManifestSectionCompositor();
    let manifest = lifecycle.render(baseManifest, lifecycle.createInitialMetadata());

    const mutateM3 = (): void => {
      const sections = compositor.parse(manifest);
      const metadata = parseDocumentLifecycleInventorySection(sections.documentLifecycle!.content);
      const next = metadata.map((entry) =>
        entry.documentType === 'MANIFEST' ? lifecycle.nextManifestMetadata(entry) : entry,
      );
      manifest = lifecycle.render(manifest, next);
    };

    mutateM3();
    const initialM4 = m4Service.createInitialInventory(timestamp);
    manifest = m4Service.render(manifest, initialM4);
    const firstM4Mutation = {
      ...initialM4,
      auditRevision: 1,
      generatedAt: '2026-07-22T13:00:00.000Z',
      lastActivityAt: '2026-07-22T13:00:00.000Z',
      projectionRevision: 1,
      counters: { ...initialM4.counters, decisions: 1 },
    };
    manifest = m4Service.render(manifest, firstM4Mutation);
    mutateM3();
    manifest = m4Service.render(manifest, {
      ...firstM4Mutation,
      auditRevision: 2,
      generatedAt: '2026-07-22T14:00:00.000Z',
      lastActivityAt: '2026-07-22T14:00:00.000Z',
      projectionRevision: 2,
      counters: { ...firstM4Mutation.counters, checkpoints: 1 },
    });

    const sections = compositor.parse(manifest);
    const lifecycleMetadata = parseDocumentLifecycleInventorySection(
      sections.documentLifecycle!.content,
    );

    expect(lifecycleMetadata).toHaveLength(7);
    expect(lifecycleMetadata.find((entry) => entry.documentType === 'MANIFEST')?.revision).toBe(6);
    expect(m4Service.parse(manifest)).toMatchObject({
      auditRevision: 2,
      projectionRevision: 2,
      counters: { decisions: 1, checkpoints: 1 },
    });
    expect(manifest.match(/## Document Lifecycle Inventory/g)).toHaveLength(1);
    expect(manifest.match(/## Milestone 4 Audit Inventory/g)).toHaveLength(1);
    expect(manifest).toContain('This exact section belongs to neither M3 nor M4.');
  });
});
