import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import os from 'node:os';
import path from 'node:path';
import { FieldRenderer } from '../../../../../src/cli/tui/components/FieldRenderer.js';
import type { FieldDef } from '../../../../../src/cli/tui/schema/types.js';

afterEach(() => {
  cleanup();
});

const noop = (): void => {};

const selectField: FieldDef = {
  key: 'X',
  settingsPath: 'x',
  label: 'X',
  kind: 'select',
  options: [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
    { value: 'c', label: 'C' },
  ],
  default: 'a',
};

const toggleField: FieldDef = {
  key: 'T',
  settingsPath: 't',
  label: 'Toggle',
  kind: 'toggle',
  default: false,
};

const numberField: FieldDef = {
  key: 'N',
  settingsPath: 'n',
  label: 'Count',
  kind: 'number',
  default: 3,
  min: 1,
  max: 16,
};

const textField: FieldDef = {
  key: 'TX',
  settingsPath: 'tx',
  label: 'Greeting',
  kind: 'text',
  default: '',
};

const pathField: FieldDef = {
  key: 'P',
  settingsPath: 'p',
  label: 'Data dir',
  kind: 'path',
  default: '',
};

const readonlyField: FieldDef = {
  key: 'V',
  settingsPath: 'v',
  label: 'Version',
  kind: 'readonly',
  default: '0.1.23',
};

describe('FieldRenderer', () => {
  it('renders select with current value and label', () => {
    const { lastFrame } = render(
      <FieldRenderer
        field={selectField}
        value="a"
        focused={false}
        editing={false}
        onChange={noop}
        onEditStart={noop}
        onEditDone={noop}
        onEditCancel={noop}
      />,
    );
    expect(lastFrame()).toContain('X');
    expect(lastFrame()).toContain('a');
  });

  it('renders readonly value without focus indicator', () => {
    const { lastFrame } = render(
      <FieldRenderer
        field={readonlyField}
        value="0.1.23"
        focused={false}
        editing={false}
        onChange={noop}
        onEditStart={noop}
        onEditDone={noop}
        onEditCancel={noop}
      />,
    );
    expect(lastFrame()).toContain('0.1.23');
  });

  it('renders pending marker (*) when value differs from current', () => {
    const { lastFrame } = render(
      <FieldRenderer
        field={selectField}
        value="b"
        current="a"
        focused={false}
        editing={false}
        onChange={noop}
        onEditStart={noop}
        onEditDone={noop}
        onEditCancel={noop}
      />,
    );
    expect(lastFrame()).toMatch(/\*/);
  });

  it('does not render pending marker when value equals current', () => {
    const { lastFrame } = render(
      <FieldRenderer
        field={selectField}
        value="a"
        current="a"
        focused={false}
        editing={false}
        onChange={noop}
        onEditStart={noop}
        onEditDone={noop}
        onEditCancel={noop}
      />,
    );
    // The label "X" must still render but no trailing asterisk near the value.
    expect(lastFrame()).not.toMatch(/\*/);
  });

  it('renders futureNote as muted footer text under the field', () => {
    const f: FieldDef = { ...selectField, futureNote: 'More engines coming soon.' };
    const { lastFrame } = render(
      <FieldRenderer
        field={f}
        value="a"
        focused={false}
        editing={false}
        onChange={noop}
        onEditStart={noop}
        onEditDone={noop}
        onEditCancel={noop}
      />,
    );
    expect(lastFrame()).toContain('More engines coming soon');
  });

  it('renders help text below the value', () => {
    const f: FieldDef = { ...selectField, help: 'Choose your browser engine.' };
    const { lastFrame } = render(
      <FieldRenderer
        field={f}
        value="a"
        focused={false}
        editing={false}
        onChange={noop}
        onEditStart={noop}
        onEditDone={noop}
        onEditCancel={noop}
      />,
    );
    expect(lastFrame()).toContain('Choose your browser engine');
  });

  it('readonly never fires onChange even when focused + enter', async () => {
    const onChange = vi.fn();
    const onEditStart = vi.fn();
    const { stdin } = render(
      <FieldRenderer
        field={readonlyField}
        value="0.1.23"
        focused={true}
        editing={false}
        onChange={onChange}
        onEditStart={onEditStart}
        onEditDone={noop}
        onEditCancel={noop}
      />,
    );
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 20));
    expect(onChange).not.toHaveBeenCalled();
    expect(onEditStart).not.toHaveBeenCalled();
  });

  it('toggle flips on enter when focused', async () => {
    const onChange = vi.fn();
    const onEditDone = vi.fn();
    const { stdin } = render(
      <FieldRenderer
        field={toggleField}
        value={false}
        focused={true}
        editing={false}
        onChange={onChange}
        onEditStart={noop}
        onEditDone={onEditDone}
        onEditCancel={noop}
      />,
    );
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 30));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(onEditDone).toHaveBeenCalled();
  });

  it('select cycles forward with right-arrow and wraps at end', async () => {
    const onChange = vi.fn();
    const onEditDone = vi.fn();
    // Start at 'c' (last). Right-arrow should wrap to 'a'.
    const { stdin } = render(
      <FieldRenderer
        field={selectField}
        value="c"
        focused={true}
        editing={false}
        onChange={onChange}
        onEditStart={noop}
        onEditDone={onEditDone}
        onEditCancel={noop}
      />,
    );
    await new Promise((r) => setTimeout(r, 20));
    // Right-arrow to advance
    stdin.write('[C');
    await new Promise((r) => setTimeout(r, 30));
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('select cycles backward with left-arrow and wraps at start', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldRenderer
        field={selectField}
        value="a"
        focused={true}
        editing={false}
        onChange={onChange}
        onEditStart={noop}
        onEditDone={noop}
        onEditCancel={noop}
      />,
    );
    await new Promise((r) => setTimeout(r, 20));
    // Left-arrow to retreat (should wrap to 'c')
    stdin.write('[D');
    await new Promise((r) => setTimeout(r, 30));
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('number out-of-range entry is rejected (no onChange) on commit', async () => {
    const onChange = vi.fn();
    const onEditDone = vi.fn();
    const { stdin, rerender } = render(
      <FieldRenderer
        field={numberField}
        value={3}
        focused={true}
        editing={false}
        onChange={onChange}
        onEditStart={() => {}}
        onEditDone={onEditDone}
        onEditCancel={noop}
      />,
    );
    await new Promise((r) => setTimeout(r, 20));
    // Enter edit mode
    rerender(
      <FieldRenderer
        field={numberField}
        value={3}
        focused={true}
        editing={true}
        onChange={onChange}
        onEditStart={() => {}}
        onEditDone={onEditDone}
        onEditCancel={noop}
      />,
    );
    await new Promise((r) => setTimeout(r, 20));
    // Clear buffer and type 999 (out of max=16)
    stdin.write(''); // backspace to clear
    stdin.write('');
    stdin.write('');
    stdin.write('9');
    stdin.write('9');
    stdin.write('9');
    await new Promise((r) => setTimeout(r, 30));
    // Commit
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 30));
    // onChange must NOT have been called with an out-of-range numeric value
    const numericCalls = onChange.mock.calls.filter(
      ([v]) => typeof v === 'number' && (v < (numberField.min ?? -Infinity) || v > (numberField.max ?? Infinity)),
    );
    expect(numericCalls).toHaveLength(0);
  });

  it('number in-range entry commits via onChange + onEditDone', async () => {
    const onChange = vi.fn();
    const onEditDone = vi.fn();
    const { stdin, rerender } = render(
      <FieldRenderer
        field={numberField}
        value={3}
        focused={true}
        editing={false}
        onChange={onChange}
        onEditStart={noop}
        onEditDone={onEditDone}
        onEditCancel={noop}
      />,
    );
    await new Promise((r) => setTimeout(r, 20));
    rerender(
      <FieldRenderer
        field={numberField}
        value={3}
        focused={true}
        editing={true}
        onChange={onChange}
        onEditStart={noop}
        onEditDone={onEditDone}
        onEditCancel={noop}
      />,
    );
    await new Promise((r) => setTimeout(r, 20));
    stdin.write(''); // clear "3"
    stdin.write('5');
    await new Promise((r) => setTimeout(r, 30));
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 30));
    expect(onChange).toHaveBeenCalledWith(5);
    expect(onEditDone).toHaveBeenCalled();
  });

  it('text edit enter calls onEditDone with committed text', async () => {
    const onChange = vi.fn();
    const onEditDone = vi.fn();
    const { stdin, rerender } = render(
      <FieldRenderer
        field={textField}
        value=""
        focused={true}
        editing={false}
        onChange={onChange}
        onEditStart={noop}
        onEditDone={onEditDone}
        onEditCancel={noop}
      />,
    );
    rerender(
      <FieldRenderer
        field={textField}
        value=""
        focused={true}
        editing={true}
        onChange={onChange}
        onEditStart={noop}
        onEditDone={onEditDone}
        onEditCancel={noop}
      />,
    );
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('h');
    stdin.write('i');
    await new Promise((r) => setTimeout(r, 30));
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 30));
    expect(onChange).toHaveBeenCalledWith('hi');
    expect(onEditDone).toHaveBeenCalled();
  });

  it('text edit esc calls onEditCancel without onEditDone', async () => {
    const onChange = vi.fn();
    const onEditDone = vi.fn();
    const onEditCancel = vi.fn();
    const { stdin, rerender } = render(
      <FieldRenderer
        field={textField}
        value="old"
        focused={true}
        editing={false}
        onChange={onChange}
        onEditStart={noop}
        onEditDone={onEditDone}
        onEditCancel={onEditCancel}
      />,
    );
    rerender(
      <FieldRenderer
        field={textField}
        value="old"
        focused={true}
        editing={true}
        onChange={onChange}
        onEditStart={noop}
        onEditDone={onEditDone}
        onEditCancel={onEditCancel}
      />,
    );
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('x');
    await new Promise((r) => setTimeout(r, 20));
    stdin.write(''); // escape
    await new Promise((r) => setTimeout(r, 30));
    expect(onEditCancel).toHaveBeenCalled();
    expect(onEditDone).not.toHaveBeenCalled();
  });

  it('path display replaces homedir prefix with ~/', () => {
    const home = os.homedir();
    const fullPath = path.join(home, '.wigolo', 'cache');
    const { lastFrame } = render(
      <FieldRenderer
        field={pathField}
        value={fullPath}
        focused={false}
        editing={false}
        onChange={noop}
        onEditStart={noop}
        onEditDone={noop}
        onEditCancel={noop}
      />,
    );
    expect(lastFrame()).toContain('~/.wigolo/cache');
    expect(lastFrame()).not.toContain(home);
  });

  it('focused (not editing) on text dispatches onEditStart on enter', async () => {
    const onEditStart = vi.fn();
    const { stdin } = render(
      <FieldRenderer
        field={textField}
        value="hi"
        focused={true}
        editing={false}
        onChange={noop}
        onEditStart={onEditStart}
        onEditDone={noop}
        onEditCancel={noop}
      />,
    );
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 30));
    expect(onEditStart).toHaveBeenCalled();
  });

  it('does not fire input handlers when not focused', async () => {
    const onChange = vi.fn();
    const onEditStart = vi.fn();
    const { stdin } = render(
      <FieldRenderer
        field={selectField}
        value="a"
        focused={false}
        editing={false}
        onChange={onChange}
        onEditStart={onEditStart}
        onEditDone={noop}
        onEditCancel={noop}
      />,
    );
    await new Promise((r) => setTimeout(r, 20));
    stdin.write('\r');
    stdin.write('[C');
    await new Promise((r) => setTimeout(r, 30));
    expect(onChange).not.toHaveBeenCalled();
    expect(onEditStart).not.toHaveBeenCalled();
  });
});
