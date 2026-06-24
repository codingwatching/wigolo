import { useMemo } from 'preact/hooks';
import { ControlsModel } from '../transport/controls.js';
import { MarksModel } from '../transport/marks.js';
import { ApprovalsModel } from '../transport/approvals.js';
import { ControlsPanel } from './ControlsPanel.js';
import { MarksPanel } from './MarksPanel.js';
import { ApprovalsPanel } from './ApprovalsPanel.js';

/**
 * The side rail (S4). Its TOP panel is the approval cards (7d S1) — a risky-action interrupt the human answers
 * first; then the direct-drive controls (who's-driving + handoff + nav); BELOW it (7c) the marks-list read
 * surface, all wired to the live connection's models + the ONE codec emit. Later phases fill the rest
 * (captures, timeline). With nothing injected — the jsdom/no-op path — it renders inert default models so
 * mounting never needs a live connection. Copy is capability language only.
 */
export interface RailControls {
  model: ControlsModel;
  emit: (wire: string) => void;
}

export interface RailProps {
  controls?: RailControls;
  marks?: MarksModel;
  approvals?: ApprovalsModel;
}

export function Rail({ controls, marks, approvals }: RailProps = {}) {
  const c = useMemo<RailControls>(() => controls ?? { model: new ControlsModel(), emit: () => {} }, [controls]);
  const m = useMemo<MarksModel>(() => marks ?? new MarksModel(), [marks]);
  const a = useMemo<ApprovalsModel>(() => approvals ?? new ApprovalsModel(), [approvals]);
  return (
    <aside class="studio-rail" aria-label="Session panel">
      <ApprovalsPanel model={a} emit={c.emit} />
      <ControlsPanel model={c.model} emit={c.emit} />
      <MarksPanel model={m} />
      <p class="studio-rail-empty">Captured items and the activity timeline will appear here.</p>
    </aside>
  );
}
