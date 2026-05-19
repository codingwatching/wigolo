import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return { ...actual, spawn: vi.fn() };
});

vi.mock('../../../src/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../../src/python-env.js', () => ({
  getPythonBin: () => '/fake/venv/bin/python',
}));

vi.mock('../../../src/config.js', () => ({
  getConfig: () => ({ dataDir: '/tmp/wigolo' }),
}));

import { spawn } from 'node:child_process';
import {
  getRerankSubprocess,
  resetAllRerankSubprocesses,
} from '../../../src/python/reranker-subprocess.js';

function makeProc() {
  const proc = new EventEmitter() as ChildProcess;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  (proc as any).stdin = stdin;
  (proc as any).stdout = stdout;
  (proc as any).stderr = stderr;
  (proc as any).kill = vi.fn();
  return { proc, stdin, stdout, stderr };
}

describe('RerankSubprocess', () => {
  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) drops queued mockReturnValueOnce
    // implementations from prior tests — registry tests queue spawn results
    // without consuming them (spawn is lazy), so they leak between tests.
    vi.resetAllMocks();
    resetAllRerankSubprocesses();
  });

  it('parses READY with model/max_length/input_names/post_processor', async () => {
    const { proc, stderr, stdout, stdin } = makeProc();
    vi.mocked(spawn).mockReturnValue(proc);
    const sub = getRerankSubprocess('bge-reranker-v2-m3', 512);
    setTimeout(() => stderr.emit('data', Buffer.from(
      'READY model=bge-reranker-v2-m3 max_length=512 input_names=input_ids,attention_mask post_processor=TemplateProcessing\n'
    )), 5);
    const writes: string[] = [];
    stdin.on('data', (chunk) => writes.push(chunk.toString()));
    const p = sub.score('q', ['doc1', 'doc2']);
    await new Promise(r => setTimeout(r, 20));
    const sent = JSON.parse(writes.join('').trim());
    expect(sent.query).toBe('q');
    expect(sent.docs).toEqual(['doc1', 'doc2']);
    stdout.emit('data', Buffer.from(JSON.stringify({ id: sent.id, scores: [0.8, 0.2] }) + '\n'));
    await expect(p).resolves.toEqual([0.8, 0.2]);
  });

  it('passes model_dir + max_length as argv to spawn', async () => {
    const { proc, stderr } = makeProc();
    vi.mocked(spawn).mockReturnValue(proc);
    const sub = getRerankSubprocess('bge-reranker-v2-m3', 256);
    setTimeout(() => stderr.emit('data', Buffer.from(
      'READY model=bge-reranker-v2-m3 max_length=256 input_names=input_ids,attention_mask post_processor=TemplateProcessing\n'
    )), 5);
    const p = sub.score('q', ['d']).catch(() => {});
    await new Promise(r => setTimeout(r, 20));
    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(args[1]).toMatch(/models\/bge-reranker-v2-m3/);
    expect(args[2]).toBe('256');
    sub.shutdown();
    await p;
  });

  it('separate subprocesses for different (modelId, maxLength)', () => {
    const { proc: p1 } = makeProc();
    const { proc: p2 } = makeProc();
    vi.mocked(spawn).mockReturnValueOnce(p1).mockReturnValueOnce(p2);
    const a = getRerankSubprocess('bge-reranker-v2-m3', 512);
    const b = getRerankSubprocess('bge-reranker-v2-m3', 256);
    expect(a).not.toBe(b);
  });

  it('reuses subprocess for same (modelId, maxLength)', () => {
    const a = getRerankSubprocess('bge-reranker-v2-m3', 512);
    const b = getRerankSubprocess('bge-reranker-v2-m3', 512);
    expect(a).toBe(b);
  });

  it('resetAllRerankSubprocesses clears registry', () => {
    const a = getRerankSubprocess('bge-reranker-v2-m3', 512);
    resetAllRerankSubprocesses();
    const b = getRerankSubprocess('bge-reranker-v2-m3', 512);
    expect(a).not.toBe(b);
  });

  it('error response rejects with message', async () => {
    const { proc, stderr, stdout, stdin } = makeProc();
    vi.mocked(spawn).mockReturnValue(proc);
    const sub = getRerankSubprocess('bge-reranker-v2-m3', 512);
    setTimeout(() => stderr.emit('data', Buffer.from(
      'READY model=bge-reranker-v2-m3 max_length=512 input_names=input_ids,attention_mask post_processor=TemplateProcessing\n'
    )), 5);
    const writes: string[] = [];
    stdin.on('data', (chunk) => writes.push(chunk.toString()));
    const p = sub.score('q', ['d']);
    await new Promise(r => setTimeout(r, 20));
    const sent = JSON.parse(writes.join('').trim());
    stdout.emit('data', Buffer.from(JSON.stringify({ id: sent.id, error: 'model crashed' }) + '\n'));
    await expect(p).rejects.toThrow(/model crashed/);
  });

  it('reranker has killOnRequestTimeout=true', async () => {
    const { proc, stderr } = makeProc();
    vi.mocked(spawn).mockReturnValue(proc);
    const sub = getRerankSubprocess('bge-reranker-v2-m3', 512);
    (sub.worker as unknown as { requestTimeoutMs: number }).requestTimeoutMs = 30;
    setTimeout(() => stderr.emit('data', Buffer.from(
      'READY model=bge-reranker-v2-m3 max_length=512 input_names=input_ids,attention_mask post_processor=TemplateProcessing\n'
    )), 5);
    await expect(sub.score('q', ['d'])).rejects.toThrow(/timed out/i);
    expect((proc as any).kill).toHaveBeenCalled();
  });
});
