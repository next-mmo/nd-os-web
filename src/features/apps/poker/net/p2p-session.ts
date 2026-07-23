import Peer, { type DataConnection } from "peerjs";
import type { ClientMessage, HostMessage, NetMessage } from "./protocol";

export type P2pRole = "host" | "guest" | null;

type Handlers = {
  onOpen?: (peerId: string) => void;
  onConnection?: (peerId: string) => void;
  onDisconnect?: (peerId: string) => void;
  onMessage?: (peerId: string, message: NetMessage) => void;
  onError?: (message: string) => void;
};

/**
 * Thin PeerJS wrapper. Signaling uses the public PeerJS cloud;
 * all poker logic stays in the host browser.
 */
export class P2pSession {
  private peer: Peer | null = null;
  private connections = new Map<string, DataConnection>();
  private handlers: Handlers;
  role: P2pRole = null;
  peerId: string | null = null;

  constructor(handlers: Handlers = {}) {
    this.handlers = handlers;
  }

  async host(): Promise<string> {
    this.destroy();
    this.role = "host";
    const peer = await this.createPeer();
    peer.on("connection", (conn) => this.attachConnection(conn));
    return peer.id;
  }

  async join(hostId: string): Promise<string> {
    this.destroy();
    this.role = "guest";
    const peer = await this.createPeer();
    const conn = peer.connect(hostId, { reliable: true });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Join timed out")), 8_000);
      conn.on("open", () => {
        clearTimeout(t);
        resolve();
      });
      conn.on("error", (err) => {
        clearTimeout(t);
        reject(err);
      });
    });
    this.attachConnection(conn);
    return peer.id;
  }

  send(peerId: string, message: NetMessage): void {
    const conn = this.connections.get(peerId);
    if (!conn?.open) return;
    conn.send(message);
  }

  broadcast(message: HostMessage): void {
    for (const id of this.connections.keys()) this.send(id, message);
  }

  sendToHost(message: ClientMessage): void {
    if (this.role !== "guest") return;
    const hostId = [...this.connections.keys()][0];
    if (hostId) this.send(hostId, message);
  }

  destroy(): void {
    for (const conn of this.connections.values()) conn.close();
    this.connections.clear();
    this.peer?.destroy();
    this.peer = null;
    this.peerId = null;
    this.role = null;
  }

  private createPeer(timeoutMs = 8_000): Promise<Peer> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const peer = new Peer({ debug: 0 });
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        fn();
      };
      const t = setTimeout(() => {
        try {
          peer.destroy();
        } catch {
          /* ignore */
        }
        finish(() => reject(new Error("PeerJS failed to open")));
      }, timeoutMs);
      peer.on("open", (id) => {
        finish(() => {
          this.peer = peer;
          this.peerId = id;
          this.handlers.onOpen?.(id);
          resolve(peer);
        });
      });
      peer.on("error", (err) => {
        try {
          peer.destroy();
        } catch {
          /* ignore */
        }
        finish(() => {
          this.handlers.onError?.(err.message);
          reject(err);
        });
      });
    });
  }

  private attachConnection(conn: DataConnection): void {
    this.connections.set(conn.peer, conn);
    conn.on("open", () => this.handlers.onConnection?.(conn.peer));
    if (conn.open) this.handlers.onConnection?.(conn.peer);
    conn.on("data", (data) => {
      this.handlers.onMessage?.(conn.peer, data as NetMessage);
    });
    conn.on("close", () => {
      this.connections.delete(conn.peer);
      this.handlers.onDisconnect?.(conn.peer);
    });
    conn.on("error", (err) => this.handlers.onError?.(err.message));
  }
}
