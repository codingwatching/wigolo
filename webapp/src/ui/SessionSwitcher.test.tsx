import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { SessionsModel } from '../transport/sessions.js';
import { SessionSwitcher } from './SessionSwitcher.js';

/**
 * The session switcher (7f B3) — the human's surface for the live sessions on this host. It mirrors the
 * SERVER-authoritative SessionsModel (post-hello sessions_snapshot + live sessions delta, both full-list
 * REPLACE) and renders each session's id/status (page/host-relayed → SafeText, inert). Selecting calls
 * onSelect; the panel NEVER mutates the list locally (no optimistic add/remove). Copy is capability language only.
 *
 * VALUE-FLIP PINS — each is mutation-verified against the PRESENT component: applying ONLY the named mutation
 * REDs the pin with the diverging value shown, so none passes vacuously.
 */
describe('SessionSwitcher — live-session switch surface', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function mount(model: SessionsModel, props: { currentSessionId?: string | null; onSelect?: (id: string) => void } = {}) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => {
      render(<SessionSwitcher model={model} currentSessionId={props.currentSessionId} onSelect={props.onSelect} />, host);
    });
    return host;
  }

  const sess = (over: Partial<{ id: string; status: string; clients: number; createdAt: number; lastActiveAt: number }> = {}) => ({
    id: over.id ?? 'sess-1',
    status: over.status ?? 'active',
    clients: over.clients ?? 1,
    createdAt: over.createdAt ?? 1000,
    lastActiveAt: over.lastActiveAt ?? 2000,
  });

  it('renders a session from the server-authoritative model', () => {
    const model = new SessionsModel();
    const host = mount(model);
    act(() => model.applySnapshot([sess({ id: 'sess-abc', status: 'active' })]));
    expect(host.textContent).toContain('sess-abc');
    expect(host.textContent).toContain('active');
  });

  it('shows an empty state before any session', () => {
    const host = mount(new SessionsModel());
    expect(host.querySelector('.studio-sessions')).not.toBeNull();
    expect(host.querySelector('.studio-sessions-item')).toBeNull();
  });

  it('selecting a session calls onSelect with its id; the current session is marked and not selectable', () => {
    const model = new SessionsModel();
    const onSelect = vi.fn();
    const host = mount(model, { currentSessionId: 'sess-1', onSelect });
    act(() => model.applySnapshot([sess({ id: 'sess-1' }), sess({ id: 'sess-2' })]));
    const rows = host.querySelectorAll('.studio-sessions-item');
    // current session's button is disabled
    expect((rows[0].querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    // selecting the OTHER session fires onSelect with its id
    act(() => (rows[1].querySelector('button') as HTMLButtonElement).click());
    expect(onSelect).toHaveBeenCalledWith('sess-2');
  });

  // PIN-A (trust at the panel seam). A session id/status carrying markup MUST render as LITERAL text via SafeText.
  // NAMED mutation that REDs: render the value via dangerouslySetInnerHTML (bypass SafeText) → the browser parses
  // the markup and an <img> materializes (RED: querySelector('img') ≠ null; diverging value: 0 imgs → 1).
  it('PIN-A: a session id/status carrying markup renders as LITERAL text, parsing no element', () => {
    const model = new SessionsModel();
    const host = mount(model);
    const malicious = '<img src=x onerror="window.__pwned=1">';
    act(() => model.applySnapshot([sess({ id: malicious, status: malicious })]));
    expect(host.querySelector('img')).toBeNull(); // markup did not parse into a live element
    expect(host.textContent).toContain(malicious); // shown as exact literal characters
  });

  // PIN-B-replace (authoritative snapshot — replace, not merge). NAMED mutation that REDs: applySnapshot merges
  // (`[...this.items, ...sessions]`) instead of replacing → a stale session survives (RED: text contains 'stale-sess').
  it('PIN-B-replace: a fresh snapshot replaces the list (a stale session does not survive)', () => {
    const model = new SessionsModel();
    const host = mount(model);
    act(() => model.applySnapshot([sess({ id: 'stale-sess' })]));
    act(() => model.applySnapshot([sess({ id: 'fresh-sess' })]));
    expect(host.textContent).toContain('fresh-sess');
    expect(host.textContent).not.toContain('stale-sess'); // replaced, not merged
  });

  // PIN-B-noopt (no optimistic add/remove — the list is server-authoritative). NAMED mutation that REDs: make the
  // select handler also mutate the rendered list (e.g. drop the selected session locally) → the row count diverges
  // from the server set after a click (RED: 2 rows → 1). The switch changes the CONNECTION, never the list.
  it('PIN-B-noopt: selecting a session does NOT mutate the list (only a server snapshot/delta does)', () => {
    const model = new SessionsModel();
    const host = mount(model, { currentSessionId: 'sess-1', onSelect: () => {} });
    act(() => model.applySnapshot([sess({ id: 'sess-1' }), sess({ id: 'sess-2' })]));
    expect(host.querySelectorAll('.studio-sessions-item').length).toBe(2);
    act(() => (host.querySelectorAll('.studio-sessions-item')[1].querySelector('button') as HTMLButtonElement).click());
    expect(host.querySelectorAll('.studio-sessions-item').length).toBe(2); // unchanged — no optimistic local mutation
  });

  // GUARDRAIL (inherited): capability language only — no dependency/implementation name in any user-facing string
  // OR visible attribute.
  it('GUARDRAIL: switcher copy uses capability language only — no dependency/implementation names', () => {
    const model = new SessionsModel();
    const host = mount(model);
    act(() => model.applySnapshot([sess()]));
    let surface = (host.textContent ?? '').toLowerCase();
    for (const el of host.querySelectorAll('*')) {
      for (const attr of ['placeholder', 'aria-label', 'title', 'value']) {
        surface += ' ' + (el.getAttribute(attr) ?? '').toLowerCase();
      }
    }
    const banned = ['preact', 'playwright', 'chromium', 'searxng', 'cdp', 'esbuild', 'sqlite', 'onnx', 'fastembed', 'websocket', 'jsdom', 'bearer', 'token'];
    for (const name of banned) {
      expect(surface, `switcher must not mention "${name}"`).not.toContain(name);
    }
  });
});
