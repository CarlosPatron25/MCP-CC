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
import {
  BaselineEnglishDocumentContentProviderV1,
  type DocumentContentProvider,
} from './document-rendering.js';

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

function markdownList(
  values: readonly string[] | undefined,
  provider: DocumentContentProvider,
): string {
  const normalized = normalizeList(values);
  return normalized.length === 0
    ? `_${provider.text('notProvided')}._`
    : normalized.map((value) => `- ${value}`).join('\n');
}

function markdownText(value: string | undefined, provider: DocumentContentProvider): string {
  if (value === undefined) {
    return `_${provider.text('notProvided')}._`;
  }

  const normalized = normalizeText(value);
  return normalized.length === 0 ? `_${provider.text('notProvided')}._` : normalized;
}

function workItemReference(workItem: WorkItem, provider: DocumentContentProvider): string[] {
  return [
    `## ${provider.text('workItem')}`,
    '',
    `- ID: ${workItem.id}`,
    `- ${provider.text('rallyId')}: ${workItem.rallyId}`,
    `- ${provider.text('title')}: ${workItem.title}`,
    `- ${provider.text('type')}: ${workItem.type}`,
    `- ${provider.text('status')}: ${workItem.status}`,
    '',
  ];
}

function workItemDates(workItem: WorkItem, provider: DocumentContentProvider): string[] {
  return [
    `## ${provider.text('dates')}`,
    '',
    `- ${provider.text('startedAt')}: ${workItem.dates.startedAt}`,
    `- ${provider.text('plannedCompletionAt')}: ${markdownText(workItem.dates.plannedCompletionAt, provider)}`,
    '',
  ];
}

/**
 * Renders only explicit payload values and persisted Work Item facts. It is
 * intentionally filesystem-free and does not infer requirements or outcomes.
 */
export class DocumentTemplateService {
  public renderInitialDocuments(
    workItem: WorkItem,
    provider: DocumentContentProvider = new BaselineEnglishDocumentContentProviderV1(),
  ): Record<InitializableDocumentType, string> {
    return {
      CURRENT_STATE: this.renderCurrentState(
        workItem,
        {
          documentType: 'CURRENT_STATE',
          knownFacts: [],
        },
        provider,
      ),
      TECHNICAL_ANALYSIS: this.renderTechnicalAnalysis(
        workItem,
        {
          documentType: 'TECHNICAL_ANALYSIS',
          knownFacts: [],
        },
        provider,
      ),
      IMPACT_ANALYSIS: this.renderImpactAnalysis(
        workItem,
        {
          documentType: 'IMPACT_ANALYSIS',
          affectedComponents: [],
        },
        provider,
      ),
      IMPLEMENTATION_PLAN: this.renderImplementationPlan(
        workItem,
        {
          documentType: 'IMPLEMENTATION_PLAN',
          plannedSteps: [],
        },
        provider,
      ),
    };
  }

  public renderEditableDocument(
    workItem: WorkItem,
    payload: EditableDocumentPayload,
    provider: DocumentContentProvider = new BaselineEnglishDocumentContentProviderV1(),
  ): string {
    switch (payload.documentType) {
      case 'FUNCTIONAL_ANALYSIS':
        return this.renderFunctionalAnalysis(workItem, payload, provider);
      case 'CURRENT_STATE':
        return this.renderCurrentState(workItem, payload, provider);
      case 'TECHNICAL_ANALYSIS':
        return this.renderTechnicalAnalysis(workItem, payload, provider);
      case 'IMPACT_ANALYSIS':
        return this.renderImpactAnalysis(workItem, payload, provider);
      case 'IMPLEMENTATION_PLAN':
        return this.renderImplementationPlan(workItem, payload, provider);
    }
  }

  private renderFunctionalAnalysis(
    workItem: WorkItem,
    payload: FunctionalAnalysisDocumentPayload,
    provider: DocumentContentProvider,
  ): string {
    return [
      `# ${provider.text('functionalAnalysis')}`,
      '',
      `## ${workItem.title}`,
      '',
      ...workItemReference(workItem, provider),
      `## ${provider.text('functionalDefinition')}`,
      '',
      markdownText(payload.functionalDefinition, provider),
      '',
      `## ${provider.text('acceptanceCriteria')}`,
      '',
      markdownList(payload.acceptanceCriteria, provider),
      '',
      `## ${provider.text('additionalBusinessInformation')}`,
      '',
      markdownText(payload.additionalBusinessInformation, provider),
      '',
      `## ${provider.text('initiallyRelatedComponents')}`,
      '',
      markdownList(payload.relatedComponents, provider),
      '',
      `## ${provider.text('salesforceContext')}`,
      '',
      `- ${provider.text('developmentAlias')}: ${markdownText(payload.developmentAlias, provider)}`,
      '',
      `## ${provider.text('responsibility')}`,
      '',
      markdownText(payload.responsiblePerson, provider),
      '',
      `## ${provider.text('dates')}`,
      '',
      `- ${provider.text('startedAt')}: ${markdownText(payload.startedAt, provider)}`,
      `- ${provider.text('plannedCompletionAt')}: ${markdownText(payload.plannedCompletionAt, provider)}`,
      '',
    ].join('\n');
  }

  private renderCurrentState(
    workItem: WorkItem,
    payload: CurrentStateDocumentPayload,
    provider: DocumentContentProvider,
  ): string {
    return [
      `# ${provider.text('currentState')}`,
      '',
      ...workItemReference(workItem, provider),
      `## ${provider.text('persistedWorkItemFacts')}`,
      '',
      `- ${provider.text('functionalDefinition')}: ${workItem.functional.definition}`,
      `- ${provider.text('initiallyRelatedComponents')}:`,
      markdownList(workItem.initialScope.relatedComponents, provider),
      `- ${provider.text('developmentAlias')}: ${workItem.salesforce.developmentAlias}`,
      '',
      `## ${provider.text('knownImplementationContext')}`,
      '',
      markdownList(payload.knownFacts, provider),
      '',
      `## ${provider.text('constraints')}`,
      '',
      markdownList(payload.constraints, provider),
      '',
      `## ${provider.text('openQuestions')}`,
      '',
      markdownList(payload.openQuestions, provider),
      '',
      ...workItemDates(workItem, provider),
    ].join('\n');
  }

  private renderTechnicalAnalysis(
    workItem: WorkItem,
    payload: TechnicalAnalysisDocumentPayload,
    provider: DocumentContentProvider,
  ): string {
    return [
      `# ${provider.text('technicalAnalysis')}`,
      '',
      ...workItemReference(workItem, provider),
      `## ${provider.text('suppliedTechnicalObservations')}`,
      '',
      markdownList(payload.knownFacts, provider),
      '',
      `## ${provider.text('declaredHypotheses')}`,
      '',
      markdownList(payload.declaredHypotheses, provider),
      '',
      `## ${provider.text('suppliedDependencies')}`,
      '',
      markdownList(payload.dependencies, provider),
      '',
      `## ${provider.text('openQuestions')}`,
      '',
      markdownList(payload.openQuestions, provider),
      '',
    ].join('\n');
  }

  private renderImpactAnalysis(
    workItem: WorkItem,
    payload: ImpactAnalysisDocumentPayload,
    provider: DocumentContentProvider,
  ): string {
    return [
      `# ${provider.text('impactAnalysis')}`,
      '',
      ...workItemReference(workItem, provider),
      `## ${provider.text('affectedComponents')}`,
      '',
      markdownList(payload.affectedComponents, provider),
      '',
      `## ${provider.text('suppliedImpactStatements')}`,
      '',
      markdownList(payload.knownImpacts, provider),
      '',
      `## ${provider.text('openQuestions')}`,
      '',
      markdownList(payload.openQuestions, provider),
      '',
    ].join('\n');
  }

  private renderImplementationPlan(
    workItem: WorkItem,
    payload: ImplementationPlanDocumentPayload,
    provider: DocumentContentProvider,
  ): string {
    return [
      `# ${provider.text('implementationPlan')}`,
      '',
      ...workItemReference(workItem, provider),
      `## ${provider.text('suppliedImplementationSteps')}`,
      '',
      markdownList(payload.plannedSteps, provider),
      '',
      `## ${provider.text('prerequisites')}`,
      '',
      markdownList(payload.prerequisites, provider),
      '',
      `## ${provider.text('openQuestions')}`,
      '',
      markdownList(payload.openQuestions, provider),
      '',
    ].join('\n');
  }
}
