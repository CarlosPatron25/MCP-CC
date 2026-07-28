import type { KnowledgeBaseRepository } from './knowledge-base-repository.js';
import type { KnowledgeBaseLedgerService } from './knowledge-base-ledger-service.js';
import { providerForManifest } from './document-rendering.js';

export const KNOWLEDGE_CONTEXT_MAX_BYTES = 16 * 1024;
export const COMBINED_CONTEXT_MAX_BYTES = 32 * 1024;
const KNOWLEDGE_OMISSION_MARKER =
  '- _Contenido adicional de M5 omitido para respetar el límite del contexto._';
const COMBINED_OMISSION_MARKER =
  '\n\n> Additional derived context omitted to respect the combined context limit.\n';

export function boundContextContent(
  content: string,
  maxBytes: number,
  omissionMarker: string,
): string {
  if (Buffer.byteLength(content, 'utf8') <= maxBytes) {
    return content;
  }
  const marker = omissionMarker.endsWith('\n') ? omissionMarker : `${omissionMarker}\n`;
  const selected: string[] = [];
  for (const line of content.split('\n')) {
    const candidate = `${selected.join('\n')}${selected.length === 0 ? '' : '\n'}${line}\n${marker}`;
    if (Buffer.byteLength(candidate, 'utf8') > maxBytes) {
      break;
    }
    selected.push(line);
  }
  return `${selected.join('\n')}\n${marker}`;
}

/**
 * Supplies a bounded deterministic M5 summary only when AI_CONTEXT is
 * explicitly refreshed. It never mutates the knowledge base.
 */
export class KnowledgeContextSummaryService {
  public constructor(
    private readonly repository: KnowledgeBaseRepository,
    private readonly ledgerService: KnowledgeBaseLedgerService,
  ) {}

  public async getContextSummary(workItemId: string): Promise<string | undefined> {
    return this.repository.withSnapshot([workItemId], (snapshot) => {
      if (snapshot.ledgerContent === undefined) {
        return { result: undefined };
      }
      const ledger = this.ledgerService.parse(snapshot.ledgerContent);
      const state = this.ledgerService.projectState(ledger);
      const workflow = state.workItems.find((entry) => entry.workItemId === workItemId);
      const dossier = snapshot.dossiers.get(workItemId);
      if (workflow === undefined || dossier === undefined) {
        return { result: undefined };
      }
      const spanish = providerForManifest(dossier.manifest).profileId === 'ES_ES_V1';
      const sessionIds = new Set(
        state.sessions
          .filter((entry) => entry.workItemId === workItemId)
          .map((entry) => entry.sessionId),
      );
      const relations = state.relations.filter(
        (entry) =>
          entry.status === 'ACTIVE' &&
          (entry.sourceWorkItemId === workItemId || entry.targetWorkItemId === workItemId),
      );
      const components =
        workflow.latestConsolidation?.implementation.components.map((entry) => entry.name) ?? [];
      const openObservations = state.semanticObservations.filter(
        (entry) => entry.workItemId === workItemId && entry.status === 'OPEN',
      );
      const lines = spanish
        ? [
            '## Resumen de conocimiento de Milestone 5',
            '',
            '> Resumen derivado. Solo cambia mediante una actualización explícita del contexto de IA.',
            '',
            `- Estado canónico: ${workflow.status}`,
            `- Iteración: ${workflow.iteration.displayName ?? workflow.iteration.iterationId}`,
            `- Responsable principal declarado: ${workflow.responsible.displayName} (${workflow.responsible.participantId})`,
            `- Colaboradores: ${workflow.collaborators.map((entry) => entry.displayName).join(', ') || 'Ninguno'}`,
            `- Checkpoints de sesión: ${state.checkpoints.filter((entry) => sessionIds.has(entry.sessionId)).length}`,
            `- Relaciones activas: ${relations.length}`,
            `- Observaciones semánticas abiertas: ${openObservations.length}`,
            '',
            '### Componentes consolidados',
            '',
            ...(components.length === 0
              ? ['_Pendiente de consolidación._']
              : components
                  .sort((left, right) => left.localeCompare(right))
                  .map((entry) => `- ${entry}`)),
          ]
        : [
            '## Milestone 5 Knowledge Summary',
            '',
            '> Derived summary. It changes only through an explicit AI-context refresh.',
            '',
            `- Canonical status: ${workflow.status}`,
            `- Iteration: ${workflow.iteration.displayName ?? workflow.iteration.iterationId}`,
            `- Declared principal: ${workflow.responsible.displayName} (${workflow.responsible.participantId})`,
            `- Collaborators: ${workflow.collaborators.map((entry) => entry.displayName).join(', ') || 'None'}`,
            `- Session checkpoints: ${state.checkpoints.filter((entry) => sessionIds.has(entry.sessionId)).length}`,
            `- Active relations: ${relations.length}`,
            `- Open semantic observations: ${openObservations.length}`,
            '',
            '### Consolidated components',
            '',
            ...(components.length === 0
              ? ['_Pending consolidation._']
              : components
                  .sort((left, right) => left.localeCompare(right))
                  .map((entry) => `- ${entry}`)),
          ];
      return {
        result: boundContextContent(
          lines.join('\n') + '\n',
          KNOWLEDGE_CONTEXT_MAX_BYTES,
          KNOWLEDGE_OMISSION_MARKER,
        ),
      };
    });
  }
}

export class CombinedContextSummaryProvider {
  public constructor(
    private readonly providers: ReadonlyArray<{
      getContextSummary(workItemId: string): Promise<string | undefined>;
    }>,
  ) {}

  public async getContextSummary(workItemId: string): Promise<string | undefined> {
    const summaries: string[] = [];
    for (const provider of this.providers) {
      const summary = await provider.getContextSummary(workItemId);
      if (summary !== undefined && summary.trim().length > 0) {
        summaries.push(summary);
      }
    }
    if (summaries.length === 0) {
      return undefined;
    }
    return boundContextContent(
      summaries.map((entry) => entry.trim()).join('\n\n') + '\n',
      COMBINED_CONTEXT_MAX_BYTES,
      COMBINED_OMISSION_MARKER,
    );
  }
}
