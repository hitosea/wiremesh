type SSEConnection = {
  nodeId: number;
  controller: ReadableStreamDefaultController;
  connectedAt: Date;
};

class SSEManager {
  private connections = new Map<number, SSEConnection>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      const ping = new TextEncoder().encode(": ping\n\n");
      for (const [nodeId, conn] of this.connections) {
        try {
          conn.controller.enqueue(ping);
        } catch {
          this.connections.delete(nodeId);
        }
      }
    }, 30_000);
  }

  addConnection(nodeId: number, controller: ReadableStreamDefaultController): void {
    const existing = this.connections.get(nodeId);
    if (existing) {
      try {
        existing.controller.close();
      } catch {
        // already closed
      }
    }
    this.connections.set(nodeId, { nodeId, controller, connectedAt: new Date() });
  }

  removeConnection(nodeId: number): void {
    const existing = this.connections.get(nodeId);
    if (existing) {
      try {
        existing.controller.close();
      } catch {
        // already closed
      }
      this.connections.delete(nodeId);
    }
  }

  sendEvent(nodeId: number, event: string, data?: unknown): boolean {
    const conn = this.connections.get(nodeId);
    if (!conn) return false;
    try {
      const payload = data !== undefined ? JSON.stringify(data) : "";
      const message = `event: ${event}\ndata: ${payload}\n\n`;
      conn.controller.enqueue(new TextEncoder().encode(message));
      return true;
    } catch {
      this.connections.delete(nodeId);
      return false;
    }
  }

  broadcast(nodeIds: number[], event: string, data?: unknown): void {
    for (const nodeId of nodeIds) {
      this.sendEvent(nodeId, event, data);
    }
  }

  isConnected(nodeId: number): boolean {
    return this.connections.has(nodeId);
  }

  getConnectedNodeIds(): number[] {
    return Array.from(this.connections.keys());
  }

  notifyNodePeerUpdate(nodeId: number): boolean {
    return this.sendEvent(nodeId, "peer_update");
  }

  notifyNodeConfigUpdate(nodeId: number): boolean {
    return this.sendEvent(nodeId, "config_update");
  }

  notifyNodeTunnelUpdate(nodeId: number): boolean {
    return this.sendEvent(nodeId, "tunnel_update");
  }
}

// Singleton stored on globalThis to survive Next.js hot reload
const globalForSSE = globalThis as typeof globalThis & { sseManager?: SSEManager };
if (!globalForSSE.sseManager) {
  globalForSSE.sseManager = new SSEManager();
}

export const sseManager = globalForSSE.sseManager;
