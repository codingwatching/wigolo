import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../src/search/v1/orchestrator.js', () => ({
  runV1Search: vi.fn(async () => ({
    results: [],
    enginesUsed: [],
    degraded: false,
  })),
}));

import { V1SearchProvider } from '../../../../src/search/v1/v1-provider.js';
import { runV1Search } from '../../../../src/search/v1/orchestrator.js';

const runV1SearchMock = vi.mocked(runV1Search);

const ctx = { router: undefined } as never;

describe('V1SearchProvider', () => {
  it('rejects category=images with explicit unsupported_category error', async () => {
    const provider = new V1SearchProvider();
    const result = await provider.search(
      { query: 'cats', category: 'images', max_results: 5 },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBe('unsupported_category');
      expect(result.error_reason).toMatch(/images vertical not supported in v1/);
      expect(result.stage).toBe('search');
    }
    expect(runV1SearchMock).not.toHaveBeenCalled();
  });

  it('passes other categories straight through to the orchestrator', async () => {
    runV1SearchMock.mockClear();
    runV1SearchMock.mockResolvedValueOnce({ results: [], enginesUsed: ['stub'], degraded: false });

    const provider = new V1SearchProvider();
    const result = await provider.search(
      { query: 'react server components', category: 'docs', max_results: 5 },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(runV1SearchMock).toHaveBeenCalledOnce();
    expect(runV1SearchMock.mock.calls[0][0].category).toBe('docs');
  });

  it('rejects an empty query before the images check', async () => {
    const provider = new V1SearchProvider();
    const result = await provider.search(
      { query: '   ', category: 'images', max_results: 5 },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      // Empty input takes precedence — we never reach the category check.
      expect(result.error).toBe('invalid_input');
    }
  });
});
