import { describe, it, expect } from 'vitest';
import { artifactsToSources } from '../../../src/studio/synthesize.js';
import type { ArtifactFullRow } from '../../../src/studio/capture/artifacts.js';

const row = (over: Partial<ArtifactFullRow> = {}): ArtifactFullRow =>
  ({ id: 1, type: 'clip', url: 'https://ex.com/a', title: 'A', markdown: 'body A', contentTrusted: 0, createdAt: '2026-07-09T00:00:00Z', ...over });

describe('synthesize — artifactsToSources adapter', () => {
  it('maps rows to index-aligned sources + provenance (source[i] ↔ provenance[i] ↔ artifactId)', () => {
    const rows = [row({ id: 10 }), row({ id: 20, url: 'https://ex.com/b', markdown: 'body B' })];
    const { sources, provenance } = artifactsToSources(rows);
    expect(sources).toHaveLength(2);
    expect(provenance.map((p) => p.artifactId)).toEqual([10, 20]);
    // a key_finding_sources index into `sources` resolves back to the capturing artifact via `provenance`
    expect(sources[1].markdown_content).toBe('body B');
    expect(provenance[1].artifactId).toBe(20);
    expect(provenance[1].url).toBe('https://ex.com/b');
  });

  it('tags trusted from content_trusted (page bodies stay untrusted-as-instructions)', () => {
    const { sources } = artifactsToSources([row({ contentTrusted: 0 }), row({ id: 2, contentTrusted: 1 })]);
    expect(sources[0].trusted).toBe(false);
    expect(sources[1].trusted).toBe(true);
    expect(sources.every((s) => s.fetched && s.relevance_score === 1)).toBe(true);
  });

  it('a url-less capture gets a stable studio:// pseudo-url (never an empty citation)', () => {
    const { sources } = artifactsToSources([row({ id: 7, url: null, title: null })]);
    expect(sources[0].url).toBe('studio://artifact/7');
    expect(sources[0].title).toBe('(untitled capture)');
  });

  it('a zero-capture session → empty sources (honest empty, no fabrication)', () => {
    expect(artifactsToSources([])).toEqual({ sources: [], provenance: [] });
  });
});
