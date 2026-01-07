/**
 * JSON to SQLite Migration Script
 *
 * Migrates existing kanban.json and learning.json data to SQLite database.
 * This is a one-time migration that preserves all existing data.
 *
 * Usage: bun run src/db/migrate-json.ts
 */

import { existsSync, readFileSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { db, DatabaseConnection } from "./database";

const __dirname = dirname(import.meta.path);
const { DATA_DIR } = DatabaseConnection.getPaths();
const KANBAN_JSON_PATH = join(DATA_DIR, "kanban.json");
const LEARNING_JSON_PATH = join(DATA_DIR, "learning.json");

interface MigrationResult {
  success: boolean;
  tasksImported: number;
  sprintsImported: number;
  agentsImported: number;
  lessonsImported: number;
  conventionsImported: number;
  errors: string[];
}

/**
 * Backup existing JSON files before migration
 */
function backupJsonFiles(): void {
  const timestamp = Date.now();

  if (existsSync(KANBAN_JSON_PATH)) {
    const backupPath = join(DATA_DIR, `kanban.${timestamp}.json.bak`);
    copyFileSync(KANBAN_JSON_PATH, backupPath);
    console.log(`[Migration] Backed up kanban.json to ${backupPath}`);
  }

  if (existsSync(LEARNING_JSON_PATH)) {
    const backupPath = join(DATA_DIR, `learning.${timestamp}.json.bak`);
    copyFileSync(LEARNING_JSON_PATH, backupPath);
    console.log(`[Migration] Backed up learning.json to ${backupPath}`);
  }
}

/**
 * Load and parse JSON data from kanban.json
 */
function loadKanbanJson(): { tasks: any[]; sprints: any[] } | null {
  if (!existsSync(KANBAN_JSON_PATH)) {
    console.log("[Migration] No kanban.json found, skipping board migration");
    return null;
  }

  try {
    const data = JSON.parse(readFileSync(KANBAN_JSON_PATH, "utf-8"));
    return {
      tasks: data.tasks || [],
      sprints: data.sprints || [],
    };
  } catch (error) {
    console.error("[Migration] Error parsing kanban.json:", error);
    return null;
  }
}

/**
 * Load and parse JSON data from learning.json
 */
function loadLearningJson(): {
  agents: Record<string, any>;
  project: { lessonsLearned: any[]; codebaseConventions: any[] };
} | null {
  if (!existsSync(LEARNING_JSON_PATH)) {
    console.log("[Migration] No learning.json found, skipping learning migration");
    return null;
  }

  try {
    const data = JSON.parse(readFileSync(LEARNING_JSON_PATH, "utf-8"));
    return {
      agents: data.agents || {},
      project: data.project || { lessonsLearned: [], codebaseConventions: [] },
    };
  } catch (error) {
    console.error("[Migration] Error parsing learning.json:", error);
    return null;
  }
}

/**
 * Migrate tasks to SQLite
 */
function migrateTasks(tasks: any[]): { count: number; errors: string[] } {
  const errors: string[] = [];
  let count = 0;

  const insertStmt = db.prepare(
    "INSERT OR REPLACE INTO tasks (id, data) VALUES (?, ?)"
  );

  for (const task of tasks) {
    try {
      insertStmt.run(task.id, JSON.stringify(task));
      count++;
    } catch (error) {
      errors.push(`Task ${task.id}: ${error}`);
    }
  }

  return { count, errors };
}

/**
 * Migrate sprints to SQLite
 */
function migrateSprints(sprints: any[]): { count: number; errors: string[] } {
  const errors: string[] = [];
  let count = 0;

  const insertStmt = db.prepare(
    "INSERT OR REPLACE INTO sprints (id, data) VALUES (?, ?)"
  );

  for (const sprint of sprints) {
    try {
      insertStmt.run(sprint.id, JSON.stringify(sprint));
      count++;
    } catch (error) {
      errors.push(`Sprint ${sprint.id}: ${error}`);
    }
  }

  return { count, errors };
}

/**
 * Migrate agent learning profiles to SQLite
 */
function migrateAgents(agents: Record<string, any>): { count: number; errors: string[] } {
  const errors: string[] = [];
  let count = 0;

  const insertStmt = db.prepare(
    "INSERT OR REPLACE INTO learning_agents (agent_id, data) VALUES (?, ?)"
  );

  for (const [agentId, profile] of Object.entries(agents)) {
    try {
      insertStmt.run(agentId, JSON.stringify(profile));
      count++;
    } catch (error) {
      errors.push(`Agent ${agentId}: ${error}`);
    }
  }

  return { count, errors };
}

/**
 * Migrate project lessons to SQLite
 */
function migrateLessons(lessons: any[]): { count: number; errors: string[] } {
  const errors: string[] = [];
  let count = 0;

  const insertStmt = db.prepare(
    "INSERT INTO learning_project (type, data, created_at) VALUES ('lesson', ?, ?)"
  );

  for (const lesson of lessons) {
    try {
      insertStmt.run(
        JSON.stringify(lesson),
        lesson.createdAt || new Date().toISOString()
      );
      count++;
    } catch (error) {
      errors.push(`Lesson ${lesson.id}: ${error}`);
    }
  }

  return { count, errors };
}

/**
 * Migrate codebase conventions to SQLite
 */
function migrateConventions(conventions: any[]): { count: number; errors: string[] } {
  const errors: string[] = [];
  let count = 0;

  const insertStmt = db.prepare(
    "INSERT INTO learning_project (type, data, created_at) VALUES ('convention', ?, ?)"
  );

  for (const convention of conventions) {
    try {
      insertStmt.run(
        JSON.stringify(convention),
        convention.addedAt || new Date().toISOString()
      );
      count++;
    } catch (error) {
      errors.push(`Convention ${convention.pattern}: ${error}`);
    }
  }

  return { count, errors };
}

/**
 * Check if migration is needed
 */
export function needsMigration(): boolean {
  // If JSON files exist but database has no data, migration is needed
  const hasJsonData = existsSync(KANBAN_JSON_PATH) || existsSync(LEARNING_JSON_PATH);
  if (!hasJsonData) return false;

  try {
    const taskCount = db.queryOne<{ count: number }>("SELECT COUNT(*) as count FROM tasks");
    const hasDbData = (taskCount?.count ?? 0) > 0;
    return hasJsonData && !hasDbData;
  } catch {
    return hasJsonData;
  }
}

/**
 * Run the complete migration
 */
export function runMigration(): MigrationResult {
  const result: MigrationResult = {
    success: false,
    tasksImported: 0,
    sprintsImported: 0,
    agentsImported: 0,
    lessonsImported: 0,
    conventionsImported: 0,
    errors: [],
  };

  console.log("[Migration] Starting JSON to SQLite migration...");

  // Backup existing files
  backupJsonFiles();

  // Initialize database (creates schema if needed)
  db.initialize();

  try {
    // Use a transaction for atomicity
    db.transaction(() => {
      // Migrate kanban data
      const kanbanData = loadKanbanJson();
      if (kanbanData) {
        const tasksResult = migrateTasks(kanbanData.tasks);
        result.tasksImported = tasksResult.count;
        result.errors.push(...tasksResult.errors);

        const sprintsResult = migrateSprints(kanbanData.sprints);
        result.sprintsImported = sprintsResult.count;
        result.errors.push(...sprintsResult.errors);
      }

      // Migrate learning data
      const learningData = loadLearningJson();
      if (learningData) {
        const agentsResult = migrateAgents(learningData.agents);
        result.agentsImported = agentsResult.count;
        result.errors.push(...agentsResult.errors);

        const lessonsResult = migrateLessons(learningData.project.lessonsLearned);
        result.lessonsImported = lessonsResult.count;
        result.errors.push(...lessonsResult.errors);

        const conventionsResult = migrateConventions(learningData.project.codebaseConventions);
        result.conventionsImported = conventionsResult.count;
        result.errors.push(...conventionsResult.errors);
      }

      // Update metadata
      db.updateLastModified();
    });

    result.success = result.errors.length === 0;

    console.log("[Migration] Migration complete:");
    console.log(`  - Tasks: ${result.tasksImported}`);
    console.log(`  - Sprints: ${result.sprintsImported}`);
    console.log(`  - Agents: ${result.agentsImported}`);
    console.log(`  - Lessons: ${result.lessonsImported}`);
    console.log(`  - Conventions: ${result.conventionsImported}`);

    if (result.errors.length > 0) {
      console.error("[Migration] Errors:", result.errors);
    }
  } catch (error) {
    result.errors.push(`Transaction failed: ${error}`);
    console.error("[Migration] Migration failed:", error);
  }

  return result;
}

// Run migration if executed directly
if (import.meta.main) {
  if (needsMigration()) {
    const result = runMigration();
    process.exit(result.success ? 0 : 1);
  } else {
    console.log("[Migration] No migration needed - database already has data or no JSON files found");
    process.exit(0);
  }
}
