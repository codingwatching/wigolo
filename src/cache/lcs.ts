/**
 * Shared LCS DP table for diff-engine + diff-summary.
 *
 * Uses a single packed `Uint32Array` of size (m+1) * (n+1). Indexed as
 * `i * (n + 1) + j`. LCS length is bounded by `Math.min(m, n)`.
 *
 * Why Uint32Array (not Uint16Array): the line-granularity path is bounded
 * by `DIFF_LINE_CAP=5000` which fits in 16 bits, but the word-granularity
 * path tokenises both sides and can produce >65535 matching tokens. A
 * 16-bit table silently wrapped at 65536, producing a mathematically WRONG
 * LCS with NO error and NO truncation signal — see PR #89 sec+perf
 * review. Uint32Array removes the footgun outright; the perf delta versus
 * Uint16Array is negligible on modern CPUs.
 *
 * Why packed: the prior 2D JS array allocates (m+1) sub-arrays of boxed
 * numbers — at 5000-cap that's 25M boxed values across 5001 arrays. A
 * single typed array is ~8x faster on the same shape and far easier on GC.
 */
export function computeLcsTable(oldLines: string[], newLines: string[]): Uint32Array {
  const m = oldLines.length;
  const n = newLines.length;
  const stride = n + 1;
  const dp = new Uint32Array((m + 1) * stride);

  for (let i = 1; i <= m; i++) {
    const oi = oldLines[i - 1];
    const rowBase = i * stride;
    const prevRowBase = rowBase - stride;
    for (let j = 1; j <= n; j++) {
      if (oi === newLines[j - 1]) {
        dp[rowBase + j] = dp[prevRowBase + (j - 1)] + 1;
      } else {
        const up = dp[prevRowBase + j];
        const left = dp[rowBase + (j - 1)];
        dp[rowBase + j] = up >= left ? up : left;
      }
    }
  }
  return dp;
}

/** Index helper kept inline-able for hot loops, but exported for callers that prefer it. */
export function lcsAt(dp: Uint32Array, i: number, j: number, stride: number): number {
  return dp[i * stride + j];
}
