import { useState, useEffect } from 'preact/hooks';
import type { SessionMetaView } from './codec.js';

/**
 * Client-side holder of the SERVER-authoritative live-session list (7f B3). The host owns the truth; the tab
 * only MIRRORS it. BOTH the post-hello `sessions_snapshot` and the live `sessions` delta carry the COMPLETE
 * current set (the host re-projects registry.list() each time), so both REPLACE — there is no per-id upsert and
 * no optimistic/local add. The switcher never shows a session the server did not send, and never removes one
 * locally; a create/close is reflected only when the host pushes the next list. Mirrors ArtifactsModel's
 * snapshot semantics (minus the upsert, which a full-list authority does not need).
 */
export class SessionsModel {
  private items: SessionMetaView[] = [];
  private readonly subs = new Set<() => void>();

  snapshot(): SessionMetaView[] {
    return [...this.items];
  }

  /** Apply the host's COMPLETE session set (snapshot or delta). Authoritative — REPLACES, never merges. */
  applySnapshot(sessions: SessionMetaView[]): void {
    this.items = [...sessions];
    this.emit();
  }

  subscribe(cb: () => void): () => void {
    this.subs.add(cb);
    return () => void this.subs.delete(cb);
  }

  private emit(): void {
    for (const cb of this.subs) cb();
  }
}

/** Preact binding: re-render whenever the model's server-authoritative session list changes. */
export function useSessionsSnapshot(model: SessionsModel): SessionMetaView[] {
  const [snap, setSnap] = useState<SessionMetaView[]>(model.snapshot());
  useEffect(() => model.subscribe(() => setSnap(model.snapshot())), [model]);
  return snap;
}
