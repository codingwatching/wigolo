import { describe, it, expect } from 'vitest';
import { agentsCategory } from '../../../../../src/cli/tui/schema/agents.js';

describe('agentsCategory (stub, real fields land in slice 9)', () => {
  it('has id agents with a non-empty label/description and an empty field list', () => {
    expect(agentsCategory.id).toBe('agents');
    expect(agentsCategory.label).toBeTruthy();
    expect(agentsCategory.description).toBeTruthy();
    expect(agentsCategory.fields).toEqual([]);
  });
});
