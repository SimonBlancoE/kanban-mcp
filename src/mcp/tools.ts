import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "crypto";
import { store } from "../store";
import { broadcaster } from "../web/broadcast";
import { ColumnSchema, RoleSchema, PrioritySchema, type Column, type Task } from "../types";

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
      priority: PrioritySchema.optional()
        .default("medium")
        .describe("Priority: critical, high, medium, low (default: medium)"),
      assignee: z.string().nullable().optional().describe("Assign to agent ID"),
      column: ColumnSchema.optional()
        .default("backlog")
        .describe("Initial column (default: backlog)"),
      dependsOn: z
        .array(z.string().uuid())
        .optional()
        .describe("Array of task IDs this task depends on"),
    },
    async ({ title, description, priority, assignee, column, dependsOn }) => {
      // Validate dependencies exist
      if (dependsOn && dependsOn.length > 0) {
        for (const depId of dependsOn) {
          if (!store.getTask(depId)) {
            return errorResponse(`Dependency task not found: ${depId}`);
          }
        }
      }

      const now = new Date().toISOString();
      const task: Task = {
        id: randomUUID(),
        title,
        description: description ?? "",
        priority: priority ?? "medium",
        dependsOn: dependsOn ?? [],
        blocks: [],
        assignee: assignee ?? null,
        column: column ?? "backlog",
        pendingQa: false,
        qaFeedback: null,
        createdAt: now,
        updatedAt: now,
      };

      store.addTask(task);

      // Update blocks array of dependency tasks
      if (dependsOn && dependsOn.length > 0) {
        for (const depId of dependsOn) {
          const depTask = store.getTask(depId);
          if (depTask) {
            depTask.blocks = [...(depTask.blocks || []), task.id];
            depTask.updatedAt = now;
          }
        }
      }

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
  // KANBAN_UPDATE_TASK - Actualizar título/descripción/prioridad
  // Architect: puede editar cualquier tarea
  // Agent: solo puede editar sus tareas asignadas
  // ═══════════════════════════════════════════════════════════════════════════
  server.tool(
    "kanban_update_task",
    "Update a task's title, description, or priority. Agents can only update their own tasks.",
    {
      role: RoleSchema.describe("Your role: 'architect' or 'agent'"),
      agentId: z
        .string()
        .optional()
        .describe("Agent ID (required for agent role)"),
      taskId: z.string().uuid().describe("Task ID to update"),
      title: z.string().min(1).max(200).optional().describe("New title"),
      description: z.string().max(2000).optional().describe("New description"),
      priority: PrioritySchema.optional().describe("New priority: critical, high, medium, low"),
    },
    async ({ role, agentId, taskId, title, description, priority }) => {
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
      if (priority !== undefined) updates.priority = priority;

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
  // QA: no puede usar esta herramienta (debe usar qa_approve/qa_reject)
  // NOTA: Cuando un agent mueve a "done", la tarea queda pendiente de QA
  // ═══════════════════════════════════════════════════════════════════════════
  server.tool(
    "kanban_move_task",
    "Move a task to a different column. Agents can only move their own tasks. When agents move to 'done', task goes to QA review first.",
    {
      role: z.enum(["architect", "agent"]).describe("Your role: 'architect' or 'agent' (QA uses qa_approve/qa_reject)"),
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

      // INTERCEPT: When agent moves to "done", mark as pending QA instead
      if (role === "agent" && column === "done") {
        const updatedTask = store.updateTask(taskId, {
          column: "done",
          pendingQa: true,
          qaFeedback: null,
        });
        await store.persist();

        broadcaster.broadcast("task_moved", {
          task: updatedTask,
          fromColumn,
          toColumn: "done",
        });

        return successResponse({
          message: `Task marked for completion and sent to QA review`,
          pendingQa: true,
          task: updatedTask,
        });
      }

      // Architect moving to done clears pendingQa
      const updates: Partial<Task> = { column };
      if (role === "architect" && column === "done") {
        updates.pendingQa = false;
        updates.qaFeedback = null;
      }
      // Moving out of done clears pendingQa
      if (fromColumn === "done") {
        updates.pendingQa = false;
      }

      const updatedTask = store.updateTask(taskId, updates);
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
    "Get board statistics including task counts, priority breakdown, and needsRefill alert.",
    {
      role: RoleSchema.describe("Your role: 'architect' or 'agent'"),
      backlogThreshold: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(3)
        .describe("Threshold for needsRefill alert (default: 3)"),
    },
    async ({ backlogThreshold }) => {
      const stats = store.getStats(backlogThreshold);
      return successResponse(stats);
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // KANBAN_ADD_DEPENDENCY - Añadir dependencia entre tareas (solo Architect)
  // ═══════════════════════════════════════════════════════════════════════════
  server.tool(
    "kanban_add_dependency",
    "Add a dependency between tasks (Architect only). Task A depends on Task B means A cannot start until B is done.",
    {
      role: z.literal("architect").describe("Must be 'architect'"),
      taskId: z.string().uuid().describe("Task ID that will depend on another task"),
      dependsOnTaskId: z.string().uuid().describe("Task ID that must be completed first"),
    },
    async ({ taskId, dependsOnTaskId }) => {
      const error = store.addDependency(taskId, dependsOnTaskId);
      if (error) {
        return errorResponse(error);
      }

      await store.persist();

      const task = store.getTask(taskId);
      const dependsOnTask = store.getTask(dependsOnTaskId);

      // Notificar a los visores web
      broadcaster.broadcast("task_updated", task);
      broadcaster.broadcast("task_updated", dependsOnTask);

      return successResponse({
        message: `Dependency added: "${task?.title}" now depends on "${dependsOnTask?.title}"`,
        task,
        dependsOnTask,
      });
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // KANBAN_REMOVE_DEPENDENCY - Eliminar dependencia entre tareas (solo Architect)
  // ═══════════════════════════════════════════════════════════════════════════
  server.tool(
    "kanban_remove_dependency",
    "Remove a dependency between tasks (Architect only).",
    {
      role: z.literal("architect").describe("Must be 'architect'"),
      taskId: z.string().uuid().describe("Task ID to remove dependency from"),
      dependsOnTaskId: z.string().uuid().describe("Task ID to remove as dependency"),
    },
    async ({ taskId, dependsOnTaskId }) => {
      const error = store.removeDependency(taskId, dependsOnTaskId);
      if (error) {
        return errorResponse(error);
      }

      await store.persist();

      const task = store.getTask(taskId);
      const dependsOnTask = store.getTask(dependsOnTaskId);

      // Notificar a los visores web
      broadcaster.broadcast("task_updated", task);
      broadcaster.broadcast("task_updated", dependsOnTask);

      return successResponse({
        message: `Dependency removed: "${task?.title}" no longer depends on "${dependsOnTask?.title}"`,
        task,
        dependsOnTask,
      });
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // KANBAN_HEALTH_CHECK - Análisis de salud del tablero
  // ═══════════════════════════════════════════════════════════════════════════
  server.tool(
    "kanban_health_check",
    "Analyze board health and detect issues like stale tasks, unassigned blocked tasks, low backlog, and overloaded agents.",
    {
      role: RoleSchema.describe("Your role: 'architect' or 'agent'"),
      staleThresholdHours: z
        .number()
        .int()
        .min(1)
        .optional()
        .default(24)
        .describe("Hours before a task in progress is considered stale (default: 24)"),
    },
    async ({ staleThresholdHours }) => {
      const health = store.getHealthCheck(staleThresholdHours);
      return successResponse(health);
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // QA WORKFLOW TOOLS
  // ═══════════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════════
  // KANBAN_QA_LIST - Listar tareas pendientes de QA
  // ═══════════════════════════════════════════════════════════════════════════
  server.tool(
    "kanban_qa_list",
    "List all tasks pending QA review (QA role only).",
    {
      role: z.literal("qa").describe("Must be 'qa'"),
    },
    async () => {
      const tasks = store.getTasks().filter(t => t.pendingQa);
      return successResponse({
        count: tasks.length,
        tasks: tasks.map(t => ({
          id: t.id,
          title: t.title,
          description: t.description,
          priority: t.priority,
          assignee: t.assignee,
          updatedAt: t.updatedAt,
        })),
      });
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // KANBAN_QA_APPROVE - Aprobar tarea y completarla
  // ═══════════════════════════════════════════════════════════════════════════
  server.tool(
    "kanban_qa_approve",
    "Approve a task after QA review, marking it as truly done (QA role only).",
    {
      role: z.literal("qa").describe("Must be 'qa'"),
      taskId: z.string().uuid().describe("Task ID to approve"),
      notes: z
        .string()
        .max(500)
        .optional()
        .describe("Optional approval notes"),
    },
    async ({ taskId, notes }) => {
      const task = store.getTask(taskId);

      if (!task) {
        return errorResponse(`Task not found: ${taskId}`);
      }

      if (!task.pendingQa) {
        return errorResponse("Task is not pending QA review");
      }

      if (task.column !== "done") {
        return errorResponse("Task must be in 'done' column to approve");
      }

      const updatedTask = store.updateTask(taskId, {
        pendingQa: false,
        qaFeedback: notes ? `APPROVED: ${notes}` : "APPROVED",
      });
      await store.persist();

      broadcaster.broadcast("task_updated", updatedTask);

      return successResponse({
        message: "Task approved and marked as complete",
        task: updatedTask,
      });
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // KANBAN_QA_REJECT - Rechazar tarea y devolverla al agente
  // ═══════════════════════════════════════════════════════════════════════════
  server.tool(
    "kanban_qa_reject",
    "Reject a task after QA review, returning it to in_progress with feedback (QA role only).",
    {
      role: z.literal("qa").describe("Must be 'qa'"),
      taskId: z.string().uuid().describe("Task ID to reject"),
      feedback: z
        .string()
        .min(10)
        .max(2000)
        .describe("Required feedback explaining why the task was rejected and what needs to be fixed"),
      targetColumn: z
        .enum(["in_progress", "blocked"])
        .optional()
        .default("in_progress")
        .describe("Where to return the task (default: in_progress)"),
    },
    async ({ taskId, feedback, targetColumn }) => {
      const task = store.getTask(taskId);

      if (!task) {
        return errorResponse(`Task not found: ${taskId}`);
      }

      if (!task.pendingQa) {
        return errorResponse("Task is not pending QA review");
      }

      const fromColumn = task.column;
      const updatedTask = store.updateTask(taskId, {
        column: targetColumn ?? "in_progress",
        pendingQa: false,
        qaFeedback: `REJECTED: ${feedback}`,
      });
      await store.persist();

      broadcaster.broadcast("task_moved", {
        task: updatedTask,
        fromColumn,
        toColumn: targetColumn ?? "in_progress",
      });

      return successResponse({
        message: `Task rejected and returned to '${targetColumn ?? "in_progress"}' with feedback`,
        task: updatedTask,
      });
    }
  );
}
