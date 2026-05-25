import { describe, it, expect } from 'vitest';
import { guardUrl } from '../../../src/watch/ssrf.js';

/**
 * WHY this matters: the `watch` tool fetches `url` on an interval AND, when
 * `notification` is a webhook URL, POSTs the diff to that URL on every
 * change. Without an SSRF guard, a hostile job could probe the local
 * network (cloud metadata endpoints, internal services, loopback admin
 * panels) and exfiltrate data. The guard must run at registration time so
 * a bad URL never makes it into persistent state; otherwise a daemon
 * restart re-introduces the vulnerability.
 *
 * These tests pin the explicit reject list called out in the slice spec:
 *   - http://localhost / 127.0.0.1 / ::1 / 0.0.0.0
 *   - RFC 1918 private ranges (10/8, 172.16/12, 192.168/16)
 *   - link-local (169.254/16)
 *   - non-http(s) schemes
 */
describe('guardUrl SSRF', () => {
  describe('accepts public http(s) URLs', () => {
    it('accepts a vanilla https URL', () => {
      const r = guardUrl('https://example.com/path', 'url');
      expect(r.ok).toBe(true);
    });

    it('accepts a vanilla http URL', () => {
      const r = guardUrl('http://example.com/', 'url');
      expect(r.ok).toBe(true);
    });

    it('accepts a public IPv4 hostname', () => {
      const r = guardUrl('https://8.8.8.8/', 'url');
      expect(r.ok).toBe(true);
    });

    it('accepts a query string and fragment', () => {
      const r = guardUrl('https://example.com/page?q=1#frag', 'url');
      expect(r.ok).toBe(true);
    });
  });

  describe('rejects loopback hostnames', () => {
    it('rejects http://localhost', () => {
      const r = guardUrl('http://localhost', 'url');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/loopback|private/i);
    });

    it('rejects http://localhost:3000', () => {
      const r = guardUrl('http://localhost:3000/api', 'url');
      expect(r.ok).toBe(false);
    });

    it('rejects http://127.0.0.1', () => {
      const r = guardUrl('http://127.0.0.1/', 'url');
      expect(r.ok).toBe(false);
    });

    it('rejects http://127.1.2.3 (still in 127/8)', () => {
      const r = guardUrl('http://127.1.2.3/', 'url');
      expect(r.ok).toBe(false);
    });

    it('rejects http://[::1]/', () => {
      const r = guardUrl('http://[::1]/', 'url');
      expect(r.ok).toBe(false);
    });

    it('rejects http://0.0.0.0/', () => {
      const r = guardUrl('http://0.0.0.0/', 'url');
      expect(r.ok).toBe(false);
    });
  });

  describe('rejects RFC 1918 private ranges', () => {
    it('rejects 10.x.x.x', () => {
      const r = guardUrl('http://10.0.0.5/', 'url');
      expect(r.ok).toBe(false);
    });

    it('rejects 172.16.x.x', () => {
      const r = guardUrl('http://172.16.0.1/', 'url');
      expect(r.ok).toBe(false);
    });

    it('rejects 172.31.x.x (top of 172.16/12)', () => {
      const r = guardUrl('http://172.31.255.255/', 'url');
      expect(r.ok).toBe(false);
    });

    it('accepts 172.15.x.x (just outside 172.16/12)', () => {
      const r = guardUrl('http://172.15.0.1/', 'url');
      expect(r.ok).toBe(true);
    });

    it('accepts 172.32.x.x (just outside 172.16/12)', () => {
      const r = guardUrl('http://172.32.0.1/', 'url');
      expect(r.ok).toBe(true);
    });

    it('rejects 192.168.x.x', () => {
      const r = guardUrl('http://192.168.1.1/', 'url');
      expect(r.ok).toBe(false);
    });
  });

  describe('rejects link-local 169.254/16', () => {
    it('rejects 169.254.169.254 (AWS metadata)', () => {
      const r = guardUrl('http://169.254.169.254/latest/meta-data/', 'url');
      expect(r.ok).toBe(false);
    });
  });

  describe('rejects non-http(s) schemes', () => {
    it('rejects file://', () => {
      const r = guardUrl('file:///etc/passwd', 'url');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/protocol/i);
    });

    it('rejects ftp://', () => {
      const r = guardUrl('ftp://example.com/', 'url');
      expect(r.ok).toBe(false);
    });

    it('rejects data:', () => {
      const r = guardUrl('data:text/plain,hello', 'url');
      expect(r.ok).toBe(false);
    });

    it('rejects gopher://', () => {
      const r = guardUrl('gopher://example.com/', 'url');
      expect(r.ok).toBe(false);
    });

    it('rejects javascript:', () => {
      const r = guardUrl('javascript:alert(1)', 'url');
      expect(r.ok).toBe(false);
    });
  });

  describe('rejects IPv6 private ranges', () => {
    it('rejects link-local fe80::', () => {
      const r = guardUrl('http://[fe80::1]/', 'url');
      expect(r.ok).toBe(false);
    });

    it('rejects unique-local fc00::', () => {
      const r = guardUrl('http://[fc00::1]/', 'url');
      expect(r.ok).toBe(false);
    });

    it('rejects fd00:: (also unique-local)', () => {
      const r = guardUrl('http://[fd12:3456:789a::1]/', 'url');
      expect(r.ok).toBe(false);
    });

    it('rejects IPv4-mapped loopback ::ffff:127.0.0.1', () => {
      const r = guardUrl('http://[::ffff:127.0.0.1]/', 'url');
      expect(r.ok).toBe(false);
    });
  });

  describe('rejects malformed inputs', () => {
    it('rejects an empty string', () => {
      const r = guardUrl('', 'url');
      expect(r.ok).toBe(false);
    });

    it('rejects whitespace-only', () => {
      const r = guardUrl('   ', 'url');
      expect(r.ok).toBe(false);
    });

    it('rejects garbage that does not parse as a URL', () => {
      const r = guardUrl('not a url', 'url');
      expect(r.ok).toBe(false);
    });
  });

  describe('field label is reflected in the error', () => {
    it('uses the supplied label so the caller knows which field failed', () => {
      const r = guardUrl('http://localhost', 'notification');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain('notification');
    });
  });
});
