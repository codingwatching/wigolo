import { createLogger } from '../logger.js';
import { getEmbeddingService } from '../embedding/embed.js';

const log = createLogger('server');

interface MaybeWarmable {
  warmup?: () => Promise<void>;
}

let pending: Promise<void> | null = null;

export function isEagerWarmupEnabled(): boolean {
  return process.env.WIGOLO_EAGER_WARMUP === '1';
}

/**
 * Fire-and-forget pre-warm of embed + rerank providers. No-op when env unset.
 * Errors logged at warn, never thrown.
 */
export function maybeEagerWarmup(): void {
  if (!isEagerWarmupEnabled()) return;

  pending = (async () => {
    await Promise.all([warmEmbed(), warmRerank()]);
  })().finally(() => {
    pending = null;
  });
}

async function warmEmbed(): Promise<void> {
  const start = Date.now();
  try {
    // Prime the lazy provider load through the service (D2) so the first real
    // embed/find_similar does not pay the model-load cost.
    await getEmbeddingService().ensureProviderReady();
    log.info('eager warmup: embed ready', { ms: Date.now() - start });
  } catch (err) {
    log.warn('eager warmup: embed failed', {
      ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function warmRerank(): Promise<void> {
  const start = Date.now();
  try {
    const mod = await import('../providers/rerank-provider.js');
    const provider = (await mod.getRerankProvider()) as MaybeWarmable;
    if (typeof provider.warmup === 'function') {
      await provider.warmup();
    }
    log.info('eager warmup: rerank ready', { ms: Date.now() - start });
  } catch (err) {
    log.warn('eager warmup: rerank failed', {
      ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Test-only: returns the in-flight warmup promise (or null). */
export function _getWarmupPendingForTest(): Promise<void> | null {
  return pending;
}
