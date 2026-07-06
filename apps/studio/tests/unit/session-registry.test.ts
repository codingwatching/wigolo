import { describe, it, expect } from 'vitest';
import { SessionRegistry } from '../../src/main/session-registry';

describe('SessionRegistry', () => {
  it('boots with one default session that is current', () => {
    const reg = new SessionRegistry();
    const s = reg.current();
    expect(s.name).toBe('default');
    expect(reg.list()).toHaveLength(1);
  });

  it('tracks tab membership so a resumed session can restore its tab set (spec §6)', () => {
    const reg = new SessionRegistry();
    reg.addTab(reg.current().id, 'tab-1');
    reg.addTab(reg.current().id, 'tab-2');
    reg.removeTab(reg.current().id, 'tab-1');
    expect(reg.current().tabIds).toEqual(['tab-2']);
  });

  it('rejects tab ops against unknown sessions instead of silently dropping (fail-loud rule)', () => {
    const reg = new SessionRegistry();
    expect(() => reg.addTab('nope', 'tab-1')).toThrow(/unknown session/i);
  });
});
