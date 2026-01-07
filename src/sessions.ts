/**
 * Session Management for Context Bridge
 *
 * Based on Anthropic's "Effective harnesses for long-running agents"
 * Provides session tracking for cross-context-window continuity.
 */

import { randomUUID } from "crypto";
import { writeFileSync } from "fs";
import { join } from "path";
import { db, DatabaseConnection } from "./db/database";
import { store } from "./store";
import { learningStore } from "./learning";
import type {
  Session,
  SessionContext,
  SessionEndInput,
  BoardHealthVerification,
  Task,
  Sprint,
} from "./types";

const { DATA_DIR } = DatabaseConnection.getPaths();
const SUMMARY_PATH = join(DATA_DIR, "session-summary.md");

/**
 * SessionStore - SQLite-backed session management
 */
class SessionStore {
  /**
   * Start a new session for an agent
   */
  startSession(agentId: string, contextSummary?: string): Session {
    const now = new Date().toISOString();
    const session: Session = {
      id: randomUUID(),
      agentId,
      startedAt: now,
      status: "active",
      contextSummary,
      pendingItems: [],
      knownIssues: [],
      cleanState: false,
      tasksTouched: [],
    };

    db.run(
      `INSERT INTO sessions (id, agent_id, started_at, status, context_summary, pending_items, known_issues, clean_state, tasks_touched)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.agentId,
        session.startedAt,
        session.status,
        session.contextSummary || null,
        JSON.stringify(session.pendingItems),
        JSON.stringify(session.knownIssues),
        session.cleanState ? 1 : 0,
        JSON.stringify(session.tasksTouched),
      ]
    );

    // Log activity
    this.logActivity(agentId, "session_start", undefined, undefined, `Session ${session.id} started`);

    return session;
  }

  /**
   * End a session with notes and optional git commit
   */
  async endSession(input: SessionEndInput): Promise<{ sessionId: string; gitCommitHash?: string }> {
    const now = new Date().toISOString();

    // Find active session for this agent
    let activeSession = this.getActiveSession(input.agentId);
    if (!activeSession) {
      // No active session - create one that's immediately completed
      activeSession = this.startSession(input.agentId);
    }

    // Auto-commit if cleanState is true
    let gitCommitHash: string | undefined;
    if (input.cleanState) {
      gitCommitHash = await this.autoGitCommit(input.commitMessage || `[kanban] Session end: ${input.sessionNotes.slice(0, 50)}...`);
    }

    // Update session
    db.run(
      `UPDATE sessions SET
        ended_at = ?,
        status = 'completed',
        session_notes = ?,
        pending_items = ?,
        known_issues = ?,
        clean_state = ?,
        git_commit_hash = ?
       WHERE id = ?`,
      [
        now,
        input.sessionNotes,
        JSON.stringify(input.pendingItems || []),
        JSON.stringify(input.knownIssues || []),
        input.cleanState ? 1 : 0,
        gitCommitHash || null,
        activeSession.id,
      ]
    );

    // Log activity
    this.logActivity(input.agentId, "session_end", undefined, undefined, input.sessionNotes);

    // Generate summary file
    this.generateSummaryFile();

    return { sessionId: activeSession.id, gitCommitHash };
  }

  /**
   * Get the active session for an agent
   */
  getActiveSession(agentId: string): Session | null {
    const row = db.queryOne<any>(
      "SELECT * FROM sessions WHERE agent_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1",
      [agentId]
    );

    if (!row) return null;

    return this.rowToSession(row);
  }

  /**
   * Get the last completed session for an agent
   */
  getLastSession(agentId: string): Session | null {
    const row = db.queryOne<any>(
      "SELECT * FROM sessions WHERE agent_id = ? AND status = 'completed' ORDER BY ended_at DESC LIMIT 1",
      [agentId]
    );

    if (!row) return null;

    return this.rowToSession(row);
  }

  /**
   * Get session context for an agent starting work
   * This is the core of the "getting up to speed" routine from the Anthropic article
   */
  getSessionContext(agentId: string): SessionContext {
    // Get board state
    const stats = store.getStats();
    const activeSprint = store.getActiveSprint() || null;

    // Get recent activity
    const activityRows = db.query<any>(
      "SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT 10"
    );
    const recentActivity = activityRows.map((row) => ({
      timestamp: row.timestamp,
      agentId: row.agent_id,
      action: row.action,
      taskId: row.task_id,
      taskTitle: row.task_title,
    }));

    // Get urgent items
    const escalated = store.getEscalatedTasks();
    const blocked = store.getBlockedTasks();
    const critical = store.getCriticalTasks();

    // Get last session
    const lastSession = this.getLastSession(agentId);
    const lastSessionData = lastSession
      ? {
          id: lastSession.id,
          endedAt: lastSession.endedAt || lastSession.startedAt,
          sessionNotes: lastSession.sessionNotes || "",
          pendingItems: lastSession.pendingItems || [],
          knownIssues: lastSession.knownIssues || [],
        }
      : null;

    // Get suggested next task
    const suggestedNextTask = store.getSuggestedNextTask(agentId);

    // Get learning context
    const learningContext = learningStore.getFullContext(agentId);
    const mistakesToAvoid = learningContext.agentMistakes
      .slice(0, 3)
      .map((m) => `${m.category}: ${m.description}`);
    const projectConventions = learningContext.codebaseConventions
      .slice(0, 5)
      .map((c) => c.description);

    // Generate board summary
    const boardSummary = this.generateBoardSummary(stats, activeSprint);

    return {
      boardSummary,
      activeSprint,
      recentActivity,
      urgentItems: {
        escalated,
        blocked,
        critical,
      },
      lastSession: lastSessionData,
      suggestedNextTask,
      learningContext: {
        mistakesToAvoid,
        projectConventions,
      },
    };
  }

  /**
   * Verify board health before starting new work
   */
  verifyBoardHealth(): BoardHealthVerification {
    const health = store.getHealthCheck();
    const tasks = store.getTasks();

    const issues = {
      escalatedTasks: store.getEscalatedTasks().length,
      blockedTasks: store.getBlockedTasks().length,
      staleInProgress: tasks.filter((t) => {
        if (t.column !== "in_progress") return false;
        const hoursSinceUpdate =
          (Date.now() - new Date(t.updatedAt).getTime()) / (1000 * 60 * 60);
        return hoursSinceUpdate > 24;
      }).length,
      qaBacklog: store.getPendingQaTasks().length,
      orphanedTasks: tasks.filter((t) => !t.sprintId && !t.assignee && t.column === "backlog").length,
    };

    // Determine recommendation
    let recommendation: "proceed" | "fix_first" | "escalate" = "proceed";
    let suggestedAction: string | undefined;

    if (issues.escalatedTasks > 0) {
      recommendation = "escalate";
      suggestedAction = `${issues.escalatedTasks} task(s) have exceeded max iterations and need human review`;
    } else if (issues.staleInProgress > 2 || issues.blockedTasks > 2) {
      recommendation = "fix_first";
      suggestedAction =
        issues.staleInProgress > 2
          ? `${issues.staleInProgress} tasks are stale in progress - consider reviewing or moving them`
          : `${issues.blockedTasks} tasks are blocked - consider unblocking before new work`;
    }

    return {
      healthy: recommendation === "proceed",
      issues,
      recommendation,
      suggestedAction,
    };
  }

  /**
   * Generate a human-readable board summary
   */
  private generateBoardSummary(stats: ReturnType<typeof store.getStats>, activeSprint: Sprint | null): string {
    let summary = `Board: ${stats.total} tasks (${stats.backlog} backlog, ${stats.in_progress} in progress, ${stats.blocked} blocked, ${stats.done} done)`;

    if (activeSprint) {
      summary += `\nActive Sprint: "${activeSprint.goal}" - ${activeSprint.status} (iteration ${activeSprint.currentIteration}/${activeSprint.maxIterations})`;
    }

    if (stats.pendingQa > 0) {
      summary += `\n${stats.pendingQa} task(s) pending QA review`;
    }

    if (stats.byPriority.critical > 0) {
      summary += `\n${stats.byPriority.critical} CRITICAL priority task(s) need attention`;
    }

    return summary;
  }

  /**
   * Generate the session summary markdown file (claude-progress.txt equivalent)
   */
  generateSummaryFile(): void {
    const now = new Date();
    const stats = store.getStats();
    const activeSprint = store.getActiveSprint();
    const escalated = store.getEscalatedTasks();
    const blocked = store.getBlockedTasks();
    const health = store.getHealthCheck();

    // Get recent activity
    const activityRows = db.query<any>(
      "SELECT * FROM activity_log WHERE timestamp > datetime('now', '-24 hours') ORDER BY timestamp DESC LIMIT 20"
    );

    let content = `# Kanban Board State
Generated: ${now.toISOString()}

## Board Overview
- **Total Tasks**: ${stats.total}
- **Backlog**: ${stats.backlog}
- **In Progress**: ${stats.in_progress}
- **Blocked**: ${stats.blocked}
- **Done**: ${stats.done}
- **Pending QA**: ${stats.pendingQa}

## Priority Breakdown
| Priority | Count |
|----------|-------|
| Critical | ${stats.byPriority.critical} |
| High | ${stats.byPriority.high} |
| Medium | ${stats.byPriority.medium} |
| Low | ${stats.byPriority.low} |

`;

    if (activeSprint) {
      const taskCount = activeSprint.taskIds?.length || 0;
      const completedTasks = activeSprint.taskIds
        ? activeSprint.taskIds.filter((id) => {
            const task = store.getTask(id);
            return task?.column === "done";
          }).length
        : 0;

      content += `## Active Sprint: ${activeSprint.goal}
- **Status**: ${activeSprint.status} (iteration ${activeSprint.currentIteration}/${activeSprint.maxIterations})
- **Progress**: ${completedTasks}/${taskCount} tasks complete (${taskCount > 0 ? Math.round((completedTasks / taskCount) * 100) : 0}%)

`;
    }

    if (activityRows.length > 0) {
      content += `## Recent Activity (Last 24h)
`;
      for (const row of activityRows.slice(0, 10)) {
        const time = new Date(row.timestamp).toLocaleTimeString();
        content += `- ${time} - ${row.agent_id || "system"}: ${row.action}${row.task_title ? ` "${row.task_title}"` : ""}\n`;
      }
      content += "\n";
    }

    if (escalated.length > 0 || blocked.length > 0) {
      content += `## Attention Required
`;
      if (escalated.length > 0) {
        content += `### Escalated (Exceeded Max Iterations)
`;
        for (const task of escalated) {
          content += `- [${task.id.slice(0, 8)}] "${task.title}" - ${task.iteration}/${task.maxIterations} iterations\n`;
        }
        content += "\n";
      }
      if (blocked.length > 0) {
        content += `### Blocked
`;
        for (const task of blocked) {
          content += `- [${task.id.slice(0, 8)}] "${task.title}"${task.assignee ? ` (${task.assignee})` : ""}\n`;
        }
        content += "\n";
      }
    }

    // Health status
    content += `## Health Status: ${health.status.toUpperCase()}
${health.summary}

`;

    // Suggestions
    const suggestedTask = store.getSuggestedNextTask();
    if (suggestedTask || escalated.length > 0) {
      content += `## Next Session Suggestions
`;
      if (escalated.length > 0) {
        content += `1. Review escalated tasks (need human decision)\n`;
      }
      if (blocked.length > 0) {
        content += `2. Unblock blocked tasks\n`;
      }
      if (suggestedTask) {
        content += `${escalated.length + blocked.length + 1}. Continue with "${suggestedTask.title}" (${suggestedTask.priority} priority)\n`;
      }
    }

    // Write file
    writeFileSync(SUMMARY_PATH, content, "utf-8");
  }

  /**
   * Log agent activity
   */
  logActivity(
    agentId: string,
    action: string,
    taskId?: string,
    taskTitle?: string,
    details?: string
  ): void {
    db.run(
      `INSERT INTO activity_log (agent_id, action, task_id, task_title, details)
       VALUES (?, ?, ?, ?, ?)`,
      [agentId, action, taskId || null, taskTitle || null, details || null]
    );
  }

  /**
   * Record task touch for session
   */
  recordTaskTouch(agentId: string, taskId: string): void {
    const session = this.getActiveSession(agentId);
    if (!session) return;

    if (!session.tasksTouched.includes(taskId)) {
      session.tasksTouched.push(taskId);
      db.run("UPDATE sessions SET tasks_touched = ? WHERE id = ?", [
        JSON.stringify(session.tasksTouched),
        session.id,
      ]);
    }
  }

  /**
   * Auto git commit using Bun's spawn (safer than shell commands)
   */
  private async autoGitCommit(message: string): Promise<string | undefined> {
    try {
      // Check if there are changes to commit using Bun.spawn
      const statusProc = Bun.spawn(["git", "status", "--porcelain"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const statusOutput = await new Response(statusProc.stdout).text();
      await statusProc.exited;

      if (!statusOutput.trim()) {
        return undefined; // No changes
      }

      // Stage all changes
      const addProc = Bun.spawn(["git", "add", "-A"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await addProc.exited;

      // Commit with message
      const commitProc = Bun.spawn(["git", "commit", "-m", message], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await commitProc.exited;

      // Get commit hash
      const hashProc = Bun.spawn(["git", "rev-parse", "HEAD"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const hash = await new Response(hashProc.stdout).text();
      await hashProc.exited;

      return hash.trim();
    } catch (error) {
      console.error("[Sessions] Auto-commit failed:", error);
      return undefined;
    }
  }

  /**
   * Convert database row to Session object
   */
  private rowToSession(row: any): Session {
    return {
      id: row.id,
      agentId: row.agent_id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      status: row.status,
      contextSummary: row.context_summary,
      sessionNotes: row.session_notes,
      pendingItems: JSON.parse(row.pending_items || "[]"),
      knownIssues: JSON.parse(row.known_issues || "[]"),
      cleanState: Boolean(row.clean_state),
      gitCommitHash: row.git_commit_hash,
      tasksTouched: JSON.parse(row.tasks_touched || "[]"),
    };
  }
}

// Singleton instance
export const sessionStore = new SessionStore();
