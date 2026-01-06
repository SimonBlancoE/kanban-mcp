/**
 * Claude Kanban MCP
 *
 * Un servidor MCP para gestionar un tablero Kanban con agentes de IA,
 * junto con un visor web en tiempo real para supervisión pasiva.
 *
 * Uso:
 *   bun run src/index.ts
 *
 * El servidor expone:
 *   - MCP via stdio (para agentes IA)
 *   - HTTP en puerto 3456 (visor web)
 *   - WebSocket en ws://localhost:3456/ws (actualizaciones en tiempo real)
 */

import { store } from "./store";
import { learningStore } from "./learning";
import { startMcpServer } from "./mcp/server";
import { startWebServer } from "./web/server";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3456;

async function main(): Promise<void> {
  console.error("╔═══════════════════════════════════════════════════════════╗");
  console.error("║     CLAUDE KANBAN MCP - AI Agent Board + Ralph Wiggum    ║");
  console.error("╚═══════════════════════════════════════════════════════════╝");
  console.error("");

  // 1. Cargar datos persistidos
  await store.load();
  await learningStore.load();

  // 2. Iniciar servidor web (HTTP + WebSocket para el visor)
  startWebServer();

  // 3. Iniciar servidor MCP (comunicación stdio con agentes)
  await startMcpServer();

  console.error("");
  console.error("═══════════════════════════════════════════════════════════════");
  console.error(`Ready! Open http://localhost:${PORT} to view the Kanban board`);
  console.error("═══════════════════════════════════════════════════════════════");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
