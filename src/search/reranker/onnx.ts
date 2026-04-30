import * as ort from 'onnxruntime-node';
import { downloadModelAssets } from './download.js';
import { loadTokenizer, tokenizePair } from './tokenizer.js';
import { getConfig } from '../../config.js';
import { createLogger } from '../../logger.js';
import { resolveModelId } from './models.js';

const log = createLogger('reranker');

export interface RerankDoc {
  text: string;
}
export interface RerankScore {
  index: number;
  score: number;
}

const sessionCache = new Map<string, Promise<ort.InferenceSession>>();

export function _resetOnnxSessionCache(): void {
  sessionCache.clear();
}

async function getSession(modelId: string, modelPath: string): Promise<ort.InferenceSession> {
  const id = resolveModelId(modelId);
  const existing = sessionCache.get(id);
  if (existing) return existing;
  const p = (async () => {
    log.debug('creating ONNX session', { id, modelPath });
    return ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    });
  })();
  sessionCache.set(id, p);
  try {
    return await p;
  } catch (err) {
    sessionCache.delete(id);
    throw err;
  }
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export async function onnxRerank(
  query: string,
  docs: RerankDoc[],
  opts: { modelId?: string; maxLength?: number } = {},
): Promise<RerankScore[]> {
  if (docs.length === 0) return [];
  const cfg = getConfig();
  const modelId = opts.modelId ?? cfg.rerankerModel ?? 'bge-reranker-v2-m3';
  const maxLength = opts.maxLength ?? 512;

  // Order matters: download assets first (so tokenizer.json is on disk), then
  // load the tokenizer via @xenova/transformers (which bundles its own ORT
  // build and initializes shared native state on import), and only then
  // create the onnxruntime-node session. Creating the ORT session before the
  // xenova import overwrites our env handle and the next session.run()
  // segfaults (SIGBUS) on macOS.
  const { modelPath } = await downloadModelAssets(modelId, cfg.dataDir);
  const tokenizer = await loadTokenizer(modelId, cfg.dataDir);
  const session = await getSession(modelId, modelPath);

  const scores: RerankScore[] = [];
  for (let i = 0; i < docs.length; i++) {
    const { input_ids, attention_mask, token_type_ids, length } = tokenizePair(
      tokenizer as Parameters<typeof tokenizePair>[0],
      query,
      docs[i].text,
      maxLength,
    );
    const dims = [1, length];
    const feeds: Record<string, ort.Tensor> = {
      input_ids: new ort.Tensor('int64', input_ids, dims),
      attention_mask: new ort.Tensor('int64', attention_mask, dims),
    };
    if (session.inputNames.includes('token_type_ids')) {
      feeds.token_type_ids = new ort.Tensor('int64', token_type_ids, dims);
    }
    const out = await session.run(feeds);
    const logitsName = session.outputNames[0];
    const logit = (out[logitsName].data as Float32Array)[0];
    scores.push({ index: i, score: sigmoid(logit) });
  }

  scores.sort((a, b) => b.score - a.score);
  return scores;
}
