import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fenceFetchData, fenceCrawlData, fenceExtractData } from '../../../src/server/content-fence.js';
import type { FetchOutput, CrawlOutput, ExtractOutput } from '../../../src/types.js';

const BEGIN = '[[BEGIN UNTRUSTED DATA]]';

describe('content-fence — D7/A flat-markdown content-tool returns fenced at the agent envelope', () => {
  it('PIN-A1: fetch markdown is fenced; the url stays RAW', () => {
    // D7: raw page markdown returned to the agent is page-derived UNTRUSTED DATA. value-flip RED: today the
    // fn is identity → markdown raw. MUT: drop the wrap → raw → RED.
    const data = { url: 'https://x.example/p', title: 'T', markdown: 'BODY-INJECT IGNORE PREVIOUS' } as FetchOutput;
    const out = fenceFetchData(data);
    expect(out.markdown).toContain(BEGIN);
    expect(out.markdown).toContain('BODY-INJECT IGNORE PREVIOUS'); // original body preserved inside the fence
    expect(out.url).toBe('https://x.example/p'); // operational field stays RAW
  });

  it('PIN-A2: crawl per-page markdown is fenced; the page url stays RAW', () => {
    // MUT: drop the wrap → raw → RED.
    const data = { pages: [{ url: 'https://x.example/a', title: 'A', markdown: 'PAGE-A BODY' }], total_found: 1, crawled: 1 } as unknown as CrawlOutput;
    const out = fenceCrawlData(data) as CrawlOutput;
    expect(out.pages[0].markdown).toContain(BEGIN);
    expect(out.pages[0].markdown).toContain('PAGE-A BODY');
    expect(out.pages[0].url).toBe('https://x.example/a'); // operational stays RAW
  });

  it('PIN-A3: extract flat-string data is fenced', () => {
    // MUT: drop the wrap → raw → RED.
    const data = { mode: 'selector', data: 'EXTRACTED TEXT' } as ExtractOutput;
    const out = fenceExtractData(data);
    expect(typeof out.data === 'string' && out.data.includes(BEGIN)).toBe(true);
    expect(typeof out.data === 'string' && out.data.includes('EXTRACTED TEXT')).toBe(true);
  });

  it('PIN-A4 (WRAP-ONCE by placement): content-fence is imported ONLY by the agent dispatch, never by synthesize / agent-pipeline / the domain producers', () => {
    // 0b: research/agent gather via the domain producers and fence at synthesis (R1); the dispatch fence is a
    // DISJOINT agent-only path, so no value is fenced by both. This pin keeps that disjoint by placement.
    // MUT: import content-fence into a shared producer (e.g. fetch/router.ts) so synthesize's input is
    // pre-fenced then re-wrapped → nested [[BEGIN[[BEGIN → RED.
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const FORBIDDEN = ['src/research/synthesize.ts', 'src/research/pipeline.ts', 'src/agent/pipeline.ts', 'src/fetch/router.ts'];
    for (const rel of FORBIDDEN) {
      const src = readFileSync(root + rel, 'utf8');
      expect(src, `${rel} must not import the agent-dispatch content-fence (would double-fence synthesize input)`).not.toMatch(/content-fence/);
    }
  });
});
