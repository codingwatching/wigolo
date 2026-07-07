import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApprovalCards } from '../../src/renderer/ApprovalCard';
import type { PendingApproval } from '../../src/renderer/approval-store';

const mk = (risk: PendingApproval['risk']): PendingApproval => ({ id: `a-${risk}`, action: 'click', risk });

describe('ApprovalCards — per-risk polish (P4)', () => {
  it('tags each card with a per-risk modifier class + a risk label', () => {
    for (const risk of ['money', 'credential', 'destructive'] as const) {
      const html = renderToStaticMarkup(<ApprovalCards pending={[mk(risk)]} onDecide={() => {}} />);
      expect(html).toContain(`approval--${risk}`);
      expect(html).toContain(risk);
    }
  });
  it('always renders Allow + Deny (never auto-allows)', () => {
    const html = renderToStaticMarkup(<ApprovalCards pending={[mk('money')]} onDecide={() => {}} />);
    expect(html).toContain('Allow');
    expect(html).toContain('Deny');
  });
  it('renders one card per pending item; nothing when empty', () => {
    expect(renderToStaticMarkup(<ApprovalCards pending={[]} onDecide={() => {}} />)).toBe('');
    const html = renderToStaticMarkup(<ApprovalCards pending={[mk('money'), mk('destructive')]} onDecide={() => {}} />);
    expect((html.match(/class="approval /g) || []).length).toBe(2);
  });
  it('uses capability language only — no internal engine names', () => {
    const html = renderToStaticMarkup(<ApprovalCards pending={[mk('credential')]} onDecide={() => {}} />).toLowerCase();
    for (const banned of ['electron', 'cdp', 'playwright', 'chromium']) expect(html).not.toContain(banned);
  });
});
