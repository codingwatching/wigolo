#!/usr/bin/env node
/*
 * Fail the build if any source file contains a raw NUL (0x00) byte.
 *
 * A raw NUL in a .ts/.js source makes grep treat the file as binary and fall
 * silent from that offset on — the whole region goes invisible to grep-based
 * review, a real review-integrity hole (this guard exists because three
 * composite-key builders in cache/crawl/watch had embedded a raw NUL as a field
 * separator). Intentional NUL *characters* (e.g. a collision-proof key
 * delimiter) MUST be written as the `\0` escape, never a raw byte: identical at
 * runtime, visible in source. This turns the grep-blindness into a hard
 * tripwire so it can never silently return.
 *
 * Scans src/ and tests/ for the code extensions below; reports every offender
 * as file:offset (line:col); exits non-zero if any are found.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ROOTS = ['src', 'tests'];
const EXT = /\.(ts|tsx|js|mjs|cts|mts)$/;

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // a missing root is not a failure
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (EXT.test(entry.name)) out.push(p);
  }
  return out;
}

function lineCol(buf, offset) {
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset; i++) {
    if (buf[i] === 0x0a) {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

const offenders = [];
for (const root of ROOTS) {
  for (const file of walk(join(ROOT, root))) {
    const buf = readFileSync(file);
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x00) {
        const { line, col } = lineCol(buf, i);
        offenders.push(`${relative(ROOT, file)}: NUL byte at offset ${i} (line ${line}, col ${col})`);
      }
    }
  }
}

if (offenders.length) {
  console.error('FAIL: raw NUL (0x00) byte(s) found in source — use the \\0 escape, never a raw byte:');
  for (const o of offenders) console.error('  - ' + o);
  console.error('\nA raw NUL makes grep treat the file as binary and silences review from that offset on.');
  process.exit(1);
}
console.log('OK: no raw NUL bytes in src/ or tests/ (.ts/.tsx/.js/.mjs/.cts/.mts).');
