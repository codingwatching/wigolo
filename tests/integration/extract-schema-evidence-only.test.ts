/**
 * Integration test at the `extract` tool boundary for schema mode: the
 * local-model ladder AND the evidence-only filter, end-to-end through
 * `handleExtract`.
 *
 * The unit tests cover the verifier and the local-llm prompt builder in
 * isolation; this test pins the tool-boundary contract so a future refactor of
 * the handler can't bypass the ladder or the filter.
 *
 * Ladder (this slice):
 *   resolveLocalModelTier() available  → run the local model over the
 *                                        deterministic pre-extraction, then
 *                                        evidence-filter model-proposed fields.
 *   local model returns null (invalid / timeout) → deterministic fallback.
 *   resolveLocalModelTier() null (off / down)    → pure deterministic path,
 *                                        NO model call at all.
 *
 * Regression case:
 *   On Wikipedia/Model_Context_Protocol with schema {name, developer, introduced}:
 *     the model proposed developer: "Nvidia", introduced: "May 2024"
 *     — both wrong (real values: Anthropic / Nov 2024). The evidence-only
 *     filter must null them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase } from '../../src/cache/db.js';
import { resetConfig } from '../../src/config.js';
import type { SmartRouter } from '../../src/fetch/router.js';
import type { LocalModelTier } from '../../src/integrations/cloud/llm/local-tier.js';

// Mock the C0 tier resolver (gates the local-model rung) and the local-model
// extraction call (produces the model's schema output). Both are mocked so the
// ladder logic is exercised deterministically with no live server.
vi.mock('../../src/integrations/cloud/llm/local-tier.js', () => ({
  resolveLocalModelTier: vi.fn(),
}));
vi.mock('../../src/extraction/v1/local-llm.js', () => ({
  extractWithLocalLlm: vi.fn(),
}));

import { handleExtract } from '../../src/tools/extract.js';
import { extractWithLocalLlm } from '../../src/extraction/v1/local-llm.js';
import { resolveLocalModelTier } from '../../src/integrations/cloud/llm/local-tier.js';

const TIER: LocalModelTier = {
  available: true,
  endpoint: 'http://localhost:11434',
  model: 'qwen2.5:7b-instruct',
  source: 'auto',
};

// MCP-like Wikipedia infobox excerpt. Source contains the real facts.
const MCP_WIKI_LIKE_HTML = `
<!doctype html>
<html><body>
<h1>Model Context Protocol</h1>
<table class="infobox">
  <tr><th>Developer(s)</th><td>Anthropic</td></tr>
  <tr><th>Initial release</th><td>November 25, 2024</td></tr>
</table>
<p>The Model Context Protocol (MCP) is an open standard introduced by
Anthropic in November 2024.</p>
</body></html>
`;

const MCP_SCHEMA = {
  type: 'object',
  required: ['name', 'developer', 'introduced'],
  properties: {
    name: { type: 'string' },
    developer: { type: 'string' },
    introduced: { type: 'string' },
  },
};

// Deterministic-friendly fixture: a <dl> the structure fuzzy-matcher CAN map for
// `name` + `developer`, but `introduced` is only in prose (a genuine gap). This
// is the shape that actually exercises the ladder: the model rung IS entered
// because a required field is missing, and the deterministically-sourced fields
// must survive whatever the model does.
const PARTIAL_DL_HTML = `
<!doctype html>
<html><body>
<h1>Acme Widget</h1>
<dl>
  <dt>name</dt><dd>Acme Widget</dd>
  <dt>developer</dt><dd>Anthropic</dd>
</dl>
<p>Introduced in November 2024 for teams everywhere.</p>
</body></html>
`;

function noopRouter(): SmartRouter {
  // html input path bypasses the router; this satisfies the parameter shape.
  return {
    fetch: vi.fn(),
    getDomainStats: () => undefined,
  } as unknown as SmartRouter;
}

describe('integration: extract tool — schema mode local-model ladder (C1)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.WIGOLO_LLM_PROVIDER;
    resetConfig();
    initDatabase(':memory:');
    vi.mocked(extractWithLocalLlm).mockReset();
    vi.mocked(resolveLocalModelTier).mockReset();
  });

  afterEach(() => {
    closeDatabase();
    process.env = originalEnv;
    resetConfig();
  });

  it('nulls hallucinated model fields at the tool boundary (no Nvidia / May 2024 ever)', async () => {
    vi.mocked(resolveLocalModelTier).mockResolvedValue(TIER);
    // Simulate the audit failure: the model returns wrong values.
    vi.mocked(extractWithLocalLlm).mockResolvedValue({
      name: 'Model Context Protocol',
      developer: 'Nvidia',
      introduced: 'May 2024',
    });

    const result = await handleExtract(
      { html: MCP_WIKI_LIKE_HTML, mode: 'schema', schema: MCP_SCHEMA },
      noopRouter(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data.data as Record<string, unknown>;
    // Hallucinated values must never escape through the tool boundary.
    expect(data.developer).not.toBe('Nvidia');
    expect(data.introduced).not.toBe('May 2024');
    expect(data.developer).toBeNull();
    expect(data.introduced).toBeNull();
    // The name value is in source, so it survives the filter.
    expect(data.name).toBe('Model Context Protocol');

    // Warnings surface the evidence-only filter action so callers can debug.
    expect(result.data.warnings).toBeDefined();
    const warningText = (result.data.warnings ?? []).join(' ').toLowerCase();
    expect(warningText).toContain('evidence');
  });

  it('preserves model-extracted values when present in source (positive case)', async () => {
    vi.mocked(resolveLocalModelTier).mockResolvedValue(TIER);
    vi.mocked(extractWithLocalLlm).mockResolvedValue({
      name: 'Model Context Protocol',
      developer: 'Anthropic',
      introduced: 'November 25, 2024',
    });

    const result = await handleExtract(
      { html: MCP_WIKI_LIKE_HTML, mode: 'schema', schema: MCP_SCHEMA },
      noopRouter(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data.data as Record<string, unknown>;
    expect(data.name).toBe('Model Context Protocol');
    expect(data.developer).toBe('Anthropic');
    expect(data.introduced).toBe('November 25, 2024');
  });

  it('falls back to the deterministic result when the model returns null (invalid / timeout)', async () => {
    vi.mocked(resolveLocalModelTier).mockResolvedValue(TIER);
    // Model call failed → null. `introduced` was the gap that triggered the
    // model rung; the deterministically-sourced fields must still survive.
    vi.mocked(extractWithLocalLlm).mockResolvedValue(null);

    const result = await handleExtract(
      { html: PARTIAL_DL_HTML, mode: 'schema', schema: MCP_SCHEMA },
      noopRouter(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data.data as Record<string, unknown>;
    // Deterministic structure-first extraction fills these from the <dl>.
    expect(data.name).toBe('Acme Widget');
    expect(data.developer).toBe('Anthropic');
    // The model was invoked (tier was available, `introduced` was missing) but
    // produced nothing usable — the gap stays unfilled, no crash.
    expect(extractWithLocalLlm).toHaveBeenCalledTimes(1);
    expect(data.introduced).toBeUndefined();
  });

  it('takes the pure deterministic path with NO model call when the tier is null (off / down)', async () => {
    // WHY: the non-negotiable byte-for-byte guarantee — with the local tier off
    // (the keyless default), the code path must be identical to the deterministic
    // behavior and must not invoke the local model at all.
    vi.mocked(resolveLocalModelTier).mockResolvedValue(null);

    const result = await handleExtract(
      { html: PARTIAL_DL_HTML, mode: 'schema', schema: MCP_SCHEMA },
      noopRouter(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data.data as Record<string, unknown>;
    // Deterministic extraction from the <dl>.
    expect(data.name).toBe('Acme Widget');
    expect(data.developer).toBe('Anthropic');
    // The model rung was never entered.
    expect(extractWithLocalLlm).not.toHaveBeenCalled();
  });
});
