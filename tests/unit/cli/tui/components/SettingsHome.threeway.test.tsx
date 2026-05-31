/**
 * Task 3 — Three-way quit prompt (Save & exit / Discard & exit / Cancel).
 *
 * Verifies that:
 * - q with pending shows the three-way prompt lines.
 * - Enter (⏎) in the prompt flushes pending via blur, then calls onQuit.
 * - d in the prompt discards pending and calls onQuit.
 * - Esc in the prompt closes it without calling onQuit.
 * - q with NO pending calls onQuit immediately (Phase 0 behaviour preserved).
 */
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { SettingsHome } from '../../../../../src/cli/tui/components/SettingsHome.js';
import { createSettingsStore } from '../../../../../src/cli/tui/state/settings-store.js';
import { CATALOG } from '../../../../../src/cli/tui/schema/catalog.js';

vi.mock('../../../../../src/cli/tui/actions/write-config.js', () => ({
  persistKey: vi.fn().mockResolvedValue(undefined),
  writeMcpConfig: vi.fn().mockResolvedValue({ results: [], anyFailed: false }),
}));

afterEach(() => {
  cleanup();
});

beforeEach(async () => {
  const { persistKey } = await import('../../../../../src/cli/tui/actions/write-config.js');
  (persistKey as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

const ENTER = '\r';
const ESC = '\x1b';

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function makeStore(overrides: Record<string, unknown> = {}) {
  return createSettingsStore({
    browserTypes: 'chromium',
    maxBrowsers: 3,
    browserIdleTimeoutMs: 30000,
    ...overrides,
  });
}

describe('SettingsHome — three-way quit prompt', () => {
  it('q with no pending calls onQuit immediately (no prompt)', async () => {
    const store = makeStore();
    const onQuit = vi.fn();
    const { stdin } = render(
      <SettingsHome
        store={store}
        catalog={CATALOG}
        onSelectCategory={() => {}}
        onAction={() => {}}
        onQuit={onQuit}
      />,
    );
    await wait(20);
    stdin.write('q');
    await wait(30);
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it('q with pending shows three-way prompt lines', async () => {
    const store = makeStore();
    store.set('maxBrowsers', 5);
    const onQuit = vi.fn();
    const { stdin, lastFrame } = render(
      <SettingsHome
        store={store}
        catalog={CATALOG}
        onSelectCategory={() => {}}
        onAction={() => {}}
        onQuit={onQuit}
      />,
    );
    await wait(20);
    stdin.write('q');
    await wait(30);
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Save.*exit|Save & exit/i);
    expect(frame).toMatch(/[Dd]iscard/);
    expect(frame).toMatch(/[Cc]ancel/);
    expect(onQuit).not.toHaveBeenCalled();
  });

  it('Enter (⏎) in prompt flushes pending and calls onQuit', async () => {
    const store = makeStore();
    store.set('maxBrowsers', 5);
    const onQuit = vi.fn();
    const { stdin } = render(
      <SettingsHome
        store={store}
        catalog={CATALOG}
        onSelectCategory={() => {}}
        onAction={() => {}}
        onQuit={onQuit}
      />,
    );
    await wait(20);
    stdin.write('q');
    await wait(30);
    stdin.write(ENTER);
    await wait(60);
    // All pending should have been flushed (via blur → commitOne)
    expect(store.dirtyKeys()).toHaveLength(0);
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it('d in prompt discards pending and calls onQuit', async () => {
    const store = makeStore();
    store.set('maxBrowsers', 5);
    const onQuit = vi.fn();
    const { stdin } = render(
      <SettingsHome
        store={store}
        catalog={CATALOG}
        onSelectCategory={() => {}}
        onAction={() => {}}
        onQuit={onQuit}
      />,
    );
    await wait(20);
    stdin.write('q');
    await wait(30);
    stdin.write('d');
    await wait(30);
    expect(store.dirtyKeys()).toHaveLength(0);
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it('Esc in prompt closes prompt without calling onQuit', async () => {
    const store = makeStore();
    store.set('maxBrowsers', 5);
    const onQuit = vi.fn();
    const { stdin, lastFrame } = render(
      <SettingsHome
        store={store}
        catalog={CATALOG}
        onSelectCategory={() => {}}
        onAction={() => {}}
        onQuit={onQuit}
      />,
    );
    await wait(20);
    stdin.write('q');
    await wait(30);
    stdin.write(ESC);
    await wait(30);
    expect(onQuit).not.toHaveBeenCalled();
    // Prompt should be gone
    const frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/Save.*exit/i);
  });
});
