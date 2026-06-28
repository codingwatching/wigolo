import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright';
import { resetConfig } from '../../../src/config.js';
import type { startStudioHost as StartStudioHost } from '../../../src/cli/studio.js';

/**
 * D20 — the pre-grant UI→host end-to-end. Joins the two ends that are otherwise only contract-pinned
 * SEPARATELY: the webapp ScopePanel (jsdom component lane) and the host {t:'grant'} ingress (the bearer-WS
 * integration test). This boots the REAL host AND loads the REAL built web app in a REAL browser, then drives
 * the REAL ScopePanel so the REAL up.grant() codec emits the REAL {t:'grant'} over the REAL bearer WS to the
 * host's onGrant handler — and asserts the host PreGrantStore received EXACTLY the scope the UI specified,
 * end to end. Then a matching risky action FIRES (authorized by that human pre-grant), proving the loop closes.
 *
 * THE CATCH THIS EXISTS FOR: a ScopePanel ↔ codec ↔ onGrant CONTRACT DRIFT (e.g. a renamed field) that the two
 * separate pins can't see — the component test stubs the emit, the host test hand-builds the frame. Only this
 * test runs the real producer → real wire → real consumer.
 *
 * LOCAL-ONLY. Gated by RUN_STUDIO_HEADED (skips by default — it launches two browsers) AND WEBAPP_BUILT (the
 * served bundle must exist). NOT in gate:studio; lives in the spawn-serial e2e lane. Run it with:
 *
 *     npm run build:webapp && npm run test:studio:e2e
 *
 * (test:studio:e2e = RUN_STUDIO_HEADED=1 WIGOLO_STUDIO_HEADLESS=1 vitest run tests/e2e/studio)
 *
 * EXPECTED GREEN: the ScopePanel submit writes {127.0.0.1, click, money} into host.preGrant (size 1, matches
 * true), and the subsequent agent click on the live /checkout page is authorized (ok:true, audit approval
 * 'pre-grant') — never parked.
 *
 * D20 PIN (local): mutate the ScopePanel→codec field mapping (webapp/src/ui/ScopePanel.tsx — e.g. emit
 * up.grant([{ domain: d, action: actionType, riskTier }]) with the WRONG key `action` instead of `actionType`)
 * ⇒ the host onGrant drops the malformed entry ⇒ host.preGrant stays EMPTY ⇒ the store-match assertion REDs
 * (size 0, matches false) and the action then PARKS instead of firing.
 *
 * HALT CLAUSE (mirrors the smoke e2e): if this surfaces a real contract/wiring bug, it must FAIL loudly — never
 * weaken an assertion to go green. A red here is a finding to adjudicate, not a test to soften.
 *
 * BLIND-BUILD NOTE (for the first local run): selectors + the codec shape + the boot sequence are taken from
 * live source (ScopePanel.tsx, transport/codec.ts, the smoke e2e), so this is static-correct. The two values
 * that can only be settled by a headed run are TIMING (when the rail mounts + the WS connects relative to the
 * submit) and the served-bundle wait. The canvas-ready wait below mirrors the smoke test's connection gate; if
 * the rail/ScopePanel proves to mount on a different signal, adjust the waitForSelector target — do not weaken
 * the store-match assertion.
 */
const RUN = !!process.env.RUN_STUDIO_HEADED;
const WEBAPP_BUILT = existsSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'dist', 'webapp', 'app.js'));

describe.skipIf(!RUN || !WEBAPP_BUILT)('studio pre-grant UI→host e2e (real host + real browser-loaded web app)', () => {
  let tmp: string;
  let host: Awaited<ReturnType<typeof StartStudioHost>>;
  let viewer: Browser;
  let page: Page;
  let pageServer: Server;
  let checkoutUrl: string;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'wigolo-studio-d20-'));
    process.env.WIGOLO_CONFIG_PATH = join(tmp, 'config.json');
    process.env.WIGOLO_STUDIO_HEADLESS = '1';
    resetConfig();
    const { startStudioHost } = await import('../../../src/cli/studio.js');
    host = await startStudioHost({ port: 0, host: '127.0.0.1', allowRemote: false, dataDir: tmp });
    viewer = await chromium.launch({ headless: true });
    page = await viewer.newPage();

    // A money-context page (the /checkout PATH is the classifier's hard signal) served from loopback, so the
    // granted domain '127.0.0.1' matches the live page origin and the agent click is a money-tier risky action.
    pageServer = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<button id="go" onclick="window.__paid=1" style="position:fixed;left:40px;top:40px;width:300px;height:60px">Continue</button>');
    });
    const port = await new Promise<number>((resolve) => pageServer.listen(0, '127.0.0.1', () => resolve((pageServer.address() as AddressInfo).port)));
    checkoutUrl = `http://127.0.0.1:${port}/checkout`;
  }, 60_000);

  afterAll(async () => {
    await page?.close().catch(() => {});
    await viewer?.close().catch(() => {});
    await new Promise<void>((r) => pageServer?.close(() => r()));
    if (host) {
      host.hub.closeAll();
      await host.bridge.stop().catch(() => {});
      await host.sessionBrowser.close().catch(() => {});
      await host.daemon.stop().catch(() => {});
    }
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.WIGOLO_STUDIO_HEADLESS;
    resetConfig();
  });

  it('a ScopePanel grant flows UI→codec→bearer-WS→host PreGrantStore (matching the UI fields), then a matching risky action fires', async () => {
    // The live session sits on the money-context page so a click there is a money-tier risky action.
    await host.sessionBrowser.navigate(checkoutUrl);

    // Load the REAL served web app: the page redeems the one-time nonce for the bearer over loopback, then opens
    // the authenticated WS — all in the real bundle. The canvas-ready wait is the connection gate (a frame can
    // only paint once the WS upgrade succeeded), so by the time we drive the ScopePanel the codec emit is live.
    await page.goto(host.webappUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('canvas.studio-canvas', { timeout: 10_000 });
    await page.waitForSelector('.studio-scope-domain', { timeout: 10_000 });

    // Drive the REAL ScopePanel: domain + action-type + risk-tier, then submit. The form's onSubmit calls
    // emit(encodeUp(up.grant([{ domain, actionType, riskTier }]))) — the one real codec emit over the WS.
    await page.fill('.studio-scope-domain', '127.0.0.1');
    await page.selectOption('.studio-scope-action', 'click');
    await page.selectOption('.studio-scope-risk', 'money');
    await page.click('.studio-scope-add');

    // PRIMARY ASSERTION (the D20 essence): the host PreGrantStore received EXACTLY the scope the UI specified,
    // via the real producer → real wire → real consumer. A ScopePanel↔codec↔onGrant field drift REDs this.
    await expect
      .poll(() => host.preGrant.matches({ domain: '127.0.0.1', actionType: 'click', riskTier: 'money' }), { timeout: 10_000 })
      .toBe(true);
    expect(host.preGrant.size, 'the UI grant wrote exactly one scope entry').toBe(1);

    // THE LOOP CLOSES: a matching risky action is now AUTHORIZED by that human pre-grant (fires, never parks).
    host.controller.handleControl({ op: 'grant', to: 'agent' }); // the human hands the turn to the agent
    const obs = (await host.observe({})) as { elements?: Array<{ ref: string; role: string }> };
    const btn = (obs.elements ?? []).find((e) => e.role === 'button');
    expect(btn, 'observe surfaces the checkout button').toBeTruthy();

    const act = (await host.act({ action: 'click', ref: btn!.ref })) as { ok?: boolean; error_reason?: string };
    expect(act.error_reason, 'the UI-granted action fires, not parks').toBeUndefined();
    expect(act).toMatchObject({ ok: true, action: 'click' });
    await expect
      .poll(() => (host.sessionBrowser.page as unknown as Page).evaluate(() => (window as unknown as { __paid?: number }).__paid), { timeout: 5_000 })
      .toBe(1);
    expect(host.audit.replay().at(-1)!, 'audited as authorized by the human pre-grant').toMatchObject({
      action: 'click',
      risk: 'money',
      approval: 'pre-grant',
      outcome: { ok: true },
    });

    host.controller.handleControl({ op: 'reclaim' });
  }, 90_000);
});
