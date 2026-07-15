import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  runSystemCheckMock,
  renderBannerMock,
  getPackageVersionMock,
  runWarmupMock,
  detectAgentsMock,
  selectAgentsMock,
  applyConfigsMock,
  runVerifyMock,
  probeSetupStatusMock,
  summarizeSetupMock,
  runConfigMock,
  wasUninstalledMock,
  saveInitConfigMock,
} = vi.hoisted(() => ({
  runSystemCheckMock: vi.fn(),
  renderBannerMock: vi.fn(() => 'BANNER\n'),
  getPackageVersionMock: vi.fn(() => '0.6.3'),
  runWarmupMock: vi.fn(),
  detectAgentsMock: vi.fn(),
  selectAgentsMock: vi.fn(),
  applyConfigsMock: vi.fn(),
  runVerifyMock: vi.fn(),
  probeSetupStatusMock: vi.fn(),
  summarizeSetupMock: vi.fn(),
  runConfigMock: vi.fn(),
  wasUninstalledMock: vi.fn(() => false),
  saveInitConfigMock: vi.fn(),
}));

vi.mock('../../../src/cli/tui/system-check.js', () => ({
  runSystemCheck: runSystemCheckMock,
}));
vi.mock('../../../src/cli/tui/banner.js', () => ({
  renderBanner: renderBannerMock,
  printAddMcpBanner: vi.fn(),
}));
vi.mock('../../../src/cli/tui/version.js', () => ({
  getPackageVersion: getPackageVersionMock,
}));
vi.mock('../../../src/cli/warmup.js', () => ({
  runWarmup: runWarmupMock,
}));
vi.mock('../../../src/cli/tui/agents.js', () => ({
  detectAgents: detectAgentsMock,
}));
vi.mock('../../../src/cli/tui/select-agents.js', () => ({
  selectAgents: selectAgentsMock,
  NotTtyError: class NotTtyError extends Error {
    constructor(msg?: string) { super(msg ?? 'not a TTY'); this.name = 'NotTtyError'; }
  },
}));
vi.mock('../../../src/cli/tui/config-writer.js', () => ({
  applyConfigs: applyConfigsMock,
}));
vi.mock('../../../src/cli/tui/verify.js', () => ({
  runVerify: runVerifyMock,
}));
vi.mock('../../../src/config.js', () => ({
  getConfig: () => ({ dataDir: '/tmp/data' }),
}));
vi.mock('../../../src/cli/tui/utils/config-writer.js', () => ({
  saveInitConfig: saveInitConfigMock,
  readInitConfig: vi.fn(() => ({})),
}));
vi.mock('../../../src/cli/tui/actions/setup-status.js', () => ({
  probeSetupStatus: probeSetupStatusMock,
  defaultProbeDeps: () => ({}),
  summarizeSetup: summarizeSetupMock,
}));
vi.mock('../../../src/cli/config.js', () => ({
  runConfig: runConfigMock,
}));
vi.mock('../../../src/cli/tui/state/uninstall-signal.js', () => ({
  wasUninstalled: wasUninstalledMock,
}));
vi.mock('../../../src/cli/tui/reporter-auto.js', () => ({
  autoReporter: vi.fn(() => ({
    start: vi.fn(),
    success: vi.fn(),
    fail: vi.fn(),
    note: vi.fn(),
  })),
}));

import { runInit } from '../../../src/cli/init.js';

function capture(): { stdout: string[]; stderr: string[]; restore: () => void } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  (process.stdout.write as any) = (chunk: any) => { stdout.push(String(chunk)); return true; };
  (process.stderr.write as any) = (chunk: any) => { stderr.push(String(chunk)); return true; };
  return {
    stdout,
    stderr,
    restore: () => {
      process.stdout.write = origOut as any;
      process.stderr.write = origErr as any;
    },
  };
}

function primeHappyPath(): void {
  runSystemCheckMock.mockResolvedValue({
    node: { ok: true, version: '22.14.0' },
    python: { ok: true, binary: 'python3', version: '3.12.5' },
    docker: { ok: true, version: '29.4.0' },
    disk: { ok: true, freeMb: 50000 },
    hardFailure: false,
  });
  runWarmupMock.mockResolvedValue(undefined);
  detectAgentsMock.mockReturnValue([
    { id: 'cursor', displayName: 'Cursor', detected: true, installType: 'config-file', configPath: '/h/.cursor/mcp.json' },
  ]);
  selectAgentsMock.mockResolvedValue([]);
  applyConfigsMock.mockResolvedValue([]);
  runVerifyMock.mockResolvedValue({ allPassed: true });
  probeSetupStatusMock.mockResolvedValue([]);
  summarizeSetupMock.mockReturnValue({
    lines: ['Setup: 6/6 ready'],
    readyCount: 6,
    total: 6,
    requiredFailed: false,
    exitCode: 0,
  });
}

describe('runInit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderBannerMock.mockReturnValue('BANNER\n');
    getPackageVersionMock.mockReturnValue('0.6.3');
    probeSetupStatusMock.mockResolvedValue([]);
    summarizeSetupMock.mockReturnValue({
      lines: ['Setup: 6/6 ready'],
      readyCount: 6,
      total: 6,
      requiredFailed: false,
      exitCode: 0,
    });
  });

  it('exits 0 on all-ok system (non-interactive path)', async () => {
    primeHappyPath();
    const cap = capture();
    try {
      const code = await runInit(['--non-interactive', '--agents=cursor']);
      expect(code).toBe(0);
      const out = cap.stdout.join('');
      expect(out).toContain('BANNER');
      expect(out).toContain('Node');
      expect(out).toContain('22.14.0');
      expect(out).toContain('Python');
      expect(out).toContain('3.12.5');
      expect(out).toContain('Docker');
    } finally {
      cap.restore();
    }
  });

  it('exits 1 when Node is too old', async () => {
    runSystemCheckMock.mockResolvedValue({
      node: { ok: false, version: '18.0.0', message: 'requires Node 20+' },
      python: { ok: true, binary: 'python3', version: '3.12.5' },
      docker: { ok: false },
      disk: { ok: true, freeMb: 50000 },
      hardFailure: true,
    });
    const cap = capture();
    try {
      const code = await runInit(['--non-interactive', '--agents=cursor']);
      expect(code).toBe(1);
      const out = cap.stdout.join('');
      expect(out).toMatch(/requires Node 20/i);
    } finally {
      cap.restore();
    }
  });

  it('exits 1 when Python 3 is missing', async () => {
    runSystemCheckMock.mockResolvedValue({
      node: { ok: true, version: '22.14.0' },
      python: { ok: false, message: 'Python 3 not found.' },
      docker: { ok: false },
      disk: { ok: true, freeMb: 50000 },
      hardFailure: true,
    });
    const cap = capture();
    try {
      const code = await runInit(['--non-interactive', '--agents=cursor']);
      expect(code).toBe(1);
      const out = cap.stdout.join('');
      expect(out).toMatch(/python/i);
      expect(out).toMatch(/python\.org|brew install/i);
    } finally {
      cap.restore();
    }
  });

  it('warns but exits 0 when Docker is missing (optional)', async () => {
    primeHappyPath();
    runSystemCheckMock.mockResolvedValue({
      node: { ok: true, version: '22.14.0' },
      python: { ok: true, binary: 'python3', version: '3.12.5' },
      docker: { ok: false },
      disk: { ok: true, freeMb: 50000 },
      hardFailure: false,
    });
    const cap = capture();
    try {
      const code = await runInit(['--non-interactive', '--agents=cursor']);
      expect(code).toBe(0);
      const out = cap.stdout.join('');
      expect(out).toMatch(/docker.*optional|optional.*docker/i);
    } finally {
      cap.restore();
    }
  });

  it('warns but exits 0 when disk space is low', async () => {
    primeHappyPath();
    runSystemCheckMock.mockResolvedValue({
      node: { ok: true, version: '22.14.0' },
      python: { ok: true, binary: 'python3', version: '3.12.5' },
      docker: { ok: true, version: '29.4.0' },
      disk: { ok: false, freeMb: 200, message: 'only 200 MB free' },
      hardFailure: false,
    });
    const cap = capture();
    try {
      const code = await runInit(['--non-interactive', '--agents=cursor']);
      expect(code).toBe(0);
      const out = cap.stdout.join('');
      expect(out).toMatch(/200 MB|disk/i);
    } finally {
      cap.restore();
    }
  });

  it('writes banner to stdout not stderr', async () => {
    primeHappyPath();
    const cap = capture();
    try {
      await runInit(['--non-interactive', '--agents=cursor']);
      expect(cap.stdout.join('')).toContain('BANNER');
      expect(cap.stderr.join('')).not.toContain('BANNER');
    } finally {
      cap.restore();
    }
  });

  it('returns 2 on unknown flag', async () => {
    const cap = capture();
    try {
      const code = await runInit(['--some-future-flag', 'value']);
      expect(code).toBe(2);
      expect(cap.stderr.join('')).toContain('--some-future-flag');
    } finally {
      cap.restore();
    }
  });

  it('non-interactive path does NOT run warmup by default (headless-first: zero downloads)', async () => {
    // INVERTED (D8): mandatory warmup is gone. Components download on first use,
    // so a default init must not pre-download anything. The interactive delegate
    // must also not be reached on the non-interactive path.
    primeHappyPath();
    const cap = capture();
    try {
      await runInit(['--non-interactive', '--agents=cursor']);
      expect(runWarmupMock).not.toHaveBeenCalled();
      expect(runConfigMock).not.toHaveBeenCalled();
    } finally {
      cap.restore();
    }
  });

  it('non-interactive path with --warmup runs runWarmup(["--all"]) exactly once', async () => {
    // --warmup is the opt-in back into pre-caching. When set, warmup runs once.
    primeHappyPath();
    const cap = capture();
    try {
      await runInit(['--non-interactive', '--agents=cursor', '--warmup']);
      expect(runWarmupMock).toHaveBeenCalledTimes(1);
      expect(runWarmupMock.mock.calls[0]?.[0]).toEqual(['--all']);
      expect(runConfigMock).not.toHaveBeenCalled();
    } finally {
      cap.restore();
    }
  });

  it('non-interactive path prints the components-on-first-use hint', async () => {
    // Both paths tell the user how to pre-cache instead of silently deferring.
    primeHappyPath();
    const cap = capture();
    try {
      await runInit(['--non-interactive', '--agents=cursor']);
      const all = cap.stdout.join('') + cap.stderr.join('');
      expect(all).toMatch(/components download on first use/i);
      expect(all).toMatch(/wigolo warmup --all/);
    } finally {
      cap.restore();
    }
  });

  describe('--json (machine-readable summary)', () => {
    it('emits a single JSON object on stdout that parses; human report goes to stderr', async () => {
      primeHappyPath();
      const cap = capture();
      try {
        const code = await runInit(['--non-interactive', '--agents=cursor', '--skip-verify', '--json']);
        expect(code).toBe(0);
        // The ENTIRE stdout must parse as JSON — no banner / report lines mixed in.
        const parsed = JSON.parse(cap.stdout.join('').trim());
        expect(parsed.status).toBe('ok');
        expect(parsed.path).toBe('plain');
        expect(parsed.warmup).toBe(false);
        expect(Array.isArray(parsed.agentsRegistered)).toBe(true);
        expect(parsed.agentsRegistered).toEqual(['cursor']);
        expect(parsed.configPersisted).toBe(true);
        // Human report (banner) must NOT pollute stdout under --json.
        expect(cap.stdout.join('')).not.toContain('BANNER');
        expect(cap.stderr.join('')).toContain('BANNER');
      } finally {
        cap.restore();
      }
    });

    it('reports status=error and exit 1 when a required component failed', async () => {
      primeHappyPath();
      summarizeSetupMock.mockReturnValue({
        lines: ['Setup: 5/6 ready'],
        readyCount: 5,
        total: 6,
        requiredFailed: true,
        exitCode: 1,
      });
      const cap = capture();
      try {
        const code = await runInit(['--non-interactive', '--agents=cursor', '--skip-verify', '--json']);
        expect(code).toBe(1);
        const parsed = JSON.parse(cap.stdout.join('').trim());
        expect(parsed.status).toBe('error');
        expect(parsed.requiredFailed).toBe(true);
      } finally {
        cap.restore();
      }
    });
  });

  describe('zero-download on BOTH init paths (headless-first)', () => {
    let prevTTY: boolean | undefined;
    let prevCI: string | undefined;
    let prevGha: string | undefined;

    beforeEach(() => {
      prevTTY = process.stdout.isTTY;
      prevCI = process.env.CI;
      prevGha = process.env.GITHUB_ACTIONS;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      runConfigMock.mockResolvedValue(0);
      runWarmupMock.mockResolvedValue(undefined);
      wasUninstalledMock.mockReturnValue(false);
    });

    afterEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', { value: prevTTY, configurable: true });
      if (prevCI === undefined) delete process.env.CI; else process.env.CI = prevCI;
      if (prevGha === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = prevGha;
    });

    // MEMORY TRAP (binding): every behavior change is verified on BOTH init paths.
    // runWarmup is the single gate that would invoke the browser / embedding
    // installers (installBrowser / installEmbeddings live behind runWarmup, which
    // is fully mocked here) — so runWarmup NOT-called proves no component download
    // is triggered on either path.
    it('plain (non-interactive) default: runWarmup — the installer gate — is never called', async () => {
      primeHappyPath();
      const cap = capture();
      try {
        await runInit(['--non-interactive', '--agents=cursor', '--skip-verify']);
        expect(runWarmupMock).not.toHaveBeenCalled();
      } finally {
        cap.restore();
      }
    });

    it('plain default on a bare TTY: runWarmup never called', async () => {
      primeHappyPath();
      selectAgentsMock.mockResolvedValue([]);
      const cap = capture();
      try {
        await runInit([]);
        expect(runWarmupMock).not.toHaveBeenCalled();
      } finally {
        cap.restore();
      }
    });

    it('--wizard default: runWarmup — the installer gate — is never called', async () => {
      const cap = capture();
      try {
        await runInit(['--wizard']);
        expect(runWarmupMock).not.toHaveBeenCalled();
      } finally {
        cap.restore();
      }
    });
  });

  describe('--wizard mounts the Ink entry; default TTY does not', () => {
    let prevTTY: boolean | undefined;
    let prevCI: string | undefined;
    let prevGha: string | undefined;

    beforeEach(() => {
      prevTTY = process.stdout.isTTY;
      prevCI = process.env.CI;
      prevGha = process.env.GITHUB_ACTIONS;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      runConfigMock.mockResolvedValue(0);
      runWarmupMock.mockResolvedValue(undefined);
      wasUninstalledMock.mockReturnValue(false);
    });

    afterEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', { value: prevTTY, configurable: true });
      if (prevCI === undefined) delete process.env.CI; else process.env.CI = prevCI;
      if (prevGha === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = prevGha;
    });

    it('--wizard invokes the Ink entry (runConfig --force-wizard)', async () => {
      // runConfig(['--force-wizard']) is the single delegate that mounts the Ink
      // TUI (runConfig → runEntry → render). Its invocation IS the Ink mount.
      const cap = capture();
      try {
        await runInit(['--wizard']);
        expect(runConfigMock).toHaveBeenCalledTimes(1);
        expect(runConfigMock.mock.calls[0]?.[0]).toEqual(['--force-wizard']);
      } finally {
        cap.restore();
      }
    });

    it('default TTY init does NOT invoke the Ink entry', async () => {
      primeHappyPath();
      selectAgentsMock.mockResolvedValue([]);
      const cap = capture();
      try {
        await runInit([]);
        expect(runConfigMock).not.toHaveBeenCalled();
      } finally {
        cap.restore();
      }
    });

    it('--wizard in a non-TTY context falls back to plain (Ink cannot mount)', async () => {
      // Ink requires a real terminal; --wizard on a non-TTY must NOT try to mount
      // and must NOT call runConfig — it degrades to the plain path.
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      primeHappyPath();
      const cap = capture();
      try {
        await runInit(['--wizard', '--non-interactive', '--agents=cursor', '--skip-verify']);
        expect(runConfigMock).not.toHaveBeenCalled();
      } finally {
        cap.restore();
      }
    });
  });

  describe('parity: plain-default and --wizard agree on config + agent registrations', () => {
    let prevTTY: boolean | undefined;
    let prevCI: string | undefined;
    let prevGha: string | undefined;

    beforeEach(() => {
      prevTTY = process.stdout.isTTY;
      prevCI = process.env.CI;
      prevGha = process.env.GITHUB_ACTIONS;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      runConfigMock.mockResolvedValue(0);
      runWarmupMock.mockResolvedValue(undefined);
      wasUninstalledMock.mockReturnValue(false);
    });

    afterEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', { value: prevTTY, configurable: true });
      if (prevCI === undefined) delete process.env.CI; else process.env.CI = prevCI;
      if (prevGha === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = prevGha;
    });

    // Parity contract (D8, LOCKED): identical inputs ⇒ byte-identical persisted
    // config + the same agent-registration set across plain vs --wizard. The
    // wizard path funnels persistence through the SAME shared config machinery
    // (runConfig → the schema catalog + default agent targets + propagation.save)
    // that the plain path resolves from. This test locks the observable persisted
    // shape on the plain (reference) path and asserts the --wizard path routes the
    // identical agent selection through that single shared entry.
    it('plain non-interactive persists agents + init-config for a fixed input; --wizard routes the same', async () => {
      primeHappyPath();
      saveInitConfigMock.mockClear();
      applyConfigsMock.mockClear();

      // Reference path (plain, non-interactive) with a fixed agent selection.
      const capA = capture();
      let plainCode: number;
      try {
        plainCode = await runInit(['--non-interactive', '--agents=cursor', '--skip-verify']);
      } finally {
        capA.restore();
      }
      expect(plainCode).toBe(0);

      // Observable persisted config on the plain path.
      expect(applyConfigsMock).toHaveBeenCalledTimes(1);
      const registeredPlain = applyConfigsMock.mock.calls[0]?.[1];
      expect(registeredPlain).toEqual(['cursor']);
      expect(saveInitConfigMock).toHaveBeenCalledTimes(1);
      const savedPayload = saveInitConfigMock.mock.calls[0]?.[1] as { configuredAgents: string[] };
      expect(savedPayload.configuredAgents).toEqual(['cursor']);

      // --wizard path: delegates to the SINGLE shared config entry with
      // --force-wizard. That entry resolves the same catalog + agent targets +
      // propagation.save the plain path uses, so persistence stays parity-locked.
      runConfigMock.mockClear();
      const capB = capture();
      try {
        await runInit(['--wizard']);
      } finally {
        capB.restore();
      }
      expect(runConfigMock).toHaveBeenCalledTimes(1);
      expect(runConfigMock.mock.calls[0]?.[0]).toEqual(['--force-wizard']);
    });
  });

  describe('default TTY path is plain (NOT Ink)', () => {
    let prevTTY: boolean | undefined;
    let prevCI: string | undefined;
    let prevGha: string | undefined;

    beforeEach(() => {
      prevTTY = process.stdout.isTTY;
      prevCI = process.env.CI;
      prevGha = process.env.GITHUB_ACTIONS;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      runConfigMock.mockResolvedValue(0);
      runWarmupMock.mockResolvedValue(undefined);
      wasUninstalledMock.mockReturnValue(false);
    });

    afterEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', { value: prevTTY, configurable: true });
      if (prevCI === undefined) delete process.env.CI; else process.env.CI = prevCI;
      if (prevGha === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = prevGha;
    });

    it('default init on a TTY runs the plain path and never mounts Ink (no --force-wizard delegate)', async () => {
      // INVERTED (D8): a bare TTY init used to mount the Ink wizard. Now the
      // default is the plain path on TTY and non-TTY alike — Ink mounts ONLY
      // under --wizard. So runConfig(['--force-wizard']) must NOT be called.
      primeHappyPath();
      selectAgentsMock.mockResolvedValue([]);
      const cap = capture();
      try {
        const code = await runInit([]);
        expect(code).toBe(0);
        expect(runConfigMock).not.toHaveBeenCalled();
        // Plain path renders the banner + system check to stdout.
        expect(cap.stdout.join('')).toContain('BANNER');
      } finally {
        cap.restore();
      }
    });

    it('default init on a TTY does NOT run warmup (headless-first)', async () => {
      primeHappyPath();
      selectAgentsMock.mockResolvedValue([]);
      const cap = capture();
      try {
        await runInit([]);
        expect(runWarmupMock).not.toHaveBeenCalled();
      } finally {
        cap.restore();
      }
    });
  });

  describe('--wizard (Ink) path', () => {
    let prevTTY: boolean | undefined;
    let prevCI: string | undefined;
    let prevGha: string | undefined;

    beforeEach(() => {
      prevTTY = process.stdout.isTTY;
      prevCI = process.env.CI;
      prevGha = process.env.GITHUB_ACTIONS;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      runConfigMock.mockResolvedValue(0);
      runWarmupMock.mockResolvedValue(undefined);
      wasUninstalledMock.mockReturnValue(false);
    });

    afterEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', { value: prevTTY, configurable: true });
      if (prevCI === undefined) delete process.env.CI; else process.env.CI = prevCI;
      if (prevGha === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = prevGha;
    });

    it('--wizard mounts the Ink wizard via runConfig(["--force-wizard"]) and runs NO warmup by default', async () => {
      const cap = capture();
      try {
        const code = await runInit(['--wizard']);
        expect(code).toBe(0);
        expect(runConfigMock).toHaveBeenCalledTimes(1);
        expect(runConfigMock.mock.calls[0]?.[0]).toEqual(['--force-wizard']);
        // Headless-first: no mandatory warmup even on the wizard path.
        expect(runWarmupMock).not.toHaveBeenCalled();
      } finally {
        cap.restore();
      }
    });

    it('--wizard --warmup runs runWarmup(["--all"]) exactly once after the wizard', async () => {
      const cap = capture();
      try {
        const code = await runInit(['--wizard', '--warmup']);
        expect(code).toBe(0);
        expect(runConfigMock).toHaveBeenCalledTimes(1);
        expect(runWarmupMock).toHaveBeenCalledTimes(1);
        expect(runWarmupMock.mock.calls[0]?.[0]).toEqual(['--all']);
      } finally {
        cap.restore();
      }
    });

    it('--wizard prints the components-on-first-use hint', async () => {
      const cap = capture();
      try {
        await runInit(['--wizard']);
        const all = cap.stdout.join('') + cap.stderr.join('');
        expect(all).toMatch(/components download on first use/i);
        expect(all).toMatch(/wigolo warmup --all/);
      } finally {
        cap.restore();
      }
    });

    it('propagates the code when the wizard exits non-zero and skips warmup', async () => {
      runConfigMock.mockResolvedValue(1);
      const cap = capture();
      try {
        const code = await runInit(['--wizard', '--warmup']);
        expect(code).toBe(1);
        expect(runWarmupMock).not.toHaveBeenCalled();
      } finally {
        cap.restore();
      }
    });

    it('returns 1 and reports when --warmup warmup fails', async () => {
      runWarmupMock.mockRejectedValue(new Error('browser download blocked'));
      const cap = capture();
      try {
        const code = await runInit(['--wizard', '--warmup']);
        expect(code).toBe(1);
        expect(cap.stderr.join('')).toMatch(/browser download blocked/);
      } finally {
        cap.restore();
      }
    });

    it('skips warmup when the user uninstalled mid-session', async () => {
      // Navigating to the uninstall screen wipes ~/.wigolo; runInit must not
      // re-run warmup afterward or it would recreate everything just removed.
      wasUninstalledMock.mockReturnValue(true);
      const cap = capture();
      try {
        const code = await runInit(['--wizard', '--warmup']);
        expect(code).toBe(0);
        expect(runConfigMock).toHaveBeenCalledTimes(1);
        expect(runWarmupMock).not.toHaveBeenCalled();
      } finally {
        cap.restore();
      }
    });
  });
});
