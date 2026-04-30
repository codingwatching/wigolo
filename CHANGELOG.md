# Changelog

## Unreleased — v1 prep

### BREAKING: reranker rewritten to in-process ONNX
- The `WIGOLO_RERANKER=flashrank` value is retired and now throws on startup.
  Default is `onnx`. The Python `flashrank` package is no longer used and may
  be uninstalled.
- Migration: unset `WIGOLO_RERANKER` (the new default `onnx` is correct), or
  set `WIGOLO_RERANKER=onnx` explicitly. Run `wigolo warmup --reranker` to
  download the model on first run; it caches under `~/.wigolo/models/`.
- Default model: `BAAI/bge-reranker-v2-m3` (ONNX quantized) for accuracy. For
  low-RAM machines or a tighter latency budget: `WIGOLO_RERANKER_MODEL=minilm-l12`.
- Recency-aware scoring: queries containing recency tokens
  (`recent|latest|new|just released|today|this week`) or a year ≥ current year
  apply a date-boost factor (1.5× / 1.3× / 1.1× for <7d / <30d / <90d).
- Model assets are SHA-256 verified against a manifest; corrupt files are
  re-downloaded automatically.
- Removed: `src/search/flashrank.ts` and the Python `flashrank` subprocess
  code path.

### BREAKING: search.format renamed
- Removed: `format: 'full' | 'context' | 'highlights'`. Default output is now the evidence shape.
- Retained: `format: 'answer' | 'stream_answer'` (LLM-synthesis modes).
- Migration:
  ```diff
  - search({ query, format: 'highlights' })
  + search({ query })  // returns evidence by default
  - search({ query, format: 'full' })
  + search({ query, include_full_markdown: true })
  ```

### NEW: max_tokens_out
- Token-budget cap on total output. cl100k-base BPE; non-OpenAI counts may drift ~5-15%.
- When both `max_tokens_out` and `max_chars` are set, `max_tokens_out` wins.

### NEW: include_full_markdown
- Multi-result tools default to evidence-only (no full markdown body) — set `include_full_markdown: true` to restore.

### NEW: citation_format
- `'numbered'` (default) | `'json'` | `'anthropic_tags'`.
