import { useState } from 'react';
import type { AuditDto } from '../shared/ipc';

/** A per-verb glyph for the timeline row (host-derived — never page content). */
function glyph(action: string): string {
  switch (action) {
    case 'navigate': return '→';
    case 'click': return '⊙';
    case 'type': return '⌨';
    case 'scroll': return '↕';
    default: return '•';
  }
}

/** A page-text-free, host-derived one-line summary of one agent action (the structured columns only). */
function summarize(e: AuditDto): string {
  const parts: string[] = [e.action];
  if (e.action === 'navigate' && e.url) parts.push(e.url);
  else if (e.ref) parts.push(e.ref);
  else if (e.direction) parts.push(`${e.direction}${e.amount != null ? ` ${e.amount}` : ''}`);
  return parts.join(' ');
}

/** The Timeline rail pane — the append-only per-session log of every agent action, newest first (P6 F4).
 *  Replay-for-forensics only: rendering is host-derived summaries, never re-execution and never page text. */
export function TimelinePanel({ entries }: { entries: AuditDto[] }) {
  const [openSeq, setOpenSeq] = useState<number | null>(null);
  if (entries.length === 0) {
    return (
      <p className="rail__empty">
        No agent actions yet. As the agent co-drives this browser, every step it takes — navigations,
        clicks, and refusals alike — is recorded here in order, so you can see exactly what it did.
      </p>
    );
  }
  return (
    <ul className="tl">
      {entries.map((e) => {
        const open = openSeq === e.seq;
        return (
          <li key={e.seq} className={`tl__item${e.ok ? '' : ' tl__item--refused'}`}>
            <button className="tl__row" onClick={() => setOpenSeq(open ? null : e.seq)}>
              <span className="tl__glyph" aria-hidden>{glyph(e.action)}</span>
              <span className="tl__summary">{summarize(e)}</span>
              {e.risk && <span className={`tl__risk tl__risk--${e.risk}`}>{e.risk}</span>}
              <span className={`tl__outcome ${e.ok ? 'is-ok' : 'is-refused'}`}>{e.ok ? 'ok' : (e.error_reason ?? 'refused')}</span>
            </button>
            {open && (
              <div className="tl__detail">
                {e.approval && <div className="tl__meta">authorized: {e.approval}</div>}
                {e.charsLanded != null && <div className="tl__meta">typed: {e.charsLanded} chars</div>}
                {e.screenshotId != null && <div className="tl__meta">screenshot #{e.screenshotId}</div>}
                <div className="tl__meta tl__meta--ts">{new Date(e.ts).toLocaleTimeString()}</div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
