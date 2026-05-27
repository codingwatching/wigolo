/**
 * Tests for the cacheStats action.
 *
 * Why: cacheStats wraps the public cache API and must return the same shape
 * so the Dashboard can display accurate entry counts and age without
 * reaching into SQLite directly (SP5 spec constraint).
 * These tests stub the module-level import to avoid spinning up a real DB.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Stub the cache store module BEFORE importing the action
vi.mock('../../../../../src/cache/store.js', () => ({
  getCacheStats: vi.fn(() => ({
    total_urls: 42,
    total_size_mb: 1.5,
    oldest: '2025-01-01 00:00:00',
    newest: '2025-06-01 00:00:00',
  })),
}));

import {
  getCacheStatsAction,
  type CacheStatsResult,
} from '../../../../../src/cli/tui/actions/cache-stats.js';
import { getCacheStats } from '../../../../../src/cache/store.js';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getCacheStatsAction — normal path', () => {
  it('returns totalEntries, sizeMb, oldest, newest', async () => {
    const result = await getCacheStatsAction();
    expect(result.totalEntries).toBe(42);
    expect(result.sizeMb).toBeCloseTo(1.5);
    expect(result.oldest).toBe('2025-01-01 00:00:00');
    expect(result.newest).toBe('2025-06-01 00:00:00');
    expect(result.error).toBeUndefined();
  });

  it('delegates to getCacheStats from cache/store (public API — no internal SQLite)', async () => {
    await getCacheStatsAction();
    expect(getCacheStats).toHaveBeenCalledOnce();
  });
});

describe('getCacheStatsAction — empty cache', () => {
  it('returns zero counts when cache is empty', async () => {
    vi.mocked(getCacheStats).mockReturnValueOnce({
      total_urls: 0,
      total_size_mb: 0,
      oldest: '',
      newest: '',
    });
    const result = await getCacheStatsAction();
    expect(result.totalEntries).toBe(0);
    expect(result.sizeMb).toBe(0);
  });
});

describe('getCacheStatsAction — error path', () => {
  it('returns an error result when getCacheStats throws', async () => {
    vi.mocked(getCacheStats).mockImplementationOnce(() => {
      throw new Error('db locked');
    });
    const result = await getCacheStatsAction();
    expect(result.error).toMatch(/db locked/);
    expect(result.totalEntries).toBe(0);
  });
});

describe('CacheStatsResult shape', () => {
  it('result has expected fields', async () => {
    const result: CacheStatsResult = await getCacheStatsAction();
    expect(typeof result.totalEntries).toBe('number');
    expect(typeof result.sizeMb).toBe('number');
    expect(typeof result.oldest).toBe('string');
    expect(typeof result.newest).toBe('string');
  });
});
