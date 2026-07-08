/**
 * P6 F1 — grab-all core. Turn a marked repeating pattern's generalized match cluster into structured
 * rows (columns inferred from the shared sub-structure), optionally following same-origin Document-class
 * pagination within the SSRF fence, persisted as a `type:'extraction'` artifact.
 *
 * Pure/injectable: the host (Electron main, over the live DOM) supplies the real deps; this module has
 * no Electron / native dependency and unit-tests standalone. Rows are UNTRUSTED page content →
 * neutralize-before-fence here (the renderer neutralizes again independently — dual sink).
 */

/** Minimal CDP DOM.Node shape we need for structural row inference (no native, no Electron). */
export interface MatchSubtree {
  nodeType: number; // 1 = element, 3 = text
  nodeName: string;
  nodeValue?: string;
  children?: MatchSubtree[];
}

interface LeafCell {
  path: string;
  text: string;
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Direct non-whitespace text of an element (immediate text-node children only). */
function directText(node: MatchSubtree): string {
  return collapse(
    (node.children ?? [])
      .filter((c) => c.nodeType === 3)
      .map((c) => c.nodeValue ?? '')
      .join(' '),
  );
}

/** All text under a node (for the degrade path). */
function innerText(node: MatchSubtree): string {
  if (node.nodeType === 3) return node.nodeValue ?? '';
  return collapse((node.children ?? []).map(innerText).join(' '));
}

/** Leaf text cells keyed by generalized tag-chain (no positional indices) from the match root. */
function leafCells(root: MatchSubtree): LeafCell[] {
  const out: LeafCell[] = [];
  const walk = (node: MatchSubtree, chain: string[]): void => {
    if (node.nodeType !== 1) return;
    const here = [...chain, node.nodeName.toLowerCase()];
    const text = directText(node);
    if (text) out.push({ path: here.join('>'), text });
    for (const child of node.children ?? []) walk(child, here);
  };
  for (const child of root.children ?? []) walk(child, []);
  return out;
}

export interface InferredRows {
  columns: string[];
  rows: Record<string, string>[];
}

/** Derive structured rows from a set of matched element subtrees. See plan §F1 for the algorithm. */
export function inferRows(matches: MatchSubtree[]): InferredRows {
  if (matches.length === 0) return { columns: [], rows: [] };
  const perMatch = matches.map(leafCells);
  // count path frequency across matches (a path counts once per match even if repeated within it)
  const freq = new Map<string, number>();
  const order: string[] = [];
  for (const cells of perMatch) {
    const seen = new Set<string>();
    for (const c of cells) {
      if (seen.has(c.path)) continue;
      seen.add(c.path);
      if (!freq.has(c.path)) order.push(c.path);
      freq.set(c.path, (freq.get(c.path) ?? 0) + 1);
    }
  }
  // Strict majority (> half): a stable column must appear in MOST matches. For n=2 this requires both
  // (a path in only one of two is not a shared column → the pair degrades to a single text column).
  const majority = Math.floor(matches.length / 2) + 1;
  const columns = order.filter((p) => (freq.get(p) ?? 0) >= majority);
  if (columns.length < 2) {
    // degrade: one text column of whole-element innerText (non-repeating / unique mark → single row)
    return { columns: ['text'], rows: matches.map((m) => ({ text: innerText(m) })) };
  }
  const rows = perMatch.map((cells) => {
    const byPath = new Map<string, string>();
    for (const c of cells) if (!byPath.has(c.path)) byPath.set(c.path, c.text);
    const row: Record<string, string> = {};
    for (const col of columns) row[col] = byPath.get(col) ?? '';
    return row;
  });
  return { columns, rows };
}
