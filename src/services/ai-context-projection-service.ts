import type { WorkItem } from '../domain/work-item.js';
import type { DocumentLifecycleMetadata } from '../domain/work-item-document.js';

function markdownList(values: readonly string[] | undefined): string {
  return values === undefined || values.length === 0
    ? '_Not provided._'
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
  ): string {
    const inventory = [...lifecycleMetadata].sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    );

    const m3Projection = [
      '# AI Context',
      '',
      '## Work Item',
      '',
      `- ID: ${workItem.id}`,
      `- Rally ID: ${workItem.rallyId}`,
      `- Title: ${workItem.title}`,
      `- Type: ${workItem.type}`,
      `- Current status: ${workItem.status}`,
      `- Started at: ${workItem.dates.startedAt}`,
      `- Planned completion at: ${workItem.dates.plannedCompletionAt ?? '_Not provided._'}`,
      '',
      '## Initial scope',
      '',
      markdownList(workItem.initialScope.relatedComponents),
      '',
      '## Persisted functional analysis',
      '',
      functionalAnalysis.trim(),
      '',
      '## Managed document lifecycle',
      '',
      '| Document type | Relative path | Status | Revision | Content type |',
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
