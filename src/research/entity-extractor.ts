/**
 * Deterministic named-entity extractor for research questions. Identifies
 * ALL_CAPS acronyms, CamelCase proper nouns, mixed-case+digit identifiers
 * (e.g. A2A, PG18, S3) and double-quoted phrases. Used to detect when a
 * decomposed sub-query set fails to cover a named entity from the original
 * question — the missing entity is then surfaced in `brief.sections.gaps`.
 */

export interface EntityGap {
  entity: string;
  reason: string;
}

// Common-noun question / sentence-start words to drop even if capitalised.
const STOP_WORDS = new Set([
  'what', 'how', 'why', 'when', 'where', 'which', 'who', 'whose',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'the', 'a', 'an', 'and', 'or', 'but', 'so',
  'in', 'on', 'of', 'for', 'to', 'by', 'as', 'at', 'from', 'with', 'about',
  'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might',
  'best', 'top', 'good', 'better', 'worst', 'between', 'among', 'across',
  'tradeoffs', 'tradeoff', 'comparison', 'overview', 'guide', 'tutorial',
]);

const ENTITY_TOKEN = /^[A-Z][A-Za-z0-9]+$|^[A-Z][A-Z0-9]+$/;
const QUOTED_PHRASE = /["“]([^"”]{2,80})["”]/g;

function normaliseToken(raw: string): string {
  return raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
}

export function extractNamedEntities(input: string): string[] {
  if (!input) return [];
  const seen = new Map<string, string>();

  for (const match of input.matchAll(QUOTED_PHRASE)) {
    const phrase = match[1].trim();
    if (!phrase) continue;
    const key = phrase.toLowerCase();
    if (!seen.has(key)) seen.set(key, phrase);
  }

  for (const rawToken of input.split(/[\s,;:.!?()\[\]{}\-]+/)) {
    const token = normaliseToken(rawToken);
    if (!token) continue;
    if (STOP_WORDS.has(token.toLowerCase())) continue;
    if (!ENTITY_TOKEN.test(token)) continue;
    const key = token.toLowerCase();
    if (!seen.has(key)) seen.set(key, token);
  }

  return [...seen.values()];
}

export function detectEntityGaps(question: string, subQueries: string[]): EntityGap[] {
  const entities = extractNamedEntities(question);
  if (entities.length === 0) return [];
  const haystack = subQueries.join(' \n ').toLowerCase();
  const gaps: EntityGap[] = [];
  for (const entity of entities) {
    if (!haystack.includes(entity.toLowerCase())) {
      gaps.push({ entity, reason: 'no sub-query planned' });
    }
  }
  return gaps;
}
