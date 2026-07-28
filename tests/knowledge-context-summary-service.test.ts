import { describe, expect, it } from 'vitest';

import {
  COMBINED_CONTEXT_MAX_BYTES,
  CombinedContextSummaryProvider,
  KNOWLEDGE_CONTEXT_MAX_BYTES,
  boundContextContent,
} from '../src/services/knowledge-context-summary-service.js';

describe('bounded Milestone 5 AI context', () => {
  it('truncates only at complete line boundaries within the byte budget', () => {
    const content = Array.from({ length: 2_000 }, (_, index) => `- Componente ${index} ñ`)
      .join('\n')
      .concat('\n');
    const result = boundContextContent(
      content,
      KNOWLEDGE_CONTEXT_MAX_BYTES,
      '- _Contenido adicional omitido._',
    );

    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(KNOWLEDGE_CONTEXT_MAX_BYTES);
    expect(result).toContain('Contenido adicional omitido');
    expect(result).not.toContain('\uFFFD');
  });

  it('bounds the combined M4 and M5 provider output', async () => {
    const provider = new CombinedContextSummaryProvider([
      { getContextSummary: async () => `## M4\n${'M4 entry\n'.repeat(4_000)}` },
      { getContextSummary: async () => `## M5\n${'M5 entry\n'.repeat(4_000)}` },
    ]);

    const result = await provider.getContextSummary('WI-1');

    expect(result).toBeDefined();
    expect(Buffer.byteLength(result ?? '', 'utf8')).toBeLessThanOrEqual(COMBINED_CONTEXT_MAX_BYTES);
    expect(result).toContain('Additional derived context omitted');
  });

  it('reads providers sequentially so shared repository gates do not self-conflict', async () => {
    let activeProviders = 0;
    let maximumActiveProviders = 0;
    const provider = () => ({
      getContextSummary: async () => {
        activeProviders += 1;
        maximumActiveProviders = Math.max(maximumActiveProviders, activeProviders);
        await Promise.resolve();
        activeProviders -= 1;
        return 'summary';
      },
    });

    const combined = new CombinedContextSummaryProvider([provider(), provider()]);

    await expect(combined.getContextSummary('WI-1')).resolves.toContain('summary');
    expect(maximumActiveProviders).toBe(1);
  });
});
