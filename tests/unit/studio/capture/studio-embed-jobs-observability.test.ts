import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { BackgroundIndexQueue, type IndexJobInput } from '../../../../src/embedding/background-queue.js';

/**
 * Phase 4b-3 — Condition 3: CONFIRM (no new code) that the EXISTING embedding queue's
 * retry + observability already covers studio:// jobs. The capture pipeline enqueues
 * embeds under a synthetic studio://<type>|<id> key (C#3); to the BackgroundIndexQueue
 * those are just rows in index_jobs, so a failed embed must be RETRIED (attempts++,
 * log.warn at background-queue.ts:211) up to maxAttempts and only THEN dropped — never
 * silently discarded on the first failure.
 *
 * Unlike the other 4b-3 tests, these PASS against shipped code (this file imports only
 * the existing queue) — that is the point: the reuse is confirmed, not built. They are
 * a regression guard: if anyone later special-cases / filters studio:// urls in the
 * worker, these red.
 */
describe('studio embed jobs ride the existing index_jobs retry/observability (Phase 4b-3 Cond 3 — confirm)', () => {
  let dir: string;
  let dbPath: string;
  let queue: BackgroundIndexQueue;

  const STUDIO_JOB: IndexJobInput = {
    url: 'studio://clip|42',
    text: 'captured clip body to embed',
    contentHash: 'a'.repeat(64),
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wigolo-studio-4b3-jobs-'));
    dbPath = join(dir, 'jobs.db');
    queue = new BackgroundIndexQueue({
      dbPath,
      autoStart: false,
      syncMode: true, // enqueue() awaits exactly one processOne, so failures are observable inline
      maxAttempts: 2,
      // The provider fails to resolve → processOneInner's try throws → the SAME catch
      // path any failing embed takes. Faithful: a real failure, not a filtered url.
      embedProvider: async () => { throw new Error('embed provider unavailable'); },
    });
  });

  afterEach(() => {
    try { queue.shutdown(); } catch { /* ignore */ }
    try { chmodSync(dir, 0o700); } catch { /* ignore */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // Read attempts/url through a SECOND connection — the queue's own handle is private,
  // and WAL makes the autocommitted row visible to a separate reader.
  function jobRow(): { url: string; attempts: number } | undefined {
    const reader = new Database(dbPath, { readonly: true });
    try {
      return reader.prepare('SELECT url, attempts FROM index_jobs ORDER BY id ASC LIMIT 1')
        .get() as { url: string; attempts: number } | undefined;
    } finally {
      reader.close();
    }
  }

  it('a failed studio:// embed is RETRIED (attempts incremented, row kept) — not silently dropped on first failure', async () => {
    await queue.enqueue(STUDIO_JOB);
    // One failing pass under maxAttempts=2 → the job survives for another try.
    expect(queue.pendingSize(), 'studio job retried, not dropped').toBe(1);
    const row = jobRow();
    expect(row?.url, 'the worker keys the job by the studio:// url as-is (no special-casing)').toBe('studio://clip|42');
    expect(row?.attempts, 'failure was counted toward the retry budget').toBe(1);
  });

  it('a studio:// embed that keeps failing is dropped only AFTER maxAttempts (bounded retry, not infinite)', async () => {
    await queue.enqueue(STUDIO_JOB); // attempt 1 (kept)
    await queue.drain();             // attempt 2 → reaches maxAttempts → dropped
    expect(queue.pendingSize(), 'bounded: dropped after the retry budget is exhausted').toBe(0);
  });
});
