/**
 * SettingsHome quit-key behaviour — Phase 0 + Phase 1 regression pins.
 *
 * Verifies that:
 * - pressing q on a clean session calls onQuit immediately (no prompt).
 * - pressing q with pending changes shows the three-way Save/Discard/Cancel
 *   prompt and does NOT call onQuit immediately.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { SettingsHome } from '../../../../../src/cli/tui/components/SettingsHome.js';
import { createSettingsStore } from '../../../../../src/cli/tui/state/settings-store.js';
import { CATALOG } from '../../../../../src/cli/tui/schema/catalog.js';

afterEach(() => {
  cleanup();
});

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

describe('SettingsHome — quit key', () => {
  it('q exits immediately when no pending changes', async () => {
    const store = makeStore();
    expect(store.isDirty()).toBe(false);
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

  it('q with pending shows three-way prompt and does not call onQuit', async () => {
    const store = makeStore();
    store.set('maxBrowsers', 5);
    expect(store.isDirty()).toBe(true);
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
    // Three-way prompt: Save & exit, Discard & exit, Cancel
    expect(frame).toMatch(/Save.*exit|Save & exit/i);
    expect(frame).toMatch(/[Dd]iscard/);
    expect(onQuit).not.toHaveBeenCalled();
  });
});
