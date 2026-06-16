import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetConfig } from '../../../src/config.js';
import { resetPersistedConfig } from '../../../src/persisted-config.js';
import { SessionBrowser, type LaunchOptions, type LaunchedSessionBrowser } from '../../../src/studio/session-browser.js';

/**
 * A fake launcher: records launch options + close calls so SessionBrowser's
 * lifecycle is testable without a real browser (the real Playwright launcher is
 * exercised by the RUN_STUDIO_HEADED integration test).
 */
function makeFake() {
  const calls = { browserClose: 0, contextClose: 0, pageClose: 0, gotos: [] as string[] };
  let launchOpts: LaunchOptions | null = null;
  let launchCount = 0;
  const page = {
    close: async () => { calls.pageClose++; },
    goto: async (url: string) => { calls.gotos.push(url); return null; },
    on: (_e: string, _cb: () => void) => {},
  };
  const cdp = { send: async () => ({}), on: (_e: string, _cb: (p: unknown) => void) => {} };
  const browser = { close: async () => { calls.browserClose++; }, on: (_e: string, _cb: () => void) => {} };
  const context = { close: async () => { calls.contextClose++; } };
  const launch = async (opts: LaunchOptions): Promise<LaunchedSessionBrowser> => {
    launchOpts = opts;
    launchCount++;
    return { browser, context, page, cdp } as unknown as LaunchedSessionBrowser;
  };
  return { calls, launch, page, cdp, getLaunchOpts: () => launchOpts, getLaunchCount: () => launchCount };
}

describe('SessionBrowser', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'wigolo-sb-'));
    process.env.WIGOLO_CONFIG_PATH = join(tmp, 'config.json');
    resetPersistedConfig();
    resetConfig();
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    resetPersistedConfig();
    resetConfig();
  });

  it('start() launches headed with the configured screencast viewport and exposes page + cdp', async () => {
    const fake = makeFake();
    const sb = new SessionBrowser({ sessionId: 's1', launch: fake.launch });
    await sb.start();
    expect(fake.getLaunchOpts()).toEqual({ headless: false, viewport: { width: 1280, height: 720 } });
    expect(sb.page).toBe(fake.page);
    expect(sb.cdp).toBe(fake.cdp);
  });

  it('start() is idempotent — a second call does not relaunch', async () => {
    const fake = makeFake();
    const sb = new SessionBrowser({ sessionId: 's1', launch: fake.launch });
    await sb.start();
    await sb.start();
    expect(fake.getLaunchCount()).toBe(1);
  });

  it('navigate() navigates to the url and records it as currentUrl', async () => {
    const fake = makeFake();
    const sb = new SessionBrowser({ sessionId: 's1', launch: fake.launch });
    await sb.start();
    expect(sb.currentUrl).toBe('');
    await sb.navigate('https://example.com/');
    expect(fake.calls.gotos).toEqual(['https://example.com/']);
    expect(sb.currentUrl).toBe('https://example.com/');
  });

  it('close() closes page, context, and browser exactly once and is idempotent', async () => {
    const fake = makeFake();
    const sb = new SessionBrowser({ sessionId: 's1', launch: fake.launch });
    await sb.start();
    await sb.close();
    await sb.close();
    expect(fake.calls.pageClose).toBe(1);
    expect(fake.calls.contextClose).toBe(1);
    expect(fake.calls.browserClose).toBe(1);
  });

  it('accessing page before start() throws (not a silent null)', () => {
    const sb = new SessionBrowser({ sessionId: 's1', launch: makeFake().launch });
    expect(() => sb.page).toThrow(/not_started/);
  });
});
