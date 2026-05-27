/**
 * getCacheStatsAction — wraps the cache module's public getCacheStats() API.
 *
 * Returns a structured result for the Dashboard to render. Never reaches into
 * SQLite directly; always delegates to the public cache/store.ts export.
 */
import { getCacheStats } from '../../../cache/store.js';

export interface CacheStatsResult {
  totalEntries: number;
  sizeMb: number;
  oldest: string;
  newest: string;
  /** Present when an error occurred fetching stats */
  error?: string;
}

export async function getCacheStatsAction(): Promise<CacheStatsResult> {
  try {
    const stats = getCacheStats();
    return {
      totalEntries: stats.total_urls,
      sizeMb: stats.total_size_mb,
      oldest: stats.oldest,
      newest: stats.newest,
    };
  } catch (err) {
    return {
      totalEntries: 0,
      sizeMb: 0,
      oldest: '',
      newest: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
