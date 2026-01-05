#!/usr/bin/env node

/**
 * CLI entry point for @simonblanco/kanban-mcp
 *
 * This script launches the MCP Kanban server.
 * Requires Bun runtime for optimal performance.
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const entryPoint = join(__dirname, "..", "src", "index.ts");

// Check if Bun is available
function hasBun() {
  try {
    const result = spawn("bun", ["--version"], { stdio: "ignore" });
    return new Promise((resolve) => {
      result.on("error", () => resolve(false));
      result.on("close", (code) => resolve(code === 0));
    });
  } catch {
    return Promise.resolve(false);
  }
}

async function main() {
  const bunAvailable = await hasBun();

  if (bunAvailable) {
    // Use Bun (preferred)
    const child = spawn("bun", ["run", entryPoint], {
      stdio: "inherit",
      env: { ...process.env },
    });

    child.on("close", (code) => {
      process.exit(code ?? 0);
    });
  } else {
    // Fallback: try with tsx or node --loader
    console.error("╔═══════════════════════════════════════════════════════════╗");
    console.error("║  Bun runtime not found. Please install Bun:               ║");
    console.error("║  curl -fsSL https://bun.sh/install | bash                 ║");
    console.error("║                                                           ║");
    console.error("║  Or run directly with:                                    ║");
    console.error("║  bunx @simonblanco/kanban-mcp                             ║");
    console.error("╚═══════════════════════════════════════════════════════════╝");
    process.exit(1);
  }
}

main();
