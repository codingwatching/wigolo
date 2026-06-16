import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { createLogger } from '../logger.js';

/**
 * Per-session WebSocket fan-out for the Studio host. The daemon authorizes the
 * upgrade (Origin/Host + subprotocol bearer) and hands us the socket; we
 * complete the handshake, key the client by the session id in its path
 * (`/studio/<sessionId>/stream`), and track it for frame broadcast. Frame
 * forwarding + inbound input/control routing attach in slices 1b/1c.
 *
 * Liveness: a half-open TCP (killed tab, dropped network with no FIN/RST) never
 * surfaces as `close`/`error`, so a ping/pong heartbeat reaps dead clients —
 * without it they leak in the client set and `broadcast` writes to dead sockets
 * forever. `onAttach`/`onDetach` let the host keep the Session's client count
 * accurate (it backs idle-eviction) for every connect AND every disconnect,
 * graceful or not.
 */

const log = createLogger('studio');

const STREAM_PATH = /^\/studio\/([^/]+)\/stream\/?$/;
const DEFAULT_HEARTBEAT_MS = 30_000;

export interface StudioWsHubOptions {
  /** Ping/pong sweep interval; a client that misses a sweep is terminated. */
  heartbeatIntervalMs?: number;
  /** Called once when a client attaches (host wires this to Session.attach). */
  onAttach?: (sessionId: string) => void;
  /** Called once when a client detaches — graceful close, error, or heartbeat reap. */
  onDetach?: (sessionId: string) => void;
}

export class StudioWsHub {
  // handleProtocols returns false so the bearer the client offered in
  // Sec-WebSocket-Protocol is NOT echoed back in the 101 response (keeping the
  // token off the wire in the response / out of any proxy access log).
  private readonly wss = new WebSocketServer({ noServer: true, handleProtocols: () => false });
  private readonly clients = new Map<string, Set<WebSocket>>();
  private readonly alive = new WeakMap<WebSocket, boolean>();
  private readonly onAttach?: (sessionId: string) => void;
  private readonly onDetach?: (sessionId: string) => void;
  private readonly heartbeat: ReturnType<typeof setInterval>;

  constructor(opts: StudioWsHubOptions = {}) {
    this.onAttach = opts.onAttach;
    this.onDetach = opts.onDetach;
    this.heartbeat = setInterval(() => this.heartbeatTick(), opts.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS);
    // Don't let the heartbeat keep the process alive on its own.
    if (typeof this.heartbeat.unref === 'function') this.heartbeat.unref();
  }

  /** Complete an authorized upgrade and register the client under its session id. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const sessionId = this.parseSessionId(req.url);
    if (!sessionId) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.alive.set(ws, true);
      ws.on('pong', () => this.alive.set(ws, true));
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

  /** Disconnect every client and stop the heartbeat (host shutdown). */
  closeAll(): void {
    clearInterval(this.heartbeat);
    for (const set of this.clients.values()) {
      for (const ws of set) ws.close();
    }
    this.clients.clear();
    this.wss.close();
  }

  /** Ping every client; terminate any that missed the previous sweep (no pong since). */
  private heartbeatTick(): void {
    for (const set of this.clients.values()) {
      for (const ws of [...set]) {
        if (this.alive.get(ws) === false) {
          ws.terminate(); // fires 'close' → unregister → onDetach
          continue;
        }
        this.alive.set(ws, false);
        try {
          ws.ping();
        } catch {
          /* socket already gone; the close/error handler will unregister */
        }
      }
    }
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
    if (set.has(ws)) return;
    set.add(ws);
    log.debug('studio ws client connected', { sessionId, clients: set.size });
    this.onAttach?.(sessionId);
  }

  private unregister(sessionId: string, ws: WebSocket): void {
    const set = this.clients.get(sessionId);
    if (!set || !set.delete(ws)) return; // only fire onDetach once, even if close + error both fire
    const remaining = set.size;
    if (remaining === 0) this.clients.delete(sessionId);
    log.debug('studio ws client disconnected', { sessionId, clients: remaining });
    this.onDetach?.(sessionId);
  }

  private send(ws: WebSocket, message: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }
}
