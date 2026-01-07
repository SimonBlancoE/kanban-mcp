import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "crypto";
import { store } from "../store";
import { broadcaster } from "../web/broadcast";
import { learningStore } from "../learning";
import { sessionStore } from "../sessions";
import {
  ColumnSchema,
  RoleSchema,
  PrioritySchema,
  FeedbackCategorySchema,
  FeedbackSeveritySchema,
  AcceptanceCriteriaSchema,
  SprintStatusSchema,
  type Column,
  type Task,
  type Sprint,
  type AcceptanceCriteria,
} from "../types";

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
  // Enhanced with Ralph Wiggum acceptance criteria and iteration limits
  // ═══════════════════════════════════════════════════════════════════════════
  server.tool(
    "kanban_create_task",
    "Create a new task (Architect only). Tasks start in backlog by default. Include acceptance criteria for clear success conditions.",
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
      // New: Ralph Wiggum acceptance criteria
      acceptanceCriteria: z
        .object({
          description: z.string().min(1).max(500).describe("Human-readable success criteria"),
          testCommand: z.string().max(500).optional().describe("Optional test command to verify"),
          verificationSteps: z.array(z.string().max(200)).optional().describe("Checklist items to verify"),
        })
        .optional()
        .describe("Acceptance criteria for task completion (architect-defined)"),
      maxIterations: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .default(3)
        .describe("Max iterations before escalation (default: 3)"),
      sprintId: z
        .string()
        .uuid()
        .optional()
        .describe("Associate task with a sprint"),
    },
    async ({ title, description, priority, assignee, column, dependsOn, acceptanceCriteria, maxIterations, sprintId }) => {
      // Validate dependencies exist
      if (dependsOn && dependsOn.length > 0) {
        for (const depId of dependsOn) {
          if (!store.getTask(depId)) {
            return errorResponse(`Dependency task not found: ${depId}`);
          }
        }
      }

      // Validate sprint exists if provided
      if (sprintId && !store.getSprint(sprintId)) {
        return errorResponse(`Sprint not found: ${sprintId}`);
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
        // Ralph Wiggum fields
        iteration: 1,
        maxIterations: maxIterations ?? 3,
        acceptanceCriteria: acceptanceCriteria ? {
          description: acceptanceCriteria.description,
          testCommand: acceptanceCriteria.testCommand,
          verificationSteps: acceptanceCriteria.verificationSteps ?? [],
        } : undefined,
        iterationLog: [],
        sprintId,
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

      // Add task to sprint if provided
      if (sprintId) {
        const sprint = store.getSprint(sprintId);
        if (sprint) {
          sprint.taskIds = [...(sprint.taskIds || []), task.id];
          sprint.updatedAt = now;
        }
      }

      await store.persist();

      // Notificar a los visores web
      broadcaster.broadcast("task_created", task);

      return successResponse({
        message: "Task created successfully",
        task,
        acceptanceCriteria: task.acceptanceCriteria ? "Set" : "Not set",
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
  // Enhanced with structured feedback for learning system
  // ═══════════════════════════════════════════════════════════════════════════
  server.tool(
    "kanban_qa_reject",
    "Reject a task after QA review, returning it to in_progress with structured feedback (QA role only). Feedback is used for learning.",
    {
      role: z.literal("qa").describe("Must be 'qa'"),
      taskId: z.string().uuid().describe("Task ID to reject"),
      feedback: z
        .string()
        .min(10)
        .max(2000)
        .describe("Required feedback explaining why the task was rejected and what needs to be fixed"),
      category: FeedbackCategorySchema.optional()
        .default("other")
        .describe("Feedback category for learning: logic, testing, style, security, performance, missing-feature, other"),
      severity: FeedbackSeveritySchema.optional()
        .default("major")
        .describe("Severity: minor, major, critical"),
      targetColumn: z
        .enum(["in_progress", "blocked"])
        .optional()
        .default("in_progress")
        .describe("Where to return the task (default: in_progress)"),
      suggestedApproach: z
        .string()
        .max(500)
        .optional()
        .describe("Optional hint for the agent on how to fix the issue"),
    },
    async ({ taskId, feedback, category, severity, targetColumn, suggestedApproach }) => {
      const task = store.getTask(taskId);

      if (!task) {
        return errorResponse(`Task not found: ${taskId}`);
      }

      if (!task.pendingQa) {
        return errorResponse("Task is not pending QA review");
      }

      const fromColumn = task.column;
      const feedbackCategory = category ?? "other";
      const feedbackSeverity = severity ?? "major";

      // Record rejection in iteration log
      const result = store.recordIterationRejection(
        taskId,
        feedback,
        feedbackCategory,
        feedbackSeverity
      );

      // Record in learning system if agent is assigned
      if (task.assignee) {
        await learningStore.recordRejectionFeedback(
          task.assignee,
          taskId,
          task.title,
          feedback,
          feedbackCategory,
          feedbackSeverity
        );
      }

      // Build full feedback message
      let fullFeedback = `REJECTED [${feedbackCategory}/${feedbackSeverity}]: ${feedback}`;
      if (suggestedApproach) {
        fullFeedback += `\n\nSuggested approach: ${suggestedApproach}`;
      }

      const updatedTask = store.updateTask(taskId, {
        column: targetColumn ?? "in_progress",
        pendingQa: false,
        qaFeedback: fullFeedback,
      });
      await store.persist();

      // Broadcast events
      broadcaster.broadcast("task_moved", {
        task: updatedTask,
        fromColumn,
        toColumn: targetColumn ?? "in_progress",
      });

      broadcaster.broadcast("iteration_completed", {
        taskId,
        taskTitle: task.title,
        iteration: task.iteration - 1, // Was incremented in recordIterationRejection
        outcome: "rejected",
        feedback,
        feedbackCategory,
      });

      // Check if max iterations reached
      const warningMessage = result?.maxReached
        ? ` WARNING: Task has exceeded max iterations (${task.iteration}/${task.maxIterations}). Consider escalating.`
        : "";

      return successResponse({
        message: `Task rejected and returned to '${targetColumn ?? "in_progress"}'.${warningMessage}`,
        iteration: task.iteration,
        maxIterations: task.maxIterations,
        maxReached: result?.maxReached ?? false,
        feedbackCategory,
        feedbackSeverity,
        task: updatedTask,
      });
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // SPRINT MANAGEMENT TOOLS (Level 1 Ralph Wiggum)
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "kanban_sprint_create",
    "Create a new sprint with goal and success criteria (Architect only).",
    {
      role: z.literal("architect").describe("Must be 'architect'"),
      goal: z.string().min(1).max(500).describe("Sprint goal/objective"),
      description: z.string().max(2000).optional().describe("Sprint description"),
      successCriteria: z.object({
        description: z.string().max(500).describe("How to know when sprint is complete"),
        verificationSteps: z.array(z.string().max(200)).optional().describe("Checklist items"),
        testCommand: z.string().max(500).optional().describe("Optional test command"),
      }).describe("Success criteria for the sprint"),
      maxIterations: z.number().int().min(1).max(10).optional().default(5)
        .describe("Max sprint iterations before failure (default: 5)"),
    },
    async ({ goal, description, successCriteria, maxIterations }) => {
      const now = new Date().toISOString();
      const sprint: Sprint = {
        id: randomUUID(),
        goal,
        description: description ?? "",
        successCriteria: {
          description: successCriteria.description,
          verificationSteps: successCriteria.verificationSteps ?? [],
          testCommand: successCriteria.testCommand,
        },
        status: "planning",
        currentIteration: 1,
        maxIterations: maxIterations ?? 5,
        taskIds: [],
        iterationHistory: [{
          iteration: 1,
          startedAt: now,
          tasksCompleted: 0,
          tasksRejected: 0,
          lessonsLearned: [],
        }],
        createdAt: now,
        updatedAt: now,
      };

      store.addSprint(sprint);
      await store.persist();

      broadcaster.broadcast("sprint_created", sprint);

      return successResponse({
        message: "Sprint created successfully",
        sprint,
      });
    }
  );

  server.tool(
    "kanban_sprint_get",
    "Get sprint details including tasks and iteration history.",
    {
      role: RoleSchema.describe("Your role"),
      sprintId: z.string().uuid().describe("Sprint ID"),
    },
    async ({ sprintId }) => {
      const sprint = store.getSprint(sprintId);
      if (!sprint) {
        return errorResponse(`Sprint not found: ${sprintId}`);
      }

      // Get task details
      const tasks = sprint.taskIds.map(id => store.getTask(id)).filter(Boolean);
      const taskSummary = {
        total: tasks.length,
        completed: tasks.filter(t => t?.column === "done" && !t?.pendingQa).length,
        inProgress: tasks.filter(t => t?.column === "in_progress").length,
        pendingQa: tasks.filter(t => t?.pendingQa).length,
        blocked: tasks.filter(t => t?.column === "blocked").length,
      };

      return successResponse({
        sprint,
        taskSummary,
        tasks: tasks.map(t => ({
          id: t?.id,
          title: t?.title,
          column: t?.column,
          iteration: t?.iteration,
          maxIterations: t?.maxIterations,
          pendingQa: t?.pendingQa,
        })),
      });
    }
  );

  server.tool(
    "kanban_sprint_update_status",
    "Update sprint status (Architect only).",
    {
      role: z.literal("architect").describe("Must be 'architect'"),
      sprintId: z.string().uuid().describe("Sprint ID"),
      status: SprintStatusSchema.describe("New status: planning, executing, reviewing, complete, failed"),
    },
    async ({ sprintId, status }) => {
      const sprint = store.getSprint(sprintId);
      if (!sprint) {
        return errorResponse(`Sprint not found: ${sprintId}`);
      }

      const previousStatus = sprint.status;
      const now = new Date().toISOString();

      // If moving to new iteration, record current iteration completion
      if (status === "executing" && previousStatus === "reviewing") {
        const currentIterHistory = sprint.iterationHistory.find(
          h => h.iteration === sprint.currentIteration
        );
        if (currentIterHistory) {
          currentIterHistory.completedAt = now;
          const tasks = sprint.taskIds.map(id => store.getTask(id)).filter(Boolean);
          currentIterHistory.tasksCompleted = tasks.filter(
            t => t?.column === "done" && !t?.pendingQa
          ).length;
          currentIterHistory.tasksRejected = tasks.filter(
            t => (t?.iterationLog || []).some(e => e.outcome === "rejected")
          ).length;
        }

        // Start new iteration
        sprint.currentIteration++;
        sprint.iterationHistory.push({
          iteration: sprint.currentIteration,
          startedAt: now,
          tasksCompleted: 0,
          tasksRejected: 0,
          lessonsLearned: [],
        });

        // Check if max iterations exceeded
        if (sprint.currentIteration > sprint.maxIterations) {
          sprint.status = "failed";
          store.updateSprint(sprintId, sprint);
          await store.persist();
          broadcaster.broadcast("sprint_updated", sprint);
          return successResponse({
            message: "Sprint failed: exceeded max iterations",
            sprint,
            maxIterationsExceeded: true,
          });
        }
      }

      // Validate completion - all tasks must be done and QA approved
      if (status === "complete") {
        const tasks = sprint.taskIds.map(id => store.getTask(id)).filter(Boolean) as Task[];
        const incompleteTasks = tasks.filter(t => t.column !== "done" || t.pendingQa);

        if (incompleteTasks.length > 0) {
          const summary = incompleteTasks.map(t => ({
            id: t.id,
            title: t.title,
            column: t.column,
            pendingQa: t.pendingQa,
          }));
          return errorResponse(
            `Cannot complete sprint: ${incompleteTasks.length} task(s) not finished.\n` +
            `Tasks must be in 'done' column with QA approved.\n` +
            `Incomplete tasks:\n${JSON.stringify(summary, null, 2)}`
          );
        }
      }

      sprint.status = status;
      store.updateSprint(sprintId, sprint);
      await store.persist();

      broadcaster.broadcast("sprint_updated", sprint);

      return successResponse({
        message: `Sprint status updated: ${previousStatus} -> ${status}`,
        sprint,
      });
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // KANBAN_SPRINT_BULK_COMPLETE - Bulk complete sprint tasks (recovery tool)
  // ═══════════════════════════════════════════════════════════════════════════
  server.tool(
    "kanban_sprint_bulk_complete",
    "Bulk move all sprint tasks to done with QA approved (Architect only). Use for recovery when tasks were worked but not tracked properly.",
    {
      role: z.literal("architect").describe("Must be 'architect'"),
      sprintId: z.string().uuid().describe("Sprint ID"),
      reason: z.string().min(10).describe("Reason for bulk completion (min 10 chars)"),
    },
    async ({ sprintId, reason }) => {
      const sprint = store.getSprint(sprintId);
      if (!sprint) {
        return errorResponse(`Sprint not found: ${sprintId}`);
      }

      const tasks = sprint.taskIds.map(id => store.getTask(id)).filter(Boolean) as Task[];
      const updated: string[] = [];

      for (const task of tasks) {
        if (task.column !== "done" || task.pendingQa) {
          store.updateTask(task.id, {
            column: "done",
            pendingQa: false,
            qaFeedback: `Bulk completed: ${reason}`,
          });
          updated.push(task.title);

          broadcaster.broadcast("task_updated", store.getTask(task.id));
        }
      }

      await store.persist();

      broadcaster.broadcast("board_update", store.getBoard());

      return successResponse({
        message: `Bulk completed ${updated.length} tasks`,
        reason,
        tasksCompleted: updated,
      });
    }
  );

  server.tool(
    "kanban_sprint_list",
    "List all sprints.",
    {
      role: RoleSchema.describe("Your role"),
      status: SprintStatusSchema.optional().describe("Filter by status"),
    },
    async ({ status }) => {
      let sprints = store.getSprints();
      if (status) {
        sprints = sprints.filter(s => s.status === status);
      }
      return successResponse({
        count: sprints.length,
        sprints: sprints.map(s => ({
          id: s.id,
          goal: s.goal,
          status: s.status,
          currentIteration: s.currentIteration,
          maxIterations: s.maxIterations,
          taskCount: s.taskIds.length,
        })),
      });
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ITERATION & LEARNING TOOLS (Level 2 Ralph Wiggum)
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "kanban_start_iteration",
    "Start working on a task iteration (Agent only). Records the start of a new attempt.",
    {
      role: z.literal("agent").describe("Must be 'agent'"),
      agentId: z.string().describe("Your agent ID"),
      taskId: z.string().uuid().describe("Task ID to start working on"),
    },
    async ({ agentId, taskId }) => {
      const task = store.getTask(taskId);
      if (!task) {
        return errorResponse(`Task not found: ${taskId}`);
      }
      if (task.assignee !== agentId) {
        return errorResponse("Task is not assigned to you");
      }

      const entry = store.startIteration(taskId, agentId);
      if (!entry) {
        return errorResponse("Failed to start iteration");
      }

      await store.persist();

      // Broadcast iteration start
      broadcaster.broadcast("iteration_started", {
        taskId,
        taskTitle: task.title,
        iteration: task.iteration,
        maxIterations: task.maxIterations || 3,
        agentId,
        acceptanceCriteria: task.acceptanceCriteria,
      });

      // Get learning context for the agent
      const learningContext = learningStore.getFullContext(agentId);

      return successResponse({
        message: `Started iteration ${task.iteration} of ${task.maxIterations}`,
        task,
        acceptanceCriteria: task.acceptanceCriteria,
        iterationHistory: task.iterationLog,
        learningContext: {
          yourCommonMistakes: learningContext.agentMistakes.slice(0, 3),
          recentFeedback: learningContext.agentRecentFeedback.slice(0, 3),
          projectLessons: learningContext.projectLessons.slice(0, 5),
        },
      });
    }
  );

  server.tool(
    "kanban_submit_iteration",
    "Submit task for QA review with notes about what was done (Agent only).",
    {
      role: z.literal("agent").describe("Must be 'agent'"),
      agentId: z.string().describe("Your agent ID"),
      taskId: z.string().uuid().describe("Task ID"),
      notes: z.string().max(1000).optional().describe("Notes about what you did in this iteration"),
      filesChanged: z.array(z.string()).optional().describe("List of files you modified"),
    },
    async ({ agentId, taskId, notes, filesChanged }) => {
      const task = store.getTask(taskId);
      if (!task) {
        return errorResponse(`Task not found: ${taskId}`);
      }
      if (task.assignee !== agentId) {
        return errorResponse("Task is not assigned to you");
      }

      // Auto-start iteration if not already started (makes workflow more forgiving)
      let entry = store.recordIterationSubmission(taskId, notes, filesChanged);
      if (!entry) {
        // No active iteration - auto-start one and then submit
        const startEntry = store.startIteration(taskId, agentId);
        if (!startEntry) {
          return errorResponse("Failed to start iteration for submission");
        }
        entry = store.recordIterationSubmission(taskId, notes, filesChanged);
        if (!entry) {
          return errorResponse("Failed to record submission after auto-starting iteration");
        }
      }

      // Move to done with pendingQa
      const fromColumn = task.column;
      store.updateTask(taskId, {
        column: "done",
        pendingQa: true,
        qaFeedback: null,
      });

      await store.persist();

      broadcaster.broadcast("task_moved", {
        task: store.getTask(taskId),
        fromColumn,
        toColumn: "done",
      });

      return successResponse({
        message: `Iteration ${task.iteration} submitted for QA review`,
        iterationEntry: entry,
        pendingQa: true,
      });
    }
  );

  server.tool(
    "kanban_get_task_context",
    "Get full task context including iteration history and learning insights (Agent only).",
    {
      role: z.literal("agent").describe("Must be 'agent'"),
      agentId: z.string().describe("Your agent ID"),
      taskId: z.string().uuid().describe("Task ID"),
    },
    async ({ agentId, taskId }) => {
      const task = store.getTask(taskId);
      if (!task) {
        return errorResponse(`Task not found: ${taskId}`);
      }
      if (task.assignee !== agentId) {
        return errorResponse("Task is not assigned to you");
      }

      const detail = store.getTaskDetail(taskId);
      const learningContext = learningStore.getFullContext(agentId);

      return successResponse({
        task: detail?.task,
        iterationSummary: detail?.iterationSummary,
        previousAttempts: (task.iterationLog || []).map(e => ({
          iteration: e.iteration,
          outcome: e.outcome,
          feedback: e.feedback,
          feedbackCategory: e.feedbackCategory,
        })),
        acceptanceCriteria: task.acceptanceCriteria,
        learningContext: {
          yourPatterns: learningContext.agentMistakes,
          recentFeedback: learningContext.agentRecentFeedback,
          projectLessons: learningContext.projectLessons,
          codebaseConventions: learningContext.codebaseConventions,
        },
      });
    }
  );

  server.tool(
    "kanban_get_learning_insights",
    "Get learning insights for agents and project (Architect only).",
    {
      role: z.literal("architect").describe("Must be 'architect'"),
      agentId: z.string().optional().describe("Get specific agent's learning profile"),
    },
    async ({ agentId }) => {
      if (agentId) {
        const profile = learningStore.getAgentProfile(agentId);
        return successResponse({
          agent: profile,
        });
      }

      // Get all agent stats
      const agentStats = learningStore.getAllAgentStats();
      const projectLessons = learningStore.getRelevantLessons();
      const conventions = learningStore.getCodebaseConventions();

      return successResponse({
        agents: agentStats,
        projectLessons,
        codebaseConventions: conventions,
      });
    }
  );

  server.tool(
    "kanban_add_lesson",
    "Add a project-level lesson learned (Architect only).",
    {
      role: z.literal("architect").describe("Must be 'architect'"),
      category: FeedbackCategorySchema.describe("Lesson category"),
      lesson: z.string().min(10).max(500).describe("The lesson learned"),
      source: z.string().max(100).optional().describe("Where this lesson came from"),
    },
    async ({ category, lesson, source }) => {
      const newLesson = await learningStore.addProjectLesson(
        category,
        lesson,
        source ?? "Manual entry"
      );

      return successResponse({
        message: "Lesson added to project knowledge base",
        lesson: newLesson,
      });
    }
  );

  server.tool(
    "kanban_add_convention",
    "Add a codebase convention for agents to follow (Architect only).",
    {
      role: z.literal("architect").describe("Must be 'architect'"),
      pattern: z.string().min(1).max(100).describe("Short pattern name"),
      description: z.string().min(10).max(500).describe("Description of the convention"),
      examples: z.array(z.string().max(200)).optional().describe("Example usages"),
    },
    async ({ pattern, description, examples }) => {
      await learningStore.addCodebaseConvention(pattern, description, examples ?? []);

      return successResponse({
        message: "Convention added to codebase knowledge",
        convention: { pattern, description, examples },
      });
    }
  );

  server.tool(
    "kanban_set_acceptance_criteria",
    "Set or update acceptance criteria for a task (Architect only).",
    {
      role: z.literal("architect").describe("Must be 'architect'"),
      taskId: z.string().uuid().describe("Task ID"),
      criteria: z.object({
        description: z.string().min(1).max(500).describe("Success criteria description"),
        testCommand: z.string().max(500).optional().describe("Optional test command"),
        verificationSteps: z.array(z.string().max(200)).optional().describe("Checklist items"),
      }).describe("Acceptance criteria"),
    },
    async ({ taskId, criteria }) => {
      const task = store.setAcceptanceCriteria(taskId, {
        description: criteria.description,
        testCommand: criteria.testCommand,
        verificationSteps: criteria.verificationSteps ?? [],
      });

      if (!task) {
        return errorResponse(`Task not found: ${taskId}`);
      }

      await store.persist();
      broadcaster.broadcast("task_updated", task);

      return successResponse({
        message: "Acceptance criteria set",
        task,
      });
    }
  );

  server.tool(
    "kanban_get_escalated_tasks",
    "Get tasks that have exceeded max iterations and need attention (Architect only).",
    {
      role: z.literal("architect").describe("Must be 'architect'"),
    },
    async () => {
      const escalated = store.getEscalatedTasks();

      return successResponse({
        count: escalated.length,
        tasks: escalated.map(t => ({
          id: t.id,
          title: t.title,
          iteration: t.iteration,
          maxIterations: t.maxIterations,
          assignee: t.assignee,
          column: t.column,
          lastFeedback: t.qaFeedback,
          iterationLog: t.iterationLog,
        })),
        message: escalated.length > 0
          ? `${escalated.length} task(s) need attention - exceeded max iterations`
          : "No escalated tasks",
      });
    }
  );

  server.tool(
    "kanban_log_activity",
    "Log agent activity for live dashboard feed (Agent only).",
    {
      role: z.literal("agent").describe("Must be 'agent'"),
      agentId: z.string().describe("Your agent ID"),
      taskId: z.string().uuid().describe("Task ID you're working on"),
      activity: z.string().max(200).describe("What you're doing"),
      activityType: z.enum(["started", "reading", "editing", "testing", "submitting", "addressing_feedback"])
        .describe("Activity type"),
    },
    async ({ agentId, taskId, activity, activityType }) => {
      const task = store.getTask(taskId);
      if (!task) {
        return errorResponse(`Task not found: ${taskId}`);
      }

      broadcaster.broadcast("agent_activity", {
        agentId,
        taskId,
        taskTitle: task.title,
        activity,
        activityType,
      });

      return successResponse({
        message: "Activity logged",
      });
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ENHANCED TASK DETAIL
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "kanban_get_task_detail",
    "Get detailed task information including iteration history and metrics.",
    {
      role: RoleSchema.describe("Your role"),
      agentId: z.string().optional().describe("Agent ID (required for agent role)"),
      taskId: z.string().uuid().describe("Task ID"),
    },
    async ({ role, agentId, taskId }) => {
      const task = store.getTask(taskId);
      if (!task) {
        return errorResponse(`Task not found: ${taskId}`);
      }

      // Agent can only see their own tasks
      if (role === "agent") {
        if (!agentId) {
          return errorResponse("agentId is required for agent role");
        }
        if (task.assignee !== agentId) {
          return errorResponse("Access denied: task is not assigned to you");
        }
      }

      const detail = store.getTaskDetail(taskId);

      // Get sprint info if associated
      let sprintInfo = null;
      if (task.sprintId) {
        const sprint = store.getSprint(task.sprintId);
        if (sprint) {
          sprintInfo = {
            id: sprint.id,
            goal: sprint.goal,
            status: sprint.status,
            currentIteration: sprint.currentIteration,
          };
        }
      }

      return successResponse({
        task: detail?.task,
        iterationSummary: detail?.iterationSummary,
        iterationLog: task.iterationLog,
        acceptanceCriteria: task.acceptanceCriteria,
        sprint: sprintInfo,
      });
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTEXT BRIDGE TOOLS (Long-Running Agent Support)
  // Based on Anthropic's "Effective harnesses for long-running agents"
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "kanban_session_start",
    "Start a new session and get context for an agent. Returns board state, recent activity, urgent items, last session notes, suggested next task, and learning context. Use this at the START of every session.",
    {
      agentId: z.string().min(1).max(100).describe("Your agent ID (e.g., 'agent-alpha')"),
      contextSummary: z.string().max(500).optional().describe("Brief description of what you plan to work on"),
    },
    async ({ agentId, contextSummary }) => {
      // Start session
      const session = sessionStore.startSession(agentId, contextSummary);

      // Get context
      const context = sessionStore.getSessionContext(agentId);

      return successResponse({
        sessionId: session.id,
        message: "Session started. Review the context below before beginning work.",
        context: {
          boardSummary: context.boardSummary,
          activeSprint: context.activeSprint ? {
            id: context.activeSprint.id,
            goal: context.activeSprint.goal,
            status: context.activeSprint.status,
            iteration: `${context.activeSprint.currentIteration}/${context.activeSprint.maxIterations}`,
          } : null,
          urgentItems: {
            escalated: context.urgentItems.escalated.map(t => ({ id: t.id, title: t.title, iteration: `${t.iteration}/${t.maxIterations}` })),
            blocked: context.urgentItems.blocked.map(t => ({ id: t.id, title: t.title })),
            critical: context.urgentItems.critical.map(t => ({ id: t.id, title: t.title, priority: t.priority })),
          },
          lastSession: context.lastSession,
          suggestedNextTask: context.suggestedNextTask ? {
            id: context.suggestedNextTask.id,
            title: context.suggestedNextTask.title,
            priority: context.suggestedNextTask.priority,
            acceptanceCriteria: context.suggestedNextTask.acceptanceCriteria,
          } : null,
          learningContext: context.learningContext,
          recentActivity: context.recentActivity.slice(0, 5),
        },
      });
    }
  );

  server.tool(
    "kanban_session_end",
    "End the current session with notes. Use this BEFORE ending ANY session (context window limit, user stop, or task complete). If cleanState is true, automatically commits changes to git.",
    {
      agentId: z.string().min(1).max(100).describe("Your agent ID"),
      sessionNotes: z.string().min(1).max(2000).describe("What you accomplished this session"),
      pendingItems: z.array(z.string().max(500)).optional().describe("What's still in progress or planned next"),
      knownIssues: z.array(z.string().max(500)).optional().describe("Any bugs, concerns, or blockers discovered"),
      cleanState: z.boolean().describe("Set to true if all work is committed and tests pass. This triggers an automatic git commit."),
      commitMessage: z.string().max(200).optional().describe("Custom git commit message (auto-generated if omitted)"),
    },
    async ({ agentId, sessionNotes, pendingItems, knownIssues, cleanState, commitMessage }) => {
      const result = await sessionStore.endSession({
        agentId,
        sessionNotes,
        pendingItems,
        knownIssues,
        cleanState,
        commitMessage,
      });

      return successResponse({
        sessionId: result.sessionId,
        message: cleanState
          ? result.gitCommitHash
            ? `Session ended with clean state. Git commit: ${result.gitCommitHash}`
            : "Session ended with clean state. No changes to commit."
          : "Session ended. Note: State was not marked as clean, so no git commit was made.",
        gitCommitHash: result.gitCommitHash,
        summaryFileUpdated: true,
      });
    }
  );

  server.tool(
    "kanban_generate_summary",
    "Generate a human-readable board state summary file (data/session-summary.md). This is the equivalent of claude-progress.txt from the Anthropic article.",
    {
      detailed: z.boolean().optional().default(false).describe("Include more detailed information"),
    },
    async ({ detailed }) => {
      sessionStore.generateSummaryFile();

      // Also return the summary content
      const stats = store.getStats();
      const activeSprint = store.getActiveSprint();
      const escalated = store.getEscalatedTasks();
      const blocked = store.getBlockedTasks();

      return successResponse({
        message: "Summary file generated at data/session-summary.md",
        summary: {
          totalTasks: stats.total,
          byColumn: {
            backlog: stats.backlog,
            inProgress: stats.in_progress,
            blocked: stats.blocked,
            done: stats.done,
          },
          pendingQa: stats.pendingQa,
          activeSprint: activeSprint ? {
            goal: activeSprint.goal,
            status: activeSprint.status,
            iteration: `${activeSprint.currentIteration}/${activeSprint.maxIterations}`,
          } : null,
          attentionRequired: {
            escalated: escalated.length,
            blocked: blocked.length,
          },
        },
      });
    }
  );

  server.tool(
    "kanban_verify_board_health",
    "Quick health check before starting new work. Returns recommendation: 'proceed' (safe to start), 'fix_first' (address issues), or 'escalate' (needs human review).",
    {},
    async () => {
      const health = sessionStore.verifyBoardHealth();

      return successResponse({
        healthy: health.healthy,
        recommendation: health.recommendation,
        suggestedAction: health.suggestedAction,
        issues: health.issues,
        message: health.recommendation === "proceed"
          ? "Board is healthy. You can proceed with new work."
          : health.recommendation === "fix_first"
          ? `Address these issues before starting new work: ${health.suggestedAction}`
          : `Human review needed: ${health.suggestedAction}`,
      });
    }
  );

  server.tool(
    "kanban_initialize_project",
    "Initialize an empty board with project scaffolding. Use this when the board is empty to set up initial structure. Auto-triggered by kanban-initializer skill.",
    {
      projectName: z.string().min(1).max(200).describe("Name of the project"),
      description: z.string().max(2000).describe("Project description"),
      features: z.array(z.string().max(500)).min(1).describe("List of high-level features to implement"),
      techStack: z.array(z.string().max(100)).optional().describe("Technology stack (e.g., ['React', 'Node', 'SQLite'])"),
      constraints: z.array(z.string().max(200)).optional().describe("Project constraints (e.g., ['Must work offline'])"),
    },
    async ({ projectName, description, features, techStack, constraints }) => {
      // Check if board is empty
      if (!store.isEmpty()) {
        return errorResponse("Board is not empty. Initialization is only for empty boards.");
      }

      const now = new Date().toISOString();
      const sprintId = randomUUID();

      // Create initial sprint
      const sprint: Sprint = {
        id: sprintId,
        goal: projectName,
        description,
        successCriteria: {
          description: `Complete initial implementation of ${projectName}`,
          verificationSteps: features.map(f => `Verify: ${f}`),
        },
        status: "planning",
        currentIteration: 1,
        maxIterations: 5,
        taskIds: [],
        iterationHistory: [],
        createdAt: now,
        updatedAt: now,
      };

      store.addSprint(sprint);
      await store.persist();

      // Create tasks for each feature
      const tasks: Task[] = [];
      for (let i = 0; i < features.length; i++) {
        const taskId = randomUUID();
        const task: Task = {
          id: taskId,
          title: features[i],
          description: `Implement: ${features[i]}`,
          priority: i < 3 ? "high" : "medium", // First 3 features are high priority
          column: "backlog",
          assignee: null,
          dependsOn: [],
          blocks: [],
          pendingQa: false,
          qaFeedback: null,
          iteration: 1,
          maxIterations: 3,
          acceptanceCriteria: {
            description: `Feature "${features[i]}" is fully implemented and working`,
            verificationSteps: [
              "Feature works as expected",
              "No regressions in existing functionality",
              "Code follows project conventions",
            ],
          },
          iterationLog: [],
          sprintId,
          createdAt: now,
          updatedAt: now,
        };

        store.addTask(task);
        tasks.push(task);
        sprint.taskIds.push(taskId);
      }

      // Update sprint with task IDs
      store.updateSprint(sprintId, { taskIds: sprint.taskIds });
      await store.persist();

      // Add conventions if tech stack provided
      if (techStack && techStack.length > 0) {
        await learningStore.addCodebaseConvention(
          "Tech Stack",
          `This project uses: ${techStack.join(", ")}`,
          techStack
        );
      }

      // Add constraints as lessons
      if (constraints && constraints.length > 0) {
        for (const constraint of constraints) {
          await learningStore.addProjectLesson(
            "other",
            constraint,
            "Project initialization",
            ["all"]
          );
        }
      }

      // Generate initial summary
      sessionStore.generateSummaryFile();

      // Broadcast updates
      broadcaster.broadcast("sprint_created", sprint);
      for (const task of tasks) {
        broadcaster.broadcast("task_created", task);
      }

      return successResponse({
        message: `Project "${projectName}" initialized successfully`,
        sprint: {
          id: sprintId,
          goal: projectName,
          taskCount: tasks.length,
        },
        tasks: tasks.map(t => ({ id: t.id, title: t.title, priority: t.priority })),
        conventions: techStack ? [`Tech Stack: ${techStack.join(", ")}`] : [],
        constraints: constraints || [],
      });
    }
  );
}
