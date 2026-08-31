# Registro histórico de validación corporativa de instalación — 2026-07-30

**Clasificación:** registro histórico de una instalación corporativa.  
**Estado documental:** REGISTRO HISTÓRICO — EVIDENCIA DE INSTALACIÓN CORPORATIVA.  
**Fecha de ejecución:** 30 de julio de 2026.  
**Límite:** este documento registra evidencia de una sola estación; no certifica de forma general otros equipos ni sustituye la validación formal de B1–B19.

## 1. Alcance y resultado registrado

Se instaló, compiló y conectó WS Workspace MCP desde IBM Bob en una estación Windows corporativa. La preparación técnica se registró como apta para iniciar la validación manual posterior, siempre que la revisión humana confirme la discrepancia de inventario indicada en el apartado 5.

La documentación se generó antes de B1–B19. No se ejecutaron esos casos manuales
como parte de esta evidencia de instalación. La validación manual oficial
posterior completó B1–B19 con resultado satisfactorio; su fuente canónica es
[Pruebas_Milestone_5.md](Pruebas_Milestone_5.md). Este registro no pretende
duplicar el informe completo de IBM Bob ni ampliar su evidencia de instalación.

## 2. Datos observados

| Dato                   | Valor registrado                         |
| ---------------------- | ---------------------------------------- |
| Repositorio MCP        | C:\WS-Workspace-MCP                      |
| Entrada compilada      | C:\WS-Workspace-MCP\dist\index.js        |
| Workspace autorizado   | C:\WS-Workspace                          |
| Directorio interno     | C:\WS-Workspace\.ws-workspace            |
| Directorio de bloqueos | C:\WS-Workspace\.ws-workspace\.locks     |
| Node.js                | v24.18.0                                 |
| npm                    | 11.16.0                                  |
| Ejecutable Node        | C:\Program Files\nodejs\node.exe         |
| IBM Bob                | 2.0.1                                    |
| Versión de servidor    | 0.1.0                                    |
| Commit observado       | ea59fedc68a1769603e96fd048d3c3333cc9696a |

La ruta de código fuente observada y los identificadores específicos de procesos, bloqueos y sesiones se han omitido deliberadamente: son datos operativos propios del entorno corporativo y no son necesarios para reproducir el procedimiento.

## 3. Runtime, instalación y compilación

La instalación inicial detectó Node 22.12, que no satisfacía el rango de motores ^20.19 || ^22.13 || >=24. Tras retirar esa instalación y usar Node LTS 24.18.0, la estación informó Node v24.18.0 y npm 11.16.0 mediante:

```powershell
node --version
npm.cmd --version
where.exe node
```

Se utilizaron las siguientes comprobaciones y pasos:

```powershell
winget --version
winget search OpenJS.NodeJS
winget list --name "Node.js"
winget list --id OpenJS.NodeJS.22 --exact
winget list --id OpenJS.NodeJS.LTS --exact
winget uninstall --id OpenJS.NodeJS.22 --exact
winget install --id OpenJS.NodeJS.LTS --exact --version 24.18.0
npm.cmd ci
npm.cmd run check
npm.cmd run build
Test-Path "C:\WS-Workspace-MCP\dist\index.js"
```

La ejecución de npm ci, npm.cmd run check y npm.cmd run build quedó registrada como satisfactoria; el punto de entrada compilado existía al finalizar. La evidencia no autoriza instalar Node 26, mantener versiones incompatibles en paralelo ni usar npm audit fix para alterar dependencias.

## 4. Conexión desde IBM Bob

La configuración local usó Node como comando, la entrada compilada como argumento y el workspace autorizado en variables de entorno. Se limitó la aprobación permanente a:

```text
health_check
get_server_capabilities
```

No se dejó aprobación permanente para herramientas mutantes, de bloqueo, recuperación o sesión.

Los smoke tests se ejecutaron en este orden:

1. health_check.
2. get_server_capabilities.

La respuesta de salud registrada identificó ws-workspace-mcp, versión 0.1.0, estado ok, Node v24.18.0 y filesystem lectura-escritura. La marca temporal registrada fue 2026-07-30T10:29:28.132Z. La ruta visible se considera detalle operacional y no se reproduce.

## 5. Capacidades, herramientas y discrepancia de inventario

La respuesta histórica registró esquema de capacidades 1.0.0, 18 capacidades, los cuatro tipos USER_STORY, DEFECT, INCIDENT y TECHNICAL_TASK, y como no implementadas las integraciones con Rally, Copado y base de conocimiento compartida.

Las 18 capacidades registradas fueron:

```text
local-stdio-mcp
secure-workspace-initialization
foundation-work-item-domain-model
secure-work-item-creation
controlled-document-lifecycle
document-revision-control
derived-ai-context-projection
append-only-audit-tracking
idempotent-audit-mutations
versioned-test-planning
controlled-evidence-references
crash-recoverable-multi-file-commits
living-project-knowledge-base
declared-participant-workflow
single-active-developer-session
deterministic-read-only-technical-snapshots
work-item-relations-and-project-concepts
review-complete-reopen-lifecycle
```

La evidencia recibida declara un total de 39 herramientas, pero el inventario
textual suministrado contiene 38 nombres. No se ha inventado una trigésima
novena herramienta en este registro histórico de preflight. El catálogo y el
veredicto formal de B1 pertenecen al informe completo de IBM Bob y se resumen
en `Pruebas_Milestone_5.md`; este documento no establece una conclusión sobre
ese recuento.

Inventario textual recibido:

```text
health_check
get_server_capabilities
initialize_workspace
create_work_item
initialize_work_item_documents
get_work_item_document
update_work_item_document
refresh_ai_context
initialize_work_item_tracking
record_decision
record_checkpoint
define_test_plan
record_test_execution
register_evidence_reference
get_work_item_tracking
create_work_item_v2
initialize_work_item_workflow
get_work_item_workflow
activate_work_session
switch_work_session
record_session_checkpoint
suspend_work_session
get_active_work_session
resume_work_session_context
add_work_item_collaborator
remove_work_item_collaborator
transfer_work_item_responsibility
add_work_item_relation
remove_work_item_relation
propose_project_concept
resolve_project_concept_proposal
consolidate_work_item_dossier
review_work_item
resolve_semantic_observation
complete_work_item
cancel_work_item
reopen_work_item
get_related_knowledge
```

## 6. Finales de línea y estado de Git

La estación comenzó con core.autocrlf global configurado como true y configuración local orientada a LF. El índice mostraba blobs LF y el árbol de trabajo mostraba CRLF para los archivos inspeccionados. Prettier informó errores en 116 archivos; posteriormente el estado de Git parecía sucio mientras los hashes de README.md en HEAD y árbol de trabajo coincidían y no había diferencias de contenido.

La causa registrada fue una desincronización de metadatos del índice, no una modificación confirmada de contenido. Se emplearon las comprobaciones siguientes:

```powershell
git config --show-origin --list
git config --show-origin --get-regexp "core|filter|autocrlf|eol|safecrlf"
git ls-files --eol
git rev-parse HEAD:README.md
git hash-object README.md
git diff --ignore-space-at-eol README.md
git diff --summary
git update-index --really-refresh
```

Como medida excepcional de recuperación, tras preservar el índice y verificar que no existía trabajo legítimo sin guardar, se reconstruyó el índice:

```powershell
Copy-Item ".git\index" ".git\index.pre-lf-rebuild.bak"
Remove-Item ".git\index"
git reset --mixed HEAD
```

Este procedimiento no es un paso de instalación normal. Requiere copia previa, verificación de hashes y revisión humana para evitar perder o enmascarar diferencias reales.

## 7. Bloqueos residuales

Al inspeccionar el directorio de bloqueos se localizaron dos pares de marcadores residuales, clasificados como evidencia de operaciones anteriores de recuperación y liberación. No se detectaron procesos activos asociados.

Antes de limpiar el directorio operativo se archivó la evidencia en C:\WS-Workspace\.ws-workspace\lock-evidence-pre-adr022. Después se retiraron únicamente los marcadores residuales de .locks y se confirmó que el directorio operativo quedó vacío. Tras health_check y get_server_capabilities, .locks también permaneció vacío.

Los nombres de marcadores, UUID, PID y tokens se omiten por protección de datos operativos corporativos. La revisión humana debe verificar la existencia del archivo archivado y la ausencia de procesos antes de repetir una limpieza.

## 8. Relación con el cierre posterior de M5

La preparación técnica —runtime compatible, entrada compilada, conexión IBM Bob,
salud del servidor y aislamiento de bloqueos tras el smoke test— quedó
registrada como apta para continuar con B1–B19.

La validación manual oficial posterior completó B1–B19 satisfactoriamente y
cerró M5. Este registro conserva su discrepancia histórica de inventario como
contexto de preflight; no infiere ni reemplaza el inventario que consta en el
informe completo de IBM Bob.

El documento se conserva como evidencia complementaria de instalación y se
integra mediante enlaces desde la guía y el README; no sustituye el registro de
pruebas ni el informe completo de cierre.
