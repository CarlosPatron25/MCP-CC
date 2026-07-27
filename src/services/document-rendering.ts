import { DocumentRenderingSnapshotInvalidError } from '../errors/workspace-error.js';

export type DocumentLanguageCode = 'es-ES';
export type DocumentRenderingProfileId = 'ES_ES_V1' | 'EN_BASELINE_V1';

export interface DocumentRenderingSnapshotV1 {
  schemaVersion: '1.0.0';
  documentLanguage: DocumentLanguageCode;
  renderingProfile: 'ES_ES_V1';
}

export type GeneratedArtifactKind =
  | 'WORKSPACE_README'
  | 'MANIFEST'
  | 'FUNCTIONAL_ANALYSIS'
  | 'CURRENT_STATE'
  | 'TECHNICAL_ANALYSIS'
  | 'IMPACT_ANALYSIS'
  | 'IMPLEMENTATION_PLAN'
  | 'AI_CONTEXT'
  | 'AI_RULES'
  | 'NEXT_TASK'
  | 'AUDIT_DECISIONS'
  | 'AUDIT_CHECKPOINTS'
  | 'AUDIT_TEST_PLAN'
  | 'AUDIT_EVIDENCE_REFERENCES'
  | 'AUDIT_CONTEXT_SUMMARY';

export const GENERATED_ARTIFACT_KINDS: readonly GeneratedArtifactKind[] = [
  'WORKSPACE_README',
  'MANIFEST',
  'FUNCTIONAL_ANALYSIS',
  'CURRENT_STATE',
  'TECHNICAL_ANALYSIS',
  'IMPACT_ANALYSIS',
  'IMPLEMENTATION_PLAN',
  'AI_CONTEXT',
  'AI_RULES',
  'NEXT_TASK',
  'AUDIT_DECISIONS',
  'AUDIT_CHECKPOINTS',
  'AUDIT_TEST_PLAN',
  'AUDIT_EVIDENCE_REFERENCES',
  'AUDIT_CONTEXT_SUMMARY',
] as const;

export type DocumentTextKey =
  | 'workspaceTitle'
  | 'workspaceManaged'
  | 'workspaceContents'
  | 'workspaceSafety'
  | 'manifestTitle'
  | 'workItem'
  | 'workItemId'
  | 'rallyId'
  | 'title'
  | 'type'
  | 'status'
  | 'createdAt'
  | 'schemaVersion'
  | 'createdDocuments'
  | 'createdDirectories'
  | 'initialStatus'
  | 'functionalAnalysis'
  | 'functionalDefinition'
  | 'acceptanceCriteria'
  | 'additionalBusinessInformation'
  | 'initiallyRelatedComponents'
  | 'salesforceContext'
  | 'developmentAlias'
  | 'responsibility'
  | 'dates'
  | 'startedAt'
  | 'plannedCompletionAt'
  | 'aiContext'
  | 'currentStatus'
  | 'knownFunctionalContext'
  | 'initialScope'
  | 'currentBoundary'
  | 'noTechnicalDecisions'
  | 'aiRules'
  | 'aiRuleOne'
  | 'aiRuleTwo'
  | 'aiRuleThree'
  | 'aiRuleFour'
  | 'aiRuleFive'
  | 'nextTask'
  | 'nextTaskInstruction'
  | 'currentState'
  | 'persistedFunctionalAnalysis'
  | 'persistedWorkItemFacts'
  | 'knownImplementationContext'
  | 'constraints'
  | 'openQuestions'
  | 'technicalAnalysis'
  | 'suppliedTechnicalObservations'
  | 'declaredHypotheses'
  | 'suppliedDependencies'
  | 'impactAnalysis'
  | 'affectedComponents'
  | 'suppliedImpactStatements'
  | 'implementationPlan'
  | 'suppliedImplementationSteps'
  | 'prerequisites'
  | 'notProvided'
  | 'managedDocumentLifecycle'
  | 'documentType'
  | 'relativePath'
  | 'revision'
  | 'contentType'
  | 'auditGeneratedNotice'
  | 'auditProtectedNotice'
  | 'decisions'
  | 'checkpoints'
  | 'testPlanAndExecutions'
  | 'evidenceReferences'
  | 'evidenceReferencesSummary'
  | 'currentDecisions'
  | 'appendOnlyDecisionHistory'
  | 'noCurrentDecisions'
  | 'noDecisionEntries'
  | 'entryId'
  | 'kind'
  | 'decision'
  | 'rationale'
  | 'declaredActor'
  | 'recordedAt'
  | 'relatedDecision'
  | 'evidenceReferenceIds'
  | 'currentCheckpoints'
  | 'appendOnlyCheckpointHistory'
  | 'noCurrentCheckpoints'
  | 'noCheckpointEntries'
  | 'summary'
  | 'correctsCheckpoint'
  | 'relatedDecisions'
  | 'activeTestPlan'
  | 'immutablePlanVersionHistory'
  | 'noTestPlanDefined'
  | 'noPlanVersions'
  | 'planRevision'
  | 'plan'
  | 'versionEntryId'
  | 'planId'
  | 'purpose'
  | 'testCases'
  | 'noTestCasesDefined'
  | 'testCaseId'
  | 'objective'
  | 'verificationMethod'
  | 'expectedOutcome'
  | 'executions'
  | 'executionId'
  | 'method'
  | 'noExecutionsRecorded'
  | 'latestResultPerActiveTestCase'
  | 'noActiveTestCases'
  | 'noActiveTestCasesProjection'
  | 'noTestCaseRun'
  | 'registeredReferences'
  | 'noEvidenceReferences'
  | 'noEvidenceReferencesSummary'
  | 'evidenceReferenceId'
  | 'description'
  | 'logicalPath'
  | 'validation'
  | 'metadataReferenceOnly'
  | 'auditSummary'
  | 'derivedAuditSummary'
  | 'priorityRisksAndBlockers'
  | 'noRisksOrBlockers'
  | 'noActiveTestPlanRecorded'
  | 'recentCheckpoints'
  | 'noRecentCheckpoints'
  | 'additionalAuditEntriesOmitted';

export interface DocumentContentProvider {
  readonly profileId: DocumentRenderingProfileId;
  readonly generatedArtifactKinds: readonly GeneratedArtifactKind[];
  text(key: DocumentTextKey): string;
}

const ENGLISH_TEXT: Record<DocumentTextKey, string> = {
  workspaceTitle: 'WS Workspace',
  workspaceManaged: 'This directory is managed by WS Workspace MCP.',
  workspaceContents: 'It contains active and archived work-item documentation.',
  workspaceSafety: 'Do not place credentials, corporate source code or production data here.',
  manifestTitle: 'Work Item Manifest',
  workItem: 'Work Item',
  workItemId: 'Work Item ID',
  rallyId: 'Rally ID',
  title: 'Title',
  type: 'Type',
  status: 'Status',
  createdAt: 'Created at',
  schemaVersion: 'Schema version',
  createdDocuments: 'Created documents',
  createdDirectories: 'Created directories',
  initialStatus: 'Initial status',
  functionalAnalysis: 'Functional Analysis',
  functionalDefinition: 'Functional definition',
  acceptanceCriteria: 'Acceptance criteria',
  additionalBusinessInformation: 'Additional business information',
  initiallyRelatedComponents: 'Initially related components',
  salesforceContext: 'Salesforce context',
  developmentAlias: 'Development alias',
  responsibility: 'Responsibility',
  dates: 'Dates',
  startedAt: 'Started at',
  plannedCompletionAt: 'Planned completion at',
  aiContext: 'AI Context',
  currentStatus: 'Current status',
  knownFunctionalContext: 'Known functional context',
  initialScope: 'Initial scope',
  currentBoundary: 'Current boundary',
  noTechnicalDecisions: 'No technical implementation decisions have been recorded yet.',
  aiRules: 'AI Rules',
  aiRuleOne: 'Do not invent requirements or missing business information.',
  aiRuleTwo: 'Preserve traceability to the Work Item and its supplied context.',
  aiRuleThree:
    'Record relevant decisions in the dossier when the appropriate lifecycle tool exists.',
  aiRuleFour: 'Do not modify files outside this Work Item dossier.',
  aiRuleFive: 'Keep dossier documents current as verified information becomes available.',
  nextTask: 'Next Task',
  nextTaskInstruction:
    'Review the supplied functional context and identify open questions before making technical decisions.',
  currentState: 'Current State',
  persistedFunctionalAnalysis: 'Persisted functional analysis',
  persistedWorkItemFacts: 'Persisted Work Item facts',
  knownImplementationContext: 'Known implementation context',
  constraints: 'Constraints',
  openQuestions: 'Open questions',
  technicalAnalysis: 'Technical Analysis',
  suppliedTechnicalObservations: 'Supplied technical observations',
  declaredHypotheses: 'Declared hypotheses',
  suppliedDependencies: 'Supplied dependencies',
  impactAnalysis: 'Impact Analysis',
  affectedComponents: 'Affected components',
  suppliedImpactStatements: 'Supplied impact statements',
  implementationPlan: 'Implementation Plan',
  suppliedImplementationSteps: 'Supplied implementation steps',
  prerequisites: 'Prerequisites',
  notProvided: 'Not provided',
  managedDocumentLifecycle: 'Managed document lifecycle',
  documentType: 'Document type',
  relativePath: 'Relative path',
  revision: 'Revision',
  contentType: 'Content type',
  auditGeneratedNotice: '<!-- SYSTEM-GENERATED AUDIT PROJECTION. DO NOT EDIT DIRECTLY. -->',
  auditProtectedNotice:
    '> Protected derived projection. The structured audit ledger is the authoritative record.',
  decisions: 'Decisions',
  checkpoints: 'Checkpoints',
  testPlanAndExecutions: 'Test Plan and Executions',
  evidenceReferences: 'Evidence References',
  evidenceReferencesSummary: 'Evidence references',
  currentDecisions: 'Current decisions',
  appendOnlyDecisionHistory: 'Append-only decision history',
  noCurrentDecisions: 'No current decisions recorded.',
  noDecisionEntries: 'No decision entries recorded.',
  entryId: 'Entry ID',
  kind: 'Kind',
  decision: 'Decision',
  rationale: 'Rationale',
  declaredActor: 'Declared actor',
  recordedAt: 'Recorded at',
  relatedDecision: 'Related decision',
  evidenceReferenceIds: 'Evidence references',
  currentCheckpoints: 'Current checkpoints',
  appendOnlyCheckpointHistory: 'Append-only checkpoint history',
  noCurrentCheckpoints: 'No current checkpoints recorded.',
  noCheckpointEntries: 'No checkpoint entries recorded.',
  summary: 'Summary',
  correctsCheckpoint: 'Corrects checkpoint',
  relatedDecisions: 'Related decisions',
  activeTestPlan: 'Active test plan',
  immutablePlanVersionHistory: 'Immutable plan-version history',
  noTestPlanDefined: 'No test plan has been defined.',
  noPlanVersions: 'No plan versions recorded.',
  planRevision: 'Plan revision',
  plan: 'Plan',
  versionEntryId: 'Version entry ID',
  planId: 'Plan ID',
  purpose: 'Purpose',
  testCases: 'Test cases',
  noTestCasesDefined: 'No test cases defined.',
  testCaseId: 'Test case ID',
  objective: 'Objective',
  verificationMethod: 'Verification method',
  expectedOutcome: 'Expected outcome',
  executions: 'Executions',
  executionId: 'Execution ID',
  method: 'Method',
  noExecutionsRecorded: 'No executions recorded.',
  latestResultPerActiveTestCase: 'Latest result per active test case',
  noActiveTestCases: 'No active test cases recorded.',
  noActiveTestCasesProjection: 'No active test cases.',
  noTestCaseRun: 'Not run.',
  registeredReferences: 'Registered references',
  noEvidenceReferences: 'No evidence references registered.',
  noEvidenceReferencesSummary: 'No evidence references recorded.',
  evidenceReferenceId: 'Evidence reference ID',
  description: 'Description',
  logicalPath: 'Logical path',
  validation: 'Validation',
  metadataReferenceOnly: 'Metadata reference only; file existence and content were not checked.',
  auditSummary: 'Milestone 4 Audit Summary',
  derivedAuditSummary:
    'Derived audit summary. It changes only through an explicit AI-context refresh.',
  priorityRisksAndBlockers: 'Priority risks and blockers',
  noRisksOrBlockers: 'No current risks or blockers recorded.',
  noActiveTestPlanRecorded: 'No active test plan recorded.',
  recentCheckpoints: 'Recent checkpoints',
  noRecentCheckpoints: 'No recent progress or handoff checkpoints recorded.',
  additionalAuditEntriesOmitted:
    'Additional audit entries omitted to keep this summary within the 16 KiB limit.',
};

const SPANISH_TEXT: Record<DocumentTextKey, string> = {
  workspaceTitle: 'WS Workspace',
  workspaceManaged: 'Este directorio está gestionado por WS Workspace MCP.',
  workspaceContents: 'Contiene documentación de Work Items activos y archivados.',
  workspaceSafety: 'No guarde credenciales, código fuente corporativo ni datos de producción aquí.',
  manifestTitle: 'Manifiesto del Work Item',
  workItem: 'Work Item',
  workItemId: 'ID del Work Item',
  rallyId: 'ID de Rally',
  title: 'Título',
  type: 'Tipo',
  status: 'Estado',
  createdAt: 'Creado el',
  schemaVersion: 'Versión de esquema',
  createdDocuments: 'Documentos creados',
  createdDirectories: 'Directorios creados',
  initialStatus: 'Estado inicial',
  functionalAnalysis: 'Análisis funcional',
  functionalDefinition: 'Definición funcional',
  acceptanceCriteria: 'Criterios de aceptación',
  additionalBusinessInformation: 'Información adicional de negocio',
  initiallyRelatedComponents: 'Componentes relacionados inicialmente',
  salesforceContext: 'Contexto de Salesforce',
  developmentAlias: 'Alias de desarrollo',
  responsibility: 'Responsabilidad',
  dates: 'Fechas',
  startedAt: 'Inicio',
  plannedCompletionAt: 'Finalización planificada',
  aiContext: 'Contexto de IA',
  currentStatus: 'Estado actual',
  knownFunctionalContext: 'Contexto funcional conocido',
  initialScope: 'Alcance inicial',
  currentBoundary: 'Límite actual',
  noTechnicalDecisions: 'Todavía no se han registrado decisiones de implementación técnica.',
  aiRules: 'Reglas de IA',
  aiRuleOne: 'No invente requisitos ni información de negocio ausente.',
  aiRuleTwo: 'Conserve la trazabilidad hacia el Work Item y su contexto proporcionado.',
  aiRuleThree:
    'Registre las decisiones relevantes en el dossier cuando exista la herramienta de ciclo de vida adecuada.',
  aiRuleFour: 'No modifique archivos fuera de este dossier de Work Item.',
  aiRuleFive:
    'Mantenga actualizados los documentos del dossier conforme se verifique la información.',
  nextTask: 'Siguiente tarea',
  nextTaskInstruction:
    'Revise el contexto funcional proporcionado e identifique preguntas abiertas antes de tomar decisiones técnicas.',
  currentState: 'Estado actual',
  persistedFunctionalAnalysis: 'Análisis funcional persistido',
  persistedWorkItemFacts: 'Datos persistidos del Work Item',
  knownImplementationContext: 'Contexto de implementación conocido',
  constraints: 'Restricciones',
  openQuestions: 'Preguntas abiertas',
  technicalAnalysis: 'Análisis técnico',
  suppliedTechnicalObservations: 'Observaciones técnicas proporcionadas',
  declaredHypotheses: 'Hipótesis declaradas',
  suppliedDependencies: 'Dependencias proporcionadas',
  impactAnalysis: 'Análisis de impacto',
  affectedComponents: 'Componentes afectados',
  suppliedImpactStatements: 'Impactos proporcionados',
  implementationPlan: 'Plan de implementación',
  suppliedImplementationSteps: 'Pasos de implementación proporcionados',
  prerequisites: 'Requisitos previos',
  notProvided: 'No proporcionado',
  managedDocumentLifecycle: 'Ciclo de vida de documentos gestionados',
  documentType: 'Tipo de documento',
  relativePath: 'Ruta relativa',
  revision: 'Revisión',
  contentType: 'Tipo de contenido',
  auditGeneratedNotice:
    '<!-- PROYECCIÓN DE AUDITORÍA GENERADA POR EL SISTEMA. NO EDITAR DIRECTAMENTE. -->',
  auditProtectedNotice:
    '> Proyección derivada protegida. El ledger estructurado de auditoría es el registro autorizado.',
  decisions: 'Decisiones',
  checkpoints: 'Puntos de control',
  testPlanAndExecutions: 'Plan de pruebas y ejecuciones',
  evidenceReferences: 'Referencias de evidencia',
  evidenceReferencesSummary: 'Referencias de evidencia',
  currentDecisions: 'Decisiones actuales',
  appendOnlyDecisionHistory: 'Historial append-only de decisiones',
  noCurrentDecisions: 'No hay decisiones actuales registradas.',
  noDecisionEntries: 'No hay entradas de decisiones registradas.',
  entryId: 'ID de entrada',
  kind: 'Tipo',
  decision: 'Decisión',
  rationale: 'Justificación',
  declaredActor: 'Actor declarado',
  recordedAt: 'Registrado el',
  relatedDecision: 'Decisión relacionada',
  evidenceReferenceIds: 'Referencias de evidencia',
  currentCheckpoints: 'Puntos de control actuales',
  appendOnlyCheckpointHistory: 'Historial append-only de puntos de control',
  noCurrentCheckpoints: 'No hay puntos de control actuales registrados.',
  noCheckpointEntries: 'No hay entradas de puntos de control registradas.',
  summary: 'Resumen',
  correctsCheckpoint: 'Corrige el punto de control',
  relatedDecisions: 'Decisiones relacionadas',
  activeTestPlan: 'Plan de pruebas activo',
  immutablePlanVersionHistory: 'Historial inmutable de versiones del plan',
  noTestPlanDefined: 'No se ha definido un plan de pruebas.',
  noPlanVersions: 'No hay versiones de plan registradas.',
  planRevision: 'Revisión del plan',
  plan: 'Plan',
  versionEntryId: 'ID de entrada de versión',
  planId: 'ID del plan',
  purpose: 'Propósito',
  testCases: 'Casos de prueba',
  noTestCasesDefined: 'No hay casos de prueba definidos.',
  testCaseId: 'ID del caso de prueba',
  objective: 'Objetivo',
  verificationMethod: 'Método de verificación',
  expectedOutcome: 'Resultado esperado',
  executions: 'Ejecuciones',
  executionId: 'ID de ejecución',
  method: 'Método',
  noExecutionsRecorded: 'No hay ejecuciones registradas.',
  latestResultPerActiveTestCase: 'Último resultado por caso de prueba activo',
  noActiveTestCases: 'No hay casos de prueba activos registrados.',
  noActiveTestCasesProjection: 'No hay casos de prueba activos.',
  noTestCaseRun: 'No ejecutado.',
  registeredReferences: 'Referencias registradas',
  noEvidenceReferences: 'No hay referencias de evidencia registradas.',
  noEvidenceReferencesSummary: 'No hay referencias de evidencia registradas.',
  evidenceReferenceId: 'ID de referencia de evidencia',
  description: 'Descripción',
  logicalPath: 'Ruta lógica',
  validation: 'Validación',
  metadataReferenceOnly:
    'Solo referencia de metadata; no se comprobaron la existencia ni el contenido del archivo.',
  auditSummary: 'Resumen de auditoría de Milestone 4',
  derivedAuditSummary:
    'Resumen de auditoría derivado. Solo cambia mediante una actualización explícita del contexto de IA.',
  priorityRisksAndBlockers: 'Riesgos y bloqueadores prioritarios',
  noRisksOrBlockers: 'No hay riesgos ni bloqueadores actuales registrados.',
  noActiveTestPlanRecorded: 'No hay un plan de pruebas activo registrado.',
  recentCheckpoints: 'Puntos de control recientes',
  noRecentCheckpoints: 'No hay puntos de control recientes de progreso o relevo.',
  additionalAuditEntriesOmitted:
    'Se han omitido entradas de auditoría adicionales para mantener este resumen dentro del límite de 16 KiB.',
};

class StaticDocumentContentProvider implements DocumentContentProvider {
  public constructor(
    public readonly profileId: DocumentRenderingProfileId,
    private readonly texts: Readonly<Record<DocumentTextKey, string>>,
  ) {}

  public readonly generatedArtifactKinds = GENERATED_ARTIFACT_KINDS;

  public text(key: DocumentTextKey): string {
    return this.texts[key];
  }
}

export class EsEsDocumentContentProviderV1 extends StaticDocumentContentProvider {
  public constructor() {
    super('ES_ES_V1', SPANISH_TEXT);
  }
}

export class BaselineEnglishDocumentContentProviderV1 extends StaticDocumentContentProvider {
  public constructor() {
    super('EN_BASELINE_V1', ENGLISH_TEXT);
  }
}

const ES_ES_PROVIDER = new EsEsDocumentContentProviderV1();
const EN_BASELINE_PROVIDER = new BaselineEnglishDocumentContentProviderV1();

export const DOCUMENT_RENDERING_MARKER =
  '<!-- WS-WORKSPACE-MCP:DOCUMENT_RENDERING_SNAPSHOT schemaVersion=1.0.0 documentLanguage=es-ES renderingProfile=ES_ES_V1 -->';
const RESERVED_MARKER_PREFIX = '<!-- WS-WORKSPACE-MCP:DOCUMENT_RENDERING_SNAPSHOT';

function snapshotError(): DocumentRenderingSnapshotInvalidError {
  return new DocumentRenderingSnapshotInvalidError(
    'The document rendering snapshot cannot be read safely.',
  );
}

export function providerForProfile(profileId: DocumentRenderingProfileId): DocumentContentProvider {
  return profileId === 'ES_ES_V1' ? ES_ES_PROVIDER : EN_BASELINE_PROVIDER;
}

export function providerForDocumentLanguage(
  documentLanguage: DocumentLanguageCode,
): DocumentContentProvider {
  if (documentLanguage !== 'es-ES') {
    throw snapshotError();
  }
  return ES_ES_PROVIDER;
}

/**
 * Resolves only a syntactically and positionally valid marker. A manifest
 * without the reserved marker is an immutable historical English baseline.
 */
export function providerForManifest(manifest: string): DocumentContentProvider {
  const lines = manifest.split('\n').map((line) => line.replace(/\r$/u, ''));
  const reservedMarkerIndexes = lines
    .map((line, index) => (line.includes(RESERVED_MARKER_PREFIX) ? index : -1))
    .filter((index) => index >= 0);

  if (reservedMarkerIndexes.length === 0) {
    return EN_BASELINE_PROVIDER;
  }
  if (
    reservedMarkerIndexes.length !== 1 ||
    reservedMarkerIndexes[0] !== 2 ||
    lines[0] !== '# Manifiesto del Work Item' ||
    lines[1] !== '' ||
    lines[2] !== DOCUMENT_RENDERING_MARKER ||
    lines.slice(0, 2).some((line) => line.startsWith('## '))
  ) {
    throw snapshotError();
  }
  return ES_ES_PROVIDER;
}
