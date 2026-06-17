import { describe, it, expect } from 'vitest';
import { StudioEventQueue } from '../../../src/studio/event-queue.js';

describe('StudioEventQueue — exactly-once delivery via cursor-ack (CEO trap a)', () => {
  it('drains events after the cursor and reports the new high-water cursor', () => {
    const q = new StudioEventQueue(100);
    q.enqueue({ type: 'navigation', url: 'https://a.example' });
    q.enqueue({ type: 'navigation', url: 'https://b.example' });
    const d = q.drainSince(0);
    expect(d.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(d.events.map((e) => e.url)).toEqual(['https://a.example', 'https://b.example']);
    expect(d.cursor).toBe(2);
    expect(d.dropped).toBe(0);
  });

  it('does NOT lose events until the cursor advances — a re-drain at the same cursor replays (proxy-failure safe)', () => {
    const q = new StudioEventQueue(100);
    q.enqueue({ type: 'navigation', url: 'x' });
    q.enqueue({ type: 'navigation', url: 'y' });
    expect(q.drainSince(0).events.map((e) => e.seq)).toEqual([1, 2]); // first delivery
    expect(q.drainSince(0).events.map((e) => e.seq)).toEqual([1, 2]); // response lost → re-drain replays, no loss
    expect(q.drainSince(2).events).toEqual([]); // cursor advanced (ack) → trimmed, exactly-once
  });

  it('only returns events newer than the acked cursor; trims the acked ones', () => {
    const q = new StudioEventQueue(100);
    q.enqueue({ type: 'navigation', url: 'a' });
    q.enqueue({ type: 'navigation', url: 'b' });
    expect(q.drainSince(0).cursor).toBe(2);
    q.enqueue({ type: 'navigation', url: 'c' });
    const d = q.drainSince(2); // ack 1,2
    expect(d.events.map((e) => e.url)).toEqual(['c']); // only the new one
    expect(d.cursor).toBe(3);
    expect(q.pending).toBe(1); // 1,2 trimmed
  });

  it('is bounded and FAIL-LOUD on overflow: oldest dropped, dropped count surfaced once', () => {
    const q = new StudioEventQueue(3);
    for (let i = 1; i <= 5; i++) q.enqueue({ type: 'navigation', url: 'u' + i });
    const d = q.drainSince(0);
    expect(d.events.map((e) => e.seq)).toEqual([3, 4, 5]); // oldest 2 dropped
    expect(d.dropped).toBe(2); // surfaced so the consumer can force a full resync
    expect(q.drainSince(5).dropped).toBe(0); // reset after report
  });
});
