import { describe, it, expect } from 'vitest';
import { unwrapRedirect } from '../../../src/search/url-unwrap.js';

describe('unwrapRedirect', () => {
  it('unwraps duckduckgo redirect', () => {
    const wrapped = '//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&rut=abc';
    expect(unwrapRedirect(wrapped)).toBe('https://example.com/page');
  });

  it('unwraps duckduckgo redirect with https prefix', () => {
    const wrapped = 'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage';
    expect(unwrapRedirect(wrapped)).toBe('https://example.com/page');
  });

  it('returns null when not a redirect', () => {
    expect(unwrapRedirect('https://example.com/page')).toBeNull();
  });

  it('returns null when uddg missing', () => {
    expect(unwrapRedirect('//duckduckgo.com/l/?foo=bar')).toBeNull();
  });

  it('returns null on malformed uddg', () => {
    expect(unwrapRedirect('//duckduckgo.com/l/?uddg=%E0')).toBeNull();
  });

  it('handles google redirect /url?q=', () => {
    expect(unwrapRedirect('https://www.google.com/url?q=https%3A%2F%2Fexample.com%2F&sa=U')).toBe('https://example.com/');
  });

  it('keeps result http(s)-only', () => {
    const wrapped = '//duckduckgo.com/l/?uddg=javascript%3Aalert(1)';
    expect(unwrapRedirect(wrapped)).toBeNull();
  });
});
