# wigolo

Local-first web intelligence MCP server. 8 tools: `search`, `fetch`, `crawl`, `cache`, `extract`, `find_similar`, `research`, `agent`. Runs on Node 20+. No API keys required for the core path.

> **Status:** `v0.1.15+` — the **core direct-engine retrieval path is now the default** (`WIGOLO_SEARCH=core`). Legacy SearXNG and the new `hybrid` (core + smart fallback) modes are opt-in. Full v1.0 will land after the post-overhaul cross-tool bench rerun.

## Install

```bash
npx @staticn0va/wigolo init
```

The init flow runs a system check, downloads the embedding + reranker models, bootstraps the legacy search engine (used by `WIGOLO_SEARCH=searxng` / `hybrid`), detects installed AI coding agents (Claude Code, Cursor, Gemini CLI, Codex, Windsurf, Zed, OpenCode), and writes MCP config + skill docs for each one.

Or wire it yourself in any MCP client:

```json
{
  "mcpServers": {
    "wigolo": {
      "command": "npx",
      "args": ["-y", "@staticn0va/wigolo"]
    }
  }
}
```

Global install for repeated CLI use:

```bash
npm i -g @staticn0va/wigolo
wigolo --help
```

## CLI

| Command | What it does |
|---|---|
| `wigolo` (no args) | Boot MCP server on stdio (used by MCP clients) |
| `wigolo init` | Interactive onboarding (browser pick, agent detect, MCP config) |
| `wigolo warmup [--all] [--embeddings] [--reranker]` | Pre-fetch models + bootstrap SearXNG |
| `wigolo doctor` | Diagnostic: Python, browsers, models, SearXNG, RSS feeds, telemetry |
| `wigolo health` | Quick OK/degraded exit code |
| `wigolo serve [--port N]` | Run as HTTP daemon |
| `wigolo shell` | Interactive REPL against the 8 tools |
| `wigolo backfill [--dry-run] [--limit N]` | Embed cached pages missing vectors |
| `wigolo setup mcp` | Wire MCP config into installed agents |
| `wigolo status` | Show running daemon status |
| `wigolo plugin <subcommand>` | Manage plugins |
| `wigolo uninstall` | Remove wigolo install |
| `wigolo --help` / `wigolo --version` | Help + version |

## The 8 MCP tools

| Tool | Use when |
|---|---|
| `search` | Need info on a topic, no URL yet. Pass query string or array of 3-5 keyword variants for breadth. |
| `fetch` | Have a specific URL. Returns clean markdown + metadata. JS rendering auto-detected. |
| `crawl` | Need many pages from one site. Strategies: `bfs`, `dfs`, `sitemap`, `map`. |
| `cache` | Check the local store before going to the network. FTS5 + optional vec hybrid. |
| `extract` | Specific data points (tables, metadata, schema-shaped fields). Modes: `selector`, `tables`, `metadata`, `schema`, `structured`. |
| `find_similar` | "More like this" given a URL or concept. Hybrid FTS + embeddings + web expansion. |
| `research` | Multi-step investigation: decomposition → parallel search → synthesis with citations. |
| `agent` | Natural-language data gathering across multiple sources with optional JSON schema. |

Each tool surfaces a per-session instruction block (~2 KB) plus a `wigolo://docs/usage` resource with the full routing guide.

## Search backend

Three retrieval modes; default is `core`:

```bash
WIGOLO_SEARCH=core       # default — direct engines + RRF + ML rerank
WIGOLO_SEARCH=searxng    # opt-in — legacy SearXNG aggregator (long-tail recall, slower cold start)
WIGOLO_SEARCH=hybrid     # opt-in — runs core; falls back to searxng + RRF-merge on signal
```

The `core` engine ships:
- Direct engines per vertical — general (HN Algolia, lobste.rs, DuckDuckGo, Bing, Startpage), news (HN Algolia, lobste.rs, Bing News), code (GitHub Code, StackOverflow), docs (MDN, DevDocs), papers (arXiv, Semantic Scholar)
- Intent router + weighted RRF orchestrator
- Date-range intent classifier + recency boost
- Brand-collision-aware ranker + post-search disambiguation warning
- Per-result `evidence_score` breakdown (relevance + domain quality + lexical alignment + freshness)
- `freshness_signal` extracted from page or inferred from URL/HTML patterns
- `query_understanding` classifier view of intent / entities / rewrites
- Always-emitted `engines_used` + `engine_telemetry` (per-engine latency, result count, outcome, dedup_kept)
- `search_depth` tiers (`ultra-fast` / `fast` / `balanced` / `deep`)
- Tavily-canonical parameters: `exact_match`, `time_range`, `exclude_domains`, `include_images`, `country`, `include_favicon`, `response_time_ms`
- Opt-in RSS feed engine (`WIGOLO_RSS_FEEDS=url1,url2`)
- `agent_context.recent_urls` dedup with case-insensitive path matching for IIS / archive.org / Microsoft docs

`hybrid` re-runs the query through SearXNG and RRF-merges when any of these signals fire: `brand_collision_suspect`, `include_domains_over_filter`, `all_engines_failed`, `top1_high_score_low_overlap`. The merged response carries `fallback_signal`.

`v1` is accepted as a deprecated alias for `core` for one release and emits a stderr warning.

## Local stack

- **Search aggregator (legacy path):** SearXNG — bootstrapped to `~/.wigolo/searxng/` on first run (native venv preferred, Docker fallback)
- **Browser:** Playwright Chromium / Firefox / WebKit; Lightpanda available as a fast JS-renderer alternative
- **Content extraction:** Defuddle with content-type routing for news / recipe / product / paper / event JSON-LD, plus a Mozilla Readability fallback
- **Embeddings:** `fastembed` running ONNX `BGE-small-en-v1.5` (384-dim) — cached under `~/.wigolo/fastembed/`
- **Reranker:** `@huggingface/transformers` cross-encoder `Xenova/ms-marco-MiniLM-L-6-v2` — cached under `~/.wigolo/transformers/`
- **Cache:** SQLite WAL + FTS5; optional vector hybrid via `sqlite-vec` when the extension is loadable on your platform
- **Process model:** stdio MCP server by default; HTTP daemon (`wigolo serve`) and REPL (`wigolo shell`) also available

## LLM extraction fallback (optional)

`extract` with `mode: "schema"` falls back to an LLM when heuristics miss. Set one of:

```bash
export ANTHROPIC_API_KEY=...
export OPENAI_API_KEY=...
export GOOGLE_API_KEY=...
export GROQ_API_KEY=...
# optional: pin which provider
export WIGOLO_LLM_PROVIDER=anthropic|openai|gemini|groq
```

If no key is set the fallback is skipped — `extract` still works through the heuristic path. Calls are cached (default 7 days) and rate-limited per request.

## Local LLM fallback (research synthesis)

Set `WIGOLO_LLM_PROVIDER=openai-compatible` plus `WIGOLO_LLM_ENDPOINT=http://localhost:11434/v1` to let `research` use a local model (e.g. Ollama) when the host MCP client doesn't support sampling.

## Config flags worth knowing

| Env var | Default | What it does |
|---|---|---|
| `WIGOLO_SEARCH` | `core` | Backend selector. `core` = direct-engine path (default). `searxng` = legacy aggregator (opt-in). `hybrid` = core with smart auto-fallback on signal. `v1` is a deprecated alias for `core`. |
| `WIGOLO_RSS_FEEDS` | unset | Comma-separated feed URLs; core news vertical picks them up |
| `WIGOLO_DEDUP_CASE_INSENSITIVE_HOSTS` | unset | Comma-separated hostnames where `/A` == `/a` for dedup |
| `WIGOLO_CRAWL_INDEX` | `0` | `1` to fire-and-forget upsert crawled pages into the vector store |
| `WIGOLO_EAGER_WARMUP` | `0` | `1` warms embed + rerank at MCP server start (non-blocking) |
| `WIGOLO_FIND_SIMILAR_COLD_START_THRESHOLD` | `0.3` | Minimum fused score before `find_similar` emits a `cold_start` notice. Set `0` to disable. |
| `WIGOLO_TELEMETRY` | `0` | `1` enables opt-in NDJSON telemetry; off by default |
| `WIGOLO_DATA_DIR` | `~/.wigolo` | Override data dir for cache, models, SearXNG state |
| `WIGOLO_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `WIGOLO_LOG_FORMAT` | `json` | `json` or `text`; both write to stderr |

## What's known to work

- 8 MCP tools, full test suite passing (4000+ unit + integration tests on macOS arm64)
- `init` flow on macOS for Claude Code, Cursor, Gemini CLI, Codex, Windsurf, Zed, OpenCode
- `WIGOLO_SEARCH=core` runs end-to-end as the default backend: direct engines, RRF, ML rerank, brand-collision ranker, `evidence_score`, `freshness_signal`, `query_understanding`, `engine_telemetry`
- `WIGOLO_SEARCH=hybrid` smart-fallback (signals: brand-collision, over-filter, all-engines-failed, low-overlap)
- `search_depth` tiers (`ultra-fast` / `fast` / `balanced` / `deep`)
- Tavily-canonical parameters: `exact_match`, `time_range`, `exclude_domains`, `include_images`, `country`, `include_favicon`, `response_time_ms`
- SQLite + sqlite-vec hybrid on macOS arm64; FTS5-only graceful degradation on alpine/musl (sqlite-vec extension absent)
- Content extraction with content-type routing (news/recipe/product/paper/event JSON-LD)
- Conditional GET with true 304 short-circuit through SmartRouter (saves bandwidth on revisits)
- Doctor + warmup + backfill CLIs
- Opt-in eager warmup, telemetry, RSS feeds

## What's still gated / not done

- **Post-overhaul bench rerun** — the search-default overhaul (Phases 0-4) is done in `main`. The 5-way blind bench (wigolo-core vs wigolo-searxng vs Tavily vs Exa vs Firecrawl) needs to be re-run on the post-overhaul SHA. Aggregate target is ≥ 280 / 350 (pre-overhaul: 223). See `docs/superpowers/plans/OVERHAUL_PROGRESS.md`.
- **v1.0 release** — pinned to the post-overhaul bench-gated quality pass.
- **TUI install polish** — Phase 5 will pick up the three non-blocker items from the install audit.
- **Bench numbers** — Phase 6/7/8/11/12/13/15 perf + extraction benches are scaffolded but their numbers haven't been captured to `benchmarks/*/output/`.

## Architecture in one glance

```
src/
  index.ts          CLI router
  server.ts         MCP server (8 tools + 1 resource)
  config.ts         52+ env vars
  cli/              warmup, doctor, health, auth, plugin, shell, init, status, backfill, setup-mcp
  tools/            thin MCP handlers (one per tool, delegate to domain)
  fetch/            SmartRouter (HTTP-first → Playwright), browser pool, auth, Lightpanda
  extraction/       Defuddle + content-type routing + named schemas + LLM fallback
  search/           orchestration shared between backends — dedup, rerank, RRF, multi-query, answer synth
  search/core/      default backend — intent router + verticals + orchestrator + RSS + recency + context-rank + brand-collision ranker + freshness signal + evidence score
  search/legacy/    legacy SearXNG aggregator path (opt-in via WIGOLO_SEARCH=searxng)
  search/hybrid/    core-first with smart fallback to searxng on signal (opt-in via WIGOLO_SEARCH=hybrid)
  crawl/            BFS/DFS/sitemap/map + robots.txt + ETag-incremental
  cache/            SQLite FTS5 + sqlite-vec hybrid + migrations + backfill
  embedding/        fastembed (BGE-small-en-v1.5)
  research/         decomposition → parallel search → synthesis + citation graph
  agent/            plan → execute → synthesize
  searxng/          process + Docker management + bootstrap retry
  providers/        embed, rerank, extract, vector-store, search interfaces
```

## Common pitfalls

- **First run is slow** — model downloads (~250 MB combined) + search-engine bootstrap on `searxng`/`hybrid` modes (~30 s). `wigolo warmup --all` upfront avoids it during first MCP request.
- **`wigolo doctor` shows `ML reranker: not installed`** — run `wigolo warmup --reranker` to fetch the cross-encoder model (~22 MB).
- **`category: 'images'` on `core`** — core has no images vertical (yet). Use `WIGOLO_SEARCH=searxng` or omit `category`. `include_images: true` aggregates per-result image hints from engines that surface them.
- **`sqlite-vec extension failed to load`** — your platform (alpine/musl) doesn't have prebuilt binaries. The cache still works via FTS5; vector search is disabled.

## Development

```bash
git clone https://github.com/KnockOutEZ/wigolo
cd wigolo
npm install
npm run build         # tsup → dist/, then tsc → dist/*.d.ts
npm test              # full vitest suite
npm run lint          # tsc --noEmit
npm run dev           # tsx src/index.ts
```

## License

BUSL-1.1 — see `LICENSE`.
