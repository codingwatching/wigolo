/**
 * Task 2 — Save toasts on every commitOne.
 *
 * Verifies that:
 * - A successful blur pushes a toast with group:'save' containing the field segment.
 * - Three rapid blurs coalesce into a single "Saved · 3 fields" toast (via
 *   ToastStore's built-in group coalescing).
 * - A failing persistKey does NOT push a save toast and instead pushes an err toast.
 * - blur without a toastStore wired still works (no crash).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must declare mock before importing the module under test.
let persistReject = false;
const writes: Array<[string, unknown]> = [];

vi.mock('../../../../../src/cli/tui/actions/write-config.js', () => ({
  persistKey: vi.fn(async (path: string, value: unknown) => {
    if (persistReject) throw new Error('disk full');
    writes.push([path, value]);
  }),
}));

import { createToastStore } from '../../../../../src/cli/tui/state/toast-store.js';
import { createSettingsStore } from '../../../../../src/cli/tui/state/settings-store.js';

beforeEach(async () => {
  writes.length = 0;
  persistReject = false;
  const { persistKey } = await import('../../../../../src/cli/tui/actions/write-config.js');
  (persistKey as ReturnType<typeof vi.fn>).mockImplementation(async (path: string, value: unknown) => {
    if (persistReject) throw new Error('disk full');
    writes.push([path, value]);
  });
});

describe('settings-store save toasts', () => {
  it('blur pushes a save-group toast containing the field segment', async () => {
    const toastStore = createToastStore();
    const store = createSettingsStore({}, toastStore);
    store.set('llm.apiKey', 'sk-test');
    await store.blur('llm.apiKey');
    const t = toastStore.current();
    expect(t).not.toBeNull();
    expect(t!.group).toBe('save');
    // toLabel converts 'apiKey' → 'api key' (camelCase → spaced)
    expect(t!.message).toContain('api key');
    expect(t!.severity).toBe('ok');
  });

  it('three sequential blurs coalesce into Saved · 3 fields', async () => {
    const toastStore = createToastStore();
    const store = createSettingsStore({}, toastStore);
    store.set('llm.apiKey', 'a');
    store.set('llm.model', 'b');
    store.set('llm.provider', 'c');
    // Sequential blurs: each pushes a save toast; ToastStore coalesces same-group.
    await store.blur('llm.apiKey');
    await store.blur('llm.model');
    await store.blur('llm.provider');
    expect(toastStore.current()?.message).toBe('Saved · 3 fields');
  });

  it('failed persistKey pushes err toast, not save toast', async () => {
    persistReject = true;
    const toastStore = createToastStore();
    const store = createSettingsStore({}, toastStore);
    store.set('llm.apiKey', 'sk-bad');
    await expect(store.blur('llm.apiKey')).rejects.toThrow('disk full');
    const t = toastStore.current();
    expect(t).not.toBeNull();
    expect(t!.severity).toBe('err');
    expect(t!.group).toBeUndefined();
  });

  it('blur without toastStore wired still works (no crash)', async () => {
    const store = createSettingsStore({});
    store.set('llm.apiKey', 'sk-test');
    await expect(store.blur('llm.apiKey')).resolves.toBeUndefined();
  });
});
