import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetConfig } from '../../src/config.js';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: vi.fn() };
});

import { existsSync } from 'node:fs';
import { getPythonBin, venvBinPath } from '../../src/python-env.js';

describe('venvBinPath', () => {
  it('returns Scripts/python.exe on win32', () => {
    const result = venvBinPath('/home/user/.wigolo', 'python', 'win32');
    expect(result).toMatch(/Scripts[/\\]python\.exe$/);
  });

  it('returns Scripts/pip.exe on win32', () => {
    const result = venvBinPath('/home/user/.wigolo', 'pip', 'win32');
    expect(result).toMatch(/Scripts[/\\]pip\.exe$/);
  });

  it('returns bin/python on linux', () => {
    const result = venvBinPath('/home/user/.wigolo', 'python', 'linux');
    expect(result).toMatch(/bin[/\\]python$/);
    expect(result).not.toContain('.exe');
  });

  it('returns bin/pip on darwin', () => {
    const result = venvBinPath('/home/user/.wigolo', 'pip', 'darwin');
    expect(result).toMatch(/bin[/\\]pip$/);
    expect(result).not.toContain('.exe');
  });

  it('uses process.platform when not provided', () => {
    // Should not throw regardless of host platform
    const result = venvBinPath('/home/user/.wigolo', 'python');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('builds path under venv subdir', () => {
    const result = venvBinPath('/data/wigolo', 'python', 'linux');
    expect(result).toContain('venv');
  });
});

describe('getPythonBin', () => {
  beforeEach(() => { resetConfig(); vi.clearAllMocks(); });
  afterEach(() => { resetConfig(); delete process.env.WIGOLO_DATA_DIR; });

  it('returns venv python when venv exists', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const bin = getPythonBin('/tmp/wigolo');
    expect(bin).toMatch(/[/\\]python(\.exe)?$/);
  });

  it('falls back to system python3 when venv does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const bin = getPythonBin('/tmp/wigolo');
    expect(bin).toBe('python3');
  });

  it('resolves dataDir from config when argument omitted', () => {
    vi.mocked(existsSync).mockImplementation((p) => {
      const s = String(p);
      return s.includes('from-config') && s.includes('venv');
    });
    process.env.WIGOLO_DATA_DIR = '/tmp/from-config';
    const bin = getPythonBin();
    expect(bin).toContain('from-config');
  });

  it('returns python3 fallback when venv python missing under config dataDir', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    process.env.WIGOLO_DATA_DIR = '/tmp/no-venv';
    const bin = getPythonBin();
    expect(bin).toBe('python3');
  });
});
