import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const readEnvSettingsMock = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    WIGOLO_SEARCH: 'core',
    WIGOLO_LOG_LEVEL: 'info',
  }),
);
const runEntryMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    resolution: { mode: 'home', firstRun: false, headless: false },
    mounted: true,
  }),
);

vi.mock('../../../src/cli/tui/actions/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/cli/tui/actions/index.js')>();
  return {
    ...actual,
    readEnvSettings: readEnvSettingsMock,
  };
});

vi.mock('../../../src/cli/tui/entry.js', () => ({
  runEntry: runEntryMock,
  resolveEntry: vi.fn(),
}));

vi.mock('../../../src/config.js', () => ({
  getConfig: () => ({ dataDir: '/home/.wigolo' }),
}));

import { runConfig } from '../../../src/cli/config.js';

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runConfig — non-interactive (non-TTY)', () => {
  it('prints settings to stdout and exits 0 in non-TTY mode', async () => {
    const code = await runConfig([]);
    expect(code).toBe(0);
    expect(process.stdout.write).toHaveBeenCalled();
    // should NOT mount Ink
    expect(runEntryMock).not.toHaveBeenCalled();
  });

  it('--plain forces non-interactive output even in TTY mode', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const code = await runConfig(['--plain']);
    expect(code).toBe(0);
    expect(runEntryMock).not.toHaveBeenCalled();
  });

  it('--help prints usage and exits 0', async () => {
    const code = await runConfig(['--help']);
    expect(code).toBe(0);
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    expect(runEntryMock).not.toHaveBeenCalled();
  });

  it('CI=true prevents Ink mount even with TTY', async () => {
    const origCI = process.env.CI;
    process.env.CI = 'true';
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const code = await runConfig([]);
    expect(code).toBe(0);
    expect(runEntryMock).not.toHaveBeenCalled();
    process.env.CI = origCI;
  });
});

describe('runConfig — interactive (TTY)', () => {
  it('mounts Ink when TTY and not plain', async () => {
    const origCI = process.env.CI;
    delete process.env.CI;
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const code = await runConfig([]);
    expect(code).toBe(0);
    expect(runEntryMock).toHaveBeenCalledOnce();
    process.env.CI = origCI;
  });
});
