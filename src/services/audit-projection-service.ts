import type {
  AuditLedger,
  Checkpoint,
  Decision,
  EvidenceReference,
  TestCaseDefinition,
  TestExecution,
  TestPlanVersion,
} from '../domain/work-item-audit.js';
import {
  BaselineEnglishDocumentContentProviderV1,
  type DocumentContentProvider,
} from './document-rendering.js';

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

function optionalText(value: string | undefined, provider: DocumentContentProvider): string {
  return value === undefined || value.trim().length === 0
    ? `_${provider.text('notProvided')}._`
    : markdownInline(value);
}

function identifierList(
  values: readonly string[] | undefined,
  provider: DocumentContentProvider,
): string {
  if (values === undefined || values.length === 0) {
    return `_${provider.text('notProvided')}._`;
  }
  return [...values].sort(compareText).map(markdownCode).join(', ');
}

function renderDocument(
  title: string,
  sections: readonly MarkdownSection[],
  provider: DocumentContentProvider,
): string {
  const lines = [
    provider.text('auditGeneratedNotice'),
    '',
    `# ${title}`,
    '',
    provider.text('auditProtectedNotice'),
  ];

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

function renderDecision(
  decision: Decision,
  status: string,
  provider: DocumentContentProvider,
): string {
  return [
    `### ${markdownInline(decision.title)}`,
    '',
    `- ${provider.text('entryId')}: ${markdownCode(decision.id)}`,
    `- ${provider.text('kind')}: ${markdownCode(decision.kind)}`,
    `- ${provider.text('status')}: ${markdownCode(status)}`,
    `- ${provider.text('decision')}: ${markdownInline(decision.decision)}`,
    `- ${provider.text('rationale')}: ${markdownInline(decision.rationale)}`,
    `- ${provider.text('declaredActor')}: ${markdownInline(decision.declaredActor)}`,
    `- ${provider.text('recordedAt')}: ${markdownInline(decision.recordedAt)}`,
    ...(decision.relatedDecisionId === undefined
      ? []
      : [`- ${provider.text('relatedDecision')}: ${markdownCode(decision.relatedDecisionId)}`]),
    `- ${provider.text('evidenceReferenceIds')}: ${identifierList(decision.evidenceReferenceIds, provider)}`,
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

function renderCheckpoint(
  checkpoint: Checkpoint,
  status: 'CURRENT' | 'CORRECTED',
  provider: DocumentContentProvider,
): string {
  return [
    `### ${checkpoint.kind} — ${markdownCode(checkpoint.id)}`,
    '',
    `- ${provider.text('status')}: ${markdownCode(status)}`,
    `- ${provider.text('summary')}: ${markdownInline(checkpoint.summary)}`,
    `- ${provider.text('declaredActor')}: ${markdownInline(checkpoint.declaredActor)}`,
    `- ${provider.text('recordedAt')}: ${markdownInline(checkpoint.recordedAt)}`,
    ...(checkpoint.correctsCheckpointId === undefined
      ? []
      : [
          `- ${provider.text('correctsCheckpoint')}: ${markdownCode(checkpoint.correctsCheckpointId)}`,
        ]),
    `- ${provider.text('relatedDecisions')}: ${identifierList(checkpoint.relatedDecisionIds, provider)}`,
    `- ${provider.text('evidenceReferenceIds')}: ${identifierList(checkpoint.evidenceReferenceIds, provider)}`,
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

function renderExecution(execution: TestExecution, provider: DocumentContentProvider): string {
  return [
    `- ${markdownCode(execution.outcome)} at ${markdownInline(execution.recordedAt)}`,
    `  - ${provider.text('executionId')}: ${markdownCode(execution.id)}`,
    `  - ${provider.text('method')}: ${markdownCode(execution.executionMethod)}`,
    `  - ${provider.text('summary')}: ${markdownInline(execution.summary)}`,
    `  - ${provider.text('declaredActor')}: ${markdownInline(execution.declaredActor)}`,
    `  - ${provider.text('evidenceReferenceIds')}: ${identifierList(execution.evidenceReferenceIds, provider)}`,
  ].join('\n');
}

function renderTestCase(
  testCase: TestCaseDefinition,
  plan: TestPlanVersion,
  executions: readonly TestExecution[],
  provider: DocumentContentProvider,
): string {
  const caseExecutions = executionsForCase(testCase, plan, executions);
  return [
    `#### ${markdownInline(testCase.title)}`,
    '',
    `- ${provider.text('testCaseId')}: ${markdownCode(testCase.testCaseId)}`,
    `- ${provider.text('objective')}: ${markdownInline(testCase.objective)}`,
    `- ${provider.text('verificationMethod')}: ${markdownCode(testCase.verificationMethod)}`,
    `- ${provider.text('expectedOutcome')}: ${markdownInline(testCase.expectedOutcome)}`,
    '',
    `##### ${provider.text('executions')}`,
    '',
    caseExecutions.length === 0
      ? `_${provider.text('noExecutionsRecorded')}_`
      : caseExecutions.map((execution) => renderExecution(execution, provider)).join('\n\n'),
  ].join('\n');
}

function renderPlan(
  plan: TestPlanVersion,
  executions: readonly TestExecution[],
  status: 'ACTIVE' | 'HISTORICAL',
  provider: DocumentContentProvider,
): string {
  const testCases = orderedTestCases(plan.testCases);
  return [
    `### ${provider.text('planRevision')} ${plan.planRevision}`,
    '',
    `- ${provider.text('versionEntryId')}: ${markdownCode(plan.id)}`,
    `- ${provider.text('planId')}: ${markdownCode(plan.planId)}`,
    `- ${provider.text('status')}: ${markdownCode(status)}`,
    `- ${provider.text('purpose')}: ${markdownInline(plan.purpose)}`,
    `- ${provider.text('declaredActor')}: ${markdownInline(plan.declaredActor)}`,
    `- ${provider.text('recordedAt')}: ${markdownInline(plan.recordedAt)}`,
    '',
    `#### ${provider.text('testCases')}`,
    '',
    testCases.length === 0
      ? `_${provider.text('noTestCasesDefined')}_`
      : testCases
          .map((testCase) => renderTestCase(testCase, plan, executions, provider))
          .join('\n\n'),
  ].join('\n');
}

function renderActivePlanSummary(
  plan: TestPlanVersion,
  executions: readonly TestExecution[],
  provider: DocumentContentProvider,
): string {
  const caseLines = orderedTestCases(plan.testCases).map((testCase) => {
    const latest = executionsForCase(testCase, plan, executions).at(0);
    const result =
      latest === undefined
        ? `_${provider.text('noTestCaseRun')}_`
        : `${markdownCode(latest.outcome)} at ${markdownInline(latest.recordedAt)} (${markdownCode(latest.id)})`;
    return `- ${markdownInline(testCase.title)} (${markdownCode(testCase.testCaseId)}): ${result}`;
  });

  return [
    `### ${provider.text('revision')} ${plan.planRevision}`,
    '',
    `- ${provider.text('planId')}: ${markdownCode(plan.planId)}`,
    `- ${provider.text('purpose')}: ${markdownInline(plan.purpose)}`,
    `- ${provider.text('recordedAt')}: ${markdownInline(plan.recordedAt)}`,
    '',
    `### ${provider.text('latestResultPerActiveTestCase')}`,
    '',
    caseLines.length === 0
      ? `_${provider.text('noActiveTestCasesProjection')}_`
      : caseLines.join('\n'),
  ].join('\n');
}

function renderEvidenceReference(
  reference: EvidenceReference,
  provider: DocumentContentProvider,
): string {
  return [
    `### ${markdownInline(reference.label)}`,
    '',
    `- ${provider.text('evidenceReferenceId')}: ${markdownCode(reference.id)}`,
    `- ${provider.text('description')}: ${optionalText(reference.description, provider)}`,
    `- ${provider.text('logicalPath')}: ${markdownCode(reference.logicalPath)}`,
    `- ${provider.text('declaredActor')}: ${markdownInline(reference.declaredActor)}`,
    `- ${provider.text('recordedAt')}: ${markdownInline(reference.recordedAt)}`,
    `- ${provider.text('validation')}: ${provider.text('metadataReferenceOnly')}`,
  ].join('\n');
}

/**
 * Deterministically regenerates all protected human-readable M4 projections
 * from one already validated audit-ledger snapshot.
 */
export class AuditProjectionService {
  public project(
    ledger: AuditLedger,
    provider: DocumentContentProvider = new BaselineEnglishDocumentContentProviderV1(),
  ): AuditMarkdownProjections {
    return {
      decisions: this.projectDecisions(ledger, provider),
      checkpoints: this.projectCheckpoints(ledger, provider),
      testPlan: this.projectTesting(ledger, provider),
      evidenceReferences: this.projectEvidenceReferences(ledger, provider),
    };
  }

  public projectDecisions(
    ledger: AuditLedger,
    provider: DocumentContentProvider = new BaselineEnglishDocumentContentProviderV1(),
  ): string {
    return renderDocument(
      provider.text('decisions'),
      [
        {
          heading: provider.text('currentDecisions'),
          blocks: currentDecisions(ledger.decisions).map((decision) =>
            renderDecision(decision, 'CURRENT', provider),
          ),
          emptyText: `_${provider.text('noCurrentDecisions')}_`,
        },
        {
          heading: provider.text('appendOnlyDecisionHistory'),
          blocks: [...ledger.decisions]
            .sort(compareRecordedAscending)
            .map((decision) =>
              renderDecision(decision, decisionStatus(decision, ledger.decisions), provider),
            ),
          emptyText: `_${provider.text('noDecisionEntries')}_`,
        },
      ],
      provider,
    );
  }

  public projectCheckpoints(
    ledger: AuditLedger,
    provider: DocumentContentProvider = new BaselineEnglishDocumentContentProviderV1(),
  ): string {
    const corrected = correctedCheckpointIds(ledger.checkpoints);
    return renderDocument(
      provider.text('checkpoints'),
      [
        {
          heading: provider.text('currentCheckpoints'),
          blocks: currentCheckpoints(ledger.checkpoints).map((checkpoint) =>
            renderCheckpoint(checkpoint, 'CURRENT', provider),
          ),
          emptyText: `_${provider.text('noCurrentCheckpoints')}_`,
        },
        {
          heading: provider.text('appendOnlyCheckpointHistory'),
          blocks: [...ledger.checkpoints]
            .sort(compareRecordedAscending)
            .map((checkpoint) =>
              renderCheckpoint(
                checkpoint,
                corrected.has(checkpoint.id) ? 'CORRECTED' : 'CURRENT',
                provider,
              ),
            ),
          emptyText: `_${provider.text('noCheckpointEntries')}_`,
        },
      ],
      provider,
    );
  }

  public projectTesting(
    ledger: AuditLedger,
    provider: DocumentContentProvider = new BaselineEnglishDocumentContentProviderV1(),
  ): string {
    const active = activeTestPlan(ledger.testPlans);
    const orderedPlans = [...ledger.testPlans].sort(
      (left, right) => right.planRevision - left.planRevision || compareText(right.id, left.id),
    );
    return renderDocument(
      provider.text('testPlanAndExecutions'),
      [
        {
          heading: provider.text('activeTestPlan'),
          blocks:
            active === undefined
              ? []
              : [renderActivePlanSummary(active, ledger.testExecutions, provider)],
          emptyText: `_${provider.text('noTestPlanDefined')}_`,
        },
        {
          heading: provider.text('immutablePlanVersionHistory'),
          blocks: orderedPlans.map((plan) =>
            renderPlan(
              plan,
              ledger.testExecutions,
              plan.id === active?.id ? 'ACTIVE' : 'HISTORICAL',
              provider,
            ),
          ),
          emptyText: `_${provider.text('noPlanVersions')}_`,
        },
      ],
      provider,
    );
  }

  public projectEvidenceReferences(
    ledger: AuditLedger,
    provider: DocumentContentProvider = new BaselineEnglishDocumentContentProviderV1(),
  ): string {
    return renderDocument(
      provider.text('evidenceReferences'),
      [
        {
          heading: provider.text('registeredReferences'),
          blocks: [...ledger.evidenceReferences]
            .sort(compareRecordedDescending)
            .map((reference) => renderEvidenceReference(reference, provider)),
          emptyText: `_${provider.text('noEvidenceReferences')}_`,
        },
      ],
      provider,
    );
  }
}
