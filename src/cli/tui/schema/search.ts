import type { CategoryDef } from './types.js';

export const searchCategory: CategoryDef = {
  id: 'search',
  label: 'Search',
  description: 'Search backend, reranker, and embedding model',
  fields: [
    {
      key: 'WIGOLO_SEARCH',
      settingsPath: 'searchBackend',
      label: 'Backend',
      kind: 'select',
      options: [
        { value: 'core', label: 'Core', hint: 'direct engines + RRF + ML rerank' },
        { value: 'searxng', label: 'SearXNG', hint: 'legacy aggregator' },
        { value: 'hybrid', label: 'Hybrid', hint: 'core with smart fallback' },
      ],
      default: 'core',
      help: 'Search backend',
    },
    {
      key: 'WIGOLO_RERANKER',
      settingsPath: 'reranker',
      label: 'Reranker',
      kind: 'toggle',
      default: true,
      help: 'Use ML reranker for results',
    },
    {
      key: 'WIGOLO_RERANKER_MODEL',
      settingsPath: 'rerankerModel',
      label: 'Reranker model',
      kind: 'text',
      default: 'ms-marco-MiniLM-L-12-v2',
      help: 'FlashRank model name',
    },
    {
      key: 'WIGOLO_EMBEDDING_MODEL',
      settingsPath: 'embeddingModel',
      label: 'Embedding model',
      kind: 'text',
      default: 'all-MiniLM-L6-v2',
      help: 'Sentence-transformers model name',
    },
  ],
};
