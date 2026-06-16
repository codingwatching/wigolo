import { describe, it, expect, vi, afterEach } from 'vitest';
import { ScreencastBridge, type ScreencastFrame } from '../../../src/studio/screencast.js';

/**
 * A fake CDP session: records `send` calls and lets the test fire
 * `Page.screencastFrame` events, so the bridge's ack/drop logic is testable
 * without a real browser (the real CDP path is the RUN_STUDIO_HEADED test in 1b.3).
 */
function makeFakeCdp() {
  const sends: Array<{ method: string; params: Record<string, unknown> | undefined }> = [];
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const cdp = {
    send: async (method: string, params?: Record<string, unknown>) => {
      sends.push({ method, params });
      return {};
    },
    on: (e: string, cb: (p: never) => void) => {
      if (!listeners.has(e)) listeners.set(e, new Set());
      listeners.get(e)!.add(cb as (p: unknown) => void);
    },
    off: (e: string, cb: (p: never) => void) => {
      listeners.get(e)?.delete(cb as (p: unknown) => void);
    },
  };
  return {
    cdp,
    sends,
    emitFrame: (data: string, sessionId: number, metadata: Record<string, unknown> = {}) => {
      for (const cb of listeners.get('Page.screencastFrame') ?? []) cb({ data, sessionId, metadata });
    },
    frameListeners: () => listeners.get('Page.screencastFrame')?.size ?? 0,
    acks: () => sends.filter((s) => s.method === 'Page.screencastFrameAck'),
  };
}

const OPTS = { quality: 60, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1, ackTimeoutMs: 1000 };

describe('ScreencastBridge', () => {
  afterEach(() => vi.useRealTimers());

  it('start() begins a jpeg screencast with the configured params and subscribes to frames', async () => {
    const f = makeFakeCdp();
    const bridge = new ScreencastBridge({ cdp: f.cdp, sink: () => {}, ...OPTS });
    await bridge.start();
    const startCall = f.sends.find((s) => s.method === 'Page.startScreencast');
    expect(startCall?.params).toMatchObject({ format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
    expect(f.frameListeners()).toBe(1);
  });

  it('forwards a frame to the sink and acks CDP for that frame', async () => {
    const f = makeFakeCdp();
    const frames: ScreencastFrame[] = [];
    const bridge = new ScreencastBridge({ cdp: f.cdp, sink: (fr) => frames.push(fr), ...OPTS });
    await bridge.start();
    f.emitFrame('JPEGDATA', 7, { pageScaleFactor: 1, deviceWidth: 1280 });
    expect(frames).toEqual([{ data: 'JPEGDATA', metadata: { pageScaleFactor: 1, deviceWidth: 1280 } }]);
    expect(f.acks().some((s) => s.params?.sessionId === 7)).toBe(true);
  });

  it('drops a frame that arrives while the previous is unacked by the client (newest-held-wins), but still acks CDP', async () => {
    const f = makeFakeCdp();
    const frames: ScreencastFrame[] = [];
    const bridge = new ScreencastBridge({ cdp: f.cdp, sink: (fr) => frames.push(fr), ...OPTS });
    await bridge.start();
    f.emitFrame('A', 1); // forwarded (in-flight)
    f.emitFrame('B', 2); // held (not forwarded)
    f.emitFrame('C', 3); // replaces B as the newest held
    expect(frames.map((x) => x.data)).toEqual(['A']);
    expect(f.acks().length).toBe(3); // CDP acked all 3 so Chrome keeps capturing
    bridge.onClientAck(); // client caught up → forward the freshest held (C), not B
    expect(frames.map((x) => x.data)).toEqual(['A', 'C']);
  });

  it('unwedges via the ack timeout when the client never acks', async () => {
    vi.useFakeTimers();
    const f = makeFakeCdp();
    const frames: ScreencastFrame[] = [];
    const bridge = new ScreencastBridge({ cdp: f.cdp, sink: (fr) => frames.push(fr), ...OPTS, ackTimeoutMs: 100 });
    await bridge.start();
    f.emitFrame('A', 1); // forwarded, awaiting client ack
    f.emitFrame('B', 2); // held
    expect(frames.map((x) => x.data)).toEqual(['A']);
    vi.advanceTimersByTime(101); // client too slow → timeout releases the held frame
    expect(frames.map((x) => x.data)).toEqual(['A', 'B']);
  });

  it('stop() ends the screencast and ignores later frames', async () => {
    const f = makeFakeCdp();
    const frames: ScreencastFrame[] = [];
    const bridge = new ScreencastBridge({ cdp: f.cdp, sink: (fr) => frames.push(fr), ...OPTS });
    await bridge.start();
    await bridge.stop();
    expect(f.sends.some((s) => s.method === 'Page.stopScreencast')).toBe(true);
    expect(f.frameListeners()).toBe(0);
    f.emitFrame('late', 9); // no listener → ignored
    expect(frames).toEqual([]);
  });
});
