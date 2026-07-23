import { describe, expect, it } from 'vitest';

import type { Clock } from '../src/services/clock.js';
import { ManifestLifecycleService } from '../src/services/manifest-lifecycle-service.js';

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
});
