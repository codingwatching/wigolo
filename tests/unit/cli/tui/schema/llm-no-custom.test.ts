/**
 * Fix D regression test: the `custom` option must be removed from the LLM
 * provider field. The custom URL escape hatch works via setting WIGOLO_LLM_PROVIDER
 * env var to a URL directly — the schema option only confused users who expected
 * an "endpoint URL" field that the schema couldn't actually fulfil.
 *
 * After Fix D:
 *   - Provider options: exactly ['anthropic', 'openai', 'gemini'] (no 'custom').
 *   - The llmBaseUrl conditional field (visible when provider === 'custom') is removed.
 *   - Exactly 2 fields remain: llmProvider + llmApiKey.
 */
import { describe, it, expect } from 'vitest';
import { llmCategory } from '../../../../../src/cli/tui/schema/llm.js';

describe('llmCategory — no custom provider (Fix D)', () => {
  it('provider options array has exactly 3 entries: anthropic, openai, gemini', () => {
    const provider = llmCategory.fields.find((f) => f.settingsPath === 'llmProvider');
    const values = provider?.options?.map((o) => o.value) ?? [];
    expect(values).toEqual(['anthropic', 'openai', 'gemini']);
    expect(values).not.toContain('custom');
  });

  it('llmCategory has exactly 2 fields after removing custom + endpoint URL field', () => {
    const paths = llmCategory.fields.map((f) => f.settingsPath);
    expect(paths).toEqual(['llmProvider', 'llmApiKey']);
    expect(paths).not.toContain('llmBaseUrl');
  });

  it('no field references provider === custom in a visible predicate', () => {
    for (const field of llmCategory.fields) {
      if (typeof field.visible === 'function') {
        // If visible returns true when provider is 'custom', that's the dead field.
        const visibleForCustom = field.visible({
          current: { llmProvider: 'custom' },
          pending: {},
        });
        expect(visibleForCustom).toBe(false);
      }
    }
  });
});
