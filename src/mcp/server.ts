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
  console.error("[MCP] Available tools (27 total):");
  console.error("  Core: kanban_list_tasks, kanban_get_task, kanban_create_task");
  console.error("  Core: kanban_update_task, kanban_assign_task, kanban_move_task, kanban_delete_task");
  console.error("  Stats: kanban_get_stats, kanban_health_check");
  console.error("  Deps: kanban_add_dependency, kanban_remove_dependency");
  console.error("  QA: kanban_qa_list, kanban_qa_approve, kanban_qa_reject");
  console.error("  Sprint: kanban_sprint_create, kanban_sprint_get, kanban_sprint_update_status, kanban_sprint_list");
  console.error("  Iteration: kanban_start_iteration, kanban_submit_iteration, kanban_get_task_context");
  console.error("  Learning: kanban_get_learning_insights, kanban_add_lesson, kanban_add_convention");
  console.error("  Other: kanban_set_acceptance_criteria, kanban_get_escalated_tasks, kanban_log_activity, kanban_get_task_detail");
}
