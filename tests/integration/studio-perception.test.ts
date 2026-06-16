import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PageSnapshotter, type PageSnapshot } from '../../src/studio/perception/snapshot.js';

/**
 * The regression wall (CEO sign-off #2, item 1): the 2D spike's numbers transfer
 * ONLY if production runs the same ID algorithm. So the spike fixtures are PORTED
 * here and pinned against the PRODUCTION PageSnapshotter — any drift in fingerprint
 * normalization or the positional tiebreaker breaks these, not just a thrown-away
 * harness. Headed; skips by default (RUN_STUDIO_HEADED=1 to run).
 */
const HEADED = !!process.env.RUN_STUDIO_HEADED;
const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'studio');
const url = (f: string) => 'file://' + join(FIX, f);

const attrsObj = (a: string[] = []) => { const o: Record<string, string> = {}; for (let i = 0; i + 1 < a.length; i += 2) o[a[i]] = a[i + 1]; return o; };

interface DomNode { backendNodeId?: number; attributes?: string[]; children?: DomNode[]; shadowRoots?: DomNode[]; contentDocument?: DomNode }

describe.skipIf(!HEADED)('studio perception — production snapshot reproduces the 2D verdict numbers', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser?.close(); });

  // Resolve the ground-truth data-oracle for each ref via refMap → backendNodeId → pierced-DOM attrs.
  async function observe(cdp: { send: (m: string, p?: Record<string, unknown>) => Promise<unknown> }): Promise<{ snap: PageSnapshot; byOracle: Map<string, { ref: string; confidence?: string }> }> {
    const snap = await new PageSnapshotter({ tokenBudget: 1_000_000 }).snapshot(cdp);
    const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: DomNode };
    const oracleOf = new Map<number, string>();
    const walk = (n: DomNode) => {
      const o = attrsObj(n.attributes)['data-oracle'];
      if (n.backendNodeId != null && o) oracleOf.set(n.backendNodeId, o);
      for (const c of n.children ?? []) walk(c);
      for (const s of n.shadowRoots ?? []) walk(s);
      if (n.contentDocument) walk(n.contentDocument);
    };
    walk(root);
    const byOracle = new Map<string, { ref: string; confidence?: string }>();
    for (const e of snap.elements) {
      const be = snap.refMap.get(e.ref);
      const oracle = be != null ? oracleOf.get(be) : undefined;
      if (oracle) byOracle.set(oracle, e);
    }
    return { snap, byOracle };
  }

  const survival = (a: Map<string, { ref: string }>, b: Map<string, { ref: string }>, pred: (o: string) => boolean) => {
    let hit = 0, tot = 0;
    for (const [o, ea] of a) { if (!pred(o)) continue; tot++; const eb = b.get(o); if (eb && eb.ref === ea.ref) hit++; }
    return { hit, tot };
  };
  const isDistinct = (o: string) => o.startsWith('task-') || o.startsWith('field-');
  const isDup = (o: string) => o.startsWith('del-');

  async function open(f: string) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('Accessibility.enable');
    await page.goto(url(f));
    await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
    return { ctx, page, cdp };
  }

  it('determinism: two observes of an unchanged page give identical refs (the trivial floor)', async () => {
    const { ctx, cdp } = await open('rerender.html');
    const a = await observe(cdp);
    const b = await observe(cdp);
    const d = survival(a.byOracle, b.byOracle, () => true);
    expect(d.hit).toBe(d.tot);
    expect(d.tot).toBe(15); // 5 task + 5 field + 5 delete
    await ctx.close();
  });

  it('hybrid reproduces survival across content-preserving mutations (distinct 100%; dup-reorder drifts)', async () => {
    for (const [hook, expectDupHit] of [['__rerender', 5], ['__insert', 5], ['__hydrate', 5], ['__reorder', 1]] as const) {
      const { ctx, page, cdp } = await open('rerender.html');
      const before = await observe(cdp);
      await page.evaluate((h) => (window as unknown as Record<string, () => void>)[h](), hook);
      const after = await observe(cdp);
      const dist = survival(before.byOracle, after.byOracle, isDistinct);
      const dup = survival(before.byOracle, after.byOracle, isDup);
      expect(dist.hit).toBe(dist.tot); // distinct names: 100% survival across the identity swap
      expect(dup.hit).toBe(expectDupHit); // dup run: 100% except reorder where positional refs drift to 1/5 (20%)
      expect(dup.tot).toBe(5);
      await ctx.close();
    }
  });

  it('uniqueness + low-confidence: 5 identical "Delete" get 5 distinct refs, all flagged low at snapshot time', async () => {
    const { ctx, cdp } = await open('rerender.html');
    const { byOracle } = await observe(cdp);
    const dupRefs = [...byOracle].filter(([o]) => isDup(o)).map(([, e]) => e);
    expect(new Set(dupRefs.map((e) => e.ref)).size).toBe(5); // not ambiguous (the fp-only failure)
    expect(dupRefs.every((e) => e.confidence === 'low')).toBe(true);
    expect([...byOracle].filter(([o]) => isDistinct(o)).every(([, e]) => e.confidence === undefined)).toBe(true);
    await ctx.close();
  });

  it('shadow-DOM piercing: open + nested-open + CLOSED interactive elements are all observed', async () => {
    const { ctx, cdp } = await open('webcomponents.html');
    const { byOracle } = await observe(cdp);
    for (const o of ['light-1', 'open-1', 'open-2', 'nested-1', 'closed-1']) {
      expect(byOracle.has(o), `expected to observe ${o}`).toBe(true);
    }
    await ctx.close();
  });
});
