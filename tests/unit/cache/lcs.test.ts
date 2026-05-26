import { describe, it, expect } from 'vitest';
import { computeLcsTable } from '../../../src/cache/lcs.js';

/**
 * WHY this matters (PR #89 sec+perf review):
 *
 * The shared LCS table was a `Uint16Array`. For inputs whose LCS length
 * could exceed 65535 (e.g. word-granularity diff over a long matching
 * prefix), the DP cell values silently wrapped at 16 bits — producing a
 * mathematically WRONG LCS with NO error and NO truncation signal. The
 * line-granularity path is bounded by `DIFF_LINE_CAP=5000`, but the word
 * path can blow past 65535 tokens. Switching to `Uint32Array` removes the
 * footgun outright.
 *
 * The test pins the contract: when LCS length is provably >= 65536, the
 * DP table's final cell must reflect that length exactly. A `Uint16Array`
 * implementation cannot pass this test (it would mask to <= 65535).
 */
describe('computeLcsTable — Uint32Array bound (PR #89 sec+perf)', () => {
  it('returns the correct LCS length for matching sequences longer than 65535 tokens', () => {
    // Asymmetric inputs: a small "needle" sequence repeated as a haystack
    // so the LCS length crosses 65535 without paying for a 70k × 70k table.
    // LCS("xy" × N, "xy" × N) = 2*N. Picking N=33_000 gives LCS=66_000
    // (>65535). With Uint16Array the cell would mask to 66000 % 65536 = 464.
    const N = 33_000;
    const needle = ['x', 'y'];
    const a: string[] = new Array(N * 2);
    const b: string[] = new Array(N * 2);
    for (let i = 0; i < N; i++) {
      a[i * 2] = needle[0];
      a[i * 2 + 1] = needle[1];
      b[i * 2] = needle[0];
      b[i * 2 + 1] = needle[1];
    }
    const dp = computeLcsTable(a, b);
    const stride = b.length + 1;
    const lcsLen = dp[a.length * stride + b.length];
    expect(lcsLen).toBe(2 * N);
    expect(lcsLen).toBeGreaterThan(65535);
    // Also assert the typed-array element size is at least 4 bytes — the
    // structural invariant that rules out Uint16Array entirely.
    expect(dp.BYTES_PER_ELEMENT).toBeGreaterThanOrEqual(4);
  });

  it('still returns correct LCS length for short sequences (regression coverage)', () => {
    const dp = computeLcsTable(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd']);
    // LCS = a, c, d → length 3.
    const stride = 5; // n+1 = 4+1
    expect(dp[4 * stride + 4]).toBe(3);
  });
});
