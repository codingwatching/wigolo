const SEARCH_URL = 'https://duckduckgo.com/?q=';
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/;

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export function parseOmnibox(input: string): string {
  const text = input.trim();
  if (SCHEME.test(text)) return text;
  if (!text.includes(' ')) {
    if (LOCAL_HOST.test(text)) return `http://${text}`;
    if (text.includes('.')) return `https://${text}`;
  }
  return `${SEARCH_URL}${encodeURIComponent(text)}`;
}

/** What the omnibox will DO with the current text — drives the lead glyph. `viaTab` = the user pressed ⇥
 *  (hand it to the agent) → always intent. Otherwise it MUST agree with what Enter does (parseOmnibox):
 *  a scheme or a single dotted/localhost token → nav; anything else → search. Pure, deterministic, no LLM. */
export type LeadHint = 'nav' | 'search' | 'intent';
export function omniboxLeadHint(input: string, viaTab: boolean): LeadHint {
  if (viaTab) return 'intent';
  const text = input.trim();
  if (SCHEME.test(text)) return 'nav';
  if (!text.includes(' ') && (LOCAL_HOST.test(text) || text.includes('.'))) return 'nav';
  return 'search';
}
