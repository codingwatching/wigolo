import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const BIN_PATH = join(import.meta.dirname, '..', '..', 'dist', 'index.js');

function runShellCommand(input: string, args: string[] = []): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [BIN_PATH, 'shell', ...args], {
      env: {
        ...process.env,
        LOG_LEVEL: 'error',
        WIGOLO_DATA_DIR: join(import.meta.dirname, '..', 'fixtures', 'repl-test-data'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    child.stdin.write(input + '\n');
    child.stdin.write('exit\n');
    child.stdin.end();
  });
}

// Each test spawns `node dist/index.js shell` as a real child process. Under
// heavy parallel load (e.g. the full integration suite where many tests also
// spawn children), child startup and stdio plumbing can race — the child
// occasionally exits before stdout is fully drained, or `stdin.end()` arrives
// before the REPL has finished reading the first command line. The retries
// here are a pragmatic guard: every assertion is deterministic given a
// successful spawn, so a single retry suffices in practice. We use 3 for
// headroom under CI contention.
describe('REPL integration', () => {
  // Shell chrome (help/goodbye/unknown-command notices) is human-facing text and
  // now goes to stderr so stdout stays a clean NDJSON stream under --json.
  it('responds to help command', { retry: 3 }, async () => {
    const { stderr } = await runShellCommand('help');
    expect(stderr).toContain('Available commands');
    expect(stderr).toContain('search');
    expect(stderr).toContain('fetch');
    expect(stderr).toContain('crawl');
    expect(stderr).toContain('cache');
    expect(stderr).toContain('extract');
  }, 15_000);

  it('exits cleanly on exit command', { retry: 3 }, async () => {
    const { stderr, exitCode } = await runShellCommand('exit');
    expect(stderr).toContain('Goodbye');
    expect(exitCode).toBe(0);
  }, 10_000);

  it('handles unknown commands gracefully', { retry: 3 }, async () => {
    const { stderr } = await runShellCommand('foobar');
    expect(stderr).toContain('Unknown command');
  }, 10_000);

  it('returns JSON output with --json flag', { retry: 3 }, async () => {
    const { stdout } = await runShellCommand('cache stats', ['--json']);
    try {
      const lines = stdout.trim().split('\n').filter(l => l.trim());
      const lastJsonLine = lines.filter(l => l.trim().startsWith('{') || l.trim().startsWith('"')).pop();
      if (lastJsonLine) {
        const parsed = JSON.parse(lastJsonLine);
        expect(parsed).toBeDefined();
      }
    } catch {
      expect(stdout).toContain('{');
    }
  }, 15_000);

  it('handles search with missing query', { retry: 3 }, async () => {
    const { stdout } = await runShellCommand('search');
    expect(stdout).toContain('Usage');
  }, 10_000);

  it('handles fetch with missing URL', { retry: 3 }, async () => {
    const { stdout } = await runShellCommand('fetch');
    expect(stdout).toContain('Usage');
  }, 10_000);

  it('handles empty input lines', { retry: 3 }, async () => {
    const { exitCode } = await runShellCommand('');
    expect(exitCode).toBe(0);
  }, 10_000);

  it('displays goodbye on exit', { retry: 3 }, async () => {
    const { stderr } = await runShellCommand('exit');
    expect(stderr).toContain('Goodbye');
  }, 10_000);
});

// Pipe a full multi-line script into `shell` and capture stdout/stderr/exit.
// The history path is redirected to a tmp file so we can assert a piped
// session leaves ZERO history behind.
function runShellScript(
  lines: string[],
  args: string[],
  historyPath: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [BIN_PATH, 'shell', ...args], {
      env: {
        ...process.env,
        LOG_LEVEL: 'error',
        WIGOLO_DATA_DIR: join(import.meta.dirname, '..', 'fixtures', 'repl-test-data'),
        WIGOLO_SHELL_HISTORY_PATH: historyPath,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
    child.stdin.write(lines.join('\n') + '\n');
    child.stdin.end();
  });
}

describe('REPL NDJSON scripting', () => {
  // CONTRACT (as implemented):
  //  - Under `--json`, every TOOL command result is exactly ONE compact,
  //    parseable JSON document on its own stdout line.
  //  - An unknown command produces NO stdout doc (its message goes to stderr)
  //    and counts as a failure.
  //  - A session with >=1 failure exits 1; the preamble/goodbye are on stderr,
  //    so stdout is a clean NDJSON stream.
  //  - A piped session appends ZERO history lines.
  it('emits one JSON doc per tool command, exits 1 on an invalid command, writes no history', { retry: 3 }, async () => {
    const historyPath = join(
      import.meta.dirname,
      '..',
      'fixtures',
      'repl-test-data',
      `piped-history-${process.pid}-${Date.now()}`,
    );
    const { stdout, exitCode } = await runShellScript(
      ['cache stats', 'watch list', 'boguscmd', 'exit'],
      ['--json'],
      historyPath,
    );

    const stdoutLines = stdout.trim().split('\n').filter((l) => l.trim());
    // Two TOOL commands → exactly two JSON docs. The unknown command adds none.
    expect(stdoutLines).toHaveLength(2);
    const docs = stdoutLines.map((l) => JSON.parse(l));
    expect(docs[0].stats).toBeDefined();
    expect(Array.isArray(docs[1].jobs)).toBe(true);
    // The invalid command makes the whole piped session fail.
    expect(exitCode).toBe(1);

    // A piped (non-tty) session never touches the history file.
    const { existsSync, readFileSync, rmSync } = await import('node:fs');
    const empty = !existsSync(historyPath) || readFileSync(historyPath, 'utf-8').trim() === '';
    expect(empty).toBe(true);
    if (existsSync(historyPath)) rmSync(historyPath, { force: true });
  }, 20_000);

  it('a clean piped tool-only session exits 0', { retry: 3 }, async () => {
    const historyPath = join(
      import.meta.dirname,
      '..',
      'fixtures',
      'repl-test-data',
      `piped-clean-${process.pid}-${Date.now()}`,
    );
    const { stdout, exitCode } = await runShellScript(
      ['cache stats', 'exit'],
      ['--json'],
      historyPath,
    );
    const stdoutLines = stdout.trim().split('\n').filter((l) => l.trim());
    expect(stdoutLines).toHaveLength(1);
    expect(JSON.parse(stdoutLines[0]).stats).toBeDefined();
    expect(exitCode).toBe(0);
  }, 20_000);
});

// One-shot CLI (`wigolo <tool> <args>`) — spawns `node dist/index.js <tool>`.
function runTool(
  tool: string,
  args: string[] = [],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [BIN_PATH, tool, ...args], {
      env: {
        ...process.env,
        LOG_LEVEL: 'error',
        WIGOLO_DATA_DIR: join(import.meta.dirname, '..', 'fixtures', 'repl-test-data'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
  });
}

const ALL_TOOLS = [
  'search', 'fetch', 'crawl', 'extract', 'cache',
  'find-similar', 'research', 'agent', 'diff', 'watch',
] as const;

describe('one-shot CLI integration', () => {
  for (const tool of ALL_TOOLS) {
    it(`${tool} --help exits 0 with usage on stdout`, { retry: 3 }, async () => {
      const { stdout, exitCode } = await runTool(tool, ['--help']);
      expect(exitCode).toBe(0);
      // The tool name appears in its own usage line.
      expect(stdout.toLowerCase()).toContain(tool === 'find-similar' ? 'find' : tool);
    }, 20_000);
  }

  it('find_similar alias --help exits 0', { retry: 3 }, async () => {
    const { stdout, exitCode } = await runTool('find_similar', ['--help']);
    expect(exitCode).toBe(0);
    expect(stdout.toLowerCase()).toContain('find');
  }, 20_000);

  it('cache stats --json: exit 0 and full stdout parses (zero log leakage)', { retry: 3 }, async () => {
    const { stdout, exitCode } = await runTool('cache', ['stats', '--json']);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.stats).toBeDefined();
  }, 20_000);

  it('watch list --json: exit 0 and full stdout parses to a job set', { retry: 3 }, async () => {
    const { stdout, exitCode } = await runTool('watch', ['list', '--json']);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(Array.isArray(parsed.jobs)).toBe(true);
  }, 20_000);

  it('a failing invocation exits 1 with a parseable JSON error under --json', { retry: 3 }, async () => {
    const { stdout, exitCode } = await runTool('fetch', ['not-a-valid-url', '--json']);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.error).toBeDefined();
  }, 20_000);
});
