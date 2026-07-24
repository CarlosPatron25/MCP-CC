import { describe, expect, it } from 'vitest';

import { ManifestUpdateError } from '../src/errors/workspace-error.js';
import type { Clock } from '../src/services/clock.js';
import { ManifestLifecycleService } from '../src/services/manifest-lifecycle-service.js';
import {
  DOCUMENT_LIFECYCLE_INVENTORY_HEADING,
  M4_AUDIT_INVENTORY_HEADING,
  ManifestSectionCompositor,
  parseDocumentLifecycleInventorySection,
} from '../src/services/manifest-section-compositor.js';

const fixedClock: Clock = {
  now: () => '2026-07-22T12:00:00.000Z',
};

const baseManifest = [
  '# Work Item Manifest',
  '',
  '## Created documents',
  '',
  '| Path | Initial status |',
  '| --- | --- |',
  '| WORK_ITEM.yml | CREATED |',
  '',
  '## Custom unmanaged section',
  '',
  'Preserve this text byte-for-byte.',
  '',
].join('\n');

function initializedManifest(): string {
  const lifecycle = new ManifestLifecycleService(fixedClock);
  return lifecycle.render(baseManifest, lifecycle.createInitialMetadata());
}

describe('ManifestSectionCompositor', () => {
  it('inserts M4 immediately before M3 without changing either unmanaged or M3 bytes', () => {
    const compositor = new ManifestSectionCompositor();
    const before = initializedManifest();
    const beforeSections = compositor.parse(before);
    const m3Before = beforeSections.documentLifecycle?.content;
    const m4Section = [M4_AUDIT_INVENTORY_HEADING, '', 'A syntactically opaque owned block.'].join(
      '\n',
    );

    const after = compositor.upsertM4AuditInventory(before, m4Section);
    const afterSections = compositor.parse(after);

    expect(after.slice(0, afterSections.m4AuditInventory?.start)).toBe(
      before.slice(0, beforeSections.documentLifecycle?.start),
    );
    expect(afterSections.documentLifecycle?.content).toBe(m3Before);
    expect(after.indexOf(M4_AUDIT_INVENTORY_HEADING)).toBeLessThan(
      after.indexOf(DOCUMENT_LIFECYCLE_INVENTORY_HEADING),
    );
    expect(after).toContain('Preserve this text byte-for-byte.');
  });

  it('replaces only the selected block and preserves later unmanaged sections', () => {
    const compositor = new ManifestSectionCompositor();
    const originalM3 = [
      DOCUMENT_LIFECYCLE_INVENTORY_HEADING,
      '',
      'original owned content',
      '',
    ].join('\n');
    const manifest =
      baseManifest + originalM3 + '## Later unmanaged section\n\n' + 'Keep this exact suffix.\n';
    const suffix = '## Later unmanaged section\n\nKeep this exact suffix.\n';

    const result = compositor.replaceDocumentLifecycle(
      manifest,
      [DOCUMENT_LIFECYCLE_INVENTORY_HEADING, '', 'replacement owned content'].join('\n'),
    );

    expect(result.endsWith(suffix)).toBe(true);
    expect(result).toContain('replacement owned content');
    expect(result).not.toContain('original owned content');
  });

  it('preserves CRLF bytes outside a replaced managed section', () => {
    const compositor = new ManifestSectionCompositor();
    const crlfBase = baseManifest.replace(/\n/g, '\r\n');
    const lifecycle = new ManifestLifecycleService(fixedClock);
    const initialized = lifecycle.render(crlfBase, lifecycle.createInitialMetadata());
    const prefixBefore = initialized.slice(
      0,
      compositor.parse(initialized).documentLifecycle?.start,
    );

    const result = compositor.replaceDocumentLifecycle(
      initialized,
      [
        DOCUMENT_LIFECYCLE_INVENTORY_HEADING,
        '',
        '- Generated at: 2026-07-22T12:00:00.000Z',
        '',
        '| Document type | Relative path | Status | Revision | Updated at | Updated by | Content type |',
        '| --- | --- | --- | --- | --- | --- | --- |',
      ].join('\n'),
    );

    expect(result.slice(0, compositor.parse(result).documentLifecycle?.start)).toBe(prefixBefore);
    expect(result).toContain('\r\n## Document Lifecycle Inventory\r\n');
  });

  it('rejects duplicate blocks, reversed ordering, and M4 without M3', () => {
    const compositor = new ManifestSectionCompositor();
    const valid = initializedManifest();
    const m4 = `${M4_AUDIT_INVENTORY_HEADING}\n\ncontent\n\n`;

    expect(() => compositor.parse(valid + `${DOCUMENT_LIFECYCLE_INVENTORY_HEADING}\n`)).toThrow(
      ManifestUpdateError,
    );
    expect(() => compositor.parse(valid + m4)).toThrow(ManifestUpdateError);
    expect(() => compositor.parse(baseManifest + m4)).toThrow(ManifestUpdateError);
  });

  it('parses exactly the seven historical M3 rows and rejects corrupt cardinality', () => {
    const compositor = new ManifestSectionCompositor();
    const manifest = initializedManifest();
    const section = compositor.parse(manifest).documentLifecycle;

    expect(section).toBeDefined();
    expect(parseDocumentLifecycleInventorySection(section!.content)).toHaveLength(7);
    expect(() =>
      parseDocumentLifecycleInventorySection(
        section!.content.replace(
          '| AI_CONTEXT | context/AI_CONTEXT.md | CREATED | 1 | 2026-07-22T12:00:00.000Z | SYSTEM | DERIVED |',
          '',
        ),
      ),
    ).toThrow(ManifestUpdateError);
  });
});
