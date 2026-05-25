import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BackgroundIndexQueue } from '../../../src/embedding/background-queue.js';
import type { EmbedProvider } from '../../../src/providers/embed-provider.js';
import type { VectorStore, VectorRecord } from '../../../src/providers/vector-store.js';

function makeProvider(opts: { delayMs?: number; fail?: boolean } = {}): {
  provider: EmbedProvider;
  embedSpy: ReturnType<typeof vi.fn>;
} {
  const embedSpy = vi.fn(async (texts: string[]) => {
    if (opts.fail) throw new Error('embed failed');
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    return texts.map(() => new Float32Array([0.1, 0.2, 0.3, 0.4]));
  });
  return {
    embedSpy,
    provider: { modelId: 'test-model', dim: 4, embed: embedSpy },
  };
}

function makeStore(): { store: VectorStore; records: VectorRecord[] } {
  const records: VectorRecord[] = [];
  const store: VectorStore = {
    upsert: vi.fn(async (rs: VectorRecord[]) => {
      records.push(...rs);
    }),
    search: vi.fn(async () => []),
    delete: vi.fn(async () => {}),
    size: vi.fn(async () => records.length),
  };
  return { store, records };
}

describe('BackgroundIndexQueue', () => {
  let tmp: string;
  let dbPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'wigolo-bgq-'));
    dbPath = join(tmp, 'jobs.db');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('enqueue returns synchronously without waiting on embed', () => {
    const { provider } = makeProvider({ delayMs: 500 });
    const { store } = makeStore();
    const q = new BackgroundIndexQueue({
      dbPath,
      embedProvider: async () => provider,
      vectorStore: async () => store,
    });
    const t0 = Date.now();
    q.enqueue({ url: 'https://a.example', text: 'hello world body', contentHash: 'h1' });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(50);
    q.shutdown();
  });

  it('drain processes all jobs and persists vectors via upsert', async () => {
    const { provider, embedSpy } = makeProvider();
    const { store, records } = makeStore();
    const q = new BackgroundIndexQueue({
      dbPath,
      embedProvider: async () => provider,
      vectorStore: async () => store,
    });
    q.enqueue({ url: 'https://a.example', text: 'doc one body', contentHash: 'h1' });
    q.enqueue({ url: 'https://b.example', text: 'doc two body', contentHash: 'h2' });
    q.enqueue({ url: 'https://c.example', text: 'doc three body', contentHash: 'h3' });
    await q.drain();
    expect(embedSpy).toHaveBeenCalledTimes(3);
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.id).sort()).toEqual([
      'https://a.example',
      'https://b.example',
      'https://c.example',
    ]);
    expect(records[0].metadata.modelId).toBe('test-model');
    expect(records[0].metadata.contentHash).toBe(
      records.find((r) => r.id === 'https://a.example')!.metadata.contentHash,
    );
    expect(q.pendingSize()).toBe(0);
    q.shutdown();
  });

  it('persists pending jobs across queue restart (SQLite-backed)', async () => {
    const q1 = new BackgroundIndexQueue({
      dbPath,
      embedProvider: async () => {
        throw new Error('should not be invoked when autoStart=false');
      },
      vectorStore: async () => {
        throw new Error('should not be invoked when autoStart=false');
      },
      autoStart: false,
    });
    q1.enqueue({ url: 'https://restart.example', text: 'persisting across restart', contentHash: 'hx' });
    expect(q1.pendingSize()).toBe(1);
    q1.shutdown();

    const { provider, embedSpy } = makeProvider();
    const { store, records } = makeStore();
    const q2 = new BackgroundIndexQueue({
      dbPath,
      embedProvider: async () => provider,
      vectorStore: async () => store,
    });
    expect(q2.pendingSize()).toBe(1);
    await q2.drain();
    expect(embedSpy).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('https://restart.example');
    q2.shutdown();
  });

  it('removes failed jobs after maxAttempts is exhausted', async () => {
    const { provider, embedSpy } = makeProvider({ fail: true });
    const { store } = makeStore();
    const q = new BackgroundIndexQueue({
      dbPath,
      embedProvider: async () => provider,
      vectorStore: async () => store,
      maxAttempts: 2,
    });
    q.enqueue({ url: 'https://err.example', text: 'will fail repeatedly', contentHash: 'he' });
    await q.drain();
    expect(embedSpy).toHaveBeenCalledTimes(2);
    expect(q.pendingSize()).toBe(0);
    q.shutdown();
  });

  it('sync mode awaits processing inside enqueue', async () => {
    const { provider, embedSpy } = makeProvider();
    const { store, records } = makeStore();
    const q = new BackgroundIndexQueue({
      dbPath,
      embedProvider: async () => provider,
      vectorStore: async () => store,
      syncMode: true,
    });
    await q.enqueue({ url: 'https://s.example', text: 'sync mode test body', contentHash: 'hs' });
    expect(embedSpy).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('https://s.example');
    q.shutdown();
  });

  it('coalesces duplicate enqueues by url (latest wins)', async () => {
    const { provider, embedSpy } = makeProvider();
    const { store, records } = makeStore();
    const q = new BackgroundIndexQueue({
      dbPath,
      embedProvider: async () => provider,
      vectorStore: async () => store,
      autoStart: false,
    });
    q.enqueue({ url: 'https://dup.example', text: 'first version', contentHash: 'v1' });
    q.enqueue({ url: 'https://dup.example', text: 'second version', contentHash: 'v2' });
    expect(q.pendingSize()).toBe(1);
    q.start();
    await q.drain();
    expect(embedSpy).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(1);
    expect(records[0].metadata.contentHash).toBe('v2');
    q.shutdown();
  });
});
