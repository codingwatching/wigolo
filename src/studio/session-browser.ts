import { chromium } from 'playwright';
import { getConfig } from '../config.js';
import { createLogger } from '../logger.js';

/**
 * The live, headed, isolated browser bound to a Studio session — the thing the
 * human and (in Phase 2) the agent co-drive. It is a NEW dedicated context with
 * its own launch path, deliberately separate from the headless fetch pool
 * (`MultiBrowserPool` is `headless:true`-hardcoded and shares a wait queue): a
 * session must not share state with fetches or other sessions. CDP for
 * screencast / input / overlay comes from `context.newCDPSession(page)` —
 * net-new work, not the discovery-only `cdp-client.ts`.
 *
 * The browser handles are reached through narrow structural interfaces so the
 * lifecycle is unit-testable with a fake launcher; the real Playwright launcher
 * is adapted at exactly one boundary (`defaultSessionLauncher`).
 */

const log = createLogger('studio');

export interface SessionPage {
  close(): Promise<void>;
  goto(url: string, opts?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit'; timeout?: number }): Promise<unknown>;
  on(event: 'crash', cb: () => void): void;
}

export interface SessionCdp {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, cb: (payload: never) => void): void;
}

export interface LaunchedSessionBrowser {
  browser: { close(): Promise<void>; on(event: 'disconnected', cb: () => void): void };
  context: { close(): Promise<void> };
  page: SessionPage;
  cdp: SessionCdp;
}

export interface LaunchOptions {
  headless: boolean;
  viewport: { width: number; height: number };
}

export type SessionBrowserLauncher = (opts: LaunchOptions) => Promise<LaunchedSessionBrowser>;

/** The real launcher: dedicated headed Chromium → isolated context → page → CDP session. */
export async function defaultSessionLauncher(opts: LaunchOptions): Promise<LaunchedSessionBrowser> {
  const browser = await chromium.launch({ headless: opts.headless });
  // A fresh isolated context = a clean ephemeral profile (persistent profiles
  // are Phase 5). deviceScaleFactor:1 keeps screencast frame coords 1:1 with
  // the CSS viewport for input mapping (Phase 1c).
  const context = await browser.newContext({ viewport: opts.viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  // Adapt Playwright's precisely-typed handles to the narrow session interfaces
  // at this single boundary (the CDPSession.send overloads are not structurally
  // assignable to a generic send()).
  return { browser, context, page, cdp } as unknown as LaunchedSessionBrowser;
}

export interface SessionBrowserOptions {
  sessionId: string;
  /** Injectable for tests; defaults to the real Playwright launcher. */
  launch?: SessionBrowserLauncher;
}

export class SessionBrowser {
  readonly sessionId: string;
  private readonly launcher: SessionBrowserLauncher;
  private launched: LaunchedSessionBrowser | null = null;
  private _currentUrl = '';
  private closed = false;

  constructor(opts: SessionBrowserOptions) {
    this.sessionId = opts.sessionId;
    this.launcher = opts.launch ?? defaultSessionLauncher;
  }

  get page(): SessionPage {
    if (!this.launched) throw new Error('session_browser_not_started');
    return this.launched.page;
  }

  get cdp(): SessionCdp {
    if (!this.launched) throw new Error('session_browser_not_started');
    return this.launched.cdp;
  }

  get currentUrl(): string {
    return this._currentUrl;
  }

  get running(): boolean {
    return this.launched !== null && !this.closed;
  }

  /** Launch the dedicated browser/context/page/CDP. Idempotent — a second call is a no-op. */
  async start(): Promise<void> {
    if (this.launched || this.closed) return;
    const cfg = getConfig();
    this.launched = await this.launcher({
      headless: cfg.studioBrowserHeadless,
      viewport: { width: cfg.studioScreencastMaxWidth, height: cfg.studioScreencastMaxHeight },
    });
    log.info('studio session browser started', { sessionId: this.sessionId, headless: cfg.studioBrowserHeadless });
  }

  /** Navigate the session page and record the destination as `currentUrl` (used by crash recovery). */
  async navigate(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'load', timeout: getConfig().playwrightNavTimeoutMs });
    this._currentUrl = url;
  }

  /** Tear down page → context → browser exactly once; idempotent and tolerant of already-closed handles. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const l = this.launched;
    this.launched = null;
    if (!l) return;
    await l.page.close().catch(() => {});
    await l.context.close().catch(() => {});
    await l.browser.close().catch(() => {});
    log.info('studio session browser closed', { sessionId: this.sessionId });
  }
}
