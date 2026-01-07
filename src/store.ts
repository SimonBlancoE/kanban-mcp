import { db } from "./db/database";
import { needsMigration, runMigration } from "./db/migrate-json";
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

/**
 * KanbanStore - SQLite-backed persistence for the Kanban board
 *
 * This implementation stores tasks and sprints as JSON in SQLite with
 * generated columns for efficient queries. The interface is identical
 * to the previous JSON-file implementation.
 *
 * Enhanced with Ralph Wiggum iteration tracking and Sprint management.
 */
class KanbanStore {
  private initialized = false;

  /**
   * Initialize the store and run migrations if needed
   */
  async load(): Promise<void> {
    if (this.initialized) return;

    // Initialize database (creates schema if needed)
    db.initialize();

    // Check for and run migration from JSON files
    if (needsMigration()) {
      console.error("[Store] Migrating from JSON to SQLite...");
      const result = runMigration();
      if (!result.success) {
        console.error("[Store] Migration had errors:", result.errors);
      }
    }

    const taskCount = this.getTasks().length;
    const sprintCount = this.getSprints().length;
    console.error(`[Store] Loaded ${taskCount} tasks, ${sprintCount} sprints from SQLite`);

    this.initialized = true;
  }

  /**
   * No-op for SQLite (auto-persists on every write)
   * Kept for API compatibility
   */
  async persist(): Promise<void> {
    db.updateLastModified();
  }

  /**
   * Get the complete board state (reconstructed from SQLite)
   */
  getBoard(): Board {
    const tasks = this.getTasks();
    const sprints = this.getSprints();
    const lastModified = db.getLastModified();

    return {
      tasks,
      sprints,
      lastModified,
    };
  }

  /**
   * Get tasks with optional filters
   */
  getTasks(filter?: { column?: Column; assignee?: string }): Task[] {
    let sql = "SELECT data FROM tasks WHERE 1=1";
    const params: any[] = [];

    if (filter?.column) {
      sql += " AND column_status = ?";
      params.push(filter.column);
    }

    if (filter?.assignee) {
      sql += " AND assignee = ?";
      params.push(filter.assignee);
    }

    sql += " ORDER BY updated_at DESC";

    const rows = db.query<{ data: string }>(sql, params);
    return rows.map((row) => JSON.parse(row.data) as Task);
  }

  /**
   * Get a task by ID
   */
  getTask(id: string): Task | undefined {
    const row = db.queryOne<{ data: string }>(
      "SELECT data FROM tasks WHERE id = ?",
      [id]
    );
    return row ? (JSON.parse(row.data) as Task) : undefined;
  }

  /**
   * Add a new task to the board
   */
  addTask(task: Task): void {
    db.run("INSERT INTO tasks (id, data) VALUES (?, ?)", [
      task.id,
      JSON.stringify(task),
    ]);
    db.updateLastModified();
  }

  /**
   * Update an existing task
   * @returns The updated task or null if not found
   */
  updateTask(id: string, updates: Partial<Omit<Task, "id" | "createdAt">>): Task | null {
    const task = this.getTask(id);
    if (!task) return null;

    Object.assign(task, updates, { updatedAt: new Date().toISOString() });

    db.run("UPDATE tasks SET data = ? WHERE id = ?", [
      JSON.stringify(task),
      id,
    ]);
    db.updateLastModified();

    return task;
  }

  /**
   * Delete a task from the board
   * @returns true if deleted, false if not found
   */
  deleteTask(id: string): boolean {
    const result = db.run("DELETE FROM tasks WHERE id = ?", [id]);
    if (result.changes > 0) {
      db.updateLastModified();
      return true;
    }
    return false;
  }

  /**
   * Get board statistics
   */
  getStats(backlogThreshold: number = 3): BoardStats {
    const tasks = this.getTasks();
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
   * Check for circular dependencies
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
   * Add a dependency between tasks
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

    // Update task's dependsOn array
    task.dependsOn = [...(task.dependsOn || []), dependsOnId];
    task.updatedAt = new Date().toISOString();
    db.run("UPDATE tasks SET data = ? WHERE id = ?", [JSON.stringify(task), taskId]);

    // Update dependsOnTask's blocks array
    dependsOnTask.blocks = [...(dependsOnTask.blocks || []), taskId];
    dependsOnTask.updatedAt = new Date().toISOString();
    db.run("UPDATE tasks SET data = ? WHERE id = ?", [JSON.stringify(dependsOnTask), dependsOnId]);

    db.updateLastModified();
    return null;
  }

  /**
   * Remove a dependency between tasks
   */
  removeDependency(taskId: string, dependsOnId: string): string | null {
    const task = this.getTask(taskId);
    const dependsOnTask = this.getTask(dependsOnId);

    if (!task) return `Task not found: ${taskId}`;
    if (!dependsOnTask) return `Dependency task not found: ${dependsOnId}`;
    if (!task.dependsOn?.includes(dependsOnId)) return "Dependency does not exist";

    // Update task's dependsOn array
    task.dependsOn = task.dependsOn.filter((id) => id !== dependsOnId);
    task.updatedAt = new Date().toISOString();
    db.run("UPDATE tasks SET data = ? WHERE id = ?", [JSON.stringify(task), taskId]);

    // Update dependsOnTask's blocks array
    dependsOnTask.blocks = (dependsOnTask.blocks || []).filter((id) => id !== taskId);
    dependsOnTask.updatedAt = new Date().toISOString();
    db.run("UPDATE tasks SET data = ? WHERE id = ?", [JSON.stringify(dependsOnTask), dependsOnId]);

    db.updateLastModified();
    return null;
  }

  /**
   * Perform a health check on the board
   */
  getHealthCheck(staleThresholdHours: number = 24): HealthCheck {
    const tasks = this.getTasks();
    const issues: HealthIssue[] = [];
    const now = new Date();

    // Check for stale tasks in progress
    const staleTasks = tasks.filter((t) => {
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
        taskIds: staleTasks.map((t) => t.id),
      });
    }

    // Check for unassigned blocked tasks
    const unassignedBlocked = tasks.filter((t) => t.column === "blocked" && !t.assignee);
    if (unassignedBlocked.length > 0) {
      issues.push({
        type: "unassigned_blocked",
        severity: "high",
        message: `${unassignedBlocked.length} blocked task(s) without assignee`,
        taskIds: unassignedBlocked.map((t) => t.id),
      });
    }

    // Check for low backlog
    const backlogCount = tasks.filter((t) => t.column === "backlog").length;
    if (backlogCount < 3) {
      issues.push({
        type: "low_backlog",
        severity: backlogCount === 0 ? "critical" : "medium",
        message:
          backlogCount === 0
            ? "Backlog is empty! No tasks available for agents"
            : `Low backlog: only ${backlogCount} task(s) available`,
      });
    }

    // Check for overloaded agents
    const agentTaskCounts: Record<string, number> = {};
    tasks
      .filter((t) => t.column === "in_progress" && t.assignee)
      .forEach((t) => {
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
      (t) => t.priority === "critical" && t.column === "backlog"
    );
    if (criticalNotStarted.length > 0) {
      issues.push({
        type: "stale_task",
        severity: "critical",
        message: `${criticalNotStarted.length} critical priority task(s) not yet started`,
        taskIds: criticalNotStarted.map((t) => t.id),
      });
    }

    // Check for pending QA backlog
    const pendingQaTasks = tasks.filter((t) => t.pendingQa);
    if (pendingQaTasks.length > 3) {
      issues.push({
        type: "pending_qa_backlog",
        severity: pendingQaTasks.length > 5 ? "high" : "medium",
        message: `${pendingQaTasks.length} task(s) waiting for QA review`,
        taskIds: pendingQaTasks.map((t) => t.id),
      });
    }

    // Determine overall status
    let status: "healthy" | "warning" | "critical" = "healthy";
    if (issues.some((i) => i.severity === "critical")) {
      status = "critical";
    } else if (issues.some((i) => i.severity === "high" || i.severity === "medium")) {
      status = "warning";
    }

    return {
      status,
      issues,
      summary:
        issues.length === 0
          ? "All systems healthy. No issues detected."
          : `Found ${issues.length} issue(s): ${issues.filter((i) => i.severity === "critical").length} critical, ${issues.filter((i) => i.severity === "high").length} high, ${issues.filter((i) => i.severity === "medium").length} medium, ${issues.filter((i) => i.severity === "low").length} low`,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SPRINT MANAGEMENT (Level 1 Ralph Wiggum)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get all sprints
   */
  getSprints(): Sprint[] {
    const rows = db.query<{ data: string }>(
      "SELECT data FROM sprints ORDER BY updated_at DESC"
    );
    return rows.map((row) => JSON.parse(row.data) as Sprint);
  }

  /**
   * Get a sprint by ID
   */
  getSprint(id: string): Sprint | undefined {
    const row = db.queryOne<{ data: string }>(
      "SELECT data FROM sprints WHERE id = ?",
      [id]
    );
    return row ? (JSON.parse(row.data) as Sprint) : undefined;
  }

  /**
   * Add a new sprint
   */
  addSprint(sprint: Sprint): void {
    db.run("INSERT INTO sprints (id, data) VALUES (?, ?)", [
      sprint.id,
      JSON.stringify(sprint),
    ]);
    db.updateLastModified();
  }

  /**
   * Update a sprint
   */
  updateSprint(id: string, updates: Partial<Omit<Sprint, "id" | "createdAt">>): Sprint | null {
    const sprint = this.getSprint(id);
    if (!sprint) return null;

    Object.assign(sprint, updates, { updatedAt: new Date().toISOString() });

    db.run("UPDATE sprints SET data = ? WHERE id = ?", [
      JSON.stringify(sprint),
      id,
    ]);
    db.updateLastModified();

    return sprint;
  }

  /**
   * Delete a sprint
   */
  deleteSprint(id: string): boolean {
    const result = db.run("DELETE FROM sprints WHERE id = ?", [id]);
    if (result.changes > 0) {
      db.updateLastModified();
      return true;
    }
    return false;
  }

  /**
   * Get the active sprint (if any)
   */
  getActiveSprint(): Sprint | undefined {
    const row = db.queryOne<{ data: string }>(
      "SELECT data FROM sprints WHERE status IN ('planning', 'executing', 'reviewing') ORDER BY updated_at DESC LIMIT 1"
    );
    return row ? (JSON.parse(row.data) as Sprint) : undefined;
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

    db.run("UPDATE tasks SET data = ? WHERE id = ?", [JSON.stringify(task), taskId]);
    db.updateLastModified();

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

    db.run("UPDATE tasks SET data = ? WHERE id = ?", [JSON.stringify(task), taskId]);
    db.updateLastModified();

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

    db.run("UPDATE tasks SET data = ? WHERE id = ?", [JSON.stringify(task), taskId]);
    db.updateLastModified();

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

    db.run("UPDATE tasks SET data = ? WHERE id = ?", [JSON.stringify(task), taskId]);
    db.updateLastModified();

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
    const rejections = log.filter((e) => e.outcome === "rejected").length;

    // Calculate average iteration time
    let avgTime: number | undefined;
    const completedIterations = log.filter((e) => e.completedAt);
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

    db.run("UPDATE tasks SET data = ? WHERE id = ?", [JSON.stringify(task), taskId]);
    db.updateLastModified();

    return task;
  }

  /**
   * Get tasks that have exceeded max iterations (need escalation)
   */
  getEscalatedTasks(): Task[] {
    // Use SQL query with generated columns for efficiency
    const rows = db.query<{ data: string }>(
      "SELECT data FROM tasks WHERE iteration > max_iterations AND column_status != 'done'"
    );
    return rows.map((row) => JSON.parse(row.data) as Task);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTEXT BRIDGE HELPERS (New for session management)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if board is empty (for auto-initialization)
   */
  isEmpty(): boolean {
    const result = db.queryOne<{ count: number }>("SELECT COUNT(*) as count FROM tasks");
    return (result?.count ?? 0) === 0;
  }

  /**
   * Get tasks pending QA review
   */
  getPendingQaTasks(): Task[] {
    const rows = db.query<{ data: string }>(
      "SELECT data FROM tasks WHERE pending_qa = 1 ORDER BY updated_at ASC"
    );
    return rows.map((row) => JSON.parse(row.data) as Task);
  }

  /**
   * Get blocked tasks
   */
  getBlockedTasks(): Task[] {
    const rows = db.query<{ data: string }>(
      "SELECT data FROM tasks WHERE column_status = 'blocked' ORDER BY priority DESC, updated_at ASC"
    );
    return rows.map((row) => JSON.parse(row.data) as Task);
  }

  /**
   * Get critical priority tasks not yet done
   */
  getCriticalTasks(): Task[] {
    const rows = db.query<{ data: string }>(
      "SELECT data FROM tasks WHERE priority = 'critical' AND column_status != 'done' ORDER BY updated_at ASC"
    );
    return rows.map((row) => JSON.parse(row.data) as Task);
  }

  /**
   * Get suggested next task for an agent (highest priority unblocked task)
   */
  getSuggestedNextTask(agentId?: string): Task | null {
    let sql = `
      SELECT data FROM tasks
      WHERE column_status = 'backlog'
      ORDER BY
        CASE priority
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END,
        updated_at ASC
      LIMIT 1
    `;

    const row = db.queryOne<{ data: string }>(sql);
    return row ? (JSON.parse(row.data) as Task) : null;
  }
}

// Singleton instance
export const store = new KanbanStore();
