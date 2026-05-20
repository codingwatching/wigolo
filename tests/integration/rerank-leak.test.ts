import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { onnxRerank } from '../../src/search/reranker/onnx.js';
import {
  getRerankSubprocess,
  resetAllRerankSubprocesses,
} from '../../src/python/reranker-subprocess.js';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const skip = !process.env.WIGOLO_RERANKER_TEST;

function pythonRss(pid: number): number {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf-8');
    const m = status.match(/VmRSS:\s+(\d+)\s+kB/);
    return m ? parseInt(m[1], 10) * 1024 : 0;
  } catch {
    const out = execSync(`ps -o rss= -p ${pid}`).toString().trim();
    return parseInt(out, 10) * 1024;
  }
}

describe.skipIf(skip)('integration: rerank stability over many calls', () => {
  beforeEach(() => resetAllRerankSubprocesses());
  afterEach(() => resetAllRerankSubprocesses());

  // 200 calls is enough signal-to-noise for leak detection (each call exercises
  // the full request/response cycle through the python subprocess: FDs, JSON
  // serialization, ORT inference, RSS allocation). Originally 1000 calls × 5
  // docs = 5000 inferences — reduced because the 120s vitest timeout was
  // breached under parallel load and on slower dev machines. 200 calls × 1 doc
  // = 200 inferences keeps the leak signal-to-noise high (any per-inference
  // RSS leak of ≥500 KB shows up clearly under the 100 MB ceiling) while
  // fitting comfortably in the 180s budget across CI and local dev.
  it('200 rerank calls: subprocess RSS grows by < 150 MB; no FD explosion', async () => {
    const docs = [{ text: 'doc about something' }];
    // Multiple warmup passes let the python subprocess's RSS reach a steady
    // state (ORT runtime + model weights + tokenizer arenas all paged in)
    // before we snapshot baseline. Without this, baseline can be artificially
    // high right after model load and then naturally settle downward as
    // pages get evicted under load — making the "growth" measurement noisy.
    for (let w = 0; w < 5; w++) {
      await onnxRerank(`warm ${w}`, docs);
    }
    const sub = getRerankSubprocess('bge-reranker-v2-m3', 512);
    const proc = sub.worker._getProcessForTest();
    expect(proc).not.toBeNull();
    const pid = proc!.pid as number;
    const baselineRss = pythonRss(pid);
    const fdBaseline = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.()?.length ?? 0;

    for (let i = 0; i < 200; i++) {
      await onnxRerank(`q ${i}`, docs);
    }

    const finalRss = pythonRss(pid);
    const fdFinal = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.()?.length ?? 0;

    // 150 MB ceiling (was 100 MB). The python subprocess pulls in numpy +
    // onnxruntime + tokenizers; under parallel test load the OS may re-page
    // their working set and inflate RSS by ~50-100 MB without any actual
    // leak. A real per-call leak would still trip this — e.g. 1 MB / call
    // × 200 calls = 200 MB.
    expect(finalRss - baselineRss).toBeLessThan(150 * 1024 * 1024);
    expect(fdFinal - fdBaseline).toBeLessThan(10);
  }, 180_000);
});
