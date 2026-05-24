const TAU_DAYS = 30;
const MS_PER_DAY = 86_400_000;

/**
 * Returns a multiplier in [1.0, 2.0] based on how recent the date is.
 * Continuous decay: 1 + e^(-ageDays / 30). Calibrated to ~2.0 today,
 * ~1.79 at 7d, ~1.37 at 30d, ~1.0 at 180d+.
 */
export function recencyMultiplier(
  publishedDate: string | undefined,
  now: Date = new Date(),
): number {
  if (!publishedDate) return 1.0;
  const parsed = new Date(publishedDate);
  const t = parsed.getTime();
  if (Number.isNaN(t)) return 1.0;

  const ageMs = Math.max(0, now.getTime() - t);
  const ageDays = ageMs / MS_PER_DAY;
  const raw = 1 + Math.exp(-ageDays / TAU_DAYS);

  if (raw < 1.0) return 1.0;
  if (raw > 2.0) return 2.0;
  return raw;
}

const TEMPORAL_WORD_RE =
  /\b(latest|today|yesterday|this week|this month|this year|news|breaking|recent|update|now|current)\b/i;
const TEMPORAL_YEAR_RE = /\b(20[2-3][0-9])\b/;
const TEMPORAL_LAST_RE = /\blast\s+\d+\s+(day|days|week|weeks|month|months|year|years)\b/i;
const TEMPORAL_PAST_RE = /\bpast\s+\d+\s+(day|days|week|weeks|month|months|year|years)\b/i;

/** Cheap regex check for temporal intent keywords. */
export function hasTemporalIntent(query: string): boolean {
  if (!query) return false;
  if (TEMPORAL_WORD_RE.test(query)) return true;
  if (TEMPORAL_YEAR_RE.test(query)) {
    const m = query.match(TEMPORAL_YEAR_RE);
    if (m) {
      const y = Number(m[1]);
      if (y >= 2020 && y <= 2030) return true;
    }
  }
  if (TEMPORAL_LAST_RE.test(query)) return true;
  if (TEMPORAL_PAST_RE.test(query)) return true;
  return false;
}
