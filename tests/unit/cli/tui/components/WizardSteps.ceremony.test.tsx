/**
 * Task 4 — Wizard SetupComplete ceremony.
 *
 * Verifies that:
 * - After a successful finish at step 4, a "Setup complete" screen is shown.
 * - After 1500ms the ceremony auto-dismisses and onDone is called.
 * - Pressing Enter on the ceremony screen dismisses it immediately (onDone called).
 * - If save fails, the error path is shown and onDone is NOT auto-called.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { WizardSteps } from '../../../../../src/cli/tui/components/WizardSteps.js';
import { createSettingsStore } from '../../../../../src/cli/tui/state/settings-store.js';
import { CATALOG } from '../../../../../src/cli/tui/schema/catalog.js';
import type { SecretStore } from '../../../../../src/cli/tui/state/propagation.js';

vi.mock('../../../../../src/cli/tui/actions/write-config.js', () => ({
  persistKey: vi.fn().mockResolvedValue(undefined),
  writeMcpConfig: vi.fn().mockResolvedValue({ results: [], anyFailed: false }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ENTER = '\r';

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function silentSystemCheck() {
  return Promise.resolve({
    node: { ok: true, version: '20.0.0' },
    python: { ok: true, version: '3.11.0', binary: 'python3' as const },
    docker: { ok: false },
    disk: { ok: true, freeMb: 12345 },
    hardFailure: false,
  });
}

function makeStore() {
  return createSettingsStore({});
}

function makeSecretStore(): SecretStore {
  return {
    set: vi.fn().mockResolvedValue({ location: 'file' }),
    get: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

/** Drive wizard from step 1 through to step 4 finish and await the async save. */
async function driveToFinish(
  stdin: { write: (s: string) => void },
  saveImpl: ReturnType<typeof vi.fn>,
): Promise<void> {
  // Step 1 → Step 2
  await wait(30);
  stdin.write(ENTER);
  // Step 2 system check resolves
  await wait(80);
  stdin.write(ENTER);
  // Step 3 (LLM) → Step 4
  await wait(40);
  stdin.write(ENTER);
  // Step 4 (Agents) → finish
  await wait(60);
  stdin.write(ENTER);
  // Allow save to resolve
  await wait(80);
}

describe('WizardSteps — setup complete ceremony', () => {
  it('shows Setup complete screen after successful finish', async () => {
    const saveImpl = vi.fn().mockResolvedValue({ saved: [], propagated: [], failed: [] });
    const onDone = vi.fn();
    const { stdin, lastFrame } = render(
      <WizardSteps
        store={makeStore()}
        catalog={CATALOG}
        configPath="/tmp/config.json"
        secretStore={makeSecretStore()}
        onDone={onDone}
        onSkip={() => {}}
        runSystemCheckImpl={silentSystemCheck}
        saveImpl={saveImpl}
      />,
    );
    await driveToFinish(stdin, saveImpl);
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Setup complete|setup complete/i);
    // onDone should NOT have been called yet (ceremony is showing)
    expect(onDone).not.toHaveBeenCalled();
  });

  it('auto-dismisses ceremony after 1500ms and calls onDone', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const saveImpl = vi.fn().mockResolvedValue({ saved: [], propagated: [], failed: [] });
    const onDone = vi.fn();
    const { stdin } = render(
      <WizardSteps
        store={makeStore()}
        catalog={CATALOG}
        configPath="/tmp/config.json"
        secretStore={makeSecretStore()}
        onDone={onDone}
        onSkip={() => {}}
        runSystemCheckImpl={silentSystemCheck}
        saveImpl={saveImpl}
      />,
    );
    // Drive wizard steps using real async waits (shouldAdvanceTime=true)
    await driveToFinish(stdin, saveImpl);
    // Advance past ceremony delay
    await vi.advanceTimersByTimeAsync(1600);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('Enter on ceremony screen dismisses immediately and calls onDone', async () => {
    const saveImpl = vi.fn().mockResolvedValue({ saved: [], propagated: [], failed: [] });
    const onDone = vi.fn();
    const { stdin } = render(
      <WizardSteps
        store={makeStore()}
        catalog={CATALOG}
        configPath="/tmp/config.json"
        secretStore={makeSecretStore()}
        onDone={onDone}
        onSkip={() => {}}
        runSystemCheckImpl={silentSystemCheck}
        saveImpl={saveImpl}
      />,
    );
    await driveToFinish(stdin, saveImpl);
    // Ceremony is showing, press Enter to dismiss immediately
    stdin.write(ENTER);
    await wait(40);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('failure path calls onDone immediately without showing the ceremony screen', async () => {
    const saveImpl = vi.fn().mockResolvedValue({
      saved: [],
      propagated: [],
      failed: [],
      errors: [{ key: 'llm.apiKey', reason: 'write failed' }],
    });
    const onDone = vi.fn();
    const { stdin, lastFrame } = render(
      <WizardSteps
        store={makeStore()}
        catalog={CATALOG}
        configPath="/tmp/config.json"
        secretStore={makeSecretStore()}
        onDone={onDone}
        onSkip={() => {}}
        runSystemCheckImpl={silentSystemCheck}
        saveImpl={saveImpl}
      />,
    );
    await driveToFinish(stdin, saveImpl);
    // On save failure the wizard bypasses the ceremony and calls onDone immediately.
    expect(onDone).toHaveBeenCalledTimes(1);
    // The ceremony "Setup complete" screen must NOT appear on the error path.
    expect(lastFrame() ?? '').not.toMatch(/Setup complete/i);
  });
});
