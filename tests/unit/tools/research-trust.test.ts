import { describe, it, expect, vi } from 'vitest';
import type { SearchEngine, RawSearchResult, ResearchInput } from '../../../src/types.js';
import type { SmartRouter } from '../../../src/fetch/router.js';

/**
 * 4d slice-4 — C4 widen completion: research's EXISTING sources + citations are
 * web/page-derived, so every one must carry trusted:false. This does NOT read
 * studio_artifacts into research (that is C3, deferred) — pure tagging.
 */

const extractMock = vi.fn().mockResolvedValue({
  title: 'Extracted Title',
  markdown: '# Extracted Content\n\nArticle content about the topic.',
  metadata: {},
  links: [],
  images: [],
  extractor: 'defuddle' as const,
});
vi.mock('../../../src/providers/extract-provider.js', () => ({
  getExtractProvider: vi.fn(async () => ({ name: 'v1' as const, extract: extractMock })),
  _resetExtractProviderForTest: vi.fn(),
}));
vi.mock('../../../src/cache/store.js', () => ({
  cacheContent: vi.fn(),
  normalizeUrl: vi.fn((url: string) => url),
}));

const { handleResearch } = await import('../../../src/tools/research.js');

const stubEngine: SearchEngine = {
  name: 'stub',
  search: vi.fn().mockResolvedValue([
    { title: 'React Hooks Guide', url: 'https://react.dev/hooks', snippet: 'Learn about hooks.', relevance_score: 0.95, engine: 'stub' },
    { title: 'Vue Composition API', url: 'https://vuejs.org/guide', snippet: 'Vue 3 composition API.', relevance_score: 0.88, engine: 'stub' },
    { title: 'Svelte Stores', url: 'https://svelte.dev/docs', snippet: 'Svelte reactive stores.', relevance_score: 0.82, engine: 'stub' },
    { title: 'Angular Signals', url: 'https://angular.io/signals', snippet: 'Angular signal primitives.', relevance_score: 0.75, engine: 'stub' },
    { title: 'Solid Signals', url: 'https://solidjs.com/docs', snippet: 'SolidJS fine-grained reactivity.', relevance_score: 0.70, engine: 'stub' },
  ] as RawSearchResult[]),
};
const stubRouter = {
  fetch: vi.fn().mockResolvedValue({
    url: 'https://example.com', finalUrl: 'https://example.com',
    html: '<html><body><h1>Test</h1><p>Article content about the topic.</p></body></html>',
    contentType: 'text/html', statusCode: 200, method: 'http' as const, headers: {},
  }),
} as unknown as SmartRouter;

describe('research — sources + citations carry trusted:false (4d slice-4)', () => {
  // NOTE: no vi.clearAllMocks() — the project's vitest config resets mock
  // implementations between tests, which would wipe the module-level engine
  // mockResolvedValue and zero out sources. One test here; nothing to clear.
  it('every ResearchSource and Citation carries trusted:false (web/page-derived)', async () => {
    const r = await handleResearch(
      { question: 'Compare frontend framework state management approaches', depth: 'standard' } as ResearchInput,
      [stubEngine],
      stubRouter,
    );
    expect(r.ok).toBe(true);
    const out = r.ok ? r.data : null;
    expect(out!.sources.length).toBeGreaterThan(0);
    expect(out!.citations.length).toBeGreaterThan(0);
    for (const s of out!.sources) {
      expect((s as { trusted?: boolean }).trusted, `source ${s.url} must carry trusted:false`).toBe(false);
    }
    for (const c of out!.citations) {
      expect((c as { trusted?: boolean }).trusted, `citation ${c.url} must carry trusted:false`).toBe(false);
    }
  });
});
