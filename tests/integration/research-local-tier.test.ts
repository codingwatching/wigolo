/**
 * Tool-boundary integration: the `research` MCP tool must surface a
 * local-model-synthesized brief/report with correctly index-aligned per-claim
 * [n] citations when the C0 opt-in local-model tier is reachable — with no
 * cloud key and no explicit provider configured (the WIGOLO_LOCAL_LLM-only
 * gap). Exercised through handleResearch, not the pipeline directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SearchEngine, RawSearchResult, ResearchInput } from '../../src/types.js';
import type { SmartRouter } from '../../src/fetch/router.js';

vi.mock('../../src/providers/extract-provider.js', () => ({
  getExtractProvider: vi.fn(async () => ({
    name: 'v1' as const,
    extract: vi.fn().mockImplementation(async (_html: string, url: string) => ({
      title: url.includes('vue') ? 'Vue Reactivity' : 'React Reactivity',
      markdown: url.includes('vue')
        ? '# Vue\n\nModern frameworks track reactivity: Vue uses a Proxy-based reactivity system that tracks dependencies automatically across the framework.'
        : '# React\n\nModern frameworks track reactivity: React tracks reactivity through hooks that re-run when framework state changes.',
      metadata: {},
      links: [],
      images: [],
      extractor: 'defuddle' as const,
    })),
  })),
  _resetExtractProviderForTest: vi.fn(),
}));

vi.mock('../../src/cache/store.js', () => ({
  cacheContent: vi.fn(),
  normalizeUrl: vi.fn((url: string) => url),
}));

vi.mock('../../src/embedding/embed.js', () => ({
  getEmbeddingService: vi.fn(() => ({ isAvailable: () => false, embedAsync: vi.fn() })),
}));

vi.mock('../../src/integrations/cloud/llm/local-tier.js', () => ({
  resolveLocalModelTier: vi.fn(),
}));

vi.mock('../../src/integrations/cloud/llm/run.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/integrations/cloud/llm/run.js')>();
  return {
    ...actual,
    isLlmConfiguredWithKeyStore: vi.fn(async () => false),
    runLlmText: vi.fn(),
  };
});

const localTierModule = await import('../../src/integrations/cloud/llm/local-tier.js');
const runLlmModule = await import('../../src/integrations/cloud/llm/run.js');
const { handleResearch } = await import('../../src/tools/research.js');

function stubEngine(results: RawSearchResult[]): SearchEngine {
  return { name: 'integration-stub', search: vi.fn().mockResolvedValue(results) };
}

function stubRouter(): SmartRouter {
  return {
    fetch: vi.fn().mockImplementation((url: string) => Promise.resolve({
      url, finalUrl: url,
      html: '<html><body><h1>Doc</h1><p>Reactivity content about the framework.</p></body></html>',
      contentType: 'text/html', statusCode: 200, method: 'http' as const, headers: {},
    })),
  } as unknown as SmartRouter;
}

const RESULTS: RawSearchResult[] = [
  { title: 'React Hooks Guide', url: 'https://react.dev/hooks', snippet: 'hooks', relevance_score: 0.95, engine: 'integration-stub' },
  { title: 'Vue Composition API', url: 'https://vuejs.org/guide', snippet: 'vue', relevance_score: 0.88, engine: 'integration-stub' },
];

describe('research tool boundary — local-model tier synthesis', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.WIGOLO_LLM_PROVIDER;
    vi.clearAllMocks();
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns a local-synthesized report with aligned [n] citations through handleResearch', async () => {
    vi.mocked(localTierModule.resolveLocalModelTier).mockResolvedValue({
      available: true, endpoint: 'http://localhost:11434', model: 'qwen2.5:7b-instruct', source: 'auto',
    });

    // The local model cites source [2] (Vue). Its citation must resolve to the
    // Vue source in the tool output, proving no off-by-one from the remap.
    vi.mocked(runLlmModule.runLlmText).mockResolvedValue({
      text: 'Synthesized-by-local-model: Vue tracks dependencies via Proxy reactivity [2].',
      provider: 'custom', model: 'qwen2.5:7b-instruct', latencyMs: 8,
    });

    const input: ResearchInput = { question: 'how do modern frameworks track reactivity', depth: 'quick' };
    const res = await handleResearch(input, [stubEngine(RESULTS)], stubRouter());

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const out = res.data;
    expect(out.report).toContain('Synthesized-by-local-model');
    expect(out.citations.length).toBe(1);
    const c = out.citations[0];
    expect(c.index).toBe(2);
    expect(out.sources[c.index - 1]?.url).toContain('vuejs.org');
    // The tier was routed and env restored at the boundary.
    expect(process.env.WIGOLO_LLM_PROVIDER).toBeUndefined();
  });

  it('keyless default (tier null, no cloud key) makes NO model call at the boundary', async () => {
    vi.mocked(localTierModule.resolveLocalModelTier).mockResolvedValue(null);

    const input: ResearchInput = { question: 'how do modern frameworks track reactivity', depth: 'quick' };
    const res = await handleResearch(input, [stubEngine(RESULTS)], stubRouter());

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(vi.mocked(runLlmModule.runLlmText)).not.toHaveBeenCalled();
    // Deterministic brief still populated.
    expect(res.data.report.length).toBeGreaterThan(0);
    expect(res.data.brief).toBeDefined();
  });
});
