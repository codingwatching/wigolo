/**
 * Tests for entry.ts — the single Ink router for the new schema-driven shell.
 *
 * resolveEntry() is a pure decision function; we cover every branch of:
 *   - mode = 'wizard' / 'home' / 'auto'
 *   - configPath present / missing
 *   - isTTY false → headless
 *   - ci=true / plain=true / nonInteractive=true → headless
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveEntry } from '../../../../src/cli/tui/entry.js';

let tmpDir: string;
let presentPath: string;
let missingPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'wigolo-entry-test-'));
  presentPath = join(tmpDir, 'config.json');
  missingPath = join(tmpDir, 'missing.json');
  writeFileSync(presentPath, JSON.stringify({ version: 1, settings: {} }), {
    mode: 0o600,
  });
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('resolveEntry — mode resolution', () => {
  it('missing config + mode=auto → wizard, firstRun=true', async () => {
    const r = await resolveEntry({
      mode: 'auto',
      configPath: missingPath,
      isTTY: true,
    });
    expect(r.mode).toBe('wizard');
    expect(r.firstRun).toBe(true);
  });

  it('present config + mode=auto → home, firstRun=false', async () => {
    const r = await resolveEntry({
      mode: 'auto',
      configPath: presentPath,
      isTTY: true,
    });
    expect(r.mode).toBe('home');
    expect(r.firstRun).toBe(false);
  });

  it('explicit mode=wizard + config present → wizard, firstRun=false', async () => {
    const r = await resolveEntry({
      mode: 'wizard',
      configPath: presentPath,
      isTTY: true,
    });
    expect(r.mode).toBe('wizard');
    expect(r.firstRun).toBe(false);
  });

  it('explicit mode=home + no config → home, firstRun=true', async () => {
    const r = await resolveEntry({
      mode: 'home',
      configPath: missingPath,
      isTTY: true,
    });
    expect(r.mode).toBe('home');
    expect(r.firstRun).toBe(true);
  });
});

describe('resolveEntry — headless gating', () => {
  it('isTTY=false → headless=true', async () => {
    const r = await resolveEntry({
      mode: 'home',
      configPath: presentPath,
      isTTY: false,
    });
    expect(r.headless).toBe(true);
  });

  it('ci=true → headless=true even when isTTY=true', async () => {
    const r = await resolveEntry({
      mode: 'home',
      configPath: presentPath,
      isTTY: true,
      ci: true,
    });
    expect(r.headless).toBe(true);
  });

  it('plain=true → headless=true', async () => {
    const r = await resolveEntry({
      mode: 'home',
      configPath: presentPath,
      isTTY: true,
      plain: true,
    });
    expect(r.headless).toBe(true);
  });

  it('nonInteractive=true → headless=true', async () => {
    const r = await resolveEntry({
      mode: 'home',
      configPath: presentPath,
      isTTY: true,
      nonInteractive: true,
    });
    expect(r.headless).toBe(true);
  });

  it('isTTY=true + no CI/plain/non-interactive → headless=false', async () => {
    const r = await resolveEntry({
      mode: 'home',
      configPath: presentPath,
      isTTY: true,
      ci: false,
      plain: false,
      nonInteractive: false,
    });
    expect(r.headless).toBe(false);
  });
});
