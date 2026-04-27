type SSEConnection = {
  nodeId: number;
  controller: ReadableStreamDefaultController;
  connectedAt: Date;
};

class SSEManager {
  private connections = new Map<number, SSEConnection>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pendingNotifications = new Map<string, ReturnType<typeof setTimeout>>();

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

  private debouncedNotify(nodeId: number, event: string): boolean {
    const key = `${nodeId}:${event}`;
    const existing = this.pendingNotifications.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pendingNotifications.delete(key);
      this.sendEvent(nodeId, event);
    }, 2000);
    this.pendingNotifications.set(key, timer);
    return this.isConnected(nodeId);
  }

  notifyNodePeerUpdate(nodeId: number): boolean {
    return this.debouncedNotify(nodeId, "peer_update");
  }

  notifyNodeConfigUpdate(nodeId: number): boolean {
    return this.debouncedNotify(nodeId, "config_update");
  }

  notifyNodeTunnelUpdate(nodeId: number): boolean {
    return this.debouncedNotify(nodeId, "tunnel_update");
  }

  // Push config_update to every connected node except the optional excluded one.
  // Used when a node is added/removed/renamed so all peers refresh their mesh
  // peer list (and any other config that depends on the global node set).
  notifyAllConfigUpdate(excludeNodeId?: number): void {
    for (const id of this.getConnectedNodeIds()) {
      if (id === excludeNodeId) continue;
      this.debouncedNotify(id, "config_update");
    }
  }
}

// Singleton stored on globalThis to survive Next.js hot reload
const SSE_VERSION = 2;
const globalForSSE = globalThis as typeof globalThis & { sseManager?: SSEManager; sseVersion?: number };
if (!globalForSSE.sseManager || globalForSSE.sseVersion !== SSE_VERSION) {
  globalForSSE.sseManager = new SSEManager();
  globalForSSE.sseVersion = SSE_VERSION;
}

export const sseManager = globalForSSE.sseManager;
