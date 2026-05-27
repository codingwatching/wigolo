/**
 * Tests for the cleanup action.
 *
 * Why: cleanup must remove only the targeted component's files/dir, report
 * freed bytes accurately, and be safe (idempotent) when the target is absent.
 * Tests use a real fixture tmpdir to verify actual FS operations.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  cleanupComponent,
  type CleanupResult,
} from '../../../../../src/cli/tui/actions/cleanup.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'wigolo-sp5-cleanup-'));
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function makeFile(relPath: string, size: number): void {
  const full = join(tmpDir, relPath);
  mkdirSync(join(tmpDir, ...relPath.split('/').slice(0, -1)), { recursive: true });
  writeFileSync(full, 'x'.repeat(size), 'utf-8');
}

describe('cleanupComponent — cache', () => {
  it('removes wigolo.db and reports freed bytes', async () => {
    makeFile('wigolo.db', 1024);
    const result = await cleanupComponent('cache', tmpDir);
    expect(result.ok).toBe(true);
    expect(result.freedBytes).toBe(1024);
    expect(existsSync(join(tmpDir, 'wigolo.db'))).toBe(false);
  });

  it('is idempotent when cache DB is absent', async () => {
    const result = await cleanupComponent('cache', tmpDir);
    expect(result.ok).toBe(true);
    expect(result.freedBytes).toBe(0);
  });
});

describe('cleanupComponent — embeddings', () => {
  it('removes embeddings/ dir and reports freed bytes', async () => {
    makeFile('embeddings/index.bin', 2048);
    makeFile('embeddings/meta.json', 64);
    const result = await cleanupComponent('embeddings', tmpDir);
    expect(result.ok).toBe(true);
    expect(result.freedBytes).toBe(2048 + 64);
    expect(existsSync(join(tmpDir, 'embeddings'))).toBe(false);
  });

  it('is idempotent when embeddings dir absent', async () => {
    const result = await cleanupComponent('embeddings', tmpDir);
    expect(result.ok).toBe(true);
    expect(result.freedBytes).toBe(0);
  });
});

describe('cleanupComponent — models', () => {
  it('removes models/ dir and reports freed bytes', async () => {
    makeFile('models/model.bin', 4096);
    const result = await cleanupComponent('models', tmpDir);
    expect(result.ok).toBe(true);
    expect(result.freedBytes).toBe(4096);
    expect(existsSync(join(tmpDir, 'models'))).toBe(false);
  });

  it('is idempotent when models dir absent', async () => {
    const result = await cleanupComponent('models', tmpDir);
    expect(result.ok).toBe(true);
    expect(result.freedBytes).toBe(0);
  });
});

describe('cleanupComponent — browser', () => {
  it('removes playwright-browsers/ dir and reports freed bytes', async () => {
    makeFile('playwright-browsers/chromium.bin', 512);
    const result = await cleanupComponent('browser', tmpDir);
    expect(result.ok).toBe(true);
    expect(result.freedBytes).toBe(512);
    expect(existsSync(join(tmpDir, 'playwright-browsers'))).toBe(false);
  });
});

describe('cleanupComponent — searxng', () => {
  it('removes searxng/ dir and reports freed bytes', async () => {
    makeFile('searxng/venv/lib/foo.py', 256);
    const result = await cleanupComponent('searxng', tmpDir);
    expect(result.ok).toBe(true);
    expect(result.freedBytes).toBe(256);
    expect(existsSync(join(tmpDir, 'searxng'))).toBe(false);
  });
});

describe('cleanupComponent — only targets specified component', () => {
  it('does not remove other component dirs when cleaning cache', async () => {
    makeFile('wigolo.db', 100);
    makeFile('embeddings/a.bin', 200);
    makeFile('models/m.bin', 300);
    await cleanupComponent('cache', tmpDir);
    // Only cache DB gone
    expect(existsSync(join(tmpDir, 'wigolo.db'))).toBe(false);
    // Others remain
    expect(existsSync(join(tmpDir, 'embeddings'))).toBe(true);
    expect(existsSync(join(tmpDir, 'models'))).toBe(true);
  });

  it('does not remove cache DB when cleaning embeddings', async () => {
    makeFile('wigolo.db', 100);
    makeFile('embeddings/a.bin', 200);
    await cleanupComponent('embeddings', tmpDir);
    expect(existsSync(join(tmpDir, 'wigolo.db'))).toBe(true);
    expect(existsSync(join(tmpDir, 'embeddings'))).toBe(false);
  });
});

describe('CleanupResult shape', () => {
  it('result has ok, freedBytes, and optional error', async () => {
    const result: CleanupResult = await cleanupComponent('cache', tmpDir);
    expect(typeof result.ok).toBe('boolean');
    expect(typeof result.freedBytes).toBe('number');
  });
});
