import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { escalate, VisionBudget, VISION_TRIGGERS } from '../../../../src/studio/perception/vision.js';
import { readSpill } from '../../../../src/studio/perception/spill.js';

const region = { x: 10, y: 20, width: 100, height: 50 };

/** Fake CDP that records the screenshot clip and returns a base64 PNG of a chosen byte size. */
function makeCdp(pngBytes = 64) {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const cdp = {
    send: async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === 'Page.captureScreenshot') return { data: Buffer.alloc(pngBytes, 1).toString('base64') };
      return {};
    },
  };
  return { cdp, calls };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wigolo-vision-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('vision triggers — a CLOSED set (shadow DOM is NOT one; 2D retired it)', () => {
  it('exposes exactly canvas / oopif / marked_unresolved', () => {
    expect([...VISION_TRIGGERS].sort()).toEqual(['canvas', 'marked_unresolved', 'oopif']);
    expect(VISION_TRIGGERS.has('shadow')).toBe(false); // retired — a11y carries open/nested/closed for free
  });

  it('refuses an unknown/retired trigger (no open-ended "feels incomplete" escalation)', async () => {
    const { cdp } = makeCdp();
    const budget = new VisionBudget(3, 4_000_000);
    const r = await escalate(cdp, { trigger: 'shadow' as never, region }, budget, { inlineByteCap: 262144, dataDir: dir });
    expect(r).toEqual({ ok: false, reason: 'unknown_trigger' });
  });
});

describe('escalate — crop-first, budgeted, untrusted, region-carrying', () => {
  it('crops to the requested ROI (clip == region), never a full-page screenshot', async () => {
    const { cdp, calls } = makeCdp();
    const budget = new VisionBudget(3, 4_000_000);
    const r = await escalate(cdp, { trigger: 'canvas', region }, budget, { inlineByteCap: 262144, dataDir: dir });
    expect(r.ok).toBe(true);
    const shot = calls.find((c) => c.method === 'Page.captureScreenshot');
    expect(shot?.params?.clip).toMatchObject(region); // crop-first
  });

  it('tags output UNTRUSTED and echoes the region (the 2J action locus)', async () => {
    const { cdp } = makeCdp();
    const r = await escalate(cdp, { trigger: 'marked_unresolved', region }, new VisionBudget(3, 4_000_000), { inlineByteCap: 262144, dataDir: dir });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.trusted).toBe(false); // page-rendered pixels are untrusted data
      expect(r.result.region).toEqual(region); // carries the locus for 2J
      expect(r.result.image.base64).toBeTruthy();
    }
  });

  it('rate cap: refuses after maxCalls per turn (fail-loud, no screenshot spam); reset() restores', async () => {
    const { cdp } = makeCdp();
    const budget = new VisionBudget(2, 4_000_000);
    expect((await escalate(cdp, { trigger: 'canvas', region }, budget, { inlineByteCap: 262144, dataDir: dir })).ok).toBe(true);
    expect((await escalate(cdp, { trigger: 'canvas', region }, budget, { inlineByteCap: 262144, dataDir: dir })).ok).toBe(true);
    expect(await escalate(cdp, { trigger: 'canvas', region }, budget, { inlineByteCap: 262144, dataDir: dir })).toEqual({ ok: false, reason: 'vision_budget_exceeded' });
    budget.reset();
    expect((await escalate(cdp, { trigger: 'canvas', region }, budget, { inlineByteCap: 262144, dataDir: dir })).ok).toBe(true);
  });

  it('byte budget: a capture that blows the per-turn byte cap refuses the NEXT escalation', async () => {
    const { cdp } = makeCdp(5000);
    const budget = new VisionBudget(10, 4000); // 4000-byte budget; one 5000-byte capture exceeds it
    expect((await escalate(cdp, { trigger: 'canvas', region }, budget, { inlineByteCap: 1_000_000, dataDir: dir })).ok).toBe(true);
    expect(await escalate(cdp, { trigger: 'canvas', region }, budget, { inlineByteCap: 1_000_000, dataDir: dir })).toEqual({ ok: false, reason: 'vision_budget_exceeded' });
  });

  it('rejects an invalid region (non-finite / non-positive dims) — invalid_region, no capture', async () => {
    const { cdp, calls } = makeCdp();
    const b = new VisionBudget(3, 4_000_000);
    for (const bad of [{ x: 0, y: 0, width: NaN, height: 50 }, { x: 0, y: 0, width: -5, height: 50 }, { x: 0, y: 0, width: 100, height: Infinity }]) {
      expect(await escalate(cdp, { trigger: 'canvas', region: bad }, b, { inlineByteCap: 262144, dataDir: dir })).toEqual({ ok: false, reason: 'invalid_region' });
    }
    expect(calls.some((c) => c.method === 'Page.captureScreenshot')).toBe(false); // never captured a malformed region
  });

  it('CLAMPS a hostile oversize region to the hard cap so a single capture cannot be unbounded (security)', async () => {
    const { cdp, calls } = makeCdp();
    const r = await escalate(cdp, { trigger: 'canvas', region: { x: 0, y: 0, width: 100000, height: 100000 } }, new VisionBudget(3, 4_000_000), { inlineByteCap: 262144, dataDir: dir });
    expect(r.ok).toBe(true);
    const clip = calls.find((c) => c.method === 'Page.captureScreenshot')?.params?.clip as { width: number; height: number };
    expect(clip.width).toBe(4096); // clamped to MAX_REGION_PX — not a 100000px single-shot
    expect(clip.height).toBe(4096);
    if (r.ok) { expect(r.result.region.width).toBe(4096); expect(r.result.region.height).toBe(4096); } // echoes the captured (clamped) region
  });

  it('maps a rejecting CDP capture to capture_failed (no uncaught throw)', async () => {
    const cdp = { send: async (m: string) => { if (m === 'Page.captureScreenshot') throw new Error('protocol error'); return {}; } };
    const r = await escalate(cdp, { trigger: 'canvas', region }, new VisionBudget(3, 4_000_000), { inlineByteCap: 262144, dataDir: dir });
    expect(r).toEqual({ ok: false, reason: 'capture_failed' });
  });

  it('byte-bound: a cropped PNG over the inline cap spills to a ref (retrievable); under stays inline', async () => {
    const big = makeCdp(400_000);
    const rBig = await escalate(big.cdp, { trigger: 'canvas', region }, new VisionBudget(3, 4_000_000), { inlineByteCap: 262144, dataDir: dir });
    expect(rBig.ok).toBe(true);
    if (rBig.ok) {
      expect(rBig.result.image.base64).toBeUndefined();
      expect(rBig.result.image.spillRef).toMatch(/^spill:/);
      expect((readSpill(rBig.result.image.spillRef!, dir) as { base64: string }).base64).toBeTruthy(); // retrievable
    }
    const small = makeCdp(64);
    const rSmall = await escalate(small.cdp, { trigger: 'canvas', region }, new VisionBudget(3, 4_000_000), { inlineByteCap: 262144, dataDir: dir });
    if (rSmall.ok) {
      expect(rSmall.result.image.base64).toBeTruthy();
      expect(rSmall.result.image.spillRef).toBeUndefined();
    }
  });
});
