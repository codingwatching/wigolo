/**
 * computeStorage action — walks the data dir and returns per-component
 * storage sizes plus a sorted list of storage hogs.
 *
 * Components tracked (matching data-dir layout):
 *   cache       → <dataDir>/wigolo.db
 *   embeddings  → <dataDir>/embeddings/
 *   models      → <dataDir>/models/
 *   browser     → <dataDir>/playwright-browsers/
 *   searxng     → <dataDir>/searxng/
 *
 * No business logic in components — this is the action layer.
 */
import {
  existsSync,
  statSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';

export interface ComponentStorageItem {
  id: string;
  label: string;
  /** Absolute path to the component's storage location */
  path: string;
  bytes: number;
}

export interface StorageResult {
  items: ComponentStorageItem[];
  /** Items sorted descending by bytes (zero-byte items excluded) */
  hogs: ComponentStorageItem[];
  totalBytes: number;
}

/** Walk a path recursively and return total byte count. Returns 0 if absent. */
function sizeOf(target: string): number {
  if (!existsSync(target)) return 0;
  const st = statSync(target);
  if (st.isFile()) return st.size;
  if (!st.isDirectory()) return 0;
  let total = 0;
  const entries = readdirSync(target, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(target, entry.name);
    if (entry.isFile()) {
      total += statSync(child).size;
    } else if (entry.isSymbolicLink()) {
      // skip symlinks to avoid loops
    } else if (entry.isDirectory()) {
      total += sizeOf(child);
    }
  }
  return total;
}

const COMPONENT_DEFS: Array<{ id: string; label: string; subpath: string }> = [
  { id: 'cache',      label: 'Cache DB',          subpath: 'wigolo.db' },
  { id: 'embeddings', label: 'Embeddings index',   subpath: 'embeddings' },
  { id: 'models',     label: 'ML models',          subpath: 'models' },
  { id: 'browser',    label: 'Browser engine',     subpath: 'playwright-browsers' },
  { id: 'searxng',    label: 'Search engine data', subpath: 'searxng' },
];

export async function computeStorage(dataDir: string): Promise<StorageResult> {
  const items: ComponentStorageItem[] = COMPONENT_DEFS.map(({ id, label, subpath }) => {
    const path = join(dataDir, subpath);
    const bytes = existsSync(dataDir) ? sizeOf(path) : 0;
    return { id, label, path, bytes };
  });

  const totalBytes = items.reduce((sum, i) => sum + i.bytes, 0);

  const hogs = items
    .filter((i) => i.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);

  return { items, hogs, totalBytes };
}
