/**
 * P3 acceptance: brand font extraction across 6 representative real-world
 * source-shape fixtures.
 *
 * Why this exists: the 0.1.20 cross-codebase acceptance report found
 * `fonts.headings` / `fonts.body` populated on only 1 of 6 tested sites
 * (Figma — the only one whose font was wired through inline `style="..."`).
 * Every other site (Stripe, Linear, Vercel, HackerNews) declared their
 * brand typography through a path the heuristic didn't cover, so the
 * `provenance.fonts` field came back `"unknown"`.
 *
 * This suite pins the broadened heuristic against representative HTML
 * snippets shaped after each site's real font declaration, so a future
 * regression that narrows any source path immediately lights up here.
 *
 * Each fixture intentionally exercises ONE source path so we can confirm
 * the priority chain doesn't accidentally swap. `example.com` is the
 * "honest unknown" canary — confirms we still return `fonts: undefined`
 * and `provenance.fonts: 'unknown'` when no real source fires.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractBrand } from '../../../src/extraction/brand.js';

const fixturesDir = join(import.meta.dirname, '../../fixtures/brand/fonts');

function loadFixture(slug: string): string {
  return readFileSync(join(fixturesDir, `${slug}.html`), 'utf-8');
}

describe('brand font acceptance — 5 representative source paths', () => {
  it('stripe — Google Fonts link + <style>-block body rule', () => {
    // Stripe's marketing pages set Sohne via both a Google Fonts <link>
    // (newer pages) and a body { font-family: ... } rule. We expect the
    // <style>-block CSS-rule path to win because it appears in the
    // priority chain ahead of the Google Fonts link.
    const out = extractBrand(loadFixture('stripe'), { baseUrl: 'https://stripe.com/' });
    const fonts = [...(out.fonts?.body ?? []), ...(out.fonts?.headings ?? [])];
    expect(fonts).toContain('Sohne');
    expect(out.provenance?.fonts).toBe('css-rule');
  });

  it('linear — Google Fonts link only (Inter)', () => {
    // Pure Google-Fonts-only path. No <style> block, no inline attr.
    const out = extractBrand(loadFixture('linear'), { baseUrl: 'https://linear.app/' });
    expect(out.fonts?.body).toContain('Inter');
    expect(out.provenance?.fonts).toBe('google-fonts-link');
  });

  it('vercel — <style>-block body / h1 rule (Geist)', () => {
    // Vercel uses a body { font-family: Geist, ... } rule. The first
    // brand font in the stack should land in `body` and `headings`.
    const out = extractBrand(loadFixture('vercel'), { baseUrl: 'https://vercel.com/' });
    expect(out.fonts?.body).toContain('Geist');
    expect(out.fonts?.headings).toContain('Geist');
    expect(out.provenance?.fonts).toBe('css-rule');
  });

  it('hackernews — body { font-family: Verdana, ... } in <style> block', () => {
    // HN is a stress test for the heuristic: tiny page, no JSON-LD, no
    // CSS vars, no Google Fonts. Just `body { font-family: Verdana, ... }`.
    // Verdana is filtered as a generic-ish system font in some setups —
    // we explicitly DO NOT filter it because it's the actual brand
    // signal here. Without Verdana, HN's typography fingerprint is gone.
    const out = extractBrand(loadFixture('hackernews'), { baseUrl: 'https://news.ycombinator.com/' });
    expect(out.fonts?.body).toContain('Verdana');
    expect(out.provenance?.fonts).toBe('css-rule');
  });

  it('figma — inline style="font-family:..." on <h1>', () => {
    // Figma was the one acceptance-passing site at 0.1.20 — it sets
    // 'Whyte' via inline style attributes on heading elements. Keep
    // this working: it's the canonical inline-style attribute case.
    const out = extractBrand(loadFixture('figma'), { baseUrl: 'https://www.figma.com/' });
    expect(out.fonts?.headings).toContain('Whyte');
    expect(out.provenance?.fonts).toBe('inline-style');
  });

  it('example.com — no real font source, returns honest "unknown"', () => {
    // The "honest provenance" canary. example.com has nothing — we
    // must NOT invent a font. fonts must be undefined (not `{}`) so
    // downstream callers can distinguish "no signal" from "empty".
    const out = extractBrand(loadFixture('example'), { baseUrl: 'https://example.com/' });
    expect(out.fonts).toBeUndefined();
    expect(out.provenance?.fonts).toBe('unknown');
  });

  it('aggregate — at least 4 of 5 brand sites yield a non-empty font', () => {
    // The acceptance target from the spec. example.com is excluded
    // because it's the negative case.
    const brandSites = ['stripe', 'linear', 'vercel', 'hackernews', 'figma'];
    let withFont = 0;
    for (const slug of brandSites) {
      const out = extractBrand(loadFixture(slug), { baseUrl: 'https://x.example/' });
      const total = (out.fonts?.headings?.length ?? 0) + (out.fonts?.body?.length ?? 0);
      if (total > 0) withFont++;
    }
    expect(withFont).toBeGreaterThanOrEqual(4);
  });
});
