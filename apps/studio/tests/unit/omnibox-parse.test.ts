import { describe, it, expect } from 'vitest';
import { parseOmnibox, omniboxLeadHint } from '../../src/renderer/omnibox-parse';

describe('parseOmnibox — one box must never misroute (spec §3 dual-mode omnibox)', () => {
  it('passes full URLs through untouched', () => {
    expect(parseOmnibox('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
  });
  it('upgrades bare domains to https', () => {
    expect(parseOmnibox('example.com')).toBe('https://example.com');
    expect(parseOmnibox('sub.example.co.uk/path')).toBe('https://sub.example.co.uk/path');
  });
  it('keeps localhost and ports navigable — DOM-to-code flow depends on it', () => {
    expect(parseOmnibox('localhost:3000')).toBe('http://localhost:3000');
    expect(parseOmnibox('127.0.0.1:8080/x')).toBe('http://127.0.0.1:8080/x');
  });
  it('treats anything with spaces as a search', () => {
    expect(parseOmnibox('best pricing page examples')).toBe(
      'https://duckduckgo.com/?q=best%20pricing%20page%20examples',
    );
  });
  it('treats dotless single words as a search, not a hostname', () => {
    expect(parseOmnibox('electron')).toBe('https://duckduckgo.com/?q=electron');
  });
});

describe('omniboxLeadHint — the glyph never contradicts what Enter does (P6 F2)', () => {
  it('URL-looking text is nav, never intent, on the Enter path', () => {
    expect(omniboxLeadHint('https://x.test', false)).toBe('nav');
    expect(omniboxLeadHint('localhost:3000', false)).toBe('nav');
    expect(omniboxLeadHint('sub.example.co.uk/path', false)).toBe('nav');
  });
  it('plain query is search, not nav', () => {
    expect(omniboxLeadHint('best pricing tools', false)).toBe('search');
    expect(omniboxLeadHint('electron', false)).toBe('search'); // dotless single word → search (agrees w/ parseOmnibox)
  });
  it('Tab focus signals intent regardless of text (NEGATIVE: a URL under ⇥ is intent, not nav)', () => {
    expect(omniboxLeadHint('best pricing tools', true)).toBe('intent');
    expect(omniboxLeadHint('https://x.test', true)).toBe('intent');
  });
  it('agrees with parseOmnibox on the same input (nav ⇔ a non-search url, search ⇔ the search url)', () => {
    for (const t of ['https://x.test', 'localhost:3000', 'example.com', 'best pricing tools', 'electron']) {
      const isSearch = parseOmnibox(t).startsWith('https://duckduckgo.com/?q=');
      expect(omniboxLeadHint(t, false)).toBe(isSearch ? 'search' : 'nav');
    }
  });
});
