type AdminSSEConnection = {
  id: number;
  controller: ReadableStreamDefaultController;
  connectedAt: Date;
};

class AdminSSEManager {
  private connections = new Map<number, AdminSSEConnection>();
  private nextId = 1;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      const ping = new TextEncoder().encode(": keepalive\n\n");
      for (const [id, conn] of this.connections) {
        try {
          conn.controller.enqueue(ping);
        } catch {
          this.connections.delete(id);
        }
      }
    }, 30_000);
  }

  addConnection(controller: ReadableStreamDefaultController): number {
    const id = this.nextId++;
    this.connections.set(id, { id, controller, connectedAt: new Date() });
    return id;
  }

  removeConnection(id: number): void {
    const conn = this.connections.get(id);
    if (conn) {
      try {
        conn.controller.close();
      } catch {
        // already closed
      }
      this.connections.delete(id);
    }
  }

  broadcast(event: string, data: unknown): void {
    const payload = JSON.stringify(data);
    const message = new TextEncoder().encode(`event: ${event}\ndata: ${payload}\n\n`);
    for (const [id, conn] of this.connections) {
      try {
        conn.controller.enqueue(message);
      } catch {
        this.connections.delete(id);
      }
    }
  }
}

const globalForAdminSSE = globalThis as typeof globalThis & { adminSseManager?: AdminSSEManager };
if (!globalForAdminSSE.adminSseManager) {
  globalForAdminSSE.adminSseManager = new AdminSSEManager();
}

export const adminSseManager = globalForAdminSSE.adminSseManager;
