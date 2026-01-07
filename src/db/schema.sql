-- ═══════════════════════════════════════════════════════════════════════════
-- Claude Kanban MCP - SQLite Schema
-- Hybrid approach: JSON storage with generated index columns for queries
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- TASKS TABLE
-- Stores complete Task JSON with generated columns for efficient queries
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,  -- Full Task JSON (preserves existing structure)

  -- Generated columns for efficient queries (extracted from JSON)
  column_status TEXT GENERATED ALWAYS AS (json_extract(data, '$.column')) STORED,
  assignee TEXT GENERATED ALWAYS AS (json_extract(data, '$.assignee')) STORED,
  priority TEXT GENERATED ALWAYS AS (json_extract(data, '$.priority')) STORED,
  sprint_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.sprintId')) STORED,
  pending_qa INTEGER GENERATED ALWAYS AS (json_extract(data, '$.pendingQa')) STORED,
  iteration INTEGER GENERATED ALWAYS AS (json_extract(data, '$.iteration')) STORED,
  max_iterations INTEGER GENERATED ALWAYS AS (COALESCE(json_extract(data, '$.maxIterations'), 3)) STORED,
  feature_status TEXT GENERATED ALWAYS AS (json_extract(data, '$.featureStatus')) STORED,
  created_at TEXT GENERATED ALWAYS AS (json_extract(data, '$.createdAt')) STORED,
  updated_at TEXT GENERATED ALWAYS AS (json_extract(data, '$.updatedAt')) STORED
);

-- Indexes for common task queries
CREATE INDEX IF NOT EXISTS idx_tasks_column ON tasks(column_status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
CREATE INDEX IF NOT EXISTS idx_tasks_sprint ON tasks(sprint_id);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_pending_qa ON tasks(pending_qa);
CREATE INDEX IF NOT EXISTS idx_tasks_iteration ON tasks(iteration);
CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- SPRINTS TABLE
-- Stores complete Sprint JSON with generated columns for efficient queries
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sprints (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,  -- Full Sprint JSON

  -- Generated columns for efficient queries
  status TEXT GENERATED ALWAYS AS (json_extract(data, '$.status')) STORED,
  goal TEXT GENERATED ALWAYS AS (json_extract(data, '$.goal')) STORED,
  current_iteration INTEGER GENERATED ALWAYS AS (json_extract(data, '$.currentIteration')) STORED,
  max_iterations INTEGER GENERATED ALWAYS AS (COALESCE(json_extract(data, '$.maxIterations'), 5)) STORED,
  created_at TEXT GENERATED ALWAYS AS (json_extract(data, '$.createdAt')) STORED,
  updated_at TEXT GENERATED ALWAYS AS (json_extract(data, '$.updatedAt')) STORED
);

-- Indexes for sprint queries
CREATE INDEX IF NOT EXISTS idx_sprints_status ON sprints(status);
CREATE INDEX IF NOT EXISTS idx_sprints_updated ON sprints(updated_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- SESSIONS TABLE
-- Context bridge for cross-context-window continuity
-- This table is NOT JSON-based - it's purely relational for session tracking
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'abandoned')),

  -- Session context
  context_summary TEXT,           -- What agent was working on
  session_notes TEXT,             -- End-of-session notes
  pending_items TEXT DEFAULT '[]', -- JSON array: What's left to do
  known_issues TEXT DEFAULT '[]', -- JSON array: Problems discovered
  clean_state INTEGER DEFAULT 0,  -- Boolean: Did agent leave clean state?

  -- Git integration
  git_commit_hash TEXT,           -- Auto-commit SHA if created

  -- Task tracking
  tasks_touched TEXT DEFAULT '[]' -- JSON array: Task IDs worked on
);

-- Indexes for session queries
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- LEARNING: AGENT PROFILES TABLE
-- Stores AgentLearningProfile as JSON with generated columns
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS learning_agents (
  agent_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,  -- Full AgentLearningProfile JSON

  -- Generated columns for efficient queries
  tasks_completed INTEGER GENERATED ALWAYS AS (COALESCE(json_extract(data, '$.tasksCompleted'), 0)) STORED,
  total_iterations INTEGER GENERATED ALWAYS AS (COALESCE(json_extract(data, '$.totalIterations'), 0)) STORED,
  last_updated TEXT GENERATED ALWAYS AS (json_extract(data, '$.lastUpdated')) STORED
);

-- Index for learning queries
CREATE INDEX IF NOT EXISTS idx_learning_agents_updated ON learning_agents(last_updated);

-- ═══════════════════════════════════════════════════════════════════════════
-- LEARNING: PROJECT LESSONS & CONVENTIONS TABLE
-- Stores project-level learning as individual rows
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS learning_project (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('lesson', 'convention')),
  data TEXT NOT NULL,  -- Full lesson/convention JSON

  -- Generated columns for efficient queries
  category TEXT GENERATED ALWAYS AS (json_extract(data, '$.category')) STORED,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for learning queries
CREATE INDEX IF NOT EXISTS idx_learning_project_type ON learning_project(type);
CREATE INDEX IF NOT EXISTS idx_learning_project_category ON learning_project(category);

-- ═══════════════════════════════════════════════════════════════════════════
-- ACTIVITY LOG TABLE
-- Real-time agent activity feed for WebSocket broadcasting
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  agent_id TEXT,
  action TEXT NOT NULL,
  task_id TEXT,
  task_title TEXT,
  details TEXT,
  activity_type TEXT CHECK(activity_type IN ('started', 'reading', 'editing', 'testing', 'submitting', 'addressing_feedback', 'session_start', 'session_end', 'qa_review', 'task_created', 'task_updated', 'sprint_updated'))
);

-- Indexes for activity queries
CREATE INDEX IF NOT EXISTS idx_activity_agent ON activity_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_activity_task ON activity_log(task_id);
CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_log(activity_type);

-- ═══════════════════════════════════════════════════════════════════════════
-- METADATA TABLE
-- Stores board-level metadata (replaces lastModified from JSON)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Insert initial metadata
INSERT OR IGNORE INTO metadata (key, value) VALUES ('schema_version', '1');
INSERT OR IGNORE INTO metadata (key, value) VALUES ('last_modified', datetime('now'));
