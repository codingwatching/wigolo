import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase, isVecExtensionLoaded } from '../../src/cache/db.js';
import {
  cacheContent,
  updateCacheEmbedding,
  getEmbeddingForUrl,
  getAllEmbeddings,
} from '../../src/cache/store.js';
import {
  getVectorStore,
  _resetVectorStoreForTest,
} from '../../src/providers/vector-store.js';
import { resetConfig } from '../../src/config.js';
import type { RawFetchResult, ExtractionResult } from '../../src/types.js';

vi.mock('../../src/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('Embedding integration: SQLite + sqlite-vec store', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetConfig();
    _resetVectorStoreForTest();
    initDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase();
    _resetVectorStoreForTest();
    process.env = originalEnv;
    resetConfig();
  });

  function seedPage(url: string, markdown: string): void {
    const raw: RawFetchResult = {
      url,
      finalUrl: url,
      html: `<html><body>${markdown}</body></html>`,
      contentType: 'text/html',
      statusCode: 200,
      method: 'http',
      headers: {},
    };
    const extraction: ExtractionResult = {
      title: url,
      markdown,
      metadata: {},
      links: [],
      images: [],
      extractor: 'defuddle',
    };
    cacheContent(raw, extraction);
  }

  // Generate a deterministic 384-dim vector so the test exercises the
  // migration-shaped float[384] virtual table provisioned by 001-sqlite-vec.
  function generateVector(dims: number, seed: number): Float32Array {
    const v = new Float32Array(dims);
    for (let i = 0; i < dims; i++) v[i] = Math.sin(seed * (i + 1) * 0.1);
    let norm = 0;
    for (let i = 0; i < dims; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < dims; i++) v[i] /= norm;
    }
    return v;
  }

  it('vec extension loads on init', () => {
    expect(isVecExtensionLoaded()).toBe(true);
  });

  it('end-to-end: cache page -> updateCacheEmbedding -> vector store search', async () => {
    const dims = 384;
    const urls = [
      'https://react.dev/hooks',
      'https://vuejs.org/composition',
      'https://svelte.dev/stores',
    ];

    for (const url of urls) {
      seedPage(url, `Content about ${url}`);
    }

    for (let i = 0; i < urls.length; i++) {
      const vector = generateVector(dims, i + 1);
      const buffer = Buffer.from(vector.buffer);
      updateCacheEmbedding(urls[i], buffer, 'bge-small-en-v1.5', dims);
    }

    for (const url of urls) {
      const emb = getEmbeddingForUrl(url);
      expect(emb).not.toBeNull();
      expect(emb!.dims).toBe(dims);
    }

    const store = await getVectorStore();
    for (let i = 0; i < urls.length; i++) {
      await store.upsert([{
        id: urls[i],
        vector: generateVector(dims, i + 1),
        metadata: {
          url: urls[i],
          contentHash: '',
          modelId: 'bge-small-en-v1.5',
        },
      }]);
    }

    expect(await store.size()).toBe(3);

    const queryVector = generateVector(dims, 1);
    const results = await store.search(queryVector, 3);

    expect(results.length).toBe(3);
    expect(results[0].id).toBe(urls[0]);
  });

  it('upsert replaces an existing record (no duplicates)', async () => {
    const dims = 384;
    const store = await getVectorStore();
    await store.upsert([{
      id: 'https://mutable.com',
      vector: generateVector(dims, 1),
      metadata: { url: 'https://mutable.com', contentHash: 'h1', modelId: 'model-a' },
    }]);
    await store.upsert([{
      id: 'https://mutable.com',
      vector: generateVector(dims, 2),
      metadata: { url: 'https://mutable.com', contentHash: 'h2', modelId: 'model-b' },
    }]);

    expect(await store.size()).toBe(1);

    const r = await store.search(generateVector(dims, 2), 1);
    expect(r[0].id).toBe('https://mutable.com');
    expect(r[0].metadata.modelId).toBe('model-b');
  });

  it('filters by modelId', async () => {
    const dims = 384;
    const store = await getVectorStore();
    await store.upsert([
      {
        id: 'https://a.com',
        vector: generateVector(dims, 1),
        metadata: { url: 'https://a.com', contentHash: 'h', modelId: 'model-1' },
      },
      {
        id: 'https://b.com',
        vector: generateVector(dims, 1),
        metadata: { url: 'https://b.com', contentHash: 'h', modelId: 'model-2' },
      },
    ]);

    const r = await store.search(generateVector(dims, 1), 10, { modelId: 'model-1' });
    expect(r.map(x => x.id)).toEqual(['https://a.com']);
  });

  it('pages without embeddings are excluded from getAllEmbeddings', () => {
    seedPage('https://embedded.com', 'Has embedding');
    seedPage('https://plain.com', 'No embedding');

    const dims = 384;
    const vector = generateVector(dims, 1);
    updateCacheEmbedding('https://embedded.com', Buffer.from(vector.buffer), 'model', dims);

    const all = getAllEmbeddings();
    expect(all).toHaveLength(1);
    expect(all[0].normalizedUrl).toContain('embedded.com');
  });

  it('large number of vectors search returns top-K with finite scores', async () => {
    const dims = 384;
    const count = 100;
    const store = await getVectorStore();

    const records = Array.from({ length: count }, (_, i) => ({
      id: `https://page${i}.com`,
      vector: generateVector(dims, i + 1),
      metadata: {
        url: `https://page${i}.com`,
        contentHash: '',
        modelId: 'model',
      },
    }));
    await store.upsert(records);

    expect(await store.size()).toBe(count);

    const query = generateVector(dims, 43);
    const results = await store.search(query, 5);
    expect(results.length).toBe(5);
    for (const r of results) {
      expect(Number.isFinite(r.score)).toBe(true);
    }
  });

  it('handles concurrent embedding updates without corruption', async () => {
    const dims = 384;
    seedPage('https://concurrent.com', 'Concurrent test');

    const promises = Array.from({ length: 10 }, (_, i) => {
      const v = generateVector(dims, i + 1);
      return Promise.resolve(
        updateCacheEmbedding(
          'https://concurrent.com',
          Buffer.from(v.buffer),
          `model-${i}`,
          dims,
        ),
      );
    });

    await Promise.all(promises);

    const emb = getEmbeddingForUrl('https://concurrent.com');
    expect(emb).not.toBeNull();
    expect(emb!.dims).toBe(dims);
  });
});
