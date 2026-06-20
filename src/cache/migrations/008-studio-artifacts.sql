-- 008 — Interactive Browser Studio capture schema (BOTH tables, parent first).
-- Creates studio_sessions (the session origin every artifact points back to —
-- the FK parent) THEN studio_artifacts (captured marks / clips / notes / qa,
-- deduped per type). Order matters: the artifacts FK resolves only after its
-- parent exists.
--
-- Schema only — no FTS5 vtable, no triggers, no insert path. The capture
-- pipeline + search integration (title/markdown columns, FTS5, dedup conflict
-- policy) land in later slices, each behind their own tests.
--
-- normalized_url is NULLABLE here (url-less notes/qa) — UNLIKE url_cache where it
-- is NOT NULL. Dedup conflict policy (IGNORE vs REPLACE) is an insert-path choice,
-- NOT declared here; this migration only creates the unique indexes.

CREATE TABLE IF NOT EXISTS studio_sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS studio_artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES studio_sessions(id),
  artifact_type TEXT NOT NULL,
  url TEXT,
  normalized_url TEXT,
  content_hash TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  curated_by_human INTEGER NOT NULL DEFAULT 0,
  content_trusted INTEGER NOT NULL DEFAULT 0
);

-- Dedup keys — SYMMETRIC: artifact_type in BOTH partial indexes so cross-type
-- byte-collisions never merge. session_id is deliberately absent from both — the
-- same content captured under two sessions dedups to one row (origin is tracked
-- by the FK, not baked into the artifact's identity).
CREATE UNIQUE INDEX IF NOT EXISTS idx_studio_artifacts_url
  ON studio_artifacts(normalized_url, artifact_type, content_hash)
  WHERE normalized_url IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_studio_artifacts_nourl
  ON studio_artifacts(artifact_type, content_hash)
  WHERE normalized_url IS NULL;
