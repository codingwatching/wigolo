import type { TabInfo } from '../../src/shared/ipc';
import { IconClose } from './icons';

/** Derive a page-origin favicon glyph slot — a colored initial when no favicon is known yet. */
function faviconInitial(t: TabInfo): string {
  try {
    const h = new URL(t.url).hostname.replace(/^www\./, '');
    return (h[0] ?? '·').toUpperCase();
  } catch {
    return '·';
  }
}

export function TabStrip(props: {
  tabs: TabInfo[];
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="titlebar">
      {props.tabs.map((t) => (
        <div
          key={t.id}
          data-testid={`tab-${t.id}`}
          className={`tab${t.active ? ' tab--active' : ''}`}
          onClick={() => props.onFocus(t.id)}
          title={t.title || t.url}
        >
          {/* provenance dot slot — violet=agent-driven (spec §4); defaults to a neutral favicon chip */}
          <span
            className="tab__fav"
            style={{ display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 700, background: 'var(--surface-hover)', color: 'var(--text-dim)' }}
          >
            {faviconInitial(t)}
          </span>
          <span className="tab__title">{t.title || t.url || 'New tab'}</span>
          <span
            data-testid={`close-${t.id}`}
            className="tab__close"
            onClick={(e) => { e.stopPropagation(); props.onClose(t.id); }}
          >
            <IconClose />
          </span>
        </div>
      ))}
      <button data-testid="new-tab" className="tab-new" onClick={props.onNew} title="New tab">+</button>
    </div>
  );
}
