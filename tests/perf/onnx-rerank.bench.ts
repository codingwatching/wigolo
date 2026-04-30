import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { onnxRerank, _resetOnnxSessionCache } from '../../src/search/reranker/onnx.js';
import { resolveModelId } from '../../src/search/reranker/models.js';

// The 600ms p95 SLA for top-30 rerank is only achievable on CPU with the
// lightweight MiniLM model at a tightened max sequence length. The larger
// bge-reranker-v2-m3 (568M params, multilingual) is offered as the higher
// accuracy "deep" tier and accepts higher latency. Override either via env.
const modelId = resolveModelId(process.env.WIGOLO_RERANKER_MODEL ?? 'ms-marco-MiniLM-L-12-v2');
const maxLength = Number(process.env.WIGOLO_RERANKER_MAX_LENGTH ?? '128');
const modelPath = join(
  process.env.WIGOLO_DATA_DIR ?? join(homedir(), '.wigolo'),
  'models',
  modelId,
  'model_quantized.onnx',
);
const skip = !existsSync(modelPath) && !process.env.WIGOLO_PERF_TEST;

describe.skipIf(skip)('onnx rerank perf', () => {
  it('top-30 rerank p95 < 600ms', async () => {
    _resetOnnxSessionCache();
    const docs = Array.from({ length: 30 }, (_, i) => ({
      text: `doc ${i} about pgEdge multi-master replication and conflict resolution`,
    }));
    // Warmup
    await onnxRerank('pgEdge multi-master', docs, { modelId, maxLength });
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = Date.now();
      await onnxRerank('pgEdge multi-master', docs, { modelId, maxLength });
      samples.push(Date.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    process.stderr.write(`onnx rerank p95: ${p95} ms (samples: ${samples.join(', ')})\n`);
    expect(p95).toBeLessThan(600);
  }, 120000);
});
