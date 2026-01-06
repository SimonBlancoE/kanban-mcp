/**
 * Claude Kanban MCP - Client App
 * Visor en tiempo real del tablero Kanban via WebSocket
 * Enhanced with Ralph Wiggum iteration tracking and learning insights
 */

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════

let board = { tasks: [], sprints: [], lastModified: null };
let activityLog = [];
const MAX_ACTIVITY_ITEMS = 50;

// ═══════════════════════════════════════════════════════════════════════════
// DOM ELEMENTS
// ═══════════════════════════════════════════════════════════════════════════

const columns = {
  backlog: document.getElementById("col-backlog"),
  in_progress: document.getElementById("col-in_progress"),
  blocked: document.getElementById("col-blocked"),
  done: document.getElementById("col-done"),
};

const columnCounts = {
  backlog: document.getElementById("count-backlog"),
  in_progress: document.getElementById("count-in_progress"),
  blocked: document.getElementById("count-blocked"),
  done: document.getElementById("count-done"),
};

const statElements = {
  backlog: document.getElementById("stat-backlog"),
  in_progress: document.getElementById("stat-in_progress"),
  blocked: document.getElementById("stat-blocked"),
  done: document.getElementById("stat-done"),
};

const statusEl = document.getElementById("connection-status");
const lastUpdateEl = document.getElementById("last-update");

// Modal elements
const modalOverlay = document.getElementById("modal-overlay");
const modalTitle = document.getElementById("modal-title");
const modalClose = document.getElementById("modal-close");
const modalAssignee = document.getElementById("modal-assignee");
const modalPriority = document.getElementById("modal-priority");
const modalColumn = document.getElementById("modal-column");
const modalDescription = document.getElementById("modal-description");
const modalProgress = document.getElementById("modal-progress");
const modalIterText = document.getElementById("modal-iter-text");
const modalTimeline = document.getElementById("modal-timeline");
const criteriaSection = document.getElementById("criteria-section");
const modalCriteriaDesc = document.getElementById("modal-criteria-desc");
const modalCriteriaSteps = document.getElementById("modal-criteria-steps");
const modalCriteriaCmd = document.getElementById("modal-criteria-cmd");
const learningSection = document.getElementById("learning-section");
const modalLearning = document.getElementById("modal-learning");

// Activity sidebar elements
const activitySidebar = document.getElementById("activity-sidebar");
const activityFeed = document.getElementById("activity-feed");
const toggleActivityBtn = document.getElementById("toggle-activity");
const closeSidebarBtn = document.getElementById("close-sidebar");

// Sprint info elements
const sprintInfo = document.getElementById("sprint-info");
const sprintGoal = document.getElementById("sprint-goal");
const sprintIter = document.getElementById("sprint-iter");

// Escalated count
const escalatedCount = document.getElementById("escalated-count");

// ═══════════════════════════════════════════════════════════════════════════
// WEBSOCKET CONNECTION
// ═══════════════════════════════════════════════════════════════════════════

let ws;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;

function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(protocol + "//" + location.host + "/ws");

  ws.onopen = () => {
    console.log("[WS] Connected");
    reconnectAttempts = 0;
    updateConnectionStatus(true);
  };

  ws.onclose = () => {
    console.log("[WS] Disconnected");
    updateConnectionStatus(false);
    scheduleReconnect();
  };

  ws.onerror = (error) => {
    console.error("[WS] Error:", error);
    ws.close();
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      handleMessage(message);
    } catch (error) {
      console.error("[WS] Failed to parse message:", error);
    }
  };
}

function scheduleReconnect() {
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
  reconnectAttempts++;
  console.log("[WS] Reconnecting in " + delay + "ms...");
  setTimeout(connect, delay);
}

function updateConnectionStatus(connected) {
  statusEl.className = "status " + (connected ? "connected" : "disconnected");
  statusEl.querySelector(".status-text").textContent = connected ? "Connected" : "Disconnected";
}

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

function handleMessage(message) {
  console.log("[WS] Received:", message.type);

  switch (message.type) {
    case "board_update":
      board = message.payload;
      renderBoard();
      updateSprintInfo();
      checkEscalatedTasks();
      break;

    case "task_created":
      board.tasks.push(message.payload);
      renderTask(message.payload);
      updateStats();
      break;

    case "task_updated":
      updateTaskInState(message.payload);
      updateTaskCard(message.payload);
      break;

    case "task_moved":
      updateTaskInState(message.payload.task);
      moveTaskCard(message.payload.task, message.payload.fromColumn);
      updateStats();
      break;

    case "task_deleted":
      removeTaskFromState(message.payload.taskId);
      removeTaskCard(message.payload.taskId);
      updateStats();
      break;

    case "iteration_started":
      addActivityItem({
        type: "iteration-started",
        agent: message.payload.agentId,
        text: "Started iteration " + message.payload.iteration + "/" + message.payload.maxIterations,
        task: message.payload.taskTitle,
        taskId: message.payload.taskId,
        timestamp: message.timestamp,
      });
      break;

    case "iteration_completed":
      var isRejected = message.payload.outcome === "rejected";
      addActivityItem({
        type: isRejected ? "iteration-rejected" : "iteration-completed",
        agent: "",
        text: isRejected
          ? "Iteration " + message.payload.iteration + " rejected"
          : "Iteration " + message.payload.iteration + " " + message.payload.outcome,
        task: message.payload.taskTitle,
        taskId: message.payload.taskId,
        timestamp: message.timestamp,
      });
      break;

    case "agent_activity":
      addActivityItem({
        type: "agent-activity",
        agent: message.payload.agentId,
        text: message.payload.activity,
        task: message.payload.taskTitle,
        taskId: message.payload.taskId,
        timestamp: message.timestamp,
      });
      break;

    case "sprint_created":
    case "sprint_updated":
      var sprintIndex = (board.sprints || []).findIndex(function(s) { return s.id === message.payload.id; });
      if (sprintIndex >= 0) {
        board.sprints[sprintIndex] = message.payload;
      } else {
        if (!board.sprints) board.sprints = [];
        board.sprints.push(message.payload);
      }
      updateSprintInfo();
      break;
  }

  updateLastUpdate(message.timestamp);
}

function updateTaskInState(task) {
  var index = board.tasks.findIndex(function(t) { return t.id === task.id; });
  if (index !== -1) {
    board.tasks[index] = task;
  }
}

function removeTaskFromState(taskId) {
  board.tasks = board.tasks.filter(function(t) { return t.id !== taskId; });
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDERING
// ═══════════════════════════════════════════════════════════════════════════

function renderBoard() {
  Object.values(columns).forEach(function(col) { col.textContent = ""; });
  board.tasks.forEach(renderTask);
  updateStats();
}

function renderTask(task) {
  var card = createTaskCard(task);
  columns[task.column].appendChild(card);
}

function createTaskCard(task) {
  var card = document.createElement("div");
  card.className = "task-card" + (task.pendingQa ? " pending-qa" : "");
  card.id = "task-" + task.id;
  card.onclick = function() { openTaskModal(task.id); };

  var priority = task.priority || "medium";
  var priorityLabels = { critical: "CRIT", high: "HIGH", medium: "MED", low: "LOW" };

  // Header
  var header = document.createElement("div");
  header.className = "card-header";

  var prioritySpan = document.createElement("span");
  prioritySpan.className = "priority priority-" + priority;
  prioritySpan.textContent = priorityLabels[priority];
  header.appendChild(prioritySpan);

  // Iteration badge
  var iteration = task.iteration || 1;
  var maxIterations = task.maxIterations || 3;
  if (iteration > 1 || task.column === "in_progress") {
    var iterBadge = document.createElement("span");
    iterBadge.className = "iter-badge";
    if (iteration > maxIterations) iterBadge.className += " danger";
    else if (iteration > 1) iterBadge.className += " warning";
    iterBadge.title = "Iteration " + iteration + " of " + maxIterations;
    iterBadge.textContent = "I" + iteration + "/" + maxIterations;
    header.appendChild(iterBadge);
  }

  // QA badge
  if (task.pendingQa) {
    var qaBadge = document.createElement("span");
    qaBadge.className = "qa-badge pending";
    qaBadge.title = "Awaiting QA review";
    qaBadge.textContent = "QA";
    header.appendChild(qaBadge);
  } else if (task.qaFeedback) {
    var qaFeedbackBadge = document.createElement("span");
    var isApproved = task.qaFeedback.startsWith("APPROVED");
    qaFeedbackBadge.className = "qa-badge " + (isApproved ? "approved" : "rejected");
    qaFeedbackBadge.title = task.qaFeedback;
    qaFeedbackBadge.textContent = isApproved ? "✓" : "✗";
    header.appendChild(qaFeedbackBadge);
  }

  // Dependencies
  var dependsOnCount = (task.dependsOn || []).length;
  var blocksCount = (task.blocks || []).length;
  if (dependsOnCount > 0 || blocksCount > 0) {
    var depsDiv = document.createElement("div");
    depsDiv.className = "dependencies";
    if (dependsOnCount > 0) {
      var depBadge = document.createElement("span");
      depBadge.className = "dep-badge depends-on";
      depBadge.title = "Depends on " + dependsOnCount + " task(s)";
      depBadge.textContent = "← " + dependsOnCount;
      depsDiv.appendChild(depBadge);
    }
    if (blocksCount > 0) {
      var blocksBadge = document.createElement("span");
      blocksBadge.className = "dep-badge blocks";
      blocksBadge.title = "Blocks " + blocksCount + " task(s)";
      blocksBadge.textContent = "→ " + blocksCount;
      depsDiv.appendChild(blocksBadge);
    }
    header.appendChild(depsDiv);
  }

  card.appendChild(header);

  // Title
  var titleDiv = document.createElement("div");
  titleDiv.className = "title";
  titleDiv.textContent = task.title;
  card.appendChild(titleDiv);

  // Assignee
  var assigneeDiv = document.createElement("div");
  assigneeDiv.className = "assignee" + (task.assignee ? "" : " unassigned");
  assigneeDiv.textContent = task.assignee || "Unassigned";
  card.appendChild(assigneeDiv);

  // Timestamp
  var timestampDiv = document.createElement("div");
  timestampDiv.className = "timestamp";
  timestampDiv.textContent = formatTime(task.updatedAt);
  card.appendChild(timestampDiv);

  return card;
}

function updateTaskCard(task) {
  var oldCard = document.getElementById("task-" + task.id);
  if (!oldCard) return;
  var newCard = createTaskCard(task);
  oldCard.replaceWith(newCard);
}

function moveTaskCard(task, fromColumn) {
  var card = document.getElementById("task-" + task.id);
  if (!card) return;
  columns[task.column].appendChild(card);
  updateTaskCard(task);
}

function removeTaskCard(taskId) {
  var card = document.getElementById("task-" + taskId);
  if (card) card.remove();
}

function updateStats() {
  var stats = { backlog: 0, in_progress: 0, blocked: 0, done: 0 };
  board.tasks.forEach(function(task) { stats[task.column]++; });

  Object.keys(stats).forEach(function(column) {
    if (columnCounts[column]) columnCounts[column].textContent = stats[column];
    if (statElements[column]) statElements[column].textContent = stats[column];
  });

  Object.keys(columns).forEach(function(column) {
    if (stats[column] === 0 && !columns[column].querySelector(".empty-state")) {
      var empty = document.createElement("div");
      empty.className = "empty-state";
      var icon = document.createElement("div");
      icon.className = "empty-state-icon";
      icon.textContent = "📋";
      var text = document.createElement("div");
      text.className = "empty-state-text";
      text.textContent = "No tasks";
      empty.appendChild(icon);
      empty.appendChild(text);
      columns[column].appendChild(empty);
    }
  });
}

function updateLastUpdate(timestamp) {
  if (timestamp) lastUpdateEl.textContent = "Last update: " + formatTime(timestamp);
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════════════════════════

async function openTaskModal(taskId) {
  try {
    var response = await fetch("/api/task/" + taskId + "/detail");
    if (!response.ok) throw new Error("Failed to fetch task detail");

    var data = await response.json();
    var task = data.task;
    var iterationSummary = data.iterationSummary;

    modalTitle.textContent = task.title;
    modalAssignee.textContent = task.assignee || "Unassigned";
    modalPriority.textContent = (task.priority || "medium").toUpperCase();
    modalColumn.textContent = (task.column || "backlog").replace("_", " ").toUpperCase();
    modalDescription.textContent = task.description || "No description";

    var current = (iterationSummary && iterationSummary.current) || 1;
    var max = (iterationSummary && iterationSummary.max) || 3;
    var percentage = Math.min((current / max) * 100, 100);
    modalProgress.style.width = percentage + "%";
    modalProgress.className = "progress-fill";
    if (current > max) modalProgress.classList.add("danger");
    else if (current > 1) modalProgress.classList.add("warning");
    modalIterText.textContent = "Iteration " + current + " of " + max;

    // Acceptance criteria
    if (task.acceptanceCriteria) {
      criteriaSection.style.display = "block";
      modalCriteriaDesc.textContent = task.acceptanceCriteria.description || "";
      modalCriteriaSteps.textContent = "";
      var steps = task.acceptanceCriteria.verificationSteps || [];
      steps.forEach(function(step) {
        var stepDiv = document.createElement("div");
        stepDiv.className = "criteria-step";
        stepDiv.textContent = step;
        modalCriteriaSteps.appendChild(stepDiv);
      });
      if (task.acceptanceCriteria.testCommand) {
        modalCriteriaCmd.textContent = task.acceptanceCriteria.testCommand;
        modalCriteriaCmd.style.display = "block";
      } else {
        modalCriteriaCmd.style.display = "none";
      }
    } else {
      criteriaSection.style.display = "none";
    }

    // Timeline
    var iterationLog = task.iterationLog || [];
    modalTimeline.textContent = "";
    if (iterationLog.length > 0) {
      iterationLog.forEach(function(entry) {
        var entryDiv = document.createElement("div");
        entryDiv.className = "timeline-entry " + entry.outcome;

        var headerDiv = document.createElement("div");
        headerDiv.className = "timeline-header";
        var iterSpan = document.createElement("span");
        iterSpan.className = "timeline-iter";
        iterSpan.textContent = "Attempt " + entry.iteration;
        var outcomeSpan = document.createElement("span");
        outcomeSpan.className = "timeline-outcome " + entry.outcome;
        outcomeSpan.textContent = entry.outcome.replace("_", " ");
        headerDiv.appendChild(iterSpan);
        headerDiv.appendChild(outcomeSpan);
        entryDiv.appendChild(headerDiv);

        if (entry.feedback) {
          var feedbackDiv = document.createElement("div");
          feedbackDiv.className = "timeline-feedback";
          feedbackDiv.textContent = entry.feedback;
          entryDiv.appendChild(feedbackDiv);
        }

        var timeDiv = document.createElement("div");
        timeDiv.className = "timeline-time";
        timeDiv.textContent = formatTime(entry.startedAt);
        entryDiv.appendChild(timeDiv);

        modalTimeline.appendChild(entryDiv);
      });
    } else {
      var emptyDiv = document.createElement("div");
      emptyDiv.className = "timeline-empty";
      emptyDiv.textContent = "No iterations yet";
      modalTimeline.appendChild(emptyDiv);
    }

    // Learning insights
    learningSection.style.display = "none";
    if (task.assignee) {
      try {
        var learningResponse = await fetch("/api/learning/agent/" + task.assignee);
        if (learningResponse.ok) {
          var learningData = await learningResponse.json();
          if (learningData.mistakePatterns && learningData.mistakePatterns.length > 0) {
            learningSection.style.display = "block";
            modalLearning.textContent = "";
            learningData.mistakePatterns.slice(0, 3).forEach(function(pattern) {
              var patternDiv = document.createElement("div");
              patternDiv.className = "learning-pattern";
              var catSpan = document.createElement("span");
              catSpan.className = "pattern-category";
              catSpan.textContent = pattern.category;
              var countSpan = document.createElement("span");
              countSpan.className = "pattern-count";
              countSpan.textContent = " (" + pattern.occurrences + " occurrences)";
              var descDiv = document.createElement("div");
              descDiv.className = "pattern-desc";
              descDiv.textContent = pattern.description;
              patternDiv.appendChild(catSpan);
              patternDiv.appendChild(countSpan);
              patternDiv.appendChild(descDiv);
              modalLearning.appendChild(patternDiv);
            });
          }
        }
      } catch (e) { /* ignore */ }
    }

    modalOverlay.classList.add("open");
  } catch (error) {
    console.error("Error opening task modal:", error);
  }
}

function closeTaskModal() {
  modalOverlay.classList.remove("open");
}

modalClose.onclick = closeTaskModal;
modalOverlay.onclick = function(e) {
  if (e.target === modalOverlay) closeTaskModal();
};
document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") closeTaskModal();
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVITY SIDEBAR
// ═══════════════════════════════════════════════════════════════════════════

function toggleActivitySidebar() {
  activitySidebar.classList.toggle("open");
  toggleActivityBtn.classList.toggle("active");
}

function closeActivitySidebar() {
  activitySidebar.classList.remove("open");
  toggleActivityBtn.classList.remove("active");
}

function addActivityItem(item) {
  activityLog.unshift(item);
  if (activityLog.length > MAX_ACTIVITY_ITEMS) {
    activityLog = activityLog.slice(0, MAX_ACTIVITY_ITEMS);
  }
  renderActivityFeed();
}

function renderActivityFeed() {
  activityFeed.textContent = "";
  if (activityLog.length === 0) {
    var emptyDiv = document.createElement("div");
    emptyDiv.className = "activity-empty";
    emptyDiv.textContent = "No activity yet";
    activityFeed.appendChild(emptyDiv);
    return;
  }

  activityLog.forEach(function(item) {
    var itemDiv = document.createElement("div");
    itemDiv.className = "activity-item " + item.type;

    var headerDiv = document.createElement("div");
    headerDiv.className = "activity-header";
    var agentSpan = document.createElement("span");
    agentSpan.className = "activity-agent";
    agentSpan.textContent = item.agent || "System";
    var timeSpan = document.createElement("span");
    timeSpan.className = "activity-time";
    timeSpan.textContent = formatTime(item.timestamp);
    headerDiv.appendChild(agentSpan);
    headerDiv.appendChild(timeSpan);

    var textDiv = document.createElement("div");
    textDiv.className = "activity-text";
    textDiv.textContent = item.text;

    var taskDiv = document.createElement("div");
    taskDiv.className = "activity-task";
    taskDiv.textContent = item.task;

    itemDiv.appendChild(headerDiv);
    itemDiv.appendChild(textDiv);
    itemDiv.appendChild(taskDiv);
    activityFeed.appendChild(itemDiv);
  });
}

toggleActivityBtn.onclick = toggleActivitySidebar;
closeSidebarBtn.onclick = closeActivitySidebar;

// ═══════════════════════════════════════════════════════════════════════════
// SPRINT INFO
// ═══════════════════════════════════════════════════════════════════════════

function updateSprintInfo() {
  var sprints = board.sprints || [];
  var activeSprint = sprints.find(function(s) {
    return s.status === "planning" || s.status === "executing" || s.status === "reviewing";
  });

  if (activeSprint) {
    sprintInfo.style.display = "flex";
    sprintGoal.textContent = activeSprint.goal;
    sprintIter.textContent = "Iter " + activeSprint.currentIteration + "/" + activeSprint.maxIterations;
  } else {
    sprintInfo.style.display = "none";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ESCALATED TASKS CHECK
// ═══════════════════════════════════════════════════════════════════════════

function checkEscalatedTasks() {
  var escalated = board.tasks.filter(function(t) {
    return (t.iteration || 1) > (t.maxIterations || 3) && t.column !== "done";
  });

  if (escalated.length > 0) {
    escalatedCount.style.display = "inline";
    escalatedCount.textContent = escalated.length + " escalated";
  } else {
    escalatedCount.style.display = "none";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function formatTime(isoString) {
  if (!isoString) return "--";
  var date = new Date(isoString);
  var now = new Date();
  var diffMs = now - date;
  var diffMins = Math.floor(diffMs / 60000);
  var diffHours = Math.floor(diffMs / 3600000);
  var diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return diffMins + "m ago";
  if (diffHours < 24) return diffHours + "h ago";
  if (diffDays < 7) return diffDays + "d ago";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZE
// ═══════════════════════════════════════════════════════════════════════════

connect();
updateStats();
