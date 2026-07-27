import type {
  AuditLedger,
  Checkpoint,
  Decision,
  TestCaseDefinition,
  TestExecution,
  TestPlanVersion,
} from '../domain/work-item-audit.js';
import {
  BaselineEnglishDocumentContentProviderV1,
  type DocumentContentProvider,
} from './document-rendering.js';

export const AUDIT_CONTEXT_MAX_BYTES = 16 * 1024;
export const AUDIT_CONTEXT_OMISSION_MARKER =
  '- _Additional audit entries omitted to keep this summary within the 16 KiB limit._';

const RECENT_CHECKPOINT_LIMIT = 10;

export interface AuditContextSummaryResult {
  content: string;
  byteLength: number;
  truncated: boolean;
}

interface SummarySection {
  heading: string;
  units: readonly string[];
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

function compareRecordedDescending(
  left: { recordedAt: string; id: string },
  right: { recordedAt: string; id: string },
): number {
  return compareText(right.recordedAt, left.recordedAt) || compareText(right.id, left.id);
}

function omitSensitiveLocations(value: string): string {
  return value
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>()]+/giu, '[URL omitted]')
    .replace(/(^|[^\p{L}\p{N}])www\.[^\s<>()]*/giu, '$1[URL omitted]')
    .replace(/(^|[^\p{L}\p{N}])(?![a-z]:[\\/])[a-z][a-z0-9+.-]*:\S+/giu, '$1[URL omitted]')
    .replace(/\b[a-z]:[\\/][^\s<>()\x5b\x5d{},;]+/giu, '[path omitted]')
    .replace(/(^|[^\p{L}\p{N}._/\\-])(?:\\\\|\/\/)[^\s<>()\x5b\x5d{},;:]*/giu, '$1[path omitted]')
    .replace(/(^|[^\p{L}\p{N}._/\\-])[\\/](?![\\/])[^\s<>()\x5b\x5d{},;]*/giu, '$1[path omitted]')
    .replace(/(^|[^\p{L}\p{N}._/\\-])~[\\/][^\s<>()\x5b\x5d{},;]+/giu, '$1[path omitted]')
    .replace(
      /(^|[^\p{L}\p{N}._/\\-])(?:\.{1,2}[\\/])?(?:[^\s\\/<>()\x5b\x5d{},;:]+[\\/])+[^\s\\/<>()\x5b\x5d{},;:]+/gu,
      '$1[path omitted]',
    );
}

function markdownInline(value: string): string {
  const normalized = omitSensitiveLocations(value).replace(/\s+/gu, ' ').trim();
  const markdownCharacters = new Set(['\\', '`', '*', '_', '[', ']', '<', '>', '#', '|']);
  return Array.from(normalized)
    .map((character) => (markdownCharacters.has(character) ? `\\${character}` : character))
    .join('');
}

function markdownCode(value: string): string {
  const normalized = omitSensitiveLocations(value).replace(/\s+/gu, ' ').trim();
  return normalized.includes('`') ? markdownInline(normalized) : `\`${normalized}\``;
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
    .sort(compareRecordedDescending)
    .at(0);
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

function selectCurrentDecisions(decisions: readonly Decision[]): Decision[] {
  return decisions
    .filter((decision) => isCurrentDecision(decision, decisions))
    .sort(compareRecordedDescending);
}

function selectCurrentCheckpoints(checkpoints: readonly Checkpoint[]): Checkpoint[] {
  const correctedIds = new Set(
    checkpoints
      .map((checkpoint) => checkpoint.correctsCheckpointId)
      .filter((id): id is string => id !== undefined),
  );
  return checkpoints
    .filter((checkpoint) => !correctedIds.has(checkpoint.id))
    .sort(compareRecordedDescending);
}

function selectActivePlan(testPlans: readonly TestPlanVersion[]): TestPlanVersion | undefined {
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

function latestExecution(
  plan: TestPlanVersion,
  testCaseId: string,
  executions: readonly TestExecution[],
): TestExecution | undefined {
  return executions
    .filter(
      (execution) =>
        execution.planId === plan.planId &&
        execution.planRevision === plan.planRevision &&
        execution.testCaseId === testCaseId,
    )
    .sort(compareRecordedDescending)
    .at(0);
}

function priorityCheckpointRank(checkpoint: Checkpoint): number {
  return checkpoint.kind === 'BLOCKER' ? 0 : 1;
}

function buildSections(ledger: AuditLedger, provider: DocumentContentProvider): SummarySection[] {
  const currentCheckpointEntries = selectCurrentCheckpoints(ledger.checkpoints);
  const priorityCheckpoints = currentCheckpointEntries
    .filter((checkpoint) => checkpoint.kind === 'BLOCKER' || checkpoint.kind === 'RISK')
    .sort(
      (left, right) =>
        priorityCheckpointRank(left) - priorityCheckpointRank(right) ||
        compareRecordedDescending(left, right),
    );
  const recentCheckpoints = currentCheckpointEntries
    .filter((checkpoint) => checkpoint.kind !== 'BLOCKER' && checkpoint.kind !== 'RISK')
    .slice(0, RECENT_CHECKPOINT_LIMIT);
  const activePlan = selectActivePlan(ledger.testPlans);

  const resultUnits =
    activePlan === undefined
      ? []
      : orderedTestCases(activePlan.testCases).map((testCase) => {
          const execution = latestExecution(activePlan, testCase.testCaseId, ledger.testExecutions);
          const result =
            execution === undefined
              ? `_${provider.text('noTestCaseRun')}_`
              : `${markdownCode(execution.outcome)} — ${markdownInline(execution.summary)} (${markdownInline(execution.recordedAt)})`;
          return `- ${markdownInline(testCase.title)} (${markdownCode(testCase.testCaseId)}): ${result}`;
        });

  return [
    {
      heading: provider.text('priorityRisksAndBlockers'),
      units: priorityCheckpoints.map(
        (checkpoint) =>
          `- ${markdownCode(checkpoint.kind)} ${markdownCode(checkpoint.id)} — ${markdownInline(checkpoint.summary)} (${markdownInline(checkpoint.recordedAt)})`,
      ),
      emptyText: `_${provider.text('noRisksOrBlockers')}_`,
    },
    {
      heading: provider.text('currentDecisions'),
      units: selectCurrentDecisions(ledger.decisions).map(
        (decision) =>
          `- ${markdownInline(decision.title)} (${markdownCode(decision.id)}): ${markdownInline(decision.decision)}`,
      ),
      emptyText: `_${provider.text('noCurrentDecisions')}_`,
    },
    {
      heading: provider.text('activeTestPlan'),
      units:
        activePlan === undefined
          ? []
          : [
              `- ${provider.text('plan')} ${markdownCode(activePlan.planId)}, ${provider.text('revision').toLowerCase()} ${activePlan.planRevision}: ${markdownInline(activePlan.purpose)}`,
            ],
      emptyText: `_${provider.text('noActiveTestPlanRecorded')}_`,
    },
    {
      heading: provider.text('latestResultPerActiveTestCase'),
      units: resultUnits,
      emptyText: `_${provider.text('noActiveTestCases')}_`,
    },
    {
      heading: provider.text('recentCheckpoints'),
      units: recentCheckpoints.map(
        (checkpoint) =>
          `- ${markdownCode(checkpoint.kind)} ${markdownCode(checkpoint.id)} — ${markdownInline(checkpoint.summary)} (${markdownInline(checkpoint.recordedAt)})`,
      ),
      emptyText: `_${provider.text('noRecentCheckpoints')}_`,
    },
    {
      heading: provider.text('evidenceReferencesSummary'),
      units: [...ledger.evidenceReferences]
        .sort(
          (left, right) => compareText(left.label, right.label) || compareText(left.id, right.id),
        )
        .map((reference) => `- ${markdownCode(reference.id)} — ${markdownInline(reference.label)}`),
      emptyText: `_${provider.text('noEvidenceReferencesSummary')}_`,
    },
  ];
}

function renderSummary(
  sections: readonly SummarySection[],
  selectedUnits: readonly ReadonlySet<number>[],
  provider: DocumentContentProvider,
): string {
  const lines = [
    `## ${provider.text('auditSummary')}`,
    '',
    `> ${provider.text('derivedAuditSummary')}`,
  ];

  sections.forEach((section, sectionIndex) => {
    const selected = selectedUnits[sectionIndex] ?? new Set<number>();
    lines.push('', `### ${section.heading}`, '');
    if (section.units.length === 0) {
      lines.push(section.emptyText);
      return;
    }

    section.units.forEach((unit, unitIndex) => {
      if (selected.has(unitIndex)) {
        lines.push(unit);
      }
    });
    if (selected.size < section.units.length) {
      lines.push(
        provider.profileId === 'EN_BASELINE_V1'
          ? AUDIT_CONTEXT_OMISSION_MARKER
          : `- _${provider.text('additionalAuditEntriesOmitted')}_`,
      );
    }
  });

  return `${lines.join('\n').trimEnd()}\n`;
}

function isTruncated(
  sections: readonly SummarySection[],
  selectedUnits: readonly ReadonlySet<number>[],
): boolean {
  return sections.some(
    (section, sectionIndex) => section.units.length > (selectedUnits[sectionIndex]?.size ?? 0),
  );
}

/**
 * Builds the bounded M4-only portion of AI_CONTEXT. Selection priority is the
 * section order: blockers/risks, current decisions, active plan, active-case
 * results, recent checkpoints, and finally evidence labels.
 */
export class AuditContextSummaryService {
  public summarize(
    ledger: AuditLedger,
    provider: DocumentContentProvider = new BaselineEnglishDocumentContentProviderV1(),
  ): AuditContextSummaryResult {
    const sections = buildSections(ledger, provider);
    const selectedUnits = sections.map(() => new Set<number>());

    sections.forEach((section, sectionIndex) => {
      section.units.forEach((_unit, unitIndex) => {
        selectedUnits[sectionIndex]?.add(unitIndex);
        const candidate = renderSummary(sections, selectedUnits, provider);
        if (Buffer.byteLength(candidate, 'utf8') > AUDIT_CONTEXT_MAX_BYTES) {
          selectedUnits[sectionIndex]?.delete(unitIndex);
        }
      });
    });

    const content = renderSummary(sections, selectedUnits, provider);
    return {
      content,
      byteLength: Buffer.byteLength(content, 'utf8'),
      truncated: isTruncated(sections, selectedUnits),
    };
  }

  public project(
    ledger: AuditLedger,
    provider: DocumentContentProvider = new BaselineEnglishDocumentContentProviderV1(),
  ): string {
    return this.summarize(ledger, provider).content;
  }
}
