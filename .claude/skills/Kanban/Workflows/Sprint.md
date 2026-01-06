# Sprint Workflow - Full Development Cycle Orchestrator

You are running a **Sprint** - a full development cycle that orchestrates Architect, Agent, and QA roles automatically.

## Arguments

Optional: Task/feature description
- Example: `/kanban-sprint implement user authentication`
- If not provided, Architect will analyze codebase and plan independently

## Sprint Phases

```
Phase 1: PLANNING (Architect)
    ↓
Phase 2: EXECUTION (Parallel Agents)
    ↓
Phase 3: REVIEW (QA)
    ↓ (if rejections)
Phase 2: EXECUTION (fix rejected tasks)
    ↓
Phase 4: REPORT (Summary)
```

## Execution Instructions

### Phase 1: Planning

**Spawn an Architect agent to plan the work:**

Use the Task tool with these parameters:
```
subagent_type: "general-purpose"
description: "Architect planning sprint"
prompt: |
  You are the ARCHITECT for a Kanban-based development sprint.

  TASK: [Insert the user's task description here, or "Analyze codebase and create development tasks"]

  YOUR MISSION:
  1. Analyze the codebase to understand the current state
  2. Create tasks in the Kanban backlog using kanban_create_task
  3. Set appropriate priorities (critical, high, medium, low)
  4. Add dependencies between related tasks using kanban_add_dependency
  5. Assign tasks to agents: agent-alpha, agent-beta, agent-gamma

  TOOL USAGE:
  - Always use role: "architect" in all kanban tool calls
  - Create 3-8 tasks for a reasonable sprint
  - Distribute work evenly across agents

  When done, report:
  - Number of tasks created
  - Task assignments by agent
  - Any dependencies set up
```

Wait for the Architect to complete, then check board state:
```
kanban_get_stats with role: "architect"
kanban_list_tasks with role: "architect"
```

### Phase 2: Execution

**Spawn Agent sub-agents in parallel:**

Determine which agents have assigned tasks, then spawn them simultaneously using multiple Task tool calls in a single message:

```
subagent_type: "general-purpose"
description: "Agent-alpha executing tasks"
prompt: |
  You are AGENT-ALPHA working on the Kanban board.

  YOUR MISSION:
  1. List your assigned tasks: kanban_list_tasks with role: "agent", agentId: "agent-alpha"
  2. For each task in priority order (critical > high > medium > low):
     a. Move to in_progress
     b. Read the task description and implement the work
     c. Move to done when complete
  3. If blocked, move to blocked column with explanation

  TOOL USAGE:
  - Always use role: "agent", agentId: "agent-alpha"
  - Actually implement the code/work described in each task
  - Update task descriptions with progress notes

  When done, report tasks completed and any blockers.
```

Create similar prompts for agent-beta, agent-gamma as needed.

Wait for all agents to complete.

### Phase 3: Review

**Check for pending QA:**
```
kanban_get_stats with role: "architect"
```

If `pendingQa > 0`, spawn QA agent:

```
subagent_type: "general-purpose"
description: "QA reviewing completed work"
prompt: |
  You are QA reviewing completed work on the Kanban board.

  YOUR MISSION:
  1. List pending reviews: kanban_qa_list with role: "qa"
  2. For each pending task:
     a. Review the implementation
     b. Check code quality, correctness, edge cases
     c. Approve if good: kanban_qa_approve
     d. Reject with feedback if issues: kanban_qa_reject

  TOOL USAGE:
  - Always use role: "qa"
  - Provide constructive feedback when rejecting (min 10 chars)

  When done, report:
  - Tasks approved
  - Tasks rejected with reasons
```

Wait for QA to complete.

### Handle Rejections

Check for tasks back in in_progress with qaFeedback:
```
kanban_list_tasks with role: "architect", column: "in_progress"
```

If there are rejected tasks:
1. Re-spawn the appropriate agent(s) to fix them
2. Re-run QA after fixes
3. Loop until all tasks approved or max 3 iterations

### Phase 4: Report

Compile final summary for user:

```markdown
## Sprint Complete

### Tasks Completed
- [List of approved tasks]

### Iterations
- Planning: 1 architect session
- Execution: N agent sessions
- Review: M QA sessions

### Stats
- Total tasks: X
- Approved: Y
- Rejected (fixed): Z

### Notes
- [Any blockers encountered]
- [Recommendations for next sprint]
```

## Configuration

### Agent Count
Default: 3 agents (alpha, beta, gamma)
Adjust based on task count and complexity.

### Max Rejection Loops
Default: 3 iterations
Prevents infinite loops if QA keeps rejecting.

### Model Selection
- Architect: sonnet (needs planning intelligence)
- Agents: sonnet (needs coding ability)
- QA: sonnet (needs review judgment)

For simpler tasks, consider haiku for agents.
