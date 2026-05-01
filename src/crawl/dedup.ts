import { createHash } from 'node:crypto';
import { getDatabase } from '../cache/db.js';

export function splitIntoBlocks(markdown: string): string[] {
  if (!markdown.trim()) return [];

  const lines = markdown.split('\n');
  const headingIndices: { level: number; lineIdx: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+/);
    if (match) {
      headingIndices.push({ level: match[1].length, lineIdx: i });
    }
  }

  // If no headings, split by double-newline (paragraph blocks)
  if (headingIndices.length === 0) {
    return markdown.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  }

  // Non-overlapping split: each heading starts a new block, ending at the next heading of ANY level
  const blocks: string[] = [];
  for (let i = 0; i < headingIndices.length; i++) {
    const start = headingIndices[i].lineIdx;
    const end = i + 1 < headingIndices.length ? headingIndices[i + 1].lineIdx : lines.length;
    blocks.push(lines.slice(start, end).join('\n').trim());
  }

  return blocks.filter(Boolean);
}

export function normalizeBlockText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function hashBlock(text: string): string {
  return createHash('sha256').update(normalizeBlockText(text)).digest('hex');
}

interface PageInput {
  url: string;
  markdown: string;
}

interface PageOutput {
  url: string;
  markdown: string;
}

const NAV_DEDUPE_THRESHOLD = 0.6;
const MAX_LEADING_LINES = 30;
const MAX_TRAILING_LINES = 20;
const MIN_CORPUS = 4;

function lineHash(line: string): string {
  return createHash('sha1').update(line.trim().toLowerCase()).digest('hex');
}

export function stripRepeatedNavigationLines(pages: PageInput[]): PageInput[] {
  if (pages.length < MIN_CORPUS) return pages;
  const lineSets = pages.map((p) => p.markdown.split('\n'));

  const countLeading = new Map<string, number>();
  const countTrailing = new Map<string, number>();
  for (const lines of lineSets) {
    const seenL = new Set<string>();
    for (let i = 0; i < Math.min(MAX_LEADING_LINES, lines.length); i++) {
      const h = lineHash(lines[i]);
      if (!seenL.has(h)) {
        seenL.add(h);
        countLeading.set(h, (countLeading.get(h) ?? 0) + 1);
      }
    }
    const seenT = new Set<string>();
    for (let i = lines.length - 1; i >= Math.max(lines.length - MAX_TRAILING_LINES, 0); i--) {
      const h = lineHash(lines[i]);
      if (!seenT.has(h)) {
        seenT.add(h);
        countTrailing.set(h, (countTrailing.get(h) ?? 0) + 1);
      }
    }
  }

  const threshold = pages.length * NAV_DEDUPE_THRESHOLD;
  const navLeading = new Set([...countLeading].filter(([, c]) => c >= threshold).map(([h]) => h));
  const navTrailing = new Set([...countTrailing].filter(([, c]) => c >= threshold).map(([h]) => h));

  return pages.map((page, i) => {
    const lines = lineSets[i];
    let head = 0;
    while (head < lines.length && (lines[head].trim() === '' || navLeading.has(lineHash(lines[head])))) head++;
    let tail = lines.length;
    while (tail > head && (lines[tail - 1].trim() === '' || navTrailing.has(lineHash(lines[tail - 1])))) tail--;
    return { url: page.url, markdown: lines.slice(head, tail).join('\n') };
  });
}

export function deduplicatePages(pages: PageInput[], domain?: string): PageOutput[] {
  if (pages.length <= 1) return pages.map((p) => ({ url: p.url, markdown: p.markdown }));

  const stripped = stripRepeatedNavigationLines(pages);

  // Pre-load stored boilerplate hashes for this domain
  const storedHashes = domain ? getStoredBoilerplate(domain) : [];
  const boilerplateHashes = new Set<string>(storedHashes);

  // Split each page into blocks and hash them
  const pageBlocks = stripped.map((page) => ({
    url: page.url,
    blocks: splitIntoBlocks(page.markdown),
  }));

  // Count how many pages each block hash appears in
  const hashPageCount = new Map<string, number>();
  for (const page of pageBlocks) {
    const seenHashes = new Set<string>();
    for (const block of page.blocks) {
      const h = hashBlock(block);
      if (!seenHashes.has(h)) {
        seenHashes.add(h);
        hashPageCount.set(h, (hashPageCount.get(h) ?? 0) + 1);
      }
    }
  }

  // Mark hashes appearing in >50% of pages as boilerplate
  const threshold = pages.length / 2;
  for (const [hash, count] of hashPageCount) {
    if (count > threshold) {
      boilerplateHashes.add(hash);
    }
  }

  // Store updated boilerplate hashes for this domain
  if (domain) {
    storeBoilerplate(domain, Array.from(boilerplateHashes));
  }

  // Strip boilerplate blocks from each page
  return pageBlocks.map((page) => {
    const filtered = page.blocks.filter((block) => !boilerplateHashes.has(hashBlock(block)));
    return {
      url: page.url,
      markdown: filtered.join('\n\n'),
    };
  });
}

export function getStoredBoilerplate(domain: string): string[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT block_hash FROM domain_boilerplate WHERE domain = ?').all(domain) as { block_hash: string }[];
  return rows.map(r => r.block_hash);
}

export function storeBoilerplate(domain: string, hashes: string[]): void {
  const db = getDatabase();
  const del = db.prepare('DELETE FROM domain_boilerplate WHERE domain = ?');
  const insert = db.prepare(
    'INSERT OR IGNORE INTO domain_boilerplate (domain, block_hash, sample_text) VALUES (?, ?, ?)',
  );
  const tx = db.transaction((items: string[]) => {
    del.run(domain);
    for (const hash of items) {
      insert.run(domain, hash, null);
    }
  });
  tx(hashes);
}
