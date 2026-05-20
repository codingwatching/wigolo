import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase } from '../../../../../src/cache/db.js';
import {
  upsertFeedItems,
  queryFeedStore,
  countFeedItems,
  _clearFeedStoreForTest,
} from '../../../../../src/search/v1/rss/feed-store.js';

const SAMPLES = [
  {
    feedUrl: 'https://a.example.com/feed',
    guid: 'a-1',
    title: 'AI breakthroughs in compilers',
    link: 'https://a.example.com/1',
    summary: 'Large language models help optimize generated code.',
    publishedDate: '2025-05-01T10:00:00.000Z',
  },
  {
    feedUrl: 'https://a.example.com/feed',
    guid: 'a-2',
    title: 'Database internals deep dive',
    link: 'https://a.example.com/2',
    summary: 'WAL and MVCC explained.',
    publishedDate: '2025-04-01T10:00:00.000Z',
  },
  {
    feedUrl: 'https://b.example.com/feed',
    guid: 'b-1',
    title: 'AI tooling roundup',
    link: 'https://b.example.com/1',
    summary: 'New IDE integrations and code review bots.',
    publishedDate: '2025-05-15T10:00:00.000Z',
    category: 'devops',
  },
];

describe('feed-store', () => {
  beforeEach(() => {
    initDatabase(':memory:');
    _clearFeedStoreForTest();
  });

  afterEach(() => {
    closeDatabase();
  });

  it('inserts 3 items and counts them', () => {
    const added = upsertFeedItems(SAMPLES);
    expect(added).toBe(3);
    expect(countFeedItems()).toBe(3);
  });

  it('returns 0 new on duplicate upsert; total unchanged', () => {
    upsertFeedItems(SAMPLES);
    const added = upsertFeedItems(SAMPLES);
    expect(added).toBe(0);
    expect(countFeedItems()).toBe(3);
  });

  it('FTS query matches across title and summary', () => {
    upsertFeedItems(SAMPLES);
    const r = queryFeedStore('AI');
    const ids = r.map((it) => it.guid).sort();
    expect(ids).toContain('a-1');
    expect(ids).toContain('b-1');
  });

  it('respects maxResults', () => {
    upsertFeedItems(SAMPLES);
    const r = queryFeedStore('AI', { maxResults: 1 });
    expect(r).toHaveLength(1);
  });

  it('filters by fromDate', () => {
    upsertFeedItems(SAMPLES);
    const r = queryFeedStore('AI', { fromDate: '2025-05-10T00:00:00.000Z' });
    expect(r.map((it) => it.guid)).toEqual(['b-1']);
  });

  it('filters by toDate', () => {
    upsertFeedItems(SAMPLES);
    const r = queryFeedStore('AI', { toDate: '2025-05-10T00:00:00.000Z' });
    expect(r.map((it) => it.guid)).toEqual(['a-1']);
  });

  it('filters by category', () => {
    upsertFeedItems(SAMPLES);
    const r = queryFeedStore('AI', { category: 'devops' });
    expect(r.map((it) => it.guid)).toEqual(['b-1']);
  });

  it('returns empty array on empty store', () => {
    expect(queryFeedStore('anything')).toEqual([]);
  });

  it('stores items missing publishedDate; FTS still returns them', () => {
    upsertFeedItems([
      {
        feedUrl: 'https://c.example.com/feed',
        guid: 'c-1',
        title: 'Undated note about widgets',
        link: 'https://c.example.com/1',
        summary: 'No date here.',
      },
    ]);
    const r = queryFeedStore('widgets');
    expect(r).toHaveLength(1);
    expect(r[0].publishedDate).toBeUndefined();
  });

  it('sanitizes FTS query safely (strips empty / quotes)', () => {
    upsertFeedItems(SAMPLES);
    const r = queryFeedStore('  AI ');
    expect(r.length).toBeGreaterThan(0);
  });
});
