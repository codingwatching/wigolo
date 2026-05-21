import { describe, it, expect, afterEach, vi } from 'vitest';
import { createLogger, setLogSuppression, getLogSuppression } from '../../src/logger.js';

describe('logger suppression floor', () => {
  afterEach(() => {
    setLogSuppression(null);
    vi.restoreAllMocks();
  });

  it('default is null (no suppression beyond config level)', () => {
    expect(getLogSuppression()).toBeNull();
  });

  it('setLogSuppression("warn") drops info and debug calls', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const log = createLogger('cache');

    setLogSuppression('warn');
    log.debug('deb');
    log.info('inf');
    log.warn('wrn');
    log.error('err');

    const lines = spy.mock.calls.map(c => String(c[0]));
    expect(lines.some(l => l.includes('"msg":"deb"'))).toBe(false);
    expect(lines.some(l => l.includes('"msg":"inf"'))).toBe(false);
    expect(lines.some(l => l.includes('"msg":"wrn"'))).toBe(true);
    expect(lines.some(l => l.includes('"msg":"err"'))).toBe(true);
  });

  it('setLogSuppression(null) restores normal flow', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const log = createLogger('cache');

    setLogSuppression('warn');
    log.info('blocked');
    setLogSuppression(null);
    log.info('allowed');

    const lines = spy.mock.calls.map(c => String(c[0]));
    expect(lines.some(l => l.includes('"msg":"blocked"'))).toBe(false);
    expect(lines.some(l => l.includes('"msg":"allowed"'))).toBe(true);
  });

  it('setLogSuppression("error") drops warn as well', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const log = createLogger('cache');

    setLogSuppression('error');
    log.warn('wrn');
    log.error('err');

    const lines = spy.mock.calls.map(c => String(c[0]));
    expect(lines.some(l => l.includes('"msg":"wrn"'))).toBe(false);
    expect(lines.some(l => l.includes('"msg":"err"'))).toBe(true);
  });
});
