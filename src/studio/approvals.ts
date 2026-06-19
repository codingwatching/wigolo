/**
 * Phase 6c — the host↔human approval round-trip.
 *
 * When the deterministic classifier (risk.ts) flags an agent action money/credential/
 * destructive, the act handler HOLDS the action and asks the human: this module emits
 * {t:'approval_request', id, ...} to the human's browser over the session WebSocket and
 * returns a promise that settles when the human answers {t:'approval', id, decision}, the
 * request times out, or a reclaim supersedes it.
 *
 * Fail-closed by construction: only an explicit `approve` resolves `approved`; an explicit
 * `deny`/`refuse` resolves `refused`; an unanswered request times out (`timeout`); a human
 * reclaim aborts every pending request (`superseded`). Garbage from the wire never resolves a
 * request as approved — it waits for an explicit answer (and ultimately times out). The act
 * handler treats anything other than `approved` as "do not fire", and layers the epoch fence
 * on top so a late approval for a now-stale epoch still cannot fire.
 *
 * Pure mechanism: the broadcast sink and the timer are injected, so it is fully headless-
 * testable. The visual approval CARD that renders the request is Phase 7; this is the wire
 * contract underneath it. This is a host↔human channel (like the audit log), NOT the agent's
 * StudioEvent/observe channel — so StudioEvent stays untouched (CEO carry-forward (b)).
 */
import type { RiskTier } from './risk.js';

/** How a held action is released. Only `approved` lets it fire; everything else drops it (fail-closed). */
export type ApprovalDecision = 'approved' | 'refused' | 'timeout' | 'superseded';

/** What the act handler asks the human to approve. `target` carries only opaque host refs / the URL — no page-derived content. */
export interface ApprovalRequest {
  action: string;
  risk: RiskTier;
  target?: { url?: string; ref?: string };
}

/** A cancellable timer handle (injectable so tests fire it deterministically instead of waiting). */
export interface ApprovalTimer {
  clear(): void;
}

export interface ApprovalDeps {
  /** Push a message to the session's human client(s) — host wires this to hub.broadcast(sessionId, …). */
  broadcast(msg: Record<string, unknown>): void;
  /** Fail-closed timeout for an unanswered request. */
  timeoutMs?: number;
  /** Injectable timer; defaults to an unref'd setTimeout so a pending approval never keeps the process alive. */
  setTimer?: (cb: () => void, ms: number) => ApprovalTimer;
}

/** Default fail-closed wait before an unanswered risky action is dropped. */
const DEFAULT_TIMEOUT_MS = 120_000;

function defaultSetTimer(cb: () => void, ms: number): ApprovalTimer {
  const h = setTimeout(cb, ms);
  if (typeof h.unref === 'function') h.unref();
  return { clear: () => clearTimeout(h) };
}

interface Pending {
  resolve(decision: ApprovalDecision): void;
  timer: ApprovalTimer;
}

export class SessionApprovals {
  private readonly broadcast: (msg: Record<string, unknown>) => void;
  private readonly timeoutMs: number;
  private readonly setTimer: (cb: () => void, ms: number) => ApprovalTimer;
  private readonly pending = new Map<number, Pending>();
  private seq = 0;

  constructor(deps: ApprovalDeps) {
    this.broadcast = deps.broadcast;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.setTimer = deps.setTimer ?? defaultSetTimer;
  }

  /** Emit an approval request to the human and await the decision (or timeout). */
  request(req: ApprovalRequest): Promise<ApprovalDecision> {
    const id = ++this.seq;
    return new Promise<ApprovalDecision>((resolve) => {
      const timer = this.setTimer(() => this.settle(id, 'timeout'), this.timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.broadcast({ t: 'approval_request', id, action: req.action, risk: req.risk, ...(req.target ? { target: req.target } : {}) });
    });
  }

  /** Route an inbound {t:'approval', id, decision} from the WS (untrusted JSON): coerce, then settle the matching request. */
  handleWire(raw: Record<string, unknown>): void {
    if (typeof raw.id !== 'number') return;
    const decision = this.coerceDecision(raw.decision);
    if (!decision) return; // unrecognized → ignore; the request waits for an explicit answer (fail-closed via timeout)
    this.settle(raw.id, decision);
  }

  /** Drop every pending request as superseded — the host wires this to a human reclaim, so a held action does not survive a takeover. */
  abortPending(): void {
    for (const id of [...this.pending.keys()]) this.settle(id, 'superseded');
  }

  /** Pending requests not yet answered/timed-out. */
  get pendingCount(): number {
    return this.pending.size;
  }

  private coerceDecision(raw: unknown): 'approved' | 'refused' | null {
    if (raw === 'approve' || raw === 'approved') return 'approved';
    if (raw === 'deny' || raw === 'refuse' || raw === 'refused' || raw === 'reject') return 'refused';
    return null;
  }

  private settle(id: number, decision: ApprovalDecision): void {
    const p = this.pending.get(id);
    if (!p) return; // already settled (double-answer, or a fired timer for a resolved request) → no-op
    p.timer.clear();
    this.pending.delete(id);
    p.resolve(decision);
  }
}
