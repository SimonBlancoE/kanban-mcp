# Claude Kanban MCP

[![npm version](https://badge.fury.io/js/@simonblanco%2Fkanban-mcp.svg)](https://www.npmjs.com/package/@simonblanco/kanban-mcp)

An MCP (Model Context Protocol) server providing a Kanban board for AI agent coordination, with a real-time web viewer for human supervision.

## Features

- **MCP Server**: 14 tools for task management
- **3 Roles**: Architect (full control), Agent (own tasks), QA (review & approve)
- **4 Columns**: Backlog, In Progress, Blocked, Done
- **Priorities**: Critical, High, Medium, Low
- **Dependencies**: Task relationships with circular dependency detection
- **QA Workflow**: Tasks require QA approval before completion
- **Health Check**: Detect stale tasks, bottlenecks, and issues
- **Web Viewer**: Real-time updates via WebSocket
- **Persistence**: Automatic JSON file storage

---

## Installation

### Requirements
- [Bun](https://bun.sh) v1.0+

### Option 1: Via npm/npx (Recommended)

```bash
# Add to Claude Code directly
claude mcp add kanban -- bunx @simonblanco/kanban-mcp

# Or run manually
bunx @simonblanco/kanban-mcp
```

### Option 2: Global Installation

```bash
# Install globally
bun add -g @simonblanco/kanban-mcp

# Run
kanban-mcp
```

### Option 3: From Source

```bash
# Clone the repository
git clone https://github.com/SimonBlancoE/kanban-mcp
cd kanban-mcp

# Install dependencies
bun install

# Start the server
bun run src/index.ts
```

Web viewer available at: **http://localhost:3456**

---

## Configure in Claude Code

### Automatic Method (Recommended)

```bash
claude mcp add kanban -- bunx @simonblanco/kanban-mcp
```

### Manual Method

Add to your MCP configuration file (`~/.config/claude/settings.json`):

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

**Alternative (from source):**

```json
{
  "mcpServers": {
    "kanban": {
      "command": "bun",
      "args": ["run", "/full/path/to/project/src/index.ts"]
    }
  }
}
```

---

## Onboarding Existing Projects

To incorporate the Kanban into a project already in development:

### Step 1: Analysis Session with Architect

Start a session with the Architect to analyze the project and create the initial backlog:

```
You are the Architect for this project. Your first task is to analyze the current
state and create the initial backlog in the Kanban.

Review:
1. Existing code (structure, what's implemented)
2. Pending issues/TODOs in the code
3. README or existing documentation
4. Any planning files that exist

Then use the kanban_* tools to:
- Create tasks for pending work (in backlog)
- Create tasks for known bugs (in backlog, with clear description)
- If there's work "in progress", create it in in_progress
- If there are known blockers, document them in blocked

Use generic agent IDs for now: agent-alpha, agent-beta, agent-gamma.
Don't assign tasks yet, just create the backlog.
```

### Step 2: Review and Assignment

Once the Architect has created the backlog:

1. **Review the board** at http://localhost:3456
2. **Adjust priorities** if needed (Architect can set priorities)
3. **Assign tasks** to available agents

### Step 3: Working with Agents

**Option A - One agent at a time:**
```
[Include Agent instructions in system prompt]

Your ID is "agent-alpha".
Check the Kanban to see what tasks are assigned to you.
Take the first one from backlog, move it to in_progress, and work on it.
```

**Option B - Multiple agents in parallel:**
Each agent in its own session with a unique ID. The Architect distributes tasks and each agent works independently.

### Continuous Flow

```
┌─────────────────────────────────────────────────────────────┐
│                        ARCHITECT                            │
│  - Analyzes the project                                     │
│  - Creates tasks in backlog with priorities                 │
│  - Sets up task dependencies                                │
│  - Assigns to available agents                              │
│  - Monitors progress and resolves blockers                  │
│  - Runs health checks to detect issues                      │
└──────────────────────────┬──────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
     ┌──────────┐    ┌──────────┐    ┌──────────┐
     │ Agent α  │    │ Agent β  │    │ Agent γ  │
     │ backlog→ │    │ backlog→ │    │ backlog→ │
     │ progress→│    │ progress→│    │ progress→│
     │ done→QA  │    │ blocked  │    │ done→QA  │
     └──────────┘    └──────────┘    └──────────┘
           │                               │
           └───────────────┬───────────────┘
                           ▼
                    ┌──────────┐
                    │    QA    │
                    │ Reviews  │
                    │ Approves │
                    │ or Rejects│
                    └──────────┘

              ┌──────────────────────────┐
              │     SUPERVISOR (You)     │
              │  http://localhost:3456   │
              │   Observes board state   │
              └──────────────────────────┘
```

---

## MCP Tools

### Task Management

| Tool | Architect | Agent | QA | Description |
|------|:---------:|:-----:|:--:|-------------|
| `kanban_list_tasks` | all | own only | - | List tasks |
| `kanban_get_task` | all | own only | - | Get task details |
| `kanban_create_task` | ✅ | - | - | Create new task |
| `kanban_update_task` | all | own only | - | Edit title/description/priority |
| `kanban_assign_task` | ✅ | - | - | Assign/reassign task |
| `kanban_move_task` | all | own only | - | Move between columns |
| `kanban_delete_task` | ✅ | - | - | Delete task |

### Dependencies

| Tool | Architect | Agent | QA | Description |
|------|:---------:|:-----:|:--:|-------------|
| `kanban_add_dependency` | ✅ | - | - | Add dependency between tasks |
| `kanban_remove_dependency` | ✅ | - | - | Remove dependency |

### Statistics & Health

| Tool | Architect | Agent | QA | Description |
|------|:---------:|:-----:|:--:|-------------|
| `kanban_get_stats` | ✅ | ✅ | ✅ | Board statistics with priority breakdown |
| `kanban_health_check` | ✅ | ✅ | ✅ | Detect issues (stale tasks, bottlenecks) |

### QA Workflow

| Tool | Architect | Agent | QA | Description |
|------|:---------:|:-----:|:--:|-------------|
| `kanban_qa_list` | - | - | ✅ | List tasks pending QA review |
| `kanban_qa_approve` | - | - | ✅ | Approve task completion |
| `kanban_qa_reject` | - | - | ✅ | Reject with feedback |

---

## System Prompt Instructions

### For the ARCHITECT (Agent Supervisor)

Copy this to the system prompt for the agent acting as Architect:

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

### Available Tools

**Task Management:**
- `kanban_create_task`: Create new task
  - Parameters: `role: "architect"`, `title`, `description?`, `priority?`, `assignee?`, `column?`, `dependsOn?`
  - The `assignee` must be the agent ID (e.g., "agent-alpha", "agent-beta")
  - The `dependsOn` is an array of task UUIDs this task depends on

- `kanban_update_task`: Edit title, description, or priority
  - Parameters: `role: "architect"`, `taskId`, `title?`, `description?`, `priority?`

- `kanban_assign_task`: Assign task to an agent
  - Parameters: `role: "architect"`, `taskId`, `assignee` (or `null` to unassign)

- `kanban_move_task`: Change task column
  - Parameters: `role: "architect"`, `taskId`, `column`
  - Note: Architect can move directly to done (bypasses QA)

- `kanban_delete_task`: Delete a task
  - Parameters: `role: "architect"`, `taskId`

**Dependencies:**
- `kanban_add_dependency`: Create dependency between tasks
  - Parameters: `role: "architect"`, `taskId`, `dependsOnTaskId`
  - Task A depends on Task B = A cannot start until B is done

- `kanban_remove_dependency`: Remove a dependency
  - Parameters: `role: "architect"`, `taskId`, `dependsOnTaskId`

**Queries:**
- `kanban_list_tasks`: View all tasks
  - Parameters: `role: "architect"`, `column?` (optional filter)

- `kanban_get_task`: View task details
  - Parameters: `role: "architect"`, `taskId`

- `kanban_get_stats`: View board statistics
  - Parameters: `role: "architect"`, `backlogThreshold?` (default: 3)
  - Returns: counts per column, pendingQa, needsRefill flag, byPriority breakdown

- `kanban_health_check`: Analyze board health
  - Parameters: `role: "architect"`, `staleThresholdHours?` (default: 24)
  - Detects: stale tasks, unassigned blocked, low backlog, overloaded agents, QA backlog

### Recommended Workflow

1. At start, run `kanban_get_stats` to see overall state
2. Run `kanban_health_check` to detect any issues
3. Use `kanban_list_tasks` to see pending or blocked tasks
4. Create tasks in `backlog` with appropriate priority
5. Set up dependencies between related tasks
6. Assign tasks to available agents
7. Monitor progress and resolve blockers as needed

### Agent ID Convention
Use consistent IDs for agents: "agent-alpha", "agent-beta", "agent-gamma", etc.
```

---

### For AGENTS (Workers)

Copy this to the system prompt for each worker agent:

```markdown
## Kanban Board - Agent Instructions

You have access to a shared Kanban board where you receive and report on tasks.
Your role is **agent** with ID: `[REPLACE_WITH_AGENT_ID]`

### Board Columns
- `backlog`: Assigned tasks pending start
- `in_progress`: Tasks you're actively working on
- `blocked`: Tasks you cannot continue (indicate the reason)
- `done`: Tasks you've completed (will go to QA review)

### Priority Levels (set by Architect)
- `critical`: Do these first!
- `high`: Important, prioritize
- `medium`: Normal priority
- `low`: Can wait

### Available Tools

**View your tasks:**
- `kanban_list_tasks`: View tasks assigned to you
  - Parameters: `role: "agent"`, `agentId: "[YOUR_ID]"`, `column?`

- `kanban_get_task`: View details of your task
  - Parameters: `role: "agent"`, `agentId: "[YOUR_ID]"`, `taskId`

**Update your tasks:**
- `kanban_move_task`: Change task status
  - Parameters: `role: "agent"`, `agentId: "[YOUR_ID]"`, `taskId`, `column`
  - Use this to indicate progress: backlog → in_progress → done
  - If blocked: move to `blocked`
  - **Note**: Moving to `done` sends task to QA review

- `kanban_update_task`: Update description (for progress notes)
  - Parameters: `role: "agent"`, `agentId: "[YOUR_ID]"`, `taskId`, `description?`, `priority?`

**Statistics:**
- `kanban_get_stats`: View board summary
  - Parameters: `role: "agent"`

### Workflow

1. **At start**: Run `kanban_list_tasks` with `column: "backlog"` to see pending tasks
2. **Prioritize**: Look at task priorities - do `critical` and `high` first
3. **Check dependencies**: Read task description for any dependencies
4. **Start work**: Move task to `in_progress`
5. **During work**: Update description with progress notes if useful
6. **If blocked**: Move to `blocked` and update description explaining the problem
7. **When done**: Move to `done` - task will be sent to QA for review
8. **If QA rejects**: Task returns to `in_progress` with feedback - address the issues

### Important
- You can only view and modify tasks assigned to you
- You cannot create, delete, or reassign tasks (only the Architect can)
- Always include your `agentId` in every call
- When you move to `done`, QA will review before final completion
- Check `qaFeedback` field if a task was previously rejected
```

**Note**: Replace `[YOUR_ID]` or `[REPLACE_WITH_AGENT_ID]` with the actual agent ID (e.g., `agent-alpha`).

---

### For QA (Quality Assurance)

Copy this to the system prompt for the QA agent:

```markdown
## Kanban Board - QA Instructions

You have access to a shared Kanban board where you review completed work.
Your role is **qa** - you review tasks that agents have marked as done.

### Your Responsibilities
- Review tasks that agents have completed
- Verify the implementation meets requirements
- Approve tasks that pass review
- Reject tasks that need more work (with constructive feedback)

### Available Tools

**View pending reviews:**
- `kanban_qa_list`: List all tasks pending QA review
  - Parameters: `role: "qa"`
  - Returns: tasks with pendingQa: true

**Review actions:**
- `kanban_qa_approve`: Approve a task after review
  - Parameters: `role: "qa"`, `taskId`, `notes?`
  - Task is marked as truly done

- `kanban_qa_reject`: Reject a task with feedback
  - Parameters: `role: "qa"`, `taskId`, `feedback` (required, min 10 chars), `targetColumn?`
  - Task returns to `in_progress` (default) or `blocked`
  - Feedback is stored in `qaFeedback` field for the agent to see

**Statistics:**
- `kanban_get_stats`: View board summary including pendingQa count
  - Parameters: `role: "qa"`

### Workflow

1. **Check queue**: Run `kanban_qa_list` to see tasks awaiting review
2. **Review each task**:
   - Read the task title and description
   - Understand what was supposed to be done
   - Verify the implementation (check code, test results, etc.)
3. **Decision**:
   - If satisfactory: `kanban_qa_approve` with optional notes
   - If needs work: `kanban_qa_reject` with detailed feedback
4. **Feedback quality**: When rejecting, be specific about:
   - What's missing or incorrect
   - What needs to be fixed
   - How to verify the fix

### Important
- You can only review tasks, not create/assign/delete
- Always provide constructive feedback when rejecting
- The agent will see your feedback in the `qaFeedback` field
```

---

## Project Structure

```
claude-kanban-mcp/
├── package.json
├── tsconfig.json
├── README.md
├── data/
│   └── kanban.json           # Persisted data (auto-generated)
├── src/
│   ├── index.ts              # Entry point
│   ├── types.ts              # TypeScript interfaces + Zod schemas
│   ├── store.ts              # Persistence layer
│   ├── mcp/
│   │   ├── server.ts         # MCP configuration
│   │   └── tools.ts          # Tool definitions
│   └── web/
│       ├── server.ts         # HTTP + WebSocket server
│       └── broadcast.ts      # WebSocket broadcasting
└── public/
    ├── index.html            # Kanban viewer
    ├── styles.css            # Styles
    └── app.js                # WebSocket client
```

---

## REST API (Optional)

The web viewer exposes REST endpoints for debugging:

- `GET /api/board` - Complete board state
- `GET /api/stats` - Statistics

---

## Configuration

### Custom Port

```bash
PORT=8080 bun run src/index.ts
```

### Data Location

Data is saved in `./data/kanban.json` relative to the module directory.

---

## Web Viewer

The viewer is **passive** (read-only):
- Shows 4 columns with differentiated colors
- Automatic updates via WebSocket
- Statistics in header
- Task description visible on hover
- Priority badges (color-coded)
- Dependency indicators
- QA status badges (pending/approved/rejected)

Column Colors:
- **Backlog**: Gray
- **In Progress**: Blue
- **Blocked**: Red
- **Done**: Green

Priority Colors:
- **Critical**: Red (pulsing)
- **High**: Orange
- **Medium**: Yellow
- **Low**: Blue

---

## Usage Examples

### Architect creates tasks with priority and dependencies:

```json
// Create high-priority task
{
  "role": "architect",
  "title": "Implement OAuth authentication",
  "description": "Add login with Google and GitHub",
  "priority": "high",
  "assignee": "agent-alpha",
  "column": "backlog"
}

// Create task with dependency
{
  "role": "architect",
  "title": "Add user profile page",
  "description": "Display user info after login",
  "priority": "medium",
  "dependsOn": ["uuid-of-oauth-task"],
  "column": "backlog"
}

// Add dependency between existing tasks
{
  "role": "architect",
  "taskId": "uuid-of-profile-task",
  "dependsOnTaskId": "uuid-of-oauth-task"
}
```

### Agent works on tasks:

```json
// View my pending tasks
{
  "role": "agent",
  "agentId": "agent-alpha",
  "column": "backlog"
}

// Start working
{
  "role": "agent",
  "agentId": "agent-alpha",
  "taskId": "uuid-of-task",
  "column": "in_progress"
}

// Mark as complete (goes to QA)
{
  "role": "agent",
  "agentId": "agent-alpha",
  "taskId": "uuid-of-task",
  "column": "done"
}
```

### QA reviews and approves/rejects:

```json
// List pending reviews
{
  "role": "qa"
}

// Approve task
{
  "role": "qa",
  "taskId": "uuid-of-task",
  "notes": "Looks good, tests pass"
}

// Reject task with feedback
{
  "role": "qa",
  "taskId": "uuid-of-task",
  "feedback": "Missing error handling for invalid OAuth tokens. Please add try-catch and user-friendly error messages.",
  "targetColumn": "in_progress"
}
```

---

## License

MIT
