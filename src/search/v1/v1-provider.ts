// V1SearchProvider — Phase 7 retrieval-only adapter.
//
// Delegates to the v1 orchestrator (intent routing + per-vertical engines +
// RRF fusion) and maps RawSearchResult to SearchResultItem for the MCP
// `search` tool surface. Intentional omissions for Phase 7: no content
// fetch/extraction, no rerank, no multi-query expansion, no caching, no
// answer synthesis, no evidence extraction. Those land in later phases.

import type { SearchProvider, SearchContext } from '../../providers/search-provider.js';
import type {
  SearchInput,
  SearchOutput,
  SearchResultItem,
  StageResult,
} from '../../types.js';
import { runV1Search } from './orchestrator.js';
import { applyContextRank } from './context-rank.js';
import { dedupAgainstRecentUrls } from './recent-cache-dedup.js';

export class V1SearchProvider implements SearchProvider {
  readonly name = 'v1' as const;

  async search(input: SearchInput, _ctx: SearchContext): Promise<StageResult<SearchOutput>> {
    const rawQuery = Array.isArray(input.query) ? input.query.join(' ') : input.query;
    if (typeof rawQuery !== 'string' || rawQuery.trim() === '') {
      return {
        ok: false,
        error: 'invalid_input',
        error_reason: 'Query is empty',
        stage: 'search',
      };
    }
    const query = rawQuery.trim();

    // v1 has no images vertical. Silently coercing to general was misleading —
    // callers got general results back labelled as if they'd asked for images.
    // Surface this explicitly so the host LLM can pick another tool (or fall
    // back to legacy SearXNG via WIGOLO_SEARCH=searxng).
    if (input.category === 'images') {
      return {
        ok: false,
        error: 'unsupported_category',
        error_reason: 'images vertical not supported in v1 — set WIGOLO_SEARCH=searxng for legacy image search, or omit category for a general search',
        stage: 'search',
      };
    }

    const start = Date.now();
    const result = await runV1Search({
      query,
      category: input.category,
      fromDate: input.from_date,
      toDate: input.to_date,
      maxResults: input.max_results,
      language: input.language,
      includeDomains: input.include_domains,
      excludeDomains: input.exclude_domains,
    });

    let processed = result.results;

    if (input.agent_context?.text || input.agent_context?.intent) {
      const contextText = input.agent_context.text ?? input.agent_context.intent;
      processed = await applyContextRank(processed, query, contextText);
    }

    if (input.agent_context?.recent_urls?.length) {
      processed = dedupAgainstRecentUrls(processed, input.agent_context.recent_urls);
    }

    const items: SearchResultItem[] = processed.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      relevance_score: r.relevance_score,
      ...(r.published_date ? { published_date: r.published_date } : {}),
    }));

    const elapsed = Date.now() - start;
    const data: SearchOutput = {
      results: items,
      query,
      engines_used: result.enginesUsed,
      total_time_ms: elapsed,
      search_time_ms: elapsed,
    };

    if (result.degraded) {
      data.warning = 'all engines failed or no results';
    }

    return { ok: true, data };
  }
}
