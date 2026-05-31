/**
 * Fix C regression test: SettingsHome category preview for multiselect fields
 * must show a meaningful status indicator instead of a blank string when the
 * array is empty.
 *
 * Expected behavior:
 *   - Empty array → "⚠ none installed" (yellow)
 *   - N items    → "✓ N installed" (green)
 *
 * The MCP Agents category (agentsCategory) has a single multiselect field
 * "Installed agents". Its preview in SettingsHome should use the new indicator.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { SettingsHome } from '../../../../../src/cli/tui/components/SettingsHome.js';
import { createSettingsStore } from '../../../../../src/cli/tui/state/settings-store.js';
import { agentsCategory } from '../../../../../src/cli/tui/schema/agents.js';

afterEach(() => {
  cleanup();
});

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Use a single-category catalog focused on the agents multiselect.
const AGENTS_CATALOG = [agentsCategory];

describe('SettingsHome multiselect category preview (Fix C)', () => {
  it('shows "⚠ none installed" when agents array is empty', async () => {
    const store = createSettingsStore({ agents: [] });
    const { lastFrame } = render(
      <SettingsHome
        store={store}
        catalog={AGENTS_CATALOG}
        onSelectCategory={() => {}}
        onAction={() => {}}
        onQuit={() => {}}
      />,
    );
    await wait(30);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('⚠');
    expect(frame).toContain('none installed');
  });

  it('does NOT show a blank preview when agents array is empty', async () => {
    const store = createSettingsStore({ agents: [] });
    const { lastFrame } = render(
      <SettingsHome
        store={store}
        catalog={AGENTS_CATALOG}
        onSelectCategory={() => {}}
        onAction={() => {}}
        onQuit={() => {}}
      />,
    );
    await wait(30);
    // The preview must not be empty — there should be visible indicator text.
    const frame = lastFrame() ?? '';
    // The MCP Agents row must exist in the frame and have preview text after the label.
    const lines = frame.split('\n');
    const agentsLine = lines.find((l) => l.includes('MCP Agents'));
    // The line should contain more than just the label — it must have the indicator.
    expect(agentsLine).toBeDefined();
    expect(agentsLine).toMatch(/⚠|✓/);
  });

  it('shows "✓ 2 installed" when 2 agents are selected', async () => {
    const store = createSettingsStore({ agents: ['claude-code', 'vscode'] });
    const { lastFrame } = render(
      <SettingsHome
        store={store}
        catalog={AGENTS_CATALOG}
        onSelectCategory={() => {}}
        onAction={() => {}}
        onQuit={() => {}}
      />,
    );
    await wait(30);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✓');
    expect(frame).toContain('2 installed');
  });

  it('shows "✓ 1 installed" when exactly 1 agent is selected', async () => {
    const store = createSettingsStore({ agents: ['cursor'] });
    const { lastFrame } = render(
      <SettingsHome
        store={store}
        catalog={AGENTS_CATALOG}
        onSelectCategory={() => {}}
        onAction={() => {}}
        onQuit={() => {}}
      />,
    );
    await wait(30);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✓');
    expect(frame).toContain('1 installed');
  });
});
