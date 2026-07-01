import type { VerifyResult } from './verify.js';

export type VerifyCheckId =
  | 'searxng'
  | 'reranker'
  | 'embeddings';

const TABLE: Record<VerifyCheckId, string> = {
  'searxng': 'Search engine failed to start. Try: npx @knockoutez/wigolo warmup --force',
  'reranker': 'ML reranker is not installed. Run: npx @knockoutez/wigolo warmup',
  'embeddings': 'Embeddings model is not installed. Run: npx @knockoutez/wigolo warmup',
};

export function suggestionFor(id: VerifyCheckId): string {
  return TABLE[id];
}

export function suggestionsFromResult(result: VerifyResult): string[] {
  const out: string[] = [];
  if (result.searxng !== 'ok') out.push(suggestionFor('searxng'));
  if (result.reranker !== 'ok') out.push(suggestionFor('reranker'));
  if (result.embeddings !== 'ok') out.push(suggestionFor('embeddings'));
  return out;
}
