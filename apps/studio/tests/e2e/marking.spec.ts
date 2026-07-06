import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type ElectronApplication } from 'playwright';
import { join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { launchStudio } from './launch';
import { readHandle, DaemonProxy } from 'wigolo/studio';
import { IPC } from '../../src/shared/ipc';

// GATED (RUN_STUDIO_E2E) — the P2 marking core loop end-to-end through the REAL embedded gateway.
// The session tab is agent-held with agentAllowPrivate:false and P2 has no human-control-flip (P4), so
// we do NOT navigate the tab (the fence would block any private/loopback/file:// load). Instead we inject
// the fixture DOM into the tab's about:blank (no network → fence untouched) and simulate the human mark by
// emitting the REAL overlay→main IPC (ipcMain.emit with the session tab's webContents as event.sender) —
// the same path the isolated-world overlay uses. This proves: human mark → resolver/heal → studio_marks
// (confidence + ref + rich payload) → agent studio_act click → generalize preview → comment → observe drain.
const RUN = !!process.env.RUN_STUDIO_E2E;
const APP_MAIN = join(import.meta.dirname, '../../out/main/index.js');
const FIXTURE = readFileSync(join(import.meta.dirname, 'fixtures/marking-page.html'), 'utf8');

interface ToolResult { content: Array<{ type: string; text: string }>; isError: boolean }
const body = (r: unknown) => JSON.parse((r as ToolResult).content[0].text) as Record<string, unknown>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!RUN)('studio marking core loop (e2e, real gateway)', () => {
  let app: ElectronApplication;
  let dataDir: string;
  let endpoint: string;
  let token: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'wigolo-studio-mark-e2e-'));
    app = await launchStudio({ args: [APP_MAIN], env: { ...process.env, WIGOLO_DATA_DIR: dataDir } });
    await app.firstWindow();
    const started = Date.now();
    let handle = readHandle(dataDir);
    while (!handle && Date.now() - started < 30_000) { await sleep(250); handle = readHandle(dataDir); }
    if (!handle) throw new Error('gateway handle never published');
    endpoint = handle.endpoint;
    token = handle.token;
  });

  afterAll(async () => {
    await app?.close();
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('human mark → studio_marks (confidence + ref + payload) → agent click → generalize preview → comment drain', async () => {
    const proxy = new DaemonProxy(endpoint, token);
    const opened = body(await proxy.callTool('studio_open', {}));
    expect(typeof opened.session_id).toBe('string');

    // Inject the fixture DOM into the session tab's about:blank + simulate three human marks via the REAL
    // overlay→main IPC (ipcMain.emit with the session tab webContents as event.sender). No navigation.
    // #faq = a unique, NON-risky element (the clickable one); #buy = a money-risk element (its click parks);
    // .choose = one of a repeating set (generalize).
    const faqPayload = { tag: 'button', id: 'faq', classes: [], attrs: { 'data-testid': 'faq-btn' }, dataset: { testid: 'faq-btn' }, text: 'Open FAQ', component: null, source: null };
    const buyPayload = { tag: 'button', id: 'buy', classes: [], attrs: {}, dataset: {}, text: 'Buy now', component: null, source: null };
    const choosePayload = { tag: 'button', id: '', classes: ['choose'], attrs: {}, dataset: {}, text: 'Choose', component: null, source: null };
    const injected = await app.evaluate(async ({ webContents, ipcMain }, arg) => {
      // The session tab is the sole about:blank webContents (createTab loads it to a safe blank page and
      // the fence blocks any nav; the chrome window is on index.html). No default user tab is created.
      const isBlank = (w: { getURL(): string }): boolean => { const u = w.getURL(); return u === '' || u === 'about:blank'; };
      const wc = webContents.getAllWebContents().find(isBlank);
      if (!wc) {
        const diag = webContents.getAllWebContents().map((w) => ({ type: w.getType(), url: w.getURL() }));
        return { ok: false as const, diag };
      }
      await wc.executeJavaScript(`document.body.innerHTML = ${JSON.stringify(arg.body)}; true`);
      await wc.executeJavaScript("window.__clicked=false; document.getElementById('faq').addEventListener('click',function(){window.__clicked=true;}); document.getElementById('host').attachShadow({mode:'open'}).innerHTML='<button>shadow</button>'; true");
      const pathOf = (sel: string): Promise<number[]> => wc.executeJavaScript(
        `(function(el){var p=[],cur=el,root=document.documentElement;while(cur&&root&&cur!==root){var parent=cur.parentElement;if(!parent)break;var i=Array.prototype.indexOf.call(parent.children,cur);if(i<0)break;p.unshift(i);cur=parent;}return el?p:null;})(document.querySelector(${JSON.stringify(sel)}))`,
      );
      ipcMain.emit(arg.channel, { sender: wc }, { nonce: 'faq', path: await pathOf('#faq'), payload: arg.faqPayload });
      ipcMain.emit(arg.channel, { sender: wc }, { nonce: 'choose', path: await pathOf('.plan-card .choose'), payload: arg.choosePayload });
      ipcMain.emit(arg.channel, { sender: wc }, { nonce: 'buy', path: await pathOf('#buy'), payload: arg.buyPayload });
      return { ok: true as const };
    }, { body: FIXTURE, channel: IPC.overlayMark, faqPayload, buyPayload, choosePayload });
    if (!injected.ok) throw new Error('no session tab found; webContents = ' + JSON.stringify((injected as { diag?: unknown }).diag));
    expect(injected.ok).toBe(true);

    // The emit is fire-and-forget; poll studio_marks until all three marks land.
    let marks: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 40 && marks.length < 3; i++) {
      await sleep(150);
      const v = body(await proxy.callTool('studio_marks', {}));
      marks = (v.marks as Array<Record<string, unknown>>) ?? [];
    }
    // The FAQ mark: unique element → heal tier-1 high, a live ref, the rich payload rides along (trusted:false).
    const faq = marks.find((m) => m.name === 'Open FAQ');
    expect(faq).toBeTruthy();
    expect(faq!.trusted).toBe(false);
    expect(faq!.confidence).toBe('high');
    expect(typeof faq!.ref).toBe('string');
    expect((faq!.payload as { tag?: string }).tag).toBe('button');
    expect(((faq!.payload as { attrs?: Record<string, string> }).attrs || {})['data-testid']).toBe('faq-btn');

    // Agent acts on the marked element via its ref — a click is not a nav, so no SSRF fence.
    const actRes = body(await proxy.callTool('studio_act', { action: 'click', ref: faq!.ref }));
    let clicked = false;
    for (let i = 0; i < 40 && !clicked; i++) {
      await sleep(150);
      clicked = await app.evaluate(({ webContents }) => {
        const wc = webContents.getAllWebContents().find((w) => { const u = w.getURL(); return u === '' || u === 'about:blank'; });
        return wc ? wc.executeJavaScript('window.__clicked === true') : Promise.resolve(false);
      });
    }
    if (!clicked) throw new Error('click did not land; studio_act returned ' + JSON.stringify(actRes));
    expect(clicked).toBe(true);

    // Risk gate is LIVE end-to-end: clicking the money-risk "Buy now" mark PARKS for approval, never runs.
    const buy = marks.find((m) => m.name === 'Buy now');
    expect(buy).toBeTruthy();
    const buyAct = body(await proxy.callTool('studio_act', { action: 'click', ref: buy!.ref }));
    expect(buyAct.stage).toBe('pending_approval');
    expect(typeof buyAct.approval_id).toBe('string');

    // Generalize the "Choose" mark → the repeating 3-button set, confirm-gated (never acts).
    const choose = marks.find((m) => m.name === 'Choose');
    expect(choose).toBeTruthy();
    const gen = body(await proxy.callTool('studio_marks', { op: 'generalize', markId: choose!.markId }));
    expect(gen.requires_confirmation).toBe(true); // PREVIEW only — never acts
    // The repeating set is captured (≥ the 3 plan-card buttons); the generalizer's exact precision is
    // unit-pinned (generalize.test.ts + studio-host.test.ts) — here we prove the wire + confirm-gate.
    expect((gen.refs as string[]).length).toBeGreaterThanOrEqual(3);

    // Human comment via the renderer bridge → next studio_observe drains a `comment` event.
    const win = await app.firstWindow();
    await win.evaluate((markId) => (window as unknown as { studio: { addComment(id: string, t: string): Promise<unknown> } }).studio.addComment(markId, 'this is the CTA'), faq!.markId as string);
    let commentEvent: Record<string, unknown> | undefined;
    for (let i = 0; i < 40 && !commentEvent; i++) {
      await sleep(150);
      const obs = body(await proxy.callTool('studio_observe', { since: 0 }));
      commentEvent = ((obs.events as Array<Record<string, unknown>>) ?? []).find((e) => e.type === 'comment');
    }
    expect(commentEvent).toMatchObject({ type: 'comment', markId: faq!.markId, text: 'this is the CTA' });

    await proxy.callTool('studio_close', { session_id: opened.session_id });
  });
});
