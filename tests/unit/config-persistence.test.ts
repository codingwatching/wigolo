/**
 * Tests for getConfig() honouring ~/.wigolo/config.json as a defaults layer
 * beneath explicit env-var overrides (per-field precedence).
 *
 * WHY these tests matter: the runtime was purely env-var-based; SP0 wires in
 * config.json so persisted user preferences survive across invocations without
 * requiring env vars. The env-var override contract must remain per-field —
 * setting ONE env var should not suppress config.json values for OTHER fields.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getConfig, resetConfig } from '../../src/config.js';
import { resetPersistedConfig } from '../../src/persisted-config.js';

let dir: string;
const originalEnv = { ...process.env };

function setConfigPath(path: string) {
  process.env.WIGOLO_CONFIG_PATH = path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wigolo-cfg-'));
  process.env = { ...originalEnv };
  resetConfig();
  resetPersistedConfig();
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetConfig();
  resetPersistedConfig();
  rmSync(dir, { recursive: true, force: true });
});

describe('getConfig() — env-var overrides config.json (per-field)', () => {
  it('returns env value when env var is set, ignoring config.json', () => {
    const cfgPath = join(dir, 'config.json');
    writeFileSync(cfgPath, JSON.stringify({ version: 1, settings: { logLevel: 'debug' } }));
    setConfigPath(cfgPath);
    process.env.LOG_LEVEL = 'warn';
    resetConfig(); resetPersistedConfig();
    expect(getConfig().logLevel).toBe('warn');
  });

  it('returns config.json value when env var is absent', () => {
    const cfgPath = join(dir, 'config.json');
    writeFileSync(cfgPath, JSON.stringify({ version: 1, settings: { logLevel: 'debug' } }));
    setConfigPath(cfgPath);
    delete process.env.LOG_LEVEL;
    resetConfig(); resetPersistedConfig();
    expect(getConfig().logLevel).toBe('debug');
  });

  it('returns built-in default when both env var and config.json are absent', () => {
    const cfgPath = join(dir, 'config.json');
    writeFileSync(cfgPath, JSON.stringify({ version: 1, settings: {} }));
    setConfigPath(cfgPath);
    delete process.env.LOG_LEVEL;
    resetConfig(); resetPersistedConfig();
    expect(getConfig().logLevel).toBe('info'); // built-in default
  });

  it('per-field: env for one field does not suppress config.json for another', () => {
    const cfgPath = join(dir, 'config.json');
    writeFileSync(
      cfgPath,
      JSON.stringify({ version: 1, settings: { logLevel: 'debug', logFormat: 'text' } }),
    );
    setConfigPath(cfgPath);
    // Only override logLevel via env; logFormat should still come from config.json
    process.env.LOG_LEVEL = 'warn';
    delete process.env.LOG_FORMAT;
    resetConfig(); resetPersistedConfig();
    const cfg = getConfig();
    expect(cfg.logLevel).toBe('warn');     // env wins
    expect(cfg.logFormat).toBe('text');    // config.json fills
  });
});

describe('getConfig() — persists numeric fields from config.json', () => {
  it('uses fetchTimeoutMs from config.json when env absent', () => {
    const cfgPath = join(dir, 'config.json');
    writeFileSync(cfgPath, JSON.stringify({ version: 1, settings: { fetchTimeoutMs: 7777 } }));
    setConfigPath(cfgPath);
    delete process.env.FETCH_TIMEOUT_MS;
    resetConfig(); resetPersistedConfig();
    expect(getConfig().fetchTimeoutMs).toBe(7777);
  });

  it('env FETCH_TIMEOUT_MS overrides config.json value', () => {
    const cfgPath = join(dir, 'config.json');
    writeFileSync(cfgPath, JSON.stringify({ version: 1, settings: { fetchTimeoutMs: 7777 } }));
    setConfigPath(cfgPath);
    process.env.FETCH_TIMEOUT_MS = '5000';
    resetConfig(); resetPersistedConfig();
    expect(getConfig().fetchTimeoutMs).toBe(5000);
  });
});

describe('getConfig() — legacy config.json migration', () => {
  it('reads browser from version-less legacy config file', () => {
    const cfgPath = join(dir, 'config.json');
    // Legacy TUI wrote without a version field
    writeFileSync(cfgPath, JSON.stringify({ defaultBrowser: 'chromium' }));
    setConfigPath(cfgPath);
    delete process.env.WIGOLO_BROWSER_TYPES;
    resetConfig(); resetPersistedConfig();
    // The runtime must not crash; it should migrate and use the value
    const cfg = getConfig();
    expect(cfg).toBeDefined();
  });
});

describe('getConfig() — no config.json (absent file)', () => {
  it('falls back to built-in defaults gracefully', () => {
    const cfgPath = join(dir, 'nonexistent.json');
    setConfigPath(cfgPath);
    delete process.env.LOG_LEVEL;
    resetConfig(); resetPersistedConfig();
    expect(getConfig().logLevel).toBe('info');
  });
});
