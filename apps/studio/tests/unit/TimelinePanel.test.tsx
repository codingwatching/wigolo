import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TimelinePanel } from '../../src/renderer/TimelinePanel';
import type { AuditDto } from '../../src/shared/ipc';

describe('TimelinePanel', () => {
  it('renders each action as a row with a verb glyph + host-derived summary + outcome', () => {
    const entries: AuditDto[] = [
      { seq: 2, action: 'navigate', url: 'https://ex.com', ok: true, ts: 1002 },
      { seq: 1, action: 'scroll', direction: 'down', amount: 100, ok: true, ts: 1001 },
    ];
    const html = renderToStaticMarkup(<TimelinePanel entries={entries} />);
    expect(html).toContain('→');            // navigate glyph
    expect(html).toContain('↕');            // scroll glyph
    expect(html).toContain('https://ex.com');
    expect(html).toContain('down 100');
    expect(html).toContain('ok');
  });

  it('marks a refused action + shows its reason (never a silent success)', () => {
    const entries: AuditDto[] = [{ seq: 1, action: 'click', ref: 'e5', ok: false, error_reason: 'not_holder', ts: 1001 }];
    const html = renderToStaticMarkup(<TimelinePanel entries={entries} />);
    expect(html).toContain('tl__item--refused');
    expect(html).toContain('not_holder');
  });

  it('renders a risk badge for a gated action', () => {
    const entries: AuditDto[] = [{ seq: 1, action: 'click', ref: 'e1', risk: 'money', approval: 'parked', ok: false, error_reason: 'pending_approval', ts: 1001 }];
    const html = renderToStaticMarkup(<TimelinePanel entries={entries} />);
    expect(html).toContain('tl__risk--money');
    expect(html).toContain('money');
  });

  it('shows the empty state with no entries', () => {
    const html = renderToStaticMarkup(<TimelinePanel entries={[]} />);
    expect(html.toLowerCase()).toContain('no agent actions yet');
  });
});
