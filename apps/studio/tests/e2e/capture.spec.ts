import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type ElectronApplication } from 'playwright';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { launchStudio } from './launch';
import { readHandle, DaemonProxy } from 'wigolo/studio';
import { IPC } from '../../src/shared/ipc';

// GATED (RUN_STUDIO_E2E) — the real Electron app. Proves the P3 capture loop END-TO-END through the
// real embedded gateway AND the real DB broker (a plain-Node child, spawned under a real Node binary so
// better-sqlite3 loads — the Electron main never does). We set WIGOLO_STUDIO_BROKER_NODE to the test's
// own node so the broker is guaranteed a Node-ABI runtime regardless of PATH.
const RUN = !!process.env.RUN_STUDIO_E2E;
const APP_MAIN = join(import.meta.dirname, '../../out/main/index.js');

interface ToolResult { content: Array<{ type: string; text: string }>; isError: boolean }
const body = (r: unknown) => JSON.parse((r as ToolResult).content[0].text) as Record<string, unknown>;

describe.skipIf(!RUN)('studio capture (e2e, real gateway + real DB broker)', () => {
  let app: ElectronApplication;
  let dataDir: string;
  let endpoint: string;
  let token: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'wigolo-studio-p3-e2e-'));
    app = await launchStudio({
      args: [APP_MAIN],
      env: { ...process.env, WIGOLO_DATA_DIR: dataDir, WIGOLO_STUDIO_BROKER_NODE: process.execPath },
    });
    await app.firstWindow();
    const started = Date.now();
    let handle = readHandle(dataDir);
    while (!handle && Date.now() - started < 30_000) {
      await new Promise((r) => setTimeout(r, 250));
      handle = readHandle(dataDir);
    }
    if (!handle) throw new Error('gateway handle never published');
    endpoint = handle.endpoint;
    token = handle.token;
  }, 60_000);

  afterAll(async () => {
    await app?.close(); // before-quit → broker.stop() (child killed — the client teardown is unit-tested)
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('agent studio_capture persists a clip through the broker (real Node child) and dedups on re-capture', async () => {
    const proxy = new DaemonProxy(endpoint, token);
    await proxy.callTool('studio_open', {});
    await proxy.callTool('studio_observe', {}); // stamps lastObserveEpoch = current (TOCTOU passes)

    const clip = { type: 'clip', content: 'wigolo p3 capture e2e sentinel phrase', url: 'https://example.com/e2e' };
    const first = body(await proxy.callTool('studio_capture', clip));
    expect(first.inserted).toBe(true);
    expect(typeof first.artifact_id).toBe('number');

    const dup = body(await proxy.callTool('studio_capture', clip));
    expect(dup.inserted).toBe(false); // content-hash dedup — same artifact id, no re-embed
    expect(dup.artifact_id).toBe(first.artifact_id);
  }, 40_000);

  it('the captured clip is readable from the Captures rail + the knowledge rail (renderer IPC → broker)', async () => {
    const win = await app.firstWindow();

    // Captures panel: listCaptures (active session) includes the clip.
    const caps = await win.evaluate(() =>
      (window as unknown as { studio: { listCaptures(): Promise<Array<{ type: string; url: string | null }>> } }).studio.listCaptures(),
    );
    expect(caps.some((c) => c.type === 'clip' && c.url === 'https://example.com/e2e')).toBe(true);

    // Knowledge rail: find_similar on the clip's content against the local studio corpus → >=1 hit
    // (FTS row is written synchronously by the trigger, so the just-captured clip is immediately matchable).
    const hits = await win.evaluate((concept) =>
      (window as unknown as { studio: { knowledgeSimilar(c: string): Promise<Array<{ url: string }>> } }).studio.knowledgeSimilar(concept),
    'wigolo p3 capture e2e sentinel phrase');
    expect(Array.isArray(hits)).toBe(true);
    expect(hits.length).toBeGreaterThanOrEqual(1); // assert >=N, not exact (P2 lesson)
  }, 40_000);

  it('region clip persists a screenshot artifact via the REAL capturePage + media write', async () => {
    // Simulate the human drag→region gesture by emitting the real overlay→main IPC with the session tab's
    // webContents as event.sender (same pattern as marking.spec) — exercises the REAL webContents.capturePage
    // + the sha256 + the media-file write + persistScreenshot, end-to-end.
    const emitted = await app.evaluate(({ webContents, ipcMain }, channel) => {
      const wc = webContents.getAllWebContents().find((w) => { const u = w.getURL(); return u === '' || u === 'about:blank'; });
      if (!wc) return false;
      ipcMain.emit(channel, { sender: wc }, { rect: { x: 0, y: 0, width: 200, height: 120 } });
      return true;
    }, IPC.overlayRegion);
    expect(emitted).toBe(true);

    const win = await app.firstWindow();
    // capturePage + hash + write + persist are async off the emit — poll listCaptures for the screenshot.
    let hasShot = false;
    for (let i = 0; i < 40 && !hasShot; i++) {
      const caps = await win.evaluate(() =>
        (window as unknown as { studio: { listCaptures(): Promise<Array<{ type: string }>> } }).studio.listCaptures());
      hasShot = caps.some((c) => c.type === 'screenshot');
      if (!hasShot) await new Promise((r) => setTimeout(r, 250));
    }
    expect(hasShot).toBe(true);
  }, 40_000);
});
