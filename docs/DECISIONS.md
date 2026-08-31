# Architecture decision records

All decisions below are approved. Status is Accepted unless later superseded.

## Approved decision index

| #   | Approved decision                                                                 | Record  |
| --- | --------------------------------------------------------------------------------- | ------- |
| 1   | Only four work-item types exist.                                                  | ADR-001 |
| 2   | Rally ID is mandatory.                                                            | ADR-002 |
| 3   | Git branches are not used in the workflow.                                        | ADR-003 |
| 4   | A development sandbox or alias is mandatory.                                      | ADR-004 |
| 5   | Start date is mandatory.                                                          | ADR-005 |
| 6   | Planned completion date is optional.                                              | ADR-005 |
| 7   | Actual completion date is generated on close.                                     | ADR-005 |
| 8   | Responsible person is optional.                                                   | ADR-006 |
| 9   | Initially related components are captured.                                        | ADR-006 |
| 10  | Additional business information is optional.                                      | ADR-006 |
| 11  | The first interface is MCP for IBM Bob.                                           | ADR-007 |
| 12  | The verified IBM Bob registration is accepted.                                    | ADR-007 |
| 13  | Initial local transport is stdio.                                                 | ADR-008 |
| 14  | The core is decoupled from the MCP adapter.                                       | ADR-009 |
| 15  | There is no Rally integration in Milestone 1.                                     | ADR-010 |
| 16  | There is no Copado integration in Milestone 1.                                    | ADR-010 |
| 17  | There is no VS Code extension in the MVP.                                         | ADR-011 |
| 18  | Initial persistence is file-based.                                                | ADR-009 |
| 19  | Development and validation are incremental.                                       | ADR-012 |
| 20  | The tool never accesses or writes outside its authorized root.                    | ADR-012 |
| 21  | IBM Bob runs the compiled server against a separate runtime root.                 | ADR-014 |
| 22  | The MVP remains local; future sharing needs separate approval.                    | ADR-015 |
| 23  | Product layering and deferred future sharing are clarified.                       | ADR-016 |
| 24  | Document-language configuration and rendering snapshots are local and immutable.  | ADR-017 |
| 25  | M5 uses one workspace-level knowledge base, separate from the frozen M4 ledger.   | ADR-018 |
| 26  | M5 adds a read-only source root, dual layout and logical lifecycle compatibility. | ADR-019 |
| 27  | M5 identities are stable but declared, and host UX remains outside the domain.    | ADR-020 |
| 28  | M5 completion records a causal M3/M4 revision fence for historical auto-reopen.   | ADR-021 |
| 29  | Lock recovery uses correlated ownership and deterministic release failures.       | ADR-022 |

## ADR-001: Work-item types

Context: The team receives several Rally item kinds.
Decision: Permit only USER_STORY, DEFECT, INCIDENT and TECHNICAL_TASK.
Consequences: Validation and user interfaces reject every other kind.
Status: Accepted.

## ADR-002: Mandatory Rally ID

Context: Items need a traceable external reference.
Decision: Rally ID is mandatory at creation.
Consequences: Direct Rally access is not required to maintain traceability.
Status: Accepted.

## ADR-003: No Git branch workflow

Context: Copado is used by the team but source branching is not part of the
requested process.
Decision: Do not model or require a Git branch.
Consequences: No branch metadata or Git operations are introduced.
Status: Accepted.

## ADR-004: Mandatory development alias

Context: Work must identify its development Salesforce context.
Decision: A sandbox or development alias is required.
Consequences: Future creation validation requires SalesforceContext.developmentAlias.
Status: Accepted.

## ADR-005: Date policy

Context: Planning and real completion differ.
Decision: Start date is mandatory, planned completion is optional, and actual
completion is generated only on close.
Consequences: Creation cannot supply a final completion date.
Status: Accepted.

## ADR-006: Responsibility and initial scope

Context: Ownership and impacted components aid context recovery.
Decision: Responsible person and additional business information are optional;
initially related components are captured at creation.
Consequences: They are represented as optional responsibility/business records
and a required InitialScope.
Status: Accepted.

## ADR-007: IBM Bob MCP-first interface

Context: IBM Bob is the first operational client, and its local `mcp.json`
registration has been verified in Milestone 1.
Decision: Use MCP as the first interface with the confirmed IBM Bob stdio
registration.
Consequences: A generic multi-client product is not required; core logic stays
outside the adapter.
Status: Accepted.

## ADR-008: Local stdio transport

Context: The server runs on a personal computer.
Decision: Use local stdio transport initially.
Consequences: No HTTP listener, authentication endpoint or remote deployment is
introduced in Milestone 1.
Status: Accepted.

## ADR-009: Decoupled core and file persistence

Context: A future diagnostic CLI must reuse behavior.
Decision: Persist initially to files and keep services independent of the MCP
adapter.
Consequences: Filesystem infrastructure is called through application services.
Status: Accepted.

## ADR-010: Deferred external integrations

Context: Rally and Copado contracts are not confirmed.
Decision: Neither Rally nor Copado integration is included in Milestone 1.
Consequences: Information is manual and adapters remain future work.
Status: Accepted.

## ADR-011: No VS Code extension in the MVP

Context: IBM Bob is the approved first interface.
Decision: Do not add a VS Code extension.
Consequences: The MCP API remains the integration boundary.
Status: Accepted.

## ADR-012: Incremental validation and containment

Context: The project is personal-development software that must not touch
unapproved locations.
Decision: Deliver and validate one milestone at a time; never read or write
outside the authorized workspace root.
Consequences: WS_WORKSPACE_ROOT is explicit and all child paths are contained.
Status: Accepted.

## ADR-013: Reject filesystem volume roots

Context: An explicit path such as C:\ is technically absolute but grants an
unnecessarily broad local write scope.
Decision: Reject a configured filesystem volume root even when it is otherwise
readable and writable.
Consequences: The operator must choose a dedicated child directory; the
configuration failure is clear and does not expose the configured path.
Status: Accepted.

## ADR-014: Separate IBM Bob runtime workspace

Context: Milestone 1 validation confirmed IBM Bob registration through
`mcp.json`, using Node.js to launch `C:\\US-Workspace-MCP\\dist\\index.js` and
passing `WS_WORKSPACE_ROOT=C:\\WS-Workspace` over a local stdio MCP connection.
The executable and runtime data have different authorization needs.

Decision: Keep the source/build directory and the authorized runtime workspace
separate. IBM Bob launches the compiled server from the source/build directory,
while the server receives its sole writable location through
`WS_WORKSPACE_ROOT`.

Consequences: Runtime initialization and future workspace operations cannot use
the project repository as their target under the verified configuration. The
filesystem boundary remains narrow, work-item data is independent of server
builds, and the IBM Bob registration is a confirmed operational contract for
Milestone 1.

Status: Accepted and verified in Milestone 1.

## ADR-015: Local MVP before centralized knowledge service

Context: The local file-based architecture is the approved implementation for
the current MVP. The finished product is intended to provide a shared source
of truth for multiple project developers rather than independent local
workspaces.

Decision: Keep local file persistence for Milestones 3, 4, and 5. After the
local MVP, evolve the product through a separately approved initiative toward
the following target direction:

    IBM Bob -> MCP local -> Central Knowledge Service -> Single Work Item Repository -> Shared Documentation

The Central Knowledge Service will be the future source of truth. Business
logic must remain decoupled from MCP transport and persistence infrastructure
to facilitate that future migration.

Consequences: This decision changes no current architecture, behavior,
milestone scope, persistence mechanism, or external integration. It does not
authorize the implementation or design of a service contract, API, database,
deployment, authentication model, or migration plan.

Status: Partially superseded by ADR-016.

Supersession note: ADR-016 supersedes only the part of this ADR that selected a
Central Knowledge Service as the future approved direction or mandatory source
of truth. Its historical context and its decision to preserve the local MVP
remain unchanged.

## ADR-016: Product Layering: Core, Technology Profiles and Project Profiles

Context: WS Workspace MCP completed Milestones 1–3 as a local MCP product
validated for a Salesforce and Rally use case. Product evolution needs a clear
general direction without falsely treating those completed contracts as
technology-neutral or selecting a sharing architecture prematurely.

Problem: The product must distinguish general Work Item knowledge from future
technology-specific and project-specific knowledge. It must also distinguish
stable project knowledge from the generated and auditable dossier of one Work
Item. ADR-015 previously selected a Central Knowledge Service as the approved
future direction, whereas future sharing and synchronization choices are now
explicitly open.

Alternatives:

1. Retain Salesforce/Rally as the permanent product identity.
2. Implement profiles or a sharing architecture immediately.
3. Establish conceptual product layering, preserve the validated local system,
   and defer profile and sharing implementation. **Selected.**

Decision: WS Workspace will evolve toward a general WS Workspace Core with
future Technology Profiles and Project Profiles. The Core direction can own
general concepts such as Work Item, document, context, manifest, revision,
decision, checkpoint, evidence, relation, component, functional capability,
and audit. A Technology Profile is a future reusable, technology-specific
extension. A Project Profile is future stable, transversal knowledge belonging
to one project.

The Work Item Dossier remains separate: it is generated, updated, and audited
around one concrete Work Item. A future dossier may reference Project Profile
knowledge but must not become the general container for it.

Limits: This ADR defines neither a profile format, schema, API, loading
mechanism, versioning model, persistence mechanism, nor implementation. It
does not define Salesforce or Contact Center profiles and does not introduce
functional project knowledge.

Relation to M1–M3: M1–M3 remain `COMPLETED`, implemented, tested, and
validated. They form the local, documentary, and architectural base from which
the Core may evolve. They are not reinterpreted as a fully neutral Core: the
current frozen contracts explicitly contain `SalesforceContext`,
`developmentAlias`, and `rallyId` for the initial Salesforce/Rally use case.
Their neutralization requires a separate approved evolution.

Consequences: The current local filesystem, hexagonal architecture, MCP
contracts, tests, and validation evidence remain valid and unchanged. The
product identity becomes technology-independent at the strategic level while
the implementation documents its remaining dependencies honestly.

Risks: A future contributor may mistake this conceptual direction for an
implementation mandate, hide current Salesforce/Rally dependencies, or place
stable project knowledge in dossiers. Documentation and future milestone design
must keep those boundaries explicit.

Deferred elements: Sharing, synchronization, corporate folders, internal
servers, a Central Knowledge Service, central APIs, databases, multi-tenancy,
SaaS, cloud deployment, enterprise authentication, profile formats,
versioning, persistence, loaders, and onboarding are future options, not
selected decisions.

ADR-015 relationship: ADR-016 supersedes ADR-015 only where ADR-015 selected a
Central Knowledge Service as the future approved direction or required source
of truth. Centralization is not rejected; it is one unselected future option.
ADR-015's historical motivation and its local-MVP preservation remain intact.

Roadmap impact: Milestone 4 remains limited to its existing decisions,
checkpoints, and testing scope. This ADR does not start, redesign, or expand
Milestone 4.

Status: Accepted.

## ADR-017: Persistencia del idioma documental y snapshot de rendering

Context: Milestones 1–4 están completados y congelados con documentación de
sistema en inglés, contratos MCP cerrados y persistencia local. Se necesita
preparar localización de la prosa propiedad del sistema para Work Items nuevos
sin reinterpretar históricos, traducir contenido humano ni ampliar el contrato
de transporte.

Decision: La fuente de verdad del idioma documental será
`.ws-workspace/config/workspace-config.json`, con el contrato versionado
`{"schemaVersion":"1.0.0","documentLanguage":"es-ES"}`. La configuración
será JSON estricto de hasta 4 KiB, se creará sólo cuando falte mediante
publicación atómica sin reemplazo y nunca se sobrescribirá o reparará
silenciosamente. No se introduce `WS_DOCUMENT_LANGUAGE`, parámetro MCP, sidecar
ni workspace lock.

Cada Work Item nuevo creado por la implementación M4.1B conservará un
snapshot inmutable de idioma y perfil como metadata técnica dentro de
`00_MANIFEST.md`. Los perfiles
internos son `ES_ES_V1` para la prosa española nueva y `EN_BASELINE_V1` sólo para
compatibilidad histórica por ausencia de marker. La prosa del sistema será
proporcionada por proveedores tipados y un registro exhaustivo de artefactos;
los payloads humanos y tokens técnicos exactos no se traducen. Todo dossier
nuevo `ES_ES_V1` persistirá el marcador técnico exacto exclusivamente en su
`00_MANIFEST.md`, según lo establecido en
`MILESTONE_4_1_DESIGN.md`, tras el H1 y antes del primer `##`.

Los Work Items históricos sin marker conservarán exactamente el
baseline inglés, sin migración. Un snapshot, configuración o marcador inválido
fallará cerrado con errores aditivos seguros. M3 y M4 conservan sus locks,
journal, recovery, ledger, bloques protegidos, precedencia general y contratos
MCP.

Consequences: El marker es metadata técnica interna, no información funcional
ni de negocio. Su borrado manual completo es un riesgo residual aceptado: puede
hacer un dossier español indistinguible de un histórico sin marker, sin que se
autorice sidecar o autoreparación. M4.1A queda aprobado y congelado como diseño.
M4.1B debe
implementar proveedores, validadores, parser de marcador, pruebas de seguridad
y regresión. En el momento de aprobar este ADR, la validación automática estaba
superada y la validación IBM Bob separada quedaba pendiente antes del cierre
administrativo de M4.1. No cambió el modelo `WorkItem`, el ledger ni las quince
herramientas MCP.

Status: Accepted.

Closure note: M4.1B superó posteriormente la validación manual IBM Bob y
Milestone 4.1 quedó `COMPLETED — FROZEN`. Milestone 5 superó posteriormente la
validación manual oficial B1–B19 y quedó `COMPLETED — FROZEN`; este cambio
posterior no modifica la decisión técnica de ADR-017.

## ADR-018: Base de conocimiento única de M5 y separación del ledger M4

Context: La baseline M1–M4.1 está completada y congelada. M4 conserva
`records/AUDIT_LEDGER.json` con schema `1.0.0` como fuente de verdad de
decisiones, checkpoints M4, planes, ejecuciones y referencias de evidencia. M5
debe añadir sesiones, snapshots técnicos, participantes, procedencia,
relaciones, conceptos, consolidaciones, revisiones y ciclo de vida sin ampliar
ni reinterpretar ese contrato histórico.

Alternatives:

1. Ampliar el ledger M4 con campos y operaciones M5.
2. Crear stores independientes para sesiones, snapshots, relaciones y
   conceptos.
3. Mantener una única fuente estructurada M5 para todo el workspace, separada
   del ledger M4. **Seleccionada.**

Decision: La única fuente estructurada de M5 será
`.ws-workspace/records/KNOWLEDGE_BASE.json`. Tendrá schema, revisión global,
operaciones append-only e índice global de idempotencia propios. Una mutación
lógica confirmada añadirá una operación inmutable; un reintento exacto se
resolverá antes de comprobar revisiones obsoletas.

El ledger M4 permanecerá en schema `1.0.0` y conservará intactas su autoridad,
operaciones, proyecciones e índice. M5 no duplicará sus eventos dentro del
ledger M4. Los Markdown M5, el bloque M5 del manifest, el catálogo consultable
y las vistas de sesión serán proyecciones regenerables de la base M5, nunca
fuentes alternativas.

La autoridad agregada del dossier queda distribuida de forma explícita:

- identidad histórica, Rally ID y tipo: `WORK_ITEM.yml` versionado;
- decisiones, checkpoints M4, pruebas y evidencia: ledger M4;
- estado canónico, iteración, participantes, sesiones, snapshots, procedencia,
  relaciones, conceptos, revisiones y ciclo M5: base M5;
- narrativa M5 y `AI_CONTEXT`: proyecciones protegidas.

Consequences: M5 necesita un codec estricto, un coordinador de transacción
workspace-level y una política compartida de targets para confirmar juntos la
base, las proyecciones afectadas, el manifest y las proyecciones legacy. Un
estado inconsistente falla cerrado y nunca se reconstruye silenciosamente
desde Markdown. Esta decisión autoriza un catálogo mínimo de conceptos y
consulta de conocimiento dentro del MVP local, pero no implementa un Project
Profile completo, almacenamiento compartido, sincronización ni servicio
central.

Implementation status: El contrato está definido en
`MILESTONE_5_DESIGN.md`; M5 está `COMPLETED — FROZEN` tras la validación manual
oficial B1–B19. La atomicidad descrita para la base y sus proyecciones se aplica
a cada commit M5. El bridge posterior a una mutación M3/M4 usa un segundo commit
físico y converge al releer el estado; no amplía esta decisión a una
transacción cross-repository. `Knowledge revision` es un watermark global por
dossier y no obliga a reescribir dossiers no afectados.

Status: Accepted for Milestone 5.

## ADR-019: Raíz de observación, layout dual y ciclo de vida lógico M5

Context: La baseline usa `WS_WORKSPACE_ROOT` como única raíz de datos y crea
dossiers en `.ws-workspace/active/<workItemId>`. El repositorio fuente se
mantiene separado del workspace escribible. M5 necesita snapshots técnicos de
un proyecto autorizado, un layout `Iteration → tipo → Work Item`, tres estados
canónicos y compatibilidad no destructiva con dossiers históricos.

Decision: M5 introducirá `WS_PROJECT_SOURCE_ROOT` como binding de despliegue
explícito y exclusivamente de lectura. `WS_WORKSPACE_ROOT` seguirá siendo la
única raíz escribible. Las dos raíces deberán ser absolutas, existentes,
directorios que no sean raíces de volumen, distintas y no contenidas entre sí.
No habrá fallback, descubrimiento mediante el directorio de proceso ni
persistencia o exposición de la ruta absoluta. La ausencia de la segunda raíz
no impedirá M1–M4.1, pero una activación de sesión M5 fallará de forma segura.

Los dossiers históricos conservarán
`.ws-workspace/active/<workItemId>`. Los creados mediante el contrato M5 usarán:

```text
.ws-workspace/active/<iterationStorageToken>/<workItemType>/<workItemId>
```

Un `WorkItemLocator` leerá ambos layouts, exigirá unicidad global del
`workItemId`, validará los componentes físicos sin seguir enlaces y no moverá
históricos automáticamente. `active` será un namespace compatible, no la
representación del estado M5. Las relaciones nunca participarán en la
resolución física.

Los estados canónicos M5 serán exactamente `IN_PROGRESS`, `COMPLETED` y
`CANCELLED`. Para preservar lectores históricos, `WORK_ITEM.yml` será una
proyección compatible: `CLOSED` representará `COMPLETED`, `CANCELLED`
representará `CANCELLED` y los demás valores históricos se interpretarán como
`IN_PROGRESS` tras inicializar el workflow M5. Cierre, reapertura y cancelación
confirmarán la base M5 y la proyección YAML en el mismo commit. La historia de
transiciones y fechas permanecerá append-only.

Completar, cancelar o reabrir no moverá la carpeta. `.ws-workspace/archive`
se conservará por compatibilidad, pero M5 no implementará archivado físico.

Consequences: `create_work_item` M2 conservará su schema y comportamiento. M5
añadirá un contrato de creación v2 e inicialización explícita de históricos.
No habrá migración al leer. Esta decisión supersede únicamente para M5 la
previsión no implementada del roadmap anterior que vinculaba cierre y
archivado físico; no altera evidencia histórica.

El bootstrap de creación v2 ejecuta M2→M3→M4→M5 por fases bajo el gate global;
no se declara como una transacción física única. Los errores controlados
retiran un dossier recién creado. Si una caída deja un dossier parcial, una
huella SHA-256 de la petición normalizada completa en el manifest permite
reanudarlo sólo con el retry exacto, sin persistir la clave de idempotencia ni
el `participantId` en claro. Una petición distinta conserva el dossier y falla
como colisión global.

Implementation status: Decisión aprobada, documentada e implementada. M5 está
`COMPLETED — FROZEN` tras la validación manual oficial mediante IBM Bob.

Status: Accepted for Milestone 5.

## ADR-020: Identidad declarada y portabilidad de la experiencia de host

Context: M3 registra `updatedBy: SYSTEM` y M4 conserva un `declaredActor`
aportado por el cliente. La baseline no autentica personas ni contiene un
modelo corporativo de identidad. M5 necesita un responsable principal,
colaboradores, transferencia, sesiones por desarrollador y confirmaciones
humanas, manteniendo a IBM Bob como cliente de referencia sin acoplar el
dominio a su interfaz.

Decision: M5 usará referencias de participante con un identificador estable y
un nombre visible desacoplados:

```text
ParticipantRef {
  participantId
  displayName
}
```

El servidor validará forma, pertenencia y coincidencia del `participantId`,
pero la assurance del MVP será explícitamente `DECLARED`. No se usará el
nombre de usuario del sistema operativo ni se describirá al actor como
autenticado. Un futuro puerto de identidad/autorización podrá aportar
autenticación sobre el mismo identificador sin cambiar las reglas de dominio.

Completar, cancelar, reabrir explícitamente, transferir responsabilidad y
aprobar un concepto exigirán confirmación explícita y el actor declarado
permitido por el estado persistido. Las inferencias de IA no podrán realizar
por sí solas esas acciones ni oficializar configuración o conocimiento.

IBM Bob podrá representar acciones, formularios, selectores y confirmaciones.
Esas vistas serán experiencia del cliente. Las mismas operaciones existirán
como contratos MCP estructurados y tendrán un modo degradado determinista para
otros clientes; ninguna regla residirá exclusivamente en Bob o en memoria de
conversación.

Consequences: La autorización local impide incoherencias accidentales, pero no
constituye autenticación fuerte frente a un cliente malicioso. Documentación,
errores y proyecciones deberán mantener esa limitación visible. Procedencia y
transferencias serán eventos append-only y nunca sobrescribirán la historia.

Implementation status: Decisión aprobada, documentada e implementada. M5 está
`COMPLETED — FROZEN` tras la validación manual oficial mediante IBM Bob.

Status: Accepted for Milestone 5.

## ADR-021: Frontera causal de revisiones para la reapertura histórica

Context: Las mutaciones M3/M4 y su reapertura M5 se confirman en dos commits
físicos secuenciales. Releer únicamente el estado permite converger cuando el
Work Item ya está `IN_PROGRESS`, pero no distingue un retry antiguo de una
mutación realmente posterior a un segundo cierre. Los timestamps tampoco son
una frontera causal: dos operaciones pueden compartir resolución temporal y el
reloj inyectado puede permanecer fijo durante una prueba o recuperación.

Decision: Cada evento `WORK_ITEM_COMPLETED` conservará una
`HistoricalMutationBoundary` con las revisiones positivas de los siete tipos de
documento M3 y la `auditRevision` M4 no negativa observadas al cerrar. El
servicio captura esa frontera bajo el knowledge gate M5 y el lock compartido del
Work Item. Además, vuelve a verificar el readiness M4 y exige que la revisión
del ledger coincida con el inventario M4 del manifest antes de confirmar.

El bridge de `update_work_item_document` transportará el tipo documental y su
revisión confirmada. Los bridges de `record_decision`, `record_checkpoint`,
`define_test_plan`, `record_test_execution` y `register_evidence_reference`
transportarán el identificador inmutable de la entrada y su `auditRevision`.
Antes de comprobar la idempotencia propia del bridge, el cursor se compara con
la última frontera de cierre:

- cursor anterior o igual: no-op;
- cursor posterior con workflow `COMPLETED`: evento `WORK_ITEM_REOPENED` de
  actor `SYSTEM`;
- cursor posterior con workflow ya `IN_PROGRESS`: no-op convergente.

`initialize_work_item_documents` no dispara reapertura: después de un cierre,
una inicialización válida no crea una nueva revisión documental. Los timestamps
se conservan para auditoría, pero no participan en la decisión causal.

Consequences: Un retry puede completar una reapertura omitida tras haberse
confirmado M3/M4, incluso si comparte timestamp con el cierre. Un retry antiguo
después de un cierre posterior no vuelve a abrir el Work Item. Se mantienen los
dos commits y no se modifican los contratos persistidos M3/M4; la frontera M5
duplica únicamente cursores de revisión, no contenido histórico. Toda nueva
familia de mutación histórica que deba reabrir exigirá un cursor monotónico y
una ampliación explícita de esta decisión.

Implementation status: Decisión aprobada, documentada e implementada. M5 está
`COMPLETED — FROZEN` tras la validación manual oficial mediante IBM Bob.

Status: Accepted for Milestone 5.

## ADR-022: Propiedad correlacionada y reconciliación conservadora de locks

Context: El protocolo histórico de exclusión escribía un PID en el lifecycle
lock y otro token independiente en el recovery claim. La liberación podía
retirar el lock, fallar al retirar un claim `RELEASE` y ocultar ese fallo. La
siguiente operación interpretaba el PID todavía existente como propietario
activo antes de intentar recovery, aunque ya no hubiese operación ni journal.
El resultado era un conflicto persistente que un retry exacto no podía
resolver. Un PID aislado tampoco distingue una instancia actual, una instancia
anterior ni la reutilización del PID por el sistema operativo.

Decision: Los nuevos lifecycle locks usan el schema de protocolo `2.0.0` y
registran `pid`, `instanceId` aleatorio por proceso MCP, `operationId`, token de
adquisición y timestamp. Los claims `RELEASE` y `RECOVERY` registran su
propietario y una copia exacta de la identidad del lock al que se refieren. Un
registro en memoria conserva las operaciones y reclamaciones activas de la
instancia actual; el PID queda como una señal adicional y nunca como prueba
única de propiedad.

Antes de devolver conflicto, el coordinador clasifica conjuntamente lock,
claim y transacción como libre, propietario activo, propietario abandonado,
liberación pendiente, recovery activo/abandonado/desconocido, staging o journal
pendiente, malformado o divergente. Sólo reconcilia automáticamente:

- un `RELEASE` `2.0.0` cuya referencia coincide exactamente con el lock, sin
  transacción scoped pendiente y sin propietario activo registrado;
- un claim-only `RELEASE` correlacionado dejado después de retirar el lock;
- un `RECOVERY` cuyo reclamante es demostrablemente inactivo; y
- un lock válido cuyo propietario es demostrablemente inactivo, mediante un
  claim exclusivo y revalidación física.

Cada retirada relee contenido e identidad física, captura el fichero mediante
rename dentro de `.locks` y vuelve a verificarlo antes de borrarlo. Formatos
parciales, links, tokens divergentes, propietarios remotos vivos o desconocidos
y staging no reconocido fallan cerrados y se conservan. No existe limpieza por
edad. Los locks y claims `1.0.0` siguen siendo legibles: un PID muerto permite
el recovery histórico; un PID vivo sin identidad de instancia permanece
conservadoramente bloqueado.

La liberación intenta retirar lock y claim y propaga cualquier resultado no
confirmado. Si la operación funcional ya falló, su `WorkspaceError` conserva
precedencia contractual y el fallo de cleanup queda adjunto como `cause` y
`cleanupError`; si no hubo fallo funcional, el fallo de liberación se devuelve
como error de actualización. De este modo no se cambian los códigos MCP
aprobados y ningún fallo de cleanup queda silenciado.

Consequences: Un retry puede cerrar de forma idempotente la ventana exacta
entre crear el claim, retirar el lock y retirar el claim, incluso tras iniciar
otra instancia y aunque el PID se haya reutilizado. Una operación legítima
simultánea sigue recibiendo conflicto. La reconciliación ocurre al adquirir el
gate, antes del conflicto, y reutiliza el mismo clasificador que protege el
recovery transaccional; no añade rutas escribibles ni modifica journals,
ledgers, idempotencia `PENDING` ni contratos M3–M5.

Implementation status: Decisión aprobada, documentada e implementada con
pruebas de fallos en cada fase, correlación, PID reutilizado, concurrencia,
journals y staging. La revalidación manual IBM Bob confirmó el comportamiento
operativo y la ausencia de locks, claims, staging o journals residuales al
cierre. M5 está `COMPLETED — FROZEN`.

Status: Accepted as a corrective operational decision for Milestones 3–5.
