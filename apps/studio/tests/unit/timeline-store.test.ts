import { describe, it, expect } from 'vitest';
import { createTimelineStore } from '../../src/renderer/timeline-store';
import type { AuditDto } from '../../src/shared/ipc';

const dto = (seq: number, over: Partial<AuditDto> = {}): AuditDto =>
  ({ seq, action: 'click', ref: `e${seq}`, ok: true, ts: 1000 + seq, ...over });

describe('timeline-store — renderer timeline state', () => {
  it('starts empty', () => {
    expect(createTimelineStore().list()).toEqual([]);
  });

  it('set() replaces the full set; list is reverse-chronological (highest seq first)', () => {
    const s = createTimelineStore();
    s.set([dto(1), dto(3), dto(2)]);
    expect(s.list().map((e) => e.seq)).toEqual([3, 2, 1]);
  });

  it('add() appends a live entry and dedups by seq (no double-list)', () => {
    const s = createTimelineStore();
    s.set([dto(1)]);
    s.add(dto(2));
    expect(s.list().map((e) => e.seq)).toEqual([2, 1]);
    s.add(dto(2)); // same seq — ignored
    expect(s.list()).toHaveLength(2);
  });

  it('notifies subscribers on set and add', () => {
    const s = createTimelineStore();
    let n = 0;
    s.subscribe(() => { n++; });
    s.set([dto(1)]);
    s.add(dto(2));
    expect(n).toBe(2);
  });
});
