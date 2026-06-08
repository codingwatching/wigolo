import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getConfig } from './config.js';
import { binaryInPath } from './cli/tui/detect-helpers.js';

/**
 * Returns the path to a venv binary (`python` or `pip`) for the given data
 * directory, cross-platform:
 *   Windows (win32)  →  <dataDir>/searxng/venv/Scripts/<name>.exe
 *   POSIX            →  <dataDir>/searxng/venv/bin/<name>
 *
 * Pass `platform` explicitly in tests to avoid depending on the host OS.
 */
export function venvBinPath(
  dataDir: string,
  name: 'python' | 'pip',
  platform: string = process.platform,
): string {
  if (platform === 'win32') {
    return join(dataDir, 'searxng', 'venv', 'Scripts', `${name}.exe`);
  }
  return join(dataDir, 'searxng', 'venv', 'bin', name);
}

let _resolvedPythonExe: string | null = null;

/**
 * Returns the first Python interpreter found on PATH: tries `python3` then
 * `python`. Falls back to the string `'python3'` when neither is detected so
 * that callers surface a clear "not found" error at execution time rather than
 * silently passing an empty string.
 *
 * Reuses `binaryInPath()` which already handles `which` vs `where` (Windows).
 * Result is memoized — the interpreter set does not change within a process,
 * so warm-path callers avoid repeated `which`/`where` subprocess spawns.
 */
export function resolvePythonExe(): string {
  if (_resolvedPythonExe !== null) return _resolvedPythonExe;
  if (binaryInPath('python3') !== null) return (_resolvedPythonExe = 'python3');
  if (binaryInPath('python') !== null) return (_resolvedPythonExe = 'python');
  return (_resolvedPythonExe = 'python3'); // conventional fallback — fails at spawn with a clear error
}

/** Test-only: clear the memoized interpreter so platform-mocked tests re-resolve. */
export function __resetResolvedPythonExe(): void {
  _resolvedPythonExe = null;
}

export interface VenvModuleCheck {
  /** True when `python -m venv` can actually create environments. */
  available: boolean;
  /** Detected `<major>.<minor>` Python version, when probeable (e.g. `3.12`). */
  pythonVersion?: string;
}

/**
 * Probes whether the Python interpreter can create virtual environments.
 *
 * On Debian/Ubuntu the `python3-venv` system package is not installed by
 * default, so `python3 -m venv <dir>` exits 1 with a cryptic `ensurepip` /
 * `No module named venv` error. We probe cheaply with `python -m venv --help`
 * (which loads both `venv` and, on stdlib paths, surfaces the missing-ensurepip
 * symptom) so callers can emit actionable guidance *before* a real venv
 * creation fails opaquely.
 *
 * The Python version is parsed in the same pass so callers can suggest the
 * exact package name (`python3.12-venv` for Python 3.12).
 */
export function checkVenvModule(pythonExe: string = resolvePythonExe()): VenvModuleCheck {
  const result: VenvModuleCheck = { available: false };

  const version = spawnSync(
    pythonExe,
    ['-c', "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"],
    { encoding: 'utf-8' },
  );
  if (version.status !== 0 || version.error) {
    // The interpreter itself could not run — that is a "python not available"
    // problem, not a "venv module missing" one. Report available=true so the
    // caller's normal flow surfaces the real interpreter error rather than a
    // misleading apt hint.
    result.available = true;
    return result;
  }
  const parsed = version.stdout.trim();
  if (/^\d+\.\d+$/.test(parsed)) result.pythonVersion = parsed;

  // `import ensurepip, venv` is the classic missing-python3-venv tripwire on
  // Debian: the venv module is present in stdlib but ensurepip is shipped in
  // the separate `python3-venv` apt package.
  const probe = spawnSync(pythonExe, ['-c', 'import ensurepip, venv'], { encoding: 'utf-8' });
  result.available = probe.status === 0 && !probe.error;
  return result;
}

/**
 * Returns true when the given stderr is the recognizable "python3-venv package
 * missing" symptom rather than some other venv-creation failure. Detection-
 * driven so callers only show apt guidance when it actually applies.
 */
export function isMissingVenvModuleError(stderr: string): boolean {
  if (!stderr) return false;
  return (
    /ensurepip/i.test(stderr) ||
    /No module named ['"]?venv/i.test(stderr) ||
    /python3?-venv/i.test(stderr) ||
    // `python3 -m venv` on Debian prints this when ensurepip is unavailable.
    /returned non-zero exit status 1.*ensurepip/i.test(stderr) ||
    /The virtual environment was not created successfully/i.test(stderr)
  );
}

/**
 * Builds an actionable, OS-specific install hint for the missing venv module.
 * Names the exact `python3.X-venv` package when the version is known, with the
 * generic `python3-venv` as a fallback. Naming the apt package here is
 * intentional troubleshooting guidance (the documented warmup/doctor
 * exception), not implementation-dep leakage.
 */
export function venvInstallHint(pythonVersion?: string): string {
  const versioned = pythonVersion ? `python${pythonVersion}-venv` : undefined;
  const pkg = versioned ?? 'python3-venv';
  const suffix = versioned ? ` (or python3-venv)` : '';
  return (
    `python3 venv module not available. On Debian/Ubuntu, run: ` +
    `sudo apt install ${pkg}${suffix}. ` +
    `Search will use the built-in core backend until this is fixed.`
  );
}

/**
 * Returns the Python binary to use for every Python operation — pip installs,
 * import availability checks, and long-lived subprocess spawns. Prefers the
 * SearXNG venv python (created by bootstrap) to guarantee that warmup, doctor,
 * and runtime all hit the same interpreter and see the same packages.
 * Falls back to system `python3` when the venv has not been created yet.
 */
export function getPythonBin(dataDir?: string): string {
  const dir = dataDir ?? getConfig().dataDir;
  if (!dir) return 'python3';
  const venvPython = venvBinPath(dir, 'python');
  return existsSync(venvPython) ? venvPython : 'python3';
}
