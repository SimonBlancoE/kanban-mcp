# Claude Kanban MCP

[![npm version](https://badge.fury.io/js/@simonblanco%2Fkanban-mcp.svg)](https://www.npmjs.com/package/@simonblanco/kanban-mcp)

Un servidor MCP (Model Context Protocol) que proporciona un tablero Kanban para coordinación de agentes de IA, con un visor web en tiempo real para supervisión humana.

## Características

- **MCP Server**: 8 herramientas para gestión de tareas
- **Roles**: Architect (control total) y Agent (tareas propias)
- **4 columnas**: Backlog, In Progress, Blocked, Done
- **Visor web**: Actualización en tiempo real via WebSocket
- **Persistencia**: Archivo JSON automático

---

## Instalación

### Requisitos
- [Bun](https://bun.sh) v1.0+

### Opción 1: Via npm/npx (Recomendado)

```bash
# Añadir a Claude Code directamente
claude mcp add kanban -- bunx @simonblanco/kanban-mcp

# O ejecutar manualmente
bunx @simonblanco/kanban-mcp
```

### Opción 2: Instalación global

```bash
# Instalar globalmente
bun add -g @simonblanco/kanban-mcp

# Ejecutar
kanban-mcp
```

### Opción 3: Desde el código fuente

```bash
# Clonar el repositorio
git clone https://github.com/SimonBlancoE/kanban-mcp
cd kanban-mcp

# Instalar dependencias
bun install

# Iniciar el servidor
bun run src/index.ts
```

El visor web estará disponible en: **http://localhost:3456**

---

## Configurar en Claude Code

### Método automático (recomendado)

```bash
claude mcp add kanban -- bunx @simonblanco/kanban-mcp
```

### Método manual

Añade a tu archivo de configuración MCP (`~/.config/claude/settings.json`):

```json
{
  "mcpServers": {
    "kanban": {
      "command": "bunx",
      "args": ["@simonblanco/kanban-mcp"]
    }
  }
}
```

**Alternativa (desde código fuente):**

```json
{
  "mcpServers": {
    "kanban": {
      "command": "bun",
      "args": ["run", "/ruta/completa/al/proyecto/src/index.ts"]
    }
  }
}
```

---

## Onboarding en Proyectos Existentes

Si quieres incorporar el Kanban a un proyecto que ya está en desarrollo, sigue este proceso:

### Paso 1: Sesión de análisis con el Architect

Inicia una sesión con el Architect para que analice el proyecto y cree el backlog inicial:

```
Eres el Architect de este proyecto. Tu primera tarea es analizar el estado
actual y crear el backlog inicial en el Kanban.

Revisa:
1. El código existente (estructura, qué está implementado)
2. Issues/TODOs pendientes en el código
3. README o documentación existente
4. Cualquier archivo de planificación que exista

Luego usa las herramientas kanban_* para:
- Crear tareas para el trabajo pendiente (en backlog)
- Crear tareas para bugs conocidos (en backlog, con descripción clara)
- Si hay trabajo "a medias", créalo en in_progress
- Si hay bloqueos conocidos, documéntalos en blocked

Usa IDs de agentes genéricos por ahora: agent-alpha, agent-beta, agent-gamma.
No asignes tareas aún, solo crea el backlog.
```

### Paso 2: Revisión y asignación

Una vez el Architect ha creado el backlog:

1. **Revisa el tablero** en http://localhost:3456
2. **Ajusta prioridades** si es necesario (el Architect puede reordenar)
3. **Asigna tareas** a los agentes disponibles

### Paso 3: Trabajo con agentes

**Opción A - Un agente a la vez:**
```
[Incluir instrucciones de Agent en system prompt]

Tu ID es "agent-alpha".
Consulta el Kanban para ver qué tareas tienes asignadas.
Toma la primera del backlog, muévela a in_progress, y trabaja en ella.
```

**Opción B - Múltiples agentes en paralelo:**
Cada agente en su propia sesión con su ID único. El Architect distribuye tareas y cada agente trabaja independientemente.

### Flujo continuo

```
┌─────────────────────────────────────────────────────────────┐
│                        ARCHITECT                             │
│  - Analiza el proyecto                                      │
│  - Crea tareas en backlog                                   │
│  - Asigna a agentes disponibles                             │
│  - Monitorea progreso y resuelve bloqueos                   │
│  - Valida y cierra tareas completadas                       │
└──────────────────────────┬──────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
     ┌──────────┐    ┌──────────┐    ┌──────────┐
     │ Agent α  │    │ Agent β  │    │ Agent γ  │
     │ backlog→ │    │ backlog→ │    │ backlog→ │
     │ progress→│    │ progress→│    │ progress→│
     │ done     │    │ blocked  │    │ done     │
     └──────────┘    └──────────┘    └──────────┘

              ┌──────────────────────────┐
              │     SUPERVISOR (Tú)      │
              │  http://localhost:3456   │
              │  Solo observa el estado  │
              └──────────────────────────┘
```

---

## Herramientas MCP

| Herramienta | Architect | Agent | Descripción |
|-------------|:---------:|:-----:|-------------|
| `kanban_list_tasks` | ✅ todas | ✅ solo suyas | Listar tareas |
| `kanban_get_task` | ✅ | ✅ solo suyas | Obtener detalle de tarea |
| `kanban_create_task` | ✅ | ❌ | Crear nueva tarea |
| `kanban_update_task` | ✅ | ✅ solo suyas | Editar título/descripción |
| `kanban_assign_task` | ✅ | ❌ | Asignar/reasignar tarea |
| `kanban_move_task` | ✅ | ✅ solo suyas | Mover entre columnas |
| `kanban_delete_task` | ✅ | ❌ | Eliminar tarea |
| `kanban_get_stats` | ✅ | ✅ | Estadísticas del tablero |

---

## Instrucciones para System Prompts

### Para el ARCHITECT (Supervisor de Agentes)

Copia esto en el system prompt del agente que actúe como Architect:

```markdown
## Kanban Board Management

Tienes acceso a un tablero Kanban compartido para coordinar el trabajo de múltiples agentes.
Tu rol es **architect** - tienes control total sobre el tablero.

### Columnas disponibles
- `backlog`: Tareas pendientes de iniciar
- `in_progress`: Tareas en desarrollo activo
- `blocked`: Tareas bloqueadas por dependencias o problemas
- `done`: Tareas completadas

### Herramientas disponibles

**Gestión de tareas:**
- `kanban_create_task`: Crear tarea nueva
  - Parámetros: `role: "architect"`, `title`, `description?`, `assignee?`, `column?`
  - El `assignee` debe ser el ID del agente (ej: "agent-alpha", "agent-beta")

- `kanban_update_task`: Editar título o descripción
  - Parámetros: `role: "architect"`, `taskId`, `title?`, `description?`

- `kanban_assign_task`: Asignar tarea a un agente
  - Parámetros: `role: "architect"`, `taskId`, `assignee` (o `null` para desasignar)

- `kanban_move_task`: Cambiar columna de una tarea
  - Parámetros: `role: "architect"`, `taskId`, `column`

- `kanban_delete_task`: Eliminar una tarea
  - Parámetros: `role: "architect"`, `taskId`

**Consultas:**
- `kanban_list_tasks`: Ver todas las tareas
  - Parámetros: `role: "architect"`, `column?` (filtro opcional)

- `kanban_get_task`: Ver detalle de una tarea
  - Parámetros: `role: "architect"`, `taskId`

- `kanban_get_stats`: Ver estadísticas del tablero
  - Parámetros: `role: "architect"`

### Flujo de trabajo recomendado

1. Al iniciar, consulta `kanban_get_stats` para ver el estado general
2. Usa `kanban_list_tasks` para ver tareas pendientes o bloqueadas
3. Crea tareas en `backlog` y asígnalas a agentes disponibles
4. Monitorea el progreso y mueve tareas bloqueadas según sea necesario
5. Cuando un agente reporta finalización, verifica y mueve a `done`

### Convención de IDs de agentes
Usa IDs consistentes para los agentes: "agent-alpha", "agent-beta", "agent-gamma", etc.
```

---

### Para los AGENTS (Trabajadores)

Copia esto en el system prompt de cada agente trabajador:

```markdown
## Kanban Board - Agent Instructions

Tienes acceso a un tablero Kanban compartido donde recibes y reportas tareas.
Tu rol es **agent** con ID: `[REEMPLAZAR_CON_ID_DEL_AGENTE]`

### Columnas del tablero
- `backlog`: Tareas asignadas pendientes de iniciar
- `in_progress`: Tareas en las que estás trabajando activamente
- `blocked`: Tareas que no puedes continuar (indica el motivo)
- `done`: Tareas que has completado

### Herramientas disponibles

**Ver tus tareas:**
- `kanban_list_tasks`: Ver tareas asignadas a ti
  - Parámetros: `role: "agent"`, `agentId: "[TU_ID]"`, `column?`

- `kanban_get_task`: Ver detalle de una tarea tuya
  - Parámetros: `role: "agent"`, `agentId: "[TU_ID]"`, `taskId`

**Actualizar tus tareas:**
- `kanban_move_task`: Cambiar estado de tu tarea
  - Parámetros: `role: "agent"`, `agentId: "[TU_ID]"`, `taskId`, `column`
  - Usa esto para indicar progreso: backlog → in_progress → done
  - Si te bloqueas: mueve a `blocked`

- `kanban_update_task`: Actualizar descripción (para notas de progreso)
  - Parámetros: `role: "agent"`, `agentId: "[TU_ID]"`, `taskId`, `description`

**Estadísticas:**
- `kanban_get_stats`: Ver resumen del tablero
  - Parámetros: `role: "agent"`

### Flujo de trabajo

1. **Al iniciar**: Consulta `kanban_list_tasks` con `column: "backlog"` para ver tareas pendientes
2. **Al comenzar una tarea**: Muévela a `in_progress`
3. **Durante el trabajo**: Actualiza la descripción con notas de progreso si es útil
4. **Si te bloqueas**: Mueve a `blocked` y actualiza descripción explicando el problema
5. **Al terminar**: Mueve a `done`

### Importante
- Solo puedes ver y modificar tareas asignadas a ti
- No puedes crear, eliminar ni reasignar tareas (solo el Architect)
- Siempre incluye tu `agentId` en cada llamada
```

**Nota**: Reemplaza `[TU_ID]` o `[REEMPLAZAR_CON_ID_DEL_AGENTE]` con el ID real del agente (ej: `agent-alpha`).

---

## Estructura del Proyecto

```
claude-kanban-mcp/
├── package.json
├── tsconfig.json
├── README.md
├── data/
│   └── kanban.json           # Datos persistidos (auto-generado)
├── src/
│   ├── index.ts              # Entry point
│   ├── types.ts              # TypeScript interfaces + Zod schemas
│   ├── store.ts              # Capa de persistencia
│   ├── mcp/
│   │   ├── server.ts         # Configuración MCP
│   │   └── tools.ts          # Definición de herramientas
│   └── web/
│       ├── server.ts         # HTTP + WebSocket server
│       └── broadcast.ts      # WebSocket broadcasting
└── public/
    ├── index.html            # Visor Kanban
    ├── styles.css            # Estilos
    └── app.js                # Cliente WebSocket
```

---

## API REST (opcional)

El visor web expone endpoints REST para debugging:

- `GET /api/board` - Estado completo del tablero
- `GET /api/stats` - Estadísticas

---

## Configuración

### Puerto personalizado

```bash
PORT=8080 bun run src/index.ts
```

### Ubicación de datos

Los datos se guardan en `./data/kanban.json` relativo al directorio de ejecución.

---

## Visor Web

El visor es **pasivo** (solo lectura):
- Muestra las 4 columnas con colores diferenciados
- Actualización automática via WebSocket
- Estadísticas en el header
- Descripción de tareas visible al pasar el mouse

Colores de columnas:
- **Backlog**: Gris
- **In Progress**: Azul
- **Blocked**: Rojo
- **Done**: Verde

---

## Ejemplo de Uso

### Architect crea y asigna tareas:

```json
// Crear tarea
{
  "role": "architect",
  "title": "Implementar autenticación OAuth",
  "description": "Añadir login con Google y GitHub",
  "assignee": "agent-alpha",
  "column": "backlog"
}

// Reasignar tarea
{
  "role": "architect",
  "taskId": "uuid-de-la-tarea",
  "assignee": "agent-beta"
}
```

### Agent trabaja en su tarea:

```json
// Ver mis tareas pendientes
{
  "role": "agent",
  "agentId": "agent-alpha",
  "column": "backlog"
}

// Comenzar a trabajar
{
  "role": "agent",
  "agentId": "agent-alpha",
  "taskId": "uuid-de-la-tarea",
  "column": "in_progress"
}

// Marcar como completada
{
  "role": "agent",
  "agentId": "agent-alpha",
  "taskId": "uuid-de-la-tarea",
  "column": "done"
}
```

---

## Licencia

MIT
