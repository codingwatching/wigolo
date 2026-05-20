import { describe, it, expect } from 'vitest';
import { runV1Search } from '../../src/search/v1/orchestrator.js';

const RUN_SEARCH_BENCH = process.env.RUN_SEARCH_BENCH === '1';

// Representative queries drawn from benchmarks/search/fixtures/queries.json.
// Hard-coded to keep the bench self-contained and avoid coupling to fixture
// schema changes.
const QUERIES = [
  'typescript Record utility type',
  'playwright page.goto options',
  'how does javascript event loop work',
  'express middleware error handling pattern',
  'rust async await tutorial',
];

const P50_BUDGET_MS = 1500;

function p50(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

(RUN_SEARCH_BENCH ? describe : describe.skip)('v1 search perf bench', () => {
  it('classifies + orchestrates a query in < 1500ms warm P50 (real network)', async () => {
    // Warm-up pass — not timed.
    await runV1Search({ query: QUERIES[0], maxResults: 5 });

    const latencies: number[] = [];
    for (const q of QUERIES) {
      const start = Date.now();
      await runV1Search({ query: q, maxResults: 5 });
      latencies.push(Date.now() - start);
    }

    const median = p50(latencies);
    console.log(`[v1 bench] latencies=${JSON.stringify(latencies)} p50=${median}ms`);
    expect(median).toBeLessThan(P50_BUDGET_MS);
  }, 60_000);
});
