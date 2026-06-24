import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetConfig } from '../../../src/config.js';

// Same subsystem mocks the sibling http-server.test.ts uses — keep the daemon construction cheap and
// network-free; this suite exercises ONLY the static-serve seam + its security pins through real dispatch.
vi.mock('../../../src/cache/db.js', () => ({
  initDatabase: vi.fn(),
  closeDatabase: vi.fn(),
  getDatabase: vi.fn(() => ({})),
}));
vi.mock('../../../src/fetch/browser-pool.js', () => {
  class MockMultiBrowserPool {
    shutdown = vi.fn().mockResolvedValue(undefined);
    fetchWithBrowser = vi.fn();
    getConfiguredTypes = vi.fn().mockReturnValue(['chromium']);
    getStats = vi.fn().mockReturnValue([]);
  }
  return { MultiBrowserPool: MockMultiBrowserPool, BrowserPool: class extends MockMultiBrowserPool { acquire = vi.fn(); release = vi.fn(); } };
});
vi.mock('../../../src/fetch/http-client.js', () => ({ httpFetch: vi.fn() }));
vi.mock('../../../src/fetch/router.js', () => ({
  SmartRouter: class { constructor(_a: unknown, _b: unknown) {} fetch = vi.fn(); getDomainStats = vi.fn(); },
}));
vi.mock('../../../src/searxng/bootstrap.js', () => ({
  resolveSearchBackend: vi.fn().mockResolvedValue({ type: 'scraping' }),
  bootstrapNativeSearxng: vi.fn(),
  getBootstrapState: vi.fn().mockReturnValue(null),
}));
vi.mock('../../../src/searxng/process.js', () => ({
  SearxngProcess: vi.fn().mockImplementation(() => ({ start: vi.fn().mockResolvedValue(null), stop: vi.fn().mockResolvedValue(undefined), getUrl: vi.fn().mockReturnValue(null) })),
}));
vi.mock('../../../src/searxng/docker.js', () => ({
  DockerSearxng: vi.fn().mockImplementation(() => ({ start: vi.fn().mockResolvedValue(null), stop: vi.fn().mockResolvedValue(undefined) })),
}));

// A unique, recognizable secret planted in a current.json-shaped file INSIDE the served root, so the
// "never serve the handle / a 0600 secret" pin is provable by content (not just status): if the static
// route ever serves it, the token leaks into the response body and the assertion REDs.
const PLANTED_TOKEN = 'PHASE7A-S1-PLANTED-BEARER-do-not-serve-9f3a';

describe('DaemonHttpServer — S1 static webapp route', () => {
  let webappRoot: string;

  beforeEach(() => {
    resetConfig();
    vi.clearAllMocks();
    webappRoot = mkdtempSync(join(tmpdir(), 'wigolo-webapp-'));
    writeFileSync(join(webappRoot, 'index.html'), '<!doctype html><title>wigolo studio</title><div id="app">studio shell</div><script src="/app.js"></script>');
    writeFileSync(join(webappRoot, 'app.js'), 'globalThis.__WIGOLO_STUDIO__ = true;');
    // A handle-shaped secret dropped in the served dir — the route must NEVER hand it back.
    writeFileSync(join(webappRoot, 'current.json'), JSON.stringify({ token: PLANTED_TOKEN, endpoint: 'http://127.0.0.1:1' }));
  });
  afterEach(() => {
    resetConfig();
    rmSync(webappRoot, { recursive: true, force: true });
  });

  const AUTH = { token: 'static-route-secret-token-1234567890', host: '127.0.0.1' };

  it('serves the shell HTML at GET / (open, text/html)', async () => {
    const { DaemonHttpServer } = await import('../../../src/daemon/http-server.js');
    const daemon = new DaemonHttpServer({ port: 0, host: '127.0.0.1', webappRoot });
    try {
      const url = await daemon.start();
      const resp = await fetch(`${url}/`);
      expect(resp.status).toBe(200);
      expect(resp.headers.get('content-type')).toContain('text/html');
      expect(await resp.text()).toContain('studio shell');
    } finally {
      await daemon.stop();
    }
  });

  it('serves the vendored asset at GET /app.js (text/javascript)', async () => {
    const { DaemonHttpServer } = await import('../../../src/daemon/http-server.js');
    const daemon = new DaemonHttpServer({ port: 0, host: '127.0.0.1', webappRoot });
    try {
      const url = await daemon.start();
      const resp = await fetch(`${url}/app.js`);
      expect(resp.status).toBe(200);
      expect(resp.headers.get('content-type')).toContain('javascript');
      expect(await resp.text()).toContain('__WIGOLO_STUDIO__');
    } finally {
      await daemon.stop();
    }
  });

  it('keeps GET / OPEN even when auth is enabled (the shell is public, like /health)', async () => {
    const { DaemonHttpServer } = await import('../../../src/daemon/http-server.js');
    const daemon = new DaemonHttpServer({ port: 0, host: '127.0.0.1', auth: AUTH, webappRoot });
    try {
      const url = await daemon.start();
      const resp = await fetch(`${url}/`); // no bearer
      expect(resp.status).toBe(200);
      expect(await resp.text()).toContain('studio shell');
    } finally {
      await daemon.stop();
    }
  });

  // PIN-A (SECURITY, route-order/shadow, through real dispatch): adding the static route must NOT shadow
  // the auth-gated API. A bearer-less GET /mcp must STILL be auth-rejected. NAMED mutation that REDs:
  // broaden the static matcher into a catch-all (own every path) → GET /mcp is served pre-auth → not 401.
  it('PIN-A: a bearer-less GET /mcp is STILL 401 with the static route present (no shadowing)', async () => {
    const { DaemonHttpServer } = await import('../../../src/daemon/http-server.js');
    const daemon = new DaemonHttpServer({ port: 0, host: '127.0.0.1', auth: AUTH, webappRoot });
    try {
      const url = await daemon.start();
      const resp = await fetch(`${url}/mcp`, { method: 'GET' });
      expect(resp.status).toBe(401);
    } finally {
      await daemon.stop();
    }
  });

  it('PIN-A: a bearer-less POST /mcp is STILL 401 with the static route present', async () => {
    const { DaemonHttpServer } = await import('../../../src/daemon/http-server.js');
    const daemon = new DaemonHttpServer({ port: 0, host: '127.0.0.1', auth: AUTH, webappRoot });
    try {
      const url = await daemon.start();
      const resp = await fetch(`${url}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1, params: {} }),
      });
      expect(resp.status).toBe(401);
    } finally {
      await daemon.stop();
    }
  });

  // PIN-B (SECURITY, never serve a 0600/handle secret): a .json (or any non-asset) sitting in the served
  // root is NOT served. NAMED mutation that REDs: add `json` to the served-extension allowlist → the
  // planted handle is returned and PLANTED_TOKEN leaks into the body.
  it('PIN-B: never serves current.json from the webapp root (the handle/token stays private)', async () => {
    const { DaemonHttpServer } = await import('../../../src/daemon/http-server.js');
    const daemon = new DaemonHttpServer({ port: 0, host: '127.0.0.1', webappRoot });
    try {
      const url = await daemon.start();
      const resp = await fetch(`${url}/current.json`);
      expect(resp.status).toBe(404);
      expect(await resp.text()).not.toContain(PLANTED_TOKEN);
    } finally {
      await daemon.stop();
    }
  });

  // PIN-B (traversal belt): an encoded path that tries to climb out of the served root must not escape it.
  it('PIN-B: a path-traversal attempt does not escape the served root', async () => {
    const { DaemonHttpServer } = await import('../../../src/daemon/http-server.js');
    const http = await import('node:http');
    const daemon = new DaemonHttpServer({ port: 0, host: '127.0.0.1', webappRoot });
    try {
      const url = await daemon.start();
      const parsed = new URL(url);
      // Raw request line with a traversal that decodes to ../current.json — must not return the secret.
      const body = await new Promise<string>((resolve, reject) => {
        const req = http.request({ hostname: parsed.hostname, port: parsed.port, path: '/%2e%2e/current.json', method: 'GET' }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks).toString()));
        });
        req.on('error', reject);
        req.end();
        setTimeout(() => reject(new Error('timeout')), 3000);
      });
      expect(body).not.toContain(PLANTED_TOKEN);
    } finally {
      await daemon.stop();
    }
  });

  it('unknown non-asset paths still 404 (fall-through preserved)', async () => {
    const { DaemonHttpServer } = await import('../../../src/daemon/http-server.js');
    const daemon = new DaemonHttpServer({ port: 0, host: '127.0.0.1', webappRoot });
    try {
      const url = await daemon.start();
      const resp = await fetch(`${url}/nonexistent`);
      expect(resp.status).toBe(404);
    } finally {
      await daemon.stop();
    }
  });

  it('back-compat: no static serving when webappRoot is unset (GET / → 404)', async () => {
    const { DaemonHttpServer } = await import('../../../src/daemon/http-server.js');
    const daemon = new DaemonHttpServer({ port: 0, host: '127.0.0.1' });
    try {
      const url = await daemon.start();
      const resp = await fetch(`${url}/`);
      expect(resp.status).toBe(404);
    } finally {
      await daemon.stop();
    }
  });
});
