import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initDatabase, closeDatabase } from '../../../../../src/cache/db.js';
import { RssFeedEngine } from '../../../../../src/search/core/rss/rss-engine.js';
import {
  upsertFeedItems,
  _clearFeedStoreForTest,
} from '../../../../../src/search/core/rss/feed-store.js';
import * as store from '../../../../../src/search/core/rss/feed-store.js';

describe('RssFeedEngine', () => {
  beforeEach(() => {
    initDatabase(':memory:');
    _clearFeedStoreForTest();
  });

  afterEach(() => {
    closeDatabase();
    vi.restoreAllMocks();
  });

  it('returns empty results on empty store', async () => {
    const engine = new RssFeedEngine();
    expect(await engine.search('anything')).toEqual([]);
  });

  it('returns mapped RawSearchResult[] for matching query', async () => {
    upsertFeedItems([
      {
        feedUrl: 'https://x.example.com/feed',
        guid: 'x-1',
        title: 'AI search techniques',
        link: 'https://x.example.com/1',
        summary: 'Hybrid retrieval combining BM25 and vector search.',
        publishedDate: '2025-04-01T10:00:00.000Z',
      },
    ]);
    const engine = new RssFeedEngine();
    const results = await engine.search('AI');
    expect(results).toHaveLength(1);
    expect(results[0].engine).toBe('rss-feed');
    expect(results[0].url).toBe('https://x.example.com/1');
    expect(results[0].title).toBe('AI search techniques');
    expect(results[0].published_date).toBe('2025-04-01T10:00:00.000Z');
    expect(results[0].snippet.length).toBeLessThanOrEqual(200);
    expect(results[0].relevance_score).toBeGreaterThan(0);
  });

  it('forwards date filters to queryFeedStore', async () => {
    const spy = vi.spyOn(store, 'queryFeedStore').mockReturnValue([]);
    const engine = new RssFeedEngine();
    await engine.search('q', { fromDate: '2025-01-01', toDate: '2025-12-31', maxResults: 5 });
    expect(spy).toHaveBeenCalledWith('q', {
      maxResults: 5,
      fromDate: '2025-01-01',
      toDate: '2025-12-31',
    });
  });

  it('omits published_date when item lacks one', async () => {
    upsertFeedItems([
      {
        feedUrl: 'https://x.example.com/feed',
        guid: 'x-2',
        title: 'Undated AI piece',
        link: 'https://x.example.com/2',
        summary: 'no date',
      },
    ]);
    const engine = new RssFeedEngine();
    const results = await engine.search('Undated');
    expect(results).toHaveLength(1);
    expect(results[0].published_date).toBeUndefined();
  });
});
