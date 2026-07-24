import { describe, expect, it } from 'vitest';

import { ManifestUpdateError } from '../src/errors/workspace-error.js';
import type { Clock } from '../src/services/clock.js';
import { ManifestLifecycleService } from '../src/services/manifest-lifecycle-service.js';
import {
  ManifestSectionCompositor,
  parseDocumentLifecycleInventorySection,
} from '../src/services/manifest-section-compositor.js';
import { M4ManifestInventoryService } from '../src/services/m4-manifest-inventory-service.js';

const fixedClock: Clock = {
  now: () => '2026-07-22T12:00:00.000Z',
};

const initialManifest = [
  '# Work Item Manifest',
  '',
  '- Work Item ID: US-123',
  '',
  '## Created documents',
  '',
  '| Path | Initial status |',
  '| --- | --- |',
  '| WORK_ITEM.yml | CREATED |',
  '',
].join('\n');

describe('ManifestLifecycleService', () => {
  it('creates complete positive-revision metadata with the fixed clock', () => {
    const service = new ManifestLifecycleService(fixedClock);
    const metadata = service.createInitialMetadata();

    expect(metadata).toHaveLength(7);
    expect(metadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentType: 'MANIFEST',
          relativePath: '00_MANIFEST.md',
          status: 'UPDATED',
          contentType: 'DERIVED',
        }),
        expect.objectContaining({
          documentType: 'CURRENT_STATE',
          relativePath: '02_CURRENT_STATE.md',
          status: 'INITIALIZED',
          revision: 1,
          updatedAt: '2026-07-22T12:00:00.000Z',
          updatedBy: 'SYSTEM',
          contentType: 'TEMPLATE',
        }),
        expect.objectContaining({
          documentType: 'AI_CONTEXT',
          contentType: 'DERIVED',
        }),
      ]),
    );
  });

  it('renders one stable inventory while preserving the initial Milestone 2 content', () => {
    const service = new ManifestLifecycleService(fixedClock);
    const metadata = service.createInitialMetadata();
    const first = service.render(initialManifest, metadata);
    const second = service.render(first, metadata);

    expect(first).toBe(second);
    expect(first).toContain('| WORK_ITEM.yml | CREATED |');
    expect(first).toContain('## Document Lifecycle Inventory');
    expect(first).toContain('| CURRENT_STATE | 02_CURRENT_STATE.md | INITIALIZED | 1 |');
    expect(first.match(/## Document Lifecycle Inventory/g)).toHaveLength(1);
    expect(first).toContain('| FUNCTIONAL_ANALYSIS | 01_FUNCTIONAL_ANALYSIS.md | CREATED | 1 |');
    expect(first.endsWith('|\n')).toBe(true);
  });

  it('increments revisions and marks changed documents as updated', () => {
    const service = new ManifestLifecycleService(fixedClock);
    const [functional] = service
      .createInitialMetadata()
      .filter((entry) => entry.documentType === 'FUNCTIONAL_ANALYSIS');

    expect(functional).toBeDefined();
    expect(service.nextDocumentMetadata(functional!, 'SUPPLIED')).toMatchObject({
      status: 'UPDATED',
      revision: 2,
      contentType: 'SUPPLIED',
      updatedBy: 'SYSTEM',
    });
  });

  it('preserves a valid M4 block while replacing M3 with exactly seven rows', () => {
    const service = new ManifestLifecycleService(fixedClock);
    const m4Service = new M4ManifestInventoryService();
    const compositor = new ManifestSectionCompositor();
    const initialMetadata = service.createInitialMetadata();
    const initializedM3 = service.render(initialManifest, initialMetadata);
    const withM4 = m4Service.render(
      initializedM3,
      m4Service.createInitialInventory('2026-07-22T12:00:00.000Z'),
    );
    const withM4Sections = compositor.parse(withM4);
    const m4Before = withM4Sections.m4AuditInventory?.content;
    const currentMetadata = parseDocumentLifecycleInventorySection(
      withM4Sections.documentLifecycle!.content,
    );
    const manifestMetadata = currentMetadata.find((entry) => entry.documentType === 'MANIFEST');
    expect(manifestMetadata).toBeDefined();
    const nextManifestMetadata = service.nextManifestMetadata(manifestMetadata!);
    const nextMetadata = currentMetadata.map((entry) =>
      entry.documentType === 'MANIFEST' ? nextManifestMetadata : entry,
    );

    const updated = service.render(withM4, nextMetadata);
    const sections = compositor.parse(updated);
    const lifecycleRows = sections.documentLifecycle?.content
      .split('\n')
      .filter((line) =>
        /^\| (?:MANIFEST|FUNCTIONAL_ANALYSIS|CURRENT_STATE|TECHNICAL_ANALYSIS|IMPACT_ANALYSIS|IMPLEMENTATION_PLAN|AI_CONTEXT) \|/.test(
          line,
        ),
      );

    expect(sections.m4AuditInventory?.content).toBe(m4Before);
    expect(lifecycleRows).toHaveLength(7);
    expect(updated).toContain('| MANIFEST | 00_MANIFEST.md | UPDATED | 3 |');
  });

  it('fails safely instead of preserving duplicate or malformed managed blocks', () => {
    const service = new ManifestLifecycleService(fixedClock);
    const m4Service = new M4ManifestInventoryService();
    const metadata = service.createInitialMetadata();
    const initializedM3 = service.render(initialManifest, metadata);
    const withM4 = m4Service.render(
      initializedM3,
      m4Service.createInitialInventory('2026-07-22T12:00:00.000Z'),
    );

    expect(() => service.render(withM4 + '## Document Lifecycle Inventory\n', metadata)).toThrow(
      ManifestUpdateError,
    );
    expect(() =>
      service.render(withM4.replace('| Decisions | 0 |', '| Decisions | not-a-number |'), metadata),
    ).toThrow(ManifestUpdateError);
  });
});
