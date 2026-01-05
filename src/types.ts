import { z } from "zod";

// Column/Status enum - Las 4 columnas del Kanban
export const ColumnSchema = z.enum(["backlog", "in_progress", "blocked", "done"]);
export type Column = z.infer<typeof ColumnSchema>;

// Priority enum - Niveles de prioridad
export const PrioritySchema = z.enum(["low", "medium", "high", "critical"]);
export type Priority = z.infer<typeof PrioritySchema>;

// Nombres amigables para las prioridades (visor web)
export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

// Nombres amigables para las columnas (visor web)
export const COLUMN_LABELS: Record<Column, string> = {
  backlog: "Backlog",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Done",
};

// Task schema - Estructura de una tarea
export const TaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  priority: PrioritySchema.default("medium"),
  dependsOn: z.array(z.string().uuid()).default([]),
  blocks: z.array(z.string().uuid()).default([]),
  assignee: z.string().min(1).max(100).nullable(),
  column: ColumnSchema,
  // QA workflow fields
  pendingQa: z.boolean().default(false),
  qaFeedback: z.string().max(2000).nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Task = z.infer<typeof TaskSchema>;

// Board state - Estado completo del tablero
export const BoardSchema = z.object({
  tasks: z.array(TaskSchema),
  lastModified: z.string().datetime(),
});

export type Board = z.infer<typeof BoardSchema>;

// Role types - Roles para autorización
// - architect: full control
// - agent: can only see/modify own tasks
// - qa: can review and approve/reject tasks pending QA
export const RoleSchema = z.enum(["architect", "agent", "qa"]);
export type Role = z.infer<typeof RoleSchema>;

// Estadísticas del tablero
export interface BoardStats {
  backlog: number;
  in_progress: number;
  blocked: number;
  done: number;
  total: number;
  unassigned: number;
  pendingQa: number;
  // Nuevas estadísticas
  needsRefill: boolean;
  backlogThreshold: number;
  byPriority: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

// Health check result
export interface HealthCheck {
  status: "healthy" | "warning" | "critical";
  issues: HealthIssue[];
  summary: string;
}

export interface HealthIssue {
  type: "stale_task" | "unassigned_blocked" | "circular_dependency" | "low_backlog" | "overloaded_agent" | "pending_qa_backlog";
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  taskIds?: string[];
  agentId?: string;
}

// WebSocket event types
export type WSEventType =
  | "board_update"
  | "task_created"
  | "task_updated"
  | "task_moved"
  | "task_deleted";

// Eventos WebSocket
export interface WSBoardUpdate {
  type: "board_update";
  payload: Board;
  timestamp: string;
}

export interface WSTaskCreated {
  type: "task_created";
  payload: Task;
  timestamp: string;
}

export interface WSTaskUpdated {
  type: "task_updated";
  payload: Task;
  timestamp: string;
}

export interface WSTaskMoved {
  type: "task_moved";
  payload: {
    task: Task;
    fromColumn: Column;
    toColumn: Column;
  };
  timestamp: string;
}

export interface WSTaskDeleted {
  type: "task_deleted";
  payload: { taskId: string };
  timestamp: string;
}

export type WSEvent =
  | WSBoardUpdate
  | WSTaskCreated
  | WSTaskUpdated
  | WSTaskMoved
  | WSTaskDeleted;
