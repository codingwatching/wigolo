import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleFetch } from '../../../src/tools/fetch.js';
import type { SmartRouter } from '../../../src/fetch/router.js';
import { initDatabase, closeDatabase } from '../../../src/cache/db.js';
import { resetConfig } from '../../../src/config.js';

describe('fetch mode validation', () => {
  beforeEach(() => { initDatabase(':memory:'); resetConfig(); });
  afterEach(() => { closeDatabase(); resetConfig(); });

  it('rejects unknown mode', async () => {
    const router = { fetch: vi.fn() } as unknown as SmartRouter;
    await expect(
      handleFetch({ url: 'https://example.com', mode: 'turbo' as 'fast' }, router),
    ).rejects.toThrow(/mode.*fast.*balanced.*deep/i);
  });
});
