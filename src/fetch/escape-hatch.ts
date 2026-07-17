/**
 * Opt-in Tier-B escape-hatch fetchers: a self-hosted challenge-solver service
 * and a third-party hosted reader service. Both are OFF unless their URL is
 * configured — a default install never reaches this module (the router only
 * `import()`s it lazily when a rung is configured, so the idle footprint holds).
 *
 * Security posture (a reviewer audits this file):
 *   - Every network endpoint (sidecar URL + target URL + every redirect hop) is
 *     SSRF-guarded. The sidecar may be on loopback (self-hosted is the common
 *     case); the target honours the fetch allow-private policy. Cloud-metadata
 *     IPs (169.254/16) are blocked in ALL modes.
 *   - Redirects are followed MANUALLY with a per-hop re-guard + hop cap, and a
 *     Cookie header is dropped on any cross-host hop (mirrors the TLS tier).
 *   - The solver service's output is UNTRUSTED: any cookies it returns are NOT
 *     surfaced as reusable clearance and are never injected cross-domain.
 *   - The hosted reader EGRESSES the target URL off-machine; the target URL is
 *     redacted in logs.
 */

import { createLogger } from '../logger.js';
import { guardFetchUrl } from '../watch/ssrf.js';
import { redactUrl } from '../util/redact-url.js';
import type { RawFetchResult } from '../types.js';

const logger = createLogger('fetch');

/** The subset of Config the escape-hatch rungs need. */
export interface EscapeHatchConfig {
  solverUrl: string | null;
  hostedReaderUrl: string | null;
  fetchAllowPrivate: boolean;
  maxRedirects: number;
  fetchTimeoutMs: number;
}

type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export interface EscapeHatchOpts {
  /** Injectable fetch (tests). Defaults to the global fetch. */
  fetchImpl?: FetchImpl;
  signal?: AbortSignal;
}

function hostOf(u: string): string | null {
  try {
    return new URL(u).host;
  } catch {
    return null;
  }
}

/**
 * Follow redirects manually from `startUrl`, re-guarding every hop under the
 * fetch SSRF policy and dropping the Cookie header on a cross-host hop. Returns
 * the terminal (non-3xx) Response, or null when a hop is blocked / the hop cap
 * is exceeded / the request errors.
 */
export async function _guardedFollow(
  startUrl: string,
  init: RequestInit,
  cfg: EscapeHatchConfig,
  fetchImpl: FetchImpl,
): Promise<Response | null> {
  const allowPrivate = cfg.fetchAllowPrivate;
  const maxHops = Math.max(0, cfg.maxRedirects);
  let current = startUrl;
  const seen = new Set<string>();
  const headers = new Headers(init.headers);

  // Request shape for the CURRENT hop. On a redirect we drop to a GET with no
  // body (standard redirect semantics) so the target URL — carried in the POST
  // body of the solver call — is NEVER re-POSTed to a different host the
  // service 3xx-redirects to.
  let method = init.method ?? 'GET';
  let body: BodyInit | null | undefined = init.body;

  for (let hop = 0; hop <= maxHops; hop++) {
    if (seen.has(current)) {
      logger.debug('escape-hatch redirect loop', { url: redactUrl(current) });
      return null;
    }
    seen.add(current);

    // Self-contained guard: re-guard EVERY hop, including hop 0. The follower
    // must not trust its input even though both callers also pre-guard.
    const guard = guardFetchUrl(current, hop === 0 ? 'sidecar URL' : 'redirect location', {
      allowPrivate,
    });
    if (!guard.ok) {
      logger.debug('escape-hatch hop blocked', { reason: guard.code, hop });
      return null;
    }

    // Drop the Cookie on a cross-host hop so a host-scoped credential never
    // leaks to a different origin.
    const hopHeaders = new Headers(headers);
    if (hostOf(current) !== hostOf(startUrl)) {
      hopHeaders.delete('cookie');
    }

    let resp: Response;
    try {
      resp = await fetchImpl(current, {
        ...init,
        method,
        body,
        headers: hopHeaders,
        redirect: 'manual',
      });
    } catch (err) {
      logger.debug('escape-hatch fetch error', {
        url: redactUrl(current),
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get('location');
      if (!loc) return resp;
      let next: string;
      try {
        next = new URL(loc, current).toString();
      } catch {
        return null;
      }
      // Standard redirect semantics: the followed request becomes a bodyless
      // GET. This is re-guarded at the top of the next iteration.
      method = 'GET';
      body = undefined;
      current = next;
      continue;
    }
    return resp;
  }
  logger.debug('escape-hatch exceeded redirect cap', { url: redactUrl(startUrl) });
  return null;
}

function toRawResult(
  targetUrl: string,
  finalUrl: string,
  html: string,
  statusCode: number,
): RawFetchResult {
  return {
    url: targetUrl,
    finalUrl,
    html,
    contentType: 'text/html',
    statusCode,
    method: 'http',
    // Deliberately no cookies surfaced: escape-hatch output is untrusted and
    // must never seed reusable clearance.
    headers: {},
    escalated: true,
  };
}

/**
 * Send the target URL to a self-hosted challenge-solver service and return its
 * cleared HTML. Returns null when unconfigured, when a guard blocks the target
 * or the solver endpoint, or when the solver fails. Enabling a solver trusts it
 * as a content source; its returned cookies are intentionally discarded.
 */
export async function solverFetch(
  targetUrl: string,
  cfg: EscapeHatchConfig,
  opts: EscapeHatchOpts = {},
): Promise<RawFetchResult | null> {
  if (!cfg.solverUrl) return null;
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchImpl);

  // The self-hosted solver endpoint may be on loopback; guardFetchUrl allows
  // loopback + localhost and blocks metadata in all modes.
  const solverGuard = guardFetchUrl(cfg.solverUrl, 'challenge-solver URL', { allowPrivate: true });
  if (!solverGuard.ok) {
    logger.warn('challenge-solver URL rejected by guard', { reason: solverGuard.code });
    return null;
  }
  // The target must pass the ordinary fetch policy (honours allow-private).
  const targetGuard = guardFetchUrl(targetUrl, 'target URL', { allowPrivate: cfg.fetchAllowPrivate });
  if (!targetGuard.ok) {
    logger.debug('challenge-solver target rejected by guard', { reason: targetGuard.code });
    return null;
  }

  logger.info('routing to challenge-solver service', {
    solver: redactUrl(cfg.solverUrl),
    target: redactUrl(targetUrl),
  });

  const body = JSON.stringify({ cmd: 'request.get', url: targetUrl, maxTimeout: cfg.fetchTimeoutMs });
  const resp = await _guardedFollow(
    cfg.solverUrl,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: opts.signal,
    },
    cfg,
    fetchImpl,
  );
  if (!resp || resp.status >= 400) return null;

  let parsed: unknown;
  try {
    parsed = await resp.json();
  } catch {
    return null;
  }
  const solution = (parsed as { solution?: { response?: unknown; status?: unknown } }).solution;
  const html = typeof solution?.response === 'string' ? solution.response : null;
  if (html === null) return null;
  const status = typeof solution?.status === 'number' ? solution.status : 200;

  // Solver-returned cookies (if any) are intentionally NOT surfaced — untrusted
  // output must not seed reusable, potentially cross-domain clearance.
  return toRawResult(targetUrl, targetUrl, html, status);
}

/**
 * Send the target URL to a third-party hosted reader service and return its
 * rendered content. Returns null when unconfigured or when a guard blocks a
 * hop. This EGRESSES the target URL off-machine — the target is redacted in
 * logs.
 */
export async function hostedReaderFetch(
  targetUrl: string,
  cfg: EscapeHatchConfig,
  opts: EscapeHatchOpts = {},
): Promise<RawFetchResult | null> {
  if (!cfg.hostedReaderUrl) return null;
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchImpl);

  const readerGuard = guardFetchUrl(cfg.hostedReaderUrl, 'reader-service URL', { allowPrivate: true });
  if (!readerGuard.ok) {
    logger.warn('reader-service URL rejected by guard', { reason: readerGuard.code });
    return null;
  }
  const targetGuard = guardFetchUrl(targetUrl, 'target URL', { allowPrivate: cfg.fetchAllowPrivate });
  if (!targetGuard.ok) {
    logger.debug('reader-service target rejected by guard', { reason: targetGuard.code });
    return null;
  }

  // Reader services conventionally take the target as a path suffix
  // (`https://reader/<target>`). Percent-encode the target so its own query /
  // path segments cannot inject extra params or traverse into the reader
  // request — the whole target becomes a single opaque path component.
  const base = cfg.hostedReaderUrl.endsWith('/') ? cfg.hostedReaderUrl : `${cfg.hostedReaderUrl}/`;
  const requestUrl = `${base}${encodeURIComponent(targetUrl)}`;

  logger.info('routing to hosted reader service (egresses target off-machine)', {
    reader: redactUrl(cfg.hostedReaderUrl),
    target: redactUrl(targetUrl),
  });

  const resp = await _guardedFollow(requestUrl, { method: 'GET', signal: opts.signal }, cfg, fetchImpl);
  if (!resp || resp.status >= 400) return null;

  let html: string;
  try {
    html = await resp.text();
  } catch {
    return null;
  }
  if (!html) return null;
  return toRawResult(targetUrl, targetUrl, html, resp.status);
}
