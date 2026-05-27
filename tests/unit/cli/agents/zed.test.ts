import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: vi.fn(() => tmpHome) };
});

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { homedir } from 'node:os';

let tmpHome: string;

beforeEach(() => {
  tmpHome = join(tmpdir(), `wigolo-zed-test-${Date.now()}`);
  mkdirSync(tmpHome, { recursive: true });
  vi.mocked(homedir).mockReturnValue(tmpHome);
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('zedHandler.detect', () => {
  it('returns true when ~/.config/zed exists', async () => {
    mkdirSync(join(tmpHome, '.config', 'zed'), { recursive: true });
    const { zedHandler } = await import('../../../../src/cli/agents/zed.js');
    expect(zedHandler.detect()).toBe(true);
  });

  it('returns true when `zed` binary is on PATH', async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/bin/zed'));
    const { zedHandler } = await import('../../../../src/cli/agents/zed.js');
    expect(zedHandler.detect()).toBe(true);
  });

  it('returns false when neither dir nor binary found', async () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('not found'); });
    const { zedHandler } = await import('../../../../src/cli/agents/zed.js');
    expect(zedHandler.detect()).toBe(false);
  });
});

describe('zedHandler.installMcp', () => {
  it('writes context_servers.wigolo into ~/.config/zed/settings.json', async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    const { zedHandler } = await import('../../../../src/cli/agents/zed.js');
    await zedHandler.installMcp({ command: 'npx', args: ['-y', '@staticn0va/wigolo'] });
    const cfgPath = join(tmpHome, '.config', 'zed', 'settings.json');
    expect(existsSync(cfgPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    expect(parsed.context_servers.wigolo.command).toBe('npx');
    expect(parsed.context_servers.wigolo.args).toEqual(['-y', '@staticn0va/wigolo']);
  });

  it('preserves existing settings.json keys', async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    const zedDir = join(tmpHome, '.config', 'zed');
    mkdirSync(zedDir, { recursive: true });
    const cfgPath = join(zedDir, 'settings.json');
    writeFileSync(cfgPath, JSON.stringify({ theme: 'one-dark' }));
    const { zedHandler } = await import('../../../../src/cli/agents/zed.js');
    await zedHandler.installMcp({ command: 'npx', args: ['-y', '@staticn0va/wigolo'] });
    const parsed = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    expect(parsed.theme).toBe('one-dark');
    expect(parsed.context_servers.wigolo).toBeDefined();
  });
});

describe('zedHandler.installInstructions', () => {
  it('creates ~/.config/zed/instructions/wigolo.md with wigolo block', async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    const { zedHandler } = await import('../../../../src/cli/agents/zed.js');
    await zedHandler.installInstructions();
    const target = join(tmpHome, '.config', 'zed', 'instructions', 'wigolo.md');
    expect(existsSync(target)).toBe(true);
    const content = readFileSync(target, 'utf-8');
    expect(content).toContain('<!-- wigolo:start');
    expect(content).toContain('wigolo MCP tools');
    expect(content).toContain('<!-- wigolo:end -->');
  });
});

describe('zedHandler.uninstall', () => {
  it('removes wigolo from settings.json', async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    const { zedHandler } = await import('../../../../src/cli/agents/zed.js');
    await zedHandler.installMcp({ command: 'npx', args: ['-y', '@staticn0va/wigolo'] });
    const result = await zedHandler.uninstall();
    const cfgPath = join(tmpHome, '.config', 'zed', 'settings.json');
    const parsed = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    expect(parsed.context_servers?.wigolo).toBeUndefined();
    expect(result.removed.length).toBeGreaterThan(0);
  });

  it('removes the instructions file if present', async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    const { zedHandler } = await import('../../../../src/cli/agents/zed.js');
    await zedHandler.installInstructions();
    const target = join(tmpHome, '.config', 'zed', 'instructions', 'wigolo.md');
    expect(existsSync(target)).toBe(true);
    const result = await zedHandler.uninstall();
    expect(existsSync(target)).toBe(false);
    expect(result.removed.some((r) => r.includes('wigolo.md'))).toBe(true);
  });
});

describe('zedHandler metadata', () => {
  it('has id=zed, supportsSkills=false', async () => {
    const { zedHandler } = await import('../../../../src/cli/agents/zed.js');
    expect(zedHandler.id).toBe('zed');
    expect(zedHandler.supportsSkills).toBe(false);
    expect(zedHandler.supportsCommands).toBe(false);
  });
});
