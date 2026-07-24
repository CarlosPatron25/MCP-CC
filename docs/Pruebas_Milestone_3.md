# Pruebas de Validación — Milestone 3

**Fecha de ejecución:** 2026-07-22  
**Operador:** IBM Bob  
**Work Item de referencia:** `MANUAL-M3-VALIDATION-001`  
**Servidor MCP bajo prueba:** `ws-workspace-mcp`

---

## Resumen ejecutivo

Batería de pruebas manuales ejecutada mediante IBM Bob sobre el servidor MCP `ws-workspace-mcp` para validar el ciclo documental completo implementado en Milestone 3. Todas las operaciones fueron invocadas exclusivamente a través de herramientas MCP, sin escrituras directas de ficheros ni uso de terminal.

---

## Prueba 1 — get_server_capabilities

**Pregunta:** Utiliza la herramienta MCP `get_server_capabilities` del servidor `ws-workspace-mcp` y muéstrame la lista completa de operaciones disponibles.

**Resultado:**

```json
{
  "schemaVersion": "1.0.0",
  "capabilities": [
    "local-stdio-mcp",
    "secure-workspace-initialization",
    "foundation-work-item-domain-model",
    "secure-work-item-creation",
    "controlled-document-lifecycle",
    "document-revision-control",
    "derived-ai-context-projection"
  ],
  "availableTools": [
    { "name": "health_check", "mutatesFilesystem": false },
    { "name": "get_server_capabilities", "mutatesFilesystem": false },
    { "name": "initialize_workspace", "mutatesFilesystem": true },
    { "name": "create_work_item", "mutatesFilesystem": true },
    { "name": "initialize_work_item_documents", "mutatesFilesystem": true },
    { "name": "get_work_item_document", "mutatesFilesystem": false },
    { "name": "update_work_item_document", "mutatesFilesystem": true },
    { "name": "refresh_ai_context", "mutatesFilesystem": true }
  ],
  "notImplemented": [
    "close_work_item",
    "reopen_work_item",
    "record_decision",
    "create_checkpoint",
    "rally-integration",
    "copado-integration"
  ],
  "supportedWorkItemTypes": ["USER_STORY", "DEFECT", "INCIDENT", "TECHNICAL_TASK"]
}
```

**Veredicto:** ✅ PASS — 8 herramientas disponibles, 6 operaciones diferidas declaradas, 4 tipos de Work Item soportados.

---

## Prueba 2 — health_check

**Pregunta:** Llama realmente a la herramienta MCP `health_check` de `ws-workspace-mcp`. Devuélveme el resultado exacto y confirma si aparece alguna ruta absoluta.

**Resultado:**

```json
{
  "serverName": "ws-workspace-mcp",
  "version": "0.1.0",
  "status": "ok",
  "checkedAt": "2026-07-22T15:11:08.369Z",
  "nodeVersion": "v24.18.0",
  "authorizedRoot": {
    "displayName": "WS-Workspace",
    "absolutePathHidden": true
  },
  "filesystemAccess": "read-write"
}
```

**Veredicto:** ✅ PASS — Estado `ok`. Ninguna ruta absoluta expuesta; `absolutePathHidden: true` confirma protección activa.

---

## Prueba 3 — initialize_workspace (primera ejecución)

**Pregunta:** Ejecuta `initialize_workspace` una vez sobre el workspace autorizado y muéstrame el resultado.

**Resultado:**

```json
{
  "directories": [
    { "path": ".ws-workspace", "status": "existing" },
    { "path": ".ws-workspace\\active", "status": "existing" },
    { "path": ".ws-workspace\\archive", "status": "existing" },
    { "path": ".ws-workspace\\config", "status": "existing" }
  ],
  "readme": { "path": ".ws-workspace\\README.md", "status": "existing" },
  "created": [],
  "existing": [
    ".ws-workspace",
    ".ws-workspace\\active",
    ".ws-workspace\\archive",
    ".ws-workspace\\config",
    ".ws-workspace\\README.md"
  ]
}
```

**Veredicto:** ✅ PASS — Workspace ya inicializado. `created: []`, todos los artefactos en estado `existing`.

---

## Prueba 4 — initialize_workspace (idempotencia)

**Pregunta:** Ejecuta `initialize_workspace` una segunda vez y confirma que el resultado es idempotente y que no se ha sobrescrito ni eliminado ningún contenido.

**Resultado:** Idéntico al de la Prueba 3.

```json
{
  "created": [],
  "existing": [
    ".ws-workspace",
    ".ws-workspace\\active",
    ".ws-workspace\\archive",
    ".ws-workspace\\config",
    ".ws-workspace\\README.md"
  ]
}
```

**Veredicto:** ✅ PASS — Resultado byte a byte idéntico. Ningún fichero creado, sobrescrito ni eliminado.

---

## Prueba 5 — create_work_item

**Pregunta:** Llama a `create_work_item` con los siguientes datos:

- `type: TECHNICAL_TASK`
- `rallyId: MANUAL-M3-VALIDATION-001`
- `title: Validación manual de Milestone 3`
- `functionalDefinition: Validar mediante IBM Bob el ciclo documental implementado en Milestone 3.`
- `developmentAlias: local-validation`
- `relatedComponents: [ws-workspace-mcp]`
- `startedAt: 2026-07-22`
- `acceptanceCriteria: [Las cuatro operaciones de Milestone 3 funcionan mediante IBM Bob., Las revisiones obsoletas se rechazan., Ninguna respuesta expone rutas absolutas.]`

**Resultado:**

```json
{
  "id": "MANUAL-M3-VALIDATION-001",
  "rallyId": "MANUAL-M3-VALIDATION-001",
  "type": "TECHNICAL_TASK",
  "status": "DRAFT",
  "createdAt": "2026-07-22T15:13:36.625Z",
  "updatedAt": "2026-07-22T15:13:36.625Z",
  "workItemPath": ".ws-workspace\\active\\MANUAL-M3-VALIDATION-001",
  "createdFiles": [
    ".ws-workspace\\active\\MANUAL-M3-VALIDATION-001\\WORK_ITEM.yml",
    ".ws-workspace\\active\\MANUAL-M3-VALIDATION-001\\00_MANIFEST.md",
    ".ws-workspace\\active\\MANUAL-M3-VALIDATION-001\\01_FUNCTIONAL_ANALYSIS.md",
    ".ws-workspace\\active\\MANUAL-M3-VALIDATION-001\\context\\AI_CONTEXT.md",
    ".ws-workspace\\active\\MANUAL-M3-VALIDATION-001\\context\\AI_RULES.md",
    ".ws-workspace\\active\\MANUAL-M3-VALIDATION-001\\context\\NEXT_TASK.md"
  ],
  "createdDirectories": [
    ".ws-workspace\\active\\MANUAL-M3-VALIDATION-001",
    ".ws-workspace\\active\\MANUAL-M3-VALIDATION-001\\context",
    ".ws-workspace\\active\\MANUAL-M3-VALIDATION-001\\evidence",
    ".ws-workspace\\active\\MANUAL-M3-VALIDATION-001\\snapshots"
  ]
}
```

**Veredicto:** ✅ PASS — Dossier creado con 6 ficheros y 4 directorios. Estado inicial `DRAFT`.

---

## Prueba 6 — create_work_item (protección frente a duplicados)

**Pregunta:** Repite exactamente la misma llamada a `create_work_item` para comprobar la protección frente a duplicados.

**Resultado:**

```json
{
  "error": {
    "code": "WORK_ITEM_ALREADY_EXISTS",
    "message": "A Work Item with this identifier already exists."
  }
}
```

**Veredicto:** ✅ PASS — Error tipado `WORK_ITEM_ALREADY_EXISTS`. Ningún fichero sobrescrito. Dossier original intacto.

---

## Prueba 7 — initialize_work_item_documents (primera ejecución)

**Pregunta:** Llama a `initialize_work_item_documents` para el Work Item `MANUAL-M3-VALIDATION-001`.

**Resultado:**

```json
{
  "workItemId": "MANUAL-M3-VALIDATION-001",
  "created": [
    {
      "documentType": "CURRENT_STATE",
      "relativePath": "02_CURRENT_STATE.md",
      "status": "INITIALIZED",
      "revision": 1,
      "contentType": "TEMPLATE"
    },
    {
      "documentType": "TECHNICAL_ANALYSIS",
      "relativePath": "03_TECHNICAL_ANALYSIS.md",
      "status": "INITIALIZED",
      "revision": 1,
      "contentType": "TEMPLATE"
    },
    {
      "documentType": "IMPACT_ANALYSIS",
      "relativePath": "04_IMPACT_ANALYSIS.md",
      "status": "INITIALIZED",
      "revision": 1,
      "contentType": "TEMPLATE"
    },
    {
      "documentType": "IMPLEMENTATION_PLAN",
      "relativePath": "05_IMPLEMENTATION_PLAN.md",
      "status": "INITIALIZED",
      "revision": 1,
      "contentType": "TEMPLATE"
    }
  ],
  "existing": []
}
```

**Veredicto:** ✅ PASS — 4 documentos creados desde plantilla, todos en revisión 1. `existing: []`.

---

## Prueba 8 — initialize_work_item_documents (idempotencia)

**Pregunta:** Vuelve a ejecutar `initialize_work_item_documents` para el mismo Work Item. Confirma que ningún documento existente se sobrescribe.

**Resultado:** `created: []`, los 7 documentos reportados bajo `existing` con sus revisiones inalteradas.

**Veredicto:** ✅ PASS — Operación idempotente. Ningún documento recreado ni sobreescrito.

---

## Prueba 9 — get_work_item_document (CURRENT_STATE)

**Pregunta:** Llama a `get_work_item_document` para el tipo `CURRENT_STATE` del Work Item `MANUAL-M3-VALIDATION-001`.

**Metadatos devueltos:**

| Campo          | Valor                 |
| -------------- | --------------------- |
| `documentType` | `CURRENT_STATE`       |
| `relativePath` | `02_CURRENT_STATE.md` |
| `status`       | `INITIALIZED`         |
| `revision`     | `1`                   |
| `contentType`  | `TEMPLATE`            |
| `updatedBy`    | `SYSTEM`              |

**Veredicto:** ✅ PASS — Documento leído correctamente. Contenido generado desde plantilla con los datos del dossier.

---

## Prueba 10 — update_work_item_document (revisión correcta)

**Pregunta:** Actualiza el documento `CURRENT_STATE` usando `expectedRevision: 1` con los siguientes datos:

- `knownFacts`: Milestone 3 está implementado y validado automáticamente. / La validación manual se está ejecutando mediante IBM Bob.
- `constraints`: La persistencia continúa siendo local. / El Work Item debe permanecer en DRAFT.
- `openQuestions`: Ninguna durante esta validación.

**Resultado:**

```json
{
  "workItemId": "MANUAL-M3-VALIDATION-001",
  "document": {
    "documentType": "CURRENT_STATE",
    "relativePath": "02_CURRENT_STATE.md",
    "status": "UPDATED",
    "revision": 2,
    "updatedAt": "2026-07-22T15:18:44.828Z",
    "contentType": "SUPPLIED"
  }
}
```

**Veredicto:** ✅ PASS — Documento actualizado a revisión 2. Estado `UPDATED`, `contentType` cambia de `TEMPLATE` a `SUPPLIED`.

> **Nota:** Los primeros dos intentos fallaron por uso incorrecto del esquema del payload (campo `knownFacts` es requerido como `string[]`; `documentType` no debe incluirse dentro del payload). Corregido tras inspección del contrato en `src/domain/work-item-document.ts`.

---

## Prueba 11 — get_work_item_document (verificación post-update)

**Pregunta:** Vuelve a leer `CURRENT_STATE` mediante `get_work_item_document` y confirma que la revisión y el contenido coinciden con la actualización anterior.

**Resultado:** Revisión `2`, estado `UPDATED`, `contentType: SUPPLIED`. Las tres secciones editadas (`Known implementation context`, `Constraints`, `Open questions`) contienen exactamente el contenido suministrado.

**Veredicto:** ✅ PASS — Persistencia confirmada. Ningún dato perdido ni alterado.

---

## Prueba 12 — update_work_item_document (revisión obsoleta)

**Pregunta:** Intenta actualizar `CURRENT_STATE` utilizando deliberadamente `expectedRevision: 1` (revisión obsoleta).

**Resultado:**

```json
{
  "error": {
    "code": "DOCUMENT_REVISION_CONFLICT",
    "message": "The document revision does not match the current version."
  }
}
```

**Veredicto:** ✅ PASS — Error tipado `DOCUMENT_REVISION_CONFLICT`. El contenido falso no fue persistido. El documento permanece en revisión 2.

---

## Prueba 13 — get_work_item_document (AI_CONTEXT, revisión base)

**Pregunta:** Llama a `get_work_item_document` para el tipo `AI_CONTEXT` y anota su revisión actual.

**Resultado:** `AI_CONTEXT` en revisión `1`, estado `CREATED`, `contentType: DERIVED`. Contenido proyectado únicamente desde los datos iniciales del dossier.

**Veredicto:** ✅ PASS — Documento derivado leído correctamente en su estado inicial.

---

## Prueba 14 — refresh_ai_context (revisión correcta)

**Pregunta:** Llama a `refresh_ai_context` para el Work Item `MANUAL-M3-VALIDATION-001` utilizando `expectedRevision: 1`.

**Resultado:**

```json
{
  "workItemId": "MANUAL-M3-VALIDATION-001",
  "document": {
    "documentType": "AI_CONTEXT",
    "relativePath": "context/AI_CONTEXT.md",
    "status": "UPDATED",
    "revision": 2,
    "updatedAt": "2026-07-22T15:22:26.707Z",
    "contentType": "DERIVED"
  }
}
```

**Veredicto:** ✅ PASS — `AI_CONTEXT` actualizado a revisión 2. Re-proyección desde hechos persistidos aprobados.

---

## Prueba 15 — get_work_item_document (AI_CONTEXT, revisión actualizada)

**Pregunta:** Lee nuevamente `AI_CONTEXT` y confirma su nueva revisión y qué datos persistidos han sido proyectados.

**Resultado:** Revisión `2`, estado `UPDATED`. Nuevas secciones proyectadas respecto a revisión 1:

- `## Work Item` — ahora incluye título, `startedAt` y `plannedCompletionAt`.
- `## Persisted functional analysis` — proyección completa de `01_FUNCTIONAL_ANALYSIS.md` incluyendo los 3 criterios de aceptación.
- `## Managed document lifecycle` — tabla con los 7 documentos gestionados y su estado actual.

**Veredicto:** ✅ PASS — Proyección enriquecida correctamente desde los hechos aprobados. `contentType` permanece `DERIVED`.

---

## Prueba 16 — refresh_ai_context (revisión obsoleta)

**Pregunta:** Intenta repetir `refresh_ai_context` utilizando deliberadamente la revisión antigua `1`.

**Resultado:**

```json
{
  "error": {
    "code": "DOCUMENT_REVISION_CONFLICT",
    "message": "The document revision does not match the current version."
  }
}
```

**Veredicto:** ✅ PASS — Control de concurrencia optimista aplicado también en `refresh_ai_context`. `AI_CONTEXT` permanece en revisión 2 intacto.

---

## Prueba 17 — get_work_item_document (tipo inexistente)

**Pregunta:** Intenta llamar a `get_work_item_document` con un tipo documental inexistente: `TEST_PLAN`.

**Resultado:**

```json
{
  "error": {
    "code": "DOCUMENT_TYPE_UNSUPPORTED",
    "message": "The requested document type is not supported."
  }
}
```

**Veredicto:** ✅ PASS — Error tipado `DOCUMENT_TYPE_UNSUPPORTED`. Ninguna información interna expuesta.

---

## Prueba 18 — update_work_item_document sobre documento derivado (AI_CONTEXT)

**Pregunta:** Intenta llamar a `update_work_item_document` utilizando `AI_CONTEXT` como tipo documental.

**Resultado:**

```json
{
  "error": {
    "code": "DOCUMENT_TYPE_UNSUPPORTED",
    "message": "The requested document type is not editable."
  }
}
```

**Veredicto:** ✅ PASS — Los documentos derivados (`AI_CONTEXT`, `MANIFEST`) no son editables directamente. Inmutabilidad garantizada por el servidor.

---

## Prueba 19 — update_work_item_document con campos extra no permitidos

**Pregunta:** Intenta actualizar `CURRENT_STATE` incluyendo campos adicionales `decisions` y `actualCompletionAt`.

**Resultado:**

```json
{
  "error": {
    "code": "DOCUMENT_VALIDATION_FAILED",
    "message": "The document request is invalid.",
    "details": { "field": "input" }
  }
}
```

**Veredicto:** ✅ PASS — Validación de esquema estricta. Campos fuera del contrato `CurrentStateDocumentPayload` son rechazados. Documento permanece en revisión 2 intacto.

---

## Resultado global

| #   | Prueba                                                   | Veredicto |
| --- | -------------------------------------------------------- | --------- |
| 1   | get_server_capabilities                                  | ✅ PASS   |
| 2   | health_check — sin rutas absolutas                       | ✅ PASS   |
| 3   | initialize_workspace (primera vez)                       | ✅ PASS   |
| 4   | initialize_workspace (idempotencia)                      | ✅ PASS   |
| 5   | create_work_item                                         | ✅ PASS   |
| 6   | create_work_item (duplicado rechazado)                   | ✅ PASS   |
| 7   | initialize_work_item_documents (primera vez)             | ✅ PASS   |
| 8   | initialize_work_item_documents (idempotencia)            | ✅ PASS   |
| 9   | get_work_item_document — CURRENT_STATE                   | ✅ PASS   |
| 10  | update_work_item_document — revisión correcta            | ✅ PASS   |
| 11  | get_work_item_document — verificación post-update        | ✅ PASS   |
| 12  | update_work_item_document — revisión obsoleta rechazada  | ✅ PASS   |
| 13  | get_work_item_document — AI_CONTEXT base                 | ✅ PASS   |
| 14  | refresh_ai_context — revisión correcta                   | ✅ PASS   |
| 15  | get_work_item_document — AI_CONTEXT actualizado          | ✅ PASS   |
| 16  | refresh_ai_context — revisión obsoleta rechazada         | ✅ PASS   |
| 17  | get_work_item_document — tipo inexistente rechazado      | ✅ PASS   |
| 18  | update_work_item_document — documento derivado rechazado | ✅ PASS   |
| 19  | update_work_item_document — campos extra rechazados      | ✅ PASS   |

**19 / 19 pruebas superadas. Milestone 3 validado.**

---

## Criterios de aceptación — estado final

| Criterio                                                         | Estado                                           |
| ---------------------------------------------------------------- | ------------------------------------------------ |
| Las cuatro operaciones de Milestone 3 funcionan mediante IBM Bob | ✅ Verificado (pruebas 7, 9, 10, 14)             |
| Las revisiones obsoletas se rechazan                             | ✅ Verificado (pruebas 12, 16)                   |
| Ninguna respuesta expone rutas absolutas                         | ✅ Verificado (pruebas 2, 6, 12, 16, 17, 18, 19) |
