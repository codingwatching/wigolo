import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { StudioWsHub } from '../../../src/studio/ws-hub.js';

/**
 * Drive the hub over a real loopback WebSocket — the hub completes the handshake
 * and tracks clients, which a fake socket can't exercise honestly. Auth is the
 * daemon's job (tested in http-server.test.ts), so the hub server here is
 * unauthenticated: this isolates hub behavior. No browser involved.
 */
type Hub = Awaited<ReturnType<typeof startHub>>;
const open: Hub[] = [];

async function startHub() {
  const hub = new StudioWsHub();
  const server = createServer();
  server.on('upgrade', (req, socket, head) => hub.handleUpgrade(req, socket, head));
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
  const h = {
    hub,
    url: (path: string) => `ws://127.0.0.1:${port}${path}`,
    close: async () => { hub.closeAll(); await new Promise<void>((r) => server.close(() => r())); },
  };
  open.push(h);
  return h;
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
