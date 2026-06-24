import { useState, useEffect } from 'preact/hooks';
import type { ApprovalRequestView } from './codec.js';

/**
 * Client-side holder of the SERVER-authoritative pending-approval set (7d S1). The host owns the truth: a
 * request enters the set only when an {t:'approval_request'} down-message feeds it — there is NO optimistic
 * local add, so the human can never be shown an approval the host did not ask for. A request leaves the set
 * when the human answers it (`resolve` by id), mirroring the host settling its side of the round-trip; the
 * host also settles on timeout/reclaim, but the card simply stops being shown once the human acts.
 */
export class ApprovalsModel {
  private requests: ApprovalRequestView[] = [];
  private readonly subs = new Set<() => void>();

  snapshot(): ApprovalRequestView[] {
    return [...this.requests];
  }

  /** A host-sent request. Upsert by id — a re-request of the same id replaces in place, never duplicates. */
  add(req: ApprovalRequestView): void {
    const i = this.requests.findIndex((r) => r.id === req.id);
    if (i >= 0) this.requests[i] = req;
    else this.requests.push(req);
    this.emit();
  }

  /** Remove the request the human just answered (or that the host superseded), by its exact id. */
  resolve(id: number): void {
    const before = this.requests.length;
    this.requests = this.requests.filter((r) => r.id !== id);
    if (this.requests.length !== before) this.emit();
  }

  subscribe(cb: () => void): () => void {
    this.subs.add(cb);
    return () => void this.subs.delete(cb);
  }

  private emit(): void {
    for (const cb of this.subs) cb();
  }
}

/** Preact binding: re-render whenever the server-authoritative pending set changes. */
export function useApprovalsSnapshot(model: ApprovalsModel): ApprovalRequestView[] {
  const [snap, setSnap] = useState<ApprovalRequestView[]>(model.snapshot());
  useEffect(() => model.subscribe(() => setSnap(model.snapshot())), [model]);
  return snap;
}
