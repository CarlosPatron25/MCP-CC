import {
  AUDIT_LEDGER_RELATIVE_PATH,
  AUDIT_LEDGER_SCHEMA_VERSION,
  AUDIT_PROJECTION_RELATIVE_PATHS,
  type AuditLedger,
} from '../domain/work-item-audit.js';
import { AuditLedgerCorruptError, ManifestUpdateError } from '../errors/workspace-error.js';
import {
  M4_AUDIT_INVENTORY_HEADING,
  ManifestSectionCompositor,
  parseDocumentLifecycleInventorySection,
  renderDocumentLifecycleInventorySection,
} from './manifest-section-compositor.js';

export interface M4ManifestInventoryCounters {
  decisions: number;
  checkpoints: number;
  planVersions: number;
  testCases: number;
  testExecutions: number;
  evidenceReferences: number;
}

export interface M4ManifestInventory {
  ledgerSchemaVersion: string;
  auditRevision: number;
  generatedAt: string;
  lastActivityAt: string;
  ledgerRelativePath: string;
  projectionRelativePaths: typeof AUDIT_PROJECTION_RELATIVE_PATHS;
  projectionRevision: number;
  counters: M4ManifestInventoryCounters;
}

const PROJECTION_ROWS = [
  ['DECISIONS', AUDIT_PROJECTION_RELATIVE_PATHS.DECISIONS],
  ['CHECKPOINTS', AUDIT_PROJECTION_RELATIVE_PATHS.CHECKPOINTS],
  ['TESTING', AUDIT_PROJECTION_RELATIVE_PATHS.TESTING],
  ['EVIDENCE_REFERENCES', AUDIT_PROJECTION_RELATIVE_PATHS.EVIDENCE_REFERENCES],
] as const;

const COUNTER_ROWS: ReadonlyArray<
  readonly [label: string, field: keyof M4ManifestInventoryCounters]
> = [
  ['Decisions', 'decisions'],
  ['Checkpoints', 'checkpoints'],
  ['Plan versions', 'planVersions'],
  ['Test cases', 'testCases'],
  ['Test executions', 'testExecutions'],
  ['Evidence references', 'evidenceReferences'],
];

const PROJECTION_HEADER = '| Projection | Relative path |';
const PROJECTION_SEPARATOR = '| --- | --- |';
const COUNTER_HEADER = '| Counter | Value |';
const COUNTER_SEPARATOR = '| --- | --- |';

function corruptManifestError(): ManifestUpdateError {
  return new ManifestUpdateError('The Milestone 4 audit inventory cannot be read safely.');
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isIsoTimestamp(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function parseBullet(lines: readonly string[], index: number, label: string): string {
  const prefix = `- ${label}: `;
  const line = lines[index];
  if (line === undefined || !line.startsWith(prefix)) {
    throw corruptManifestError();
  }
  const value = line.slice(prefix.length);
  if (value.length === 0) {
    throw corruptManifestError();
  }
  return value;
}

function parseNonNegativeInteger(value: string): number {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw corruptManifestError();
  }
  const parsed = Number(value);
  if (!isNonNegativeSafeInteger(parsed)) {
    throw corruptManifestError();
  }
  return parsed;
}

function parseTableRow(line: string): [string, string] {
  if (!line.startsWith('|') || !line.endsWith('|')) {
    throw corruptManifestError();
  }
  const cells = line
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
  if (cells.length !== 2 || cells[0] === undefined || cells[1] === undefined) {
    throw corruptManifestError();
  }
  return [cells[0], cells[1]];
}

function validateInventory(inventory: M4ManifestInventory): void {
  if (
    inventory.ledgerSchemaVersion !== AUDIT_LEDGER_SCHEMA_VERSION ||
    !isNonNegativeSafeInteger(inventory.auditRevision) ||
    !isNonNegativeSafeInteger(inventory.projectionRevision) ||
    !isIsoTimestamp(inventory.generatedAt) ||
    !isIsoTimestamp(inventory.lastActivityAt) ||
    inventory.ledgerRelativePath !== AUDIT_LEDGER_RELATIVE_PATH ||
    inventory.projectionRelativePaths.DECISIONS !== AUDIT_PROJECTION_RELATIVE_PATHS.DECISIONS ||
    inventory.projectionRelativePaths.CHECKPOINTS !== AUDIT_PROJECTION_RELATIVE_PATHS.CHECKPOINTS ||
    inventory.projectionRelativePaths.TESTING !== AUDIT_PROJECTION_RELATIVE_PATHS.TESTING ||
    inventory.projectionRelativePaths.EVIDENCE_REFERENCES !==
      AUDIT_PROJECTION_RELATIVE_PATHS.EVIDENCE_REFERENCES ||
    COUNTER_ROWS.some(([, field]) => !isNonNegativeSafeInteger(inventory.counters[field]))
  ) {
    throw corruptManifestError();
  }
}

function renderM4ManifestInventorySection(inventory: M4ManifestInventory): string {
  validateInventory(inventory);
  return [
    M4_AUDIT_INVENTORY_HEADING,
    '',
    `- Ledger schema version: ${inventory.ledgerSchemaVersion}`,
    `- Audit revision: ${inventory.auditRevision}`,
    `- Generated at: ${inventory.generatedAt}`,
    `- Last activity at: ${inventory.lastActivityAt}`,
    `- Ledger relative path: ${inventory.ledgerRelativePath}`,
    `- Projection revision: ${inventory.projectionRevision}`,
    '',
    PROJECTION_HEADER,
    PROJECTION_SEPARATOR,
    ...PROJECTION_ROWS.map(([label, path]) => `| ${label} | ${path} |`),
    '',
    COUNTER_HEADER,
    COUNTER_SEPARATOR,
    ...COUNTER_ROWS.map(([label, field]) => `| ${label} | ${inventory.counters[field]} |`),
  ].join('\n');
}

function equivalentSection(left: string, right: string): boolean {
  return left.replace(/\r\n/g, '\n').trimEnd() === right.replace(/\r\n/g, '\n').trimEnd();
}

/**
 * Parses the M4-owned block without touching any other manifest section.
 * Structural errors use the historical manifest error internally; the public
 * M4 service maps them to AUDIT_LEDGER_CORRUPT.
 */
export function parseM4ManifestInventorySection(section: string): M4ManifestInventory {
  const lines = section.replace(/\r\n/g, '\n').split('\n');
  while (lines.at(-1)?.length === 0) {
    lines.pop();
  }

  if (
    lines.length !== 24 ||
    lines[0] !== M4_AUDIT_INVENTORY_HEADING ||
    lines[1] !== '' ||
    lines[8] !== '' ||
    lines[9] !== PROJECTION_HEADER ||
    lines[10] !== PROJECTION_SEPARATOR ||
    lines[15] !== '' ||
    lines[16] !== COUNTER_HEADER ||
    lines[17] !== COUNTER_SEPARATOR
  ) {
    throw corruptManifestError();
  }

  const ledgerSchemaVersion = parseBullet(lines, 2, 'Ledger schema version');
  const auditRevision = parseNonNegativeInteger(parseBullet(lines, 3, 'Audit revision'));
  const generatedAt = parseBullet(lines, 4, 'Generated at');
  const lastActivityAt = parseBullet(lines, 5, 'Last activity at');
  const ledgerRelativePath = parseBullet(lines, 6, 'Ledger relative path');
  const projectionRevision = parseNonNegativeInteger(parseBullet(lines, 7, 'Projection revision'));

  for (const [offset, expected] of PROJECTION_ROWS.entries()) {
    const actual = parseTableRow(lines[11 + offset] ?? '');
    if (actual[0] !== expected[0] || actual[1] !== expected[1]) {
      throw corruptManifestError();
    }
  }

  const counters = {} as M4ManifestInventoryCounters;
  for (const [offset, [expectedLabel, field]] of COUNTER_ROWS.entries()) {
    const actual = parseTableRow(lines[18 + offset] ?? '');
    if (actual[0] !== expectedLabel) {
      throw corruptManifestError();
    }
    counters[field] = parseNonNegativeInteger(actual[1]);
  }

  const inventory: M4ManifestInventory = {
    ledgerSchemaVersion,
    auditRevision,
    generatedAt,
    lastActivityAt,
    ledgerRelativePath,
    projectionRelativePaths: { ...AUDIT_PROJECTION_RELATIVE_PATHS },
    projectionRevision,
    counters,
  };
  validateInventory(inventory);
  return inventory;
}

export class M4ManifestInventoryService {
  private readonly compositor = new ManifestSectionCompositor();

  public createInitialInventory(timestamp: string): M4ManifestInventory {
    const inventory: M4ManifestInventory = {
      ledgerSchemaVersion: AUDIT_LEDGER_SCHEMA_VERSION,
      auditRevision: 0,
      generatedAt: timestamp,
      lastActivityAt: timestamp,
      ledgerRelativePath: AUDIT_LEDGER_RELATIVE_PATH,
      projectionRelativePaths: { ...AUDIT_PROJECTION_RELATIVE_PATHS },
      projectionRevision: 0,
      counters: {
        decisions: 0,
        checkpoints: 0,
        planVersions: 0,
        testCases: 0,
        testExecutions: 0,
        evidenceReferences: 0,
      },
    };
    this.assertValidInventory(inventory);
    return inventory;
  }

  public fromLedger(ledger: AuditLedger, generatedAt = ledger.updatedAt): M4ManifestInventory {
    const inventory: M4ManifestInventory = {
      ledgerSchemaVersion: ledger.schemaVersion,
      auditRevision: ledger.revision,
      generatedAt,
      lastActivityAt: ledger.updatedAt,
      ledgerRelativePath: AUDIT_LEDGER_RELATIVE_PATH,
      projectionRelativePaths: { ...AUDIT_PROJECTION_RELATIVE_PATHS },
      projectionRevision: ledger.revision,
      counters: {
        decisions: ledger.decisions.length,
        checkpoints: ledger.checkpoints.length,
        planVersions: ledger.testPlans.length,
        testCases: ledger.testPlans.reduce(
          (total, planVersion) => total + planVersion.testCases.length,
          0,
        ),
        testExecutions: ledger.testExecutions.length,
        evidenceReferences: ledger.evidenceReferences.length,
      },
    };
    this.assertValidInventory(inventory);
    return inventory;
  }

  public parse(manifest: string): M4ManifestInventory | undefined {
    try {
      const sections = this.compositor.parse(manifest);
      if (sections.documentLifecycle === undefined) {
        throw corruptManifestError();
      }
      parseDocumentLifecycleInventorySection(sections.documentLifecycle.content);
      return sections.m4AuditInventory === undefined
        ? undefined
        : parseM4ManifestInventorySection(sections.m4AuditInventory.content);
    } catch (error) {
      this.throwCorrupt(error);
    }
  }

  public render(existingManifest: string, inventory: M4ManifestInventory): string {
    try {
      this.assertValidInventory(inventory);
      const sections = this.compositor.parse(existingManifest);
      if (sections.documentLifecycle === undefined) {
        throw corruptManifestError();
      }
      const lifecycleMetadata = parseDocumentLifecycleInventorySection(
        sections.documentLifecycle.content,
      );
      if (sections.m4AuditInventory !== undefined) {
        parseM4ManifestInventorySection(sections.m4AuditInventory.content);
      }
      const nextM4Section = renderM4ManifestInventorySection(inventory);
      if (
        sections.m4AuditInventory !== undefined &&
        equivalentSection(sections.m4AuditInventory.content, nextM4Section)
      ) {
        return existingManifest;
      }

      const nextLifecycleMetadata = lifecycleMetadata.map((entry) =>
        entry.documentType === 'MANIFEST'
          ? {
              ...entry,
              status: 'UPDATED' as const,
              revision: entry.revision + 1,
              updatedAt: inventory.generatedAt,
              updatedBy: 'SYSTEM' as const,
              contentType: 'DERIVED' as const,
            }
          : entry,
      );
      const manifestWithAdvancedLifecycle = this.compositor.replaceDocumentLifecycle(
        existingManifest,
        renderDocumentLifecycleInventorySection(nextLifecycleMetadata),
      );
      return this.compositor.upsertM4AuditInventory(manifestWithAdvancedLifecycle, nextM4Section);
    } catch (error) {
      this.throwCorrupt(error);
    }
  }

  private assertValidInventory(inventory: M4ManifestInventory): void {
    try {
      validateInventory(inventory);
    } catch (error) {
      this.throwCorrupt(error);
    }
  }

  private throwCorrupt(error: unknown): never {
    if (error instanceof AuditLedgerCorruptError) {
      throw error;
    }
    throw new AuditLedgerCorruptError(
      'The Milestone 4 audit inventory is inconsistent and cannot be used safely.',
    );
  }
}
