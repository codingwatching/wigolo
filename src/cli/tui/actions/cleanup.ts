/**
 * cleanupComponent action — removes the targeted component's storage,
 * reports freed bytes, and is idempotent when the target is absent.
 *
 * Only the specified component is removed; other components are untouched.
 * Freed bytes are computed BEFORE deletion by walking the target path.
 */
import { existsSync, rmSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type CleanableComponentId = 'cache' | 'embeddings' | 'models' | 'browser' | 'searxng';

export interface CleanupResult {
  ok: boolean;
  /** Bytes freed by this cleanup operation */
  freedBytes: number;
  /** Present when an error occurred */
  error?: string;
}

/** Subpaths for each cleanable component within the data dir */
const COMPONENT_SUBPATHS: Record<CleanableComponentId, string> = {
  cache: 'wigolo.db',
  embeddings: 'embeddings',
  models: 'models',
  browser: 'playwright-browsers',
  searxng: 'searxng',
};

/** Walk a path recursively and return total bytes. Returns 0 if absent. */
function measureBytes(target: string): number {
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
    } else if (entry.isDirectory()) {
      total += measureBytes(child);
    }
    // skip symlinks to avoid loops
  }
  return total;
}

export async function cleanupComponent(
  component: CleanableComponentId,
  dataDir: string,
): Promise<CleanupResult> {
  const subpath = COMPONENT_SUBPATHS[component];
  const target = join(dataDir, subpath);

  if (!existsSync(target)) {
    return { ok: true, freedBytes: 0 };
  }

  const freedBytes = measureBytes(target);

  try {
    rmSync(target, { recursive: true, force: true });
    return { ok: true, freedBytes };
  } catch (err) {
    return {
      ok: false,
      freedBytes: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
