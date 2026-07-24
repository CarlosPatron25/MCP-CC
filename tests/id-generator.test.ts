import { describe, expect, it } from 'vitest';

import { SystemIdGenerator, isCanonicalUuidV4 } from '../src/services/id-generator.js';

describe('SystemIdGenerator', () => {
  it('generates unique canonical UUID v4 identities', () => {
    const generator = new SystemIdGenerator();
    const values = Array.from({ length: 100 }, () => generator.generate());

    expect(new Set(values)).toHaveLength(values.length);
    expect(values.every(isCanonicalUuidV4)).toBe(true);
  });

  it('rejects non-v4, uppercase, and prefixed identity text', () => {
    expect(isCanonicalUuidV4('00000000-0000-4000-8000-000000000001')).toBe(true);
    expect(isCanonicalUuidV4('00000000-0000-1000-8000-000000000001')).toBe(false);
    expect(isCanonicalUuidV4('00000000-0000-4000-8000-00000000000A')).toBe(false);
    expect(isCanonicalUuidV4('decision-00000000-0000-4000-8000-000000000001')).toBe(false);
  });
});
