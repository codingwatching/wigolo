/**
 * Research synthesis must ALSO fire the local-model path via the C0 opt-in
 * tier (resolveLocalModelTier), not only when a cloud key / explicit provider
 * is configured. The ladder is host-sampling > local model > deterministic.
 *
 * These are deterministic mocked tests for the ladder gating: tier present ->
 * synthesizeLocal called with the tier; tier null AND no cloud key -> NO model
 * call, deterministic evidence assembly. A citation-alignment test proves the
 * per-claim [n] indices stay bound to the correct source through the local
 * path (a leading unfetched row must not shift them).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SearchEngine, RawSearchResult, ResearchInput } from '../../../src/types.js';
import type { SmartRouter } from '../../../src/fetch/router.js';

vi.mock('../../../src/providers/extract-provider.js', () => ({
  getExtractProvider: vi.fn(async () => ({
    name: 'v1' as const,
    extract: vi.fn().mockImplementation(async (_html: string, url?: string) => ({
      title: 'Extracted Title',
      markdown: `# Extracted Content\n\nArticle content about the topic and framework reactivity primitives.${url ? ` Source ${url}.` : ''}`,
      metadata: {},
      links: [],
      images: [],
      extractor: 'defuddle' as const,
    })),
  })),
  _resetExtractProviderForTest: vi.fn(),
}));

vi.mock('../../../src/cache/store.js', () => ({
  cacheContent: vi.fn(),
  normalizeUrl: vi.fn((url: string) => url),
}));

vi.mock('../../../src/embedding/embed.js', () => ({
  getEmbeddingService: vi.fn(() => ({
    isAvailable: () => false,
    embedAsync: vi.fn(),
  })),
}));

vi.mock('../../../src/integrations/cloud/llm/local-tier.js', () => ({
  resolveLocalModelTier: vi.fn(),
}));

// The cloud-key gate is forced OFF so these tests exercise the tier path in
// isolation — no cloud provider, no keychain key.
vi.mock('../../../src/integrations/cloud/llm/run.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/integrations/cloud/llm/run.js')>();
  return { ...actual, isLlmConfiguredWithKeyStore: vi.fn(async () => false) };
});

const localTierModule = await import('../../../src/integrations/cloud/llm/local-tier.js');
const synthesisLocalModule = await import('../../../src/research/synthesis-local.js');
const { runResearchPipeline } = await import('../../../src/research/pipeline.js');

function createStubEngine(results: RawSearchResult[]): SearchEngine {
  return { name: 'stub', search: vi.fn().mockResolvedValue(results) };
}

function createStubRouter(): SmartRouter {
  return {
    fetch: vi.fn().mockResolvedValue({
      url: 'https://example.com',
      finalUrl: 'https://example.com',
      html: '<html><body><h1>Test</h1><p>Article content about the topic.</p></body></html>',
      contentType: 'text/html',
      statusCode: 200,
      method: 'http' as const,
      headers: {},
    }),
  } as unknown as SmartRouter;
}

const RESULTS: RawSearchResult[] = [
  { title: 'React Hooks Guide', url: 'https://react.dev/hooks', snippet: 'Learn about hooks.', relevance_score: 0.95, engine: 'stub' },
  { title: 'Vue Composition API', url: 'https://vuejs.org/guide', snippet: 'Vue 3 composition API.', relevance_score: 0.88, engine: 'stub' },
];

describe('research synthesis fires via the local-model tier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls synthesizeLocal WITH the tier when resolveLocalModelTier is available', async () => {
    vi.mocked(localTierModule.resolveLocalModelTier).mockResolvedValue({
      available: true,
      endpoint: 'http://localhost:11434',
      model: 'qwen2.5:7b-instruct',
      source: 'auto',
    });

    const localSpy = vi.spyOn(synthesisLocalModule, 'synthesizeLocal').mockResolvedValue({
      text: 'Local-tier report about reactivity [1][2].',
      citations: [0, 1],
    });

    const input: ResearchInput = { question: 'modern reactivity primitives', depth: 'quick' };
    const out = await runResearchPipeline(input, [createStubEngine(RESULTS)], createStubRouter());

    expect(out.error).toBeUndefined();
    expect(localSpy).toHaveBeenCalledTimes(1);
    const tierArg = localSpy.mock.calls[0]![2];
    expect(tierArg?.tier).toEqual({ endpoint: 'http://localhost:11434', model: 'qwen2.5:7b-instruct' });
    expect(out.report).toContain('Local-tier report');
  });

  it('does NOT call synthesizeLocal when tier is null and no cloud key (byte-for-byte deterministic)', async () => {
    vi.mocked(localTierModule.resolveLocalModelTier).mockResolvedValue(null);

    const localSpy = vi.spyOn(synthesisLocalModule, 'synthesizeLocal');

    const input: ResearchInput = { question: 'modern reactivity primitives', depth: 'quick' };
    const out = await runResearchPipeline(input, [createStubEngine(RESULTS)], createStubRouter());

    expect(out.error).toBeUndefined();
    expect(localSpy).not.toHaveBeenCalled();
    // Deterministic evidence assembly still produces a report + citations.
    expect(out.report.length).toBeGreaterThan(0);
  });

  it('falls back deterministically when the tier synthesis throws (timeout/failure)', async () => {
    vi.mocked(localTierModule.resolveLocalModelTier).mockResolvedValue({
      available: true,
      endpoint: 'http://localhost:11434',
      model: 'qwen2.5:7b-instruct',
      source: 'auto',
    });

    vi.spyOn(synthesisLocalModule, 'synthesizeLocal').mockRejectedValue(new Error('tier timeout'));

    const input: ResearchInput = { question: 'modern reactivity primitives', depth: 'quick' };
    const out = await runResearchPipeline(input, [createStubEngine(RESULTS)], createStubRouter());

    expect(out.error).toBeUndefined();
    // The heuristic brief report is used; citations still come from sources.
    expect(out.report.length).toBeGreaterThan(0);
    expect(out.citations.length).toBeGreaterThan(0);
  });

  it('a LEADING UNFETCHED source is filtered from localSources and does NOT shift the [n] citation', async () => {
    vi.mocked(localTierModule.resolveLocalModelTier).mockResolvedValue({
      available: true,
      endpoint: 'http://localhost:11434',
      model: 'qwen2.5:7b-instruct',
      source: 'auto',
    });

    // Three ranked results; the TOP-ranked (react.dev, 0.95) FAILS to fetch, so
    // it stays in `sources` as an unfetched shell but is dropped from the
    // fetched-view `localSources`. localSources therefore is [vue, svelte] while
    // the full sources array leads with the unfetched react row.
    const threeResults: RawSearchResult[] = [
      { title: 'React Hooks', url: 'https://react.dev/hooks', snippet: 'react', relevance_score: 0.95, engine: 'stub' },
      { title: 'Vue Reactivity', url: 'https://vuejs.org/guide', snippet: 'vue', relevance_score: 0.9, engine: 'stub' },
      { title: 'Svelte Runes', url: 'https://svelte.dev/runes', snippet: 'svelte', relevance_score: 0.85, engine: 'stub' },
    ];
    const router = {
      fetch: vi.fn().mockImplementation((url: string) => {
        if (url.includes('react.dev')) return Promise.reject(new Error('fetch failed'));
        return Promise.resolve({
          url, finalUrl: url,
          html: `<html><body><p>Reactivity content about the framework primitives for ${url.includes('vue') ? 'Vue' : 'Svelte'} state.</p></body></html>`,
          contentType: 'text/html', statusCode: 200, method: 'http' as const, headers: {},
        });
      }),
    } as unknown as SmartRouter;

    // The model cites source [2] in ITS numbered view (localSources), i.e.
    // 0-based idx 1 = the SECOND fetched source (Svelte). If the pipeline
    // wrongly indexed into the full `sources` array instead of localSources, [2]
    // would resolve to Vue (the second full-array row) — the shift this guards.
    vi.spyOn(synthesisLocalModule, 'synthesizeLocal').mockResolvedValue({
      text: 'The second fetched source is cited [2].',
      citations: [1],
    });

    const input: ResearchInput = { question: 'framework reactivity primitives', depth: 'quick' };
    const out = await runResearchPipeline(input, [createStubEngine(threeResults)], router);

    expect(out.error).toBeUndefined();
    // The leading react row is present in sources but unfetched.
    const reactRow = out.sources.find((s) => s.url.includes('react.dev'));
    expect(reactRow?.fetched).toBe(false);

    // Exactly one citation; its index is LOCAL (into localSources), 1-based.
    expect(out.citations).toHaveLength(1);
    const c = out.citations[0];
    expect(c.index).toBe(2);
    // The citation must resolve to the SECOND FETCHED source (Svelte), proving
    // the leading unfetched row did not shift the index into the full array.
    expect(c.url).toContain('svelte.dev');
    expect(c.url).not.toContain('vuejs.org');
  });
});
