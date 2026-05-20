import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getSearchProvider, _resetSearchProviderForTest } from '../../../src/providers/search-provider.js';
import { resetConfig } from '../../../src/config.js';
import { LegacySearxngProvider } from '../../../src/search/legacy/searxng-provider.js';
import { V1SearchProvider } from '../../../src/search/v1/v1-provider.js';

describe('getSearchProvider', () => {
  let originalEnv: string | undefined;
  beforeEach(() => {
    originalEnv = process.env.WIGOLO_SEARCH;
    _resetSearchProviderForTest();
    resetConfig();
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.WIGOLO_SEARCH;
    else process.env.WIGOLO_SEARCH = originalEnv;
    _resetSearchProviderForTest();
    resetConfig();
  });

  it('returns LegacySearxngProvider by default', async () => {
    delete process.env.WIGOLO_SEARCH;
    expect(await getSearchProvider()).toBeInstanceOf(LegacySearxngProvider);
  });

  it('returns LegacySearxngProvider when WIGOLO_SEARCH=searxng', async () => {
    process.env.WIGOLO_SEARCH = 'searxng';
    expect(await getSearchProvider()).toBeInstanceOf(LegacySearxngProvider);
  });

  it('returns V1SearchProvider when WIGOLO_SEARCH=v1', async () => {
    process.env.WIGOLO_SEARCH = 'v1';
    const provider = await getSearchProvider();
    expect(provider).toBeInstanceOf(V1SearchProvider);
    expect(provider.name).toBe('v1');
  });

  it('rejects on unknown value', async () => {
    process.env.WIGOLO_SEARCH = 'tavily';
    await expect(getSearchProvider()).rejects.toThrow(/WIGOLO_SEARCH/);
  });

  it('recovers from prior rejection on next call', async () => {
    process.env.WIGOLO_SEARCH = 'tavily';
    await expect(getSearchProvider()).rejects.toThrow(/WIGOLO_SEARCH/);
    // The unknown-value path never sets `cached`, so the next call with a
    // valid value must succeed without needing _resetSearchProviderForTest.
    process.env.WIGOLO_SEARCH = 'searxng';
    expect(await getSearchProvider()).toBeInstanceOf(LegacySearxngProvider);
  });
});
