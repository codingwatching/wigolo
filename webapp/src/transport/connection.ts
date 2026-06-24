/**
 * The stream connection state machine (S6).
 *
 * The session lives in the daemon, not the tab — so the tab is STATELESS and recovers from a dropped socket
 * by re-establishing from scratch: on close/error it RE-SUBSCRIBES (opens a fresh stream socket) with
 * backoff, presenting the bearer it holds IN MEMORY (never persisted to localStorage/cookie). A successful
 * open resets the backoff. Nothing about the connection is durable in the tab — a full reload starts over
 * from the one-time handshake.
 *
 * The socket factory + timer are injected so the reconnect logic is unit-testable without a real WebSocket
 * (jsdom has none).
 */

export type ConnState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'stopped';

/** The minimal socket surface this SM drives (the browser WebSocket satisfies it structurally). */
export interface SocketLike {
  addEventListener(type: 'open' | 'close' | 'message' | 'error', cb: (ev: unknown) => void): void;
  send(data: string): void;
  close(): void;
}

export interface StreamConnectionDeps {
  /** Open a fresh stream socket presenting the bearer via subprotocol (real: openStreamSocket(sessionId, bearer)). */
  openSocket: (bearer: string) => SocketLike;
  /** The session bearer — held IN MEMORY only, reused verbatim on every re-subscribe. */
  bearer: string;
  /** Inbound message payloads (already the WS event's `.data`) — wire to the codec parser. */
  onMessage: (data: unknown) => void;
  onState?: (state: ConnState) => void;
  /** Reconnect backoff (ms) by attempt index; default exponential capped at 15s. */
  backoffMs?: (attempt: number) => number;
  /** Schedule a reconnect (injected for tests); default setTimeout. */
  schedule?: (fn: () => void, ms: number) => void;
}

const DEFAULT_BACKOFF = (attempt: number): number => Math.min(1000 * 2 ** attempt, 15_000);

export class StreamConnection {
  private state: ConnState = 'idle';
  private attempt = 0;
  private socket: SocketLike | null = null;
  private stopped = false;
  private readonly backoffMs: (attempt: number) => number;
  private readonly schedule: (fn: () => void, ms: number) => void;

  constructor(private readonly deps: StreamConnectionDeps) {
    this.backoffMs = deps.backoffMs ?? DEFAULT_BACKOFF;
    this.schedule = deps.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
  }

  get currentState(): ConnState {
    return this.state;
  }

  /** Open the stream and keep it up — re-subscribing on every drop until stop(). */
  start(): void {
    this.stopped = false;
    this.open();
  }

  /** Tear down and stop reconnecting. */
  stop(): void {
    this.stopped = true;
    this.setState('stopped');
    this.socket?.close();
    this.socket = null;
  }

  /** Send a wire message to the host (no-op when not currently open). */
  send(data: string): void {
    this.socket?.send(data);
  }

  private open(): void {
    this.setState(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const socket = this.deps.openSocket(this.deps.bearer); // re-subscribe with the in-memory bearer
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.attempt = 0; // reset backoff on a healthy connection
      this.setState('open');
    });
    socket.addEventListener('message', (ev) => this.deps.onMessage((ev as { data: unknown }).data));
    socket.addEventListener('close', () => this.scheduleReconnect());
    socket.addEventListener('error', () => {
      /* a close event follows an error; reconnect is driven from close so we don't double-schedule */
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.setState('reconnecting');
    const delay = this.backoffMs(this.attempt++);
    this.schedule(() => {
      if (!this.stopped) this.open(); // fully re-establish: a brand-new socket subscription
    }, delay);
  }

  private setState(state: ConnState): void {
    this.state = state;
    this.deps.onState?.(state);
  }
}
