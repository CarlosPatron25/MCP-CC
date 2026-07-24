import {
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_LIFECYCLE_STATUSES,
  MANAGED_DOCUMENT_RELATIVE_PATHS,
  MANAGED_DOCUMENT_TYPES,
  isManagedDocumentType,
  type DocumentContentType,
  type DocumentLifecycleMetadata,
  type DocumentLifecycleStatus,
} from '../domain/work-item-document.js';
import { ManifestUpdateError } from '../errors/workspace-error.js';

export const DOCUMENT_LIFECYCLE_INVENTORY_HEADING = '## Document Lifecycle Inventory';
export const M4_AUDIT_INVENTORY_HEADING = '## Milestone 4 Audit Inventory';

const DOCUMENT_LIFECYCLE_HEADER =
  '| Document type | Relative path | Status | Revision | Updated at | Updated by | Content type |';
const DOCUMENT_LIFECYCLE_SEPARATOR = '| --- | --- | --- | --- | --- | --- | --- |';

export interface ManifestSection {
  heading: string;
  content: string;
  start: number;
  end: number;
}

export interface ParsedManifestSections {
  documentLifecycle?: ManifestSection;
  m4AuditInventory?: ManifestSection;
}

function manifestError(): ManifestUpdateError {
  return new ManifestUpdateError('The manifest inventory cannot be read safely.');
}

function exactHeadingMatches(manifest: string, heading: string): number[] {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...manifest.matchAll(new RegExp(`^${escaped}\\r?$`, 'gm'))].map((match) => match.index);
}

function nextLevelTwoHeading(manifest: string, after: number): number {
  const expression = /^##(?:[ \t]+.*)?\r?$/gm;
  expression.lastIndex = after;
  const match = expression.exec(manifest);
  return match?.index ?? manifest.length;
}

function sectionAt(manifest: string, heading: string, start: number): ManifestSection {
  return {
    heading,
    content: manifest.slice(start, nextLevelTwoHeading(manifest, start + heading.length)),
    start,
    end: nextLevelTwoHeading(manifest, start + heading.length),
  };
}

export function extractDocumentLifecycleInventorySection(
  manifest: string,
): ManifestSection | undefined {
  const matches = exactHeadingMatches(manifest, DOCUMENT_LIFECYCLE_INVENTORY_HEADING);
  if (matches.length > 1) {
    throw manifestError();
  }
  const start = matches[0];
  return start === undefined
    ? undefined
    : sectionAt(manifest, DOCUMENT_LIFECYCLE_INVENTORY_HEADING, start);
}

function newlineFor(manifest: string): '\n' | '\r\n' {
  return manifest.includes('\r\n') ? '\r\n' : '\n';
}

function normalizeSection(section: string, newline: '\n' | '\r\n'): string {
  const normalized = section.replace(/\r\n/g, '\n').trimEnd();
  return normalized.replace(/\n/g, newline) + newline;
}

function sectionWithFollowingSeparator(
  section: string,
  newline: '\n' | '\r\n',
  hasFollowingContent: boolean,
): string {
  return normalizeSection(section, newline) + (hasFollowingContent ? newline : '');
}

function appendSection(manifest: string, section: string, newline: '\n' | '\r\n'): string {
  if (manifest.length === 0) {
    return normalizeSection(section, newline);
  }

  const separator = manifest.endsWith(newline + newline)
    ? ''
    : manifest.endsWith(newline)
      ? newline
      : newline + newline;
  return manifest + separator + normalizeSection(section, newline);
}

function isDocumentLifecycleStatus(value: string): value is DocumentLifecycleStatus {
  return (DOCUMENT_LIFECYCLE_STATUSES as readonly string[]).includes(value);
}

function isDocumentContentType(value: string): value is DocumentContentType {
  return (DOCUMENT_CONTENT_TYPES as readonly string[]).includes(value);
}

function orderedLifecycleMetadata(
  metadata: readonly DocumentLifecycleMetadata[],
): DocumentLifecycleMetadata[] {
  return [...metadata].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function parseDocumentLifecycleRow(line: string): DocumentLifecycleMetadata {
  if (!line.startsWith('|') || !line.endsWith('|')) {
    throw manifestError();
  }

  const cells = line
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
  const [documentType, relativePath, status, revisionText, updatedAt, updatedBy, contentType] =
    cells;
  if (
    cells.length !== 7 ||
    documentType === undefined ||
    relativePath === undefined ||
    status === undefined ||
    revisionText === undefined ||
    updatedAt === undefined ||
    updatedBy === undefined ||
    contentType === undefined ||
    !isManagedDocumentType(documentType) ||
    MANAGED_DOCUMENT_RELATIVE_PATHS[documentType] !== relativePath ||
    !isDocumentLifecycleStatus(status) ||
    !isDocumentContentType(contentType) ||
    updatedBy !== 'SYSTEM'
  ) {
    throw manifestError();
  }

  const revision = Number(revisionText);
  if (!Number.isSafeInteger(revision) || revision < 1 || !isCanonicalIsoTimestamp(updatedAt)) {
    throw manifestError();
  }

  return {
    documentType,
    relativePath,
    status,
    revision,
    updatedAt,
    updatedBy: 'SYSTEM',
    contentType,
  };
}

/**
 * Strictly parses the historical M3 inventory. Keeping this parser beside the
 * compositor gives M3 and M4 one shared definition of a valid seven-row block.
 */
export function parseDocumentLifecycleInventorySection(
  section: string,
): DocumentLifecycleMetadata[] {
  const lines = section.replace(/\r\n/g, '\n').split('\n');
  while (lines.at(-1)?.length === 0) {
    lines.pop();
  }

  const generatedAt = lines[2]?.slice('- Generated at: '.length).trim();
  if (
    lines[0] !== DOCUMENT_LIFECYCLE_INVENTORY_HEADING ||
    lines[1] !== '' ||
    !lines[2]?.startsWith('- Generated at: ') ||
    generatedAt === undefined ||
    !isCanonicalIsoTimestamp(generatedAt) ||
    lines[3] !== '' ||
    lines[4] !== DOCUMENT_LIFECYCLE_HEADER ||
    lines[5] !== DOCUMENT_LIFECYCLE_SEPARATOR
  ) {
    throw manifestError();
  }

  const rowLines = lines.slice(6);
  if (rowLines.length !== MANAGED_DOCUMENT_TYPES.length) {
    throw manifestError();
  }

  const metadata = rowLines.map(parseDocumentLifecycleRow);
  const types = metadata.map((entry) => entry.documentType);
  if (
    new Set(types).size !== MANAGED_DOCUMENT_TYPES.length ||
    MANAGED_DOCUMENT_TYPES.some((documentType) => !types.includes(documentType)) ||
    metadata.find((entry) => entry.documentType === 'MANIFEST')?.updatedAt !== generatedAt
  ) {
    throw manifestError();
  }

  return metadata;
}

function isCanonicalIsoTimestamp(value: string): boolean {
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
}

export function renderDocumentLifecycleInventorySection(
  metadata: readonly DocumentLifecycleMetadata[],
): string {
  const manifestMetadata = metadata.find((entry) => entry.documentType === 'MANIFEST');
  const section = [
    DOCUMENT_LIFECYCLE_INVENTORY_HEADING,
    '',
    `- Generated at: ${manifestMetadata?.updatedAt ?? ''}`,
    '',
    DOCUMENT_LIFECYCLE_HEADER,
    DOCUMENT_LIFECYCLE_SEPARATOR,
    ...orderedLifecycleMetadata(metadata).map(
      (entry) =>
        `| ${entry.documentType} | ${entry.relativePath} | ${entry.status} | ${entry.revision} | ${entry.updatedAt} | ${entry.updatedBy} | ${entry.contentType} |`,
    ),
  ].join('\n');
  parseDocumentLifecycleInventorySection(section);
  return section;
}

/**
 * Replaces only an owned manifest block. Every byte outside that block is
 * retained, including unknown sections managed by another milestone.
 */
export class ManifestSectionCompositor {
  public parse(manifest: string): ParsedManifestSections {
    const documentLifecycle = extractDocumentLifecycleInventorySection(manifest);
    const m4Matches = exactHeadingMatches(manifest, M4_AUDIT_INVENTORY_HEADING);
    if (m4Matches.length > 1) {
      throw manifestError();
    }

    const lifecycleStart = documentLifecycle?.start;
    const m4Start = m4Matches[0];
    if (m4Start !== undefined && lifecycleStart === undefined) {
      throw manifestError();
    }
    if (m4Start !== undefined && lifecycleStart !== undefined && m4Start > lifecycleStart) {
      throw manifestError();
    }

    return {
      ...(documentLifecycle === undefined
        ? {}
        : {
            documentLifecycle,
          }),
      ...(m4Start === undefined
        ? {}
        : {
            m4AuditInventory: sectionAt(manifest, M4_AUDIT_INVENTORY_HEADING, m4Start),
          }),
    };
  }

  public replaceDocumentLifecycle(manifest: string, section: string): string {
    const parsed = this.parse(manifest);
    const newline = newlineFor(manifest);
    if (parsed.documentLifecycle === undefined) {
      return appendSection(manifest, section, newline);
    }

    const suffix = manifest.slice(parsed.documentLifecycle.end);
    const replacement = sectionWithFollowingSeparator(section, newline, suffix.length > 0);
    return manifest.slice(0, parsed.documentLifecycle.start) + replacement + suffix;
  }

  public upsertM4AuditInventory(manifest: string, section: string): string {
    const parsed = this.parse(manifest);
    if (parsed.documentLifecycle === undefined) {
      throw manifestError();
    }

    const newline = newlineFor(manifest);
    if (parsed.m4AuditInventory !== undefined) {
      const suffix = manifest.slice(parsed.m4AuditInventory.end);
      const replacement = sectionWithFollowingSeparator(section, newline, suffix.length > 0);
      return manifest.slice(0, parsed.m4AuditInventory.start) + replacement + suffix;
    }

    const replacement = sectionWithFollowingSeparator(section, newline, true);
    return (
      manifest.slice(0, parsed.documentLifecycle.start) +
      replacement +
      manifest.slice(parsed.documentLifecycle.start)
    );
  }
}
