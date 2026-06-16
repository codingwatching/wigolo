import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { createLogger } from '../logger.js';

/**
 * Per-session WebSocket fan-out for the Studio host. The daemon authorizes the
 * upgrade (Origin/Host + subprotocol bearer) and hands us the socket; we
 * complete the handshake, key the client by the session id in its path
 * (`/studio/<sessionId>/stream`), and track it for frame broadcast. Frame
 * forwarding + inbound input/control routing attach in slices 1b/1c — Phase 1a
 * proves the transport (connect, hello, broadcast, clean teardown).
 */

const log = createLogger('studio');

const STREAM_PATH = /^\/studio\/([^/]+)\/stream\/?$/;

export class StudioWsHub {
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly clients = new Map<string, Set<WebSocket>>();

  /** Complete an authorized upgrade and register the client under its session id. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const sessionId = this.parseSessionId(req.url);
    if (!sessionId) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.register(sessionId, ws);
      ws.on('close', () => this.unregister(sessionId, ws));
      ws.on('error', () => this.unregister(sessionId, ws));
      // Register BEFORE hello so a client that acts on hello sees a live registration.
      this.send(ws, { t: 'hello', sessionId });
    });
  }

  clientCount(sessionId: string): number {
    return this.clients.get(sessionId)?.size ?? 0;
  }

  /** Send a message to every open client of a session (server → client). */
  broadcast(sessionId: string, message: Record<string, unknown>): void {
    const set = this.clients.get(sessionId);
    if (!set) return;
    const data = JSON.stringify(message);
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }

  /** Disconnect every client and stop accepting upgrades (host shutdown). */
  closeAll(): void {
    for (const set of this.clients.values()) {
      for (const ws of set) ws.close();
    }
    this.clients.clear();
    this.wss.close();
  }

  private parseSessionId(url: string | undefined): string | null {
    if (!url) return null;
    const m = STREAM_PATH.exec(url.split('?')[0]);
    return m ? m[1] : null;
  }

  private register(sessionId: string, ws: WebSocket): void {
    let set = this.clients.get(sessionId);
    if (!set) {
      set = new Set();
      this.clients.set(sessionId, set);
    }
    set.add(ws);
    log.debug('studio ws client connected', { sessionId, clients: set.size });
  }

  private unregister(sessionId: string, ws: WebSocket): void {
    const set = this.clients.get(sessionId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.clients.delete(sessionId);
    log.debug('studio ws client disconnected', { sessionId, clients: set.size });
  }

  private send(ws: WebSocket, message: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }
}
