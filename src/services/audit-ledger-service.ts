import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  AUDIT_LEDGER_SCHEMA_VERSION,
  AUDIT_OPERATIONS,
  CHECKPOINT_KINDS,
  DECISION_KINDS,
  EXECUTION_METHODS,
  TEST_EXECUTION_OUTCOMES,
  VERIFICATION_METHODS,
  type AuditEntry,
  type AuditLedger,
  type AuditLedgerMutationResult,
  type AuditOperation,
  type Checkpoint,
  type Decision,
  type DefineTestPlanRequest,
  type EvidenceReference,
  type IdempotencyIndexEntry,
  type RecordCheckpointRequest,
  type RecordDecisionRequest,
  type RecordTestExecutionRequest,
  type RegisterEvidenceReferenceRequest,
  type TestExecution,
  type TestPlanVersion,
} from '../domain/work-item-audit.js';
import {
  AuditEntryNotFoundError,
  AuditEntryValidationError,
  AuditIdempotencyConflictError,
  AuditLedgerCorruptError,
  AuditRevisionConflictError,
  EvidenceReferenceDuplicateError,
  TestCaseNotFoundError,
  TestPlanConflictError,
  TestPlanRevisionConflictError,
} from '../errors/workspace-error.js';
import type { Clock } from './clock.js';
import { isCanonicalUuidV4, type IdGenerator } from './id-generator.js';

const SHA_256_PATTERN = /^[0-9a-f]{64}$/;
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_DRIVE_PATTERN = /^[a-z]:/i;
const URL_STYLE_LOCATION_PATTERN = /(^|[^\p{L}\p{N}])(?:www\.|[a-z][a-z0-9+.-]*:)(?=\S)/iu;
const ABSOLUTE_LOCATION_PATTERN =
  /(^|[^\p{L}\p{N}._/\\-])(?:[a-z]:[\\/]|[\\/]{2}|[\\/](?![\\/])|~[\\/])/iu;

const safeNonNegativeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const safePositiveInteger = safeNonNegativeInteger.refine((value) => value > 0);
const requiredText = z
  .string()
  .transform((value, context) => normalizeAuditText(value, context))
  .pipe(z.string().min(1));
const optionalText = z
  .string()
  .optional()
  .transform((value, context) => {
    if (value === undefined) {
      return undefined;
    }
    const normalized = normalizeAuditText(value, context);
    if (typeof normalized !== 'string') {
      return normalized;
    }
    return normalized.length === 0 ? undefined : normalized;
  });
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const isoTimestamp = z.string().refine(isIsoTimestamp);
const optionalUuidList = z
  .array(uuid)
  .optional()
  .transform((values) => normalizeOptionalList(values));

const decisionSchema = z
  .object({
    id: uuid,
    idempotencyKey: requiredText,
    kind: z.enum(DECISION_KINDS),
    title: requiredText,
    decision: requiredText,
    rationale: requiredText,
    declaredActor: requiredText,
    recordedAt: isoTimestamp,
    relatedDecisionId: uuid.optional(),
    evidenceReferenceIds: optionalUuidList,
  })
  .strict();

const checkpointSchema = z
  .object({
    id: uuid,
    idempotencyKey: requiredText,
    kind: z.enum(CHECKPOINT_KINDS),
    summary: requiredText,
    declaredActor: requiredText,
    recordedAt: isoTimestamp,
    correctsCheckpointId: uuid.optional(),
    relatedDecisionIds: optionalUuidList,
    evidenceReferenceIds: optionalUuidList,
  })
  .strict();

const testCaseDefinitionSchema = z
  .object({
    testCaseId: uuid,
    title: requiredText,
    objective: requiredText,
    verificationMethod: z.enum(VERIFICATION_METHODS),
    expectedOutcome: requiredText,
  })
  .strict();

const testPlanVersionSchema = z
  .object({
    id: uuid,
    planId: uuid,
    planRevision: safePositiveInteger,
    idempotencyKey: requiredText,
    purpose: requiredText,
    declaredActor: requiredText,
    recordedAt: isoTimestamp,
    testCases: z.array(testCaseDefinitionSchema).min(1),
  })
  .strict();

const testExecutionSchema = z
  .object({
    id: uuid,
    idempotencyKey: requiredText,
    planId: uuid,
    planRevision: safePositiveInteger,
    testCaseId: uuid,
    executionMethod: z.enum(EXECUTION_METHODS),
    outcome: z.enum(TEST_EXECUTION_OUTCOMES),
    summary: requiredText,
    declaredActor: requiredText,
    recordedAt: isoTimestamp,
    evidenceReferenceIds: optionalUuidList,
  })
  .strict();

const evidenceReferenceSchema = z
  .object({
    id: uuid,
    idempotencyKey: requiredText,
    label: requiredText,
    description: optionalText,
    logicalPath: z.string().transform((value, context) => {
      try {
        return normalizeEvidenceLogicalPath(value);
      } catch {
        context.addIssue({ code: 'custom', message: 'Invalid evidence logical path.' });
        return z.NEVER;
      }
    }),
    declaredActor: requiredText,
    recordedAt: isoTimestamp,
  })
  .strict();

const idempotencyIndexEntrySchema = z
  .object({
    idempotencyKey: requiredText,
    operation: z.enum(AUDIT_OPERATIONS),
    entryId: uuid,
    payloadFingerprint: z.string().regex(SHA_256_PATTERN),
  })
  .strict();

const auditLedgerSchema = z
  .object({
    schemaVersion: z.literal(AUDIT_LEDGER_SCHEMA_VERSION),
    revision: safeNonNegativeInteger,
    updatedAt: isoTimestamp,
    decisions: z.array(decisionSchema),
    checkpoints: z.array(checkpointSchema),
    testPlans: z.array(testPlanVersionSchema),
    testExecutions: z.array(testExecutionSchema),
    evidenceReferences: z.array(evidenceReferenceSchema),
    idempotencyIndex: z.array(idempotencyIndexEntrySchema),
  })
  .strict();

const recordDecisionSchema = z
  .object({
    expectedAuditRevision: safeNonNegativeInteger,
    idempotencyKey: requiredText,
    kind: z.enum(DECISION_KINDS),
    title: requiredText,
    decision: requiredText,
    rationale: requiredText,
    declaredActor: requiredText,
    relatedDecisionId: uuid.optional(),
    evidenceReferenceIds: optionalUuidList,
  })
  .strict()
  .superRefine((request, context) => {
    if (request.kind !== 'DECISION' && request.relatedDecisionId === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['relatedDecisionId'],
        message: 'A related decision is required for this decision kind.',
      });
    }
  });

const recordCheckpointSchema = z
  .object({
    expectedAuditRevision: safeNonNegativeInteger,
    idempotencyKey: requiredText,
    kind: z.enum(CHECKPOINT_KINDS),
    summary: requiredText,
    declaredActor: requiredText,
    correctsCheckpointId: uuid.optional(),
    relatedDecisionIds: optionalUuidList,
    evidenceReferenceIds: optionalUuidList,
  })
  .strict();

const testCaseDefinitionInputSchema = z
  .object({
    title: requiredText,
    objective: requiredText,
    verificationMethod: z.enum(VERIFICATION_METHODS),
    expectedOutcome: requiredText,
  })
  .strict();

const defineTestPlanSchema = z
  .object({
    expectedAuditRevision: safeNonNegativeInteger,
    idempotencyKey: requiredText,
    planId: uuid.optional(),
    expectedPlanRevision: safeNonNegativeInteger,
    purpose: requiredText,
    declaredActor: requiredText,
    testCases: z.array(testCaseDefinitionInputSchema).min(1),
  })
  .strict();

const recordTestExecutionSchema = z
  .object({
    expectedAuditRevision: safeNonNegativeInteger,
    expectedPlanRevision: safeNonNegativeInteger,
    idempotencyKey: requiredText,
    planId: uuid,
    planRevision: safePositiveInteger,
    testCaseId: uuid,
    executionMethod: z.enum(EXECUTION_METHODS),
    outcome: z.enum(TEST_EXECUTION_OUTCOMES),
    summary: requiredText,
    declaredActor: requiredText,
    evidenceReferenceIds: optionalUuidList,
  })
  .strict();

const registerEvidenceReferenceSchema = z
  .object({
    expectedAuditRevision: safeNonNegativeInteger,
    idempotencyKey: requiredText,
    label: requiredText,
    description: optionalText,
    logicalPath: z.string().transform((value, context) => {
      try {
        return normalizeEvidenceLogicalPath(value);
      } catch {
        context.addIssue({ code: 'custom', message: 'Invalid evidence logical path.' });
        return z.NEVER;
      }
    }),
    declaredActor: requiredText,
  })
  .strict();

interface IndexedAuditEntry {
  entry: AuditEntry;
  operation: AuditOperation;
  indexPosition: number;
}

interface IdempotentMatch<TEntry extends AuditEntry> {
  entry: TEntry;
  auditRevision: number;
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

function normalizeAuditText(value: string, context: z.RefinementCtx): string | typeof z.NEVER {
  const normalized = normalizeText(value);
  if (URL_STYLE_LOCATION_PATTERN.test(normalized) || ABSOLUTE_LOCATION_PATTERN.test(normalized)) {
    context.addIssue({
      code: 'custom',
      message: 'Absolute locations are not allowed in audit text.',
    });
    return z.NEVER;
  }
  return normalized;
}

function normalizeOptionalList(values: readonly string[] | undefined): string[] | undefined {
  if (values === undefined) {
    return undefined;
  }
  const normalized = [...new Set(values)].sort((left, right) => left.localeCompare(right));
  return normalized.length === 0 ? undefined : normalized;
}

function isIsoTimestamp(value: string): boolean {
  const date = new Date(value);
  return value.length > 0 && !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

export function normalizeEvidenceLogicalPath(value: string): string {
  const normalized = normalizeText(value).replaceAll('\\', '/');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    WINDOWS_DRIVE_PATTERN.test(normalized) ||
    URL_SCHEME_PATTERN.test(normalized)
  ) {
    throw new AuditEntryValidationError('The evidence logical path is invalid.', {
      field: 'logicalPath',
    });
  }

  const segments = normalized.split('/');
  if (
    segments.length < 2 ||
    segments[0] !== 'evidence' ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new AuditEntryValidationError('The evidence logical path is invalid.', {
      field: 'logicalPath',
    });
  }
  return segments.join('/');
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new AuditEntryValidationError('The audit payload cannot be canonicalized.');
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalValue(entry));
  }
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort((left, right) => left.localeCompare(right))) {
      const entry = source[key];
      if (entry !== undefined) {
        normalized[key] = canonicalValue(entry);
      }
    }
    return normalized;
  }
  throw new AuditEntryValidationError('The audit payload cannot be canonicalized.');
}

export function canonicalizeAuditPayload(payload: unknown): string {
  return JSON.stringify(canonicalValue(payload));
}

export function fingerprintAuditPayload(payload: unknown): string {
  return createHash('sha256').update(canonicalizeAuditPayload(payload), 'utf8').digest('hex');
}

function parseRequest<T>(schema: z.ZodType, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AuditEntryValidationError('The audit entry request is invalid.', {
      field: issue?.path.join('.') || 'input',
    });
  }
  return parsed.data as T;
}

function corruption(): AuditLedgerCorruptError {
  return new AuditLedgerCorruptError('The audit ledger cannot be read safely.');
}

function decisionFingerprintPayload(
  value: Omit<Decision, 'id' | 'recordedAt'>,
  expectedAuditRevision: number,
): Record<string, unknown> {
  return {
    expectedAuditRevision,
    idempotencyKey: value.idempotencyKey,
    kind: value.kind,
    title: value.title,
    decision: value.decision,
    rationale: value.rationale,
    declaredActor: value.declaredActor,
    ...(value.relatedDecisionId === undefined
      ? {}
      : { relatedDecisionId: value.relatedDecisionId }),
    ...(value.evidenceReferenceIds === undefined
      ? {}
      : { evidenceReferenceIds: value.evidenceReferenceIds }),
  };
}

function checkpointFingerprintPayload(
  value: Omit<Checkpoint, 'id' | 'recordedAt'>,
  expectedAuditRevision: number,
): Record<string, unknown> {
  return {
    expectedAuditRevision,
    idempotencyKey: value.idempotencyKey,
    kind: value.kind,
    summary: value.summary,
    declaredActor: value.declaredActor,
    ...(value.correctsCheckpointId === undefined
      ? {}
      : { correctsCheckpointId: value.correctsCheckpointId }),
    ...(value.relatedDecisionIds === undefined
      ? {}
      : { relatedDecisionIds: value.relatedDecisionIds }),
    ...(value.evidenceReferenceIds === undefined
      ? {}
      : { evidenceReferenceIds: value.evidenceReferenceIds }),
  };
}

function testPlanFingerprintPayload(
  value: Omit<TestPlanVersion, 'id' | 'recordedAt' | 'planRevision'>,
  planRevision: number,
  expectedAuditRevision: number,
  expectedPlanRevision: number,
): Record<string, unknown> {
  return {
    expectedAuditRevision,
    expectedPlanRevision,
    idempotencyKey: value.idempotencyKey,
    ...(planRevision === 1 ? {} : { planId: value.planId }),
    purpose: value.purpose,
    declaredActor: value.declaredActor,
    testCases: value.testCases.map((testCase) => ({
      title: testCase.title,
      objective: testCase.objective,
      verificationMethod: testCase.verificationMethod,
      expectedOutcome: testCase.expectedOutcome,
    })),
  };
}

function testExecutionFingerprintPayload(
  value: Omit<TestExecution, 'id' | 'recordedAt'>,
  expectedAuditRevision: number,
  expectedPlanRevision: number,
): Record<string, unknown> {
  return {
    expectedAuditRevision,
    expectedPlanRevision,
    idempotencyKey: value.idempotencyKey,
    planId: value.planId,
    planRevision: value.planRevision,
    testCaseId: value.testCaseId,
    executionMethod: value.executionMethod,
    outcome: value.outcome,
    summary: value.summary,
    declaredActor: value.declaredActor,
    ...(value.evidenceReferenceIds === undefined
      ? {}
      : { evidenceReferenceIds: value.evidenceReferenceIds }),
  };
}

function evidenceFingerprintPayload(
  value: Omit<EvidenceReference, 'id' | 'recordedAt'>,
  expectedAuditRevision: number,
): Record<string, unknown> {
  return {
    expectedAuditRevision,
    idempotencyKey: value.idempotencyKey,
    label: value.label,
    ...(value.description === undefined ? {} : { description: value.description }),
    logicalPath: value.logicalPath,
    declaredActor: value.declaredActor,
  };
}

function operationEntries(ledger: AuditLedger): Array<{
  operation: AuditOperation;
  entries: AuditEntry[];
}> {
  return [
    { operation: 'record_decision', entries: ledger.decisions },
    { operation: 'record_checkpoint', entries: ledger.checkpoints },
    { operation: 'define_test_plan', entries: ledger.testPlans },
    { operation: 'record_test_execution', entries: ledger.testExecutions },
    { operation: 'register_evidence_reference', entries: ledger.evidenceReferences },
  ];
}

function fingerprintForPersistedEntry(
  operation: AuditOperation,
  entry: AuditEntry,
  indexPosition: number,
): string {
  switch (operation) {
    case 'record_decision':
      return fingerprintAuditPayload(decisionFingerprintPayload(entry as Decision, indexPosition));
    case 'record_checkpoint':
      return fingerprintAuditPayload(
        checkpointFingerprintPayload(entry as Checkpoint, indexPosition),
      );
    case 'define_test_plan': {
      const plan = entry as TestPlanVersion;
      return fingerprintAuditPayload(
        testPlanFingerprintPayload(plan, plan.planRevision, indexPosition, plan.planRevision - 1),
      );
    }
    case 'record_test_execution':
      return fingerprintAuditPayload(
        testExecutionFingerprintPayload(
          entry as TestExecution,
          indexPosition,
          (entry as TestExecution).planRevision,
        ),
      );
    case 'register_evidence_reference':
      return fingerprintAuditPayload(
        evidenceFingerprintPayload(entry as EvidenceReference, indexPosition),
      );
  }
}

function cloneLedgerWithAppend<TEntry extends AuditEntry>(
  ledger: AuditLedger,
  operation: AuditOperation,
  entry: TEntry,
  fingerprint: string,
): AuditLedger {
  const indexEntry: IdempotencyIndexEntry = {
    idempotencyKey: entry.idempotencyKey,
    operation,
    entryId: entry.id,
    payloadFingerprint: fingerprint,
  };
  return {
    schemaVersion: AUDIT_LEDGER_SCHEMA_VERSION,
    revision: ledger.revision + 1,
    updatedAt: entry.recordedAt,
    decisions:
      operation === 'record_decision'
        ? [...ledger.decisions, entry as Decision]
        : [...ledger.decisions],
    checkpoints:
      operation === 'record_checkpoint'
        ? [...ledger.checkpoints, entry as Checkpoint]
        : [...ledger.checkpoints],
    testPlans:
      operation === 'define_test_plan'
        ? [...ledger.testPlans, entry as TestPlanVersion]
        : [...ledger.testPlans],
    testExecutions:
      operation === 'record_test_execution'
        ? [...ledger.testExecutions, entry as TestExecution]
        : [...ledger.testExecutions],
    evidenceReferences:
      operation === 'register_evidence_reference'
        ? [...ledger.evidenceReferences, entry as EvidenceReference]
        : [...ledger.evidenceReferences],
    idempotencyIndex: [...ledger.idempotencyIndex, indexEntry],
  };
}

function uniqueOrCorrupt(values: readonly string[]): void {
  if (new Set(values).size !== values.length) {
    throw corruption();
  }
}

function requireEarlier(
  positions: ReadonlyMap<string, number>,
  referencedId: string,
  currentPosition: number,
): void {
  const referencedPosition = positions.get(referencedId);
  if (referencedPosition === undefined || referencedPosition >= currentPosition) {
    throw corruption();
  }
}

/**
 * Owns the strict M4 ledger codec and immutable append rules. It never accesses
 * a filesystem; every successful append returns a new fully validated ledger.
 */
export class AuditLedgerService {
  public constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  public createEmptyLedger(): AuditLedger {
    const updatedAt = this.generatedTimestamp();
    return {
      schemaVersion: AUDIT_LEDGER_SCHEMA_VERSION,
      revision: 0,
      updatedAt,
      decisions: [],
      checkpoints: [],
      testPlans: [],
      testExecutions: [],
      evidenceReferences: [],
      idempotencyIndex: [],
    };
  }

  public parse(content: string): AuditLedger {
    let input: unknown;
    try {
      input = JSON.parse(content);
    } catch {
      throw corruption();
    }
    const parsed = auditLedgerSchema.safeParse(input);
    if (
      !parsed.success ||
      canonicalizeAuditPayload(input) !== canonicalizeAuditPayload(parsed.data)
    ) {
      throw corruption();
    }
    const ledger = parsed.data as AuditLedger;
    if (canonicalizeAuditPayload(input) !== canonicalizeAuditPayload(ledger)) {
      throw corruption();
    }
    this.validateIntegrity(ledger);
    return ledger;
  }

  public serialize(ledger: AuditLedger): string {
    this.validate(ledger);
    return JSON.stringify(this.orderedLedger(ledger), null, 2) + '\n';
  }

  public validate(ledger: AuditLedger): void {
    const parsed = auditLedgerSchema.safeParse(ledger);
    if (
      !parsed.success ||
      canonicalizeAuditPayload(ledger) !== canonicalizeAuditPayload(parsed.data)
    ) {
      throw corruption();
    }
    const normalized = parsed.data as AuditLedger;
    if (canonicalizeAuditPayload(ledger) !== canonicalizeAuditPayload(normalized)) {
      throw corruption();
    }
    this.validateIntegrity(normalized);
  }

  public activeTestPlan(ledger: AuditLedger): TestPlanVersion | undefined {
    this.validate(ledger);
    return ledger.testPlans.at(-1);
  }

  public appendDecision(ledger: AuditLedger, input: unknown): AuditLedgerMutationResult<Decision> {
    this.validate(ledger);
    const request = parseRequest<RecordDecisionRequest>(recordDecisionSchema, input);
    const payload = decisionFingerprintPayload(request, request.expectedAuditRevision);
    const fingerprint = fingerprintAuditPayload(payload);
    const retry = this.findIdempotent<Decision>(
      ledger,
      request.idempotencyKey,
      'record_decision',
      fingerprint,
    );
    if (retry !== undefined) {
      return { ledger, entry: retry.entry, auditRevision: retry.auditRevision, idempotent: true };
    }
    this.assertAuditRevision(ledger, request.expectedAuditRevision);
    if (
      request.relatedDecisionId !== undefined &&
      !ledger.decisions.some((entry) => entry.id === request.relatedDecisionId)
    ) {
      throw new AuditEntryNotFoundError('The referenced audit entry does not exist.');
    }
    this.assertEvidenceReferences(ledger, request.evidenceReferenceIds);

    const entry: Decision = {
      id: this.generatedId(this.generatedIdentitySet(ledger)),
      idempotencyKey: request.idempotencyKey,
      kind: request.kind,
      title: request.title,
      decision: request.decision,
      rationale: request.rationale,
      declaredActor: request.declaredActor,
      recordedAt: this.generatedTimestamp(),
      ...(request.relatedDecisionId === undefined
        ? {}
        : { relatedDecisionId: request.relatedDecisionId }),
      ...(request.evidenceReferenceIds === undefined
        ? {}
        : { evidenceReferenceIds: request.evidenceReferenceIds }),
    };
    return this.confirmAppend(ledger, 'record_decision', entry, fingerprint);
  }

  public appendCheckpoint(
    ledger: AuditLedger,
    input: unknown,
  ): AuditLedgerMutationResult<Checkpoint> {
    this.validate(ledger);
    const request = parseRequest<RecordCheckpointRequest>(recordCheckpointSchema, input);
    const fingerprint = fingerprintAuditPayload(
      checkpointFingerprintPayload(request, request.expectedAuditRevision),
    );
    const retry = this.findIdempotent<Checkpoint>(
      ledger,
      request.idempotencyKey,
      'record_checkpoint',
      fingerprint,
    );
    if (retry !== undefined) {
      return { ledger, entry: retry.entry, auditRevision: retry.auditRevision, idempotent: true };
    }
    this.assertAuditRevision(ledger, request.expectedAuditRevision);
    if (
      request.correctsCheckpointId !== undefined &&
      !ledger.checkpoints.some((entry) => entry.id === request.correctsCheckpointId)
    ) {
      throw new AuditEntryNotFoundError('The referenced audit entry does not exist.');
    }
    this.assertDecisionReferences(ledger, request.relatedDecisionIds);
    this.assertEvidenceReferences(ledger, request.evidenceReferenceIds);

    const entry: Checkpoint = {
      id: this.generatedId(this.generatedIdentitySet(ledger)),
      idempotencyKey: request.idempotencyKey,
      kind: request.kind,
      summary: request.summary,
      declaredActor: request.declaredActor,
      recordedAt: this.generatedTimestamp(),
      ...(request.correctsCheckpointId === undefined
        ? {}
        : { correctsCheckpointId: request.correctsCheckpointId }),
      ...(request.relatedDecisionIds === undefined
        ? {}
        : { relatedDecisionIds: request.relatedDecisionIds }),
      ...(request.evidenceReferenceIds === undefined
        ? {}
        : { evidenceReferenceIds: request.evidenceReferenceIds }),
    };
    return this.confirmAppend(ledger, 'record_checkpoint', entry, fingerprint);
  }

  public appendTestPlan(
    ledger: AuditLedger,
    input: unknown,
  ): AuditLedgerMutationResult<TestPlanVersion> {
    this.validate(ledger);
    const request = parseRequest<DefineTestPlanRequest>(defineTestPlanSchema, input);
    const fingerprint = fingerprintAuditPayload({
      expectedAuditRevision: request.expectedAuditRevision,
      expectedPlanRevision: request.expectedPlanRevision,
      idempotencyKey: request.idempotencyKey,
      ...(request.planId === undefined ? {} : { planId: request.planId }),
      purpose: request.purpose,
      declaredActor: request.declaredActor,
      testCases: request.testCases,
    });
    const retry = this.findIdempotent<TestPlanVersion>(
      ledger,
      request.idempotencyKey,
      'define_test_plan',
      fingerprint,
    );
    if (retry !== undefined) {
      return { ledger, entry: retry.entry, auditRevision: retry.auditRevision, idempotent: true };
    }
    this.assertAuditRevision(ledger, request.expectedAuditRevision);

    const activePlan = ledger.testPlans.at(-1);
    const reservedIdentities = this.generatedIdentitySet(ledger);
    let planId: string;
    let planRevision: number;
    if (activePlan === undefined) {
      if (request.planId !== undefined) {
        throw new TestPlanConflictError(
          'The first test plan identity must be generated by the server.',
        );
      }
      if (request.expectedPlanRevision !== 0) {
        throw new TestPlanRevisionConflictError(
          'The test plan revision does not match the active version.',
        );
      }
      planId = this.generatedId(reservedIdentities);
      reservedIdentities.add(planId);
      planRevision = 1;
    } else {
      if (request.planId === undefined || request.planId !== activePlan.planId) {
        throw new TestPlanConflictError(
          'The requested test plan does not match the Work Item test plan.',
        );
      }
      if (request.expectedPlanRevision !== activePlan.planRevision) {
        throw new TestPlanRevisionConflictError(
          'The test plan revision does not match the active version.',
        );
      }
      planId = activePlan.planId;
      planRevision = activePlan.planRevision + 1;
    }

    const entryId = this.generatedId(reservedIdentities);
    reservedIdentities.add(entryId);
    const testCaseIds = request.testCases.map(() => {
      const testCaseId = this.generatedId(reservedIdentities);
      reservedIdentities.add(testCaseId);
      return testCaseId;
    });
    const entry: TestPlanVersion = {
      id: entryId,
      planId,
      planRevision,
      idempotencyKey: request.idempotencyKey,
      purpose: request.purpose,
      declaredActor: request.declaredActor,
      recordedAt: this.generatedTimestamp(),
      testCases: request.testCases.map((testCase, index) => {
        const testCaseId = testCaseIds[index];
        if (testCaseId === undefined) {
          throw new AuditEntryValidationError('Could not generate audit identities safely.');
        }
        return { testCaseId, ...testCase };
      }),
    };
    return this.confirmAppend(ledger, 'define_test_plan', entry, fingerprint);
  }

  public appendTestExecution(
    ledger: AuditLedger,
    input: unknown,
  ): AuditLedgerMutationResult<TestExecution> {
    this.validate(ledger);
    const request = parseRequest<RecordTestExecutionRequest>(recordTestExecutionSchema, input);
    const fingerprint = fingerprintAuditPayload(
      testExecutionFingerprintPayload(
        request,
        request.expectedAuditRevision,
        request.expectedPlanRevision,
      ),
    );
    const retry = this.findIdempotent<TestExecution>(
      ledger,
      request.idempotencyKey,
      'record_test_execution',
      fingerprint,
    );
    if (retry !== undefined) {
      return { ledger, entry: retry.entry, auditRevision: retry.auditRevision, idempotent: true };
    }
    this.assertAuditRevision(ledger, request.expectedAuditRevision);
    const activePlan = ledger.testPlans.at(-1);
    if (activePlan === undefined || request.planId !== activePlan.planId) {
      throw new TestPlanConflictError(
        'The requested test plan does not match the Work Item test plan.',
      );
    }
    if (
      request.expectedPlanRevision !== activePlan.planRevision ||
      request.planRevision !== activePlan.planRevision
    ) {
      throw new TestPlanRevisionConflictError(
        'The test plan revision does not match the active version.',
      );
    }
    if (!activePlan.testCases.some((testCase) => testCase.testCaseId === request.testCaseId)) {
      throw new TestCaseNotFoundError('The requested test case does not exist.');
    }
    this.assertEvidenceReferences(ledger, request.evidenceReferenceIds);

    const entry: TestExecution = {
      id: this.generatedId(this.generatedIdentitySet(ledger)),
      idempotencyKey: request.idempotencyKey,
      planId: request.planId,
      planRevision: request.planRevision,
      testCaseId: request.testCaseId,
      executionMethod: request.executionMethod,
      outcome: request.outcome,
      summary: request.summary,
      declaredActor: request.declaredActor,
      recordedAt: this.generatedTimestamp(),
      ...(request.evidenceReferenceIds === undefined
        ? {}
        : { evidenceReferenceIds: request.evidenceReferenceIds }),
    };
    return this.confirmAppend(ledger, 'record_test_execution', entry, fingerprint);
  }

  public appendEvidenceReference(
    ledger: AuditLedger,
    input: unknown,
  ): AuditLedgerMutationResult<EvidenceReference> {
    this.validate(ledger);
    const request = parseRequest<RegisterEvidenceReferenceRequest>(
      registerEvidenceReferenceSchema,
      input,
    );
    const fingerprint = fingerprintAuditPayload(
      evidenceFingerprintPayload(request, request.expectedAuditRevision),
    );
    const retry = this.findIdempotent<EvidenceReference>(
      ledger,
      request.idempotencyKey,
      'register_evidence_reference',
      fingerprint,
    );
    if (retry !== undefined) {
      return { ledger, entry: retry.entry, auditRevision: retry.auditRevision, idempotent: true };
    }
    this.assertAuditRevision(ledger, request.expectedAuditRevision);
    if (ledger.evidenceReferences.some((entry) => entry.logicalPath === request.logicalPath)) {
      throw new EvidenceReferenceDuplicateError(
        'An evidence reference already uses this logical path.',
      );
    }
    const entry: EvidenceReference = {
      id: this.generatedId(this.generatedIdentitySet(ledger)),
      idempotencyKey: request.idempotencyKey,
      label: request.label,
      ...(request.description === undefined ? {} : { description: request.description }),
      logicalPath: request.logicalPath,
      declaredActor: request.declaredActor,
      recordedAt: this.generatedTimestamp(),
    };
    return this.confirmAppend(ledger, 'register_evidence_reference', entry, fingerprint);
  }

  private confirmAppend<TEntry extends AuditEntry>(
    ledger: AuditLedger,
    operation: AuditOperation,
    entry: TEntry,
    fingerprint: string,
  ): AuditLedgerMutationResult<TEntry> {
    const nextLedger = cloneLedgerWithAppend(ledger, operation, entry, fingerprint);
    this.validate(nextLedger);
    return {
      ledger: nextLedger,
      entry,
      auditRevision: nextLedger.revision,
      idempotent: false,
    };
  }

  private findIdempotent<TEntry extends AuditEntry>(
    ledger: AuditLedger,
    idempotencyKey: string,
    operation: AuditOperation,
    fingerprint: string,
  ): IdempotentMatch<TEntry> | undefined {
    const indexPosition = ledger.idempotencyIndex.findIndex(
      (entry) => entry.idempotencyKey === idempotencyKey,
    );
    if (indexPosition === -1) {
      return undefined;
    }
    const index = ledger.idempotencyIndex[indexPosition];
    if (
      index === undefined ||
      index.operation !== operation ||
      index.payloadFingerprint !== fingerprint
    ) {
      throw new AuditIdempotencyConflictError(
        'The idempotency key is already associated with another audit operation or payload.',
      );
    }
    const entry = this.findEntry(ledger, operation, index.entryId);
    if (entry === undefined) {
      throw corruption();
    }
    return { entry: entry as TEntry, auditRevision: indexPosition + 1 };
  }

  private findEntry(
    ledger: AuditLedger,
    operation: AuditOperation,
    entryId: string,
  ): AuditEntry | undefined {
    const collection = operationEntries(ledger).find(
      (candidate) => candidate.operation === operation,
    );
    return collection?.entries.find((entry) => entry.id === entryId);
  }

  private assertAuditRevision(ledger: AuditLedger, expectedRevision: number): void {
    if (ledger.revision !== expectedRevision) {
      throw new AuditRevisionConflictError(
        'The audit revision does not match the current version.',
      );
    }
  }

  private assertDecisionReferences(ledger: AuditLedger, ids: readonly string[] | undefined): void {
    if (ids !== undefined && ids.some((id) => !ledger.decisions.some((entry) => entry.id === id))) {
      throw new AuditEntryNotFoundError('The referenced audit entry does not exist.');
    }
  }

  private assertEvidenceReferences(ledger: AuditLedger, ids: readonly string[] | undefined): void {
    if (
      ids !== undefined &&
      ids.some((id) => !ledger.evidenceReferences.some((entry) => entry.id === id))
    ) {
      throw new AuditEntryNotFoundError('The referenced audit entry does not exist.');
    }
  }

  private generatedId(excluded: ReadonlySet<string> = new Set()): string {
    const value = this.idGenerator.generate();
    if (!isCanonicalUuidV4(value) || excluded.has(value)) {
      throw new AuditEntryValidationError('Could not generate an audit identity safely.');
    }
    return value;
  }

  private generatedIdentitySet(ledger: AuditLedger): Set<string> {
    return new Set([
      ...ledger.decisions.map((entry) => entry.id),
      ...ledger.checkpoints.map((entry) => entry.id),
      ...ledger.testPlans.map((entry) => entry.id),
      ...ledger.testPlans.map((entry) => entry.planId),
      ...ledger.testPlans.flatMap((entry) =>
        entry.testCases.map((testCase) => testCase.testCaseId),
      ),
      ...ledger.testExecutions.map((entry) => entry.id),
      ...ledger.evidenceReferences.map((entry) => entry.id),
    ]);
  }

  private generatedTimestamp(): string {
    const value = this.clock.now();
    if (!isIsoTimestamp(value)) {
      throw new AuditEntryValidationError('Could not generate an audit timestamp safely.');
    }
    return value;
  }

  private orderedLedger(ledger: AuditLedger): AuditLedger {
    return {
      schemaVersion: AUDIT_LEDGER_SCHEMA_VERSION,
      revision: ledger.revision,
      updatedAt: ledger.updatedAt,
      decisions: ledger.decisions.map((entry) => ({ ...entry })),
      checkpoints: ledger.checkpoints.map((entry) => ({ ...entry })),
      testPlans: ledger.testPlans.map((entry) => ({
        ...entry,
        testCases: entry.testCases.map((testCase) => ({ ...testCase })),
      })),
      testExecutions: ledger.testExecutions.map((entry) => ({ ...entry })),
      evidenceReferences: ledger.evidenceReferences.map((entry) => ({ ...entry })),
      idempotencyIndex: ledger.idempotencyIndex.map((entry) => ({ ...entry })),
    };
  }

  private validateIntegrity(ledger: AuditLedger): void {
    const collections = operationEntries(ledger);
    const allEntries = collections.flatMap((collection) => collection.entries);
    if (
      ledger.revision !== allEntries.length ||
      ledger.revision !== ledger.idempotencyIndex.length
    ) {
      throw corruption();
    }

    const entryById = new Map<string, { entry: AuditEntry; operation: AuditOperation }>();
    for (const collection of collections) {
      for (const entry of collection.entries) {
        if (entryById.has(entry.id)) {
          throw corruption();
        }
        entryById.set(entry.id, { entry, operation: collection.operation });
      }
    }
    uniqueOrCorrupt(allEntries.map((entry) => entry.idempotencyKey));
    uniqueOrCorrupt(ledger.idempotencyIndex.map((entry) => entry.idempotencyKey));
    uniqueOrCorrupt(ledger.idempotencyIndex.map((entry) => entry.entryId));

    const indexed = new Map<string, IndexedAuditEntry>();
    for (
      let indexPosition = 0;
      indexPosition < ledger.idempotencyIndex.length;
      indexPosition += 1
    ) {
      const index = ledger.idempotencyIndex[indexPosition];
      if (index === undefined) {
        throw corruption();
      }
      const found = entryById.get(index.entryId);
      if (
        found === undefined ||
        found.operation !== index.operation ||
        found.entry.idempotencyKey !== index.idempotencyKey ||
        fingerprintForPersistedEntry(found.operation, found.entry, indexPosition) !==
          index.payloadFingerprint
      ) {
        throw corruption();
      }
      indexed.set(index.entryId, {
        entry: found.entry,
        operation: found.operation,
        indexPosition,
      });
    }
    if (indexed.size !== allEntries.length) {
      throw corruption();
    }

    for (const collection of collections) {
      let lastPosition = -1;
      for (const entry of collection.entries) {
        const position = indexed.get(entry.id)?.indexPosition;
        if (position === undefined || position <= lastPosition) {
          throw corruption();
        }
        lastPosition = position;
      }
    }

    const entryPositions = new Map(
      [...indexed.entries()].map(([id, value]) => [id, value.indexPosition]),
    );
    const evidencePaths = ledger.evidenceReferences.map((entry) => entry.logicalPath);
    uniqueOrCorrupt(evidencePaths);
    for (const evidence of ledger.evidenceReferences) {
      if (normalizeEvidenceLogicalPath(evidence.logicalPath) !== evidence.logicalPath) {
        throw corruption();
      }
    }

    for (const decision of ledger.decisions) {
      const position = entryPositions.get(decision.id);
      if (position === undefined) {
        throw corruption();
      }
      if (decision.kind !== 'DECISION' && decision.relatedDecisionId === undefined) {
        throw corruption();
      }
      if (decision.relatedDecisionId !== undefined) {
        requireEarlier(entryPositions, decision.relatedDecisionId, position);
        if (!ledger.decisions.some((entry) => entry.id === decision.relatedDecisionId)) {
          throw corruption();
        }
      }
      for (const evidenceId of decision.evidenceReferenceIds ?? []) {
        requireEarlier(entryPositions, evidenceId, position);
        if (!ledger.evidenceReferences.some((entry) => entry.id === evidenceId)) {
          throw corruption();
        }
      }
    }

    for (const checkpoint of ledger.checkpoints) {
      const position = entryPositions.get(checkpoint.id);
      if (position === undefined) {
        throw corruption();
      }
      if (checkpoint.correctsCheckpointId !== undefined) {
        requireEarlier(entryPositions, checkpoint.correctsCheckpointId, position);
        if (!ledger.checkpoints.some((entry) => entry.id === checkpoint.correctsCheckpointId)) {
          throw corruption();
        }
      }
      for (const decisionId of checkpoint.relatedDecisionIds ?? []) {
        requireEarlier(entryPositions, decisionId, position);
        if (!ledger.decisions.some((entry) => entry.id === decisionId)) {
          throw corruption();
        }
      }
      for (const evidenceId of checkpoint.evidenceReferenceIds ?? []) {
        requireEarlier(entryPositions, evidenceId, position);
        if (!ledger.evidenceReferences.some((entry) => entry.id === evidenceId)) {
          throw corruption();
        }
      }
    }

    this.validatePlansAndExecutions(ledger, indexed, entryPositions);
    this.validateGeneratedIdentityUniqueness(ledger);

    if (ledger.revision > 0) {
      const lastIndex = ledger.idempotencyIndex.at(-1);
      const lastEntry =
        lastIndex === undefined ? undefined : entryById.get(lastIndex.entryId)?.entry;
      if (lastEntry === undefined || ledger.updatedAt !== lastEntry.recordedAt) {
        throw corruption();
      }
    }
  }

  private validatePlansAndExecutions(
    ledger: AuditLedger,
    indexed: ReadonlyMap<string, IndexedAuditEntry>,
    positions: ReadonlyMap<string, number>,
  ): void {
    const planIds = new Set(ledger.testPlans.map((plan) => plan.planId));
    if (planIds.size > 1) {
      throw corruption();
    }
    for (let index = 0; index < ledger.testPlans.length; index += 1) {
      const plan = ledger.testPlans[index];
      if (plan === undefined || plan.planRevision !== index + 1) {
        throw corruption();
      }
    }

    for (const execution of ledger.testExecutions) {
      const executionPosition = positions.get(execution.id);
      if (executionPosition === undefined) {
        throw corruption();
      }
      const exactPlan = ledger.testPlans.find(
        (plan) => plan.planId === execution.planId && plan.planRevision === execution.planRevision,
      );
      if (
        exactPlan === undefined ||
        !exactPlan.testCases.some((testCase) => testCase.testCaseId === execution.testCaseId)
      ) {
        throw corruption();
      }
      const planPosition = positions.get(exactPlan.id);
      if (planPosition === undefined || planPosition >= executionPosition) {
        throw corruption();
      }
      const activeAtExecution = ledger.testPlans
        .filter((plan) => {
          const position = indexed.get(plan.id)?.indexPosition;
          return position !== undefined && position < executionPosition;
        })
        .at(-1);
      if (
        activeAtExecution === undefined ||
        activeAtExecution.planId !== execution.planId ||
        activeAtExecution.planRevision !== execution.planRevision
      ) {
        throw corruption();
      }
      for (const evidenceId of execution.evidenceReferenceIds ?? []) {
        requireEarlier(positions, evidenceId, executionPosition);
        if (!ledger.evidenceReferences.some((entry) => entry.id === evidenceId)) {
          throw corruption();
        }
      }
    }
  }

  private validateGeneratedIdentityUniqueness(ledger: AuditLedger): void {
    const identities = [
      ...ledger.decisions.map((entry) => entry.id),
      ...ledger.checkpoints.map((entry) => entry.id),
      ...ledger.testPlans.map((entry) => entry.id),
      ...new Set(ledger.testPlans.map((entry) => entry.planId)),
      ...ledger.testPlans.flatMap((entry) =>
        entry.testCases.map((testCase) => testCase.testCaseId),
      ),
      ...ledger.testExecutions.map((entry) => entry.id),
      ...ledger.evidenceReferences.map((entry) => entry.id),
    ];
    uniqueOrCorrupt(identities);
  }
}
