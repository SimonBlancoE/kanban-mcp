import { Database } from "bun:sqlite";
import { readFileSync, existsSync, readdirSync } from "fs";
import { mkdirSync } from "fs";
import { join, dirname } from "path";

// Resolve absolute path to data directory (relative to module, not cwd)
const __dirname = dirname(import.meta.path);
const DATA_DIR = join(__dirname, "..", "..", "data");
const DB_PATH = join(DATA_DIR, "kanban.db");
const SCHEMA_PATH = join(__dirname, "schema.sql");
const MIGRATIONS_DIR = join(__dirname, "migrations");

// Current schema version (increment when adding migrations)
const CURRENT_SCHEMA_VERSION = 2;

/**
 * DatabaseConnection - SQLite connection manager for Claude Kanban MCP
 *
 * Features:
 * - WAL mode for concurrent read/write
 * - Automatic schema initialization
 * - Transaction support
 * - Prepared statement caching
 */
class DatabaseConnection {
  private db: Database | null = null;
  private initialized = false;

  /**
   * Get the database instance, initializing if necessary
   */
  getDb(): Database {
    if (!this.db) {
      this.initialize();
    }
    return this.db!;
  }

  /**
   * Initialize the database connection and schema
   */
  initialize(): void {
    if (this.initialized && this.db) return;

    // Ensure data directory exists
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }

    // Check if this is a fresh database
    const isNew = !existsSync(DB_PATH);

    // Open database connection
    this.db = new Database(DB_PATH);

    // Configure for performance and safety using SQLite run method
    this.db.run("PRAGMA journal_mode = WAL");      // Required for concurrent access
    this.db.run("PRAGMA synchronous = NORMAL");    // Balance safety/performance
    this.db.run("PRAGMA foreign_keys = ON");       // Enforce referential integrity
    this.db.run("PRAGMA cache_size = -64000");     // 64MB cache
    this.db.run("PRAGMA temp_store = MEMORY");     // Use memory for temp tables

    // Initialize schema if needed
    if (isNew) {
      console.error(`[Database] Creating new database at ${DB_PATH}`);
      this.runSchema();
    } else {
      // Verify schema exists
      const tables = this.db.query("SELECT name FROM sqlite_master WHERE type='table'").all();
      const tableNames = tables.map((t: any) => t.name);

      if (!tableNames.includes("tasks") || !tableNames.includes("sessions")) {
        console.error("[Database] Schema incomplete, reinitializing...");
        this.runSchema();
      } else {
        // Run any pending migrations
        this.runMigrations();
      }
    }

    this.initialized = true;
    console.error(`[Database] Initialized at ${DB_PATH}`);
  }

  /**
   * Run the schema SQL to create all tables
   */
  private runSchema(): void {
    if (!this.db) throw new Error("Database not initialized");

    const schema = readFileSync(SCHEMA_PATH, "utf-8");
    // Run multi-statement SQL using Bun's run method
    this.db.run(schema);
    console.error("[Database] Schema created successfully");
  }

  /**
   * Run pending migrations to upgrade schema
   */
  private runMigrations(): void {
    if (!this.db) throw new Error("Database not initialized");

    const currentVersion = this.getSchemaVersion();
    if (currentVersion >= CURRENT_SCHEMA_VERSION) {
      return; // Already up to date
    }

    console.error(`[Database] Schema version ${currentVersion} -> ${CURRENT_SCHEMA_VERSION}, running migrations...`);

    // Check if migrations directory exists
    if (!existsSync(MIGRATIONS_DIR)) {
      console.error("[Database] No migrations directory found");
      return;
    }

    // Get all migration files sorted by version number
    const migrationFiles = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      // Extract version number from filename (e.g., "002-agent-issues.sql" -> 2)
      const match = file.match(/^(\d+)/);
      if (!match) continue;

      const migrationVersion = parseInt(match[1], 10);
      if (migrationVersion <= currentVersion) continue;
      if (migrationVersion > CURRENT_SCHEMA_VERSION) continue;

      console.error(`[Database] Running migration: ${file}`);
      const migrationPath = join(MIGRATIONS_DIR, file);
      const migrationSql = readFileSync(migrationPath, "utf-8");

      try {
        this.db.run(migrationSql);
        console.error(`[Database] Migration ${file} completed`);
      } catch (error) {
        console.error(`[Database] Migration ${file} failed:`, error);
        throw error;
      }
    }

    console.error(`[Database] Migrations complete, now at version ${CURRENT_SCHEMA_VERSION}`);
  }

  /**
   * Run SQL statements directly (for DDL and multi-statement SQL)
   */
  runSql(sql: string): void {
    this.getDb().run(sql);
  }

  /**
   * Execute a function within a transaction
   * If the function throws, the transaction is rolled back
   */
  transaction<T>(fn: () => T): T {
    const db = this.getDb();
    return db.transaction(fn)();
  }

  /**
   * Prepare a SQL statement (cached by Bun)
   */
  prepare<T = unknown>(sql: string) {
    return this.getDb().prepare<T, any>(sql);
  }

  /**
   * Run a query and return all results
   */
  query<T = unknown>(sql: string, params?: any[]): T[] {
    const stmt = this.prepare<T>(sql);
    return params ? stmt.all(...params) : stmt.all();
  }

  /**
   * Run a query and return the first result
   */
  queryOne<T = unknown>(sql: string, params?: any[]): T | null {
    const stmt = this.prepare<T>(sql);
    return (params ? stmt.get(...params) : stmt.get()) ?? null;
  }

  /**
   * Run a statement that modifies data (INSERT, UPDATE, DELETE)
   */
  run(sql: string, params?: any[]): { changes: number; lastInsertRowid: number } {
    const stmt = this.prepare(sql);
    const result = params ? stmt.run(...params) : stmt.run();
    return {
      changes: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }

  /**
   * Update the last_modified metadata timestamp
   */
  updateLastModified(): void {
    this.run(
      "INSERT OR REPLACE INTO metadata (key, value, updated_at) VALUES ('last_modified', datetime('now'), datetime('now'))"
    );
  }

  /**
   * Get the last modified timestamp
   */
  getLastModified(): string {
    const result = this.queryOne<{ value: string }>(
      "SELECT value FROM metadata WHERE key = 'last_modified'"
    );
    return result?.value ?? new Date().toISOString();
  }

  /**
   * Get the current schema version
   */
  getSchemaVersion(): number {
    const result = this.queryOne<{ value: string }>(
      "SELECT value FROM metadata WHERE key = 'schema_version'"
    );
    return parseInt(result?.value ?? "1", 10);
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }

  /**
   * Check if database file exists (for migration detection)
   */
  static databaseExists(): boolean {
    return existsSync(DB_PATH);
  }

  /**
   * Get paths for reference
   */
  static getPaths() {
    return { DATA_DIR, DB_PATH, SCHEMA_PATH };
  }
}

// Singleton instance
export const db = new DatabaseConnection();

// Export class for type access and static methods
export { DatabaseConnection };
