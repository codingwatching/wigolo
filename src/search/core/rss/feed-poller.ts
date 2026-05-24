import { loadFeedConfig, type FeedConfig } from './feed-config.js';
import { parseFeed } from './feed-parser.js';
import { upsertFeedItems } from './feed-store.js';
import { createLogger } from '../../../logger.js';

const log = createLogger('search');

export interface PollResult {
  feedUrl: string;
  ok: boolean;
  itemsAdded: number;
  error?: string;
}

export interface PollerHandle {
  stop(): void;
  readonly running: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_INTERVAL_SEC = 300;

async function pollOne(
  feed: FeedConfig,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<PollResult> {
  try {
    const res = await fetchImpl(feed.url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    });
    if (!res.ok) {
      return { feedUrl: feed.url, ok: false, itemsAdded: 0, error: `HTTP ${res.status}` };
    }
    const xml = await res.text();
    const parsed = parseFeed(xml, feed.url);
    if (!parsed) {
      return { feedUrl: feed.url, ok: false, itemsAdded: 0, error: 'parse failed' };
    }

    const category = feed.category ?? 'news';
    const itemsAdded = upsertFeedItems(
      parsed.items.map((it) => ({
        feedUrl: feed.url,
        guid: it.guid,
        title: it.title,
        link: it.link,
        summary: it.summary,
        ...(it.publishedDate ? { publishedDate: it.publishedDate } : {}),
        category,
      })),
    );
    return { feedUrl: feed.url, ok: true, itemsAdded };
  } catch (err) {
    return {
      feedUrl: feed.url,
      ok: false,
      itemsAdded: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function pollFeedsOnce(opts: {
  feeds?: FeedConfig[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}): Promise<PollResult[]> {
  const feeds = opts.feeds ?? loadFeedConfig().feeds;
  if (feeds.length === 0) return [];

  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const settled = await Promise.allSettled(
    feeds.map((f) => pollOne(f, fetchImpl, timeoutMs)),
  );

  const results: PollResult[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === 'fulfilled') {
      results.push(r.value);
    } else {
      results.push({
        feedUrl: feeds[i].url,
        ok: false,
        itemsAdded: 0,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  }

  const totalAdded = results.reduce((acc, r) => acc + r.itemsAdded, 0);
  log.info('feed poll complete', {
    feeds: feeds.length,
    ok: results.filter((r) => r.ok).length,
    itemsAdded: totalAdded,
  });
  return results;
}

export function pollFeedsForever(opts: {
  intervalSec?: number;
  feeds?: FeedConfig[];
  fetchImpl?: typeof fetch;
} = {}): PollerHandle {
  const intervalSec = opts.intervalSec ?? DEFAULT_INTERVAL_SEC;
  const intervalMs = Math.max(1, Math.floor(intervalSec * 1000));

  const state = { running: true };
  const handle = setInterval(() => {
    void pollFeedsOnce({
      ...(opts.feeds ? { feeds: opts.feeds } : {}),
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    }).catch((err) => {
      log.warn('scheduled poll threw', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, intervalMs);

  return {
    stop() {
      clearInterval(handle);
      state.running = false;
    },
    get running() {
      return state.running;
    },
  };
}
