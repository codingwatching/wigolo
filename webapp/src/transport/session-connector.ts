import { StreamConnection, type SocketLike, type ConnState } from './connection.js';

/**
 * Owns the ONE live stream connection and switches it between sessions (7f B3). The bearer is DAEMON-scoped —
 * one token authorizes every session on the daemon — so a switch REUSES the in-memory bearer and only changes
 * the `/studio/<id>/stream` path it subscribes to.
 *
 * Invariant: at most ONE live socket at a time. `connect()` STOPS the current connection before opening the new
 * one — never two live streams to two sessions (which would double-bill frames + input). The StreamConnection's
 * own reconnect/terminal/bounded-retry behavior is unchanged; the connector just rebinds it to a new session.
 */
export interface SessionConnectorDeps {
  /** The daemon-scoped bearer, reused verbatim across every session switch. */
  bearer: string;
  /** Open a stream socket for a given session, presenting the bearer (real: openStreamSocket(sessionId, bearer)). */
  openSocket: (sessionId: string, bearer: string) => SocketLike;
  /** Inbound message payloads (the WS event's `.data`) — wired to the codec parser by the caller. */
  onMessage: (data: unknown) => void;
  onState?: (state: ConnState) => void;
  /** Forwarded to each StreamConnection (tests). */
  schedule?: (fn: () => void, ms: number) => void;
  maxAttempts?: number;
}

export class SessionConnector {
  private conn: StreamConnection | null = null;
  private currentId: string | null = null;

  constructor(private readonly deps: SessionConnectorDeps) {}

  /** The session the live connection is currently bound to (null before the first connect). */
  get sessionId(): string | null {
    return this.currentId;
  }

  /** Connect to (or switch to) a session: tear down the current stream FIRST, then open the new one. */
  connect(sessionId: string): void {
    this.conn?.stop(); // stop the old socket BEFORE opening the new — never two live streams
    this.currentId = sessionId;
    this.conn = new StreamConnection({
      openSocket: (b) => this.deps.openSocket(sessionId, b),
      bearer: this.deps.bearer,
      onMessage: this.deps.onMessage,
      ...(this.deps.onState ? { onState: this.deps.onState } : {}),
      ...(this.deps.schedule ? { schedule: this.deps.schedule } : {}),
      ...(this.deps.maxAttempts !== undefined ? { maxAttempts: this.deps.maxAttempts } : {}),
    });
    this.conn.start();
  }

  /** Send a wire message on the current connection (no-op when none / not open). */
  send(wire: string): void {
    this.conn?.send(wire);
  }

  /** Tear down the current connection and stop reconnecting. */
  stop(): void {
    this.conn?.stop();
    this.conn = null;
  }
}
