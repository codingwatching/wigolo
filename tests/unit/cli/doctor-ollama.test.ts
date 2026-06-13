import { describe, it, expect } from 'vitest';
import { buildOllamaDoctorLines } from '../../../src/cli/doctor.js';

describe('buildOllamaDoctorLines', () => {
  it('emits an enable-hint when a server is reachable and NO LLM is configured', () => {
    // WHY: the whole point of autodetect is discoverability — a reachable local
    // server with no configured LLM is exactly when the user should learn the lever.
    const lines = buildOllamaDoctorLines({
      llmConfigured: false,
      ollamaActive: false,
      reachable: true,
      baseUrl: 'http://localhost:11434',
    });
    const joined = lines.join('\n');
    expect(joined).toMatch(/local llm server detected/i);
    expect(joined).toContain('http://localhost:11434');
    expect(joined).toMatch(/WIGOLO_LLM_PROVIDER=ollama/);
    expect(joined).toMatch(/no api key/i);
  });

  it('does NOT nag when an LLM is already configured, even if a server is reachable', () => {
    // WHY: hinting at a lever the user already pulled (or pulled a different one)
    // is noise — the hint must be suppressed whenever any LLM is configured.
    const lines = buildOllamaDoctorLines({
      llmConfigured: true,
      ollamaActive: false,
      reachable: true,
      baseUrl: 'http://localhost:11434',
    });
    expect(lines.join('\n')).not.toMatch(/detected/i);
  });

  it('emits NO hint when the server is unreachable', () => {
    // WHY: absence of a server means there is nothing to enable — no hint, no noise.
    const lines = buildOllamaDoctorLines({
      llmConfigured: false,
      ollamaActive: false,
      reachable: false,
      baseUrl: 'http://localhost:11434',
    });
    expect(lines).toEqual([]);
  });

  it('shows resolved base URL + model when ollama is the active provider', () => {
    // WHY: when ollama IS active, doctor must surface WHAT it resolved (base + model)
    // so the user can confirm the right server/model is wired, not just "configured".
    const lines = buildOllamaDoctorLines({
      llmConfigured: true,
      ollamaActive: true,
      reachable: true,
      baseUrl: 'http://localhost:11434',
      model: 'llama3.1:8b',
    });
    const joined = lines.join('\n');
    expect(joined).toMatch(/ollama/i);
    expect(joined).toContain('http://localhost:11434');
    expect(joined).toContain('llama3.1:8b');
    expect(joined).not.toMatch(/detected/i);
  });

  it('shows the ollama active section even when the server is mid-run unreachable', () => {
    // WHY: an active-but-down ollama should still be reported as the configured
    // provider (graceful fallback happens at runtime) — not silently hidden.
    const lines = buildOllamaDoctorLines({
      llmConfigured: true,
      ollamaActive: true,
      reachable: false,
      baseUrl: 'http://localhost:11434',
    });
    expect(lines.join('\n')).toMatch(/ollama/i);
  });
});
