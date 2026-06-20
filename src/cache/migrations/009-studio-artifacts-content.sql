-- 009 — Interactive Browser Studio capture: content columns + searchable FTS index.
-- Adds the human-readable / queryable columns to studio_artifacts (created by 008) and
-- a separate external-content FTS5 index + sync triggers over its text. The capture
-- pipeline (4b-3) writes these columns; the retrieval-time data-not-instructions
-- framing on surfaced results is 4d, NOT here — FTS indexes raw content verbatim.
--
-- The WHOLE migration runs in the runner postStep (see runner.ts), columns first then
-- the index/triggers: SQLite has no `ADD COLUMN IF NOT EXISTS`, so each ALTER is gated
-- on pragma table_info to stay idempotent. created_at uses a CONSTANT sentinel default
-- (NOT (datetime('now'))) so ADD COLUMN succeeds even when studio_artifacts already has
-- rows — a non-constant default raises "Cannot add a column with non-constant default"
-- on a non-empty table. insertArtifact (4b-3) sets created_at explicitly; the sentinel
-- only backfills any pre-existing row.
--
-- Column ALTERs (gated in postStep; mirrored here for review):
--   ALTER TABLE studio_artifacts ADD COLUMN title TEXT;     -- nullable
--   ALTER TABLE studio_artifacts ADD COLUMN markdown TEXT;  -- nullable
--   ALTER TABLE studio_artifacts ADD COLUMN metadata TEXT;  -- nullable; 4b-3 mark capture
--          writes the StructuredTarget selectors (fingerprint + ancestorPath + attrs) as
--          JSON here — they do not fit title/markdown/url and must stay out of FTS.
--   ALTER TABLE studio_artifacts ADD COLUMN created_at TEXT NOT NULL
--          DEFAULT '1970-01-01T00:00:00.000Z';

-- External-content FTS5 over the searchable text (title + markdown). Mirrors
-- url_cache_fts / feed_items_fts; content_rowid is studio_artifacts.id (INTEGER PK).
CREATE VIRTUAL TABLE IF NOT EXISTS studio_artifacts_fts USING fts5(
  title,
  markdown,
  content='studio_artifacts',
  content_rowid='id'
);

-- Sync triggers (feed_items pattern: AFTER, with the external-content 'delete' command
-- on removal so the index never keeps a dangling entry). The AFTER UPDATE trigger is
-- WHEN-guarded on the indexed columns so a curate-only UPDATE (curated_by_human 0->1,
-- title/markdown unchanged) does not churn FTS.
CREATE TRIGGER IF NOT EXISTS studio_artifacts_ai AFTER INSERT ON studio_artifacts BEGIN
  INSERT INTO studio_artifacts_fts(rowid, title, markdown) VALUES (new.id, new.title, new.markdown);
END;

CREATE TRIGGER IF NOT EXISTS studio_artifacts_ad AFTER DELETE ON studio_artifacts BEGIN
  INSERT INTO studio_artifacts_fts(studio_artifacts_fts, rowid, title, markdown) VALUES('delete', old.id, old.title, old.markdown);
END;

CREATE TRIGGER IF NOT EXISTS studio_artifacts_au AFTER UPDATE ON studio_artifacts
  WHEN old.title IS NOT new.title OR old.markdown IS NOT new.markdown
BEGIN
  INSERT INTO studio_artifacts_fts(studio_artifacts_fts, rowid, title, markdown) VALUES('delete', old.id, old.title, old.markdown);
  INSERT INTO studio_artifacts_fts(rowid, title, markdown) VALUES (new.id, new.title, new.markdown);
END;

-- Index any rows that predate the triggers (none on the forward path — no 4b capture
-- path shipped before this; defensive, and covers a seeded table).
INSERT INTO studio_artifacts_fts(studio_artifacts_fts) VALUES('rebuild');
