import { store } from "../store";
import { broadcaster } from "./broadcast";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3456;
const PUBLIC_DIR = "./public";

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
