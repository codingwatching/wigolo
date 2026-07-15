import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetConfig } from '../../../src/config.js';

// Programmable page behaviour shared with the playwright mock below. Each test
// sets `state` before constructing the pool.
interface PageState {
  status: number;
  // Sequence of bodies returned by successive page.content() calls. The last
  // entry is reused once exhausted (so a settle re-check reads the final body).
  bodies: string[];
  gotoRejectsTimeout: boolean;
  contentCalls: number;
}

const state: PageState = {
  status: 200,
  bodies: ['<html><body>ok</body></html>'],
  gotoRejectsTimeout: false,
  contentCalls: 0,
};

function makeTimeoutErr() {
  const err = new Error('page.goto: Timeout 30000ms exceeded.') as Error & { name: string };
  err.name = 'TimeoutError';
  return err;
}

vi.mock('playwright', () => {
  const launch = vi.fn().mockResolvedValue({
    newContext: vi.fn().mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockImplementation(() => ({
        goto: vi.fn().mockImplementation(() => {
          if (state.gotoRejectsTimeout) return Promise.reject(makeTimeoutErr());
          return Promise.resolve({
            status: () => state.status,
            url: () => 'https://blocked.example/',
            headers: () => ({ 'content-type': 'text/html' }),
          });
        }),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
        waitForFunction: vi.fn().mockResolvedValue(undefined),
        content: vi.fn().mockImplementation(() => {
          const idx = Math.min(state.contentCalls, state.bodies.length - 1);
          state.contentCalls += 1;
          return Promise.resolve(state.bodies[idx]);
        }),
        screenshot: vi.fn().mockResolvedValue(Buffer.from('x')),
        setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      })),
    }),
    close: vi.fn().mockResolvedValue(undefined),
  });
  const stub = { launch };
  return { chromium: stub, firefox: stub, webkit: stub };
});

import { MultiBrowserPool, ChallengeBlockedError } from '../../../src/fetch/browser-pool.js';

const CHALLENGE_INTERSTITIAL =
  '<html><head><title>Just a moment...</title></head><body>' +
  '<div class="cf-browser-verification"></div><div class="cf-turnstile"></div></body></html>';

// A 200 article whose PROSE quotes challenge marker strings — must never fire.
const ARTICLE_QUOTING_MARKERS =
  '<html><head><title>How Cloudflare challenges work</title></head><body><article>' +
  ('The interstitial shows "Just a moment" and sets _cfChlOpt while a cf-turnstile ' +
    'widget loads. Here is a deep dive into how that flow works in practice. ').repeat(20) +
  '</article></body></html>';

describe('browser-pool anti-bot fast-fail (D6)', () => {
  beforeEach(() => {
    resetConfig();
    state.status = 200;
    state.bodies = ['<html><body>ok</body></html>'];
    state.gotoRejectsTimeout = false;
    state.contentCalls = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    resetConfig();
  });

  it('MUST-FIRE: 403 + challenge markers (near-empty body) fast-fails with ChallengeBlockedError under fake timers', async () => {
    vi.useFakeTimers();
    process.env.WIGOLO_CHALLENGE_SETTLE_MS = '5000';
    resetConfig();
    state.status = 403;
    // Stays a challenge across the settle re-check.
    state.bodies = [CHALLENGE_INTERSTITIAL, CHALLENGE_INTERSTITIAL];

    const pool = new MultiBrowserPool();
    const start = Date.now();
    const p = pool.fetchWithBrowser('https://blocked.example/');
    // Attach rejection expectation, then drive the settle timer.
    const assertion = expect(p).rejects.toBeInstanceOf(ChallengeBlockedError);
    await vi.advanceTimersByTimeAsync(6000);
    await assertion;
    const elapsed = Date.now() - start;
    // Total challenged-page budget must be well under 10s (settle only).
    expect(elapsed).toBeLessThan(10000);
    delete process.env.WIGOLO_CHALLENGE_SETTLE_MS;
    await pool.shutdown();
  });

  it('carries a use_auth suggestion + names the site bot protection in capability language', async () => {
    vi.useFakeTimers();
    state.status = 403;
    state.bodies = [CHALLENGE_INTERSTITIAL, CHALLENGE_INTERSTITIAL];

    const pool = new MultiBrowserPool();
    const p = pool.fetchWithBrowser('https://blocked.example/');
    const captured = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(6000);
    const err = (await captured) as ChallengeBlockedError;
    expect(err).toBeInstanceOf(ChallengeBlockedError);
    expect(err.code).toBe('blocked_by_challenge');
    expect(err.hint).toMatch(/use_auth/);
    // Capability language — no vendor internals jargon.
    expect(err.message.toLowerCase()).toMatch(/bot protection|challenge page/);
    await pool.shutdown();
  });

  it('MUST-NOT-FIRE: 200 article quoting marker strings extracts normally, no fast-fail', async () => {
    state.status = 200;
    state.bodies = [ARTICLE_QUOTING_MARKERS];

    const pool = new MultiBrowserPool();
    const res = await pool.fetchWithBrowser('https://news.example/article');
    expect(res.html).toContain('How Cloudflare challenges work');
    expect(res.statusCode).toBe(200);
    await pool.shutdown();
  });

  it('MUST-FIRE: 200 challenge shell (markers + skeleton) enters settle window and fast-fails when it persists', async () => {
    // NEW SPEC: a challenge interstitial served at HTTP 200 (DataDome-style)
    // must be treated as a challenge — the gate is no longer status-gated.
    vi.useFakeTimers();
    process.env.WIGOLO_CHALLENGE_SETTLE_MS = '5000';
    resetConfig();
    state.status = 200;
    state.bodies = [CHALLENGE_INTERSTITIAL, CHALLENGE_INTERSTITIAL];

    const pool = new MultiBrowserPool();
    const p = pool.fetchWithBrowser('https://blocked.example/');
    const assertion = expect(p).rejects.toBeInstanceOf(ChallengeBlockedError);
    await vi.advanceTimersByTimeAsync(6000);
    await assertion;
    delete process.env.WIGOLO_CHALLENGE_SETTLE_MS;
    await pool.shutdown();
  });

  it('MUST-NOT-FIRE: 200 challenge body markers but SUBSTANTIAL content (article quoting markers) never fires', async () => {
    // Markers present at 200 but the body is a real article, not a skeleton.
    state.status = 200;
    state.bodies = [ARTICLE_QUOTING_MARKERS];

    const pool = new MultiBrowserPool();
    const res = await pool.fetchWithBrowser('https://news.example/article');
    expect(res.statusCode).toBe(200);
    expect(res.html).toContain('How Cloudflare challenges work');
    await pool.shutdown();
  });

  it('MUST-NOT-FIRE: 200 challenge shell that HYDRATES into real content within the settle window returns content', async () => {
    vi.useFakeTimers();
    state.status = 200;
    const realArticle = '<html><body><article>' + 'Real hydrated content here. '.repeat(50) + '</article></body></html>';
    state.bodies = [CHALLENGE_INTERSTITIAL, realArticle];

    const pool = new MultiBrowserPool();
    const p = pool.fetchWithBrowser('https://blocked.example/');
    await vi.advanceTimersByTimeAsync(6000);
    const res = await p;
    expect(res.html).toContain('Real hydrated content');
    await pool.shutdown();
  });

  it('MUST-NOT-FIRE: challenge that AUTO-PASSES within the settle window returns normal content', async () => {
    vi.useFakeTimers();
    state.status = 403;
    // First read = challenge; after settle the page navigated to a real article.
    const realArticle = '<html><body><article>' + 'Real hydrated content here. '.repeat(50) + '</article></body></html>';
    state.bodies = [CHALLENGE_INTERSTITIAL, realArticle];

    const pool = new MultiBrowserPool();
    const p = pool.fetchWithBrowser('https://blocked.example/');
    await vi.advanceTimersByTimeAsync(6000);
    const res = await p;
    expect(res.html).toContain('Real hydrated content');
    await pool.shutdown();
  });

  it('MUST-FIRE via timeout path: goto timeout + challenge skeleton partial fast-fails', async () => {
    state.gotoRejectsTimeout = true;
    // Partial content on timeout is a challenge skeleton (title interstitial).
    state.bodies = [CHALLENGE_INTERSTITIAL];

    const pool = new MultiBrowserPool();
    await expect(pool.fetchWithBrowser('https://blocked.example/')).rejects.toBeInstanceOf(ChallengeBlockedError);
    await pool.shutdown();
  });

  it('MUST-NOT-FIRE via timeout path: goto timeout partial WITHOUT markers preserves partial-return', async () => {
    state.gotoRejectsTimeout = true;
    state.bodies = ['<html><body>' + 'partial shell content that is long enough to be real '.repeat(20) + '</body></html>'];

    const pool = new MultiBrowserPool();
    const res = await pool.fetchWithBrowser('https://spa.example/');
    expect(res.warning).toBe('goto_timeout_partial_content');
    expect(res.html).toContain('partial shell content');
    await pool.shutdown();
  });

  it('an abort DURING the settle wait propagates the abort — never masquerades as a challenge error', async () => {
    vi.useFakeTimers();
    state.status = 403;
    state.bodies = [CHALLENGE_INTERSTITIAL, CHALLENGE_INTERSTITIAL];

    const controller = new AbortController();
    const pool = new MultiBrowserPool();
    const p = pool.fetchWithBrowser('https://blocked.example/', { signal: controller.signal });
    const captured = p.catch((e) => e);
    // Abort mid-settle before the 5s window elapses.
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort(new DOMException('caller deadline', 'AbortError'));
    await vi.advanceTimersByTimeAsync(10);
    const err = await captured;
    expect(err).not.toBeInstanceOf(ChallengeBlockedError);
    expect((err as Error).name).toBe('AbortError');
    await pool.shutdown();
  });
});
