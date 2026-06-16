import { describe, it, expect, afterEach } from 'vitest';
import { createServer, request } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { StudioWsHub, type StudioWsHubOptions } from '../../../src/studio/ws-hub.js';
import { SessionRegistry } from '../../../src/studio/registry.js';

/**
 * Drive the hub over a real loopback WebSocket — the hub completes the handshake
 * and tracks clients, which a fake socket can't exercise honestly. Auth is the
 * daemon's job (tested in http-server.test.ts), so the hub server here is
 * unauthenticated: this isolates hub behavior. No browser involved.
 */
type Hub = Awaited<ReturnType<typeof startHub>>;
const open: Hub[] = [];

async function startHub(opts: StudioWsHubOptions = {}) {
  const hub = new StudioWsHub(opts);
  const server = createServer();
  server.on('upgrade', (req, socket, head) => hub.handleUpgrade(req, socket, head));
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
  const h = {
    hub,
    port,
    url: (path: string) => `ws://127.0.0.1:${port}${path}`,
    close: async () => { hub.closeAll(); await new Promise<void>((r) => server.close(() => r())); },
  };
  open.push(h);
  return h;
}

/** Raw WebSocket handshake — returns the 101 response's negotiated subprotocol header (or undefined). */
function rawUpgrade(port: number, path: string, offeredProtocol: string): Promise<{ statusCode: number; protocolHeader: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        'Sec-WebSocket-Protocol': offeredProtocol,
      },
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve({ statusCode: res.statusCode ?? 0, protocolHeader: res.headers['sec-websocket-protocol'] as string | undefined });
    });
    req.on('response', (res) => {
      res.resume();
      resolve({ statusCode: res.statusCode ?? 0, protocolHeader: res.headers['sec-websocket-protocol'] as string | undefined });
    });
    req.on('error', reject);
    req.end();
  });
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => ws.once('message', (d: WebSocket.RawData) => resolve(JSON.parse(d.toString()))));
}

function waitFor(pred: () => boolean, ms = 1500): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (pred()) { clearInterval(iv); resolve(); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('waitFor timeout')); }
    }, 5);
  });
}

afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

describe('StudioWsHub', () => {
  it('registers a client by session id (from the path) and sends a hello on connect', async () => {
    const h = await startHub();
    const ws = new WebSocket(h.url('/studio/sess-1/stream'));
    const hello = await nextMessage(ws);
    expect(hello).toEqual({ t: 'hello', sessionId: 'sess-1' });
    expect(h.hub.clientCount('sess-1')).toBe(1);
    ws.close();
  });

  it('drops the client from the session on close', async () => {
    const h = await startHub();
    const ws = new WebSocket(h.url('/studio/sess-2/stream'));
    await nextMessage(ws);
    expect(h.hub.clientCount('sess-2')).toBe(1);
    ws.close();
    await waitFor(() => h.hub.clientCount('sess-2') === 0);
    expect(h.hub.clientCount('sess-2')).toBe(0);
  });

  it('broadcast() delivers a message to the session clients', async () => {
    const h = await startHub();
    const ws = new WebSocket(h.url('/studio/sess-3/stream'));
    await nextMessage(ws); // hello
    h.hub.broadcast('sess-3', { t: 'frame', data: 'abc' });
    const frame = await nextMessage(ws);
    expect(frame).toEqual({ t: 'frame', data: 'abc' });
    ws.close();
  });

  it('does not deliver a broadcast to a different session', async () => {
    const h = await startHub();
    const ws = new WebSocket(h.url('/studio/sess-A/stream'));
    await nextMessage(ws);
    // Broadcast to a session this client is not in — it must not arrive.
    let got = false;
    ws.on('message', () => { got = true; });
    h.hub.broadcast('sess-B', { t: 'frame', data: 'x' });
    await new Promise((r) => setTimeout(r, 50));
    expect(got).toBe(false);
    ws.close();
  });

  it('rejects an upgrade whose path has no session id (no registration)', async () => {
    const h = await startHub();
    const ws = new WebSocket(h.url('/not-a-studio-path'));
    let helloSeen = false;
    ws.on('message', () => { helloSeen = true; });
    await new Promise<void>((resolve) => { ws.on('error', () => resolve()); ws.on('close', () => resolve()); });
    expect(helloSeen).toBe(false);
    expect(h.hub.clientCount('not-a-studio-path')).toBe(0);
  });

  it('closeAll() disconnects connected clients', async () => {
    const h = await startHub();
    const ws = new WebSocket(h.url('/studio/sess-Z/stream'));
    await nextMessage(ws);
    const closed = new Promise<void>((resolve) => ws.on('close', () => resolve()));
    h.hub.closeAll();
    await closed; // resolves only if the server closed the socket
    expect(h.hub.clientCount('sess-Z')).toBe(0);
  });
});

describe('StudioWsHub — lifecycle / leak prevention', () => {
  it('removes a client on ungraceful socket destruction, not just a clean close', async () => {
    const h = await startHub();
    const ws = new WebSocket(h.url('/studio/ug/stream'));
    await nextMessage(ws);
    expect(h.hub.clientCount('ug')).toBe(1);
    ws.terminate(); // hard-kill the socket — no WS close handshake
    await waitFor(() => h.hub.clientCount('ug') === 0);
    expect(h.hub.clientCount('ug')).toBe(0);
  });

  it('reaps a half-open client that stops answering pings (heartbeat)', async () => {
    const h = await startHub({ heartbeatIntervalMs: 40 });
    const ws = new WebSocket(h.url('/studio/dead/stream'));
    await nextMessage(ws);
    expect(h.hub.clientCount('dead')).toBe(1);
    // Silence the client's outgoing frames so its automatic pong never reaches
    // the server — a true half-open peer the OS won't surface as close/error.
    (ws as unknown as { _socket: { write: () => boolean } })._socket.write = () => true;
    await waitFor(() => h.hub.clientCount('dead') === 0, 2000);
    expect(h.hub.clientCount('dead')).toBe(0);
  });

  it('does not reap a live client across heartbeat ticks', async () => {
    const h = await startHub({ heartbeatIntervalMs: 40 });
    const ws = new WebSocket(h.url('/studio/live/stream'));
    await nextMessage(ws);
    await new Promise((r) => setTimeout(r, 220)); // ~5 ticks; the client auto-pongs
    expect(h.hub.clientCount('live')).toBe(1);
    ws.close();
  });

  it('invokes onAttach on connect and onDetach on disconnect, exactly once each', async () => {
    const attaches: string[] = [];
    const detaches: string[] = [];
    const h = await startHub({ onAttach: (id) => attaches.push(id), onDetach: (id) => detaches.push(id) });
    const ws = new WebSocket(h.url('/studio/acct/stream'));
    await nextMessage(ws);
    expect(attaches).toEqual(['acct']);
    ws.terminate(); // close + error may both fire — onDetach must still be once
    await waitFor(() => detaches.length >= 1);
    expect(detaches).toEqual(['acct']);
  });

  it('keeps the Session client count accurate across connect and ungraceful disconnect (concern 1, end-to-end)', async () => {
    // Wired exactly as the host wires it: onAttach/onDetach -> Session.attach/detach.
    const registry = new SessionRegistry();
    const session = registry.create({ endpoint: 'http://127.0.0.1:0', token: 'tok' });
    const h = await startHub({
      onAttach: (id) => registry.get(id)?.attach(),
      onDetach: (id) => registry.get(id)?.detach(),
    });
    const ws = new WebSocket(h.url(`/studio/${session.id}/stream`));
    await nextMessage(ws);
    expect(session.clients).toBe(1);
    ws.terminate(); // ungraceful — must still decrement so the session can idle-evict
    await waitFor(() => session.clients === 0);
    expect(session.clients).toBe(0);
  });

  it('does not echo the offered bearer subprotocol back in the 101 handshake response', async () => {
    // The bearer travels in the REQUEST's Sec-WebSocket-Protocol (how the client
    // authenticates); finding A is that it must not be REFLECTED in the response.
    const h = await startHub();
    const res = await rawUpgrade(h.port, '/studio/np/stream', 'wigolo.bearer.super-secret-token');
    expect(res.statusCode).toBe(101); // upgrade still succeeds (browsers accept no negotiated subprotocol)
    expect(res.protocolHeader).toBeUndefined(); // bearer NOT echoed back on the wire
  });
});
