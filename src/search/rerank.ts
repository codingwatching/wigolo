import type { MergedSearchResult } from './dedup.js';
import { flashRankRerank, isFlashRankAvailable } from './flashrank.js';
import { getConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { hasRecencyIntent, recencyFactor } from './reranker/recency.js';

const log = createLogger('search');

export async function rerankResults(
  query: string,
  results: MergedSearchResult[],
): Promise<MergedSearchResult[]> {
  const config = getConfig();

  if (results.length === 0) return results;

  if (config.reranker === 'flashrank') {
    if (await isFlashRankAvailable()) {
      const passages = results.map((r, i) => ({
        text: `${r.title}\n${r.snippet}`,
        index: i,
      }));

      const ranked = await flashRankRerank(query, passages, config.rerankerModel);
      if (ranked) {
        const reordered = ranked.map((r) => ({
          ...results[r.index],
          relevance_score: r.score,
        }));

        const boosted = applyRecencyBoost(query, reordered);
        boosted.sort((a, b) => b.relevance_score - a.relevance_score);
        return applyThreshold(boosted, config.relevanceThreshold);
      }

      log.debug('FlashRank returned null, using passthrough');
    } else {
      log.warn('FlashRank configured but not installed. Run: wigolo warmup --reranker');
    }
  } else if (config.reranker !== 'none') {
    log.warn('Unknown reranker configured, passing through', { reranker: config.reranker });
  }

  log.debug('Rerank passthrough', { count: results.length });
  const boosted = applyRecencyBoost(query, results);
  boosted.sort((a, b) => b.relevance_score - a.relevance_score);
  return applyThreshold(boosted, config.relevanceThreshold);
}

export function applyRecencyBoost(
  query: string,
  results: MergedSearchResult[],
  now: Date = new Date(),
): MergedSearchResult[] {
  if (!hasRecencyIntent(query, now)) return results;
  return results.map((r) => {
    const factor = recencyFactor(r.published_date, now);
    if (factor === 1.0) return r;
    return { ...r, relevance_score: r.relevance_score * factor };
  });
}

function applyThreshold(
  results: MergedSearchResult[],
  threshold: number,
): MergedSearchResult[] {
  if (!threshold || threshold <= 0) return results;
  return results.filter((r) => r.relevance_score >= threshold);
}
