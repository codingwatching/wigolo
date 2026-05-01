import { describe, it, expect } from 'vitest';
import { assertMode, resolveMode } from '../../../src/util/mode.js';

describe('assertMode', () => {
  it('accepts undefined and the three valid modes', () => {
    expect(() => assertMode(undefined)).not.toThrow();
    for (const m of ['fast', 'balanced', 'deep']) {
      expect(() => assertMode(m)).not.toThrow();
    }
  });
  it('rejects unknown values with a message listing valid ones', () => {
    expect(() => assertMode('turbo')).toThrow(/fast.*balanced.*deep/);
    expect(() => assertMode(42)).toThrow();
    expect(() => assertMode(null)).toThrow();
  });
});

describe('resolveMode', () => {
  it('returns balanced for undefined', () => {
    expect(resolveMode(undefined)).toBe('balanced');
  });
  it('returns the value for valid modes', () => {
    expect(resolveMode('fast')).toBe('fast');
    expect(resolveMode('deep')).toBe('deep');
  });
  it('throws for invalid', () => {
    expect(() => resolveMode('x')).toThrow();
  });
});
