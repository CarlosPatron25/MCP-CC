# Guía de instalación en Windows e IBM Bob

**Estado:** REFERENCIA OPERATIVA — VALIDADA EN EL CIERRE CORPORATIVO DE M5  
**Ámbito:** instalación y validación operativa de WS Workspace MCP en Windows con IBM Bob.

Esta guía se apoya en una validación realizada en una única estación corporativa
el 30 de julio de 2026 y en el cierre manual posterior de M5 mediante IBM Bob.
Requiere revisión humana antes de aplicarse a otros equipos o entornos. El
resultado formal B1–B19 está en [Pruebas_Milestone_5.md](Pruebas_Milestone_5.md).

## 1. Propósito y límites

Describe cómo preparar el servidor MCP local, enlazarlo con IBM Bob mediante stdio y efectuar comprobaciones iniciales de salud, capacidades, aislamiento del workspace, finales de línea y bloqueos.

No autoriza cambios en el código, contratos MCP, configuración global de Git ni automatizaciones externas.

## 2. Topología validada

| Elemento                   | Ruta o valor validado                                              |
| -------------------------- | ------------------------------------------------------------------ |
| Repositorio y servidor MCP | C:\WS-Workspace-MCP                                                |
| Punto de entrada compilado | C:\WS-Workspace-MCP\dist\index.js                                  |
| Workspace autorizado       | C:\WS-Workspace                                                    |
| Directorio interno         | C:\WS-Workspace\.ws-workspace                                      |
| Directorio de bloqueos     | C:\WS-Workspace\.ws-workspace\.locks                               |
| Raíz de proyecto           | Directorio separado, autorizado y de sólo lectura (no reproducido) |
| Runtime                    | Node.js LTS v24.18.0                                               |
| Gestor de paquetes         | npm 11.16.0                                                        |
| Ejecutable Node            | C:\Program Files\nodejs\node.exe                                   |
| Cliente MCP                | IBM Bob 2.0.1                                                      |

La ubicación del proyecto fuente observada durante la validación histórica no se reproduce porque es específica del entorno corporativo. En cada instalación debe utilizarse una ruta autorizada y documentada.

## 3. Requisitos previos

1. Windows y acceso a una consola PowerShell nueva.
2. Git y un clon autorizado del repositorio.
3. Permiso para usar el directorio de workspace configurado.
4. Node.js LTS compatible con el rango de motores declarado por el repositorio.
5. IBM Bob instalado y acceso a su configuración MCP local.

No instale dependencias ni altere el workspace hasta confirmar la versión activa de Node y el estado del repositorio.

## 4. Verificar runtime y repositorio

Desde C:\WS-Workspace-MCP, ejecute:

```powershell
node --version
npm.cmd --version
where.exe node
git status --short
git rev-parse HEAD
```

La estación validada informó:

```text
Node.js: v24.18.0
npm: 11.16.0
node.exe: C:\Program Files\nodejs\node.exe
```

Conserve el hash de Git en el registro de instalación. Identifica únicamente el artefacto validado en esa estación, no una versión universal.

## 5. Corregir una versión de Node no compatible

El rango de motores observado acepta ^20.19 || ^22.13 || >=24. En la validación histórica, Node 22.12 produjo una advertencia y se sustituyó por Node LTS 24.18.0.

Primero inspeccione lo instalado:

```powershell
winget --version
winget search OpenJS.NodeJS
winget list --name "Node.js"
winget list --id OpenJS.NodeJS.22 --exact
winget list --id OpenJS.NodeJS.LTS --exact
```

Si la política local autoriza el cambio y existe una instalación incompatible, la secuencia utilizada fue:

```powershell
winget uninstall --id OpenJS.NodeJS.22 --exact
winget install --id OpenJS.NodeJS.LTS --exact --version 24.18.0
```

Cierre y vuelva a abrir PowerShell antes de repetir las comprobaciones del apartado anterior.

No instale Node 26 para reproducir esta validación y no mantenga instalaciones de Node incompatibles en paralelo. No use npm audit fix como sustituto de una actualización controlada del runtime.

## 6. Instalar y compilar el servidor

Tras confirmar el runtime, desde la raíz del repositorio:

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd run build
Test-Path "C:\WS-Workspace-MCP\dist\index.js"
```

La última comprobación debe devolver True. Si falla, no configure IBM Bob: investigue primero el error y conserve la salida en el registro local.

## 7. Configurar IBM Bob

Configure un servidor MCP local con transporte stdio. El formato exacto puede variar según IBM Bob; el contenido esencial es:

```json
{
  "mcpServers": {
    "ws-workspace-mcp": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\WS-Workspace-MCP\\dist\\index.js"],
      "env": {
        "WS_WORKSPACE_ROOT": "C:\\WS-Workspace",
        "WS_PROJECT_SOURCE_ROOT": "C:\\ruta\\autorizada\\de\\proyecto-solo-lectura"
      },
      "alwaysAllowed": ["health_check", "get_server_capabilities"]
    }
  }
}
```

- Declare siempre `WS_WORKSPACE_ROOT` y, para operaciones M5 con sesiones o
  snapshots, `WS_PROJECT_SOURCE_ROOT`.
- La raíz de proyecto es de sólo lectura, debe ser distinta, existente y no
  solaparse con el workspace; nunca se publica su valor corporativo real.
- Mantenga la aprobación permanente limitada a health_check y get_server_capabilities.
- No añada operaciones de escritura, bloqueo, recuperación ni gestión de sesiones a la aprobación permanente.
- No incorpore rutas corporativas de proyectos fuente, credenciales, tokens, URL internas ni datos de producción.

Reinicie o recargue IBM Bob y confirme que muestra el servidor como disponible.

## 8. Smoke test MCP

Ejecute desde IBM Bob, en este orden:

1. health_check.
2. get_server_capabilities.

La respuesta de salud debe identificar el servidor, indicar estado ok, informar la versión de Node y declarar el filesystem como lectura-escritura dentro del root autorizado.

La respuesta de capacidades debe informar:

- esquema de capacidades 1.0.0;
- tipos de work item USER_STORY, DEFECT, INCIDENT y TECHNICAL_TASK;
- integraciones no implementadas: Rally, Copado y base de conocimiento compartida;
- un inventario de capacidades y herramientas coherente con la versión y el commit instalados.

No ejecute herramientas mutantes durante este smoke test. Después de las dos consultas, confirme que C:\WS-Workspace\.ws-workspace\.locks sigue vacío.

### Capacidades observadas en la validación histórica

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

## 9. Verificación de finales de línea

Antes de atribuir cambios a una instalación, inspeccione la configuración y el índice:

```powershell
git config --show-origin --list
git config --show-origin --get-regexp "core|filter|autocrlf|eol|safecrlf"
git ls-files --eol README.md
git ls-files --eol src/filesystem/work-item-operation-coordinator.ts
git ls-files --eol tests/work-item-lock-protocol.test.ts
```

En la estación validada, el índice mostraba LF (i/lf) y el árbol de trabajo CRLF (w/crlf) para archivos de texto. Puede ser normal si la configuración local lo establece y no hay cambios de contenido.

Ante un árbol aparentemente sucio, compruebe primero contenido y diferencias:

```powershell
git rev-parse HEAD:README.md
git hash-object README.md
git diff --ignore-space-at-eol README.md
git diff --summary
git update-index --really-refresh
```

Solo si los hashes prueban que el archivo de trabajo y HEAD son idénticos, no hay trabajo legítimo sin guardar y el problema persiste, un mantenedor experimentado puede reconstruir el índice. Es una recuperación excepcional, no un paso normal de instalación:

```powershell
Copy-Item ".git\index" ".git\index.pre-lf-rebuild.bak"
Remove-Item ".git\index"
git reset --mixed HEAD
```

Antes de usar esta recuperación, revise manualmente el estado de Git y conserve una copia del índice. No la use para ocultar diferencias reales.

## 10. Gestión de bloqueos residuales

Si existen artefactos en C:\WS-Workspace\.ws-workspace\.locks, no los borre como primer paso:

1. Determine que no hay procesos activos asociados.
2. Examine el contenido y clasifique los marcadores como evidencia operacional.
3. Archive una copia fuera de .locks, en una ruta autorizada dentro del workspace.
4. Registre la decisión, la fecha, el responsable y el motivo.
5. Elimine solo marcadores residuales tras revisión humana.
6. Confirme que el directorio operativo de bloqueos queda vacío.

La validación histórica archivó evidencia antes de eliminar dos pares de marcadores residuales. Los identificadores y detalles de proceso se mantienen fuera de esta guía por ser datos operativos específicos del entorno.

## 11. Criterios de aceptación

La instalación queda preparada para validaciones manuales cuando:

- Node y npm coinciden con las versiones aprobadas para el despliegue.
- El servidor compilado existe en la ruta configurada.
- IBM Bob conecta por stdio.
- health_check devuelve estado ok.
- get_server_capabilities devuelve el esquema y el inventario esperados.
- El root autorizado está correctamente acotado.
- La raíz de proyecto M5 está separada y sólo se usa para observación técnica.
- No quedan bloqueos creados por el smoke test.
- Cualquier bloqueo histórico se ha archivado, revisado y retirado de forma controlada.
- El estado de Git y los finales de línea se han entendido, sin ocultar cambios legítimos.

Una diferencia entre el número declarado de herramientas y el listado recibido debe resolverse antes de tomar ese inventario como evidencia de aceptación.

## 12. Operación y mantenimiento

Registre para cada instalación: fecha, operador, versión de IBM Bob, versiones de Node y npm, commit validado, resultado de los dos smoke tests y cualquier incidente con finales de línea o bloqueos.

Esta guía no sustituye la documentación de arquitectura, seguridad, operaciones
ni las pruebas formales del repositorio. Se conserva como referencia operativa;
el registro histórico de instalación está en
[VALIDATION_CORPORATE_INSTALLATION_2026-07-30.md](VALIDATION_CORPORATE_INSTALLATION_2026-07-30.md)
y el cierre oficial de M5 en [Pruebas_Milestone_5.md](Pruebas_Milestone_5.md).
