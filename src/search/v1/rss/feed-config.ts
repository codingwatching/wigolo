import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getConfig } from '../../../config.js';
import { createLogger } from '../../../logger.js';

const log = createLogger('search');

export interface FeedConfig {
  url: string;
  /** Optional category override; defaults to 'news'. */
  category?: string;
  /** Override poll interval per feed in seconds. */
  intervalSec?: number;
}

export interface LoadFeedConfigResult {
  feeds: FeedConfig[];
  /** Where feeds came from. */
  sources: Array<'env' | 'file'>;
}

function isValidUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function loadEnvFeeds(): FeedConfig[] {
  const raw = process.env.WIGOLO_RSS_FEEDS;
  if (!raw) return [];
  const out: FeedConfig[] = [];
  for (const piece of raw.split(',')) {
    const url = piece.trim();
    if (!url) continue;
    if (!isValidUrl(url)) {
      log.warn('invalid RSS feed URL in env', { url });
      continue;
    }
    out.push({ url });
  }
  return out;
}

interface FileEntry {
  url?: unknown;
  category?: unknown;
  intervalSec?: unknown;
}

function loadFileFeeds(dataDir: string): FeedConfig[] {
  const path = join(dataDir, 'rss-feeds.json');
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    log.warn('could not read rss-feeds.json', {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn('malformed rss-feeds.json — ignoring', {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  if (!Array.isArray(parsed)) {
    log.warn('rss-feeds.json must be an array — ignoring', { path });
    return [];
  }

  const out: FeedConfig[] = [];
  for (const entry of parsed as FileEntry[]) {
    if (!entry || typeof entry !== 'object') continue;
    const url = typeof entry.url === 'string' ? entry.url.trim() : '';
    if (!url || !isValidUrl(url)) {
      log.warn('invalid RSS feed URL in rss-feeds.json', { url });
      continue;
    }
    const feed: FeedConfig = { url };
    if (typeof entry.category === 'string' && entry.category.length > 0) {
      feed.category = entry.category;
    }
    if (typeof entry.intervalSec === 'number' && isFinite(entry.intervalSec) && entry.intervalSec > 0) {
      feed.intervalSec = entry.intervalSec;
    }
    out.push(feed);
  }
  return out;
}

/**
 * Load feeds from env (`WIGOLO_RSS_FEEDS` — comma-separated URLs) and
 * JSON file (`<dataDir>/rss-feeds.json`). Env entries win on URL collision.
 * Dedup by URL.
 */
export function loadFeedConfig(opts?: { dataDir?: string }): LoadFeedConfigResult {
  const dataDir = opts?.dataDir ?? getConfig().dataDir;
  const envFeeds = loadEnvFeeds();
  const fileFeeds = loadFileFeeds(dataDir);

  const sources: Array<'env' | 'file'> = [];
  if (envFeeds.length > 0) sources.push('env');
  if (fileFeeds.length > 0) sources.push('file');

  const byUrl = new Map<string, FeedConfig>();
  for (const f of fileFeeds) byUrl.set(f.url, f);
  for (const f of envFeeds) byUrl.set(f.url, f); // env wins

  return { feeds: Array.from(byUrl.values()), sources };
}
