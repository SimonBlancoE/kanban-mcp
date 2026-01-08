-- Migration 002: Add agent capabilities and issue imports tables
-- Run this to upgrade from schema version 1 to 2

-- ═══════════════════════════════════════════════════════════════════════════
-- AGENT CAPABILITIES TABLE
-- Stores agent skills for capability-based task assignment
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS agent_capabilities (
  agent_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,

  -- Generated columns for efficient queries
  is_active INTEGER GENERATED ALWAYS AS (COALESCE(json_extract(data, '$.isActive'), 1)) STORED,
  max_concurrent INTEGER GENERATED ALWAYS AS (COALESCE(json_extract(data, '$.maxConcurrentTasks'), 3)) STORED,
  created_at TEXT GENERATED ALWAYS AS (json_extract(data, '$.createdAt')) STORED,
  updated_at TEXT GENERATED ALWAYS AS (json_extract(data, '$.updatedAt')) STORED
);

CREATE INDEX IF NOT EXISTS idx_agent_caps_active ON agent_capabilities(is_active);
CREATE INDEX IF NOT EXISTS idx_agent_caps_updated ON agent_capabilities(updated_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- ISSUE IMPORTS TABLE
-- Tracks imported issues to prevent duplicates and enable sync
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS issue_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'forgejo',
  repo TEXT NOT NULL,
  issue_id INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  sprint_id TEXT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT,

  UNIQUE(provider, repo, issue_id)
);

CREATE INDEX IF NOT EXISTS idx_issue_imports_repo ON issue_imports(repo);
CREATE INDEX IF NOT EXISTS idx_issue_imports_task ON issue_imports(task_id);
CREATE INDEX IF NOT EXISTS idx_issue_imports_sprint ON issue_imports(sprint_id);

-- Update schema version
UPDATE metadata SET value = '2' WHERE key = 'schema_version';
