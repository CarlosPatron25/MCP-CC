import { describe, expect, it } from 'vitest';

import type { AuditLedger } from '../src/domain/work-item-audit.js';
import {
  AuditEntryNotFoundError,
  AuditEntryValidationError,
  AuditIdempotencyConflictError,
  AuditLedgerCorruptError,
  AuditRevisionConflictError,
  EvidenceReferenceDuplicateError,
  TestPlanConflictError,
  TestPlanRevisionConflictError,
} from '../src/errors/workspace-error.js';
import {
  AuditLedgerService,
  canonicalizeAuditPayload,
  fingerprintAuditPayload,
  normalizeEvidenceLogicalPath,
} from '../src/services/audit-ledger-service.js';
import type { Clock } from '../src/services/clock.js';
import type { IdGenerator } from '../src/services/id-generator.js';

class SequenceClock implements Clock {
  public calls = 0;

  public now(): string {
    const timestamp = new Date(Date.UTC(2026, 6, 24, 10, 0, 0, this.calls));
    this.calls += 1;
    return timestamp.toISOString();
  }
}

class SequenceIdGenerator implements IdGenerator {
  public calls = 0;

  public generate(): string {
    this.calls += 1;
    return `00000000-0000-4000-8000-${this.calls.toString().padStart(12, '0')}`;
  }
}

function createService(): {
  service: AuditLedgerService;
  clock: SequenceClock;
  ids: SequenceIdGenerator;
} {
  const clock = new SequenceClock();
  const ids = new SequenceIdGenerator();
  return { service: new AuditLedgerService(clock, ids), clock, ids };
}

function decisionRequest(expectedAuditRevision = 0) {
  return {
    expectedAuditRevision,
    idempotencyKey: 'decision-1',
    kind: 'DECISION',
    title: 'Choose the ledger',
    decision: 'Use structured JSON as the source of truth.',
    rationale: 'Relations and idempotency require structured validation.',
    declaredActor: 'developer',
  } as const;
}

describe('audit canonicalization and evidence path normalization', () => {
  it('canonicalizes object keys recursively and fingerprints with SHA-256', () => {
    const first = { z: 2, nested: { b: true, a: 'value' }, a: [2, 1] };
    const second = { a: [2, 1], nested: { a: 'value', b: true }, z: 2 };

    expect(canonicalizeAuditPayload(first)).toBe(canonicalizeAuditPayload(second));
    expect(fingerprintAuditPayload(first)).toBe(fingerprintAuditPayload(second));
    expect(fingerprintAuditPayload(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintAuditPayload({ a: [1, 2] })).not.toBe(fingerprintAuditPayload({ a: [2, 1] }));
  });

  it('normalizes contained evidence labels without reading a file', () => {
    expect(normalizeEvidenceLogicalPath(' evidence\\manual\\result.txt ')).toBe(
      'evidence/manual/result.txt',
    );
    for (const invalid of [
      '../result.txt',
      'evidence/../result.txt',
      'evidence//result.txt',
      'C:/result.txt',
      'https://example.test/result.txt',
      '/evidence/result.txt',
      'evidence',
    ]) {
      expect(() => normalizeEvidenceLogicalPath(invalid)).toThrow(AuditEntryValidationError);
    }
  });
});

describe('AuditLedgerService codec and integrity', () => {
  it('creates, serializes, and strictly parses an empty ledger deterministically', () => {
    const { service } = createService();
    const ledger = service.createEmptyLedger();
    const serialized = service.serialize(ledger);

    expect(ledger).toEqual({
      schemaVersion: '1.0.0',
      revision: 0,
      updatedAt: '2026-07-24T10:00:00.000Z',
      decisions: [],
      checkpoints: [],
      testPlans: [],
      testExecutions: [],
      evidenceReferences: [],
      idempotencyIndex: [],
    });
    expect(serialized.endsWith('\n')).toBe(true);
    expect(service.parse(serialized)).toEqual(ledger);
    expect(service.serialize(service.parse(serialized))).toBe(serialized);
  });

  it('rejects malformed JSON, unknown fields, and noncanonical persisted values', () => {
    const { service } = createService();
    const ledger = service.createEmptyLedger();

    expect(() => service.parse('{')).toThrow(AuditLedgerCorruptError);
    expect(() => service.parse(JSON.stringify({ ...ledger, futureField: true }))).toThrow(
      AuditLedgerCorruptError,
    );

    const recorded = service.appendDecision(ledger, decisionRequest()).ledger;
    const withWhitespace = structuredClone(recorded);
    withWhitespace.decisions[0]!.title = '  Choose the ledger  ';
    expect(() => service.validate(withWhitespace)).toThrow(AuditLedgerCorruptError);
  });

  it('detects revision, index, fingerprint, and identity corruption', () => {
    const { service } = createService();
    const recorded = service.appendDecision(service.createEmptyLedger(), decisionRequest()).ledger;

    const cases: AuditLedger[] = [];
    cases.push({ ...recorded, revision: 2 });
    cases.push({ ...recorded, idempotencyIndex: [] });
    const fingerprint = structuredClone(recorded);
    fingerprint.idempotencyIndex[0]!.payloadFingerprint = '0'.repeat(64);
    cases.push(fingerprint);
    const unknownEntryField = JSON.parse(service.serialize(recorded)) as Record<string, unknown>;
    (
      (unknownEntryField.decisions as Array<Record<string, unknown>>)[0] as Record<string, unknown>
    ).future = true;

    for (const corrupt of cases) {
      expect(() => service.validate(corrupt)).toThrow(AuditLedgerCorruptError);
    }
    expect(() => service.parse(JSON.stringify(unknownEntryField))).toThrow(AuditLedgerCorruptError);
  });
});

describe('AuditLedgerService immutable append behavior', () => {
  it('resolves exact idempotent retries before stale revisions without new time or IDs', () => {
    const { service, clock, ids } = createService();
    const empty = service.createEmptyLedger();
    const first = service.appendDecision(empty, decisionRequest());
    const later = service.appendCheckpoint(first.ledger, {
      expectedAuditRevision: 1,
      idempotencyKey: 'checkpoint-1',
      kind: 'PROGRESS',
      summary: 'The decision was recorded.',
      declaredActor: 'developer',
    });
    const clockCalls = clock.calls;
    const idCalls = ids.calls;

    const retry = service.appendDecision(later.ledger, decisionRequest());

    expect(retry).toMatchObject({
      entry: first.entry,
      auditRevision: 1,
      idempotent: true,
    });
    expect(retry.ledger).toBe(later.ledger);
    expect(clock.calls).toBe(clockCalls);
    expect(ids.calls).toBe(idCalls);
    expect(empty.revision).toBe(0);
  });

  it('rejects incompatible key reuse before a stale revision', () => {
    const { service } = createService();
    const first = service.appendDecision(service.createEmptyLedger(), decisionRequest());

    expect(() => service.appendDecision(first.ledger, decisionRequest(99))).toThrow(
      AuditIdempotencyConflictError,
    );
    expect(() =>
      service.appendDecision(first.ledger, {
        ...decisionRequest(99),
        title: 'A different payload',
      }),
    ).toThrow(AuditIdempotencyConflictError);
    expect(() =>
      service.appendCheckpoint(first.ledger, {
        expectedAuditRevision: 99,
        idempotencyKey: 'decision-1',
        kind: 'PROGRESS',
        summary: 'Another operation.',
        declaredActor: 'developer',
      }),
    ).toThrow(AuditIdempotencyConflictError);
  });

  it('rejects stale revisions, unknown fields, and missing related entries', () => {
    const { service } = createService();
    const ledger = service.createEmptyLedger();

    expect(() => service.appendDecision(ledger, decisionRequest(1))).toThrow(
      AuditRevisionConflictError,
    );
    expect(() => service.appendDecision(ledger, { ...decisionRequest(), future: true })).toThrow(
      AuditEntryValidationError,
    );
    expect(() =>
      service.appendDecision(ledger, {
        ...decisionRequest(),
        kind: 'CORRECTION',
        relatedDecisionId: '00000000-0000-4000-8000-000000000999',
      }),
    ).toThrow(AuditEntryNotFoundError);
  });

  it('rejects absolute locations before they can enter the ledger or a projection', () => {
    const { service } = createService();
    const ledger = service.createEmptyLedger();

    for (const absoluteLocation of [
      '/etc/passwd',
      'C:\\private\\audit.txt',
      '\\\\server\\share\\audit.txt',
      '//server/share/audit.txt',
      '\\rooted\\audit.txt',
      'file:///private/audit.txt',
      'https://internal.example.invalid/audit',
      '~/private/audit.txt',
      'see|/etc/passwd',
      'see]/etc/passwd',
      'see>/etc/passwd',
      '**/etc/passwd',
      '/',
      '\\',
      'custom:(secret)',
      '_www.example.invalid',
    ]) {
      expect(() =>
        service.appendDecision(ledger, {
          ...decisionRequest(),
          decision: `Inspect ${absoluteLocation} before continuing.`,
        }),
      ).toThrow(AuditEntryValidationError);
    }
  });

  it('classifies a generated UUID collision as request validation, not persisted corruption', () => {
    const repeatedId = '00000000-0000-4000-8000-000000000001';
    const service = new AuditLedgerService(new SequenceClock(), {
      generate: () => repeatedId,
    });
    const first = service.appendDecision(service.createEmptyLedger(), decisionRequest());

    expect(() =>
      service.appendCheckpoint(first.ledger, {
        expectedAuditRevision: 1,
        idempotencyKey: 'checkpoint-colliding-id',
        kind: 'PROGRESS',
        summary: 'The injected generator repeats an existing ID.',
        declaredActor: 'developer',
      }),
    ).toThrow(AuditEntryValidationError);
  });

  it('records evidence, decisions, corrections, checkpoints, plans, and executions', () => {
    const { service } = createService();
    const empty = service.createEmptyLedger();
    const evidence = service.appendEvidenceReference(empty, {
      expectedAuditRevision: 0,
      idempotencyKey: 'evidence-1',
      label: 'Automated output',
      logicalPath: 'evidence\\automated\\result.json',
      declaredActor: 'developer',
    });
    const decision = service.appendDecision(evidence.ledger, {
      ...decisionRequest(1),
      evidenceReferenceIds: [evidence.entry.id],
    });
    const correction = service.appendDecision(decision.ledger, {
      expectedAuditRevision: 2,
      idempotencyKey: 'decision-2',
      kind: 'CORRECTION',
      title: 'Clarify the ledger decision',
      decision: 'The JSON ledger is append-only.',
      rationale: 'Clarification preserves the original entry.',
      declaredActor: 'developer',
      relatedDecisionId: decision.entry.id,
    });
    const checkpoint = service.appendCheckpoint(correction.ledger, {
      expectedAuditRevision: 3,
      idempotencyKey: 'checkpoint-1',
      kind: 'BLOCKER',
      summary: 'Manual validation is still pending.',
      declaredActor: 'developer',
      relatedDecisionIds: [decision.entry.id],
    });
    const plan = service.appendTestPlan(checkpoint.ledger, {
      expectedAuditRevision: 4,
      expectedPlanRevision: 0,
      idempotencyKey: 'plan-1',
      purpose: 'Validate Milestone 4.',
      declaredActor: 'developer',
      testCases: [
        {
          title: 'Validate ledger',
          objective: 'Confirm append-only persistence.',
          verificationMethod: 'AUTOMATED',
          expectedOutcome: 'The ledger remains valid.',
        },
      ],
    });
    const execution = service.appendTestExecution(plan.ledger, {
      expectedAuditRevision: 5,
      expectedPlanRevision: 1,
      idempotencyKey: 'execution-1',
      planId: plan.entry.planId,
      planRevision: 1,
      testCaseId: plan.entry.testCases[0]!.testCaseId,
      executionMethod: 'AUTOMATED',
      outcome: 'PASSED',
      summary: 'The ledger validation passed.',
      declaredActor: 'developer',
      evidenceReferenceIds: [evidence.entry.id],
    });
    const plan2 = service.appendTestPlan(execution.ledger, {
      expectedAuditRevision: 6,
      expectedPlanRevision: 1,
      idempotencyKey: 'plan-2',
      planId: plan.entry.planId,
      purpose: 'Validate Milestone 4 after refinement.',
      declaredActor: 'developer',
      testCases: [
        {
          title: 'Validate refined ledger',
          objective: 'Confirm the active version.',
          verificationMethod: 'MANUAL',
          expectedOutcome: 'The active version is confirmed.',
        },
      ],
    });

    expect(plan2.ledger).toMatchObject({
      revision: 7,
      updatedAt: plan2.entry.recordedAt,
    });
    expect(plan2.ledger.decisions).toHaveLength(2);
    expect(plan2.ledger.checkpoints).toHaveLength(1);
    expect(plan2.ledger.testPlans.map((entry) => entry.planRevision)).toEqual([1, 2]);
    expect(plan2.ledger.testExecutions).toEqual([execution.entry]);
    expect(plan2.ledger.evidenceReferences[0]!.logicalPath).toBe('evidence/automated/result.json');
    expect(service.parse(service.serialize(plan2.ledger))).toEqual(plan2.ledger);

    expect(() =>
      service.appendTestExecution(plan2.ledger, {
        expectedAuditRevision: 7,
        expectedPlanRevision: 1,
        idempotencyKey: 'execution-old',
        planId: plan.entry.planId,
        planRevision: 1,
        testCaseId: plan.entry.testCases[0]!.testCaseId,
        executionMethod: 'AUTOMATED',
        outcome: 'PASSED',
        summary: 'Attempt against a superseded version.',
        declaredActor: 'developer',
      }),
    ).toThrow(TestPlanRevisionConflictError);
  });

  it('enforces one logical plan, current plan revisions, and exact active cases', () => {
    const { service } = createService();
    const empty = service.createEmptyLedger();

    expect(() =>
      service.appendTestPlan(empty, {
        expectedAuditRevision: 0,
        expectedPlanRevision: 0,
        idempotencyKey: 'plan-client-id',
        planId: '00000000-0000-4000-8000-000000000999',
        purpose: 'Invalid first plan.',
        declaredActor: 'developer',
        testCases: [
          {
            title: 'Case',
            objective: 'Objective',
            verificationMethod: 'MANUAL',
            expectedOutcome: 'Outcome',
          },
        ],
      }),
    ).toThrow(TestPlanConflictError);

    const plan = service.appendTestPlan(empty, {
      expectedAuditRevision: 0,
      expectedPlanRevision: 0,
      idempotencyKey: 'plan-1',
      purpose: 'Valid plan.',
      declaredActor: 'developer',
      testCases: [
        {
          title: 'Case',
          objective: 'Objective',
          verificationMethod: 'MANUAL',
          expectedOutcome: 'Outcome',
        },
      ],
    });
    expect(() =>
      service.appendTestPlan(plan.ledger, {
        expectedAuditRevision: 1,
        expectedPlanRevision: 1,
        idempotencyKey: 'plan-2',
        purpose: 'Missing logical plan identity.',
        declaredActor: 'developer',
        testCases: [
          {
            title: 'Case 2',
            objective: 'Objective',
            verificationMethod: 'MANUAL',
            expectedOutcome: 'Outcome',
          },
        ],
      }),
    ).toThrow(TestPlanConflictError);
  });

  it('rejects duplicate evidence paths but treats an exact retry as idempotent', () => {
    const { service } = createService();
    const request = {
      expectedAuditRevision: 0,
      idempotencyKey: 'evidence-1',
      label: 'Output',
      logicalPath: 'evidence/output.txt',
      declaredActor: 'developer',
    };
    const first = service.appendEvidenceReference(service.createEmptyLedger(), request);

    expect(service.appendEvidenceReference(first.ledger, request).idempotent).toBe(true);
    expect(() =>
      service.appendEvidenceReference(first.ledger, {
        ...request,
        expectedAuditRevision: 999,
      }),
    ).toThrow(AuditIdempotencyConflictError);
    expect(() =>
      service.appendEvidenceReference(first.ledger, {
        ...request,
        expectedAuditRevision: 1,
        idempotencyKey: 'evidence-2',
      }),
    ).toThrow(EvidenceReferenceDuplicateError);
  });
});
