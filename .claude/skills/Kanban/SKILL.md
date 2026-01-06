---
name: Kanban
description: Kanban board workflow orchestration. USE WHEN user says kanban-architect, kanban-agent, kanban-qa, kanban-sprint, OR kanban-review-loop. Provides role-based workflows and multi-agent orchestration for the Kanban MCP.
---

# Kanban - Workflow Orchestration Skills

**Provides role-based workflows and multi-agent orchestration for the Kanban MCP.**

This skill enables structured workflows for the 3 Kanban roles (Architect, Agent, QA) plus orchestration commands for full development cycles and continuous monitoring.

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **Architect** | `/kanban-architect` | `Workflows/Architect.md` |
| **Agent** | `/kanban-agent <id>` | `Workflows/Agent.md` |
| **QA** | `/kanban-qa` | `Workflows/QA.md` |
| **Sprint** | `/kanban-sprint [task]` | `Workflows/Sprint.md` |
| **ReviewLoop** | `/kanban-review-loop` | `Workflows/ReviewLoop.md` |

## Quick Reference

### Role Commands
- `/kanban-architect` - Plan work, assign tasks, monitor progress
- `/kanban-agent agent-alpha` - Execute assigned tasks as agent
- `/kanban-qa` - Review completed work, approve or reject

### Orchestration Commands
- `/kanban-sprint "implement feature X"` - Full dev cycle with auto-spawned agents
- `/kanban-review-loop` - Start continuous health monitoring daemon
- `/kanban-review-loop stop` - Stop the review loop

## Examples

**Example 1: Start as Architect to plan a feature**
```
User: "/kanban-architect"
-> Loads architect role context
-> Runs health check and stats
-> Guides through task creation and assignment
```

**Example 2: Run a full sprint**
```
User: "/kanban-sprint implement user authentication"
-> Spawns Architect to plan and create tasks
-> Spawns parallel Agents to execute work
-> Spawns QA to review completed tasks
-> Reports summary when complete
```

**Example 3: Start continuous monitoring**
```
User: "/kanban-review-loop"
-> Runs as background daemon
-> Checks board health every 5 minutes
-> Auto-spawns QA if backlog builds up
-> Alerts on stale or blocked tasks
```
