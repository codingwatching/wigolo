CREATE TABLE IF NOT EXISTS feed_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_url TEXT NOT NULL,
  guid TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  summary TEXT NOT NULL,
  published_date TEXT,
  category TEXT NOT NULL DEFAULT 'news',
  fetched_at TEXT NOT NULL,
  UNIQUE(feed_url, guid)
);

CREATE INDEX IF NOT EXISTS idx_feed_items_published ON feed_items(published_date);
CREATE INDEX IF NOT EXISTS idx_feed_items_feed_url ON feed_items(feed_url);

CREATE VIRTUAL TABLE IF NOT EXISTS feed_items_fts USING fts5(
  title, summary, link UNINDEXED,
  content='feed_items',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS feed_items_ai AFTER INSERT ON feed_items BEGIN
  INSERT INTO feed_items_fts(rowid, title, summary, link) VALUES (new.id, new.title, new.summary, new.link);
END;

CREATE TRIGGER IF NOT EXISTS feed_items_ad AFTER DELETE ON feed_items BEGIN
  INSERT INTO feed_items_fts(feed_items_fts, rowid, title, summary, link) VALUES('delete', old.id, old.title, old.summary, old.link);
END;

CREATE TRIGGER IF NOT EXISTS feed_items_au AFTER UPDATE ON feed_items BEGIN
  INSERT INTO feed_items_fts(feed_items_fts, rowid, title, summary, link) VALUES('delete', old.id, old.title, old.summary, old.link);
  INSERT INTO feed_items_fts(feed_items_fts, rowid, title, summary, link) VALUES (new.id, new.title, new.summary, new.link);
END;
