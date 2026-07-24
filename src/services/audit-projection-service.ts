import type {
  AuditLedger,
  Checkpoint,
  Decision,
  EvidenceReference,
  TestCaseDefinition,
  TestExecution,
  TestPlanVersion,
} from '../domain/work-item-audit.js';

const GENERATED_NOTICE = '<!-- SYSTEM-GENERATED AUDIT PROJECTION. DO NOT EDIT DIRECTLY. -->';
const PROTECTED_NOTICE =
  '> Protected derived projection. The structured audit ledger is the authoritative record.';
const EMPTY_VALUE = '_Not provided._';

export interface AuditMarkdownProjections {
  decisions: string;
  checkpoints: string;
  testPlan: string;
  evidenceReferences: string;
}

interface MarkdownSection {
  heading: string;
  blocks: readonly string[];
  emptyText: string;
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function compareRecordedAscending(
  left: { recordedAt: string; id: string },
  right: { recordedAt: string; id: string },
): number {
  return compareText(left.recordedAt, right.recordedAt) || compareText(left.id, right.id);
}

function compareRecordedDescending(
  left: { recordedAt: string; id: string },
  right: { recordedAt: string; id: string },
): number {
  return compareRecordedAscending(right, left);
}

function markdownInline(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  const markdownCharacters = new Set(['\\', '`', '*', '_', '[', ']', '<', '>', '#', '|']);
  return Array.from(normalized)
    .map((character) => (markdownCharacters.has(character) ? `\\${character}` : character))
    .join('');
}

function markdownCode(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.includes('`') ? markdownInline(normalized) : `\`${normalized}\``;
}

function optionalText(value: string | undefined): string {
  return value === undefined || value.trim().length === 0 ? EMPTY_VALUE : markdownInline(value);
}

function identifierList(values: readonly string[] | undefined): string {
  if (values === undefined || values.length === 0) {
    return EMPTY_VALUE;
  }
  return [...values].sort(compareText).map(markdownCode).join(', ');
}

function renderDocument(title: string, sections: readonly MarkdownSection[]): string {
  const lines = [GENERATED_NOTICE, '', `# ${title}`, '', PROTECTED_NOTICE];

  for (const section of sections) {
    lines.push('', `## ${section.heading}`, '');
    if (section.blocks.length === 0) {
      lines.push(section.emptyText);
    } else {
      lines.push(section.blocks.join('\n\n'));
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function replacementEventFor(
  decisionId: string,
  decisions: readonly Decision[],
): Decision | undefined {
  return decisions
    .filter(
      (entry) =>
        entry.relatedDecisionId === decisionId &&
        (entry.kind === 'SUPERSESSION' || entry.kind === 'WITHDRAWAL'),
    )
    .sort(compareRecordedAscending)
    .at(-1);
}

function decisionStatus(decision: Decision, decisions: readonly Decision[]): string {
  const replacement = replacementEventFor(decision.id, decisions);
  if (replacement?.kind === 'SUPERSESSION') {
    return 'SUPERSEDED';
  }
  if (replacement?.kind === 'WITHDRAWAL') {
    return 'WITHDRAWN';
  }
  if (decision.kind === 'WITHDRAWAL') {
    return 'HISTORICAL_EVENT';
  }
  return isCurrentDecision(decision, decisions) ? 'CURRENT' : 'HISTORICAL_RELATED_ENTRY';
}

function isCurrentDecision(
  decision: Decision,
  decisions: readonly Decision[],
  visited: ReadonlySet<string> = new Set(),
): boolean {
  if (
    decision.kind === 'WITHDRAWAL' ||
    replacementEventFor(decision.id, decisions) !== undefined ||
    visited.has(decision.id)
  ) {
    return false;
  }
  if (decision.kind !== 'CORRECTION' || decision.relatedDecisionId === undefined) {
    return true;
  }

  const related = decisions.find((entry) => entry.id === decision.relatedDecisionId);
  if (related === undefined) {
    return false;
  }
  return isCurrentDecision(related, decisions, new Set([...visited, decision.id]));
}

function currentDecisions(decisions: readonly Decision[]): Decision[] {
  return decisions
    .filter((decision) => isCurrentDecision(decision, decisions))
    .sort(compareRecordedDescending);
}

function renderDecision(decision: Decision, status: string): string {
  return [
    `### ${markdownInline(decision.title)}`,
    '',
    `- Entry ID: ${markdownCode(decision.id)}`,
    `- Kind: ${markdownCode(decision.kind)}`,
    `- Status: ${markdownCode(status)}`,
    `- Decision: ${markdownInline(decision.decision)}`,
    `- Rationale: ${markdownInline(decision.rationale)}`,
    `- Declared actor: ${markdownInline(decision.declaredActor)}`,
    `- Recorded at: ${markdownInline(decision.recordedAt)}`,
    ...(decision.relatedDecisionId === undefined
      ? []
      : [`- Related decision: ${markdownCode(decision.relatedDecisionId)}`]),
    `- Evidence references: ${identifierList(decision.evidenceReferenceIds)}`,
  ].join('\n');
}

function correctedCheckpointIds(checkpoints: readonly Checkpoint[]): ReadonlySet<string> {
  return new Set(
    checkpoints
      .map((checkpoint) => checkpoint.correctsCheckpointId)
      .filter((id): id is string => id !== undefined),
  );
}

function currentCheckpoints(checkpoints: readonly Checkpoint[]): Checkpoint[] {
  const corrected = correctedCheckpointIds(checkpoints);
  return checkpoints
    .filter((checkpoint) => !corrected.has(checkpoint.id))
    .sort(compareRecordedDescending);
}

function renderCheckpoint(checkpoint: Checkpoint, status: 'CURRENT' | 'CORRECTED'): string {
  return [
    `### ${checkpoint.kind} — ${markdownCode(checkpoint.id)}`,
    '',
    `- Status: ${markdownCode(status)}`,
    `- Summary: ${markdownInline(checkpoint.summary)}`,
    `- Declared actor: ${markdownInline(checkpoint.declaredActor)}`,
    `- Recorded at: ${markdownInline(checkpoint.recordedAt)}`,
    ...(checkpoint.correctsCheckpointId === undefined
      ? []
      : [`- Corrects checkpoint: ${markdownCode(checkpoint.correctsCheckpointId)}`]),
    `- Related decisions: ${identifierList(checkpoint.relatedDecisionIds)}`,
    `- Evidence references: ${identifierList(checkpoint.evidenceReferenceIds)}`,
  ].join('\n');
}

function activeTestPlan(testPlans: readonly TestPlanVersion[]): TestPlanVersion | undefined {
  return [...testPlans]
    .sort(
      (left, right) =>
        right.planRevision - left.planRevision ||
        compareText(right.recordedAt, left.recordedAt) ||
        compareText(right.id, left.id),
    )
    .at(0);
}

function orderedTestCases(testCases: readonly TestCaseDefinition[]): TestCaseDefinition[] {
  return [...testCases].sort(
    (left, right) =>
      compareText(left.title, right.title) || compareText(left.testCaseId, right.testCaseId),
  );
}

function executionsForCase(
  testCase: TestCaseDefinition,
  plan: TestPlanVersion,
  executions: readonly TestExecution[],
): TestExecution[] {
  return executions
    .filter(
      (execution) =>
        execution.planId === plan.planId &&
        execution.planRevision === plan.planRevision &&
        execution.testCaseId === testCase.testCaseId,
    )
    .sort(compareRecordedDescending);
}

function renderExecution(execution: TestExecution): string {
  return [
    `- ${markdownCode(execution.outcome)} at ${markdownInline(execution.recordedAt)}`,
    `  - Execution ID: ${markdownCode(execution.id)}`,
    `  - Method: ${markdownCode(execution.executionMethod)}`,
    `  - Summary: ${markdownInline(execution.summary)}`,
    `  - Declared actor: ${markdownInline(execution.declaredActor)}`,
    `  - Evidence references: ${identifierList(execution.evidenceReferenceIds)}`,
  ].join('\n');
}

function renderTestCase(
  testCase: TestCaseDefinition,
  plan: TestPlanVersion,
  executions: readonly TestExecution[],
): string {
  const caseExecutions = executionsForCase(testCase, plan, executions);
  return [
    `#### ${markdownInline(testCase.title)}`,
    '',
    `- Test case ID: ${markdownCode(testCase.testCaseId)}`,
    `- Objective: ${markdownInline(testCase.objective)}`,
    `- Verification method: ${markdownCode(testCase.verificationMethod)}`,
    `- Expected outcome: ${markdownInline(testCase.expectedOutcome)}`,
    '',
    '##### Executions',
    '',
    caseExecutions.length === 0
      ? '_No executions recorded._'
      : caseExecutions.map(renderExecution).join('\n\n'),
  ].join('\n');
}

function renderPlan(
  plan: TestPlanVersion,
  executions: readonly TestExecution[],
  status: 'ACTIVE' | 'HISTORICAL',
): string {
  const testCases = orderedTestCases(plan.testCases);
  return [
    `### Plan revision ${plan.planRevision}`,
    '',
    `- Version entry ID: ${markdownCode(plan.id)}`,
    `- Plan ID: ${markdownCode(plan.planId)}`,
    `- Status: ${markdownCode(status)}`,
    `- Purpose: ${markdownInline(plan.purpose)}`,
    `- Declared actor: ${markdownInline(plan.declaredActor)}`,
    `- Recorded at: ${markdownInline(plan.recordedAt)}`,
    '',
    '#### Test cases',
    '',
    testCases.length === 0
      ? '_No test cases defined._'
      : testCases.map((testCase) => renderTestCase(testCase, plan, executions)).join('\n\n'),
  ].join('\n');
}

function renderActivePlanSummary(
  plan: TestPlanVersion,
  executions: readonly TestExecution[],
): string {
  const caseLines = orderedTestCases(plan.testCases).map((testCase) => {
    const latest = executionsForCase(testCase, plan, executions).at(0);
    const result =
      latest === undefined
        ? '_Not run._'
        : `${markdownCode(latest.outcome)} at ${markdownInline(latest.recordedAt)} (${markdownCode(latest.id)})`;
    return `- ${markdownInline(testCase.title)} (${markdownCode(testCase.testCaseId)}): ${result}`;
  });

  return [
    `### Revision ${plan.planRevision}`,
    '',
    `- Plan ID: ${markdownCode(plan.planId)}`,
    `- Purpose: ${markdownInline(plan.purpose)}`,
    `- Recorded at: ${markdownInline(plan.recordedAt)}`,
    '',
    '### Latest result per active test case',
    '',
    caseLines.length === 0 ? '_No active test cases._' : caseLines.join('\n'),
  ].join('\n');
}

function renderEvidenceReference(reference: EvidenceReference): string {
  return [
    `### ${markdownInline(reference.label)}`,
    '',
    `- Evidence reference ID: ${markdownCode(reference.id)}`,
    `- Description: ${optionalText(reference.description)}`,
    `- Logical path: ${markdownCode(reference.logicalPath)}`,
    `- Declared actor: ${markdownInline(reference.declaredActor)}`,
    `- Recorded at: ${markdownInline(reference.recordedAt)}`,
    '- Validation: Metadata reference only; file existence and content were not checked.',
  ].join('\n');
}

/**
 * Deterministically regenerates all protected human-readable M4 projections
 * from one already validated audit-ledger snapshot.
 */
export class AuditProjectionService {
  public project(ledger: AuditLedger): AuditMarkdownProjections {
    return {
      decisions: this.projectDecisions(ledger),
      checkpoints: this.projectCheckpoints(ledger),
      testPlan: this.projectTesting(ledger),
      evidenceReferences: this.projectEvidenceReferences(ledger),
    };
  }

  public projectDecisions(ledger: AuditLedger): string {
    return renderDocument('Decisions', [
      {
        heading: 'Current decisions',
        blocks: currentDecisions(ledger.decisions).map((decision) =>
          renderDecision(decision, 'CURRENT'),
        ),
        emptyText: '_No current decisions recorded._',
      },
      {
        heading: 'Append-only decision history',
        blocks: [...ledger.decisions]
          .sort(compareRecordedAscending)
          .map((decision) => renderDecision(decision, decisionStatus(decision, ledger.decisions))),
        emptyText: '_No decision entries recorded._',
      },
    ]);
  }

  public projectCheckpoints(ledger: AuditLedger): string {
    const corrected = correctedCheckpointIds(ledger.checkpoints);
    return renderDocument('Checkpoints', [
      {
        heading: 'Current checkpoints',
        blocks: currentCheckpoints(ledger.checkpoints).map((checkpoint) =>
          renderCheckpoint(checkpoint, 'CURRENT'),
        ),
        emptyText: '_No current checkpoints recorded._',
      },
      {
        heading: 'Append-only checkpoint history',
        blocks: [...ledger.checkpoints]
          .sort(compareRecordedAscending)
          .map((checkpoint) =>
            renderCheckpoint(checkpoint, corrected.has(checkpoint.id) ? 'CORRECTED' : 'CURRENT'),
          ),
        emptyText: '_No checkpoint entries recorded._',
      },
    ]);
  }

  public projectTesting(ledger: AuditLedger): string {
    const active = activeTestPlan(ledger.testPlans);
    const orderedPlans = [...ledger.testPlans].sort(
      (left, right) => right.planRevision - left.planRevision || compareText(right.id, left.id),
    );
    return renderDocument('Test Plan and Executions', [
      {
        heading: 'Active test plan',
        blocks:
          active === undefined ? [] : [renderActivePlanSummary(active, ledger.testExecutions)],
        emptyText: '_No test plan has been defined._',
      },
      {
        heading: 'Immutable plan-version history',
        blocks: orderedPlans.map((plan) =>
          renderPlan(plan, ledger.testExecutions, plan.id === active?.id ? 'ACTIVE' : 'HISTORICAL'),
        ),
        emptyText: '_No plan versions recorded._',
      },
    ]);
  }

  public projectEvidenceReferences(ledger: AuditLedger): string {
    return renderDocument('Evidence References', [
      {
        heading: 'Registered references',
        blocks: [...ledger.evidenceReferences]
          .sort(compareRecordedDescending)
          .map(renderEvidenceReference),
        emptyText: '_No evidence references registered._',
      },
    ]);
  }
}
