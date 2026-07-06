---
name: wigolo-find-similar
description: |
  Hybrid semantic discovery — fuses embeddings + keyword (FTS5) + live web search via 3-way Reciprocal Rank Fusion. Use when the user has a good source and wants more like it, says "find similar", "related pages", "more like this", or wants to discover content related to a known URL or concept. Works best after a `crawl` or several `fetch` calls have warmed the local cache. Emits `cold_start` when local signals are weak.
---

# wigolo find_similar

Hybrid semantic discovery: semantic embeddings + keyword search + web search, fused via Reciprocal Rank Fusion (RRF).

## Quick Reference

```json
// Find pages similar to a URL
{ "url": "https://docs.astro.build/en/getting-started/" }

// Find pages related to a concept
{ "concept": "JavaScript framework server-side rendering" }

// Scoped to specific domains
{ "url": "https://react.dev/reference/react/use", "include_domains": ["vuejs.org", "svelte.dev"] }

// Cache-only (no web fallback)
{ "url": "https://example.com/page", "include_web": false }
```

## Parameters

| Parameter | Type | Default | When to use |
|-----------|------|---------|-------------|
| `url` | string | — | Find pages similar to this URL's content |
| `concept` | string | — | Find pages related to a text concept (no URL needed) |
| `max_results` | number | 10 | Cap at 50 |
| `include_domains` | string[] | none | Scope results to specific sites |
| `exclude_domains` | string[] | none | Filter out domains |
| `include_cache` | boolean | true | Search local cache (fast, free) |
| `include_web` | boolean | true | Web fallback when cache is sparse |
| `threshold` | number | 0.5 | Minimum fused score (0-1) |
| `max_tokens_out` | number | none | Token-budget cap (cl100k-base) |
| `include_full_markdown` | boolean | false | Restore full body alongside evidence |
| `citation_format` | string | "numbered" | "numbered" / "json" / "anthropic_tags" |

Provide either `url` or `concept` (not both).

## How It Works

1. Embeds the input (URL content or concept text) into a vector.
2. Searches local cache via embedding similarity + keyword matching.
3. Falls back to web search if local hits are sparse.
4. Fuses all signals via 3-way Reciprocal Rank Fusion (RRF).
5. Returns ranked results with `match_signals` (`embedding_rank`, `fts5_rank`, `fused_score`).

## Cold-Start Signal

When the fused score from local signals is below threshold (env `WIGOLO_FIND_SIMILAR_COLD_START_THRESHOLD`), the response includes a `cold_start` string explaining why results came from web search. Pass it verbatim to the user.

## Important: Build the Cache First

find_similar works best with a warm cache. Recommended workflow:

```json
// Step 1: crawl to populate cache with embeddings
{ "url": "https://docs.framework.dev", "strategy": "sitemap", "max_pages": 20 }

// Step 2: now find_similar has real semantic signal
{ "url": "https://docs.framework.dev/getting-started" }
```

## Anti-Patterns

- DON'T use find_similar on a fresh install expecting embedding results — crawl first.
- DON'T provide both `url` and `concept` — pick one.
- DON'T use when you want web-only results — use `search` instead.

## When NOT to use wigolo-find-similar

- **No local cache and no plan to build one** — fall back to `search` with `include_domains`.

## See Also

- [wigolo-crawl](../wigolo-crawl/SKILL.md) — build the cache first
- [wigolo-search](../wigolo-search/SKILL.md) — when you want web results, not cache similarity
