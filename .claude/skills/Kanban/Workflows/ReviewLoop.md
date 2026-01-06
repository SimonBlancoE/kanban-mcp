# ReviewLoop Workflow - Continuous Health Monitoring Daemon

You are starting the **Review Loop** - a background daemon that continuously monitors the Kanban board health and takes corrective action.

## Arguments

- `/kanban-review-loop` - Start the daemon
- `/kanban-review-loop stop` - Stop the daemon (requires task ID)

## Behavior

This workflow runs as a background process that:
1. Checks board health every 5 minutes
2. Detects and reports issues
3. Auto-spawns QA if review backlog grows
4. Alerts on stale or blocked tasks
5. Continues until explicitly stopped

## Startup

**Run this agent in the background:**

```
Task tool with:
  subagent_type: "general-purpose"
  run_in_background: true
  description: "Kanban review loop daemon"
  prompt: [See daemon prompt below]
```

## Daemon Prompt

```
You are the KANBAN REVIEW LOOP DAEMON - a background process monitoring board health.

## Your Mission

Run continuously, checking board health every 5 minutes and taking corrective action.

## Main Loop

Repeat forever until session ends:

### Step 1: Health Check
Run kanban_health_check with role: "architect", staleThresholdHours: 24

### Step 2: Analyze Issues

Check for each issue type:

**Stale Tasks (in_progress > 24 hours):**
- Log: "ALERT: Task [title] has been in progress for [hours] hours"
- Action: Consider reassigning or checking with agent

**QA Backlog (pendingQa > 3):**
- Log: "ALERT: QA backlog at [count] tasks"
- Action: Spawn QA sub-agent to clear backlog (see below)

**Overloaded Agents (> 5 tasks in progress):**
- Log: "ALERT: Agent [id] has [count] tasks in progress"
- Action: Report for architect attention

**Low Backlog (< 3 tasks):**
- Log: "INFO: Backlog running low ([count] tasks)"
- Action: Suggest planning session

**Critical Tasks Not Started:**
- Log: "ALERT: Critical task [title] not started"
- Action: Prioritize assignment

**Blocked Tasks Unassigned:**
- Log: "ALERT: Blocked task [title] has no assignee"
- Action: Needs architect attention

### Step 3: Auto-Remediation

**If QA backlog > 3, spawn QA agent:**

Use Task tool (NOT in background):
  subagent_type: "general-purpose"
  description: "QA clearing backlog"
  prompt: |
    You are QA clearing a backlog of pending reviews.

    1. Run kanban_qa_list with role: "qa"
    2. Review and approve/reject each task
    3. Provide constructive feedback for rejections
    4. Report summary when done

Wait for QA to complete before continuing loop.

### Step 4: Report Status

Output current board summary:
- Tasks per column
- Pending QA count
- Any active issues
- Time until next check

### Step 5: Sleep

Wait 5 minutes before next iteration.
Use: await new Promise(r => setTimeout(r, 300000))

Or simply output "Sleeping for 5 minutes..." and continue loop.

## Output Format

Each iteration should output:

---
[TIMESTAMP] Review Loop Check #N
Health Status: [OK | ISSUES DETECTED]
- Backlog: X tasks
- In Progress: Y tasks
- Blocked: Z tasks
- Done (pending QA): W tasks

Issues:
- [List any issues detected]

Actions Taken:
- [Any auto-remediation performed]

Next check in 5 minutes...
---

## Stopping

The daemon runs until:
- Session ends
- User kills the background task
- Unrecoverable error occurs

To stop manually:
1. User runs /tasks to find task ID
2. User runs KillShell with the task ID
```

## Monitoring the Daemon

After starting the review loop:

1. Note the task ID returned
2. Check status anytime with: `TaskOutput with task_id: "<id>", block: false`
3. Stop with: `KillShell with shell_id: "<id>"`

## Configuration

### Check Interval
Default: 5 minutes (300000ms)
Adjust in the daemon prompt if needed.

### QA Backlog Threshold
Default: 3 pending tasks triggers auto-QA
Adjust based on team velocity.

### Stale Task Threshold
Default: 24 hours
Tasks in_progress longer than this are flagged.

## Notes

- The daemon uses "architect" role for health checks (full visibility)
- Auto-spawned QA agents run synchronously (waits for completion)
- All alerts are logged to the daemon output
- User can retrieve logs via TaskOutput anytime
