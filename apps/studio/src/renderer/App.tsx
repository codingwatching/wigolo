import { useEffect, useState } from 'react';
import './studio.css';
import type { StudioState } from '../shared/ipc';
import type { StudioApi } from '../preload/index';
import { TabStrip } from './TabStrip';
import { Toolbar } from './Omnibox';
import { ApprovalCards } from './ApprovalCard';
import { IconSpark, IconSend } from './icons';
import { createApprovalStore, type PendingApproval, type ApprovalVerdict } from './approval-store';

declare global {
  interface Window { studio: StudioApi }
}

const approvalStore = createApprovalStore();

export function App() {
  const [state, setState] = useState<StudioState>({ sessionName: '', tabs: [] });
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [railOpen, setRailOpen] = useState(true);

  useEffect(() => {
    window.studio.onState(setState);
    void window.studio.getState().then(setState);
    window.studio.onApprovalParked((a) => {
      approvalStore.add(a);
      setPending(approvalStore.pending());
    });
  }, []);

  const decide = (id: string, decision: ApprovalVerdict) => {
    if (approvalStore.decide(id, decision)) {
      setPending(approvalStore.pending());
      void window.studio.decideApproval(id, decision);
    }
  };

  const active = state.tabs.find((t) => t.active);
  const navigate = (url: string) => {
    if (active) void window.studio.navigate(active.id, url);
    else void window.studio.createTab(url);
  };
  const toggleRail = () => {
    setRailOpen((open) => {
      const next = !open;
      void window.studio.setRailOpen?.(next); // reflow the WebContentsView to reclaim/yield the rail column
      return next;
    });
  };

  return (
    <div className="studio">
      <TabStrip
        tabs={state.tabs}
        onFocus={(id) => void window.studio.focusTab(id)}
        onClose={(id) => void window.studio.closeTab(id)}
        onNew={() => void window.studio.createTab('about:blank')}
      />
      <Toolbar
        currentUrl={active?.url ?? ''}
        onNavigate={navigate}
        onBack={() => { /* history nav wired in a later phase */ }}
        onForward={() => { /* history nav wired in a later phase */ }}
        onReload={() => { if (active) void window.studio.navigate(active.id, active.url); }}
        railOpen={railOpen}
        onToggleRail={toggleRail}
      />
      <div className="studio__body">
        {/* the real Chromium WebContentsView is composited by the OS over this region */}
        <div className="studio__stage" />
        {railOpen && <AgentRail sessionName={state.sessionName} pending={pending} onDecide={decide} />}
      </div>
    </div>
  );
}

function AgentRail(props: { sessionName: string; pending: PendingApproval[]; onDecide: (id: string, d: ApprovalVerdict) => void }) {
  return (
    <aside className="rail">
      <div className="rail__head">
        <span style={{ color: 'var(--agent)', display: 'grid', placeItems: 'center' }}><IconSpark size={16} /></span>
        <span className="rail__title">Agent</span>
        <span className="rail__badge">{props.sessionName || 'session'}</span>
        <span className="rail__spacer" />
      </div>
      <div className="rail__body">
        <ApprovalCards pending={props.pending} onDecide={props.onDecide} />
        {props.pending.length === 0 && (
          <p className="rail__empty">
            The agent co-drives this browser. Approvals for <b>money</b>, <b>credential</b>, and
            <b> destructive</b> actions surface here — nothing risky runs without your say-so.
          </p>
        )}
      </div>
      <div className="composer">
        <textarea className="composer__input" rows={1} placeholder="Ask the agent…" />
        <div className="composer__row">
          <span className="composer__hint">⏎ send · page context attached</span>
          <button className="composer__send" title="Send"><IconSend /></button>
        </div>
      </div>
    </aside>
  );
}
