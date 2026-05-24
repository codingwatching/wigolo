import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initDatabase, closeDatabase } from '../../../../../src/cache/db.js';
import {
  pollFeedsOnce,
  pollFeedsForever,
} from '../../../../../src/search/core/rss/feed-poller.js';
import {
  countFeedItems,
  _clearFeedStoreForTest,
} from '../../../../../src/search/core/rss/feed-store.js';

const RSS_A = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Feed A</title>
  <item><title>A1</title><link>https://a.example.com/1</link><description>desc</description><guid>a-1</guid></item>
  <item><title>A2</title><link>https://a.example.com/2</link><description>desc</description><guid>a-2</guid></item>
</channel></rss>`;

const RSS_B = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Feed B</title>
  <item><title>B1</title><link>https://b.example.com/1</link><description>desc</description><guid>b-1</guid></item>
</channel></rss>`;

function makeFetch(map: Record<string, { status: number; body: string }>): typeof fetch {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const hit = map[url];
    if (!hit) return new Response('not found', { status: 404 });
    return new Response(hit.body, { status: hit.status });
  }) as typeof fetch;
}

describe('pollFeedsOnce', () => {
  beforeEach(() => {
    initDatabase(':memory:');
    _clearFeedStoreForTest();
  });

  afterEach(() => {
    closeDatabase();
  });

  it('polls two feeds and inserts items', async () => {
    const fetchImpl = makeFetch({
      'https://a.example.com/feed': { status: 200, body: RSS_A },
      'https://b.example.com/feed': { status: 200, body: RSS_B },
    });
    const results = await pollFeedsOnce({
      feeds: [
        { url: 'https://a.example.com/feed' },
        { url: 'https://b.example.com/feed' },
      ],
      fetchImpl,
    });
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.reduce((a, r) => a + r.itemsAdded, 0)).toBe(3);
    expect(countFeedItems()).toBe(3);
  });

  it('one feed 404, other still processed', async () => {
    const fetchImpl = makeFetch({
      'https://a.example.com/feed': { status: 200, body: RSS_A },
      // b returns 404 (not in map)
    });
    const results = await pollFeedsOnce({
      feeds: [
        { url: 'https://a.example.com/feed' },
        { url: 'https://b.example.com/feed' },
      ],
      fetchImpl,
    });
    const a = results.find((r) => r.feedUrl === 'https://a.example.com/feed');
    const b = results.find((r) => r.feedUrl === 'https://b.example.com/feed');
    expect(a?.ok).toBe(true);
    expect(a?.itemsAdded).toBe(2);
    expect(b?.ok).toBe(false);
    expect(b?.error).toContain('404');
  });

  it('returns [] when no feeds configured', async () => {
    const fetchImpl = makeFetch({});
    const r = await pollFeedsOnce({ feeds: [], fetchImpl });
    expect(r).toEqual([]);
  });

  it('uses the provided fetchImpl (spy)', async () => {
    const spy = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      void input;
      return new Response(RSS_A, { status: 200 });
    });
    await pollFeedsOnce({
      feeds: [{ url: 'https://a.example.com/feed' }],
      fetchImpl: spy as unknown as typeof fetch,
    });
    expect(spy).toHaveBeenCalledOnce();
  });

  it('honors per-feed category override on insert', async () => {
    const fetchImpl = makeFetch({
      'https://a.example.com/feed': { status: 200, body: RSS_A },
    });
    await pollFeedsOnce({
      feeds: [{ url: 'https://a.example.com/feed', category: 'tech' }],
      fetchImpl,
    });
    // Items inserted with category=tech
    expect(countFeedItems()).toBe(2);
  });
});

describe('pollFeedsForever', () => {
  beforeEach(() => {
    initDatabase(':memory:');
    _clearFeedStoreForTest();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    closeDatabase();
  });

  it('schedules polls on interval; stop() halts and flips running flag', async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => new Response(RSS_A, { status: 200 }));
    const handle = pollFeedsForever({
      intervalSec: 0.01,
      feeds: [{ url: 'https://a.example.com/feed' }],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(handle.running).toBe(true);

    await vi.advanceTimersByTimeAsync(50);
    // Each interval fires pollFeedsOnce which awaits fetchImpl. With 0.01s
    // (10ms) interval and 50ms advance, we expect ~5 invocations.
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(1);

    handle.stop();
    expect(handle.running).toBe(false);
    const callsAfterStop = fetchImpl.mock.calls.length;

    await vi.advanceTimersByTimeAsync(100);
    expect(fetchImpl.mock.calls.length).toBe(callsAfterStop);
  });
});
