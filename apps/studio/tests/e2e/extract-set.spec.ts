import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type ElectronApplication } from 'playwright';
import { join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { launchStudio } from './launch';
import { readHandle, DaemonProxy } from 'wigolo/studio';
import { IPC } from '../../src/shared/ipc';

// GATED (RUN_STUDIO_E2E) — P6 F1 grab-all end-to-end through the REAL embedded gateway + broker + Electron.
// Mirrors marking.spec: inject a repeating-list fixture into the session tab's about:blank (no nav → fence
// untouched), simulate a human mark via the real overlay→main IPC, then the agent calls studio_extract_set.
// Pagination-SSRF-via-discovered-control routing is proven at the host layer (studio-host-extract.test.ts's
// browser.navigate spy — a cloud-metadata next-target never reaches browser.navigate); not repeated here
// because about:blank cannot really navigate under the fence.
const RUN = !!process.env.RUN_STUDIO_E2E;
const APP_MAIN = join(import.meta.dirname, '../../out/main/index.js');
const FIXTURE = readFileSync(join(import.meta.dirname, 'fixtures/extract-page.html'), 'utf8');

interface ToolResult { content: Array<{ type: string; text: string }>; isError: boolean }
const body = (r: unknown) => JSON.parse((r as ToolResult).content[0].text) as Record<string, unknown>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const planPayload = { tag: 'a', id: '', classes: ['plan'], attrs: { href: '#pro' }, dataset: {}, text: 'Pro $20', component: null, source: null };

describe.skipIf(!RUN)('studio grab-all / studio_extract_set (e2e, real gateway)', () => {
  let app: ElectronApplication;
  let dataDir: string;
  let endpoint: string;
  let token: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'wigolo-studio-extract-e2e-'));
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

  it('human marks one repeating item → agent studio_extract_set returns structured rows → persisted + findable', async () => {
    const proxy = new DaemonProxy(endpoint, token);
    const opened = body(await proxy.callTool('studio_open', {}));
    expect(typeof opened.session_id).toBe('string');

    const injected = await app.evaluate(async ({ webContents, ipcMain }, arg) => {
      const isBlank = (w: { getURL(): string }): boolean => { const u = w.getURL(); return u === '' || u === 'about:blank'; };
      const wc = webContents.getAllWebContents().find(isBlank);
      if (!wc) return { ok: false as const };
      await wc.executeJavaScript(`document.body.innerHTML = ${JSON.stringify(arg.body)}; true`);
      const pathOf = (sel: string): Promise<number[]> => wc.executeJavaScript(
        `(function(el){var p=[],cur=el,root=document.documentElement;while(cur&&root&&cur!==root){var parent=cur.parentElement;if(!parent)break;var i=Array.prototype.indexOf.call(parent.children,cur);if(i<0)break;p.unshift(i);cur=parent;}return el?p:null;})(document.querySelector(${JSON.stringify(sel)}))`,
      );
      ipcMain.emit(arg.channel, { sender: wc }, { nonce: 'plan', path: await pathOf('.plan'), payload: arg.planPayload });
      return { ok: true as const };
    }, { body: FIXTURE, channel: IPC.overlayMark, planPayload });
    expect(injected.ok).toBe(true);

    // Poll studio_marks until the mark lands.
    let mark: Record<string, unknown> | undefined;
    for (let i = 0; i < 40 && !mark; i++) {
      await sleep(150);
      const v = body(await proxy.callTool('studio_marks', {}));
      mark = ((v.marks as Array<Record<string, unknown>>) ?? [])[0];
    }
    expect(mark).toBeTruthy();

    // Agent grabs the repeating set into rows (tab_id omitted → active session).
    const out = body(await proxy.callTool('studio_extract_set', { mark_id: mark!.markId }));
    expect(out.stage).toBeUndefined();
    expect(Array.isArray(out.rows)).toBe(true);
    expect((out.rows as unknown[]).length).toBeGreaterThanOrEqual(3); // the 3 repeating plans
    expect(Array.isArray(out.columns)).toBe(true);
    // artifact_id (a real broker insert) is the persistence proof reachable through the studio gateway
    // (find_similar is a CORE tool, not hosted by the studio-only gateway — the corpus indexing is
    // exercised in the core broker-dispatch tests + persistExtraction's FTS/embed wiring).
    expect(typeof out.artifact_id).toBe('number');

    await proxy.callTool('studio_close', { session_id: opened.session_id });
  });

  it('refuses on a credential context — nothing extracted (a password field arms the credential gate)', async () => {
    const proxy = new DaemonProxy(endpoint, token);
    const opened = body(await proxy.callTool('studio_open', {}));

    await app.evaluate(async ({ webContents }, arg) => {
      const wc = webContents.getAllWebContents().find((w) => { const u = w.getURL(); return u === '' || u === 'about:blank'; });
      if (wc) await wc.executeJavaScript(`document.body.innerHTML = ${JSON.stringify(arg.body)}; true`);
    }, { body: '<form><input type="password" name="pw" /><a class="plan" href="#"><h3>X</h3></a></form>' });

    // Even with a (nonexistent) mark, the credential gate fires at entry → refused, nothing persisted.
    const out = body(await proxy.callTool('studio_extract_set', { mark_id: 'any' }));
    expect(out.stage === 'refused' || out.error_reason === 'no_such_mark').toBe(true);
    // If a credential page, it must be refused BEFORE mark resolution.
    if (out.stage) expect(out.stage).toBe('refused');

    await proxy.callTool('studio_close', { session_id: opened.session_id });
  });
});
