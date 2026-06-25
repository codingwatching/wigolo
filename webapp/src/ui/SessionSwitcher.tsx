import { useSessionsSnapshot, type SessionsModel } from '../transport/sessions.js';
import { SafeText } from './SafeText.js';

/**
 * The session switcher (7f B3) — the human's surface for the live sessions on this host. It mirrors the
 * SERVER-authoritative SessionsModel (post-hello sessions_snapshot + live sessions delta, both full-list
 * REPLACE) and lets the human switch the stream to another session. The id/status strings are host-relayed and
 * rendered via SafeText (inert) — uniform with every other rail surface. Selecting a session calls `onSelect`;
 * the panel itself NEVER mutates the list (no optimistic add/remove) — the list changes only when the host
 * pushes the next snapshot/delta. The current session is marked, not removed. Copy is capability language only.
 */
export interface SessionSwitcherProps {
  model: SessionsModel;
  /** The session the stream is currently bound to (highlighted, not selectable). */
  currentSessionId?: string | null;
  /** Switch the live stream to the chosen session. The connector reuses the daemon-scoped bearer. */
  onSelect?: (sessionId: string) => void;
}

export function SessionSwitcher({ model, currentSessionId, onSelect }: SessionSwitcherProps) {
  const sessions = useSessionsSnapshot(model);
  return (
    <section class="studio-sessions" aria-label="Sessions">
      <h2>Sessions</h2>
      {sessions.length === 0 ? (
        <p class="studio-sessions-empty">No other sessions.</p>
      ) : (
        <ul class="studio-sessions-list">
          {sessions.map((s) => {
            const current = s.id === currentSessionId;
            return (
              <li key={s.id} class="studio-sessions-item" data-status={s.status} data-current={current}>
                <button
                  type="button"
                  class="studio-sessions-select"
                  disabled={current}
                  onClick={() => onSelect?.(s.id)}
                >
                  <SafeText class="studio-sessions-id" value={s.id} />
                  <SafeText class="studio-sessions-status" value={s.status} />
                  <span class="studio-sessions-clients">{s.clients}</span>
                  {current ? <span class="studio-sessions-current">current</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
