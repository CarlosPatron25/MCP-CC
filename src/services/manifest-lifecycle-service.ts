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
import {
  ManifestSectionCompositor,
  parseDocumentLifecycleInventorySection,
  renderDocumentLifecycleInventorySection,
} from './manifest-section-compositor.js';
import { parseM4ManifestInventorySection } from './m4-manifest-inventory-service.js';

/**
 * Owns the human-readable lifecycle inventory appended to the Milestone 2
 * manifest. It deliberately does not read, write, or parse filesystem paths.
 */
export class ManifestLifecycleService {
  private readonly compositor = new ManifestSectionCompositor();

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
    const existingSections = this.compositor.parse(existingManifest);
    if (existingSections.documentLifecycle !== undefined) {
      parseDocumentLifecycleInventorySection(existingSections.documentLifecycle.content);
    }
    if (existingSections.m4AuditInventory !== undefined) {
      parseM4ManifestInventorySection(existingSections.m4AuditInventory.content);
    }

    const section = renderDocumentLifecycleInventorySection(metadata);

    return this.compositor.replaceDocumentLifecycle(existingManifest, section);
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
}
