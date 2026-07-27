import type { WorkItem } from '../domain/work-item.js';
import type { DocumentLifecycleMetadata } from '../domain/work-item-document.js';
import {
  BaselineEnglishDocumentContentProviderV1,
  type DocumentContentProvider,
} from './document-rendering.js';

function markdownList(
  values: readonly string[] | undefined,
  provider: DocumentContentProvider,
): string {
  return values === undefined || values.length === 0
    ? `_${provider.text('notProvided')}._`
    : [...values]
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .sort((left, right) => left.localeCompare(right))
        .map((value) => `- ${value}`)
        .join('\n');
}

/**
 * Derives AI_CONTEXT.md from approved persisted facts only. It has no model,
 * chat, network, filesystem, or hidden-state dependency.
 */
export class AIContextProjectionService {
  public project(
    workItem: WorkItem,
    functionalAnalysis: string,
    lifecycleMetadata: readonly DocumentLifecycleMetadata[],
    auditSummary?: string,
    provider: DocumentContentProvider = new BaselineEnglishDocumentContentProviderV1(),
  ): string {
    const inventory = [...lifecycleMetadata].sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    );

    const m3Projection = [
      `# ${provider.text('aiContext')}`,
      '',
      `## ${provider.text('workItem')}`,
      '',
      `- ID: ${workItem.id}`,
      `- ${provider.text('rallyId')}: ${workItem.rallyId}`,
      `- ${provider.text('title')}: ${workItem.title}`,
      `- ${provider.text('type')}: ${workItem.type}`,
      `- ${provider.text('currentStatus')}: ${workItem.status}`,
      `- ${provider.text('startedAt')}: ${workItem.dates.startedAt}`,
      `- ${provider.text('plannedCompletionAt')}: ${workItem.dates.plannedCompletionAt ?? `_${provider.text('notProvided')}._`}`,
      '',
      `## ${provider.text('initialScope')}`,
      '',
      markdownList(workItem.initialScope.relatedComponents, provider),
      '',
      `## ${provider.text('persistedFunctionalAnalysis')}`,
      '',
      functionalAnalysis.trim(),
      '',
      `## ${provider.text('managedDocumentLifecycle')}`,
      '',
      `| ${provider.text('documentType')} | ${provider.text('relativePath')} | ${provider.text('status')} | ${provider.text('revision')} | ${provider.text('contentType')} |`,
      '| --- | --- | --- | --- | --- |',
      ...inventory.map(
        (entry) =>
          `| ${entry.documentType} | ${entry.relativePath} | ${entry.status} | ${entry.revision} | ${entry.contentType} |`,
      ),
      '',
    ].join('\n');
    if (auditSummary === undefined) {
      return m3Projection;
    }
    return `${m3Projection.trimEnd()}\n\n${auditSummary.trim()}\n`;
  }
}
