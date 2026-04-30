import { join } from 'node:path';
import { getConfig } from '../../config.js';
import { getModel, resolveModelId } from './models.js';

export type TokenizerPair = {
  input_ids: BigInt64Array;
  attention_mask: BigInt64Array;
  token_type_ids: BigInt64Array;
  length: number;
};

type EncodeOpts = {
  text_pair: string;
  max_length: number;
  truncation: true;
  padding: 'max_length';
  return_tensor?: true;
};

type EncodedTensor = { data: BigInt64Array; dims: number[] };

type EncodedBatch = {
  input_ids: EncodedTensor;
  attention_mask: EncodedTensor;
  token_type_ids?: EncodedTensor;
};

// PreTrainedTokenizer is callable. We accept either invocation form so unit
// tests can stub a plain `encode` while the real Xenova tokenizer is invoked
// directly as a function.
type EncoderTokenizer =
  | ((q: string, opts: EncodeOpts) => EncodedBatch)
  | { encode: (q: string, opts: EncodeOpts) => EncodedBatch };

let xenovaModule: typeof import('@xenova/transformers') | null = null;
async function loadXenova() {
  if (!xenovaModule) xenovaModule = await import('@xenova/transformers');
  return xenovaModule;
}

const tokenizerCache = new Map<string, unknown>();

export async function loadTokenizer(modelId: string, dataDir?: string): Promise<unknown> {
  const id = resolveModelId(modelId);
  const cached = tokenizerCache.get(id);
  if (cached) return cached;
  getModel(id);
  const dir = dataDir ?? getConfig().dataDir;
  const xenova = await loadXenova();
  xenova.env.allowLocalModels = true;
  xenova.env.allowRemoteModels = false;
  xenova.env.localModelPath = join(dir, 'models');
  const tokenizer = await xenova.AutoTokenizer.from_pretrained(id, { local_files_only: true });
  tokenizerCache.set(id, tokenizer);
  return tokenizer;
}

export function tokenizePair(
  tokenizer: EncoderTokenizer,
  query: string,
  doc: string,
  maxLength = 512,
): TokenizerPair {
  const opts: EncodeOpts = {
    text_pair: doc,
    max_length: maxLength,
    truncation: true,
    padding: 'max_length',
    return_tensor: true,
  };
  const enc =
    typeof tokenizer === 'function'
      ? tokenizer(query, opts)
      : tokenizer.encode(query, opts);
  const length = enc.input_ids.dims[1];
  const tokenTypeIds = enc.token_type_ids?.data ?? new BigInt64Array(length);
  return {
    input_ids: enc.input_ids.data,
    attention_mask: enc.attention_mask.data,
    token_type_ids: tokenTypeIds,
    length,
  };
}

export function _resetTokenizerCache(): void {
  tokenizerCache.clear();
}
