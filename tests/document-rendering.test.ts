import { describe, expect, it } from 'vitest';

import { DocumentRenderingSnapshotInvalidError } from '../src/errors/workspace-error.js';
import {
  BaselineEnglishDocumentContentProviderV1,
  DOCUMENT_RENDERING_MARKER,
  EsEsDocumentContentProviderV1,
  GENERATED_ARTIFACT_KINDS,
  providerForDocumentLanguage,
  providerForManifest,
  providerForProfile,
} from '../src/services/document-rendering.js';

function spanishManifest(marker = DOCUMENT_RENDERING_MARKER, lineEnding = '\n'): string {
  return ['# Manifiesto del Work Item', '', marker, '', '## Documentos creados', ''].join(
    lineEnding,
  );
}

describe('document rendering profiles', () => {
  it('keeps the generated-artifact inventory exhaustive for both frozen profiles', () => {
    const spanish = new EsEsDocumentContentProviderV1();
    const baseline = new BaselineEnglishDocumentContentProviderV1();

    expect(spanish.profileId).toBe('ES_ES_V1');
    expect(baseline.profileId).toBe('EN_BASELINE_V1');
    expect(spanish.generatedArtifactKinds).toEqual(GENERATED_ARTIFACT_KINDS);
    expect(baseline.generatedArtifactKinds).toEqual(GENERATED_ARTIFACT_KINDS);
    expect(GENERATED_ARTIFACT_KINDS).toHaveLength(15);
    expect(spanish.text('technicalAnalysis')).toBe('Análisis técnico');
    expect(baseline.text('technicalAnalysis')).toBe('Technical Analysis');
    expect(providerForDocumentLanguage('es-ES').profileId).toBe(spanish.profileId);
    expect(providerForProfile('EN_BASELINE_V1').profileId).toBe(baseline.profileId);
  });

  it('resolves the exact Spanish marker with LF or CRLF and historic absence as English', () => {
    expect(providerForManifest(spanishManifest()).profileId).toBe('ES_ES_V1');
    expect(providerForManifest(spanishManifest(DOCUMENT_RENDERING_MARKER, '\r\n')).profileId).toBe(
      'ES_ES_V1',
    );
    expect(providerForManifest('# Work Item Manifest\n\n## Created documents\n').profileId).toBe(
      'EN_BASELINE_V1',
    );
  });

  it.each([
    spanishManifest(`${DOCUMENT_RENDERING_MARKER}\n${DOCUMENT_RENDERING_MARKER}`),
    ['# Manifiesto del Work Item', '', '', DOCUMENT_RENDERING_MARKER].join('\n'),
    spanishManifest(
      '<!-- WS-WORKSPACE-MCP:DOCUMENT_RENDERING_SNAPSHOT schemaVersion=2.0.0 documentLanguage=es-ES renderingProfile=ES_ES_V1 -->',
    ),
    spanishManifest(
      '<!-- WS-WORKSPACE-MCP:DOCUMENT_RENDERING_SNAPSHOT schemaVersion=1.0.0 documentLanguage=es-ES renderingProfile=EN_BASELINE_V1 -->',
    ),
    ['# Título no válido', '', DOCUMENT_RENDERING_MARKER].join('\n'),
  ])('fails closed for an invalid marker form', (manifest) => {
    expect(() => providerForManifest(manifest)).toThrow(DocumentRenderingSnapshotInvalidError);
    try {
      providerForManifest(manifest);
    } catch (error) {
      expect(error).toMatchObject({ code: 'DOCUMENT_RENDERING_SNAPSHOT_INVALID' });
    }
  });
});
