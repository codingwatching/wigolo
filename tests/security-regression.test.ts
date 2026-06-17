import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { escalate, VisionBudget } from '../src/studio/perception/vision.js';
import { classifyHost, guardNavigation } from '../src/security/ssrf.js';
import { dispatchStudioTool } from '../src/daemon/studio-dispatch.js';
import { writeHandle, setMyInstanceId, type SessionHandle } from '../src/studio/handle.js';

/**
 * SECURITY-REGRESSION SUITE (CI-gating; run via `npm run test:security` and the full
 * `npm test`). A curated, INDEPENDENT re-assertion of the studio security controls,
 * calling the production functions directly with adversarial inputs. It goes RED if a
 * control is reverted EVEN IF that control's own unit test is deleted — the exact
 * failure mode that silently reopened the vision region clamp. Do not weaken these;
 * a revert of a control must not be able to merge green.
 */
describe('SECURITY-REGRESSION: studio controls', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wigolo-secreg-')); setMyInstanceId(null); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); setMyInstanceId(null); });

  it('vision: a hostile oversize capture region is CLAMPED (no unbounded single-shot)', async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const cdp = { send: async (m: string, p?: Record<string, unknown>) => { calls.push({ method: m, params: p }); return { data: 'AA==' }; } };
    const r = await escalate(cdp, { trigger: 'canvas', region: { x: 0, y: 0, width: 100000, height: 100000 } }, new VisionBudget(3, 4_000_000), { inlineByteCap: 262144, dataDir: dir });
    expect(r.ok).toBe(true);
    const clip = calls.find((c) => c.method === 'Page.captureScreenshot')?.params?.clip as { width: number; height: number };
    expect(clip.width).toBeLessThanOrEqual(4096);
    expect(clip.height).toBeLessThanOrEqual(4096);
  });

  it('SSRF: cloud-metadata + 6to4/NAT64 embeddings + RFC1918 never classify public', () => {
    expect(classifyHost('169.254.169.254')).toBe('link_local');
    expect(classifyHost('[2002:a9fe:a9fe::]')).toBe('link_local'); // 6to4 metadata embedding
    expect(classifyHost('[64:ff9b::a9fe:a9fe]')).toBe('link_local'); // NAT64 metadata embedding
    expect(classifyHost('[2002:7f00::]')).toBe('loopback'); // 6to4 trailing-zero (127.0.0.0)
    expect(classifyHost('10.0.0.1')).toBe('private');
  });

  it('nav: the agent is blocked from localhost / RFC1918 / metadata by default; metadata even with a private grant', () => {
    expect(guardNavigation('http://169.254.169.254/', { source: 'agent' }).ok).toBe(false);
    expect(guardNavigation('http://localhost/', { source: 'agent' }).ok).toBe(false);
    expect(guardNavigation('http://10.0.0.1/', { source: 'agent' }).ok).toBe(false);
    expect(guardNavigation('http://169.254.169.254/', { source: 'agent', allowPrivate: true }).ok).toBe(false);
  });

  it('trust boundary: an untrusted vision tag survives the studio_* proxy passthrough verbatim', async () => {
    const handle: SessionHandle = { id: 's', endpoint: 'http://127.0.0.1:1', token: 't', pid: process.pid, instanceId: 'foreign' };
    writeHandle(handle, dir);
    setMyInstanceId('mine'); // a stdio process distinct from the (foreign) host
    const hostResult = { content: [{ type: 'text', text: JSON.stringify({ vision: { trusted: false } }) }], isError: false };
    const r = await dispatchStudioTool('studio_observe', {}, undefined, dir, { proxyFactory: () => ({ callTool: async () => hostResult }) });
    expect(JSON.parse(r.content[0].text).vision.trusted).toBe(false);
  });
});
