import { MODES, type Mode } from '../types.js';

export function assertMode(value: unknown): asserts value is Mode | undefined {
  if (value === undefined) return;
  if (typeof value !== 'string' || !(MODES as readonly string[]).includes(value)) {
    throw new Error(
      `Invalid mode: ${JSON.stringify(value)}. Valid values: ${MODES.join(', ')}`,
    );
  }
}

export function resolveMode(value: unknown): Mode {
  assertMode(value);
  return (value as Mode | undefined) ?? 'balanced';
}
