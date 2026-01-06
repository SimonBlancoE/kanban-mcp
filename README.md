# Claude Kanban MCP

[![npm version](https://badge.fury.io/js/@simonblanco%2Fkanban-mcp.svg)](https://www.npmjs.com/package/@simonblanco/kanban-mcp)

A Kanban board MCP server for AI agent coordination, with real-time web viewer for human supervision.

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
ln -s $(pwd)/kanban-mcp/.claude/skills/Kanban ~/.claude/skills/Kanban
```

### Step 3: Start Working

```
/kanban-architect                    # Plan and assign tasks
/kanban-sprint "implement feature"   # Full automated dev cycle
```

### Workflow Overview

```
┌──────────────────────────────────────────────────────────────┐
│                      ARCHITECT                                │
│  /kanban-architect                                            │
│  Plans → Prioritizes → Assigns → Monitors                     │
└──────────────────────────┬───────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
     ┌──────────┐    ┌──────────┐    ┌──────────┐
     │ Agent α  │    │ Agent β  │    │ Agent γ  │
     │ Executes │    │ Executes │    │ Executes │
     │ Tasks    │    │ Tasks    │    │ Tasks    │
     └────┬─────┘    └────┬─────┘    └────┬─────┘
          └───────────────┼───────────────┘
                          ▼
                   ┌──────────┐
                   │    QA    │
                   │ Reviews  │
                   │ Approves │
                   └──────────┘
                          │
         ┌────────────────┴────────────────┐
         ▼                                 ▼
    [Approved]                      [Rejected]
       Done                    Back to Agent + Feedback
```

**Watch progress:** Open http://localhost:3456 for real-time board visualization.

---

## Features

| Feature | Description |
|---------|-------------|
| **3 Roles** | Architect (full control), Agent (own tasks), QA (review) |
| **4 Columns** | Backlog, In Progress, Blocked, Done |
| **4 Priorities** | Critical, High, Medium, Low |
| **Dependencies** | Task relationships with circular detection |
| **QA Workflow** | Tasks require approval before completion |
| **Health Check** | Detect stale tasks, bottlenecks, overloaded agents |
| **Web Viewer** | Real-time updates via WebSocket |
| **14 MCP Tools** | Full task management API |

---

## Workflow Commands

| Command | Description |
|---------|-------------|
| `/kanban-architect` | Plan work, assign tasks, monitor progress |
| `/kanban-agent <id>` | Execute assigned tasks (e.g., `agent-alpha`) |
| `/kanban-qa` | Review completed work, approve or reject |
| `/kanban-sprint [task]` | Full dev cycle with auto-spawned agents |
| `/kanban-review-loop` | Background health monitoring daemon |

### Sprint (Automated Dev Cycle)

```
/kanban-sprint "implement user authentication"
```

Automatically spawns Architect → parallel Agents → QA, loops until all tasks approved.

### Review Loop (Continuous Monitoring)

```
/kanban-review-loop
```

Background daemon: checks health every 5 minutes, auto-spawns QA if backlog grows, alerts on issues.

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

## MCP Tools Reference

### Task Management

| Tool | Architect | Agent | QA |
|------|:---------:|:-----:|:--:|
| `kanban_list_tasks` | all | own | - |
| `kanban_get_task` | all | own | - |
| `kanban_create_task` | ✓ | - | - |
| `kanban_update_task` | all | own | - |
| `kanban_assign_task` | ✓ | - | - |
| `kanban_move_task` | all | own | - |
| `kanban_delete_task` | ✓ | - | - |

### Dependencies & Health

| Tool | Description |
|------|-------------|
| `kanban_add_dependency` | Create task dependency (Architect) |
| `kanban_remove_dependency` | Remove dependency (Architect) |
| `kanban_get_stats` | Board statistics (all roles) |
| `kanban_health_check` | Detect issues (all roles) |

### QA Workflow

| Tool | Description |
|------|-------------|
| `kanban_qa_list` | List tasks pending review |
| `kanban_qa_approve` | Approve with optional notes |
| `kanban_qa_reject` | Reject with feedback (min 10 chars) |

---

## System Prompts

<details>
<summary><strong>Architect Prompt</strong> (click to expand)</summary>

```markdown
## Kanban Board Management

You have access to a shared Kanban board for coordinating work across multiple agents.
Your role is **architect** - you have full control over the board.

### Available Columns
- `backlog`: Tasks pending start
- `in_progress`: Tasks in active development
- `blocked`: Tasks blocked by dependencies or issues
- `done`: Completed tasks (pending or approved by QA)

### Priority Levels
- `critical`: Urgent, needs immediate attention
- `high`: Important, should be done soon
- `medium`: Normal priority (default)
- `low`: Can wait, nice to have

### Workflow
1. Run `kanban_get_stats` to see overall state
2. Run `kanban_health_check` to detect any issues
3. Create tasks in `backlog` with appropriate priority
4. Set up dependencies between related tasks
5. Assign tasks to agents (agent-alpha, agent-beta, agent-gamma)
6. Monitor progress and resolve blockers

All tools require `role: "architect"` parameter.
```
</details>

<details>
<summary><strong>Agent Prompt</strong> (click to expand)</summary>

```markdown
## Kanban Board - Agent Instructions

You have access to a shared Kanban board where you receive and report on tasks.
Your role is **agent** with ID: `[REPLACE_WITH_AGENT_ID]`

### Workflow
1. Run `kanban_list_tasks` to see your assigned tasks
2. Prioritize: critical > high > medium > low
3. Move task to `in_progress` when starting
4. Move to `done` when complete (goes to QA review)
5. If QA rejects, check `qaFeedback` and fix

### Restrictions
- You can only view/modify tasks assigned to you
- Cannot create, delete, or reassign tasks
- All tools require `role: "agent"` and `agentId: "[YOUR_ID]"`
```
</details>

<details>
<summary><strong>QA Prompt</strong> (click to expand)</summary>

```markdown
## Kanban Board - QA Instructions

You have access to a shared Kanban board where you review completed work.
Your role is **qa** - you review tasks that agents have marked as done.

### Workflow
1. Run `kanban_qa_list` to see pending reviews
2. For each task: verify implementation meets requirements
3. Approve: `kanban_qa_approve` with optional notes
4. Reject: `kanban_qa_reject` with detailed feedback

### Rejection Guidelines
Be specific about what's missing, what needs fixing, and how to verify.
All tools require `role: "qa"` parameter.
```
</details>

---

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `PORT` | 3456 | Web viewer port |
| Data location | `./data/kanban.json` | Persistent storage |

```bash
PORT=8080 bun run src/index.ts
```

---

## Project Structure

```
claude-kanban-mcp/
├── .claude/skills/Kanban/     # Workflow skills
├── src/
│   ├── index.ts               # Entry point
│   ├── store.ts               # Persistence layer
│   ├── mcp/                   # MCP server & tools
│   └── web/                   # HTTP/WebSocket server
├── public/                    # Web viewer UI
└── data/kanban.json           # Board state (auto-generated)
```

---

## License

MIT
