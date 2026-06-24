import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { CommentsModel } from '../transport/comments.js';
import { CommentsPanel } from './CommentsPanel.js';

/**
 * The comments/annotations panel (7b-notes S3) — the human's annotate-and-read surface. The input emits a
 * {t:'comment', text} up-message THROUGH THE CODEC and clears; the list MIRRORS the SERVER-authoritative
 * CommentsModel (post-hello snapshot + live echo delta). Every rendered comment goes through SafeText so a
 * comment carrying markup can never inject; the panel adds nothing optimistically — a row appears only on the
 * server echo. Copy is capability language only.
 */
describe('CommentsPanel — human comment annotate + read surface', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function mount(model: CommentsModel, onEmit: (wire: string) => void = vi.fn()) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => {
      render(<CommentsPanel model={model} emit={onEmit} />, host);
    });
    return host;
  }

  function type(host: HTMLElement, value: string) {
    const input = host.querySelector('.studio-comment-input') as HTMLInputElement;
    act(() => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function submit(host: HTMLElement): Event {
    const form = host.querySelector('form.studio-comment-form') as HTMLFormElement;
    const ev = new Event('submit', { bubbles: true, cancelable: true });
    act(() => {
      form.dispatchEvent(ev);
    });
    return ev;
  }

  it('renders a comment from the server-authoritative model', () => {
    const model = new CommentsModel();
    const host = mount(model);
    act(() => model.applyDelta({ id: 1, text: 'renew the cert' }));
    expect(host.textContent).toContain('renew the cert');
  });

  it('shows an empty state before any comment', () => {
    const host = mount(new CommentsModel());
    expect(host.querySelector('.studio-comments')).not.toBeNull();
    expect(host.querySelector('.studio-comment')).toBeNull(); // no rows
  });

  // The emit wiring (value-flip). NAMED mutation that REDs: emit the wrong type (e.g. up.nav) or skip onEmit →
  // the parsed payload no longer equals {t:'comment', text} (or onEmit is never called).
  it('submitting a comment emits {t:comment, text} through the codec and clears the input', () => {
    const onEmit = vi.fn();
    const model = new CommentsModel();
    const host = mount(model, onEmit);
    type(host, 'remember the renewal');
    const ev = submit(host);
    expect(ev.defaultPrevented).toBe(true); // no native form submit
    expect(onEmit).toHaveBeenCalledOnce();
    expect(JSON.parse(onEmit.mock.calls[0][0])).toEqual({ t: 'comment', text: 'remember the renewal' });
    expect((host.querySelector('.studio-comment-input') as HTMLInputElement).value).toBe(''); // cleared after submit
  });

  it('ignores an empty submit (no comment emitted)', () => {
    const onEmit = vi.fn();
    const host = mount(new CommentsModel(), onEmit);
    submit(host);
    expect(onEmit).not.toHaveBeenCalled();
  });

  // PIN-A (trust at the panel seam). A comment whose TEXT carries markup MUST render as LITERAL text: SafeText
  // emits it as a text node, so no element parses out of it. NAMED mutation that REDs: render the text via
  // dangerouslySetInnerHTML (bypass SafeText) → the browser parses the markup and an <img> materializes.
  it('PIN-A: a comment carrying markup renders as LITERAL text, parsing no element', () => {
    const model = new CommentsModel();
    const host = mount(model);
    const malicious = '<img src=x onerror="window.__pwned=1">';
    act(() => model.applyDelta({ id: 1, text: malicious }));
    expect(host.querySelector('img')).toBeNull(); // markup did not parse into a live element
    expect(host.textContent).toContain(malicious); // shown as the exact literal characters
  });

  // PIN-B (no optimistic add at the panel). A locally-typed+submitted comment must NOT appear in the list until
  // the server echoes it back into the model. NAMED mutation that REDs: have submit also add the comment to the
  // model (optimistic) → the row shows before/without the server round-trip.
  it('PIN-B: a locally submitted comment does NOT appear until the server echoes it into the model', () => {
    const model = new CommentsModel();
    const host = mount(model, vi.fn());
    type(host, 'pending comment');
    submit(host);
    expect(host.querySelectorAll('.studio-comment').length).toBe(0); // emitted, but NOT shown — no optimistic add
    act(() => model.applyDelta({ id: 9, text: 'pending comment' })); // the server echo arrives
    expect(host.querySelectorAll('.studio-comment').length).toBe(1); // now it appears
  });

  // PIN-C (authoritative snapshot at the panel — replace, not merge).
  it('PIN-C: a fresh snapshot replaces the list (a stale comment does not survive)', () => {
    const model = new CommentsModel();
    const host = mount(model);
    act(() => model.applyDelta({ id: 1, text: 'stale' }));
    act(() => model.applySnapshot([{ id: 2, text: 'fresh' }]));
    expect(host.textContent).toContain('fresh');
    expect(host.textContent).not.toContain('stale'); // replaced, not merged
  });

  // GUARDRAIL (inherited): capability language only — no dependency/implementation name in any user-facing
  // string OR visible attribute. NAMED mutation that REDs: put a banned name in the copy/attrs.
  it('GUARDRAIL: comments panel copy uses capability language only — no dependency/implementation names', () => {
    const model = new CommentsModel();
    const host = mount(model);
    act(() => model.applyDelta({ id: 1, text: 'a note' }));
    let surface = (host.textContent ?? '').toLowerCase();
    for (const el of host.querySelectorAll('*')) {
      for (const attr of ['placeholder', 'aria-label', 'title', 'value']) {
        surface += ' ' + (el.getAttribute(attr) ?? '').toLowerCase();
      }
    }
    const banned = ['preact', 'playwright', 'chromium', 'searxng', 'cdp', 'esbuild', 'sqlite', 'onnx', 'fastembed', 'websocket', 'jsdom'];
    for (const name of banned) {
      expect(surface, `comments panel must not mention "${name}"`).not.toContain(name);
    }
  });
});
