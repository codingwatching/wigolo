import { describe, it, expect } from 'vitest';
import { SessionRegistry } from '../../../src/studio/registry.js';
import { createActHandler, type ActHandlerDeps } from '../../../src/studio/act.js';
import type { NavGrant } from '../../../src/studio/nav-policy.js';
import type { StudioActInput } from '../../../src/daemon/studio-dispatch.js';

/**
 * S5 — control-token agent-drive (D.1 fix). An AGENT-SPAWNED session (registry.create({spawnedBy:'agent'}) →
 * Session → ControlToken init) starts holder='agent', so the agent can drive a clientless background session
 * with NO human attached — assertCanDrive('agent') succeeds. SCOPED: a human-spawned session keeps holder=
 * 'human' (agent blocked until the human grants). requestControl stays {granted:false} (the agent never seizes;
 * holder-flip is reachable ONLY via the create-spawnedBy path or a human grant, never an agent-callable verb).
 *
 * Pins 1-2 drive the REAL act gate (createActHandler → controlToken.assertCanDrive) with the session-owned
 * token; pins 3-4 pin the token's self-grant guard.
 */

const noGrant: NavGrant = { humanAllowPrivate: false, agentAllowPrivate: false };

/** A minimal real act handler over a given control token — only the scroll path is exercised (token-gated, not risk-gated). */
function actHandlerFor(controlToken: ActHandlerDeps['controlToken']) {
  let dispatched = 0;
  const deps: ActHandlerDeps = {
    browser: { navigate: async () => undefined },
    controlToken,
    grant: noGrant,
    resolve: async () => ({ error: 'element_no_longer_present' as const }),
    channel: {
      dispatchAgentUnit: async () => { dispatched++; return true; },
      viewportCenter: () => ({ x: 10, y: 10 }),
    },
  };
  return { act: createActHandler(deps), dispatchedCount: () => dispatched };
}

describe('studio S5 — control-token agent-drive', () => {
  // ── PIN-1 — an agent-spawned clientless session: assertCanDrive('agent') ok → the REAL act gate passes ──
  // Mutation that REDs: Session ignores spawnedBy (always initialHolder 'human') → holder stays 'human' →
  // assertCanDrive('agent') blocked → the scroll is refused 'not_holder' (ok/blocked diverge).
  it('PIN-1: an agent-spawned session can drive with NO human attached (assertCanDrive ok; act gate passes)', async () => {
    const reg = new SessionRegistry({ maxSessions: 10 });
    const s = reg.create({ endpoint: 'e', spawnedBy: 'agent' });
    expect(s.controlToken.holder).toBe('agent');
    expect(s.controlToken.assertCanDrive('agent').ok).toBe(true);
    const { act, dispatchedCount } = actHandlerFor(s.controlToken);
    const r = await act({ action: 'scroll' } as StudioActInput);
    expect('error_reason' in r).toBe(false); // gate passed — agent holds the clientless session
    expect(r).toMatchObject({ ok: true, action: 'scroll' });
    expect(dispatchedCount()).toBe(1);
  });

  // ── PIN-2 — a human-spawned session stays holder='human'; the agent is BLOCKED until a human grant ──
  // Mutation that REDs: agent-holder LEAKS to a human session (Session always initialHolder 'agent') → the
  // first scroll is NOT blocked (self-grant-control-adjacent leak).
  it('PIN-2: a human-spawned session stays holder=human; the agent is blocked until the human grants control', async () => {
    const reg = new SessionRegistry({ maxSessions: 10 });
    const s = reg.create({ endpoint: 'e' }); // spawnedBy defaults 'human'
    expect(s.controlToken.holder).toBe('human');
    const { act } = actHandlerFor(s.controlToken);
    const blocked = await act({ action: 'scroll' } as StudioActInput);
    expect(blocked).toMatchObject({ error_reason: 'not_holder' }); // agent blocked on a human session
    // A human grant (the ONLY non-create flip) hands the wheel to the agent.
    s.controlToken.grant('agent');
    const ok = await act({ action: 'scroll' } as StudioActInput);
    expect('error_reason' in ok).toBe(false);
    expect(ok).toMatchObject({ ok: true, action: 'scroll' });
  });

  // ── PIN-3 — requestControl (the one agent-reachable token method) stays {granted:false} ──
  // Mutation that REDs: flip requestControl to {granted:true}.
  it('PIN-3: requestControl returns {granted:false} even for an agent-spawned session (no self-seize)', () => {
    const reg = new SessionRegistry({ maxSessions: 10 });
    const s = reg.create({ endpoint: 'e', spawnedBy: 'agent' });
    expect(s.controlToken.requestControl('agent')).toEqual({ granted: false });
  });

  // ── PIN-4 (structural) — holder-flip is NOT reachable via the agent-callable token method ──
  // requestControl NEVER flips the holder: on a human-spawned session the agent calling requestControl leaves
  // holder='human' (the self-grant-control guard). Holder changes ONLY via the create-spawnedBy path (PIN-1)
  // or a human grant (PIN-2). Mutation that REDs: requestControl flips the holder to the requested party.
  it('PIN-4: requestControl never flips the holder — the agent cannot self-grant control', () => {
    const reg = new SessionRegistry({ maxSessions: 10 });
    const s = reg.create({ endpoint: 'e' }); // human-spawned
    const before = s.controlToken.holder;
    const res = s.controlToken.requestControl('agent');
    expect(res.granted).toBe(false);
    expect(s.controlToken.holder).toBe(before); // unchanged — no agent-verb flip
    expect(s.controlToken.holder).toBe('human');
  });
});
