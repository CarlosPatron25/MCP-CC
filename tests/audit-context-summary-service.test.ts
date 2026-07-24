import { describe, expect, it } from 'vitest';

import type {
  AuditLedger,
  Checkpoint,
  Decision,
  EvidenceReference,
  TestExecution,
  TestPlanVersion,
} from '../src/domain/work-item-audit.js';
import {
  AUDIT_CONTEXT_MAX_BYTES,
  AUDIT_CONTEXT_OMISSION_MARKER,
  AuditContextSummaryService,
} from '../src/services/audit-context-summary-service.js';

function emptyLedger(overrides: Partial<AuditLedger> = {}): AuditLedger {
  return {
    schemaVersion: '1.0.0',
    revision: 0,
    updatedAt: '2026-07-24T10:00:00.000Z',
    decisions: [],
    checkpoints: [],
    testPlans: [],
    testExecutions: [],
    evidenceReferences: [],
    idempotencyIndex: [],
    ...overrides,
  };
}

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'decision-1',
    idempotencyKey: 'decision-key-1',
    kind: 'DECISION',
    title: 'Current decision',
    decision: 'Use the approved implementation.',
    rationale: 'It satisfies the frozen design.',
    declaredActor: 'Reviewer',
    recordedAt: '2026-07-24T10:00:00.000Z',
    ...overrides,
  };
}

function checkpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: 'checkpoint-1',
    idempotencyKey: 'checkpoint-key-1',
    kind: 'PROGRESS',
    summary: 'Implementation is in progress.',
    declaredActor: 'Delivery lead',
    recordedAt: '2026-07-24T11:00:00.000Z',
    ...overrides,
  };
}

function evidence(overrides: Partial<EvidenceReference> = {}): EvidenceReference {
  return {
    id: 'evidence-1',
    idempotencyKey: 'evidence-key-1',
    label: 'Test report',
    description: 'PHYSICAL CONTENT MUST NOT APPEAR',
    logicalPath: 'evidence/private/report.txt',
    declaredActor: 'Tester',
    recordedAt: '2026-07-24T12:00:00.000Z',
    ...overrides,
  };
}

function plan(overrides: Partial<TestPlanVersion> = {}): TestPlanVersion {
  return {
    id: 'plan-version-2',
    planId: 'plan-1',
    planRevision: 2,
    idempotencyKey: 'plan-key-2',
    purpose: 'Validate the active implementation.',
    declaredActor: 'Test lead',
    recordedAt: '2026-07-24T12:00:00.000Z',
    testCases: [
      {
        testCaseId: 'case-active',
        title: 'Active case',
        objective: 'Validate active behavior.',
        verificationMethod: 'AUTOMATED',
        expectedOutcome: 'The active behavior passes.',
      },
    ],
    ...overrides,
  };
}

function execution(overrides: Partial<TestExecution> = {}): TestExecution {
  return {
    id: 'execution-latest',
    idempotencyKey: 'execution-key-latest',
    planId: 'plan-1',
    planRevision: 2,
    testCaseId: 'case-active',
    executionMethod: 'AUTOMATED',
    outcome: 'PASSED',
    summary: 'Latest active result.',
    declaredActor: 'Test runner',
    recordedAt: '2026-07-24T14:00:00.000Z',
    ...overrides,
  };
}

describe('AuditContextSummaryService', () => {
  it('keeps every approved heading for an empty ledger', () => {
    const summary = new AuditContextSummaryService().summarize(emptyLedger());

    expect(summary.truncated).toBe(false);
    expect(summary.byteLength).toBe(Buffer.byteLength(summary.content, 'utf8'));
    expect(summary.content).toContain('## Milestone 4 Audit Summary');
    expect(summary.content).toContain('### Priority risks and blockers');
    expect(summary.content).toContain('### Current decisions');
    expect(summary.content).toContain('### Active test plan');
    expect(summary.content).toContain('### Latest result per active test case');
    expect(summary.content).toContain('### Recent checkpoints');
    expect(summary.content).toContain('### Evidence references');
    expect(summary.content).not.toContain(AUDIT_CONTEXT_OMISSION_MARKER);
  });

  it('includes current audit facts but excludes withdrawn and corrected entries', () => {
    const withdrawn = decision({
      id: 'decision-withdrawn',
      title: 'Withdrawn decision',
      decision: 'This must not remain current.',
    });
    const withdrawal = decision({
      id: 'decision-withdrawal-event',
      idempotencyKey: 'decision-key-withdrawal',
      kind: 'WITHDRAWAL',
      title: 'Withdraw the old decision',
      decision: 'The old decision is withdrawn.',
      relatedDecisionId: withdrawn.id,
      recordedAt: '2026-07-24T11:00:00.000Z',
    });
    const correctionOfWithdrawn = decision({
      id: 'decision-correction',
      idempotencyKey: 'decision-key-correction',
      kind: 'CORRECTION',
      title: 'Correction of withdrawn decision',
      decision: 'This correction must not remain current either.',
      relatedDecisionId: withdrawn.id,
      recordedAt: '2026-07-24T10:30:00.000Z',
    });
    const correctedCheckpoint = checkpoint({
      id: 'checkpoint-corrected',
      summary: 'Obsolete checkpoint summary.',
    });
    const correction = checkpoint({
      id: 'checkpoint-correction',
      idempotencyKey: 'checkpoint-key-correction',
      summary: 'Correct current checkpoint summary.',
      correctsCheckpointId: correctedCheckpoint.id,
      recordedAt: '2026-07-24T12:00:00.000Z',
    });
    const blocker = checkpoint({
      id: 'checkpoint-blocker',
      idempotencyKey: 'checkpoint-key-blocker',
      kind: 'BLOCKER',
      summary: 'A current blocker needs attention.',
      recordedAt: '2026-07-24T13:00:00.000Z',
    });
    const summary = new AuditContextSummaryService().project(
      emptyLedger({
        decisions: [
          withdrawn,
          correctionOfWithdrawn,
          withdrawal,
          decision({ id: 'decision-current' }),
        ],
        checkpoints: [correctedCheckpoint, correction, blocker],
      }),
    );

    expect(summary).toContain('Current decision');
    expect(summary).not.toContain('Withdrawn decision');
    expect(summary).not.toContain('This must not remain current.');
    expect(summary).not.toContain('Correction of withdrawn decision');
    expect(summary).toContain('Correct current checkpoint summary.');
    expect(summary).not.toContain('Obsolete checkpoint summary.');
    expect(summary).toContain('A current blocker needs attention.');
  });

  it('uses only the active plan and the latest execution for each active case', () => {
    const historicalPlan = plan({
      id: 'plan-version-1',
      planRevision: 1,
      idempotencyKey: 'plan-key-1',
      purpose: 'HISTORICAL PLAN MUST NOT APPEAR',
      recordedAt: '2026-07-24T10:00:00.000Z',
      testCases: [
        {
          testCaseId: 'case-historical',
          title: 'Historical case',
          objective: 'Historical objective.',
          verificationMethod: 'MANUAL',
          expectedOutcome: 'Historical result.',
        },
      ],
    });
    const oldActiveExecution = execution({
      id: 'execution-old',
      idempotencyKey: 'execution-key-old',
      outcome: 'FAILED',
      summary: 'OLD ACTIVE RESULT MUST NOT APPEAR',
      recordedAt: '2026-07-24T13:00:00.000Z',
    });
    const historicalExecution = execution({
      id: 'execution-historical',
      idempotencyKey: 'execution-key-historical',
      planRevision: 1,
      testCaseId: 'case-historical',
      summary: 'HISTORICAL EXECUTION MUST NOT APPEAR',
      recordedAt: '2026-07-24T11:00:00.000Z',
    });

    const summary = new AuditContextSummaryService().project(
      emptyLedger({
        testPlans: [plan(), historicalPlan],
        testExecutions: [oldActiveExecution, execution(), historicalExecution],
      }),
    );

    expect(summary).toContain('Validate the active implementation.');
    expect(summary).toContain('Latest active result.');
    expect(summary).toContain('PASSED');
    expect(summary).not.toContain('HISTORICAL PLAN MUST NOT APPEAR');
    expect(summary).not.toContain('OLD ACTIVE RESULT MUST NOT APPEAR');
    expect(summary).not.toContain('HISTORICAL EXECUTION MUST NOT APPEAR');
  });

  it('includes only evidence IDs and labels, never logical paths or descriptions', () => {
    const reference = evidence();
    const summary = new AuditContextSummaryService().project(
      emptyLedger({ evidenceReferences: [reference] }),
    );

    expect(summary).toContain(reference.id);
    expect(summary).toContain(reference.label);
    expect(summary).not.toContain(reference.logicalPath);
    expect(summary).not.toContain(reference.description!);
  });

  it('redacts URLs from every textual summary unit', () => {
    const summary = new AuditContextSummaryService().project(
      emptyLedger({
        decisions: [
          decision({
            decision:
              'See https://internal.example.invalid/decision and C:\\private\\decision.txt for details.',
          }),
        ],
        checkpoints: [
          checkpoint({
            kind: 'RISK',
            summary: 'Tracked at ftp://files.example.invalid/risk.',
          }),
        ],
        testPlans: [
          plan({
            purpose: 'Instructions at www.example.invalid/test-plan.',
          }),
        ],
        testExecutions: [
          execution({
            summary: 'Result at custom+scheme://example.invalid/result.',
          }),
        ],
        evidenceReferences: [
          evidence({
            label: 'mailto:owner@example.invalid',
          }),
        ],
      }),
    );

    expect(summary).toContain('\\[URL omitted\\]');
    expect(summary).not.toMatch(/https?:\/\//u);
    expect(summary).not.toContain('ftp://');
    expect(summary).not.toContain('www.example.invalid');
    expect(summary).not.toContain('custom+scheme://');
    expect(summary).not.toContain('mailto:owner');
    expect(summary).not.toContain('C:\\private');
    expect(summary).toContain('\\[path omitted\\]');
  });

  it('redacts relative logical-path syntax embedded in approved text fields', () => {
    const summary = new AuditContextSummaryService().project(
      emptyLedger({
        decisions: [
          decision({
            decision: 'Inspect src/private/config.ts and path=evidence/private/result.json.',
          }),
        ],
        evidenceReferences: [
          evidence({
            label: 'evidence/private/report.txt',
          }),
        ],
      }),
    );

    expect(summary).not.toContain('src/private/config.ts');
    expect(summary).not.toContain('evidence/private');
    expect(summary).toContain('\\[path omitted\\]');
  });

  it('redacts locations next to punctuation and URN-style resource identifiers', () => {
    const summary = new AuditContextSummaryService().project(
      emptyLedger({
        decisions: [
          decision({
            decision:
              'Inspect [/etc/passwd],src/private/a.txt; urn:secret:value and [https://example.invalid/x].',
          }),
        ],
      }),
    );

    expect(summary).not.toContain('/etc/passwd');
    expect(summary).not.toContain('src/private/a.txt');
    expect(summary).not.toContain('urn:secret:value');
    expect(summary).not.toContain('https://');
    expect(summary).toContain('\\[path omitted\\]');
    expect(summary).toContain('\\[URL omitted\\]');
  });

  it('redacts slash UNC paths and logical paths after arbitrary punctuation', () => {
    const summary = new AuditContextSummaryService().project(
      emptyLedger({
        decisions: [
          decision({
            decision:
              '//server/share/private.txt >src/private/a.txt ]docs/private/b.txt |records/private/c.json *context/private/d.md \\rooted\\private.txt',
          }),
        ],
      }),
    );

    expect(summary).not.toContain('//server/share/private.txt');
    expect(summary).not.toContain('src/private/a.txt');
    expect(summary).not.toContain('docs/private/b.txt');
    expect(summary).not.toContain('records/private/c.json');
    expect(summary).not.toContain('context/private/d.md');
    expect(summary).not.toContain('\\rooted\\private.txt');
    expect(summary.match(/\\\[path omitted\\\]/gu)?.length).toBe(6);
  });

  it('redacts bare roots, incomplete UNC forms, opaque URIs, and prefixed www locations', () => {
    const summary = new AuditContextSummaryService().project(
      emptyLedger({
        decisions: [
          decision({
            decision: '/ \\ ///etc/passwd //server //server/ custom:(secret) _www.example.invalid',
          }),
        ],
      }),
    );

    expect(summary).not.toContain('///etc/passwd');
    expect(summary).not.toContain('//server');
    expect(summary).not.toContain('custom:');
    expect(summary).not.toContain('secret');
    expect(summary).not.toContain('www.example.invalid');
    expect(summary).toContain('\\[path omitted\\]');
    expect(summary).toContain('\\[URL omitted\\]');
  });

  it('redacts relative paths whose components contain Unicode characters', () => {
    const summary = new AuditContextSummaryService().project(
      emptyLedger({
        decisions: [
          decision({
            decision: 'Inspect α\\β.txt and datosñ\\privado\\resultado.json.',
          }),
        ],
      }),
    );

    expect(summary).not.toContain('α');
    expect(summary).not.toContain('datosñ');
    expect(summary).not.toContain('β.txt');
    expect(summary).toContain('\\[path omitted\\]');
  });

  it('redacts URI schemes that do not use a double slash', () => {
    const summary = new AuditContextSummaryService().project(
      emptyLedger({
        decisions: [
          decision({
            decision:
              'Contact tel:+341234567, custom:resource, ssh:user@host and data:text/plain,secret.',
          }),
        ],
      }),
    );

    expect(summary).not.toContain('tel:');
    expect(summary).not.toContain('custom:');
    expect(summary).not.toContain('ssh:');
    expect(summary).not.toContain('data:');
    expect(summary).not.toContain('secret');
    expect(summary).toContain('\\[URL omitted\\]');
  });

  it('enforces 16 KiB by UTF-8 bytes and omits complete semantic units', () => {
    const oversizedText = `BEGIN-OVERSIZED-UNIT ${'á'.repeat(20_000)} END-OVERSIZED-UNIT`;
    const manyEvidence = Array.from({ length: 200 }, (_value, index) =>
      evidence({
        id: `evidence-${String(index).padStart(3, '0')}`,
        idempotencyKey: `evidence-key-${index}`,
        label: `Evidence label ${index} ${'ñ'.repeat(50)}`,
      }),
    );
    const result = new AuditContextSummaryService().summarize(
      emptyLedger({
        decisions: [
          decision({
            title: 'Oversized current decision',
            decision: oversizedText,
          }),
        ],
        evidenceReferences: manyEvidence,
      }),
    );

    expect(result.truncated).toBe(true);
    expect(result.byteLength).toBeLessThanOrEqual(AUDIT_CONTEXT_MAX_BYTES);
    expect(Buffer.byteLength(result.content, 'utf8')).toBe(result.byteLength);
    expect(result.content).toContain(AUDIT_CONTEXT_OMISSION_MARKER);
    expect(result.content).not.toContain('BEGIN-OVERSIZED-UNIT');
    expect(result.content).not.toContain('END-OVERSIZED-UNIT');
    expect(result.content).toContain('### Current decisions');
    expect(result.content).toContain('### Evidence references');
    expect(result.content.endsWith('\n')).toBe(true);
  });

  it('is deterministic even when source arrays are supplied in another order', () => {
    const firstDecision = decision({
      id: 'decision-a',
      title: 'A decision',
      recordedAt: '2026-07-24T10:00:00.000Z',
    });
    const secondDecision = decision({
      id: 'decision-b',
      idempotencyKey: 'decision-key-b',
      title: 'B decision',
      recordedAt: '2026-07-24T11:00:00.000Z',
    });
    const firstEvidence = evidence({ id: 'evidence-a', label: 'A evidence' });
    const secondEvidence = evidence({
      id: 'evidence-b',
      idempotencyKey: 'evidence-key-b',
      label: 'B evidence',
    });
    const service = new AuditContextSummaryService();

    const first = service.project(
      emptyLedger({
        decisions: [firstDecision, secondDecision],
        evidenceReferences: [secondEvidence, firstEvidence],
      }),
    );
    const second = service.project(
      emptyLedger({
        decisions: [secondDecision, firstDecision],
        evidenceReferences: [firstEvidence, secondEvidence],
      }),
    );

    expect(first).toBe(second);
  });
});
