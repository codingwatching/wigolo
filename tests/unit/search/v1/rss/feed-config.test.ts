import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadFeedConfig } from '../../../../../src/search/core/rss/feed-config.js';
import { resetConfig } from '../../../../../src/config.js';

const ORIG_ENV = process.env.WIGOLO_RSS_FEEDS;

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), 'wigolo-feed-cfg-'));
}

describe('loadFeedConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkTmp();
    delete process.env.WIGOLO_RSS_FEEDS;
    resetConfig();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (ORIG_ENV === undefined) delete process.env.WIGOLO_RSS_FEEDS;
    else process.env.WIGOLO_RSS_FEEDS = ORIG_ENV;
    resetConfig();
  });

  it('returns empty when nothing configured and no file', () => {
    const r = loadFeedConfig({ dataDir: dir });
    expect(r.feeds).toEqual([]);
    expect(r.sources).toEqual([]);
  });

  it('loads env feeds (2 urls, comma separated)', () => {
    process.env.WIGOLO_RSS_FEEDS = 'https://example.com/a.xml,https://example.com/b.xml';
    const r = loadFeedConfig({ dataDir: dir });
    expect(r.feeds.map((f) => f.url)).toEqual([
      'https://example.com/a.xml',
      'https://example.com/b.xml',
    ]);
    expect(r.sources).toEqual(['env']);
  });

  it('loads file feeds (3 entries)', () => {
    const entries = [
      { url: 'https://a.example.com/feed' },
      { url: 'https://b.example.com/feed', category: 'devops' },
      { url: 'https://c.example.com/feed', intervalSec: 600 },
    ];
    writeFileSync(join(dir, 'rss-feeds.json'), JSON.stringify(entries));
    const r = loadFeedConfig({ dataDir: dir });
    expect(r.feeds).toHaveLength(3);
    expect(r.sources).toEqual(['file']);
    expect(r.feeds.find((f) => f.url.startsWith('https://b'))?.category).toBe('devops');
    expect(r.feeds.find((f) => f.url.startsWith('https://c'))?.intervalSec).toBe(600);
  });

  it('merges env and file, env wins on URL collision, dedups', () => {
    process.env.WIGOLO_RSS_FEEDS = 'https://shared.example.com/feed,https://only-env.example.com/feed';
    const entries = [
      { url: 'https://shared.example.com/feed', category: 'file-says' },
      { url: 'https://only-file.example.com/feed' },
    ];
    writeFileSync(join(dir, 'rss-feeds.json'), JSON.stringify(entries));

    const r = loadFeedConfig({ dataDir: dir });
    const urls = r.feeds.map((f) => f.url).sort();
    expect(urls).toEqual([
      'https://only-env.example.com/feed',
      'https://only-file.example.com/feed',
      'https://shared.example.com/feed',
    ]);
    // env entry has no category → file's category is overridden
    const shared = r.feeds.find((f) => f.url === 'https://shared.example.com/feed');
    expect(shared?.category).toBeUndefined();
    expect(r.sources).toEqual(['env', 'file']);
  });

  it('drops invalid URLs from env silently', () => {
    process.env.WIGOLO_RSS_FEEDS = 'not-a-url,https://good.example.com/feed,ftp://bad.example.com';
    const r = loadFeedConfig({ dataDir: dir });
    expect(r.feeds.map((f) => f.url)).toEqual(['https://good.example.com/feed']);
  });

  it('missing file does not throw and returns env-only', () => {
    process.env.WIGOLO_RSS_FEEDS = 'https://env.example.com/feed';
    const r = loadFeedConfig({ dataDir: dir });
    expect(r.feeds).toHaveLength(1);
    expect(r.sources).toEqual(['env']);
  });

  it('malformed JSON does not throw, falls back to env only', () => {
    process.env.WIGOLO_RSS_FEEDS = 'https://env.example.com/feed';
    writeFileSync(join(dir, 'rss-feeds.json'), '{{ not valid json');
    const r = loadFeedConfig({ dataDir: dir });
    expect(r.feeds).toHaveLength(1);
    expect(r.feeds[0].url).toBe('https://env.example.com/feed');
  });

  it('preserves intervalSec from file through merge', () => {
    const entries = [{ url: 'https://x.example.com/feed', intervalSec: 120 }];
    writeFileSync(join(dir, 'rss-feeds.json'), JSON.stringify(entries));
    const r = loadFeedConfig({ dataDir: dir });
    expect(r.feeds[0].intervalSec).toBe(120);
  });
});
