import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SessionAuditLog } from '../../../src/studio/audit.js';
import { applyMigrations, _resetMigrationGuard } from '../../../src/cache/migrations/runner.js';

/**
 * D9 — the operator-CLI entry for the audit prune: `wigolo config --prune-audit --older-than <dur> --yes`.
 * Behavioral pins run through the REAL CLI verb (runConfig), not the bare prune fn: this is the only
 * sanctioned deletion surface, so the confirm gate + explicit-cutoff requirement must hold AT the entry.
 * The DB handle is the process singleton (getDatabase); the test injects a migrated in-memory DB.
 */

let testDb: Database.Database;
vi.mock('../../../src/cache/db.js', () => ({ getDatabase: () => testDb }));

import { runConfig } from '../../../src/cli/config.js';

function migratedDb(): Database.Database {
  _resetMigrationGuard();
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db, { vecLoaded: false });
  return db;
}
function auditCount(): number {
  return (testDb.prepare('SELECT COUNT(*) c FROM studio_audit WHERE session_id = ?').get('sess-1') as { c: number }).c;
}
function sessionCount(): number {
  return (testDb.prepare('SELECT COUNT(*) c FROM studio_sessions WHERE id = ?').get('sess-1') as { c: number }).c;
}

beforeEach(() => {
  testDb = migratedDb();
  // One ancient row (ts=1000 — far older than any cutoff) + one fresh row (ts≈now).
  new SessionAuditLog({ db: testDb, sessionId: 'sess-1', now: () => 1000 }).record({ action: 'navigate', epoch: 0, outcome: { ok: true } });
  new SessionAuditLog({ db: testDb, sessionId: 'sess-1', now: () => Date.now() }).record({ action: 'click', epoch: 1, outcome: { ok: true } });
});

describe('wigolo config --prune-audit (operator-CLI entry)', () => {
  it('with --older-than + --yes: deletes ONLY the aged row, parent session + fresh row survive (pins #4/#7)', async () => {
    const code = await runConfig(['--prune-audit', '--older-than', '1h', '--yes']);
    expect(code).toBe(0);
    expect(auditCount()).toBe(1); // only the ts=1000 row was older than now-1h
    const rows = testDb.prepare('SELECT action FROM studio_audit WHERE session_id = ?').all('sess-1') as { action: string }[];
    expect(rows.map((r) => r.action)).toEqual(['click']); // fresh row survived
    expect(sessionCount()).toBe(1); // studio_sessions parent NOT deleted (pin #7)
  });

  it('fail-closed: WITHOUT --yes, nothing is deleted (pin #5)', async () => {
    const code = await runConfig(['--prune-audit', '--older-than', '1h']);
    expect(code).toBe(1);
    expect(auditCount()).toBe(2); // both rows intact — no confirm, no delete
  });

  it('fail-closed: WITHOUT --older-than, nothing is deleted — never default to delete-all (pin #6)', async () => {
    const code = await runConfig(['--prune-audit', '--yes']);
    expect(code).toBe(1);
    expect(auditCount()).toBe(2);
  });

  it('fail-closed: an invalid --older-than duration deletes nothing (pin #6)', async () => {
    const code = await runConfig(['--prune-audit', '--older-than', 'garbage', '--yes']);
    expect(code).toBe(1);
    expect(auditCount()).toBe(2);
  });
});
