import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

vi.mock('../../src/cli/tui/detect-helpers.js', () => ({
  binaryInPath: vi.fn(() => '/usr/bin/python3'),
}));

import { spawnSync } from 'node:child_process';
import {
  checkVenvModule,
  isMissingVenvModuleError,
  venvInstallHint,
  __resetResolvedPythonExe,
} from '../../src/python-env.js';

type SpawnResult = ReturnType<typeof spawnSync>;
function spawnResult(status: number | null, stdout = '', error?: Error): SpawnResult {
  return { status, stdout, stderr: '', signal: null, pid: 1, output: [], error } as unknown as SpawnResult;
}

describe('checkVenvModule', () => {
  beforeEach(() => { vi.clearAllMocks(); __resetResolvedPythonExe(); });

  it('reports available + version when ensurepip and venv import cleanly', () => {
    // WHY: a healthy install must NOT trip the apt-hint path — otherwise we would
    // nag users who already have a working venv.
    vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
      const a = (args ?? []) as string[];
      if (a.join(' ').includes('version_info')) return spawnResult(0, '3.12\n');
      return spawnResult(0);
    });
    const r = checkVenvModule('python3');
    expect(r.available).toBe(true);
    expect(r.pythonVersion).toBe('3.12');
  });

  it('reports unavailable when the ensurepip/venv import fails (Debian symptom)', () => {
    // WHY: on Debian/Ubuntu the venv module is in stdlib but ensurepip ships in
    // the separate python3-venv apt package, so `import ensurepip, venv` exits 1.
    vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
      const a = (args ?? []) as string[];
      if (a.join(' ').includes('version_info')) return spawnResult(0, '3.11\n');
      return spawnResult(1); // import ensurepip, venv → ModuleNotFoundError
    });
    const r = checkVenvModule('python3');
    expect(r.available).toBe(false);
    expect(r.pythonVersion).toBe('3.11');
  });

  it('treats an unrunnable interpreter as "available" so the real error surfaces', () => {
    // WHY: if `python3 -c ...` cannot even run, that is a "python not found /
    // broken" problem, NOT a missing python3-venv package. We must not show the
    // apt hint here — let the normal interpreter-failure path surface instead.
    vi.mocked(spawnSync).mockReturnValue(spawnResult(null, '', new Error('ENOENT')));
    const r = checkVenvModule('python3');
    expect(r.available).toBe(true);
    expect(r.pythonVersion).toBeUndefined();
  });
});

describe('isMissingVenvModuleError', () => {
  it('recognizes the ensurepip stderr signature', () => {
    expect(isMissingVenvModuleError(
      'Error: Command ... -m ensurepip ... returned non-zero exit status 1.',
    )).toBe(true);
  });

  it('recognizes the "No module named venv" signature', () => {
    expect(isMissingVenvModuleError("ModuleNotFoundError: No module named 'venv'")).toBe(true);
  });

  it('recognizes the apt-package mention', () => {
    expect(isMissingVenvModuleError('You may need to install the python3-venv package')).toBe(true);
  });

  it('does NOT misfire on an unrelated pip failure', () => {
    // WHY: detection-driven message — we must not show apt guidance for a
    // generic network/dependency failure during pip install.
    expect(isMissingVenvModuleError('ERROR: Could not find a version that satisfies requirement')).toBe(false);
  });

  it('returns false for empty stderr', () => {
    expect(isMissingVenvModuleError('')).toBe(false);
  });
});

describe('venvInstallHint', () => {
  it('names the exact versioned package when version is known', () => {
    const hint = venvInstallHint('3.12');
    expect(hint).toContain('sudo apt install python3.12-venv');
    expect(hint).toContain('python3-venv'); // generic fallback mentioned too
    expect(hint).toContain('core backend');
  });

  it('falls back to generic python3-venv when version unknown', () => {
    const hint = venvInstallHint();
    expect(hint).toContain('sudo apt install python3-venv');
    expect(hint).not.toContain('python3.');
  });
});
