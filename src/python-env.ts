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

/**
 * Returns the first Python interpreter found on PATH: tries `python3` then
 * `python`. Falls back to the string `'python3'` when neither is detected so
 * that callers surface a clear "not found" error at execution time rather than
 * silently passing an empty string.
 *
 * Reuses `binaryInPath()` which already handles `which` vs `where` (Windows).
 */
export function resolvePythonExe(): string {
  if (binaryInPath('python3') !== null) return 'python3';
  if (binaryInPath('python') !== null) return 'python';
  return 'python3'; // conventional fallback — will fail at spawn with a clear error
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
