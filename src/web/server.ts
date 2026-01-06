import { store } from "../store";
import { learningStore } from "../learning";
import { broadcaster } from "./broadcast";
import { join, dirname } from "path";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3456;

// Resolver path absoluto al directorio public (relativo al módulo, no al cwd)
const __dirname = dirname(import.meta.path);
const PUBLIC_DIR = join(__dirname, "..", "..", "public");

// MIME types para archivos estáticos
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/**
 * Inicia el servidor HTTP/WebSocket para el visor web
 */
export function startWebServer(): void {
  const server = Bun.serve({
    port: PORT,

    /**
     * Handler para peticiones HTTP
     */
    fetch(req, server) {
      const url = new URL(req.url);
      const path = url.pathname;

      // WebSocket upgrade
      if (path === "/ws") {
        const upgraded = server.upgrade(req);
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // API: Obtener estado del tablero
      if (path === "/api/board") {
        return Response.json(store.getBoard());
      }

      // API: Obtener estadísticas
      if (path === "/api/stats") {
        return Response.json(store.getStats());
      }

      // API: Task detail with iteration history
      if (path.startsWith("/api/task/") && path.endsWith("/detail")) {
        const taskId = path.replace("/api/task/", "").replace("/detail", "");
        const detail = store.getTaskDetail(taskId);
        if (!detail) {
          return Response.json({ error: "Task not found" }, { status: 404 });
        }
        return Response.json(detail);
      }

      // API: Get task by ID
      if (path.startsWith("/api/task/")) {
        const taskId = path.replace("/api/task/", "");
        const task = store.getTask(taskId);
        if (!task) {
          return Response.json({ error: "Task not found" }, { status: 404 });
        }
        return Response.json(task);
      }

      // API: Sprints list
      if (path === "/api/sprints") {
        return Response.json(store.getSprints());
      }

      // API: Sprint detail
      if (path.startsWith("/api/sprint/")) {
        const sprintId = path.replace("/api/sprint/", "");
        const sprint = store.getSprint(sprintId);
        if (!sprint) {
          return Response.json({ error: "Sprint not found" }, { status: 404 });
        }
        // Include task details
        const tasks = sprint.taskIds.map(id => store.getTask(id)).filter(Boolean);
        return Response.json({ sprint, tasks });
      }

      // API: Active sprint
      if (path === "/api/sprint/active") {
        const sprint = store.getActiveSprint();
        if (!sprint) {
          return Response.json({ sprint: null });
        }
        const tasks = sprint.taskIds.map(id => store.getTask(id)).filter(Boolean);
        return Response.json({ sprint, tasks });
      }

      // API: Learning insights
      if (path === "/api/learning") {
        const agents = learningStore.getAllAgentStats();
        const lessons = learningStore.getRelevantLessons();
        const conventions = learningStore.getCodebaseConventions();
        return Response.json({ agents, lessons, conventions });
      }

      // API: Agent learning profile
      if (path.startsWith("/api/learning/agent/")) {
        const agentId = path.replace("/api/learning/agent/", "");
        const profile = learningStore.getAgentProfile(agentId);
        return Response.json(profile);
      }

      // API: Escalated tasks
      if (path === "/api/escalated") {
        return Response.json(store.getEscalatedTasks());
      }

      // API: Health check
      if (path === "/api/health") {
        return Response.json(store.getHealthCheck());
      }

      // Archivos estáticos
      let filePath = path === "/" ? "/index.html" : path;
      const fullPath = `${PUBLIC_DIR}${filePath}`;

      try {
        const file = Bun.file(fullPath);
        const ext = filePath.substring(filePath.lastIndexOf("."));
        const contentType = MIME_TYPES[ext] || "application/octet-stream";

        return new Response(file, {
          headers: { "Content-Type": contentType },
        });
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    },

    /**
     * Configuración WebSocket
     */
    websocket: {
      open(ws) {
        broadcaster.addClient(ws);

        // Enviar estado inicial del tablero al conectarse
        ws.send(
          JSON.stringify({
            type: "board_update",
            payload: store.getBoard(),
            timestamp: new Date().toISOString(),
          })
        );
      },

      close(ws) {
        broadcaster.removeClient(ws);
      },

      message(_ws, _message) {
        // El visor es pasivo, no procesa mensajes del cliente
      },
    },
  });

  console.error(`[Web] Kanban viewer running at http://localhost:${server.port}`);
}
