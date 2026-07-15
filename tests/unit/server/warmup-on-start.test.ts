import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ensureProviderReady = vi.fn().mockResolvedValue(true);
const rerankWarmup = vi.fn().mockResolvedValue(undefined);
const getRerankProvider = vi.fn().mockResolvedValue({
  modelId: 'mock-rerank',
  rerank: vi.fn().mockResolvedValue([]),
  warmup: rerankWarmup,
});

// Eager warmup now primes the embedding provider through the service's lazy
// ensureProviderReady() (D2) rather than reaching into the embed provider
// factory directly.
vi.mock('../../../src/embedding/embed.js', () => ({
  getEmbeddingService: () => ({
    ensureProviderReady,
  }),
}));
vi.mock('../../../src/providers/rerank-provider.js', () => ({
  getRerankProvider,
}));

import {
  maybeEagerWarmup,
  isEagerWarmupEnabled,
  _getWarmupPendingForTest,
} from '../../../src/server/warmup-on-start.js';

describe('maybeEagerWarmup', () => {
  const originalEnv = process.env.WIGOLO_EAGER_WARMUP;

  beforeEach(() => {
    ensureProviderReady.mockClear().mockResolvedValue(true);
    rerankWarmup.mockClear().mockResolvedValue(undefined);
    getRerankProvider.mockClear();
  });

  afterEach(async () => {
    // Drain any in-flight warmup so it doesn't leak between tests.
    const p = _getWarmupPendingForTest();
    if (p) await p;
    if (originalEnv === undefined) {
      delete process.env.WIGOLO_EAGER_WARMUP;
    } else {
      process.env.WIGOLO_EAGER_WARMUP = originalEnv;
    }
  });

  it('is a no-op when WIGOLO_EAGER_WARMUP is unset', async () => {
    delete process.env.WIGOLO_EAGER_WARMUP;
    expect(isEagerWarmupEnabled()).toBe(false);

    maybeEagerWarmup();
    // Allow a microtask flush — nothing should have been scheduled.
    await Promise.resolve();
    await Promise.resolve();

    expect(ensureProviderReady).not.toHaveBeenCalled();
    expect(getRerankProvider).not.toHaveBeenCalled();
    expect(_getWarmupPendingForTest()).toBeNull();
  });

  it('warms both providers when WIGOLO_EAGER_WARMUP=1', async () => {
    process.env.WIGOLO_EAGER_WARMUP = '1';
    expect(isEagerWarmupEnabled()).toBe(true);

    maybeEagerWarmup();
    const pending = _getWarmupPendingForTest();
    expect(pending).not.toBeNull();
    await pending;

    expect(ensureProviderReady).toHaveBeenCalledTimes(1);
    expect(getRerankProvider).toHaveBeenCalledTimes(1);
    expect(rerankWarmup).toHaveBeenCalledTimes(1);
  });

  it('returns synchronously before warmup completes', async () => {
    process.env.WIGOLO_EAGER_WARMUP = '1';
    let resolveEmbed: (() => void) | null = null;
    ensureProviderReady.mockImplementationOnce(
      () => new Promise<boolean>((res) => { resolveEmbed = () => res(true); }),
    );

    const before = Date.now();
    maybeEagerWarmup();
    const elapsed = Date.now() - before;

    expect(elapsed).toBeLessThan(50);
    expect(_getWarmupPendingForTest()).not.toBeNull();

    // Drain microtasks so the warmEmbed body runs and calls ensureProviderReady.
    while (resolveEmbed === null) {
      await Promise.resolve();
    }
    (resolveEmbed as () => void)();
  });

  it('still attempts rerank when embed warmup throws', async () => {
    process.env.WIGOLO_EAGER_WARMUP = '1';
    ensureProviderReady.mockRejectedValueOnce(new Error('embed boom'));

    maybeEagerWarmup();
    await _getWarmupPendingForTest();

    expect(ensureProviderReady).toHaveBeenCalledTimes(1);
    expect(rerankWarmup).toHaveBeenCalledTimes(1);
  });

  it('does not throw when rerank warmup throws', async () => {
    process.env.WIGOLO_EAGER_WARMUP = '1';
    rerankWarmup.mockRejectedValueOnce(new Error('rerank boom'));

    expect(() => maybeEagerWarmup()).not.toThrow();
    await expect(_getWarmupPendingForTest()).resolves.toBeUndefined();
    expect(ensureProviderReady).toHaveBeenCalledTimes(1);
    expect(rerankWarmup).toHaveBeenCalledTimes(1);
  });

  it('clears the pending promise after warmup settles', async () => {
    process.env.WIGOLO_EAGER_WARMUP = '1';

    maybeEagerWarmup();
    const pending = _getWarmupPendingForTest();
    expect(pending).not.toBeNull();
    await pending;

    expect(_getWarmupPendingForTest()).toBeNull();
  });

  it('primes the embedding provider via the service ensureProviderReady path', async () => {
    process.env.WIGOLO_EAGER_WARMUP = '1';

    maybeEagerWarmup();
    await _getWarmupPendingForTest();

    // Eager warmup drives the lazy provider load through the service, not a
    // direct provider-factory warmup — this is the single seam that primes it.
    expect(ensureProviderReady).toHaveBeenCalledTimes(1);
    expect(rerankWarmup).toHaveBeenCalledTimes(1);
  });
});
