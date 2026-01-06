# Claude Kanban MCP

[![npm version](https://badge.fury.io/js/@simonblanco%2Fkanban-mcp.svg)](https://www.npmjs.com/package/@simonblanco/kanban-mcp)

A Kanban board MCP server for AI agent coordination with **Ralph Wiggum iterative refinement**, real-time web viewer, and 3-tier learning system.

---

## Quick Start

```
1. INSTALL          2. CONFIGURE              3. USE
───────────         ──────────────            ─────────────────────────
                    claude mcp add kanban \
bun install    ──►  -- bunx @simonblanco/ ──► /kanban-sprint "feature"
                    kanban-mcp

                    Web viewer: http://localhost:3456
```

### Step 1: Install

```bash
claude mcp add kanban -- bunx @simonblanco/kanban-mcp
```

### Step 2: Install Skills (Optional)

```bash
# Clone and symlink skills for workflow commands
git clone https://github.com/SimonBlancoE/kanban-mcp
cd kanban-mcp/.claude/skills
for skill in kanban-*; do ln -s "$(pwd)/$skill" ~/.claude/skills/; done
```

### Step 3: Start Working

```
/kanban-architect                    # Plan and assign tasks
/kanban-sprint "implement feature"   # Full automated dev cycle with iteration
```

---

## Ralph Wiggum Pattern

This project implements the **Ralph Wiggum technique** - an iterative refinement pattern for AI agents:

```
┌─────────────────────────────────────────────────────────────────┐
│                    SPRINT (Ralph Wiggum Loop)                   │
│                                                                 │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐                 │
│   │ PLANNING │───►│ EXECUTING│───►│ REVIEWING│                 │
│   │          │    │          │    │          │                 │
│   │ Architect│    │  Agents  │    │    QA    │                 │
│   │ + Criteria│   │ + Iterate│    │ + Learn  │                 │
│   └──────────┘    └────┬─────┘    └────┬─────┘                 │
│                        │               │                        │
│                        │    ┌──────────┴──────────┐            │
│                        │    ▼                     ▼            │
│                        │ [Approved]          [Rejected]        │
│                        │    │              + Feedback          │
│                        │    ▼              + Category          │
│                        │  DONE             + Severity          │
│                        │                       │               │
│                        └───────────────────────┘               │
│                          Loop until approved                   │
│                          or maxIterations                      │
└─────────────────────────────────────────────────────────────────┘
```

**Key concepts:**
- **Acceptance Criteria**: Each task has clear success conditions
- **Iteration Tracking**: Agents start/submit iterations with work summaries
- **Structured Feedback**: QA provides categorized feedback (logic, testing, security, etc.)
- **Learning System**: Patterns from rejections become project-wide lessons
- **Max Iterations**: Tasks escalate if they exceed iteration limits

---

## Features

| Feature | Description |
|---------|-------------|
| **3 Roles** | Architect (full control), Agent (own tasks), QA (review) |
| **4 Columns** | Backlog, In Progress, Blocked, Done |
| **4 Priorities** | Critical, High, Medium, Low |
| **Dependencies** | Task relationships with circular detection |
| **QA Workflow** | Tasks require approval with structured feedback |
| **Sprints** | Goal-driven work packages with success criteria |
| **Iteration Tracking** | Ralph Wiggum pattern with max iterations |
| **3-Tier Learning** | Task → Agent → Project knowledge accumulation |
| **Health Check** | Detect stale tasks, bottlenecks, escalations |
| **Interactive Dashboard** | Click tasks for detail modal, live activity feed |
| **27 MCP Tools** | Full task, sprint, iteration, and learning API |

---

## Workflow Commands

| Command | Description |
|---------|-------------|
| `/kanban-architect` | Plan work, set acceptance criteria, create sprints |
| `/kanban-agent <id>` | Execute tasks with iteration pattern (e.g., `agent-alpha`) |
| `/kanban-qa` | Review work with categorized feedback |
| `/kanban-sprint [task]` | Full Ralph Wiggum dev cycle |
| `/kanban-review-loop` | Background monitoring with escalation alerts |

### Sprint (Automated Dev Cycle)

```
/kanban-sprint "implement user authentication"
```

Creates sprint with success criteria → Spawns Architect to plan tasks with acceptance criteria → Parallel Agents iterate until done → QA reviews with structured feedback → Loops until approved or maxIterations.

### Agent Iteration Workflow

```
1. kanban_start_iteration      # Begin work, track iteration number
2. [Do the work]               # Implement against acceptance criteria
3. kanban_submit_iteration     # Submit with work summary
4. [QA Reviews]                # Approve or reject with feedback
5. If rejected → Start new iteration with feedback context
```

---

## Installation Options

### Via Claude Code (Recommended)

```bash
claude mcp add kanban -- bunx @simonblanco/kanban-mcp
```

### Global Installation

```bash
bun add -g @simonblanco/kanban-mcp
kanban-mcp
```

### From Source

```bash
git clone https://github.com/SimonBlancoE/kanban-mcp
cd kanban-mcp && bun install
bun run src/index.ts
```

### Manual MCP Configuration

Add to `~/.config/claude/settings.json`:

```json
{
  "mcpServers": {
    "kanban": {
      "command": "bunx",
      "args": ["@simonblanco/kanban-mcp"]
    }
  }
}
```

---

## MCP Tools Reference (27 Tools)

### Task Management

| Tool | Architect | Agent | QA |
|------|:---------:|:-----:|:--:|
| `kanban_list_tasks` | all | own | - |
| `kanban_get_task` | all | own | - |
| `kanban_get_task_detail` | all | own | all |
| `kanban_create_task` | ✓ | - | - |
| `kanban_update_task` | all | own | - |
| `kanban_assign_task` | ✓ | - | - |
| `kanban_move_task` | all | own | - |
| `kanban_delete_task` | ✓ | - | - |
| `kanban_set_acceptance_criteria` | ✓ | - | - |

### Sprint Management

| Tool | Description |
|------|-------------|
| `kanban_sprint_create` | Create sprint with goal and success criteria |
| `kanban_sprint_get` | Get sprint details |
| `kanban_sprint_update_status` | Update status, record iteration notes |
| `kanban_sprint_list` | List all sprints |

### Iteration Tracking (Ralph Wiggum)

| Tool | Description |
|------|-------------|
| `kanban_start_iteration` | Start new iteration on task |
| `kanban_submit_iteration` | Submit work with summary and self-assessment |
| `kanban_get_task_context` | Get learning insights for agent |
| `kanban_log_activity` | Log significant actions |

### Dependencies & Health

| Tool | Description |
|------|-------------|
| `kanban_add_dependency` | Create task dependency (Architect) |
| `kanban_remove_dependency` | Remove dependency (Architect) |
| `kanban_get_stats` | Board statistics (all roles) |
| `kanban_health_check` | Detect issues (all roles) |
| `kanban_get_escalated_tasks` | Tasks exceeding max iterations |

### QA Workflow

| Tool | Description |
|------|-------------|
| `kanban_qa_list` | List tasks pending review |
| `kanban_qa_approve` | Approve with optional notes |
| `kanban_qa_reject` | Reject with category, severity, suggested approach |

### Learning System

| Tool | Description |
|------|-------------|
| `kanban_get_learning_insights` | Get project lessons and conventions |
| `kanban_add_lesson` | Record project-wide lesson |
| `kanban_add_convention` | Document codebase convention |

---

## Learning System

The 3-tier learning system accumulates knowledge from QA feedback:

```
┌─────────────────────────────────────────────────────────────┐
│                     LEARNING TIERS                          │
├─────────────────────────────────────────────────────────────┤
│  TIER 1: Task Memory                                        │
│  └─ Iteration history, feedback received, what worked       │
├─────────────────────────────────────────────────────────────┤
│  TIER 2: Agent Memory                                       │
│  └─ Mistake patterns, strengths, avg iterations per task    │
├─────────────────────────────────────────────────────────────┤
│  TIER 3: Project Memory                                     │
│  └─ Lessons and conventions (auto-promoted from patterns)   │
└─────────────────────────────────────────────────────────────┘
```

**Example flow:**
1. QA rejects task with `category: "testing"` feedback
2. Agent's mistake pattern "testing" counter increments
3. If pattern appears across multiple agents → promotes to project lesson
4. Future agents receive this lesson in their context

---

## Interactive Dashboard

Open http://localhost:3456 to view:

- **Kanban Board**: Real-time task columns with WebSocket updates
- **Task Detail Modal**: Click any task to see:
  - Acceptance criteria and verification steps
  - Iteration progress bar
  - Full iteration timeline (attempts, feedback, outcomes)
  - Learning insights from this task
- **Live Activity Feed**: Real-time stream of agent actions
- **Sprint Info Bar**: Current sprint progress and iteration count
- **Escalation Warnings**: Tasks exceeding max iterations

---

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `PORT` | 3456 | Web viewer port |
| Data location | `./data/kanban.json` | Task persistence |
| Learning data | `./data/learning.json` | Learning system storage |

```bash
PORT=8080 bun run src/index.ts
```

---

## Project Structure

```
claude-kanban-mcp/
├── .claude/skills/            # Workflow skills (Ralph Wiggum enabled)
│   ├── kanban-architect/      # Planning with acceptance criteria
│   ├── kanban-agent/          # Iteration pattern execution
│   ├── kanban-qa/             # Structured feedback reviews
│   ├── kanban-sprint/         # Full dev cycle orchestration
│   └── kanban-review-loop/    # Health monitoring daemon
├── src/
│   ├── index.ts               # Entry point
│   ├── store.ts               # Task & sprint persistence
│   ├── learning.ts            # 3-tier learning system
│   ├── types.ts               # Schemas with iteration tracking
│   ├── mcp/                   # MCP server & 27 tools
│   └── web/                   # HTTP/WebSocket server
├── public/                    # Interactive web dashboard
└── data/
    ├── kanban.json            # Board state
    └── learning.json          # Learning data
```

---

## License

MIT
