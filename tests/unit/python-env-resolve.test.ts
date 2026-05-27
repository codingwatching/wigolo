import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/cli/tui/detect-helpers.js', () => ({
  binaryInPath: vi.fn(),
}));

import { binaryInPath } from '../../src/cli/tui/detect-helpers.js';
import { resolvePythonExe } from '../../src/python-env.js';

describe('resolvePythonExe', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns python3 when python3 is present', () => {
    vi.mocked(binaryInPath).mockImplementation((name) =>
      name === 'python3' ? '/usr/bin/python3' : null,
    );
    expect(resolvePythonExe()).toBe('python3');
  });

  it('falls back to python when only python is present', () => {
    vi.mocked(binaryInPath).mockImplementation((name) =>
      name === 'python' ? 'C:\\Python312\\python.exe' : null,
    );
    expect(resolvePythonExe()).toBe('python');
  });

  it('returns python3 even when python is also available (python3 preferred)', () => {
    vi.mocked(binaryInPath).mockImplementation((name) =>
      name === 'python3' ? '/usr/bin/python3' : '/usr/bin/python',
    );
    expect(resolvePythonExe()).toBe('python3');
  });

  it('returns python3 as default string when neither is available', () => {
    vi.mocked(binaryInPath).mockReturnValue(null);
    // Neither available — callers should handle runtime failure; we return
    // the conventional fallback string so a meaningful error surfaces downstream.
    expect(resolvePythonExe()).toBe('python3');
  });
});
