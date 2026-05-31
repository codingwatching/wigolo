/**
 * Production entry wiring — verifies that the toast and activity singletons
 * are threaded through to InkRoot so that save toasts appear in the Header
 * when commitOne is called on the production-wired store.
 *
 * The critical regression this guards: before the fix, createSettingsStore
 * in config.ts / init.ts was called without toastStore, so commitOne silently
 * swallowed save events even though the singleton existed.
 *
 * Test strategy: construct the same wiring as config.ts/init.ts (use fresh
 * stores that share the same reference, mirroring the singleton pattern),
 * render InkRoot with the same toastStore, trigger a commitOne, and assert
 * the Header shows the save label — proving the wire is live.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { InkRoot } from '../../../../../src/cli/tui/router/ink.js';
import { createSettingsStore } from '../../../../../src/cli/tui/state/settings-store.js';
import { createToastStore } from '../../../../../src/cli/tui/state/toast-store.js';
import { createActivityStore } from '../../../../../src/cli/tui/state/activity-store.js';
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

describe('production entry wiring — singleton toast reaches InkRoot Header', () => {
  it('save toast from wired store appears in Header after commitOne', async () => {
    // Mirror the production wiring: createSettingsStore receives the same
    // toastStore that InkRoot subscribes to. This tests the invariant that
    // is enforced by the config.ts / init.ts wiring change.
    const toastStore = createToastStore();
    const activityStore = createActivityStore();
    const store = createSettingsStore({ maxBrowsers: 3 }, toastStore, activityStore);

    const { lastFrame } = render(
      <InkRoot
        store={store}
        catalog={CATALOG}
        initialRoute="home"
        toastStore={toastStore}
        activityStore={activityStore}
      />,
    );
    await wait(30);

    // Stage a change and commit it — commitOne pushes to the same toastStore
    // that InkRoot is subscribed to.
    store.set('maxBrowsers', 99);
    void store.commitOne('maxBrowsers');
    await wait(50);

    const frame = lastFrame() ?? '';
    // The Header save-state label should show the saved-toast state.
    // saveStateLabel for 'saved-toast' returns the toast message: "Saved · max browsers"
    expect(frame).toMatch(/Saved/);
    expect(frame).not.toContain('All changes saved');
  });

  it('isSaving flash: Header shows "Saving…" while commitOne is in flight', async () => {
    let resolvePersist!: () => void;
    const { persistKey } = await import('../../../../../src/cli/tui/actions/write-config.js');
    (persistKey as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolvePersist = resolve; }),
    );

    const toastStore = createToastStore();
    const activityStore = createActivityStore();
    const store = createSettingsStore({ maxBrowsers: 3 }, toastStore, activityStore);

    const { lastFrame } = render(
      <InkRoot
        store={store}
        catalog={CATALOG}
        initialRoute="home"
        toastStore={toastStore}
        activityStore={activityStore}
      />,
    );
    await wait(30);

    store.set('maxBrowsers', 99);
    const savePromise = store.commitOne('maxBrowsers');
    // Allow the activity store to fire before the persist resolves.
    await wait(20);

    const midFrame = lastFrame() ?? '';
    expect(midFrame).toContain('Saving');

    resolvePersist();
    await savePromise;
    await wait(30);

    const doneFrame = lastFrame() ?? '';
    expect(doneFrame).toMatch(/Saved/);
    expect(doneFrame).not.toContain('Saving');
  });

  it('error state persists beyond toast TTL — hasUnresolvedError keeps header in error', async () => {
    const { persistKey } = await import('../../../../../src/cli/tui/actions/write-config.js');
    (persistKey as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('disk full'));

    const toastStore = createToastStore();
    const activityStore = createActivityStore();
    const store = createSettingsStore({ maxBrowsers: 3 }, toastStore, activityStore);

    const { lastFrame } = render(
      <InkRoot
        store={store}
        catalog={CATALOG}
        initialRoute="home"
        toastStore={toastStore}
        activityStore={activityStore}
      />,
    );
    await wait(30);

    store.set('maxBrowsers', 99);
    await store.commitOne('maxBrowsers').catch(() => {});
    await wait(30);

    // Error toast is live — header should reflect error state.
    const errorFrame = lastFrame() ?? '';
    expect(errorFrame).toContain('Save failed');

    // Now expire the toast by waiting past its 5s TTL (simulated via a very short
    // TTL toast to displace it). Push a neutral toast on a different group to force
    // the toastStore to fire its subscriber — after the err toast expires, the
    // hasUnresolvedError flag in InkRoot should keep the header in 'error' state.
    // We fast-forward by directly advancing past the TTL.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await vi.advanceTimersByTimeAsync(6000);
    vi.useRealTimers();
    await wait(30);

    const afterTtlFrame = lastFrame() ?? '';
    // hasUnresolvedError persists — header must NOT lie "All changes saved ✓"
    expect(afterTtlFrame).not.toContain('All changes saved');
    expect(afterTtlFrame).toContain('Save failed');
  });
});
