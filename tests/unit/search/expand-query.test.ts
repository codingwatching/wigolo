import { describe, it, expect } from 'vitest';
import { expandQueryHeuristic } from '../../../src/search/multi-query.js';

describe('expandQueryHeuristic', () => {
  it('returns 3-5 unique variants with the original at index 0', () => {
    const out = expandQueryHeuristic('react server components');
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out.length).toBeLessThanOrEqual(5);
    expect(out[0]).toBe('react server components');
    expect(new Set(out).size).toBe(out.length);
  });
  it('trims leading/trailing whitespace on the original', () => {
    expect(expandQueryHeuristic('  go generics  ')[0]).toBe('go generics');
  });
});
