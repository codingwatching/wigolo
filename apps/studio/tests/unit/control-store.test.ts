import { describe, it, expect } from 'vitest';
import { createControlStore } from '../../src/renderer/control-store';

describe('control-store', () => {
  it('records holder per tab and reports provenance', () => {
    const s = createControlStore();
    s.applyControl('t1', 'agent', 1);
    s.applyControl('t2', 'human', 1);
    expect(s.provenance('t1', /*isActive*/ true, 0)).toBe('agent');
    expect(s.provenance('t2', false, 0)).toBe('human');
    expect(s.provenance('unknown', false, 0)).toBe('none');
  });

  it('marks amber (working) only for an agent tab with a recent act that is NOT focused', () => {
    const s = createControlStore();
    s.applyControl('t1', 'agent', 1);
    s.applyAct('t1', 'click', 'opening FAQ', 1000); // act at t=1000
    expect(s.provenance('t1', /*isActive*/ false, 1500)).toBe('working'); // 500ms later, background
    expect(s.provenance('t1', /*isActive*/ true, 1500)).toBe('agent'); // focused → violet, not amber
    expect(s.provenance('t1', false, 9999)).toBe('agent'); // work window elapsed → violet
  });

  it('step(tab) returns the latest narration for the banner', () => {
    const s = createControlStore();
    s.applyAct('t1', 'click', 'opening FAQ', 1000);
    expect(s.step('t1')).toBe('opening FAQ');
    s.applyAct('t1', 'type', '  ', 1100); // blank narration does not clobber the last real step
    expect(s.step('t1')).toBe('opening FAQ');
  });

  it('subscribe fires on change; drop clears a tab', () => {
    const s = createControlStore();
    let ticks = 0;
    const off = s.subscribe(() => { ticks++; });
    s.applyControl('t1', 'agent', 1);
    expect(ticks).toBe(1);
    s.drop('t1');
    expect(ticks).toBe(2);
    expect(s.holder('t1')).toBeNull();
    off();
    s.applyControl('t2', 'human', 1);
    expect(ticks).toBe(2); // unsubscribed
  });
});
