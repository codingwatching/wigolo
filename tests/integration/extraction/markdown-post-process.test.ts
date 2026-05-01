import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractContent } from '../../../src/extraction/pipeline.js';

const fixture = readFileSync(
  join(import.meta.dirname, '../../fixtures/extraction/react-managing-state.html'),
  'utf8',
);
const URL = 'https://react.dev/learn/managing-state';

describe('markdown post-process — react fixture', () => {
  it('strips Was this helpful?', async () => {
    const r = await extractContent(fixture, URL);
    expect(r.markdown.toLowerCase()).not.toContain('was this helpful?');
  });

  it('strips Edit this page', async () => {
    const r = await extractContent(fixture, URL);
    expect(r.markdown.toLowerCase()).not.toContain('edit this page');
  });

  it('every fenced block with a class hint carries a lang tag', async () => {
    const r = await extractContent(fixture, URL);
    const tagged = r.markdown.match(/```[a-z]+/g) ?? [];
    expect(tagged.length).toBeGreaterThanOrEqual(2);
  });

  it('all anchor links are absolute', async () => {
    const r = await extractContent(fixture, URL);
    const bareAnchor = /\]\(#[^)]+\)/.test(r.markdown);
    expect(bareAnchor).toBe(false);
  });
});
