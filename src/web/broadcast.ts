import type { ServerWebSocket } from "bun";
import type { WSEvent, WSEventType } from "../types";

/**
 * WebSocketBroadcaster - Gestiona las conexiones WebSocket y envía eventos a todos los clientes
 */
class WebSocketBroadcaster {
  private clients: Set<ServerWebSocket<unknown>> = new Set();

  /**
   * Registra un nuevo cliente WebSocket
   */
  addClient(ws: ServerWebSocket<unknown>): void {
    this.clients.add(ws);
    console.error(`[WS] Client connected. Total clients: ${this.clients.size}`);
  }

  /**
   * Elimina un cliente WebSocket
   */
  removeClient(ws: ServerWebSocket<unknown>): void {
    this.clients.delete(ws);
    console.error(`[WS] Client disconnected. Total clients: ${this.clients.size}`);
  }

  /**
   * Envía un evento a todos los clientes conectados
   */
  broadcast(type: WSEventType, payload: unknown): void {
    const message = JSON.stringify({
      type,
      payload,
      timestamp: new Date().toISOString(),
    } as WSEvent);

    let sent = 0;
    for (const client of this.clients) {
      try {
        client.send(message);
        sent++;
      } catch {
        // Cliente desconectado, lo eliminamos
        this.clients.delete(client);
      }
    }

    if (sent > 0) {
      console.error(`[WS] Broadcast '${type}' to ${sent} client(s)`);
    }
  }

  /**
   * Número de clientes conectados
   */
  get clientCount(): number {
    return this.clients.size;
  }
}

// Singleton instance
export const broadcaster = new WebSocketBroadcaster();
