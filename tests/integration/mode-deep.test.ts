import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleSearch } from '../../src/tools/search.js';
import * as multiQueryMod from '../../src/search/multi-query.js';
import { initDatabase, closeDatabase } from '../../src/cache/db.js';
import { resetConfig } from '../../src/config.js';
import type { SmartRouter } from '../../src/fetch/router.js';
import type { RawSearchResult } from '../../src/types.js';

describe('search mode=deep — query expansion', () => {
  beforeEach(() => {
    process.env.VALIDATE_LINKS = 'false';
    process.env.WIGOLO_RERANKER = 'none';
    initDatabase(':memory:');
    resetConfig();
  });
  afterEach(() => {
    closeDatabase();
    resetConfig();
    delete process.env.VALIDATE_LINKS;
    delete process.env.WIGOLO_RERANKER;
  });

  it('expands a single string query into 3-5 variants before fan-out', async () => {
    const fanOutSpy = vi.spyOn(multiQueryMod, 'fanOutSearch');
    const engine = {
      name: 'eng',
      search: vi.fn().mockResolvedValue([{
        title: 't', url: 'https://x.test/', snippet: 's',
        relevance_score: 0.5, engine: 'eng',
      }] satisfies RawSearchResult[]),
    };
    const router = {
      fetch: vi.fn().mockResolvedValue({
        url: 'https://x.test/', finalUrl: 'https://x.test/',
        html: '<html><body><p>full body</p></body></html>',
        contentType: 'text/html', statusCode: 200, method: 'http', headers: {},
      }),
    } as unknown as SmartRouter;

    await handleSearch({ query: 'go generics', mode: 'deep' }, [engine], router);

    expect(fanOutSpy).toHaveBeenCalled();
    const queriesArg = fanOutSpy.mock.calls[0][0];
    expect(queriesArg.length).toBeGreaterThanOrEqual(3);
    expect(queriesArg.length).toBeLessThanOrEqual(5);
    fanOutSpy.mockRestore();
  });
});
