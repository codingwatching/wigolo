import type { ControlParty } from 'wigolo/studio';

// Renderer-side per-tab control state for the co-drive UI (provenance dots + drive banner). Fed by the
// main process's per-tab drive events (control flips + agent acts). Deterministic: `now` is injected (the
// renderer passes Date.now()) so there is no ambient clock — the amber "working" window is testable.

const WORK_WINDOW_MS = 2500; // an agent act keeps a background tab "amber (working)" this long

type Provenance = 'human' | 'agent' | 'working' | 'none';

interface TabControl {
  holder: ControlParty | null;
  workingUntil: number; // wall-clock ms until which the tab counts as actively working
  step: string; // latest narration ("opening FAQ…") for the drive banner
}

export interface ControlStore {
  applyControl(tabId: string, holder: ControlParty, epoch: number): void;
  applyAct(tabId: string, action: string, narration: string | undefined, now: number): void;
  holder(tabId: string): ControlParty | null;
  step(tabId: string): string;
  /** Dot color for the tab strip (spec §4): human=green, agent-foreground=violet, agent-bg-working=amber. */
  provenance(tabId: string, isActive: boolean, now: number): Provenance;
  subscribe(cb: () => void): () => void;
  drop(tabId: string): void;
}

export function createControlStore(): ControlStore {
  const map = new Map<string, TabControl>();
  const subs = new Set<() => void>();
  const emit = (): void => { for (const cb of subs) cb(); };
  const ensure = (id: string): TabControl => {
    let c = map.get(id);
    if (!c) { c = { holder: null, workingUntil: 0, step: '' }; map.set(id, c); }
    return c;
  };
  return {
    applyControl(tabId, holder) { ensure(tabId).holder = holder; emit(); },
    applyAct(tabId, _action, narration, now) {
      const c = ensure(tabId);
      c.workingUntil = now + WORK_WINDOW_MS;
      if (typeof narration === 'string' && narration.trim()) c.step = narration.trim();
      emit();
    },
    holder(tabId) { return map.get(tabId)?.holder ?? null; },
    step(tabId) { return map.get(tabId)?.step ?? ''; },
    provenance(tabId, isActive, now) {
      const c = map.get(tabId);
      if (!c || !c.holder) return 'none';
      if (c.holder === 'human') return 'human';
      if (!isActive && now < c.workingUntil) return 'working'; // agent mid-act on a background tab
      return 'agent';
    },
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb); },
    drop(tabId) { map.delete(tabId); emit(); },
  };
}
