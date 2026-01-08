# Claude Kanban MCP

[![npm version](https://img.shields.io/npm/v/@simonblanco/kanban-mcp)](https://www.npmjs.com/package/@simonblanco/kanban-mcp)

**Turn Claude into a self-organizing dev team.** One command spawns an architect, agents, and QA - they plan, build, review, and learn from mistakes. Automatically.

```
/kanban-sprint "implement user auth"
```

That's it. Watch your feature get built.

---

## Why This Exists

AI agents are powerful but chaotic. They forget context, repeat mistakes, and have no structure. This MCP gives them:

- **Memory** - 3-tier learning system that remembers what worked and what didn't
- **Structure** - Kanban workflow with roles, sprints, and QA gates
- **Accountability** - Iteration tracking with max attempts before escalation
- **Coordination** - Multiple agents work in parallel without stepping on each other

The result? Claude stops being a chatbot and starts being a **team**.

---

## 60-Second Setup

```bash
# Install
claude mcp add kanban -- bunx @simonblanco/kanban-mcp

# Add workflow skills (optional but recommended)
git clone https://github.com/SimonBlancoE/kanban-mcp ~/.claude/kanban-mcp
ln -s ~/.claude/kanban-mcp/.claude/skills/kanban-* ~/.claude/skills/
```

Open http://localhost:3456 to watch your agents work in real-time.

---

## What You Get

### Autonomous Dev Cycles

```
/kanban-sprint "add dark mode"
```

The system automatically:
1. **Architect** breaks it into tasks with acceptance criteria
2. **Agents** claim tasks and iterate until criteria are met
3. **QA** reviews with structured feedback (not just "looks good")
4. **Learning** captures patterns so mistakes don't repeat

### Import Issues, Assign Automatically

Got a backlog in Forgejo or GitHub? Import it directly:

```yaml
kanban_import_issues:
  repo: "myorg/myproject"
  issues: [... from your git forge MCP ...]
  autoAssign: true  # Matches issue labels to agent skills
```

The architect analyzes each issue, matches it to the best agent based on skills, and creates a sprint. When tasks complete, sync the solution back and close the issue.

### Agents That Learn

Every rejection teaches something:

```
Tier 1: Task Memory    → "This specific task needed X"
Tier 2: Agent Memory   → "This agent struggles with testing"
Tier 3: Project Memory → "Always validate at API boundaries"
```

New agents inherit project lessons. Your codebase conventions get documented automatically.

### Real-Time Dashboard

![Kanban Board](https://localhost:3456)

- Live WebSocket updates as agents work
- Click any task for full iteration history
- Activity feed shows exactly what's happening
- Escalation warnings when tasks exceed iteration limits

---

## The Roles

| Role | Does What |
|------|-----------|
| **Architect** | Plans sprints, defines acceptance criteria, assigns agents, resolves blockers |
| **Agent** | Claims tasks, iterates until done, submits work for QA |
| **QA** | Reviews with structured feedback (category, severity, suggestions) |

Agents can't see each other's tasks. Architects see everything. QA only sees work pending review.

---

## Key Features

| Feature | What It Solves |
|---------|----------------|
| **Acceptance Criteria** | No more "is this done?" - clear success conditions |
| **Max Iterations** | Prevents infinite loops - escalates stuck tasks |
| **Structured QA Feedback** | Not "rejected" but "logic error, high severity, try X" |
| **Capability Matching** | Register agent skills, auto-assign by issue labels |
| **Issue Sync** | Import from Forgejo/GitHub, close when done |
| **Session Continuity** | Agents resume where they left off across context windows |
| **Health Checks** | Detect stale tasks, bottlenecks, overloaded agents |

---

## Workflow Commands

| Command | What Happens |
|---------|--------------|
| `/kanban-sprint "feature"` | Full autonomous dev cycle |
| `/kanban-architect` | Manual planning and oversight |
| `/kanban-agent` | Work on assigned tasks |
| `/kanban-qa` | Review pending work |
| `/kanban-review-loop` | Background health monitoring |

---

## 36 MCP Tools

Full API for task management, sprints, iterations, learning, agent capabilities, and issue sync:

**Tasks**: create, update, move, delete, assign, set criteria
**Sprints**: create, track, iterate, complete
**Iterations**: start, submit, get context, log activity
**QA**: list pending, approve, reject with feedback
**Learning**: get insights, add lessons, add conventions
**Agents**: register skills, list capabilities, match to tasks
**Issues**: import from forge, sync status, mark complete
**Health**: stats, health check, escalations, session management

---

## Installation Options

**Via Claude Code (recommended):**
```bash
claude mcp add kanban -- bunx @simonblanco/kanban-mcp
```

**Global install:**
```bash
bun add -g @simonblanco/kanban-mcp
kanban-mcp
```

**From source:**
```bash
git clone https://github.com/SimonBlancoE/kanban-mcp
cd kanban-mcp && bun install && bun run src/index.ts
```

**Manual config** (`~/.config/claude/settings.json`):
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

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SPRINT LIFECYCLE                         │
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ PLANNING │───►│ EXECUTING│───►│ REVIEWING│              │
│  │          │    │          │    │          │              │
│  │ Architect│    │  Agents  │    │    QA    │              │
│  │ defines  │    │ iterate  │    │ feedback │              │
│  │ criteria │    │ until    │    │ or       │              │
│  └──────────┘    │ done     │    │ approve  │              │
│                  └────┬─────┘    └────┬─────┘              │
│                       │               │                     │
│                       └───────────────┘                     │
│                         Loop until                          │
│                         approved or                         │
│                         maxIterations                       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    3-TIER LEARNING                          │
│                                                             │
│  Task Memory ──► Agent Memory ──► Project Memory            │
│  (what worked)   (patterns)       (conventions)             │
│                                                             │
│  Mistakes bubble up. Lessons flow down to new agents.       │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Storage

SQLite database at `./data/kanban.db` with automatic migrations. Your board survives restarts and upgrades cleanly.

| Table | Purpose |
|-------|---------|
| `tasks` | All tasks with iteration history |
| `sprints` | Sprint goals and progress |
| `sessions` | Agent session continuity |
| `learning_*` | Agent patterns and project lessons |
| `agent_capabilities` | Registered skills for matching |
| `issue_imports` | External issue tracking |

---

## License

MIT

---

**Built for Claude Code.** Stop prompting. Start shipping.
