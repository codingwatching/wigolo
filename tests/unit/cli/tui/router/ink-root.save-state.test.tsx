/**
 * Task 1 — Header save-state indicator.
 *
 * Verifies that InkRoot derives saveState from real store subscriptions and
 * passes a unified save-state label to the Header instead of a hardcoded 'ok'.
 *
 * States tested:
 * - idle-saved: no dirty keys → "All changes saved" label
 * - dirty: dirty keys but no save in flight → "N unsaved" label
 * - saved-toast: a save-group toast just landed → "Saved · ..." label
 */
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { InkRoot } from '../../../../../src/cli/tui/router/ink.js';
import { createSettingsStore } from '../../../../../src/cli/tui/state/settings-store.js';
import { createToastStore } from '../../../../../src/cli/tui/state/toast-store.js';
import { CATALOG } from '../../../../../src/cli/tui/schema/catalog.js';

vi.mock('../../../../../src/cli/tui/actions/write-config.js', () => ({
  persistKey: vi.fn().mockResolvedValue(undefined),
  writeMcpConfig: vi.fn().mockResolvedValue({ results: [], anyFailed: false }),
}));

afterEach(() => {
  cleanup();
  delete process.env.WIGOLO_TUI_REDUCED_MOTION;
});

beforeEach(() => {
  process.env.WIGOLO_TUI_REDUCED_MOTION = '1';
});

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function makeStore() {
  return createSettingsStore({
    browserTypes: 'chromium',
    maxBrowsers: 3,
    browserIdleTimeoutMs: 30000,
  });
}

describe('InkRoot — header save-state indicator', () => {
  it('shows "All changes saved" when store is clean (idle-saved state)', async () => {
    const store = makeStore();
    const { lastFrame } = render(
      <InkRoot store={store} catalog={CATALOG} initialRoute="home" />,
    );
    await wait(30);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('All changes saved');
  });

  it('shows "N unsaved" when store has dirty keys (dirty state)', async () => {
    const store = makeStore();
    store.set('maxBrowsers', 99);
    const { lastFrame } = render(
      <InkRoot store={store} catalog={CATALOG} initialRoute="home" />,
    );
    await wait(30);
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/1 unsaved/);
  });

  it('shows "Saved · ..." label when a save-group toast is active', async () => {
    const store = makeStore();
    const toastStore = createToastStore();
    toastStore.push({ message: 'Saved · api key', severity: 'ok', ttl: 3000, group: 'save' });
    const { lastFrame } = render(
      <InkRoot store={store} catalog={CATALOG} initialRoute="home" toastStore={toastStore} />,
    );
    await wait(30);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Saved · api key');
  });

  it('header shows "N unsaved" instead of "N pending" badge when dirty', async () => {
    const store = makeStore();
    store.set('maxBrowsers', 99);
    const { lastFrame } = render(
      <InkRoot store={store} catalog={CATALOG} initialRoute="home" />,
    );
    await wait(30);
    // The header first line should show the unified save-state label.
    const firstLine = (lastFrame() ?? '').split('\n')[0] ?? '';
    expect(firstLine).toContain('unsaved');
    expect(firstLine).not.toMatch(/\d+ pending/);
  });
});
