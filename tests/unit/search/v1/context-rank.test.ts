import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RawSearchResult } from '../../../../src/types.js';
import type { EmbedProvider } from '../../../../src/providers/embed-provider.js';

interface MockState {
  provider: EmbedProvider | null;
  providerError: Error | null;
}

const state: MockState = { provider: null, providerError: null };

vi.mock('../../../../src/providers/embed-provider.js', () => ({
  getEmbedProvider: vi.fn(async () => {
    if (state.providerError) throw state.providerError;
    if (!state.provider) throw new Error('no provider');
    return state.provider;
  }),
}));

const { applyContextRank } = await import(
  '../../../../src/search/core/context-rank.js'
);

function makeProvider(
  embedFn: (texts: string[]) => Promise<Float32Array[]>,
): EmbedProvider {
  return {
    embed: embedFn,
    dim: 3,
    modelId: 'test',
  };
}

function makeResult(url: string, score = 1, title?: string): RawSearchResult {
  return {
    title: title ?? `t-${url}`,
    url,
    snippet: `s-${url}`,
    relevance_score: score,
    engine: 'mock',
  };
}

beforeEach(() => {
  state.provider = null;
  state.providerError = null;
});

describe('applyContextRank', () => {
  it('returns input unchanged when contextText is undefined', async () => {
    const results = [makeResult('a'), makeResult('b')];
    const out = await applyContextRank(results, 'q', undefined);
    expect(out).toBe(results);
  });

  it('returns input unchanged when contextText is empty string', async () => {
    const results = [makeResult('a')];
    const out = await applyContextRank(results, 'q', '   ');
    expect(out).toBe(results);
  });

  it('returns input unchanged on empty results array', async () => {
    const out = await applyContextRank([], 'q', 'ctx');
    expect(out).toEqual([]);
  });

  it('returns input unchanged when embed provider unavailable', async () => {
    state.providerError = new Error('boom');
    const results = [makeResult('a', 1)];
    const out = await applyContextRank(results, 'q', 'ctx');
    expect(out).toBe(results);
  });

  it('returns input unchanged when embed throws', async () => {
    state.provider = makeProvider(async () => {
      throw new Error('embed-fail');
    });
    const results = [makeResult('a', 1)];
    const out = await applyContextRank(results, 'q', 'ctx');
    expect(out).toBe(results);
  });

  it('re-sorts results by cosine similarity to query vector', async () => {
    // query = [1,0,0]. A aligned (cos 1, max mult); B anti-aligned (cos -1, min mult).
    state.provider = makeProvider(async (texts) => {
      const out: Float32Array[] = [];
      for (const t of texts) {
        if (t.includes('Context:')) out.push(Float32Array.from([1, 0, 0]));
        else if (t.startsWith('t-b')) out.push(Float32Array.from([-1, 0, 0]));
        else out.push(Float32Array.from([1, 0, 0]));
      }
      return out;
    });
    // Input order has b first but tie on score; after rerank a should win.
    const results = [makeResult('b', 1), makeResult('a', 1)];
    const out = await applyContextRank(results, 'q', 'ctx');
    expect(out[0].url).toBe('a');
    expect(out[1].url).toBe('b');
  });

  it('cosine = 1.0 → multiplier exactly maxMultiplier', async () => {
    state.provider = makeProvider(async (texts) =>
      texts.map(() => Float32Array.from([1, 0, 0])),
    );
    const results = [makeResult('a', 1)];
    const out = await applyContextRank(results, 'q', 'ctx', {
      minMultiplier: 0.5,
      maxMultiplier: 1.5,
    });
    expect(out[0].relevance_score).toBeCloseTo(1.5, 6);
  });

  it('cosine = -1.0 → multiplier exactly minMultiplier', async () => {
    state.provider = makeProvider(async (texts) =>
      texts.map((_t, i) =>
        i === 0 ? Float32Array.from([1, 0, 0]) : Float32Array.from([-1, 0, 0]),
      ),
    );
    const results = [makeResult('a', 1)];
    const out = await applyContextRank(results, 'q', 'ctx', {
      minMultiplier: 0.5,
      maxMultiplier: 1.5,
    });
    expect(out[0].relevance_score).toBeCloseTo(0.5, 6);
  });

  it('equal cosines preserve ordering and apply same multiplier', async () => {
    state.provider = makeProvider(async (texts) =>
      texts.map(() => Float32Array.from([1, 0, 0])),
    );
    const results = [makeResult('a', 2), makeResult('b', 1)];
    const out = await applyContextRank(results, 'q', 'ctx');
    // Both cos=1 → multiplier = max = 1.2; scaled scores: 2.4, 1.2 — order preserved
    expect(out[0].url).toBe('a');
    expect(out[1].url).toBe('b');
    expect(out[0].relevance_score).toBeCloseTo(2.4, 6);
    expect(out[1].relevance_score).toBeCloseTo(1.2, 6);
  });

  it('single result + non-empty context → returns one result with adjusted score', async () => {
    state.provider = makeProvider(async (texts) =>
      texts.map((_t, i) =>
        i === 0
          ? Float32Array.from([1, 0, 0])
          : Float32Array.from([0.5, 0.5, 0]),
      ),
    );
    const results = [makeResult('a', 1)];
    const out = await applyContextRank(results, 'q', 'ctx');
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe('a');
    expect(out[0].relevance_score).not.toBe(1);
  });

  it('respects custom min/max multipliers', async () => {
    state.provider = makeProvider(async (texts) =>
      texts.map(() => Float32Array.from([1, 0, 0])),
    );
    const results = [makeResult('a', 1)];
    const out = await applyContextRank(results, 'q', 'ctx', {
      minMultiplier: 0.1,
      maxMultiplier: 5.0,
    });
    expect(out[0].relevance_score).toBeCloseTo(5.0, 6);
  });

  it('does not mutate input array or items', async () => {
    state.provider = makeProvider(async (texts) =>
      texts.map(() => Float32Array.from([1, 0, 0])),
    );
    const r1 = makeResult('a', 1);
    const results = [r1];
    const original = r1.relevance_score;
    await applyContextRank(results, 'q', 'ctx');
    expect(r1.relevance_score).toBe(original);
    expect(results).toHaveLength(1);
  });

  it('returns input unchanged when embed returns wrong vector count', async () => {
    state.provider = makeProvider(async () => [Float32Array.from([1, 0, 0])]);
    const results = [makeResult('a', 1), makeResult('b', 1)];
    const out = await applyContextRank(results, 'q', 'ctx');
    expect(out).toBe(results);
  });
});
