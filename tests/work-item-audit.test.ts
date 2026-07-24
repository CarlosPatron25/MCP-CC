import { describe, expect, it } from 'vitest';

import {
  AUDIT_ARTIFACT_RELATIVE_PATHS,
  AUDIT_LEDGER_RELATIVE_PATH,
  AUDIT_OPERATIONS,
  AUDIT_PROJECTION_RELATIVE_PATHS,
  CHECKPOINT_KINDS,
  DECISION_KINDS,
  EXECUTION_METHODS,
  TEST_EXECUTION_OUTCOMES,
  TRACKING_TYPES,
  VERIFICATION_METHODS,
  type AuditLedger,
} from '../src/domain/work-item-audit.js';

describe('Milestone 4 audit domain contracts', () => {
  it('exposes only the frozen closed enumerations', () => {
    expect(DECISION_KINDS).toEqual(['DECISION', 'CORRECTION', 'SUPERSESSION', 'WITHDRAWAL']);
    expect(CHECKPOINT_KINDS).toEqual(['PROGRESS', 'RISK', 'BLOCKER', 'HANDOFF']);
    expect(VERIFICATION_METHODS).toEqual(['MANUAL', 'AUTOMATED']);
    expect(EXECUTION_METHODS).toEqual(['MANUAL', 'AUTOMATED']);
    expect(TEST_EXECUTION_OUTCOMES).toEqual(['PASSED', 'FAILED', 'BLOCKED']);
    expect(TRACKING_TYPES).toEqual(['DECISIONS', 'CHECKPOINTS', 'TESTING', 'EVIDENCE_REFERENCES']);
    expect(AUDIT_OPERATIONS).toEqual([
      'record_decision',
      'record_checkpoint',
      'define_test_plan',
      'record_test_execution',
      'register_evidence_reference',
    ]);
  });

  it('keeps M4 artifact paths separate from the closed M3 document set', () => {
    expect(AUDIT_LEDGER_RELATIVE_PATH).toBe('records/AUDIT_LEDGER.json');
    expect(AUDIT_PROJECTION_RELATIVE_PATHS).toEqual({
      DECISIONS: '06_DECISIONS.md',
      CHECKPOINTS: '07_CHECKPOINTS.md',
      TESTING: '08_TEST_PLAN.md',
      EVIDENCE_REFERENCES: 'evidence/REFERENCES.md',
    });
    expect(AUDIT_ARTIFACT_RELATIVE_PATHS).toHaveLength(5);
    expect(AUDIT_ARTIFACT_RELATIVE_PATHS).not.toContain('09_FINAL_REPORT.md');
  });

  it('models an initialized empty ledger at revision zero', () => {
    const ledger: AuditLedger = {
      schemaVersion: '1.0.0',
      revision: 0,
      updatedAt: '2026-07-24T10:00:00.000Z',
      decisions: [],
      checkpoints: [],
      testPlans: [],
      testExecutions: [],
      evidenceReferences: [],
      idempotencyIndex: [],
    };

    expect(ledger).toMatchObject({ schemaVersion: '1.0.0', revision: 0 });
  });
});
