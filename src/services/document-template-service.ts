import type { WorkItem } from '../domain/work-item.js';
import type {
  CurrentStateDocumentPayload,
  EditableDocumentPayload,
  FunctionalAnalysisDocumentPayload,
  ImpactAnalysisDocumentPayload,
  ImplementationPlanDocumentPayload,
  InitializableDocumentType,
  TechnicalAnalysisDocumentPayload,
} from '../domain/work-item-document.js';

const NOT_PROVIDED = '_Not provided._';

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

function normalizeList(values: readonly string[] | undefined): string[] {
  if (values === undefined) {
    return [];
  }

  return [...new Set(values.map(normalizeText).filter((value) => value.length > 0))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function markdownList(values: readonly string[] | undefined): string {
  const normalized = normalizeList(values);
  return normalized.length === 0
    ? NOT_PROVIDED
    : normalized.map((value) => `- ${value}`).join('\n');
}

function markdownText(value: string | undefined): string {
  if (value === undefined) {
    return NOT_PROVIDED;
  }

  const normalized = normalizeText(value);
  return normalized.length === 0 ? NOT_PROVIDED : normalized;
}

function workItemReference(workItem: WorkItem): string[] {
  return [
    '## Work Item',
    '',
    `- ID: ${workItem.id}`,
    `- Rally ID: ${workItem.rallyId}`,
    `- Title: ${workItem.title}`,
    `- Type: ${workItem.type}`,
    `- Status: ${workItem.status}`,
    '',
  ];
}

function workItemDates(workItem: WorkItem): string[] {
  return [
    '## Dates',
    '',
    `- Started at: ${workItem.dates.startedAt}`,
    `- Planned completion at: ${markdownText(workItem.dates.plannedCompletionAt)}`,
    '',
  ];
}

/**
 * Renders only explicit payload values and persisted Work Item facts. It is
 * intentionally filesystem-free and does not infer requirements or outcomes.
 */
export class DocumentTemplateService {
  public renderInitialDocuments(workItem: WorkItem): Record<InitializableDocumentType, string> {
    return {
      CURRENT_STATE: this.renderCurrentState(workItem, {
        documentType: 'CURRENT_STATE',
        knownFacts: [],
      }),
      TECHNICAL_ANALYSIS: this.renderTechnicalAnalysis(workItem, {
        documentType: 'TECHNICAL_ANALYSIS',
        knownFacts: [],
      }),
      IMPACT_ANALYSIS: this.renderImpactAnalysis(workItem, {
        documentType: 'IMPACT_ANALYSIS',
        affectedComponents: [],
      }),
      IMPLEMENTATION_PLAN: this.renderImplementationPlan(workItem, {
        documentType: 'IMPLEMENTATION_PLAN',
        plannedSteps: [],
      }),
    };
  }

  public renderEditableDocument(workItem: WorkItem, payload: EditableDocumentPayload): string {
    switch (payload.documentType) {
      case 'FUNCTIONAL_ANALYSIS':
        return this.renderFunctionalAnalysis(workItem, payload);
      case 'CURRENT_STATE':
        return this.renderCurrentState(workItem, payload);
      case 'TECHNICAL_ANALYSIS':
        return this.renderTechnicalAnalysis(workItem, payload);
      case 'IMPACT_ANALYSIS':
        return this.renderImpactAnalysis(workItem, payload);
      case 'IMPLEMENTATION_PLAN':
        return this.renderImplementationPlan(workItem, payload);
    }
  }

  private renderFunctionalAnalysis(
    workItem: WorkItem,
    payload: FunctionalAnalysisDocumentPayload,
  ): string {
    return [
      '# Functional Analysis',
      '',
      `## ${workItem.title}`,
      '',
      ...workItemReference(workItem),
      '## Functional definition',
      '',
      markdownText(payload.functionalDefinition),
      '',
      '## Acceptance criteria',
      '',
      markdownList(payload.acceptanceCriteria),
      '',
      '## Additional business information',
      '',
      markdownText(payload.additionalBusinessInformation),
      '',
      '## Initially related components',
      '',
      markdownList(payload.relatedComponents),
      '',
      '## Salesforce context',
      '',
      `- Development alias: ${markdownText(payload.developmentAlias)}`,
      '',
      '## Responsibility',
      '',
      markdownText(payload.responsiblePerson),
      '',
      '## Dates',
      '',
      `- Started at: ${markdownText(payload.startedAt)}`,
      `- Planned completion at: ${markdownText(payload.plannedCompletionAt)}`,
      '',
    ].join('\n');
  }

  private renderCurrentState(workItem: WorkItem, payload: CurrentStateDocumentPayload): string {
    return [
      '# Current State',
      '',
      ...workItemReference(workItem),
      '## Persisted Work Item facts',
      '',
      `- Functional definition: ${workItem.functional.definition}`,
      '- Initially related components:',
      markdownList(workItem.initialScope.relatedComponents),
      `- Development alias: ${workItem.salesforce.developmentAlias}`,
      '',
      '## Known implementation context',
      '',
      markdownList(payload.knownFacts),
      '',
      '## Constraints',
      '',
      markdownList(payload.constraints),
      '',
      '## Open questions',
      '',
      markdownList(payload.openQuestions),
      '',
      ...workItemDates(workItem),
    ].join('\n');
  }

  private renderTechnicalAnalysis(
    workItem: WorkItem,
    payload: TechnicalAnalysisDocumentPayload,
  ): string {
    return [
      '# Technical Analysis',
      '',
      ...workItemReference(workItem),
      '## Supplied technical observations',
      '',
      markdownList(payload.knownFacts),
      '',
      '## Declared hypotheses',
      '',
      markdownList(payload.declaredHypotheses),
      '',
      '## Supplied dependencies',
      '',
      markdownList(payload.dependencies),
      '',
      '## Open questions',
      '',
      markdownList(payload.openQuestions),
      '',
    ].join('\n');
  }

  private renderImpactAnalysis(workItem: WorkItem, payload: ImpactAnalysisDocumentPayload): string {
    return [
      '# Impact Analysis',
      '',
      ...workItemReference(workItem),
      '## Affected components',
      '',
      markdownList(payload.affectedComponents),
      '',
      '## Supplied impact statements',
      '',
      markdownList(payload.knownImpacts),
      '',
      '## Open questions',
      '',
      markdownList(payload.openQuestions),
      '',
    ].join('\n');
  }

  private renderImplementationPlan(
    workItem: WorkItem,
    payload: ImplementationPlanDocumentPayload,
  ): string {
    return [
      '# Implementation Plan',
      '',
      ...workItemReference(workItem),
      '## Supplied implementation steps',
      '',
      markdownList(payload.plannedSteps),
      '',
      '## Prerequisites',
      '',
      markdownList(payload.prerequisites),
      '',
      '## Open questions',
      '',
      markdownList(payload.openQuestions),
      '',
    ].join('\n');
  }
}
