import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "crypto";
import { store } from "../store";
import { broadcaster } from "../web/broadcast";
import { ColumnSchema, RoleSchema, type Column, type Task } from "../types";

/**
 * Helper para respuestas de error
 */
function errorResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Helper para respuestas de éxito
 */
function successResponse(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Registra todas las herramientas MCP en el servidor
 */
export function registerTools(server: McpServer): void {
  // ═══════════════════════════════════════════════════════════════════════════
  // KANBAN_LIST_TASKS - Listar tareas
  // Architect: ve todas las tareas
  // Agent: solo ve sus tareas asignadas
  // ═══════════════════════════════════════════════════════════════════════════
  server.tool(
    "kanban_list_tasks",
    "List tasks on the Kanban board. Architects see all tasks; agents see only their assigned tasks.",
    {
      role: RoleSchema.describe("Your role: 'architect' or 'agent'"),
      agentId: z
        .string()
        .optional()
        .describe("Agent ID (required for agent role)"),
      column: ColumnSchema.optional().describe(
        "Filter by column: backlog, in_progress, blocked, done"
      ),
    },
    async ({ role, agentId, column }) => {
      const filter: { column?: Column; assignee?: string } = {};

      if (column) filter.column = column;

      // Agents solo ven sus propias tareas
      if (role === "agent") {
        if (!agentId) {
          return errorResponse("agentId is required for agent role");
        }
        filter.assignee = agentId;
      }

      const tasks = store.getTasks(filter);
      return successResponse({
        count: tasks.length,
        tasks,
      });
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // KANBAN_GET_TASK - Obtener detalle de una tarea
  // ═══════════════════════════════════════════════════════════════════════════
  server.tool(
    "kanban_get_task",
    "Get details of a specific task by ID.",
    {
      role: RoleSchema.describe("Your role: 'architect' or 'agent'"),
      agentId: z
        .string()
        .optional()
        .describe("Agent ID (required for agent role)"),
      taskId: z.string().uuid().describe("Task ID to retrieve"),
    },
    async ({ role, agentId, taskId }) => {
      const task = store.getTask(taskId);

      if (!task) {
        return errorResponse(`Task not found: ${taskId}`);
      }

      // Agents solo pueden ver sus propias tareas
      if (role === "agent") {
        if (!agentId) {
          return errorResponse("agentId is required for agent role");
        }
        if (task.assignee !== agentId) {
          return errorResponse("Access denied: task is not assigned to you");
        }
      }

      return successResponse(task);
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // KANBAN_CREATE_TASK - Crear nueva tarea (solo Architect)
  // ═══════════════════════════════════════════════════════════════════════════
  server.tool(
    "kanban_create_task",
    "Create a new task (Architect only). Tasks start in backlog by default.",
    {
      role: z.literal("architect").describe("Must be 'architect'"),
      title: z.string().min(1).max(200).describe("Task title (required)"),
      description: z
        .string()
        .max(2000)
        .optional()
        .describe("Task description"),
      assignee: z.string().nullable().optional().describe("Assign to agent ID"),
      column: ColumnSchema.optional()
        .default("backlog")
        .describe("Initial column (default: backlog)"),
    },
    async ({ title, description, assignee, column }) => {
      const now = new Date().toISOString();
      const task: Task = {
        id: randomUUID(),
        title,
        description: description ?? "",
        assignee: assignee ?? null,
        column: column ?? "backlog",
        createdAt: now,
        updatedAt: now,
      };

      store.addTask(task);
      await store.persist();

      // Notificar a los visores web
      broadcaster.broadcast("task_created", task);

      return successResponse({
        message: "Task created successfully",
        task,
      });
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // KANBAN_UPDATE_TASK - Actualizar título/descripción
  // Architect: puede editar cualquier tarea
  // Agent: solo puede editar sus tareas asignadas
  // ═══════════════════════════════════════════════════════════════════════════
  server.tool(
    "kanban_update_task",
    "Update a task's title or description. Agents can only update their own tasks.",
    {
      role: RoleSchema.describe("Your role: 'architect' or 'agent'"),
      agentId: z
        .string()
        .optional()
        .describe("Agent ID (required for agent role)"),
      taskId: z.string().uuid().describe("Task ID to update"),
      title: z.string().min(1).max(200).optional().describe("New title"),
      description: z.string().max(2000).optional().describe("New description"),
    },
    async ({ role, agentId, taskId, title, description }) => {
      const task = store.getTask(taskId);

      if (!task) {
        return errorResponse(`Task not found: ${taskId}`);
      }

      // Validar permisos para agents
      if (role === "agent") {
        if (!agentId) {
          return errorResponse("agentId is required for agent role");
        }
        if (task.assignee !== agentId) {
          return errorResponse("Access denied: task is not assigned to you");
        }
      }

      // Aplicar actualizaciones
      const updates: Partial<Task> = {};
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;

      if (Object.keys(updates).length === 0) {
        return errorResponse("No updates provided");
      }

      const updatedTask = store.updateTask(taskId, updates);
      await store.persist();

      // Notificar a los visores web
      broadcaster.broadcast("task_updated", updatedTask);

      return successResponse({
        message: "Task updated successfully",
        task: updatedTask,
      });
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // KANBAN_ASSIGN_TASK - Asignar/reasignar tarea (solo Architect)
  // ═══════════════════════════════════════════════════════════════════════════
  server.tool(
    "kanban_assign_task",
    "Assign or reassign a task to an agent (Architect only). Pass null to unassign.",
    {
      role: z.literal("architect").describe("Must be 'architect'"),
      taskId: z.string().uuid().describe("Task ID to assign"),
      assignee: z
        .string()
        .nullable()
        .describe("Agent ID to assign, or null to unassign"),
    },
    async ({ taskId, assignee }) => {
      const task = store.getTask(taskId);

      if (!task) {
        return errorResponse(`Task not found: ${taskId}`);
      }

      const previousAssignee = task.assignee;
      const updatedTask = store.updateTask(taskId, { assignee });
      await store.persist();

      // Notificar a los visores web
      broadcaster.broadcast("task_updated", updatedTask);

      return successResponse({
        message: assignee
          ? `Task assigned to ${assignee}`
          : "Task unassigned",
        previousAssignee,
        task: updatedTask,
      });
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // KANBAN_MOVE_TASK - Mover tarea entre columnas
  // Architect: puede mover cualquier tarea
  // Agent: solo puede mover sus tareas asignadas
  // ═══════════════════════════════════════════════════════════════════════════
  server.tool(
    "kanban_move_task",
    "Move a task to a different column. Agents can only move their own tasks.",
    {
      role: RoleSchema.describe("Your role: 'architect' or 'agent'"),
      agentId: z
        .string()
        .optional()
        .describe("Agent ID (required for agent role)"),
      taskId: z.string().uuid().describe("Task ID to move"),
      column: ColumnSchema.describe(
        "Target column: backlog, in_progress, blocked, done"
      ),
    },
    async ({ role, agentId, taskId, column }) => {
      const task = store.getTask(taskId);

      if (!task) {
        return errorResponse(`Task not found: ${taskId}`);
      }

      // Validar permisos para agents
      if (role === "agent") {
        if (!agentId) {
          return errorResponse("agentId is required for agent role");
        }
        if (task.assignee !== agentId) {
          return errorResponse("Access denied: task is not assigned to you");
        }
      }

      const fromColumn = task.column;

      if (fromColumn === column) {
        return errorResponse(`Task is already in column '${column}'`);
      }

      const updatedTask = store.updateTask(taskId, { column });
      await store.persist();

      // Notificar a los visores web con información de movimiento
      broadcaster.broadcast("task_moved", {
        task: updatedTask,
        fromColumn,
        toColumn: column,
      });

      return successResponse({
        message: `Task moved from '${fromColumn}' to '${column}'`,
        task: updatedTask,
      });
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // KANBAN_DELETE_TASK - Eliminar tarea (solo Architect)
  // ═══════════════════════════════════════════════════════════════════════════
  server.tool(
    "kanban_delete_task",
    "Delete a task from the board (Architect only).",
    {
      role: z.literal("architect").describe("Must be 'architect'"),
      taskId: z.string().uuid().describe("Task ID to delete"),
    },
    async ({ taskId }) => {
      const task = store.getTask(taskId);

      if (!task) {
        return errorResponse(`Task not found: ${taskId}`);
      }

      const deleted = store.deleteTask(taskId);
      await store.persist();

      if (deleted) {
        // Notificar a los visores web
        broadcaster.broadcast("task_deleted", { taskId });

        return successResponse({
          message: "Task deleted successfully",
          deletedTask: task,
        });
      }

      return errorResponse("Failed to delete task");
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // KANBAN_GET_STATS - Obtener estadísticas del tablero
  // ═══════════════════════════════════════════════════════════════════════════
  server.tool(
    "kanban_get_stats",
    "Get board statistics (task counts per column, total tasks, unassigned count).",
    {
      role: RoleSchema.describe("Your role: 'architect' or 'agent'"),
    },
    async () => {
      const stats = store.getStats();
      return successResponse(stats);
    }
  );
}
