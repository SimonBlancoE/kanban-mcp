/**
 * Claude Kanban MCP - Client App
 * Visor en tiempo real del tablero Kanban via WebSocket
 */

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════

let board = { tasks: [], lastModified: null };

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

// ═══════════════════════════════════════════════════════════════════════════
// WEBSOCKET CONNECTION
// ═══════════════════════════════════════════════════════════════════════════

let ws;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;

function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

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
  console.log(`[WS] Reconnecting in ${delay}ms...`);
  setTimeout(connect, delay);
}

function updateConnectionStatus(connected) {
  statusEl.className = `status ${connected ? "connected" : "disconnected"}`;
  statusEl.querySelector(".status-text").textContent = connected
    ? "Connected"
    : "Disconnected";
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
  }

  updateLastUpdate(message.timestamp);
}

function updateTaskInState(task) {
  const index = board.tasks.findIndex((t) => t.id === task.id);
  if (index !== -1) {
    board.tasks[index] = task;
  }
}

function removeTaskFromState(taskId) {
  board.tasks = board.tasks.filter((t) => t.id !== taskId);
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDERING
// ═══════════════════════════════════════════════════════════════════════════

function renderBoard() {
  // Limpiar todas las columnas
  Object.values(columns).forEach((col) => (col.innerHTML = ""));

  // Renderizar cada tarea
  board.tasks.forEach(renderTask);

  // Actualizar estadísticas
  updateStats();
}

function renderTask(task) {
  const card = createTaskCard(task);
  columns[task.column].appendChild(card);
}

function createTaskCard(task) {
  const card = document.createElement("div");
  card.className = "task-card";
  card.id = `task-${task.id}`;

  const assigneeClass = task.assignee ? "" : "unassigned";
  const assigneeText = task.assignee || "Unassigned";
  const priority = task.priority || "medium";
  const priorityLabel = { critical: "CRIT", high: "HIGH", medium: "MED", low: "LOW" }[priority];

  // Build dependency indicators
  const dependsOnCount = (task.dependsOn || []).length;
  const blocksCount = (task.blocks || []).length;
  let dependencyHtml = "";
  if (dependsOnCount > 0 || blocksCount > 0) {
    dependencyHtml = `<div class="dependencies">`;
    if (dependsOnCount > 0) {
      dependencyHtml += `<span class="dep-badge depends-on" title="Depends on ${dependsOnCount} task(s)">⬅ ${dependsOnCount}</span>`;
    }
    if (blocksCount > 0) {
      dependencyHtml += `<span class="dep-badge blocks" title="Blocks ${blocksCount} task(s)">➡ ${blocksCount}</span>`;
    }
    dependencyHtml += `</div>`;
  }

  card.innerHTML = `
    <div class="card-header">
      <span class="priority priority-${priority}">${priorityLabel}</span>
      ${dependencyHtml}
    </div>
    <div class="title">${escapeHtml(task.title)}</div>
    <div class="assignee ${assigneeClass}">${escapeHtml(assigneeText)}</div>
    <div class="timestamp">${formatTime(task.updatedAt)}</div>
    ${
      task.description
        ? `<div class="description">${escapeHtml(task.description)}</div>`
        : ""
    }
  `;

  return card;
}

function updateTaskCard(task) {
  const card = document.getElementById(`task-${task.id}`);
  if (!card) return;

  // Update priority
  const priorityEl = card.querySelector(".priority");
  if (priorityEl) {
    const priority = task.priority || "medium";
    const priorityLabel = { critical: "CRIT", high: "HIGH", medium: "MED", low: "LOW" }[priority];
    priorityEl.className = `priority priority-${priority}`;
    priorityEl.textContent = priorityLabel;
  }

  // Update dependencies
  const cardHeader = card.querySelector(".card-header");
  if (cardHeader) {
    const existingDeps = cardHeader.querySelector(".dependencies");
    if (existingDeps) existingDeps.remove();

    const dependsOnCount = (task.dependsOn || []).length;
    const blocksCount = (task.blocks || []).length;
    if (dependsOnCount > 0 || blocksCount > 0) {
      const depsDiv = document.createElement("div");
      depsDiv.className = "dependencies";
      if (dependsOnCount > 0) {
        depsDiv.innerHTML += `<span class="dep-badge depends-on" title="Depends on ${dependsOnCount} task(s)">⬅ ${dependsOnCount}</span>`;
      }
      if (blocksCount > 0) {
        depsDiv.innerHTML += `<span class="dep-badge blocks" title="Blocks ${blocksCount} task(s)">➡ ${blocksCount}</span>`;
      }
      cardHeader.appendChild(depsDiv);
    }
  }

  const titleEl = card.querySelector(".title");
  const assigneeEl = card.querySelector(".assignee");
  const timestampEl = card.querySelector(".timestamp");
  let descriptionEl = card.querySelector(".description");

  titleEl.textContent = task.title;

  assigneeEl.className = `assignee ${task.assignee ? "" : "unassigned"}`;
  assigneeEl.textContent = task.assignee || "Unassigned";

  timestampEl.textContent = formatTime(task.updatedAt);

  // Actualizar descripción
  if (task.description) {
    if (descriptionEl) {
      descriptionEl.textContent = task.description;
    } else {
      descriptionEl = document.createElement("div");
      descriptionEl.className = "description";
      descriptionEl.textContent = task.description;
      card.appendChild(descriptionEl);
    }
  } else if (descriptionEl) {
    descriptionEl.remove();
  }
}

function moveTaskCard(task, fromColumn) {
  const card = document.getElementById(`task-${task.id}`);
  if (!card) return;

  // Mover a la nueva columna
  columns[task.column].appendChild(card);

  // Actualizar timestamp
  const timestampEl = card.querySelector(".timestamp");
  if (timestampEl) {
    timestampEl.textContent = formatTime(task.updatedAt);
  }
}

function removeTaskCard(taskId) {
  const card = document.getElementById(`task-${taskId}`);
  if (card) {
    card.remove();
  }
}

function updateStats() {
  const stats = {
    backlog: 0,
    in_progress: 0,
    blocked: 0,
    done: 0,
  };

  board.tasks.forEach((task) => {
    stats[task.column]++;
  });

  // Actualizar contadores de columnas
  Object.entries(stats).forEach(([column, count]) => {
    if (columnCounts[column]) {
      columnCounts[column].textContent = count;
    }
    if (statElements[column]) {
      statElements[column].textContent = count;
    }
  });

  // Mostrar estado vacío si no hay tareas
  Object.entries(columns).forEach(([column, el]) => {
    if (stats[column] === 0 && !el.querySelector(".empty-state")) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-text">No tasks</div>
        </div>
      `;
    }
  });
}

function updateLastUpdate(timestamp) {
  if (timestamp) {
    lastUpdateEl.textContent = `Last update: ${formatTime(timestamp)}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(isoString) {
  if (!isoString) return "--";

  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  // Formato relativo para actualizaciones recientes
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  // Formato absoluto para fechas más antiguas
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

// Conectar al WebSocket al cargar la página
connect();

// Mostrar estado inicial
updateStats();
