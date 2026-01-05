import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import type { Board, Task, Column, BoardStats } from "./types";

// Resolver path absoluto al directorio data (relativo al módulo, no al cwd)
const __dirname = dirname(import.meta.path);
const DATA_DIR = join(__dirname, "..", "data");
const DATA_PATH = join(DATA_DIR, "kanban.json");

/**
 * KanbanStore - Capa de persistencia para el tablero Kanban
 * Mantiene los datos en memoria y los sincroniza con un archivo JSON
 */
class KanbanStore {
  private board: Board = {
    tasks: [],
    lastModified: new Date().toISOString(),
  };

  /**
   * Carga los datos desde el archivo JSON (o crea uno nuevo si no existe)
   */
  async load(): Promise<void> {
    // Crear directorio data si no existe
    if (!existsSync(DATA_DIR)) {
      await mkdir(DATA_DIR, { recursive: true });
    }

    if (existsSync(DATA_PATH)) {
      try {
        const data = await readFile(DATA_PATH, "utf-8");
        this.board = JSON.parse(data);
        console.error(`[Store] Loaded ${this.board.tasks.length} tasks from ${DATA_PATH}`);
      } catch (error) {
        console.error("[Store] Error loading data, starting fresh:", error);
        await this.persist();
      }
    } else {
      console.error("[Store] No existing data, creating new board");
      await this.persist();
    }
  }

  /**
   * Persiste los datos actuales al archivo JSON
   */
  async persist(): Promise<void> {
    this.board.lastModified = new Date().toISOString();
    await writeFile(DATA_PATH, JSON.stringify(this.board, null, 2));
  }

  /**
   * Obtiene el estado completo del tablero
   */
  getBoard(): Board {
    return this.board;
  }

  /**
   * Obtiene tareas con filtros opcionales
   */
  getTasks(filter?: { column?: Column; assignee?: string }): Task[] {
    let tasks = this.board.tasks;

    if (filter?.column) {
      tasks = tasks.filter((t) => t.column === filter.column);
    }

    if (filter?.assignee) {
      tasks = tasks.filter((t) => t.assignee === filter.assignee);
    }

    return tasks;
  }

  /**
   * Obtiene una tarea por ID
   */
  getTask(id: string): Task | undefined {
    return this.board.tasks.find((t) => t.id === id);
  }

  /**
   * Añade una nueva tarea al tablero
   */
  addTask(task: Task): void {
    this.board.tasks.push(task);
  }

  /**
   * Actualiza una tarea existente
   * @returns La tarea actualizada o null si no se encontró
   */
  updateTask(id: string, updates: Partial<Omit<Task, "id" | "createdAt">>): Task | null {
    const task = this.getTask(id);
    if (!task) return null;

    Object.assign(task, updates, { updatedAt: new Date().toISOString() });
    return task;
  }

  /**
   * Elimina una tarea del tablero
   * @returns true si se eliminó, false si no existía
   */
  deleteTask(id: string): boolean {
    const index = this.board.tasks.findIndex((t) => t.id === id);
    if (index === -1) return false;

    this.board.tasks.splice(index, 1);
    return true;
  }

  /**
   * Obtiene estadísticas del tablero
   */
  getStats(): BoardStats {
    const tasks = this.board.tasks;
    return {
      backlog: tasks.filter((t) => t.column === "backlog").length,
      in_progress: tasks.filter((t) => t.column === "in_progress").length,
      blocked: tasks.filter((t) => t.column === "blocked").length,
      done: tasks.filter((t) => t.column === "done").length,
      total: tasks.length,
      unassigned: tasks.filter((t) => !t.assignee).length,
    };
  }
}

// Singleton instance
export const store = new KanbanStore();
