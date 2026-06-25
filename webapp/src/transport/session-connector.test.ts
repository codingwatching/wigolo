import { describe, it, expect, vi } from 'vitest';
import { SessionConnector } from './session-connector.js';
import type { SocketLike } from './connection.js';

/** A mock socket whose lifecycle events the test fires by hand. */
function mockSocket() {
  const handlers: Record<string, Array<(ev: unknown) => void>> = {};
  const socket: SocketLike = {
    addEventListener: (type, cb) => { (handlers[type] ??= []).push(cb as (ev: unknown) => void); },
    send: vi.fn(),
    close: vi.fn(),
  };
  return { socket, fire: (type: string, ev?: unknown) => (handlers[type] ?? []).forEach((h) => h(ev)) };
}

describe('SessionConnector (7f B3 switch)', () => {
  it('connect() opens a stream for the chosen session, reusing the daemon-scoped bearer', () => {
    const opened: Array<{ id: string; bearer: string }> = [];
    const connector = new SessionConnector({
      bearer: 'DAEMON-BEARER',
      openSocket: (id, b) => { opened.push({ id, bearer: b }); return mockSocket().socket; },
      onMessage: () => {},
      schedule: (fn) => fn(),
    });
    connector.connect('sess-1');
    expect(connector.sessionId).toBe('sess-1');
    expect(opened).toEqual([{ id: 'sess-1', bearer: 'DAEMON-BEARER' }]);
  });

  // PIN-C (no double-stream — the load-bearing switch invariant, through the real connect path). A switch must
  // STOP the old socket before opening the new, so there is never more than one live stream. NAMED mutation that
  // REDs against present+correct code: drop the `this.conn?.stop()` at the top of connect() (open-without-stopping)
  // → the old socket is never closed, so after a switch BOTH sockets are live (diverging value: 1 live socket → 2).
  it('PIN-C: switching sessions stops the old socket before opening the new — exactly one live socket after a switch', () => {
    const sockets: Array<ReturnType<typeof mockSocket>> = [];
    const connector = new SessionConnector({
      bearer: 'B',
      openSocket: (_id, _b) => { const m = mockSocket(); sockets.push(m); return m.socket; },
      onMessage: () => {},
      schedule: (fn) => fn(),
    });
    connector.connect('sess-1');
    sockets[0].fire('open');
    connector.connect('sess-2'); // switch
    sockets[1].fire('open');
    expect(sockets.length).toBe(2);
    // a socket is "live" iff its close() was never called
    const live = sockets.filter((m) => (m.socket.close as ReturnType<typeof vi.fn>).mock.calls.length === 0).length;
    expect(live).toBe(1); // only the new stream is live; the old was torn down first
    expect((sockets[0].socket.close as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0); // old stopped
    expect(connector.sessionId).toBe('sess-2');
  });

  it('reuses the SAME bearer across a switch (daemon-scoped — no re-mint on switch)', () => {
    const bearers: string[] = [];
    const connector = new SessionConnector({
      bearer: 'DAEMON-BEARER',
      openSocket: (_id, b) => { bearers.push(b); return mockSocket().socket; },
      onMessage: () => {},
      schedule: (fn) => fn(),
    });
    connector.connect('sess-1');
    connector.connect('sess-2');
    expect(bearers).toEqual(['DAEMON-BEARER', 'DAEMON-BEARER']);
  });
});
