export type ComponentState = 'ok' | 'failed' | 'degraded' | 'absent';

export interface ComponentStatus {
  id: string;
  label: string;
  required: boolean;
  status: ComponentState;
  detail?: string;       // error / reason
  disables?: string;     // capability lost when not ok (e.g. "find_similar")
}

export interface SetupSummary {
  lines: string[];
  readyCount: number;
  total: number;
  requiredFailed: boolean;
  exitCode: 0 | 1;
}

function glyph(s: ComponentState): string {
  if (s === 'ok') return '✓';
  if (s === 'absent') return '⚠';
  if (s === 'degraded') return '⚠';
  return '✗';
}

export function summarizeSetup(components: ComponentStatus[]): SetupSummary {
  const total = components.length;
  const readyCount = components.filter(c => c.status === 'ok').length;
  const requiredFailed = components.some(c => c.required && c.status !== 'ok');

  const lines: string[] = [`Setup: ${readyCount}/${total} ready`];
  for (const c of components) {
    let line = `  ${glyph(c.status)} ${c.label}`;
    if (c.detail && c.status !== 'ok') line += ` — ${c.detail}`;
    if (c.disables && c.status !== 'ok') line += `   → ${c.disables} disabled`;
    if (c.status === 'absent' && !c.required) line += ' (optional)';
    lines.push(line);
  }
  lines.push('Run `wigolo doctor` for detail. Re-run setup: `wigolo init`.');

  return { lines, readyCount, total, requiredFailed, exitCode: requiredFailed ? 1 : 0 };
}
