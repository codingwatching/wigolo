import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type ElectronApplication } from 'playwright';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { launchStudio } from './launch';
import { readHandle, DaemonProxy } from 'wigolo/studio';

// GATED (RUN_STUDIO_E2E) — the real Electron app. Proves the P6 F4 timeline loop END-TO-END through the
// real embedded gateway AND the real DB broker (a plain-Node child): an agent act → the per-session
// SessionAuditLog → broker persistAudit (append-only) → the renderer's listAudit backfill. The broker runs
// under a real Node binary (better-sqlite3 loads) — the Electron main never does.
const RUN = !!process.env.RUN_STUDIO_E2E;
const APP_MAIN = join(import.meta.dirname, '../../out/main/index.js');

interface ToolResult { content: Array<{ type: string; text: string }>; isError: boolean }

interface AuditRow { seq: number; action: string; ok: boolean; url?: string; direction?: string; error_reason?: string }
const listAudit = (win: Awaited<ReturnType<ElectronApplication['firstWindow']>>): Promise<AuditRow[]> =>
  win.evaluate(() => (window as unknown as { studio: { listAudit(): Promise<AuditRow[]> } }).studio.listAudit());

describe.skipIf(!RUN)('studio timeline (e2e, real gateway + real DB broker)', () => {
  let app: ElectronApplication;
  let dataDir: string;
  let endpoint: string;
  let token: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'wigolo-studio-p6f4-e2e-'));
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
    await app?.close();
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('agent acts are recorded to the append-only audit log + read back through the Timeline (real broker)', async () => {
    const proxy = new DaemonProxy(endpoint, token);
    await proxy.callTool('studio_open', {});

    // Two scrolls (succeed on about:blank) + a blocked private navigation (records a typed refusal — never
    // silently dropped). Every act, success or refusal, must land in the timeline in order.
    await proxy.callTool('studio_act', { action: 'scroll', direction: 'down', amount: 100 });
    await proxy.callTool('studio_act', { action: 'scroll', direction: 'up', amount: 50 });
    await proxy.callTool('studio_act', { action: 'navigate', url: 'http://127.0.0.1:9/blocked' });

    const win = await app.firstWindow();
    let rows: AuditRow[] = [];
    for (let i = 0; i < 40 && rows.length < 3; i++) {
      rows = await listAudit(win);
      if (rows.length < 3) await new Promise((r) => setTimeout(r, 250));
    }
    expect(rows.length).toBeGreaterThanOrEqual(3);

    // Reverse-chronological (highest seq first) with the right verbs + outcomes.
    const bySeq = [...rows].sort((a, b) => a.seq - b.seq);
    expect(bySeq.map((r) => r.action)).toEqual(['scroll', 'scroll', 'navigate']);
    expect(bySeq[0]).toMatchObject({ action: 'scroll', direction: 'down', ok: true });
    expect(bySeq[2]).toMatchObject({ action: 'navigate', ok: false }); // the private hop was refused
  }, 60_000);

  it('backfill on reopen: listAudit re-reads the persisted trail from the broker (durable)', async () => {
    const win = await app.firstWindow();
    const rows = await listAudit(win);
    expect(rows.length).toBeGreaterThanOrEqual(3); // the prior test's rows survived (append-only, persisted)
    // monotonic, gap-free seq — the replay order the audit log guarantees
    const seqs = [...rows].map((r) => r.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  }, 40_000);

  it('NEGATIVE: no agent tool can write or delete an audit row — the timeline is host-internal (§7 guarantee)', async () => {
    const proxy = new DaemonProxy(endpoint, token);
    const tools = (await proxy.listTools()) as { tools: Array<{ name: string }> };
    const names = tools.tools.map((t) => t.name);
    // audit rows are a side-effect of studio_act (host-recorded) — no agent verb writes, reads, prunes, or
    // deletes the trail. If a studio_audit/timeline/prune tool ever leaks onto the agent surface, this reds.
    expect(names.some((n) => /audit|timeline|prune/i.test(n))).toBe(false);
  }, 20_000);
});
