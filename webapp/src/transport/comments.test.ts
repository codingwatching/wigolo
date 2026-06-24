import { describe, it, expect } from 'vitest';
import { CommentsModel } from './comments.js';

/**
 * The comments list reducer (7b-notes S3). It holds the SERVER-authoritative set of human comments: it
 * changes ONLY when the host speaks — the post-hello `comment_snapshot` (the complete truth → replace) or a
 * live `comment` delta (upsert by id, so a deduped re-echo of the same captured note never double-adds). There
 * is NO optimistic/local add: a locally-typed comment appears only on the server echo, so the human never sees
 * a comment that was not captured.
 */
describe('CommentsModel — server-authoritative comments list', () => {
  it('applies a live delta, upserting by id (new appends, a repeat id replaces in place)', () => {
    const model = new CommentsModel();
    model.applyDelta({ id: 1, text: 'first' });
    model.applyDelta({ id: 2, text: 'second' });
    model.applyDelta({ id: 1, text: 'first (re-echo)' }); // dedup re-echo of the same captured note
    expect(model.snapshot()).toEqual([{ id: 1, text: 'first (re-echo)' }, { id: 2, text: 'second' }]);
  });

  // PIN-B (no optimistic add — the reducer is server-authoritative). NAMED mutation that REDs: seed the model
  // with a pre-message entry → the empty-before-any-server-message assertion fails.
  it('PIN-B: empty until the server speaks (no optimistic local add)', () => {
    const model = new CommentsModel();
    expect(model.snapshot()).toEqual([]); // nothing before any server echo/snapshot
    model.applyDelta({ id: 1, text: 'echoed back' });
    expect(model.snapshot()).toEqual([{ id: 1, text: 'echoed back' }]); // appears only after the server echo
  });

  // PIN-C (authoritative snapshot — replace, never merge). NAMED mutation that REDs: make applySnapshot MERGE
  // (append to the existing list) instead of REPLACE → a stale comment the host omitted survives a fresh snapshot.
  it('PIN-C: a snapshot is the complete truth — replaces, never merges (a stale comment does not survive)', () => {
    const model = new CommentsModel();
    model.applyDelta({ id: 1, text: 'stale' });
    model.applyDelta({ id: 2, text: 'also stale' });
    expect(model.snapshot().map((c) => c.id)).toEqual([1, 2]);
    model.applySnapshot([{ id: 2, text: 'fresh' }]); // the host's COMPLETE set — id 1 is omitted
    expect(model.snapshot().map((c) => c.id)).toEqual([2]); // id 1 gone — authoritative replace, not merge
    expect(model.snapshot()[0].text).toBe('fresh'); // id 2 takes the snapshot's value
  });

  it('notifies subscribers on snapshot and delta', () => {
    const model = new CommentsModel();
    let n = 0;
    const off = model.subscribe(() => n++);
    model.applySnapshot([{ id: 1, text: 'a' }]);
    model.applyDelta({ id: 2, text: 'b' });
    expect(n).toBe(2);
    off();
    model.applyDelta({ id: 3, text: 'c' });
    expect(n).toBe(2); // unsubscribed
  });
});
