import { describe, it, expect, vi } from 'vitest';
import { FrameSink } from './frame-sink.js';

/** A draw whose completion the test controls, so paint timing (and thus busy/coalesce/ack) is deterministic. */
function deferredDraw() {
  const resolvers: Array<() => void> = [];
  const draw = vi.fn((_uri: string) => new Promise<void>((resolve) => resolvers.push(resolve)));
  return { draw, flushOne: () => resolvers.shift()?.(), pending: () => resolvers.length };
}

describe('FrameSink (S4)', () => {
  it('paints a frame then ACKs (lock-step pacing)', async () => {
    const { draw, flushOne } = deferredDraw();
    const sendAck = vi.fn();
    const sink = new FrameSink({ draw, sendAck });
    expect(sink.onFrame('AAAA')).toBe(true);
    expect(draw).toHaveBeenCalledWith('data:image/jpeg;base64,AAAA');
    expect(sendAck).not.toHaveBeenCalled(); // not yet painted
    flushOne();
    await Promise.resolve();
    expect(sendAck).toHaveBeenCalledOnce();
    expect(sink.painted).toBe(1);
  });

  it('coalesces under load — only the newest queued frame paints while one is in flight', async () => {
    const { draw, flushOne } = deferredDraw();
    const sendAck = vi.fn();
    const sink = new FrameSink({ draw, sendAck });
    sink.onFrame('f1'); // starts painting (busy)
    sink.onFrame('f2'); // queued
    sink.onFrame('f3'); // replaces f2 in the queue (f2 dropped)
    expect(sink.dropped).toBe(1); // f2 coalesced away
    flushOne(); // f1 done → promotes f3
    await Promise.resolve();
    flushOne(); // f3 done
    await Promise.resolve();
    expect(draw).toHaveBeenCalledWith('data:image/jpeg;base64,f1');
    expect(draw).toHaveBeenCalledWith('data:image/jpeg;base64,f3');
    expect(draw).not.toHaveBeenCalledWith('data:image/jpeg;base64,f2');
    expect(sink.painted).toBe(2); // f1 + f3, ack each
    expect(sendAck).toHaveBeenCalledTimes(2);
  });

  // PIN-S4 (backpressure threshold): a frame that would push buffered bytes past the ceiling is DROPPED.
  // NAMED mutation that REDs: raise maxBufferedBytes to Infinity (or remove the `> max` check) → the frame
  // is admitted, dropped stays 0, and this assertion fails.
  it('PIN-S4: drops a frame that would exceed the client backpressure ceiling', () => {
    const { draw } = deferredDraw(); // never resolves → first frame stays in flight
    const sink = new FrameSink({ draw, sendAck: vi.fn(), maxBufferedBytes: 100 });
    expect(sink.onFrame('x'.repeat(60))).toBe(true); // 60 buffered, in flight
    expect(sink.onFrame('x'.repeat(60))).toBe(false); // 60+60 > 100 → dropped
    expect(sink.dropped).toBe(1);
  });

  // PIN-S4 (ack): exactly one ack per painted frame. NAMED mutation that REDs: remove the sendAck() call in
  // paint() → the host never advances and this count is 0.
  it('PIN-S4: sends exactly one ack per painted frame', async () => {
    const { draw, flushOne } = deferredDraw();
    const sendAck = vi.fn();
    const sink = new FrameSink({ draw, sendAck });
    sink.onFrame('a');
    flushOne();
    await Promise.resolve();
    expect(sendAck).toHaveBeenCalledTimes(1);
  });
});
