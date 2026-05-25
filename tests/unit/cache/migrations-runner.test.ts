import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, chmodSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { applyMigrations, _resetMigrationGuard } from '../../../src/cache/migrations/runner.js';

describe('applyMigrations', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    _resetMigrationGuard();
    dir = mkdtempSync(join(tmpdir(), 'wigolo-mig-'));
    dbPath = join(dir, 'cache.db');
  });

  afterEach(() => {
    try { chmodSync(dir, 0o700); } catch { /* ignore */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('applies all non-vec migrations on a writable empty DB', () => {
    const db = new Database(dbPath);
    applyMigrations(db, { vecLoaded: false });

    const applied = (db.prepare('SELECT name FROM schema_migrations ORDER BY name').all() as Array<{ name: string }>)
      .map(r => r.name);

    expect(applied).toContain('002-feed-items');
    expect(applied).toContain('003-crawl-etags');
    expect(applied).toContain('004-watch-jobs');
    expect(applied).not.toContain('001-sqlite-vec'); // requiresVec, skipped

    // Watch-jobs table must exist with the documented schema — downstream
    // tools count on these columns being present on day 1.
    const cols = db.prepare("PRAGMA table_info('watch_jobs')").all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name).sort();
    expect(colNames).toEqual([
      'created_at',
      'id',
      'interval_seconds',
      'last_check_at',
      'last_content_hash',
      'notification',
      'selector',
      'status',
      'url',
    ]);
    db.close();
  });

  it('is idempotent — second call on the same DB does not re-run', () => {
    const db = new Database(dbPath);
    applyMigrations(db, { vecLoaded: false });
    const firstCount = (db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n;

    applyMigrations(db, { vecLoaded: false });
    const secondCount = (db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n;

    expect(secondCount).toBe(firstCount);
    db.close();
  });

  it('on read-only DB, warns once and stops without throwing', () => {
    // Seed a writable empty DB then reopen read-only.
    const seed = new Database(dbPath);
    seed.close();

    const ro = new Database(dbPath, { readonly: true });
    expect(() => applyMigrations(ro, { vecLoaded: false })).not.toThrow();
    ro.close();
  });

  it('after one read-only call, subsequent applyMigrations calls are no-ops in the same process', () => {
    const seed = new Database(dbPath);
    seed.close();

    const ro = new Database(dbPath, { readonly: true });
    applyMigrations(ro, { vecLoaded: false });
    ro.close();

    // Even a fresh writable DB handle should be skipped because the guard tripped.
    const other = mkdtempSync(join(tmpdir(), 'wigolo-mig-other-'));
    const otherDb = new Database(join(other, 'cache.db'));
    applyMigrations(otherDb, { vecLoaded: false });
    // No schema_migrations table since the guard short-circuited.
    const hasTable = otherDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
      .get();
    expect(hasTable).toBeUndefined();
    otherDb.close();
    rmSync(other, { recursive: true, force: true });
  });

  it('_resetMigrationGuard clears the read-only flag for the next test', () => {
    const seed = new Database(dbPath);
    seed.close();

    const ro = new Database(dbPath, { readonly: true });
    applyMigrations(ro, { vecLoaded: false });
    ro.close();

    _resetMigrationGuard();

    const fresh = mkdtempSync(join(tmpdir(), 'wigolo-mig-fresh-'));
    const writable = new Database(join(fresh, 'cache.db'));
    applyMigrations(writable, { vecLoaded: false });
    const applied = (writable.prepare('SELECT name FROM schema_migrations').all() as Array<{ name: string }>);
    expect(applied.length).toBeGreaterThan(0);
    writable.close();
    rmSync(fresh, { recursive: true, force: true });
  });
});
