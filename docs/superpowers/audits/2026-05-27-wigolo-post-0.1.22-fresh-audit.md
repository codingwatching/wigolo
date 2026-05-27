# Wigolo Fresh Audit — Post-0.1.22 Release

**Date:** 2026-05-27
**Tested version:** `@staticn0va/wigolo@0.1.22` (commit `413c1f0` on `origin/main`)
**Audit type:** Blind fresh-session test against the running binary, every tool surface.
**Total flaws:** 30 (9 CRITICAL + 9 HIGH + 6 MEDIUM + 6 LOW).
**Status:** Captured for future fix-cycle. No fixes started.

---

## Context — How this audit relates to v0.1.22

The 0.1.22 release closed the bulk of the 2026-05-26 audit (cc-test-report.md, 5.4/10 → 7.4 static-evidence). This fresh test is the *first blind run against the actual binary post-release*. The results:

- ~6 entirely NEW bugs not in the first audit.
- ~3 INCOMPLETE fixes from v0.1.22 where the slice landed but didn't close the failure mode fully (M4 link-strip, M13 relevance_score, M14-class URL handling).
- Strengths from v0.1.22 confirmed working (cache, SSRF, exact_match, evidence_score telemetry, find_similar cold_start, watch idempotency, extract schema).

The static-evidence 7.4 was honest within its rubric; this fresh test shows the binary still has trust-killing failure modes the static test couldn't catch.

---

## The 4 most-damaging (called out by the tester)

These silently corrupt downstream agent reasoning. Fix priority.

1. **#1 — `fetch` cached an empty SPA shell** (react.dev/reference/react/useState).
2. **#3 — `agent` + `extract` ignore `max_tokens_out`** (102k char extract, ~15k token agent).
3. **#5 — Spam pages return `relevance_score: 1.0` with `lexical_alignment: 0`** (no low-confidence signal).
4. **#8 — `agent` schema silently ignored** when `sampling_supported: false`. No `schema_ignored: true` envelope.

---

## CRITICAL (correctness / silent-bad-output)

| # | Title | Failure mode | Status vs v0.1.22 | Likely module |
|---|-------|--------------|-------------------|----------------|
| 1 | SPA empty-cache poisoning | `fetch` of react.dev SPA returned `markdown: ""`, `cached: true`, `http_status: 200`. Subsequent calls hit cache in 2ms with no signal content is missing. `section_matched: false` masks it. | NEW (inverse of S5 SPA-shell tighten — false-negative class) | `src/fetch/router.ts` + `src/cache/store.ts` |
| 2 | Static page via Playwright | `fetch` of `example.com` ran 8.2s via `fetch_method: 'playwright'`. Should be HTTP-first. | NEW. Force-refresh or first-visit branch ignores HTTP-first | `src/fetch/router.ts` |
| 3 | `max_tokens_out` bypassed by `agent` + `extract` | `max_tokens_out: 3000` produced 61,115 chars (~15k tokens) from agent. `extract schema` blew through 102k chars on Article. Tool result errored out of MCP transport. | INCOMPLETE — S2 H3 capped specific defaults (`cache.query=5`, `agent.max_pages=3`, `extract tables=30000`) but `max_tokens_out` is a separate per-call param never enforced as a hard global gate | `src/tools/agent.ts`, `src/tools/extract.ts`, `src/agent/pipeline.ts` |
| 4 | Wikipedia paren URL mangling | `Layers_(digital_image_editing)` → `Layers_/(digital_image_editing/` in `links[]`. Post-processor escapes parens as path separators. | NEW URL post-processor bug | `src/extraction/links.ts` or URL canonicalization |
| 5 | Spam → `relevance_score: 1.0` | "nonexistent xyzqqq789 string nobody searches" → 3 Toppr puzzle pages with `relevance_score: 1.0`, `lex=0.0`. No "no real match" signal. | INCOMPLETE — S8 M13 documented `relevance_score` vs `evidence_score.final` coexistence but didn't fix the within-result-set normalization that always tops at 1.0 | `src/search/core/core-provider.ts` (response builder) |
| 6 | `research` `key_findings` leak markdown link fragments | Entries like `"](/blog/2026/05/...post-title)"` and `"](/@unicodeveloper?source=post_page--..."` in findings. | INCOMPLETE — S8 M4 added `stripMarkdownLinks` but missed trailing fragments of broken links across mid-finding boundaries. Test coverage too narrow | `src/research/brief.ts` |
| 7 | `research` sub-query decomposition broken | `sub_queries: ["What is the difference between Tavily, Exa, and Firecrawl search APIs?", "What is the difference between Tavily, Exa"]` — duplicate + truncated. | NEW | `src/research/decompose.ts` |
| 8 | `agent` schema silently ignored | JSON Schema for `{name, input_price_per_1m, output_price_per_1m}[]` returned markdown bullets. `sampling_supported: false` fallback to keyword synthesis. No `schema_ignored: true`. | NEW. S4 schema-truth covered `extract` but not `agent` fallback path | `src/agent/pipeline.ts` synthesis stage |
| 9 | `extract structured` key_value_pairs are noise | On PDF Wikipedia: `{"key": "CS1", "value": "unfit URL"}`, `{"key": "Adobe PDF 101", "value": "Summary of PDF at Wayback Machine..."}` — text-pattern false positives. `source: "text-pattern"` is honest but unusable. | NEW | `src/extraction/structured.ts` (KV extractor) |

---

## HIGH (UX / API design)

| # | Title | Failure mode | Likely module |
|---|-------|--------------|----------------|
| 10 | `watch.delete` misleading response | Returns `{job, jobs:[job]}` with deleted job's full record showing `status: "active"`. Should return `{deleted: true, job_id}`. | `src/tools/watch.ts` |
| 11 | `watch` single-action shape inconsistent | `create` returns `{job, jobs:[job]}`; `pause`/`resume` return `{jobs}` only; `check` returns `{jobs, changes_since_last}`. Doc claims uniform single-URL shape — pause/resume drop singular. | `src/tools/watch.ts` |
| 12 | `category: "papers"` blocks 14.5s on arxiv | semantic-scholar 429s, no concurrent fallback. arxiv single-engine drag dominates. | `src/search/core/verticals/papers.ts` |
| 13 | `include_domains` doesn't tighten lexical alignment | React.dev domain-scoped query — top hit is `react.dev/` homepage with `lex=0.33`, not the relevant `react.dev/reference/react/useState`. | `src/search/core/orchestrator.ts` lexical scoring |
| 14 | `brand_collision_warning` never fires | Tested "delta airlines" (delta = math/river/dental), "claude", "react". None triggered. Threshold too low or check too shallow. | `src/search/core/brand-collision.ts` |
| 15 | `time_range: "week"` returned 2024 blog as top hit | Documented as "drops only confidently-extracted dates" but undated content still ranks above dated. Should down-rank undated when freshness filter is on. | `src/search/core/freshness.ts` |
| 16 | `cache.since` returns full markdown bodies | 24 entries pulled 119k chars over MCP. No `summary_only` / `include_markdown=false` knob. Unusable in-loop. | `src/tools/cache.ts` |
| 17 | Marginalia engine breaker visible to caller | Every search shows `"error: breaker open for engine marginalia"`. Breaker doesn't recover after minutes. | `src/search/core/engines/marginalia.ts` + engine-base breaker logic |
| 18 | `format: "answer"` may hallucinate | "Monad" answer included "a fail function for error handling" — `fail` is pre-AMP Haskell, presented as current. Citations don't specifically mention `fail`. Synthesis not strict about staying inside source spans. | `src/search/synthesis/answer.ts` |

---

## MEDIUM (latency / minor bugs)

| # | Title | Failure mode | Likely module |
|---|-------|--------------|----------------|
| 19 | 404 takes 6.7s | `httpbin.org/status/404` should short-circuit on 4xx. | `src/fetch/router.ts` |
| 20 | `force_refresh` not visibly distinguished | No `cache_bypassed: true` field — must infer from `cached: false`. | `src/tools/fetch.ts` envelope |
| 21 | `crawl strategy: "map"` picks wrong sitemap entry point | On `docs.python.org/3/library/asyncio.html` returned only version landings (/3.10 … /3.16), not asyncio subpages. | `src/crawl/strategies/map.ts` |
| 22 | citation_graph 0-based vs report citations 1-based | Cross-mapping requires `-1` math. Undocumented. | `src/research/brief.ts` (incomplete from S8 M5) |
| 23 | `find_similar.markdown` always empty without flag | Field appears in response with `""` instead of being omitted — wastes tokens. | `src/search/find-similar.ts` |
| 24 | `engine_telemetry.dedup_kept` doesn't sum to `results.length` for multi-query | Hard to audit which engine actually contributed. | `src/search/core/core-provider.ts` |

---

## LOW (polish)

| # | Title | Failure mode |
|---|-------|--------------|
| 25 | `evidence_score.explanation` duplicates `components` info |
| 26 | `results[].snippet` contains "…" from upstream engines, not normalized |
| 27 | `crawl pages[]` lacks per-page `fetch_method` (can't tell cache vs live) |
| 28 | `watch.create` returns `staleness_seconds: -interval` (full interval until first fire). Negative sign non-obvious. Suggest `seconds_until_due`. |
| 29 | `extract brand` tagline filled with `<title>` separator: `"Home \\ Anthropic"` for anthropic.com |
| 30 | `http_status` field omitted from successful `crawl` pages (only on `fetch`). Inconsistent across tools. |

---

## Strengths confirmed working (regression guards)

- **Cache layer:** 2-19ms hits, real persistence.
- **`exact_match: true`** filters correctly.
- **`find_similar` `cold_start`** signal honest and well-phrased.
- **Watch SSRF guards:** loopback + RFC-1918 + min-interval solid.
- **`extract schema`:** accurately pulled developer/release/version from PDF Wikipedia in 3s.
- **`extract structured`:** returns real tables + JSON-LD.
- **`diff granularity: word` + `section`:** clean hunks.
- **`watch.create` idempotency** on `(url, interval, selector)` real.
- **Per-result `evidence_score`** breakdown auditable when results aren't garbage.
- **Engine outage telemetry** (`engine_warnings`, `engine_telemetry.outcome`) good.

---

## Coverage map (what was tested)

Tester confirmed: every tool (10/10) was exercised, but not every flag combination.

**Fully tested:** search (basic, multi-query, exact_match, time_range, ultra-fast depth, …), fetch, cache, crawl, extract (multiple modes), find_similar, research, agent, diff, watch.

**~30% untested surface from spec §4 (carried forward):** `search_engines` override, `include_favicon`, `mode:stealth`, fetch `actions[]`, fetch `use_auth`, crawl `dfs` + `use_auth`, research `comprehensive` depth + `stream`, agent `stream`, watch webhook E2E + `selector` + `delete`, cache `clear`, `WIGOLO_SEARCH=searxng` / `hybrid` backends, prompt-injection resistance, concurrency under load, robots.txt enforcement.

---

## Strategic frame for next batch

### Bucket A — Fight (pure code, no infra disadvantage)
Most of the 30. Bug fixes + envelope changes + threshold tuning.

### Bucket B — Tune signals
#1 (SPA empty cache), #2 (static via Playwright), #19 (4xx no short-circuit), #12 (papers concurrent fallback) — router and routing heuristics.

### Bucket C — Honest retreat
None obvious in this batch. The Marginalia breaker (#17) is a candidate if the engine never recovers — gate behind a feature flag instead of leaving "error" in default telemetry.

### Proposed slice grouping (for future intake)

| Slice | Theme | Flaws covered | Bucket |
|-------|-------|---------------|--------|
| **F1** | Silent-correctness pack | #1 SPA cache, #3 max_tokens_out hard gate, #5 relevance_score normalization, #8 agent schema envelope | A |
| **F2** | URL hygiene | #4 paren mangling, #21 sitemap entry picker | A |
| **F3** | Research polish | #6 link-fragment strip (recurse), #7 decompose dedup, #22 citation_graph indexing | A |
| **F4** | Watch shape | #10 delete envelope, #11 single-action consistency, #28 staleness_seconds rename | A |
| **F5** | Router escalation v2 | #2 example.com Playwright, #19 4xx short-circuit, #15 freshness downrank | B |
| **F6** | Search trust | #13 include_domains tightens lex, #14 brand_collision threshold, #17 Marginalia breaker, #18 answer-mode hallucination strict-span | A |
| **F7** | Extract quality | #9 structured KV noise, #23 find_similar empty markdown omission, #29 brand tagline source, #16 cache.since lite mode | A |
| **F8** | Long-tail polish | #20 cache_bypassed, #24 dedup_kept sum, #25-#27, #30 | A |

This is intake-shaped, not committed. CEO decides timing + scope.

---

## Decision deferred to CEO

Options previously presented for this round:

1. **Defer all 30** → next intake cycle (this doc is the record).
2. **Hotfix the 4 critical → 0.1.23** (F1 slice only, surgical).
3. **Full intake of 30 → 0.2.x or 2.0.0** (npm 1.x band is taken).

This document is option 1 — captured + parked. CEO action items, when scheduling:
- Confirm which option.
- Re-audit after fix to verify deltas.
- Address the locked-worktrees / clean-worktrees.sh hygiene gap before next batch.
- Decide on the v1.0 stable bar (proposed in prior CTO note: zero CRITICAL on a blind fresh audit, external benchmark, clean CHANGELOG).

---

## References

- v0.1.22 release commit: `413c1f0`.
- Prior audit (5.4/10 baseline): `cc-test-report.md` at repo root.
- Prior gap-closure spec: `docs/superpowers/specs/2026-05-26-wigolo-gap-closure-audit.md`.
- v2 audit (static-evidence post-batch): `docs/superpowers/audits/2026-05-27-wigolo-gap-closure-v2.md`.
- CHANGELOG entry: `CHANGELOG.md` → `v0.1.22 — 2026-05-27` section.
