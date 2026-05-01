import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleSearch } from '../../../src/tools/search.js';
import type { SmartRouter } from '../../../src/fetch/router.js';
import { initDatabase, closeDatabase } from '../../../src/cache/db.js';
import { resetConfig } from '../../../src/config.js';

describe('search mode validation', () => {
  beforeEach(() => { initDatabase(':memory:'); resetConfig(); });
  afterEach(() => { closeDatabase(); resetConfig(); });

  it('rejects unknown mode with a clear message', async () => {
    const router = { fetch: vi.fn() } as unknown as SmartRouter;
    await expect(
      handleSearch({ query: 'x', mode: 'turbo' as 'fast' }, [], router),
    ).rejects.toThrow(/mode.*fast.*balanced.*deep/i);
  });
});
