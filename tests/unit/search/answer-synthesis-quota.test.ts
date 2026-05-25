import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as runLlmModule from '../../../src/integrations/cloud/llm/run.js';
import { runSynthesis } from '../../../src/search/answer-synthesis.js';
import type { SearchResultItem } from '../../../src/types.js';

function makeResult(overrides: Partial<SearchResultItem> = {}): SearchResultItem {
  return {
    title: overrides.title ?? 'PostgreSQL 18 Release',
    url: overrides.url ?? 'https://www.postgresql.org/docs/18/release-18.html',
    snippet: overrides.snippet ?? 'PG 18 introduces async I/O and UUIDv7',
    relevance_score: overrides.relevance_score ?? 0.9,
    markdown_content:
      overrides.markdown_content ??
      'PostgreSQL 18 ships asynchronous I/O and built-in UUIDv7 generation.',
  };
}

describe('runSynthesis quota detection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.WIGOLO_LLM_PROVIDER = 'gemini';
    process.env.GOOGLE_API_KEY = 'test-key';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('surfaces synthesis_status=quota_exceeded when LLM returns 429 quota error', async () => {
    const quotaErr = Object.assign(
      new Error(
        'You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-2.5-pro. RESOURCE_EXHAUSTED',
      ),
      { status: 429 },
    );
    process.env.WIGOLO_LLM_MODEL_GEMINI = 'gemini-2.5-pro';
    vi.spyOn(runLlmModule, 'runLlmText').mockRejectedValue(quotaErr);

    const r = await runSynthesis({
      query: 'PG 18 features',
      results: [makeResult()],
      maxTotalChars: 9000,
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.synthesis_status).toBe('quota_exceeded');
      expect(r.data.synthesis_provider).toBe('gemini');
      expect(r.data.synthesis_model).toBe('gemini-2.5-pro');
      expect(r.data.synthesis_advice).toMatch(/gemini-2\.5-flash/i);
      expect(r.data.warning).toMatch(/quota exceeded/i);
      expect(r.data.fallback_level).toBe(2);
    }
  });

  it('does not flag quota_exceeded for non-quota errors', async () => {
    vi.spyOn(runLlmModule, 'runLlmText').mockRejectedValue(
      new Error('connection reset by peer'),
    );

    const r = await runSynthesis({
      query: 'q',
      results: [makeResult()],
      maxTotalChars: 9000,
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.synthesis_status).not.toBe('quota_exceeded');
    }
  });

  it('detects quota error from message even when status is missing', async () => {
    vi.spyOn(runLlmModule, 'runLlmText').mockRejectedValue(
      new Error('RESOURCE_EXHAUSTED: free_tier quota exhausted, model gemini-2.5-pro'),
    );

    const r = await runSynthesis({
      query: 'q',
      results: [makeResult()],
      maxTotalChars: 9000,
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.synthesis_status).toBe('quota_exceeded');
    }
  });
});
