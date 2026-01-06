import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import type {
  Board,
  Task,
  Column,
  BoardStats,
  HealthCheck,
  HealthIssue,
  Sprint,
  SprintStatus,
  AcceptanceCriteria,
  IterationLogEntry,
  FeedbackCategory,
  FeedbackSeverity,
} from "./types";

// Resolver path absoluto al directorio data (relativo al módulo, no al cwd)
const __dirname = dirname(import.meta.path);
const DATA_DIR = join(__dirname, "..", "data");
const DATA_PATH = join(DATA_DIR, "kanban.json");

/**
 * KanbanStore - Capa de persistencia para el tablero Kanban
 * Mantiene los datos en memoria y los sincroniza con un archivo JSON
 * Enhanced with Ralph Wiggum iteration tracking and Sprint management
 */
class KanbanStore {
  private board: Board = {
    tasks: [],
    sprints: [],
    lastModified: new Date().toISOString(),
  };

  /**
   * Carga los datos desde el archivo JSON (o crea uno nuevo si no existe)
   */
  async load(): Promise<void> {
    // Crear directorio data si no existe
    if (!existsSync(DATA_DIR)) {
      await mkdir(DATA_DIR, { recursive: true });
    }

    if (existsSync(DATA_PATH)) {
      try {
        const data = await readFile(DATA_PATH, "utf-8");
        this.board = JSON.parse(data);
        console.error(`[Store] Loaded ${this.board.tasks.length} tasks from ${DATA_PATH}`);
      } catch (error) {
        console.error("[Store] Error loading data, starting fresh:", error);
        await this.persist();
      }
    } else {
      console.error("[Store] No existing data, creating new board");
      await this.persist();
    }
  }

  /**
   * Persiste los datos actuales al archivo JSON
   */
  async persist(): Promise<void> {
    this.board.lastModified = new Date().toISOString();
    await writeFile(DATA_PATH, JSON.stringify(this.board, null, 2));
  }

  /**
   * Obtiene el estado completo del tablero
   */
  getBoard(): Board {
    return this.board;
  }

  /**
   * Obtiene tareas con filtros opcionales
   */
  getTasks(filter?: { column?: Column; assignee?: string }): Task[] {
    let tasks = this.board.tasks;

    if (filter?.column) {
      tasks = tasks.filter((t) => t.column === filter.column);
    }

    if (filter?.assignee) {
      tasks = tasks.filter((t) => t.assignee === filter.assignee);
    }

    return tasks;
  }

  /**
   * Obtiene una tarea por ID
   */
  getTask(id: string): Task | undefined {
    return this.board.tasks.find((t) => t.id === id);
  }

  /**
   * Añade una nueva tarea al tablero
   */
  addTask(task: Task): void {
    this.board.tasks.push(task);
  }

  /**
   * Actualiza una tarea existente
   * @returns La tarea actualizada o null si no se encontró
   */
  updateTask(id: string, updates: Partial<Omit<Task, "id" | "createdAt">>): Task | null {
    const task = this.getTask(id);
    if (!task) return null;

    Object.assign(task, updates, { updatedAt: new Date().toISOString() });
    return task;
  }

  /**
   * Elimina una tarea del tablero
   * @returns true si se eliminó, false si no existía
   */
  deleteTask(id: string): boolean {
    const index = this.board.tasks.findIndex((t) => t.id === id);
    if (index === -1) return false;

    this.board.tasks.splice(index, 1);
    return true;
  }

  /**
   * Obtiene estadísticas del tablero
   */
  getStats(backlogThreshold: number = 3): BoardStats {
    const tasks = this.board.tasks;
    const backlogCount = tasks.filter((t) => t.column === "backlog").length;

    return {
      backlog: backlogCount,
      in_progress: tasks.filter((t) => t.column === "in_progress").length,
      blocked: tasks.filter((t) => t.column === "blocked").length,
      done: tasks.filter((t) => t.column === "done" && !t.pendingQa).length,
      total: tasks.length,
      unassigned: tasks.filter((t) => !t.assignee).length,
      pendingQa: tasks.filter((t) => t.pendingQa).length,
      needsRefill: backlogCount < backlogThreshold,
      backlogThreshold,
      byPriority: {
        critical: tasks.filter((t) => t.priority === "critical" && t.column !== "done").length,
        high: tasks.filter((t) => t.priority === "high" && t.column !== "done").length,
        medium: tasks.filter((t) => t.priority === "medium" && t.column !== "done").length,
        low: tasks.filter((t) => t.priority === "low" && t.column !== "done").length,
      },
    };
  }

  /**
   * Verifica si existe una dependencia circular
   */
  hasCircularDependency(taskId: string, dependsOnId: string, visited: Set<string> = new Set()): boolean {
    if (taskId === dependsOnId) return true;
    if (visited.has(dependsOnId)) return false;

    visited.add(dependsOnId);
    const dependsOnTask = this.getTask(dependsOnId);
    if (!dependsOnTask) return false;

    for (const nextDep of dependsOnTask.dependsOn || []) {
      if (this.hasCircularDependency(taskId, nextDep, visited)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Añade una dependencia entre tareas
   * @returns Error message if invalid, null if success
   */
  addDependency(taskId: string, dependsOnId: string): string | null {
    const task = this.getTask(taskId);
    const dependsOnTask = this.getTask(dependsOnId);

    if (!task) return `Task not found: ${taskId}`;
    if (!dependsOnTask) return `Dependency task not found: ${dependsOnId}`;
    if (taskId === dependsOnId) return "A task cannot depend on itself";
    if (task.dependsOn?.includes(dependsOnId)) return "Dependency already exists";
    if (this.hasCircularDependency(taskId, dependsOnId)) {
      return "Cannot add dependency: would create a circular dependency";
    }

    // Add to dependsOn array
    task.dependsOn = [...(task.dependsOn || []), dependsOnId];
    task.updatedAt = new Date().toISOString();

    // Add to blocks array of the other task
    dependsOnTask.blocks = [...(dependsOnTask.blocks || []), taskId];
    dependsOnTask.updatedAt = new Date().toISOString();

    return null;
  }

  /**
   * Elimina una dependencia entre tareas
   */
  removeDependency(taskId: string, dependsOnId: string): string | null {
    const task = this.getTask(taskId);
    const dependsOnTask = this.getTask(dependsOnId);

    if (!task) return `Task not found: ${taskId}`;
    if (!dependsOnTask) return `Dependency task not found: ${dependsOnId}`;
    if (!task.dependsOn?.includes(dependsOnId)) return "Dependency does not exist";

    // Remove from dependsOn array
    task.dependsOn = task.dependsOn.filter(id => id !== dependsOnId);
    task.updatedAt = new Date().toISOString();

    // Remove from blocks array of the other task
    dependsOnTask.blocks = (dependsOnTask.blocks || []).filter(id => id !== taskId);
    dependsOnTask.updatedAt = new Date().toISOString();

    return null;
  }

  /**
   * Realiza un health check del tablero
   */
  getHealthCheck(staleThresholdHours: number = 24): HealthCheck {
    const tasks = this.board.tasks;
    const issues: HealthIssue[] = [];
    const now = new Date();

    // Check for stale tasks in progress
    const staleTasks = tasks.filter(t => {
      if (t.column !== "in_progress") return false;
      const updated = new Date(t.updatedAt);
      const hoursAgo = (now.getTime() - updated.getTime()) / (1000 * 60 * 60);
      return hoursAgo > staleThresholdHours;
    });

    if (staleTasks.length > 0) {
      issues.push({
        type: "stale_task",
        severity: staleTasks.length > 3 ? "high" : "medium",
        message: `${staleTasks.length} task(s) in progress for more than ${staleThresholdHours} hours`,
        taskIds: staleTasks.map(t => t.id),
      });
    }

    // Check for unassigned blocked tasks
    const unassignedBlocked = tasks.filter(t => t.column === "blocked" && !t.assignee);
    if (unassignedBlocked.length > 0) {
      issues.push({
        type: "unassigned_blocked",
        severity: "high",
        message: `${unassignedBlocked.length} blocked task(s) without assignee`,
        taskIds: unassignedBlocked.map(t => t.id),
      });
    }

    // Check for low backlog
    const backlogCount = tasks.filter(t => t.column === "backlog").length;
    if (backlogCount < 3) {
      issues.push({
        type: "low_backlog",
        severity: backlogCount === 0 ? "critical" : "medium",
        message: backlogCount === 0
          ? "Backlog is empty! No tasks available for agents"
          : `Low backlog: only ${backlogCount} task(s) available`,
      });
    }

    // Check for overloaded agents (more than 5 tasks in progress)
    const agentTaskCounts: Record<string, number> = {};
    tasks.filter(t => t.column === "in_progress" && t.assignee).forEach(t => {
      agentTaskCounts[t.assignee!] = (agentTaskCounts[t.assignee!] || 0) + 1;
    });

    Object.entries(agentTaskCounts).forEach(([agentId, count]) => {
      if (count > 5) {
        issues.push({
          type: "overloaded_agent",
          severity: count > 8 ? "high" : "medium",
          message: `Agent "${agentId}" has ${count} tasks in progress`,
          agentId,
        });
      }
    });

    // Check for critical priority tasks not in progress
    const criticalNotStarted = tasks.filter(
      t => t.priority === "critical" && t.column === "backlog"
    );
    if (criticalNotStarted.length > 0) {
      issues.push({
        type: "stale_task",
        severity: "critical",
        message: `${criticalNotStarted.length} critical priority task(s) not yet started`,
        taskIds: criticalNotStarted.map(t => t.id),
      });
    }

    // Check for pending QA backlog
    const pendingQaTasks = tasks.filter(t => t.pendingQa);
    if (pendingQaTasks.length > 3) {
      issues.push({
        type: "pending_qa_backlog",
        severity: pendingQaTasks.length > 5 ? "high" : "medium",
        message: `${pendingQaTasks.length} task(s) waiting for QA review`,
        taskIds: pendingQaTasks.map(t => t.id),
      });
    }

    // Determine overall status
    let status: "healthy" | "warning" | "critical" = "healthy";
    if (issues.some(i => i.severity === "critical")) {
      status = "critical";
    } else if (issues.some(i => i.severity === "high" || i.severity === "medium")) {
      status = "warning";
    }

    return {
      status,
      issues,
      summary: issues.length === 0
        ? "All systems healthy. No issues detected."
        : `Found ${issues.length} issue(s): ${issues.filter(i => i.severity === "critical").length} critical, ${issues.filter(i => i.severity === "high").length} high, ${issues.filter(i => i.severity === "medium").length} medium, ${issues.filter(i => i.severity === "low").length} low`,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SPRINT MANAGEMENT (Level 1 Ralph Wiggum)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get all sprints
   */
  getSprints(): Sprint[] {
    return this.board.sprints || [];
  }

  /**
   * Get a sprint by ID
   */
  getSprint(id: string): Sprint | undefined {
    return (this.board.sprints || []).find(s => s.id === id);
  }

  /**
   * Add a new sprint
   */
  addSprint(sprint: Sprint): void {
    if (!this.board.sprints) {
      this.board.sprints = [];
    }
    this.board.sprints.push(sprint);
  }

  /**
   * Update a sprint
   */
  updateSprint(id: string, updates: Partial<Omit<Sprint, "id" | "createdAt">>): Sprint | null {
    const sprint = this.getSprint(id);
    if (!sprint) return null;

    Object.assign(sprint, updates, { updatedAt: new Date().toISOString() });
    return sprint;
  }

  /**
   * Delete a sprint
   */
  deleteSprint(id: string): boolean {
    if (!this.board.sprints) return false;
    const index = this.board.sprints.findIndex(s => s.id === id);
    if (index === -1) return false;

    this.board.sprints.splice(index, 1);
    return true;
  }

  /**
   * Get the active sprint (if any)
   */
  getActiveSprint(): Sprint | undefined {
    return (this.board.sprints || []).find(
      s => s.status === "planning" || s.status === "executing" || s.status === "reviewing"
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ITERATION TRACKING (Level 2 Ralph Wiggum)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start a new iteration for a task
   */
  startIteration(taskId: string, agentId: string): IterationLogEntry | null {
    const task = this.getTask(taskId);
    if (!task) return null;

    const now = new Date().toISOString();
    const entry: IterationLogEntry = {
      iteration: task.iteration,
      startedAt: now,
      outcome: "in_progress",
      filesChanged: [],
    };

    if (!task.iterationLog) {
      task.iterationLog = [];
    }
    task.iterationLog.push(entry);
    task.updatedAt = now;

    return entry;
  }

  /**
   * Record iteration submission (agent finished, awaiting QA)
   */
  recordIterationSubmission(
    taskId: string,
    agentNotes?: string,
    filesChanged?: string[]
  ): IterationLogEntry | null {
    const task = this.getTask(taskId);
    if (!task || !task.iterationLog || task.iterationLog.length === 0) return null;

    const currentEntry = task.iterationLog[task.iterationLog.length - 1];
    if (currentEntry.outcome !== "in_progress") return null;

    const now = new Date().toISOString();
    currentEntry.outcome = "submitted";
    currentEntry.completedAt = now;
    if (agentNotes) currentEntry.agentNotes = agentNotes;
    if (filesChanged) currentEntry.filesChanged = filesChanged;

    task.updatedAt = now;
    return currentEntry;
  }

  /**
   * Record iteration approval (QA approved)
   */
  recordIterationApproval(taskId: string, notes?: string): IterationLogEntry | null {
    const task = this.getTask(taskId);
    if (!task || !task.iterationLog || task.iterationLog.length === 0) return null;

    const currentEntry = task.iterationLog[task.iterationLog.length - 1];
    if (currentEntry.outcome !== "submitted") return null;

    const now = new Date().toISOString();
    currentEntry.outcome = "approved";
    currentEntry.completedAt = now;
    if (notes) currentEntry.feedback = notes;

    task.updatedAt = now;
    return currentEntry;
  }

  /**
   * Record iteration rejection (QA rejected)
   * @returns Object with updated entry and whether max iterations reached
   */
  recordIterationRejection(
    taskId: string,
    feedback: string,
    category?: FeedbackCategory,
    severity?: FeedbackSeverity
  ): { entry: IterationLogEntry; maxReached: boolean } | null {
    const task = this.getTask(taskId);
    if (!task || !task.iterationLog || task.iterationLog.length === 0) return null;

    const currentEntry = task.iterationLog[task.iterationLog.length - 1];
    if (currentEntry.outcome !== "submitted") return null;

    const now = new Date().toISOString();
    currentEntry.outcome = "rejected";
    currentEntry.completedAt = now;
    currentEntry.feedback = feedback;
    if (category) currentEntry.feedbackCategory = category;
    if (severity) currentEntry.feedbackSeverity = severity;

    // Increment iteration counter
    task.iteration++;
    task.updatedAt = now;

    const maxReached = task.iteration > (task.maxIterations || 3);
    return { entry: currentEntry, maxReached };
  }

  /**
   * Get task detail with iteration history
   */
  getTaskDetail(taskId: string): {
    task: Task;
    iterationSummary: {
      current: number;
      max: number;
      totalAttempts: number;
      rejectionCount: number;
      avgIterationTime?: number;
    };
  } | null {
    const task = this.getTask(taskId);
    if (!task) return null;

    const log = task.iterationLog || [];
    const rejections = log.filter(e => e.outcome === "rejected").length;

    // Calculate average iteration time
    let avgTime: number | undefined;
    const completedIterations = log.filter(e => e.completedAt);
    if (completedIterations.length > 0) {
      const totalMs = completedIterations.reduce((sum, entry) => {
        const start = new Date(entry.startedAt).getTime();
        const end = new Date(entry.completedAt!).getTime();
        return sum + (end - start);
      }, 0);
      avgTime = totalMs / completedIterations.length / 1000 / 60; // minutes
    }

    return {
      task,
      iterationSummary: {
        current: task.iteration,
        max: task.maxIterations || 3,
        totalAttempts: log.length,
        rejectionCount: rejections,
        avgIterationTime: avgTime,
      },
    };
  }

  /**
   * Set acceptance criteria for a task
   */
  setAcceptanceCriteria(taskId: string, criteria: AcceptanceCriteria): Task | null {
    const task = this.getTask(taskId);
    if (!task) return null;

    task.acceptanceCriteria = criteria;
    task.updatedAt = new Date().toISOString();
    return task;
  }

  /**
   * Get tasks that have exceeded max iterations (need escalation)
   */
  getEscalatedTasks(): Task[] {
    return this.board.tasks.filter(
      t => t.iteration > (t.maxIterations || 3) && t.column !== "done"
    );
  }
}

// Singleton instance
export const store = new KanbanStore();
