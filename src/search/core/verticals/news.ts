import { HnAlgoliaEngine } from '../../engines/hn-algolia.js';
import { LobstersEngine } from '../../engines/lobsters.js';
import { BingNewsEngine } from '../../engines/bing-news.js';
import { wrapWithRetryAndBreaker, type EngineEntry } from '../engine-base.js';
import { RssFeedEngine } from '../rss/rss-engine.js';
import { loadFeedConfig } from '../rss/feed-config.js';
import { countFeedItems } from '../rss/feed-store.js';
import { createLogger } from '../../../logger.js';

const log = createLogger('search');

let cached: EngineEntry[] | null = null;

function hasRssConfigured(): boolean {
  try {
    if (loadFeedConfig().feeds.length > 0) return true;
  } catch {
    // fall through
  }
  try {
    if (countFeedItems() > 0) return true;
  } catch {
    // fall through
  }
  return false;
}

/**
 * Returns the news vertical's engine list. Computed once and memoized.
 *
 * Follow-up: dynamic feed config reload requires resetting the vertical
 * cache (call `_resetNewsEnginesForTest()` for now).
 */
export function getNewsEngines(): EngineEntry[] {
  if (cached) return cached;
  const entries: EngineEntry[] = [
    { engine: wrapWithRetryAndBreaker(new HnAlgoliaEngine()), weight: 1.2, supportsDateFilter: true },
    // Lobsters /search.json has no native date filter; engine applies client-side
    // filtering. Mark false so the orchestrator treats it as date-naive.
    { engine: wrapWithRetryAndBreaker(new LobstersEngine()), weight: 1.0, supportsDateFilter: false },
    // Bing News widens reach beyond HN/Lobsters' tech-only feed. The engine
    // scrapes /search?filters=tnews and surfaces .news_dt → published_date so
    // the recency layer can rank it like the other date-aware engines.
    { engine: wrapWithRetryAndBreaker(new BingNewsEngine()), weight: 0.9, supportsDateFilter: false },
  ];

  if (hasRssConfigured()) {
    entries.push({
      engine: wrapWithRetryAndBreaker(new RssFeedEngine()),
      weight: 1.5,
      supportsDateFilter: true,
    });
    log.info('news vertical: rss-feed engine attached');
  }

  cached = entries;
  return cached;
}

export function _resetNewsEnginesForTest(): void {
  cached = null;
}
