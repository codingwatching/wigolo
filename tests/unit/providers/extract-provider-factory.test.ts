import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getExtractProvider,
  _resetExtractProviderForTest,
} from '../../../src/providers/extract-provider.js';
import { LegacyExtractProvider } from '../../../src/extraction/legacy-provider.js';

describe('getExtractProvider', () => {
  beforeEach(() => { _resetExtractProviderForTest(); });
  afterEach(() => { _resetExtractProviderForTest(); });

  it('returns LegacyExtractProvider', async () => {
    expect(await getExtractProvider()).toBeInstanceOf(LegacyExtractProvider);
  });

  it('memoizes the resolved provider', async () => {
    const a = await getExtractProvider();
    const b = await getExtractProvider();
    expect(a).toBe(b);
  });

  it('exposes legacy name', async () => {
    const p = await getExtractProvider();
    expect(p.name).toBe('legacy');
  });
});
