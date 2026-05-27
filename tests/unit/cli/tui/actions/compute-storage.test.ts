/**
 * Tests for the computeStorage action.
 *
 * Why: computeStorage must accurately reflect per-component disk usage so the
 * dashboard can show hogs sorted descending and cleanup targets are correct.
 * Tests use a fixture dir tree (real fs in tmp) to avoid mocking FS internals.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  computeStorage,
  type StorageResult,
  type ComponentStorageItem,
} from '../../../../../src/cli/tui/actions/compute-storage.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'wigolo-sp5-storage-'));
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function writeFile(path: string, content: string): void {
  const parts = path.split('/').slice(0, -1);
  if (parts.length > 0) {
    mkdirSync(join(tmpDir, ...parts), { recursive: true });
  }
  writeFileSync(join(tmpDir, path), content, 'utf-8');
}

function makeDir(path: string): void {
  mkdirSync(join(tmpDir, path), { recursive: true });
}

describe('computeStorage — empty data dir', () => {
  it('returns zero sizes when data dir does not exist', async () => {
    const result = await computeStorage(join(tmpDir, 'nonexistent'));
    expect(result.totalBytes).toBe(0);
    expect(result.items.every((i) => i.bytes === 0)).toBe(true);
  });

  it('returns zero sizes when data dir is empty', async () => {
    makeDir('wigolo-data');
    const result = await computeStorage(join(tmpDir, 'wigolo-data'));
    expect(result.totalBytes).toBe(0);
    expect(result.items.every((i) => i.bytes === 0)).toBe(true);
  });
});

describe('computeStorage — known component dirs', () => {
  it('counts cache DB bytes under the root (wigolo.db)', async () => {
    const content = 'x'.repeat(1024); // 1 KB
    writeFile('wigolo.db', content);
    const result = await computeStorage(tmpDir);
    const cacheItem = result.items.find((i) => i.id === 'cache');
    expect(cacheItem).toBeDefined();
    expect(cacheItem!.bytes).toBe(1024);
  });

  it('counts embeddings bytes under embeddings/ dir', async () => {
    const content = 'e'.repeat(2048); // 2 KB
    makeDir('embeddings');
    writeFile('embeddings/index.bin', content);
    const result = await computeStorage(tmpDir);
    const item = result.items.find((i) => i.id === 'embeddings');
    expect(item).toBeDefined();
    expect(item!.bytes).toBe(2048);
  });

  it('counts ML models bytes under models/ dir (transformers)', async () => {
    makeDir('models');
    writeFile('models/model.bin', 'a'.repeat(4096)); // 4 KB
    const result = await computeStorage(tmpDir);
    const item = result.items.find((i) => i.id === 'models');
    expect(item).toBeDefined();
    expect(item!.bytes).toBe(4096);
  });

  it('counts browser bytes under playwright-browsers/ dir', async () => {
    makeDir('playwright-browsers');
    writeFile('playwright-browsers/chromium.bin', 'b'.repeat(512));
    const result = await computeStorage(tmpDir);
    const item = result.items.find((i) => i.id === 'browser');
    expect(item).toBeDefined();
    expect(item!.bytes).toBe(512);
  });

  it('counts searxng bytes under searxng/ dir', async () => {
    makeDir('searxng');
    writeFile('searxng/venv/lib/foo.py', 'c'.repeat(256));
    const result = await computeStorage(tmpDir);
    const item = result.items.find((i) => i.id === 'searxng');
    expect(item).toBeDefined();
    expect(item!.bytes).toBe(256);
  });
});

describe('computeStorage — totalBytes and hogs', () => {
  it('totalBytes equals sum of all component bytes + uncategorised', async () => {
    writeFile('wigolo.db', 'x'.repeat(100));
    makeDir('embeddings');
    writeFile('embeddings/a.bin', 'y'.repeat(200));
    const result = await computeStorage(tmpDir);
    // total must include at minimum these two components
    expect(result.totalBytes).toBeGreaterThanOrEqual(300);
  });

  it('hogs are sorted descending by bytes', async () => {
    writeFile('wigolo.db', 'x'.repeat(100));
    makeDir('embeddings');
    writeFile('embeddings/big.bin', 'y'.repeat(500));
    makeDir('models');
    writeFile('models/m.bin', 'z'.repeat(200));
    const result = await computeStorage(tmpDir);
    for (let i = 0; i < result.hogs.length - 1; i++) {
      expect(result.hogs[i]!.bytes).toBeGreaterThanOrEqual(result.hogs[i + 1]!.bytes);
    }
  });

  it('hogs only includes non-zero items', async () => {
    writeFile('wigolo.db', 'x'.repeat(100));
    const result = await computeStorage(tmpDir);
    expect(result.hogs.every((h) => h.bytes > 0)).toBe(true);
  });
});

describe('computeStorage — result shape', () => {
  it('returns StorageResult with items, hogs, totalBytes', async () => {
    const result = await computeStorage(tmpDir);
    expect(typeof result.totalBytes).toBe('number');
    expect(Array.isArray(result.items)).toBe(true);
    expect(Array.isArray(result.hogs)).toBe(true);
  });

  it('every item has id, label, bytes, path', async () => {
    const result = await computeStorage(tmpDir);
    for (const item of result.items) {
      expect(typeof item.id).toBe('string');
      expect(typeof item.label).toBe('string');
      expect(typeof item.bytes).toBe('number');
      expect(typeof item.path).toBe('string');
    }
  });

  it('known components are always present even when absent', async () => {
    const result = await computeStorage(tmpDir);
    const ids = result.items.map((i) => i.id);
    expect(ids).toContain('cache');
    expect(ids).toContain('embeddings');
    expect(ids).toContain('models');
    expect(ids).toContain('browser');
    expect(ids).toContain('searxng');
  });
});
