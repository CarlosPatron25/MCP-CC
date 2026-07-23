import type {
  DocumentContentType,
  DocumentLifecycleMetadata,
  DocumentLifecycleStatus,
  ManagedDocumentType,
} from '../domain/work-item-document.js';
import {
  MANAGED_DOCUMENT_RELATIVE_PATHS,
  MANAGED_DOCUMENT_TYPES,
} from '../domain/work-item-document.js';
import type { Clock } from './clock.js';

const LIFECYCLE_HEADING = '## Document Lifecycle Inventory';

function orderedMetadata(
  metadata: readonly DocumentLifecycleMetadata[],
): DocumentLifecycleMetadata[] {
  return [...metadata].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

/**
 * Owns the human-readable lifecycle inventory appended to the Milestone 2
 * manifest. It deliberately does not read, write, or parse filesystem paths.
 */
export class ManifestLifecycleService {
  public constructor(private readonly clock: Clock) {}

  public createInitialMetadata(): DocumentLifecycleMetadata[] {
    const timestamp = this.clock.now();
    return MANAGED_DOCUMENT_TYPES.map((documentType) => {
      const initial = this.initialLifecycle(documentType);
      return {
        documentType,
        relativePath: MANAGED_DOCUMENT_RELATIVE_PATHS[documentType],
        status: initial.status,
        revision: 1,
        updatedAt: timestamp,
        updatedBy: 'SYSTEM',
        contentType: initial.contentType,
      };
    });
  }

  public nextDocumentMetadata(
    current: DocumentLifecycleMetadata,
    contentType: DocumentContentType,
  ): DocumentLifecycleMetadata {
    return {
      ...current,
      status: 'UPDATED',
      revision: current.revision + 1,
      updatedAt: this.clock.now(),
      updatedBy: 'SYSTEM',
      contentType,
    };
  }

  public nextManifestMetadata(current: DocumentLifecycleMetadata): DocumentLifecycleMetadata {
    return this.nextDocumentMetadata(current, 'DERIVED');
  }

  public render(existingManifest: string, metadata: readonly DocumentLifecycleMetadata[]): string {
    const baseManifest = this.withoutLifecycleInventory(existingManifest);
    const manifestMetadata = metadata.find((entry) => entry.documentType === 'MANIFEST');
    const timestamp = manifestMetadata?.updatedAt ?? this.clock.now();

    return [
      baseManifest,
      '',
      LIFECYCLE_HEADING,
      '',
      `- Generated at: ${timestamp}`,
      '',
      '| Document type | Relative path | Status | Revision | Updated at | Updated by | Content type |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...orderedMetadata(metadata).map(
        (entry) =>
          `| ${entry.documentType} | ${entry.relativePath} | ${entry.status} | ${entry.revision} | ${entry.updatedAt} | ${entry.updatedBy} | ${entry.contentType} |`,
      ),
      '',
    ].join('\n');
  }

  private initialLifecycle(documentType: ManagedDocumentType): {
    status: DocumentLifecycleStatus;
    contentType: DocumentContentType;
  } {
    switch (documentType) {
      case 'MANIFEST':
        return { status: 'UPDATED', contentType: 'DERIVED' };
      case 'FUNCTIONAL_ANALYSIS':
        return { status: 'CREATED', contentType: 'SUPPLIED' };
      case 'AI_CONTEXT':
        return { status: 'CREATED', contentType: 'DERIVED' };
      case 'CURRENT_STATE':
      case 'TECHNICAL_ANALYSIS':
      case 'IMPACT_ANALYSIS':
      case 'IMPLEMENTATION_PLAN':
        return { status: 'INITIALIZED', contentType: 'TEMPLATE' };
    }
  }

  private withoutLifecycleInventory(manifest: string): string {
    const headingIndex = manifest.indexOf(LIFECYCLE_HEADING);
    const base = headingIndex === -1 ? manifest : manifest.slice(0, headingIndex);
    return base.trimEnd();
  }
}
