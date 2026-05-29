import { describe, it, expect } from 'vitest';
import { llmCategory } from '../../../../../src/cli/tui/schema/llm.js';

describe('llmCategory (stub, real fields land in slice 8)', () => {
  it('has id llm with the spec label/description and an empty field list', () => {
    expect(llmCategory.id).toBe('llm');
    expect(llmCategory.label).toBe('LLM Provider');
    expect(llmCategory.description).toMatch(/research\/agent/i);
    expect(llmCategory.fields).toEqual([]);
  });
});
