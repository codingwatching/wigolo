import { describe, it, expect } from 'vitest';
import { SessionApprovals, type ApprovalDecision } from '../../../src/studio/approvals.js';

/**
 * Phase 6c — the host↔human approval round-trip mechanism. A risky agent action is HELD
 * while the host emits {t:'approval_request', id, ...} to the human's browser and awaits the
 * human's {t:'approval', id, decision}. Fail-closed: a timeout, or a human reclaim that
 * supersedes the request, resolves to a NON-approval so the held action is dropped (the act
 * handler composes the epoch fence on top — that's act.test).
 *
 * This module is a pure mechanism (broadcast + timer injected) so it is fully headless-testable.
 * It carries the gating-decision contract; the visual card that renders the request is Phase 7.
 */

function fakeBroadcast() {
  const msgs: Array<Record<string, unknown>> = [];
  return { broadcast: (m: Record<string, unknown>) => msgs.push(m), msgs };
}

/** A deterministic timer: captures armed callbacks so a test fires/inspects them instead of waiting on the wall clock. */
function fakeTimers() {
  const armed: Array<{ cb: () => void; ms: number; cleared: boolean }> = [];
  return {
    setTimer: (cb: () => void, ms: number) => {
      const t = { cb, ms, cleared: false };
      armed.push(t);
      return { clear: () => { t.cleared = true; } };
    },
    fire: (i = 0) => armed[i].cb(),
    armed,
  };
}

describe('SessionApprovals — the host↔human approval round-trip', () => {
  it('request emits a {t:approval_request} with a monotonic id + the risk/action/target, and stays pending until answered', async () => {
    const b = fakeBroadcast();
    const ap = new SessionApprovals({ broadcast: b.broadcast, setTimer: fakeTimers().setTimer });
    let settled = false;
    const p = ap.request({ action: 'click', risk: 'money', target: { ref: 'e9' } }).then((d) => { settled = true; return d; });
    expect(b.msgs).toEqual([{ t: 'approval_request', id: 1, action: 'click', risk: 'money', target: { ref: 'e9' } }]);
    expect(ap.pendingCount).toBe(1);
    await Promise.resolve(); // flush microtasks — the promise must NOT have resolved on its own
    expect(settled).toBe(false);
    void p;
  });

  it('a human approve resolves the held action (approved) and clears the pending slot', async () => {
    const ap = new SessionApprovals({ broadcast: fakeBroadcast().broadcast, setTimer: fakeTimers().setTimer });
    const p = ap.request({ action: 'click', risk: 'destructive' });
    ap.handleWire({ t: 'approval', id: 1, decision: 'approve' });
    await expect(p).resolves.toBe('approved');
    expect(ap.pendingCount).toBe(0);
  });

  it('a human deny resolves refused (deny and refuse are both accepted spellings)', async () => {
    const ap = new SessionApprovals({ broadcast: fakeBroadcast().broadcast, setTimer: fakeTimers().setTimer });
    const p1 = ap.request({ action: 'type', risk: 'credential' });
    ap.handleWire({ t: 'approval', id: 1, decision: 'deny' });
    await expect(p1).resolves.toBe('refused');

    const p2 = ap.request({ action: 'type', risk: 'credential' });
    ap.handleWire({ t: 'approval', id: 2, decision: 'refuse' });
    await expect(p2).resolves.toBe('refused');
  });

  it('a request that is never answered TIMES OUT to a non-approval (fail-closed)', async () => {
    const timers = fakeTimers();
    const ap = new SessionApprovals({ broadcast: fakeBroadcast().broadcast, setTimer: timers.setTimer, timeoutMs: 5000 });
    const p = ap.request({ action: 'click', risk: 'money' });
    expect(timers.armed[0].ms).toBe(5000);
    timers.fire(0); // the timeout elapses
    await expect(p).resolves.toBe('timeout');
    expect(ap.pendingCount).toBe(0);
  });

  it('abortPending resolves EVERY pending request superseded (wired to a human reclaim — the held action is dropped)', async () => {
    const ap = new SessionApprovals({ broadcast: fakeBroadcast().broadcast, setTimer: fakeTimers().setTimer });
    const p1 = ap.request({ action: 'click', risk: 'money' });
    const p2 = ap.request({ action: 'type', risk: 'credential' });
    expect(ap.pendingCount).toBe(2);
    ap.abortPending();
    await expect(p1).resolves.toBe('superseded');
    await expect(p2).resolves.toBe('superseded');
    expect(ap.pendingCount).toBe(0);
  });

  it('answering an UNKNOWN/stale id is ignored (no throw, the real pending is untouched)', async () => {
    const ap = new SessionApprovals({ broadcast: fakeBroadcast().broadcast, setTimer: fakeTimers().setTimer });
    const p = ap.request({ action: 'click', risk: 'money' }); // id 1
    ap.handleWire({ t: 'approval', id: 999, decision: 'approve' }); // no such request
    expect(ap.pendingCount).toBe(1); // untouched
    ap.handleWire({ t: 'approval', id: 1, decision: 'approve' });
    await expect(p).resolves.toBe('approved');
  });

  it('concurrent requests carry distinct ids and resolve independently', async () => {
    const ap = new SessionApprovals({ broadcast: fakeBroadcast().broadcast, setTimer: fakeTimers().setTimer });
    const p1 = ap.request({ action: 'click', risk: 'money' });
    const p2 = ap.request({ action: 'click', risk: 'destructive' });
    ap.handleWire({ t: 'approval', id: 2, decision: 'deny' });
    await expect(p2).resolves.toBe('refused');
    expect(ap.pendingCount).toBe(1); // p1 still pending
    ap.handleWire({ t: 'approval', id: 1, decision: 'approve' });
    await expect(p1).resolves.toBe('approved');
  });

  it('garbage from the wire (no id, wrong/absent decision) is ignored — the request waits for an explicit answer (fail-closed)', async () => {
    const ap = new SessionApprovals({ broadcast: fakeBroadcast().broadcast, setTimer: fakeTimers().setTimer });
    const p = ap.request({ action: 'click', risk: 'money' });
    ap.handleWire({ t: 'approval' }); // no id
    ap.handleWire({ t: 'approval', id: 1, decision: 'maybe' }); // unrecognized decision → not an approval
    ap.handleWire({ t: 'approval', id: '1' as unknown as number, decision: 'approve' }); // wrong id type
    expect(ap.pendingCount).toBe(1); // none of those resolved it
    ap.handleWire({ t: 'approval', id: 1, decision: 'approve' });
    await expect(p).resolves.toBe('approved');
  });

  it('a resolved request frees its timer (an approved action cannot later be double-resolved by its timeout)', async () => {
    const timers = fakeTimers();
    const ap = new SessionApprovals({ broadcast: fakeBroadcast().broadcast, setTimer: timers.setTimer });
    const p = ap.request({ action: 'click', risk: 'money' });
    ap.handleWire({ t: 'approval', id: 1, decision: 'approve' });
    await expect(p).resolves.toBe('approved');
    expect(timers.armed[0].cleared).toBe(true); // timer cancelled on resolve
    // firing the (cancelled) timer must not flip the already-approved decision or throw
    timers.fire(0);
    expect(ap.pendingCount).toBe(0);
  });

  it('answering the same id twice is a no-op the second time (already removed)', async () => {
    const ap = new SessionApprovals({ broadcast: fakeBroadcast().broadcast, setTimer: fakeTimers().setTimer });
    const p = ap.request({ action: 'click', risk: 'money' });
    ap.handleWire({ t: 'approval', id: 1, decision: 'approve' });
    await expect(p).resolves.toBe('approved');
    expect(() => ap.handleWire({ t: 'approval', id: 1, decision: 'deny' })).not.toThrow();
    expect(ap.pendingCount).toBe(0);
  });
});

// Type-only: the decision union is the closed set the act handler switches on.
const _decisions: ApprovalDecision[] = ['approved', 'refused', 'timeout', 'superseded'];
void _decisions;
