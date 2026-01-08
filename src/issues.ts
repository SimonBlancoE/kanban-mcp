import { db } from "./db/database";
import type { IssueProvider, IssueSource, Task } from "./types";

/**
 * IssueImport - Record of an imported issue
 */
export interface IssueImport {
  id: number;
  provider: IssueProvider;
  repo: string;
  issueId: number;
  taskId: string;
  sprintId: string | null;
  importedAt: string;
  syncedAt: string | null;
}

/**
 * IssueImportStore - Tracks imported issues to prevent duplicates and enable sync
 */
class IssueImportStore {
  // ═══════════════════════════════════════════════════════════════════════════
  // IMPORT TRACKING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Record a new issue import
   */
  recordImport(
    provider: IssueProvider,
    repo: string,
    issueId: number,
    taskId: string,
    sprintId?: string
  ): IssueImport {
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO issue_imports (provider, repo, issue_id, task_id, sprint_id, imported_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [provider, repo, issueId, taskId, sprintId ?? null, now]
    );

    return {
      id: 0, // Will be set by SQLite
      provider,
      repo,
      issueId,
      taskId,
      sprintId: sprintId ?? null,
      importedAt: now,
      syncedAt: null,
    };
  }

  /**
   * Check if an issue has already been imported
   */
  isImported(provider: IssueProvider, repo: string, issueId: number): boolean {
    const row = db.queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM issue_imports WHERE provider = ? AND repo = ? AND issue_id = ?",
      [provider, repo, issueId]
    );
    return (row?.count ?? 0) > 0;
  }

  /**
   * Get import record by issue
   */
  getImportByIssue(
    provider: IssueProvider,
    repo: string,
    issueId: number
  ): IssueImport | null {
    const row = db.queryOne<IssueImport>(
      "SELECT * FROM issue_imports WHERE provider = ? AND repo = ? AND issue_id = ?",
      [provider, repo, issueId]
    );
    return row ?? null;
  }

  /**
   * Get import record by task ID
   */
  getImportByTask(taskId: string): IssueImport | null {
    const row = db.queryOne<IssueImport>(
      "SELECT * FROM issue_imports WHERE task_id = ?",
      [taskId]
    );
    return row ?? null;
  }

  /**
   * Get all imports for a sprint
   */
  getImportsBySprint(sprintId: string): IssueImport[] {
    return db.query<IssueImport>(
      "SELECT * FROM issue_imports WHERE sprint_id = ? ORDER BY imported_at ASC",
      [sprintId]
    );
  }

  /**
   * Get all imports for a repository
   */
  getImportsByRepo(provider: IssueProvider, repo: string): IssueImport[] {
    return db.query<IssueImport>(
      "SELECT * FROM issue_imports WHERE provider = ? AND repo = ? ORDER BY imported_at DESC",
      [provider, repo]
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SYNC TRACKING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Mark an issue as synced (commented/closed back to source)
   */
  markSynced(taskId: string): boolean {
    const result = db.run(
      "UPDATE issue_imports SET synced_at = ? WHERE task_id = ?",
      [new Date().toISOString(), taskId]
    );
    return result.changes > 0;
  }

  /**
   * Check if a task has been synced back to its source issue
   */
  isSynced(taskId: string): boolean {
    const row = db.queryOne<{ synced_at: string | null }>(
      "SELECT synced_at FROM issue_imports WHERE task_id = ?",
      [taskId]
    );
    return row?.synced_at !== null;
  }

  /**
   * Get all unsynced completed tasks (done with issueSource)
   */
  getUnsyncedCompletedTasks(): Array<{ taskId: string; issueId: number; repo: string; provider: IssueProvider }> {
    return db.query<{ taskId: string; issueId: number; repo: string; provider: IssueProvider }>(
      `SELECT ii.task_id as taskId, ii.issue_id as issueId, ii.repo, ii.provider
       FROM issue_imports ii
       JOIN tasks t ON ii.task_id = t.id
       WHERE ii.synced_at IS NULL
         AND t.column_status = 'done'
         AND t.pending_qa = 0`
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get import statistics for a repository
   */
  getRepoStats(provider: IssueProvider, repo: string): {
    totalImported: number;
    totalSynced: number;
    pendingSync: number;
  } {
    const row = db.queryOne<{ total: number; synced: number }>(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN synced_at IS NOT NULL THEN 1 ELSE 0 END) as synced
       FROM issue_imports
       WHERE provider = ? AND repo = ?`,
      [provider, repo]
    );

    const total = row?.total ?? 0;
    const synced = row?.synced ?? 0;

    return {
      totalImported: total,
      totalSynced: synced,
      pendingSync: total - synced,
    };
  }

  /**
   * Delete import record (when task is deleted)
   */
  deleteImport(taskId: string): boolean {
    const result = db.run("DELETE FROM issue_imports WHERE task_id = ?", [
      taskId,
    ]);
    return result.changes > 0;
  }

  /**
   * Build issue source metadata for a task
   */
  buildIssueSource(
    provider: IssueProvider,
    issueId: number,
    issueUrl: string,
    repo: string,
    labels: string[],
    originalTitle: string
  ): IssueSource {
    return {
      provider,
      issueId,
      issueUrl,
      repo,
      labels,
      originalTitle,
      importedAt: new Date().toISOString(),
    };
  }

  /**
   * Build a sync comment for a completed task
   */
  buildSyncComment(task: Task): string {
    const iterations = task.iteration;
    const maxIterations = task.maxIterations;
    const agent = task.assignee ?? "unassigned";

    let comment = `## Task Completed\n\n`;
    comment += `This issue was resolved via kanban task.\n\n`;
    comment += `**Agent**: ${agent}\n`;
    comment += `**Iterations**: ${iterations}/${maxIterations}\n`;

    if (task.description) {
      comment += `\n### Solution\n\n${task.description}\n`;
    }

    // Add iteration history summary if available
    if (task.iterationLog && task.iterationLog.length > 0) {
      const approved = task.iterationLog.find((l) => l.outcome === "approved");
      if (approved?.agentNotes) {
        comment += `\n### Final Notes\n\n${approved.agentNotes}\n`;
      }
    }

    comment += `\n---\n*Synced by claude-kanban-mcp*`;

    return comment;
  }
}

// Singleton instance
export const issueStore = new IssueImportStore();
