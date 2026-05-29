import { describe, it, expect } from 'vitest';
import { searchCategory } from '../../../../../src/cli/tui/schema/search.js';

describe('searchCategory', () => {
  it('has id search and the four expected fields', () => {
    expect(searchCategory.id).toBe('search');
    expect(searchCategory.fields.length).toBe(4);
    const keys = searchCategory.fields.map((f) => f.key);
    expect(keys).toEqual([
      'WIGOLO_SEARCH',
      'WIGOLO_RERANKER',
      'WIGOLO_RERANKER_MODEL',
      'WIGOLO_EMBEDDING_MODEL',
    ]);
  });

  it('WIGOLO_SEARCH offers core/searxng/hybrid with core default', () => {
    const f = searchCategory.fields.find((x) => x.key === 'WIGOLO_SEARCH');
    expect(f?.kind).toBe('select');
    expect(f?.default).toBe('core');
    expect(f?.options?.map((o) => o.value)).toEqual(['core', 'searxng', 'hybrid']);
  });

  it('WIGOLO_RERANKER is a toggle defaulting to true', () => {
    const f = searchCategory.fields.find((x) => x.key === 'WIGOLO_RERANKER');
    expect(f?.kind).toBe('toggle');
    expect(f?.default).toBe(true);
  });

  it('WIGOLO_RERANKER_MODEL defaults to ms-marco MiniLM L-12', () => {
    const f = searchCategory.fields.find((x) => x.key === 'WIGOLO_RERANKER_MODEL');
    expect(f?.kind).toBe('text');
    expect(f?.default).toBe('ms-marco-MiniLM-L-12-v2');
  });

  it('WIGOLO_EMBEDDING_MODEL defaults to all-MiniLM-L6-v2', () => {
    const f = searchCategory.fields.find((x) => x.key === 'WIGOLO_EMBEDDING_MODEL');
    expect(f?.kind).toBe('text');
    expect(f?.default).toBe('all-MiniLM-L6-v2');
  });

  it('every field has settingsPath + label', () => {
    for (const f of searchCategory.fields) {
      expect(f.settingsPath, `field ${f.key} missing settingsPath`).toBeTruthy();
      expect(f.label, `field ${f.key} missing label`).toBeTruthy();
    }
  });
});
