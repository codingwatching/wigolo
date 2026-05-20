import { parseHTML } from 'linkedom';
import { createLogger } from '../../../logger.js';

const log = createLogger('search');

export interface ParsedFeedItem {
  guid: string;
  title: string;
  link: string;
  summary: string;
  publishedDate?: string;
}

export interface ParsedFeed {
  feedUrl: string;
  feedTitle: string;
  items: ParsedFeedItem[];
}

function textOf(el: Element | null | undefined): string {
  if (!el) return '';
  return (el.textContent ?? '').trim();
}

function toIso(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function parseRss(doc: Document, feedUrl: string): ParsedFeed | null {
  const channel = doc.querySelector('rss > channel') ?? doc.querySelector('channel');
  if (!channel) return null;
  const items = Array.from(channel.querySelectorAll('item'));
  if (items.length === 0) return null;

  const feedTitle = textOf(channel.querySelector('title')) || feedUrl;
  const parsed: ParsedFeedItem[] = [];

  for (const item of items) {
    const title = textOf(item.querySelector('title'));
    const link = textOf(item.querySelector('rsslink'));
    const description = textOf(item.querySelector('description'));
    const guid = textOf(item.querySelector('guid')) || link;
    const pubDate = textOf(item.querySelector('pubDate'));

    if (!title || !link) continue;

    const entry: ParsedFeedItem = {
      guid: guid || link,
      title,
      link,
      summary: description,
    };
    const iso = toIso(pubDate);
    if (iso) entry.publishedDate = iso;
    parsed.push(entry);
  }

  return { feedUrl, feedTitle, items: parsed };
}

function parseAtom(doc: Document, feedUrl: string): ParsedFeed | null {
  const feed = doc.querySelector('feed');
  if (!feed) return null;
  const entries = Array.from(feed.querySelectorAll('entry'));
  if (entries.length === 0) return null;

  const feedTitle = textOf(feed.querySelector('title')) || feedUrl;
  const parsed: ParsedFeedItem[] = [];

  for (const entry of entries) {
    const title = textOf(entry.querySelector('title'));
    // Atom: <link rel="alternate" href="..."/> — prefer alternate, else first link
    const linkEl = Array.from(entry.querySelectorAll('link')).find(
      (l) => (l.getAttribute('rel') ?? 'alternate') === 'alternate',
    ) ?? entry.querySelector('link');
    const link = linkEl?.getAttribute('href') ?? '';
    const summaryEl = entry.querySelector('summary');
    const contentEl = entry.querySelector('content');
    const summary = textOf(summaryEl) || textOf(contentEl);
    const id = textOf(entry.querySelector('id')) || link;
    const published = textOf(entry.querySelector('published')) || textOf(entry.querySelector('updated'));

    if (!title || !link) continue;

    const item: ParsedFeedItem = {
      guid: id || link,
      title,
      link,
      summary,
    };
    const iso = toIso(published);
    if (iso) item.publishedDate = iso;
    parsed.push(item);
  }

  return { feedUrl, feedTitle, items: parsed };
}

/**
 * linkedom treats <link> as an HTML void element (self-closing), so RSS
 * <link>https://...</link> ends up with the URL as a text node sibling
 * rather than the link's textContent. Atom uses <link href="..." /> which
 * is fine. We rewrite RSS-style <link>URL</link> → <rsslink>URL</rsslink>
 * so the URL becomes the element's textContent. Atom <link rel="..." href="..."/>
 * is left untouched.
 */
function rewriteRssLinks(xml: string): string {
  return xml.replace(/<link>([\s\S]*?)<\/link>/g, '<rsslink>$1</rsslink>');
}

export function parseFeed(xml: string, feedUrl: string): ParsedFeed | null {
  if (!xml || xml.trim().length === 0) return null;
  const prepared = rewriteRssLinks(xml);
  let doc: Document;
  try {
    ({ document: doc } = parseHTML(prepared));
  } catch (err) {
    log.warn('feed XML parse failed', {
      feedUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  // Prefer RSS shape — if a channel + items exist, use them.
  const rss = parseRss(doc, feedUrl);
  if (rss) return rss;

  const atom = parseAtom(doc, feedUrl);
  if (atom) return atom;

  // Distinguish "empty but valid feed" vs "not a feed at all".
  if (doc.querySelector('rss') || doc.querySelector('channel') || doc.querySelector('feed')) {
    const isAtom = !!doc.querySelector('feed');
    return {
      feedUrl,
      feedTitle: textOf(doc.querySelector(isAtom ? 'feed > title' : 'channel > title')) || feedUrl,
      items: [],
    };
  }

  return null;
}
