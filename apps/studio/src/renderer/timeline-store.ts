// Renderer-side timeline state for the Timeline rail pane (P6 F4 — mirrors captures-store's Map +
// subscribers). Audit entries arrive two ways: a full `set()` on session open (via listAudit) and a live
// `add()` per auditEntry broadcast (a real agent act the host recorded). Keyed + deduped by `seq` (the
// host-assigned monotonic replay order) so a live entry that races the initial backfill never double-lists.
import type { AuditDto } from '../shared/ipc';

export interface TimelineStore {
  /** Reverse-chronological (newest action first — highest seq at the top). */
  list(): AuditDto[];
  /** Replace the full set from a host list (session open / backfill). */
  set(items: AuditDto[]): void;
  /** Add one entry from a live broadcast (dedup by seq). */
  add(item: AuditDto): void;
  subscribe(cb: () => void): void;
}

export function createTimelineStore(): TimelineStore {
  const items = new Map<number, AuditDto>();
  const subscribers = new Set<() => void>();
  const notify = (): void => { for (const cb of subscribers) cb(); };

  return {
    list(): AuditDto[] {
      return [...items.values()].sort((a, b) => b.seq - a.seq);
    },
    set(next: AuditDto[]): void {
      items.clear();
      for (const e of next) items.set(e.seq, e);
      notify();
    },
    add(item: AuditDto): void {
      if (items.has(item.seq)) return; // dedup — a live entry that races the backfill
      items.set(item.seq, item);
      notify();
    },
    subscribe(cb: () => void): void {
      subscribers.add(cb);
    },
  };
}
