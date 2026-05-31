/**
 * Tests for --force-wizard handling in resolveEntry.
 * These tests verify that mode='wizard' bypasses the hasRequiredFields check,
 * regardless of config state. The init-delegate-to-config wiring is verified
 * by code inspection (init.ts is a 3-line delegate to runConfig(['--force-wizard']));
 * end-to-end CLI tests would require subprocess spawning which is out of scope.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveEntry } from '../../../../src/cli/tui/entry.js';
import { resetPersistedConfig } from '../../../../src/persisted-config.js';

let tmpDir: string;

function writeComplete(file: string): string {
  const p = join(tmpDir, file);
  writeFileSync(p, JSON.stringify({
    version: 1,
    settings: { llmProvider: 'anthropic', llmApiKey: 'sk-xxx' },
  }), { mode: 0o600 });
  return p;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'wigolo-fwiz-'));
});

afterEach(() => {
  resetPersistedConfig();   // bust the per-path cache
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('resolveEntry with mode=wizard (force-wizard path)', () => {
  it('mode=wizard on a fully-configured file → still wizard (force bypasses required-fields)', async () => {
    const p = writeComplete('complete.json');
    const r = await resolveEntry({ mode: 'wizard', configPath: p, isTTY: true });
    expect(r.mode).toBe('wizard');
    // firstRun is false because the file exists — just the wizard was forced
    expect(r.firstRun).toBe(false);
  });

  it('mode=wizard on a missing file → wizard + firstRun=true', async () => {
    const p = join(tmpDir, 'none.json');
    const r = await resolveEntry({ mode: 'wizard', configPath: p, isTTY: true });
    expect(r.mode).toBe('wizard');
    expect(r.firstRun).toBe(true);
  });
});
