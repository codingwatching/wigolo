import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// React.dev (and any SSR nav-shell SPA) clears `networkidle` almost
// immediately — the shell's bundle requests settle while <main> is still
// empty. The render-tier capture MUST gate on the hydration probe, NOT race
// the probe against networkidle: a race resolves on whichever settles first,
// so a fast networkidle short-circuits the probe and `page.content()` captures
// nav-only HTML. This test pins the ordering deterministically (no real
// browser): the body-presence probe resolves LATE, networkidle resolves
// EARLY, and we assert capture happens only after the probe resolved.

interface FakePage {
  goto: ReturnType<typeof vi.fn>;
  waitForFunction: ReturnType<typeof vi.fn>;
  waitForLoadState: ReturnType<typeof vi.fn>;
  content: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const events: string[] = [];
let probeResolved = false;
let fakePage: FakePage;

function makePage(): FakePage {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    // networkidle resolves on the next microtask — i.e. "fast", like react.dev.
    waitForLoadState: vi.fn().mockImplementation(() => {
      events.push('networkidle');
      return Promise.resolve(undefined);
    }),
    // The body-presence probe resolves only after a real delay — the article
    // mounts late. Until it resolves, the captured HTML would be nav-only.
    waitForFunction: vi.fn().mockImplementation(() => {
      events.push('probe:start');
      return new Promise((resolve) => {
        setTimeout(() => {
          probeResolved = true;
          events.push('probe:resolved');
          resolve(undefined);
        }, 40);
      });
    }),
    content: vi.fn().mockImplementation(() => {
      events.push(probeResolved ? 'content:after-probe' : 'content:before-probe');
      return Promise.resolve(
        probeResolved
          ? '<html><body><main><h1>Real Article</h1><p>body</p></main></body></html>'
          : '<html><body><nav>nav only</nav><div id="root"></div></body></html>',
      );
    }),
    evaluate: vi.fn().mockResolvedValue('body text'),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

vi.mock('playwright', () => {
  const launch = vi.fn().mockResolvedValue({
    newContext: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockImplementation(() => fakePage),
      close: vi.fn().mockResolvedValue(undefined),
    }),
    close: vi.fn().mockResolvedValue(undefined),
  });
  const stub = { launch, executablePath: () => '/fake/chrome' };
  return { chromium: stub, firefox: stub, webkit: stub };
});

vi.mock('node:fs', async (orig) => {
  const actual = await orig<typeof import('node:fs')>();
  return { ...actual, existsSync: () => true };
});

describe('fetchWithPlaywright gates capture on the hydration probe', () => {
  beforeEach(() => {
    events.length = 0;
    probeResolved = false;
    fakePage = makePage();
  });

  afterEach(async () => {
    const { closeDaemonBrowser } = await import('../../../src/fetch/playwright-tier.js');
    await closeDaemonBrowser().catch(() => undefined);
    vi.resetModules();
  });

  it('captures HTML only after the body-presence probe resolves (not on fast networkidle)', async () => {
    const { fetchWithPlaywright } = await import('../../../src/fetch/playwright-tier.js');
    const result = await fetchWithPlaywright('https://react.dev/reference/react');

    // The probe must have run and resolved before capture.
    expect(events).toContain('probe:resolved');
    expect(events).toContain('content:after-probe');
    expect(events).not.toContain('content:before-probe');

    // And the captured HTML is the hydrated body, not the nav-only shell.
    expect(result.html).toContain('Real Article');
    expect(result.html).not.toContain('nav only');
  });

  it('re-polls with a longer budget when the first wait times out on an app-shell, rather than capturing nav-only', async () => {
    // First waitForFunction call times out (body not mounted yet). The page is
    // an SPA app-shell (evaluate → true). The tier must escalate to a second,
    // longer waitForFunction that succeeds — proving the timeout does NOT
    // silently fall through to a nav-only capture.
    let probeCalls = 0;
    fakePage.waitForFunction = vi.fn().mockImplementation(() => {
      probeCalls += 1;
      if (probeCalls === 1) {
        events.push('probe1:timeout');
        return Promise.reject(new Error('Timeout 800ms exceeded'));
      }
      events.push('probe2:start');
      return new Promise((resolve) => {
        setTimeout(() => {
          probeResolved = true;
          events.push('probe2:resolved');
          resolve(undefined);
        }, 20);
      });
    });
    // App-shell-only: body not yet present → escalation should fire.
    fakePage.evaluate = vi.fn().mockResolvedValue(true);

    const { fetchWithPlaywright } = await import('../../../src/fetch/playwright-tier.js');
    const result = await fetchWithPlaywright('https://react.dev/reference/react');

    expect(probeCalls).toBe(2); // escalated
    expect(events).toContain('probe1:timeout');
    expect(events).toContain('probe2:resolved');
    expect(events).toContain('content:after-probe');
    expect(events).not.toContain('content:before-probe');
    expect(result.html).toContain('Real Article');
  });

  it('does not escalate when the page is a plain non-SPA doc (no app-shell)', async () => {
    // Probe times out and the page is NOT an SPA app-shell (evaluate → false):
    // a plain page that genuinely has no semantic body. Must capture as-is with
    // no second wait — so already-good/fast non-SPA pages pay no escalation.
    let probeCalls = 0;
    fakePage.waitForFunction = vi.fn().mockImplementation(() => {
      probeCalls += 1;
      events.push(`probe${probeCalls}:timeout`);
      return Promise.reject(new Error('Timeout 800ms exceeded'));
    });
    fakePage.evaluate = vi.fn().mockResolvedValue(false);

    const { fetchWithPlaywright } = await import('../../../src/fetch/playwright-tier.js');
    await fetchWithPlaywright('https://example.com/');

    expect(probeCalls).toBe(1); // no escalation
    expect(events).not.toContain('probe2:timeout');
  });
});
