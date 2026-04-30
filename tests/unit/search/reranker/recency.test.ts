import { describe, it, expect } from 'vitest';
import { hasRecencyIntent, recencyFactor } from '../../../../src/search/reranker/recency.js';

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

describe('hasRecencyIntent', () => {
  const fixedNow = new Date('2026-04-30T00:00:00Z');

  it.each([
    'recent pgEdge releases',
    'latest pgEdge multi-master',
    'new typescript features',
    'just released playwright',
    'pgEdge today',
    'updates this week',
    'pgEdge 2026',
    'pgEdge 2027 roadmap',
  ])('matches "%s"', (q) => {
    expect(hasRecencyIntent(q, fixedNow)).toBe(true);
  });

  it.each([
    'pgEdge multi-master architecture',
    'how does typescript generics work',
    'pgEdge 2024 docs',
    'pgEdge 2025 issues',
  ])('does NOT match "%s"', (q) => {
    expect(hasRecencyIntent(q, fixedNow)).toBe(false);
  });

  it('dynamic current-year matching tracks the calendar', () => {
    const future = new Date('2030-01-15T00:00:00Z');
    expect(hasRecencyIntent('typescript 2030', future)).toBe(true);
    expect(hasRecencyIntent('typescript 2026', future)).toBe(false);
  });
});

describe('recencyFactor', () => {
  it('< 7 days → 1.5×', () => {
    expect(recencyFactor(isoDaysAgo(3))).toBe(1.5);
  });
  it('< 30 days → 1.3×', () => {
    expect(recencyFactor(isoDaysAgo(20))).toBe(1.3);
  });
  it('< 90 days → 1.1×', () => {
    expect(recencyFactor(isoDaysAgo(60))).toBe(1.1);
  });
  it('≥ 90 days → 1.0×', () => {
    expect(recencyFactor(isoDaysAgo(200))).toBe(1.0);
  });
  it('undefined published_date → 1.0×', () => {
    expect(recencyFactor(undefined)).toBe(1.0);
  });
  it('invalid published_date → 1.0×', () => {
    expect(recencyFactor('not-a-date')).toBe(1.0);
  });
  it('exactly 7d boundary → 1.3× (< 7 strict)', () => {
    expect(recencyFactor(isoDaysAgo(7))).toBe(1.3);
  });
});
