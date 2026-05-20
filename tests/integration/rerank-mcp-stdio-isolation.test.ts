import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const skip = !process.env.WIGOLO_RERANKER_TEST;

// MCP stdio transport is newline-delimited JSON-RPC (see
// node_modules/@modelcontextprotocol/sdk/dist/esm/shared/stdio.js). Any line
// in stdout must therefore parse as JSON-RPC. If the reranker subprocess
// leaked its stderr (`READY model=...`, `ERROR ...`) into our stdout, the
// MCP frames would be contaminated.
describe.skipIf(skip)('integration: MCP stdio framing is not contaminated by rerank subprocess stderr', () => {
  it('search → rerank does not leak reranker_server.py stderr to MCP stdout', async () => {
    const cliEntry = join(process.cwd(), 'dist', 'index.js');
    const child = spawn('node', [cliEntry, 'mcp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, WIGOLO_RERANKER: 'onnx' },
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    const stdoutWaiters: Array<() => boolean> = [];
    const stderrWaiters: Array<() => boolean> = [];
    const wake = (waiters: Array<() => boolean>) => {
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i]()) waiters.splice(i, 1);
      }
    };
    child.stdout.on('data', (d) => {
      stdoutBuf += d.toString();
      wake(stdoutWaiters);
    });
    child.stderr.on('data', (d) => {
      stderrBuf += d.toString();
      wake(stderrWaiters);
    });

    const waitFor = (
      waiters: Array<() => boolean>,
      getBuf: () => string,
      pattern: RegExp,
      timeoutMs: number,
      label: string,
    ): Promise<void> => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.indexOf(check);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(new Error(`timed out waiting for ${label} (buf length=${getBuf().length})`));
        }, timeoutMs);
        const check = () => {
          if (pattern.test(getBuf())) {
            clearTimeout(timer);
            resolve();
            return true;
          }
          return false;
        };
        if (!check()) waiters.push(check);
      });
    };

    // MCP stdio is newline-delimited JSON, not LSP-style Content-Length framing.
    const send = (msg: object) => {
      child.stdin.write(JSON.stringify(msg) + '\n');
    };

    try {
      // Wait for the MCP server to actually finish bootstrapping (so writes to
      // stdin won't sit in the pipe buffer waiting for the stdio transport to
      // attach). Under heavy parallel-test load, this boot can take 10-25s.
      await waitFor(
        stderrWaiters,
        () => stderrBuf,
        /MCP server started/,
        60_000,
        'MCP server started log',
      );

      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' },
      } });
      await waitFor(
        stdoutWaiters,
        () => stdoutBuf,
        /"id"\s*:\s*1\b/,
        20_000,
        'MCP initialize response',
      );

      send({ jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'search', arguments: { query: 'react server components' } } });
      // tools/call response only needs to arrive — search may fall back to an
      // error response if the engine is unreachable, which still exercises
      // the framing path. Give it a generous ceiling since the reranker
      // subprocess may need to spawn + load model on first use.
      await waitFor(
        stdoutWaiters,
        () => stdoutBuf,
        /"id"\s*:\s*2\b/,
        60_000,
        'MCP tools/call response',
      );
    } finally {
      child.kill();
    }

    // The reranker subprocess emits `READY model=...` on its OWN stderr; it
    // must never reach our (the MCP server's) stdout. Same for `ERROR ...`.
    expect(stdoutBuf).not.toMatch(/READY model=/);
    expect(stdoutBuf).not.toMatch(/^ERROR /m);
    // Every line of stdout must be a valid JSON-RPC frame.
    for (const line of stdoutBuf.split('\n')) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as { jsonrpc?: string };
      expect(parsed.jsonrpc).toBe('2.0');
    }
  }, 180_000);
});
