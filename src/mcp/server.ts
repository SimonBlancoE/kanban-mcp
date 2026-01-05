import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools";

/**
 * Inicia el servidor MCP que se comunica via stdio
 */
export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "kanban-mcp",
    version: "1.0.0",
  });

  // Registrar todas las herramientas del Kanban
  registerTools(server);

  // Conectar via stdio (para comunicación con agentes IA)
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[MCP] Kanban MCP server connected via stdio");
  console.error("[MCP] Available tools:");
  console.error("  - kanban_list_tasks");
  console.error("  - kanban_get_task");
  console.error("  - kanban_create_task");
  console.error("  - kanban_update_task");
  console.error("  - kanban_assign_task");
  console.error("  - kanban_move_task");
  console.error("  - kanban_delete_task");
  console.error("  - kanban_get_stats");
  console.error("  - kanban_add_dependency");
  console.error("  - kanban_remove_dependency");
  console.error("  - kanban_health_check");
  console.error("  - kanban_qa_list (QA only)");
  console.error("  - kanban_qa_approve (QA only)");
  console.error("  - kanban_qa_reject (QA only)");
}
