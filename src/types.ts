import { z } from "zod";

// Column/Status enum - Las 4 columnas del Kanban
export const ColumnSchema = z.enum(["backlog", "in_progress", "blocked", "done"]);
export type Column = z.infer<typeof ColumnSchema>;

// Priority enum - Niveles de prioridad
export const PrioritySchema = z.enum(["low", "medium", "high", "critical"]);
export type Priority = z.infer<typeof PrioritySchema>;

// Feedback category for structured QA rejections
export const FeedbackCategorySchema = z.enum([
  "logic",
  "testing",
  "style",
  "security",
  "performance",
  "missing-feature",
  "other"
]);
export type FeedbackCategory = z.infer<typeof FeedbackCategorySchema>;

// Feedback severity
export const FeedbackSeveritySchema = z.enum(["minor", "major", "critical"]);
export type FeedbackSeverity = z.infer<typeof FeedbackSeveritySchema>;

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

// Acceptance criteria - Architect-defined success conditions
export const AcceptanceCriteriaSchema = z.object({
  description: z.string().min(1).max(500).describe("Human-readable success criteria"),
  testCommand: z.string().max(500).optional().describe("Optional test command to verify"),
  verificationSteps: z.array(z.string().max(200)).default([]).describe("Checklist items to verify"),
});
export type AcceptanceCriteria = z.infer<typeof AcceptanceCriteriaSchema>;

// Iteration log entry - Records each attempt on a task
export const IterationLogEntrySchema = z.object({
  iteration: z.number().int().min(1),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  outcome: z.enum(["in_progress", "submitted", "approved", "rejected"]),
  agentNotes: z.string().max(1000).optional().describe("Agent's notes about their work"),
  feedback: z.string().max(2000).optional().describe("QA feedback if rejected"),
  feedbackCategory: FeedbackCategorySchema.optional(),
  feedbackSeverity: FeedbackSeveritySchema.optional(),
  filesChanged: z.array(z.string()).default([]).describe("Files modified in this iteration"),
});
export type IterationLogEntry = z.infer<typeof IterationLogEntrySchema>;

// Task schema - Estructura de una tarea (enhanced with Ralph Wiggum iteration tracking)
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

  // Ralph Wiggum iteration tracking
  iteration: z.number().int().min(1).default(1).describe("Current iteration number"),
  maxIterations: z.number().int().min(1).default(3).describe("Max iterations before escalation"),
  acceptanceCriteria: AcceptanceCriteriaSchema.optional().describe("Architect-defined success criteria"),
  iterationLog: z.array(IterationLogEntrySchema).default([]).describe("History of all attempts"),

  // Sprint association
  sprintId: z.string().uuid().optional().describe("Associated sprint ID"),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Task = z.infer<typeof TaskSchema>;

// Sprint schema - Big picture goal tracking (Level 1 Ralph)
export const SprintStatusSchema = z.enum(["planning", "executing", "reviewing", "complete", "failed"]);
export type SprintStatus = z.infer<typeof SprintStatusSchema>;

export const SprintSchema = z.object({
  id: z.string().uuid(),
  goal: z.string().min(1).max(500).describe("Sprint goal/objective"),
  description: z.string().max(2000).default(""),
  successCriteria: z.object({
    description: z.string().max(500),
    verificationSteps: z.array(z.string().max(200)).default([]),
    testCommand: z.string().max(500).optional(),
  }),
  status: SprintStatusSchema.default("planning"),
  currentIteration: z.number().int().min(1).default(1),
  maxIterations: z.number().int().min(1).default(5),
  taskIds: z.array(z.string().uuid()).default([]),

  // Sprint iteration history
  iterationHistory: z.array(z.object({
    iteration: z.number().int().min(1),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
    tasksCompleted: z.number().int().default(0),
    tasksRejected: z.number().int().default(0),
    lessonsLearned: z.array(z.string()).default([]),
  })).default([]),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Sprint = z.infer<typeof SprintSchema>;

// Board state - Estado completo del tablero
export const BoardSchema = z.object({
  tasks: z.array(TaskSchema),
  sprints: z.array(SprintSchema).default([]),
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
  | "task_deleted"
  | "iteration_started"
  | "iteration_completed"
  | "sprint_created"
  | "sprint_updated"
  | "agent_activity";

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

// New: Iteration lifecycle events
export interface WSIterationStarted {
  type: "iteration_started";
  payload: {
    taskId: string;
    taskTitle: string;
    iteration: number;
    maxIterations: number;
    agentId: string;
    acceptanceCriteria?: AcceptanceCriteria;
  };
  timestamp: string;
}

export interface WSIterationCompleted {
  type: "iteration_completed";
  payload: {
    taskId: string;
    taskTitle: string;
    iteration: number;
    outcome: "submitted" | "approved" | "rejected";
    feedback?: string;
    feedbackCategory?: FeedbackCategory;
  };
  timestamp: string;
}

// New: Sprint events
export interface WSSprintCreated {
  type: "sprint_created";
  payload: Sprint;
  timestamp: string;
}

export interface WSSprintUpdated {
  type: "sprint_updated";
  payload: Sprint;
  timestamp: string;
}

// New: Live agent activity feed
export interface WSAgentActivity {
  type: "agent_activity";
  payload: {
    agentId: string;
    taskId: string;
    taskTitle: string;
    activity: string;
    activityType: "started" | "reading" | "editing" | "testing" | "submitting" | "addressing_feedback";
  };
  timestamp: string;
}

export type WSEvent =
  | WSBoardUpdate
  | WSTaskCreated
  | WSTaskUpdated
  | WSTaskMoved
  | WSTaskDeleted
  | WSIterationStarted
  | WSIterationCompleted
  | WSSprintCreated
  | WSSprintUpdated
  | WSAgentActivity;

// ═══════════════════════════════════════════════════════════════════════════
// SESSION TYPES (Context Bridge for Long-Running Agents)
// Based on Anthropic's "Effective harnesses for long-running agents"
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Session status
 */
export const SessionStatusSchema = z.enum(["active", "completed", "abandoned"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/**
 * Session - Tracks an agent's work session for context bridging
 */
export const SessionSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().min(1).max(100),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  status: SessionStatusSchema.default("active"),

  // Context for next session
  contextSummary: z.string().max(2000).optional().describe("What agent was working on"),
  sessionNotes: z.string().max(2000).optional().describe("End-of-session notes"),
  pendingItems: z.array(z.string().max(500)).default([]).describe("What's left to do"),
  knownIssues: z.array(z.string().max(500)).default([]).describe("Problems discovered"),
  cleanState: z.boolean().default(false).describe("Did agent leave clean state?"),

  // Git integration
  gitCommitHash: z.string().max(100).optional().describe("Auto-commit SHA if created"),

  // Task tracking
  tasksTouched: z.array(z.string().uuid()).default([]).describe("Task IDs worked on"),
});

export type Session = z.infer<typeof SessionSchema>;

/**
 * SessionContext - Data provided to agent at session start
 */
export interface SessionContext {
  boardSummary: string;
  activeSprint: Sprint | null;
  recentActivity: Array<{
    timestamp: string;
    agentId: string;
    action: string;
    taskId?: string;
    taskTitle?: string;
  }>;
  urgentItems: {
    escalated: Task[];
    blocked: Task[];
    critical: Task[];
  };
  lastSession: {
    id: string;
    endedAt: string;
    sessionNotes: string;
    pendingItems: string[];
    knownIssues: string[];
  } | null;
  suggestedNextTask: Task | null;
  learningContext: {
    mistakesToAvoid: string[];
    projectConventions: string[];
  };
}

/**
 * SessionEndInput - Data provided by agent at session end
 */
export interface SessionEndInput {
  agentId: string;
  sessionNotes: string;
  pendingItems?: string[];
  knownIssues?: string[];
  cleanState: boolean;
  commitMessage?: string;
}

/**
 * BoardHealthCheck - Pre-work verification result
 */
export interface BoardHealthVerification {
  healthy: boolean;
  issues: {
    escalatedTasks: number;
    blockedTasks: number;
    staleInProgress: number;
    qaBacklog: number;
    orphanedTasks: number;
  };
  recommendation: "proceed" | "fix_first" | "escalate";
  suggestedAction?: string;
}

/**
 * FeatureStatus - Explicit pass/fail tracking for tasks (from Anthropic article)
 */
export const FeatureStatusSchema = z.enum(["not_started", "failing", "passing"]);
export type FeatureStatus = z.infer<typeof FeatureStatusSchema>;

/**
 * VerificationResult - Evidence of feature verification
 */
export const VerificationResultSchema = z.object({
  testedAt: z.string().datetime(),
  method: z.enum(["manual", "automated", "e2e"]),
  evidence: z.string().max(1000).optional().describe("Screenshot path, test output, etc."),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

/**
 * ProjectInitInput - Input for initializing a new project
 */
export interface ProjectInitInput {
  projectName: string;
  description: string;
  features: string[];
  techStack?: string[];
  constraints?: string[];
}
