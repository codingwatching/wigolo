import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Crawler, type FetchFn, type RawFetchFn } from '../../src/crawl/crawler.js';
import type { FetchOutput } from '../../src/types.js';

vi.mock('../../src/config.js', () => ({
  getConfig: () => ({
    crawlConcurrency: 2,
    crawlDelayMs: 0,
    crawlPrivateConcurrency: 10,
    crawlPrivateDelayMs: 0,
    respectRobotsTxt: false,
    logLevel: 'error',
    logFormat: 'json',
    dataDir: tmpdir(),
  }),
  resetConfig: vi.fn(),
}));

vi.mock('../../src/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const embedSpy = vi.fn(async (texts: string[]) => {
  // Simulate slow ONNX embedding (per-call cost the queue must absorb).
  await new Promise((r) => setTimeout(r, 500));
  return texts.map(() => new Float32Array([0.1, 0.2, 0.3, 0.4]));
});

const upsertSpy = vi.fn(async () => {});

vi.mock('../../src/providers/embed-provider.js', () => ({
  getEmbedProvider: vi.fn(async () => ({
    embed: embedSpy,
    dim: 4,
    modelId: 'test-model',
  })),
}));

vi.mock('../../src/providers/vector-store.js', () => ({
  getVectorStore: vi.fn(async () => ({
    upsert: upsertSpy,
    search: vi.fn(async () => []),
    delete: vi.fn(async () => {}),
    size: vi.fn(async () => 0),
  })),
}));

function makeFetchOutput(url: string, title: string, body: string): FetchOutput {
  return {
    url,
    title,
    markdown: body,
    metadata: {},
    links: [],
    images: [],
    cached: false,
  };
}

describe('crawl latency under WIGOLO_CRAWL_INDEX=1', () => {
  let tmp: string;
  let prevCrawlIndex: string | undefined;
  let prevDataDir: string | undefined;

  beforeEach(async () => {
    embedSpy.mockClear();
    upsertSpy.mockClear();

    prevCrawlIndex = process.env.WIGOLO_CRAWL_INDEX;
    prevDataDir = process.env.WIGOLO_DATA_DIR;
    process.env.WIGOLO_CRAWL_INDEX = '1';
    tmp = mkdtempSync(join(tmpdir(), 'wigolo-crawl-lat-'));
    process.env.WIGOLO_DATA_DIR = tmp;
    delete process.env.WIGOLO_WAIT_FOR_INDEX;

    const bgq = await import('../../src/embedding/background-queue.js');
    bgq._resetBackgroundIndexQueueForTest();
  });

  afterEach(async () => {
    const bgq = await import('../../src/embedding/background-queue.js');
    bgq._resetBackgroundIndexQueueForTest();
    rmSync(tmp, { recursive: true, force: true });
    if (prevCrawlIndex === undefined) delete process.env.WIGOLO_CRAWL_INDEX;
    else process.env.WIGOLO_CRAWL_INDEX = prevCrawlIndex;
    if (prevDataDir === undefined) delete process.env.WIGOLO_DATA_DIR;
    else process.env.WIGOLO_DATA_DIR = prevDataDir;
  });

  it('crawler returns within latency budget even when embed is slow', async () => {
    const fetchFn: FetchFn = vi.fn(async (url: string) => {
      return makeFetchOutput(url, `Page ${url}`, 'A sufficiently long markdown body for indexing eligibility.');
    });
    const rawFetchFn: RawFetchFn = vi.fn(async () => ({
      url: '',
      finalUrl: '',
      html: '',
      contentType: 'text/plain',
      statusCode: 200,
      method: 'http' as const,
      headers: {},
    }));

    const seedUrls = [
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
      'https://example.com/d',
      'https://example.com/e',
    ];

    let fetchCount = 0;
    (fetchFn as ReturnType<typeof vi.fn>).mockImplementation(async (u: string) => {
      const idx = fetchCount++;
      const links = idx === 0 ? seedUrls.slice(1) : [];
      return { ...makeFetchOutput(u, `Page ${u}`, 'A sufficiently long markdown body for indexing eligibility.'), links };
    });

    const crawler = new Crawler(fetchFn, rawFetchFn);
    const t0 = Date.now();
    const out = await crawler.crawl({
      url: seedUrls[0],
      strategy: 'bfs',
      max_depth: 1,
      max_pages: 5,
    });
    const elapsed = Date.now() - t0;

    expect(out.pages.length).toBe(5);
    // 5 embeds × 500ms = 2.5s if synchronous. Background queue must keep
    // crawl response well under that budget.
    expect(elapsed).toBeLessThan(1200);

    // Drain to confirm the work eventually runs.
    const bgq = await import('../../src/embedding/background-queue.js');
    await bgq.getBackgroundIndexQueue().drain();
    expect(embedSpy).toHaveBeenCalled();
    expect(upsertSpy).toHaveBeenCalled();
  });

  it('WIGOLO_WAIT_FOR_INDEX=1 makes crawler wait for embeds (opt-in sync mode)', async () => {
    process.env.WIGOLO_WAIT_FOR_INDEX = '1';
    const bgq = await import('../../src/embedding/background-queue.js');
    bgq._resetBackgroundIndexQueueForTest();

    const fetchFn: FetchFn = vi.fn(async (url: string) => {
      return makeFetchOutput(url, `Page ${url}`, 'A sufficiently long markdown body for indexing eligibility.');
    });
    const rawFetchFn: RawFetchFn = vi.fn(async () => ({
      url: '',
      finalUrl: '',
      html: '',
      contentType: 'text/plain',
      statusCode: 200,
      method: 'http' as const,
      headers: {},
    }));

    const crawler = new Crawler(fetchFn, rawFetchFn);
    const t0 = Date.now();
    await crawler.crawl({
      url: 'https://sync.example/a',
      strategy: 'bfs',
      max_depth: 0,
      max_pages: 1,
    });
    const elapsed = Date.now() - t0;

    // One page × 500ms embed delay → with sync mode crawl must wait ≥ 400ms.
    expect(elapsed).toBeGreaterThanOrEqual(400);

    delete process.env.WIGOLO_WAIT_FOR_INDEX;
  });
});
