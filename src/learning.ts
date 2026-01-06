import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import type { FeedbackCategory, FeedbackSeverity } from "./types";

// Resolver path absoluto al directorio data
const __dirname = dirname(import.meta.path);
const DATA_DIR = join(__dirname, "..", "data");
const LEARNING_PATH = join(DATA_DIR, "learning.json");

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
 * Complete learning store structure
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
// LEARNING STORE CLASS
// ═══════════════════════════════════════════════════════════════════════════

class LearningStore {
  private data: LearningData = {
    agents: {},
    project: {
      lessonsLearned: [],
      codebaseConventions: [],
      lastUpdated: new Date().toISOString(),
    },
  };

  /**
   * Load learning data from disk
   */
  async load(): Promise<void> {
    if (!existsSync(DATA_DIR)) {
      await mkdir(DATA_DIR, { recursive: true });
    }

    if (existsSync(LEARNING_PATH)) {
      try {
        const raw = await readFile(LEARNING_PATH, "utf-8");
        this.data = JSON.parse(raw);
        console.error(`[Learning] Loaded learning data for ${Object.keys(this.data.agents).length} agents`);
      } catch (error) {
        console.error("[Learning] Error loading data, starting fresh:", error);
        await this.persist();
      }
    } else {
      console.error("[Learning] No existing learning data, creating new store");
      await this.persist();
    }
  }

  /**
   * Persist learning data to disk
   */
  async persist(): Promise<void> {
    this.data.project.lastUpdated = new Date().toISOString();
    await writeFile(LEARNING_PATH, JSON.stringify(this.data, null, 2));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 2: AGENT LEARNING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get or create an agent's learning profile
   */
  getAgentProfile(agentId: string): AgentLearningProfile {
    if (!this.data.agents[agentId]) {
      this.data.agents[agentId] = {
        agentId,
        tasksCompleted: 0,
        totalIterations: 0,
        avgIterationsPerTask: 0,
        mistakePatterns: [],
        strengths: [],
        recentFeedback: [],
        lastUpdated: new Date().toISOString(),
      };
    }
    return this.data.agents[agentId];
  }

  /**
   * Record a task completion for an agent
   */
  async recordTaskCompletion(
    agentId: string,
    iterationsUsed: number
  ): Promise<void> {
    const profile = this.getAgentProfile(agentId);
    profile.tasksCompleted++;
    profile.totalIterations += iterationsUsed;
    profile.avgIterationsPerTask =
      profile.totalIterations / profile.tasksCompleted;
    profile.lastUpdated = new Date().toISOString();
    await this.persist();
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
    await this.persist();

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
    return Object.values(this.data.agents).map((agent) => ({
      agentId: agent.agentId,
      tasksCompleted: agent.tasksCompleted,
      avgIterations: agent.avgIterationsPerTask,
      topMistakeCategory:
        agent.mistakePatterns.length > 0
          ? agent.mistakePatterns[0].category
          : null,
    }));
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
    const existingIndex = this.data.project.lessonsLearned.findIndex(
      (l) => l.category === category && l.lesson.toLowerCase() === lesson.toLowerCase()
    );

    if (existingIndex >= 0) {
      // Update existing lesson
      const existing = this.data.project.lessonsLearned[existingIndex];
      existing.occurrences++;
      existing.confidence = Math.min(1, existing.confidence + 0.1);
      existing.updatedAt = now;
      await this.persist();
      return existing;
    }

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

    this.data.project.lessonsLearned.push(newLesson);
    await this.persist();
    return newLesson;
  }

  /**
   * Get relevant project lessons for a task category
   */
  getRelevantLessons(categories?: FeedbackCategory[]): ProjectLesson[] {
    let lessons = this.data.project.lessonsLearned;

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
    const existing = this.data.project.codebaseConventions.find(
      (c) => c.pattern === pattern
    );

    if (existing) {
      existing.description = description;
      existing.examples = [...new Set([...existing.examples, ...examples])];
    } else {
      this.data.project.codebaseConventions.push({
        pattern,
        description,
        examples,
        addedAt: new Date().toISOString(),
      });
    }

    await this.persist();
  }

  /**
   * Get codebase conventions
   */
  getCodebaseConventions(): CodebaseConvention[] {
    return this.data.project.codebaseConventions;
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
    const agentsWithPattern = Object.values(this.data.agents).filter((agent) =>
      agent.mistakePatterns.some(
        (p) => p.category === category && p.occurrences >= 2
      )
    );

    if (agentsWithPattern.length >= 2) {
      // Extract a lesson from the feedback
      const lesson = this.extractLessonFromFeedback(category, feedback);
      if (lesson) {
        await this.addProjectLesson(
          category,
          lesson,
          `Auto-promoted from task ${sourceTaskId}`
        );
        console.error(`[Learning] Promoted pattern to project lesson: ${lesson}`);
      }
    }
  }

  private extractLessonFromFeedback(
    category: FeedbackCategory,
    feedback: string
  ): string | null {
    // Simple extraction - in a real system this could use AI
    // For now, just clean up and use the feedback as the lesson
    const cleaned = feedback
      .replace(/^REJECTED:\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned.length > 10 && cleaned.length < 200) {
      return `${this.getCategoryDescription(category)}: ${cleaned}`;
    }

    return null;
  }

  /**
   * Get complete learning context for an agent starting a task
   */
  getFullContext(agentId: string, taskCategories?: FeedbackCategory[]): {
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
