import { db } from "./db/database";
import type { FeedbackCategory, FeedbackSeverity } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// LEARNING DATA STRUCTURES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tier 1: Task-specific feedback (stored in task.iterationLog)
 * This is handled by the main store, not here.
 */

/**
 * Tier 2: Agent-specific learning patterns
 */
export interface AgentMistakePattern {
  category: FeedbackCategory;
  description: string;
  occurrences: number;
  lastSeen: string;
  exampleTaskIds: string[];
  mitigation?: string;
}

export interface AgentLearningProfile {
  agentId: string;
  tasksCompleted: number;
  totalIterations: number;
  avgIterationsPerTask: number;
  mistakePatterns: AgentMistakePattern[];
  strengths: string[];
  recentFeedback: Array<{
    taskId: string;
    taskTitle: string;
    feedback: string;
    category: FeedbackCategory;
    timestamp: string;
  }>;
  lastUpdated: string;
}

/**
 * Tier 3: Project-wide lessons learned
 */
export interface ProjectLesson {
  id: string;
  category: FeedbackCategory;
  lesson: string;
  source: string; // Which sprint/task taught this
  applicability: string[]; // Task types this applies to
  confidence: number; // 0-1, how validated is this lesson
  occurrences: number;
  createdAt: string;
  updatedAt: string;
}

export interface CodebaseConvention {
  pattern: string;
  description: string;
  examples: string[];
  addedAt: string;
}

/**
 * Complete learning store structure (for compatibility)
 */
export interface LearningData {
  agents: Record<string, AgentLearningProfile>;
  project: {
    lessonsLearned: ProjectLesson[];
    codebaseConventions: CodebaseConvention[];
    lastUpdated: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LEARNING STORE CLASS (SQLite-backed)
// ═══════════════════════════════════════════════════════════════════════════

class LearningStore {
  private initialized = false;

  /**
   * Initialize the learning store (no-op for SQLite, kept for API compatibility)
   */
  async load(): Promise<void> {
    if (this.initialized) return;

    // Ensure database is initialized
    db.initialize();

    const agentCount = this.getAllAgentStats().length;
    const lessonCount = this.getRelevantLessons().length;
    console.error(`[Learning] Loaded data for ${agentCount} agents, ${lessonCount} lessons from SQLite`);

    this.initialized = true;
  }

  /**
   * No-op for SQLite (auto-persists on every write)
   * Kept for API compatibility
   */
  async persist(): Promise<void> {
    // SQLite auto-persists
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 2: AGENT LEARNING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get or create an agent's learning profile
   */
  getAgentProfile(agentId: string): AgentLearningProfile {
    const row = db.queryOne<{ data: string }>(
      "SELECT data FROM learning_agents WHERE agent_id = ?",
      [agentId]
    );

    if (row) {
      return JSON.parse(row.data) as AgentLearningProfile;
    }

    // Create new profile
    const newProfile: AgentLearningProfile = {
      agentId,
      tasksCompleted: 0,
      totalIterations: 0,
      avgIterationsPerTask: 0,
      mistakePatterns: [],
      strengths: [],
      recentFeedback: [],
      lastUpdated: new Date().toISOString(),
    };

    db.run("INSERT INTO learning_agents (agent_id, data) VALUES (?, ?)", [
      agentId,
      JSON.stringify(newProfile),
    ]);

    return newProfile;
  }

  /**
   * Save an agent profile
   */
  private saveAgentProfile(profile: AgentLearningProfile): void {
    db.run("INSERT OR REPLACE INTO learning_agents (agent_id, data) VALUES (?, ?)", [
      profile.agentId,
      JSON.stringify(profile),
    ]);
  }

  /**
   * Record a task completion for an agent
   */
  async recordTaskCompletion(agentId: string, iterationsUsed: number): Promise<void> {
    const profile = this.getAgentProfile(agentId);
    profile.tasksCompleted++;
    profile.totalIterations += iterationsUsed;
    profile.avgIterationsPerTask = profile.totalIterations / profile.tasksCompleted;
    profile.lastUpdated = new Date().toISOString();
    this.saveAgentProfile(profile);
  }

  /**
   * Record feedback from a QA rejection to learn from mistakes
   */
  async recordRejectionFeedback(
    agentId: string,
    taskId: string,
    taskTitle: string,
    feedback: string,
    category: FeedbackCategory,
    severity: FeedbackSeverity
  ): Promise<void> {
    const profile = this.getAgentProfile(agentId);
    const now = new Date().toISOString();

    // Add to recent feedback (keep last 10)
    profile.recentFeedback.unshift({
      taskId,
      taskTitle,
      feedback,
      category,
      timestamp: now,
    });
    if (profile.recentFeedback.length > 10) {
      profile.recentFeedback = profile.recentFeedback.slice(0, 10);
    }

    // Update or create mistake pattern
    let pattern = profile.mistakePatterns.find((p) => p.category === category);
    if (pattern) {
      pattern.occurrences++;
      pattern.lastSeen = now;
      if (!pattern.exampleTaskIds.includes(taskId)) {
        pattern.exampleTaskIds.push(taskId);
        if (pattern.exampleTaskIds.length > 5) {
          pattern.exampleTaskIds = pattern.exampleTaskIds.slice(-5);
        }
      }
    } else {
      profile.mistakePatterns.push({
        category,
        description: this.getCategoryDescription(category),
        occurrences: 1,
        lastSeen: now,
        exampleTaskIds: [taskId],
      });
    }

    // Sort patterns by occurrences (most frequent first)
    profile.mistakePatterns.sort((a, b) => b.occurrences - a.occurrences);

    profile.lastUpdated = now;
    this.saveAgentProfile(profile);

    // Check if this pattern should be promoted to project-level lesson
    if (pattern && pattern.occurrences >= 3) {
      await this.maybePromoteToProjectLesson(category, feedback, taskId);
    }
  }

  /**
   * Get agent context for starting a task (what they should know)
   */
  getAgentContext(agentId: string): {
    mistakePatterns: AgentMistakePattern[];
    recentFeedback: AgentLearningProfile["recentFeedback"];
    avgIterations: number;
  } {
    const profile = this.getAgentProfile(agentId);
    return {
      mistakePatterns: profile.mistakePatterns.slice(0, 5), // Top 5 patterns
      recentFeedback: profile.recentFeedback.slice(0, 5), // Last 5 feedbacks
      avgIterations: profile.avgIterationsPerTask,
    };
  }

  /**
   * Get all agents' stats for architect overview
   */
  getAllAgentStats(): Array<{
    agentId: string;
    tasksCompleted: number;
    avgIterations: number;
    topMistakeCategory: FeedbackCategory | null;
  }> {
    const rows = db.query<{ data: string }>("SELECT data FROM learning_agents");

    return rows.map((row) => {
      const agent = JSON.parse(row.data) as AgentLearningProfile;
      return {
        agentId: agent.agentId,
        tasksCompleted: agent.tasksCompleted,
        avgIterations: agent.avgIterationsPerTask,
        topMistakeCategory:
          agent.mistakePatterns.length > 0 ? agent.mistakePatterns[0].category : null,
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 3: PROJECT LEARNING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add a project-level lesson (manually by architect or auto-promoted)
   */
  async addProjectLesson(
    category: FeedbackCategory,
    lesson: string,
    source: string,
    applicability: string[] = []
  ): Promise<ProjectLesson> {
    const now = new Date().toISOString();
    const id = `lesson-${Date.now()}`;

    // Check if similar lesson already exists
    const existingRows = db.query<{ id: number; data: string }>(
      "SELECT id, data FROM learning_project WHERE type = 'lesson'"
    );

    for (const row of existingRows) {
      const existing = JSON.parse(row.data) as ProjectLesson;
      if (existing.category === category && existing.lesson.toLowerCase() === lesson.toLowerCase()) {
        // Update existing lesson
        existing.occurrences++;
        existing.confidence = Math.min(1, existing.confidence + 0.1);
        existing.updatedAt = now;
        db.run("UPDATE learning_project SET data = ? WHERE id = ?", [
          JSON.stringify(existing),
          row.id,
        ]);
        return existing;
      }
    }

    // Create new lesson
    const newLesson: ProjectLesson = {
      id,
      category,
      lesson,
      source,
      applicability,
      confidence: 0.5,
      occurrences: 1,
      createdAt: now,
      updatedAt: now,
    };

    db.run("INSERT INTO learning_project (type, data, created_at) VALUES ('lesson', ?, ?)", [
      JSON.stringify(newLesson),
      now,
    ]);

    return newLesson;
  }

  /**
   * Get relevant project lessons for a task category
   */
  getRelevantLessons(categories?: FeedbackCategory[]): ProjectLesson[] {
    const rows = db.query<{ data: string }>(
      "SELECT data FROM learning_project WHERE type = 'lesson'"
    );

    let lessons = rows.map((row) => JSON.parse(row.data) as ProjectLesson);

    if (categories && categories.length > 0) {
      lessons = lessons.filter((l) => categories.includes(l.category));
    }

    // Sort by confidence and occurrences
    return lessons
      .sort((a, b) => b.confidence * b.occurrences - a.confidence * a.occurrences)
      .slice(0, 10);
  }

  /**
   * Add a codebase convention
   */
  async addCodebaseConvention(
    pattern: string,
    description: string,
    examples: string[] = []
  ): Promise<void> {
    const now = new Date().toISOString();

    // Check if convention with this pattern exists
    const existingRows = db.query<{ id: number; data: string }>(
      "SELECT id, data FROM learning_project WHERE type = 'convention'"
    );

    for (const row of existingRows) {
      const existing = JSON.parse(row.data) as CodebaseConvention;
      if (existing.pattern === pattern) {
        // Update existing
        existing.description = description;
        existing.examples = [...new Set([...existing.examples, ...examples])];
        db.run("UPDATE learning_project SET data = ? WHERE id = ?", [
          JSON.stringify(existing),
          row.id,
        ]);
        return;
      }
    }

    // Create new convention
    const convention: CodebaseConvention = {
      pattern,
      description,
      examples,
      addedAt: now,
    };

    db.run("INSERT INTO learning_project (type, data, created_at) VALUES ('convention', ?, ?)", [
      JSON.stringify(convention),
      now,
    ]);
  }

  /**
   * Get codebase conventions
   */
  getCodebaseConventions(): CodebaseConvention[] {
    const rows = db.query<{ data: string }>(
      "SELECT data FROM learning_project WHERE type = 'convention'"
    );
    return rows.map((row) => JSON.parse(row.data) as CodebaseConvention);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private getCategoryDescription(category: FeedbackCategory): string {
    const descriptions: Record<FeedbackCategory, string> = {
      logic: "Logic errors and incorrect implementations",
      testing: "Missing or inadequate test coverage",
      style: "Code style and formatting issues",
      security: "Security vulnerabilities or unsafe practices",
      performance: "Performance issues or inefficiencies",
      "missing-feature": "Incomplete implementation of requirements",
      other: "Other issues",
    };
    return descriptions[category];
  }

  /**
   * Check if a frequently occurring pattern should become a project lesson
   */
  private async maybePromoteToProjectLesson(
    category: FeedbackCategory,
    feedback: string,
    sourceTaskId: string
  ): Promise<void> {
    // Check if multiple agents have this pattern
    const rows = db.query<{ data: string }>("SELECT data FROM learning_agents");
    const agents = rows.map((row) => JSON.parse(row.data) as AgentLearningProfile);

    const agentsWithPattern = agents.filter((agent) =>
      agent.mistakePatterns.some((p) => p.category === category && p.occurrences >= 2)
    );

    if (agentsWithPattern.length >= 2) {
      // Extract a lesson from the feedback
      const lesson = this.extractLessonFromFeedback(category, feedback);
      if (lesson) {
        await this.addProjectLesson(category, lesson, `Auto-promoted from task ${sourceTaskId}`);
        console.error(`[Learning] Promoted pattern to project lesson: ${lesson}`);
      }
    }
  }

  private extractLessonFromFeedback(category: FeedbackCategory, feedback: string): string | null {
    // Simple extraction - in a real system this could use AI
    // For now, just clean up and use the feedback as the lesson
    const cleaned = feedback.replace(/^REJECTED:\s*/i, "").replace(/\s+/g, " ").trim();

    if (cleaned.length > 10 && cleaned.length < 200) {
      return `${this.getCategoryDescription(category)}: ${cleaned}`;
    }

    return null;
  }

  /**
   * Get complete learning context for an agent starting a task
   */
  getFullContext(
    agentId: string,
    taskCategories?: FeedbackCategory[]
  ): {
    agentMistakes: AgentMistakePattern[];
    agentRecentFeedback: AgentLearningProfile["recentFeedback"];
    projectLessons: ProjectLesson[];
    codebaseConventions: CodebaseConvention[];
  } {
    const agentContext = this.getAgentContext(agentId);
    return {
      agentMistakes: agentContext.mistakePatterns,
      agentRecentFeedback: agentContext.recentFeedback,
      projectLessons: this.getRelevantLessons(taskCategories),
      codebaseConventions: this.getCodebaseConventions(),
    };
  }
}

// Singleton instance
export const learningStore = new LearningStore();
