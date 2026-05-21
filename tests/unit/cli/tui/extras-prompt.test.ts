import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  input: vi.fn(),
}));

import { select, input } from '@inquirer/prompts';
import { promptExtras } from '../../../../src/cli/tui/extras-prompt.js';

const selectMock = vi.mocked(select);
const inputMock = vi.mocked(input);

describe('promptExtras', () => {
  let dir: string;

  beforeEach(() => {
    selectMock.mockReset();
    inputMock.mockReset();
    dir = mkdtempSync(join(tmpdir(), 'wigolo-extras-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty + writes nothing when user picks skip + blanks', async () => {
    selectMock.mockResolvedValueOnce('skip');
    inputMock.mockResolvedValueOnce('');
    inputMock.mockResolvedValueOnce('');

    const result = await promptExtras(dir);
    expect(result).toEqual({});
    expect(existsSync(join(dir, 'config.json'))).toBe(false);
  });

  it('persists engine selection only when not skip', async () => {
    selectMock.mockResolvedValueOnce('v1');
    inputMock.mockResolvedValueOnce('');
    inputMock.mockResolvedValueOnce('');

    const result = await promptExtras(dir);
    expect(result.engine).toBe('v1');
    const cfg = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf-8'));
    expect(cfg.engine).toBe('v1');
  });

  it('parses comma-separated RSS feeds and persists as array', async () => {
    selectMock.mockResolvedValueOnce('skip');
    inputMock.mockResolvedValueOnce(' https://a.example/feed , https://b.example/feed ,');
    inputMock.mockResolvedValueOnce('');

    const result = await promptExtras(dir);
    expect(result.rssFeeds).toEqual([
      'https://a.example/feed',
      'https://b.example/feed',
    ]);
    const cfg = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf-8'));
    expect(cfg.rssFeeds).toEqual(['https://a.example/feed', 'https://b.example/feed']);
  });

  it('persists llmEndpoint when non-blank', async () => {
    selectMock.mockResolvedValueOnce('skip');
    inputMock.mockResolvedValueOnce('');
    inputMock.mockResolvedValueOnce('http://localhost:11434/v1');

    const result = await promptExtras(dir);
    expect(result.llmEndpoint).toBe('http://localhost:11434/v1');
  });

  it('treats Ctrl-C / ExitPromptError as skip-all', async () => {
    selectMock.mockRejectedValueOnce(new Error('User force closed the prompt with 0 null'));

    const result = await promptExtras(dir);
    expect(result).toEqual({});
  });

  it('preserves other fields in config.json (merge semantics)', async () => {
    const cfgPath = join(dir, 'config.json');
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(cfgPath, JSON.stringify({ configuredAgents: ['claude-code'] }));

    selectMock.mockResolvedValueOnce('v1');
    inputMock.mockResolvedValueOnce('');
    inputMock.mockResolvedValueOnce('');

    await promptExtras(dir);
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    expect(cfg.configuredAgents).toEqual(['claude-code']);
    expect(cfg.engine).toBe('v1');
  });
});
