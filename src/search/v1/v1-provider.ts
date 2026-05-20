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

    const start = Date.now();
    const result = await runV1Search({
      query,
      category: input.category === 'images' ? undefined : input.category,
      fromDate: input.from_date,
      toDate: input.to_date,
      maxResults: input.max_results,
      language: input.language,
      includeDomains: input.include_domains,
      excludeDomains: input.exclude_domains,
    });

    const items: SearchResultItem[] = result.results.map((r) => ({
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
