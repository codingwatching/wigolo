import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractContent } from '../../../src/extraction/pipeline.js';
import { deduplicatePages } from '../../../src/crawl/dedup.js';

describe('crawl nav-dedupe — leaky next.js fixture', () => {
  it('nav text appears at most once across the merged corpus', async () => {
    const pages: { url: string; markdown: string }[] = [];
    for (let i = 1; i <= 5; i++) {
      const html = readFileSync(
        join(import.meta.dirname, `../../fixtures/crawl/nextjs-docs/page-${i}.html`),
        'utf8',
      );
      const r = await extractContent(html, `https://example.com/docs/page-${i}`);
      pages.push({ url: `https://example.com/docs/page-${i}`, markdown: r.markdown });
    }
    const deduped = deduplicatePages(pages);
    const merged = deduped.map((p) => p.markdown).join('\n');
    const navMarker = 'Documentation Home';
    const occurrences = (merged.match(new RegExp(navMarker, 'g')) ?? []).length;
    expect(occurrences).toBeLessThanOrEqual(1);
  });
});
