import { describe, it, expect } from 'vitest';
import { parseFeed } from '../../../../../src/search/core/rss/feed-parser.js';

const RSS_2 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example News</title>
    <link>https://example.com/</link>
    <description>An example feed.</description>
    <item>
      <title>First Post</title>
      <link>https://example.com/1</link>
      <description>About AI &amp; machine learning.</description>
      <guid>https://example.com/1</guid>
      <pubDate>Tue, 03 Jun 2025 09:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Second Post</title>
      <link>https://example.com/2</link>
      <description>Cluster computing.</description>
      <guid>tag:example.com,2025:2</guid>
      <pubDate>Wed, 04 Jun 2025 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Third Post</title>
      <link>https://example.com/3</link>
      <description>No date here.</description>
      <guid>https://example.com/3</guid>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom Feed</title>
  <id>urn:example:atom</id>
  <entry>
    <title>Atom Entry One</title>
    <link rel="alternate" href="https://atom.example.com/a"/>
    <id>urn:example:a</id>
    <summary>First atom summary.</summary>
    <published>2025-06-03T10:00:00Z</published>
  </entry>
  <entry>
    <title>Atom Entry Two</title>
    <link rel="alternate" href="https://atom.example.com/b"/>
    <id>urn:example:b</id>
    <summary>Second atom summary.</summary>
    <published>2025-06-04T10:00:00Z</published>
  </entry>
</feed>`;

const ATOM_CONTENT = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Content Feed</title>
  <entry>
    <title>Content Entry</title>
    <link rel="alternate" href="https://atom.example.com/c"/>
    <id>urn:example:c</id>
    <content>From content tag.</content>
    <updated>2025-06-05T10:00:00Z</updated>
  </entry>
</feed>`;

const EMPTY_RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Empty</title></channel></rss>`;

describe('parseFeed', () => {
  it('parses RSS 2.0 with 3 items', () => {
    const result = parseFeed(RSS_2, 'https://example.com/feed.xml');
    expect(result).not.toBeNull();
    expect(result!.feedUrl).toBe('https://example.com/feed.xml');
    expect(result!.feedTitle).toBe('Example News');
    expect(result!.items).toHaveLength(3);
    expect(result!.items[0].title).toBe('First Post');
    expect(result!.items[0].link).toBe('https://example.com/1');
    expect(result!.items[0].guid).toBe('https://example.com/1');
    expect(result!.items[0].publishedDate).toBe(new Date('Tue, 03 Jun 2025 09:00:00 GMT').toISOString());
  });

  it('decodes HTML entities in summary (linkedom)', () => {
    const r = parseFeed(RSS_2, 'https://example.com/feed.xml');
    expect(r!.items[0].summary).toContain('AI');
    expect(r!.items[0].summary).toContain('&');
    expect(r!.items[0].summary).not.toContain('&amp;');
  });

  it('parses Atom with 2 entries', () => {
    const r = parseFeed(ATOM, 'https://atom.example.com/feed.xml');
    expect(r).not.toBeNull();
    expect(r!.items).toHaveLength(2);
    expect(r!.items[0].title).toBe('Atom Entry One');
    expect(r!.items[0].link).toBe('https://atom.example.com/a');
    expect(r!.items[0].guid).toBe('urn:example:a');
    expect(r!.items[0].publishedDate).toBe('2025-06-03T10:00:00.000Z');
  });

  it('uses <content> when <summary> is absent', () => {
    const r = parseFeed(ATOM_CONTENT, 'https://atom.example.com/c.xml');
    expect(r).not.toBeNull();
    expect(r!.items).toHaveLength(1);
    expect(r!.items[0].summary).toBe('From content tag.');
  });

  it('returns undefined publishedDate when pubDate missing in RSS', () => {
    const r = parseFeed(RSS_2, 'x');
    expect(r!.items[2].publishedDate).toBeUndefined();
  });

  it('returns null for completely malformed XML', () => {
    const r = parseFeed('this is not xml at all <<', 'x');
    expect(r).toBeNull();
  });

  it('returns ParsedFeed with items:[] for empty RSS channel', () => {
    const r = parseFeed(EMPTY_RSS, 'x');
    expect(r).not.toBeNull();
    expect(r!.items).toEqual([]);
  });

  it('returns null for non-feed XML (no rss/channel/feed elements)', () => {
    const r = parseFeed('<html><body>nope</body></html>', 'x');
    expect(r).toBeNull();
  });

  it('prefers RSS shape when both indicators present', () => {
    // Outer feed wraps inner rss — we should take the RSS items.
    const hybrid = `<?xml version="1.0"?>
      <rss version="2.0"><channel>
        <title>RSS wins</title>
        <item><title>From RSS</title><link>https://r.example.com/1</link><description>d</description></item>
      </channel></rss>`;
    const r = parseFeed(hybrid, 'x');
    expect(r).not.toBeNull();
    expect(r!.items[0].title).toBe('From RSS');
  });
});
