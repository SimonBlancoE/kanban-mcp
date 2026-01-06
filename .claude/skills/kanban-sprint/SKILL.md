---
name: kanban-sprint
description: Kanban Sprint orchestrator. USE WHEN user says /kanban-sprint OR wants to run a full automated development cycle.
---

# Kanban Sprint - Ralph Wiggum Full Development Cycle

You are running a **Sprint** - a full development cycle that orchestrates Architect, Agent, and QA roles with **iterative refinement** (Ralph Wiggum pattern).

## Arguments

Optional task/feature description after the command.
Example: `/kanban-sprint implement user authentication`

## Sprint Lifecycle

```
PLANNING -> EXECUTING -> REVIEWING -> COMPLETE/FAILED
             ^    |
             |    v (if rejections)
             +----+
```

A sprint can have multiple iterations. Each iteration:
1. Agents work on tasks
2. QA reviews
3. If rejections, loop back (up to maxIterations)

## Execution Instructions

### Phase 0: Learning Context

**Before planning, get project insights:**

```
kanban_get_learning_insights with role: "architect"
```

Review:
- Past project lessons
- Codebase conventions
- Common patterns to follow

### Phase 1: Planning

**Create the sprint first:**

```
kanban_sprint_create:
  role: "architect"
  goal: "[User's goal description]"
  successCriteria:
    - "Criterion 1"
    - "Criterion 2"
    - "All tests pass"
  maxIterations: 5
```

**Then spawn an Architect agent:**

```
Task tool:
  subagent_type: "general-purpose"
  description: "Architect planning sprint"
  prompt: |
    You are the ARCHITECT for Kanban sprint [SPRINT_ID].

    GOAL: [User's goal]

    1. Get learning insights: kanban_get_learning_insights
    2. Analyze the codebase
    3. Create 3-8 tasks using kanban_create_task with:
       - role: "architect"
       - sprintId: "[SPRINT_ID]"
       - acceptanceCriteria: { description, verificationSteps, testCommand }
       - maxIterations: 3
    4. Set priorities and dependencies
    5. Assign to agents: agent-alpha, agent-beta, agent-gamma

    IMPORTANT: Each task must have clear acceptance criteria!

    Report: tasks created with their acceptance criteria.
```

**Update sprint status:**
```
kanban_sprint_update_status:
  role: "architect"
  sprintId: "[SPRINT_ID]"
  status: "executing"
```

### Phase 2: Execution (Iteration N)

**Record iteration start:**
```
kanban_sprint_update_status:
  role: "architect"
  sprintId: "[SPRINT_ID]"
  iterationNotes: "Starting iteration N"
```

**Spawn Agent sub-agents in parallel:**

```
Task tool:
  subagent_type: "general-purpose"
  description: "Agent-alpha executing tasks"
  prompt: |
    You are AGENT-ALPHA on Kanban sprint [SPRINT_ID].

    1. Get context: kanban_get_task_context with agentId: "agent-alpha"
    2. List your tasks: kanban_list_tasks with role: "agent", agentId: "agent-alpha"
    3. For each task (priority order):
       - kanban_start_iteration (marks iteration start)
       - Review acceptance criteria
       - Implement the work
       - Self-verify against criteria
       - kanban_submit_iteration with workSummary and selfAssessment

    Always use role: "agent", agentId: "agent-alpha"

    IMPORTANT: Submit iteration with detailed summary of what you did!
```

Spawn similar agents for beta, gamma as needed. Wait for all to complete.

### Phase 3: Review

**Spawn QA agent:**

```
Task tool:
  subagent_type: "general-purpose"
  description: "QA reviewing completed work"
  prompt: |
    You are QA reviewing Kanban sprint [SPRINT_ID].

    1. Get context: kanban_get_learning_insights with role: "qa"
    2. List pending: kanban_qa_list with role: "qa"
    3. For each task:
       - Get full detail: kanban_get_task_detail with taskId
       - Review iteration history
       - Verify against acceptance criteria
       - Approve or reject with:
         - feedback (what's wrong)
         - category (logic/testing/style/security/performance/missing-feature)
         - severity (critical/major/minor)
         - suggestedApproach (how to fix)

    IMPORTANT: Structured feedback helps agents learn!

    Report: approved count, rejected count with categories.
```

### Phase 4: Iteration Decision

**Check results:**
- If all tasks approved -> Sprint COMPLETE
- If rejections exist AND sprint.currentIteration < maxIterations -> Loop to Phase 2
- If rejections exist AND sprint.currentIteration >= maxIterations -> Sprint FAILED

**Record iteration result:**
```
kanban_sprint_update_status:
  role: "architect"
  sprintId: "[SPRINT_ID]"
  status: "executing"  // or "complete" or "failed"
  iterationNotes: "Iteration N complete. X approved, Y rejected."
```

### Phase 5: Report

**Final summary:**
- Sprint goal achieved? (check success criteria)
- Total iterations needed
- Tasks completed vs failed
- Lessons learned

**If sprint was successful, record lessons:**
```
kanban_add_lesson:
  role: "architect"
  category: "process"
  lesson: "Key learning from this sprint"
  source: "sprint-[ID]"
```

## Escalation Handling

If a task exceeds its maxIterations:
```
kanban_get_escalated_tasks with role: "architect"
```

Escalated tasks need human review. Options:
- Reassign to a different agent
- Increase maxIterations
- Break into smaller tasks
- Remove from sprint

## Examples

```
User: "/kanban-sprint implement user authentication"
-> Get learning insights
-> Create sprint with success criteria
-> Spawn Architect to plan tasks with acceptance criteria
-> Iteration 1:
   -> Spawn parallel Agents (with context)
   -> Spawn QA to review (with structured feedback)
   -> 2 tasks rejected
-> Iteration 2:
   -> Agents fix rejected tasks
   -> QA re-reviews
   -> All approved
-> Sprint complete
-> Record lessons learned
```
