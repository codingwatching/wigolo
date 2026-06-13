import { describe, it, expect, vi, afterEach } from 'vitest';
import { anySignal, timeoutSignal, abortRejection } from '../../../src/util/abort.js';

afterEach(() => vi.useRealTimers());

describe('timeoutSignal', () => {
  it('aborts with a TimeoutError DOMException carrying the label after ms', () => {
    vi.useFakeTimers();
    const { signal } = timeoutSignal(3000, 'timeout');
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(DOMException);
    expect((signal.reason as DOMException).name).toBe('TimeoutError');
    expect((signal.reason as DOMException).message).toBe('timeout');
  });

  it('cancel() prevents the abort and clears the timer', () => {
    vi.useFakeTimers();
    const { signal, cancel } = timeoutSignal(3000, 'timeout');
    cancel();
    vi.advanceTimersByTime(5000);
    expect(signal.aborted).toBe(false);
  });
});

describe('anySignal', () => {
  it('aborts when the first input aborts and propagates its reason', () => {
    const a = new AbortController();
    const b = new AbortController();
    const { signal } = anySignal([a.signal, b.signal]);
    a.abort(new DOMException('stage_timeout', 'AbortError'));
    expect(signal.aborted).toBe(true);
    expect((signal.reason as DOMException).message).toBe('stage_timeout');
  });

  it('is already aborted if an input is already aborted', () => {
    const a = new AbortController();
    a.abort(new DOMException('timeout', 'TimeoutError'));
    const { signal } = anySignal([a.signal]);
    expect(signal.aborted).toBe(true);
    expect((signal.reason as DOMException).message).toBe('timeout');
  });

  it('cleanup() removes listeners from all inputs (no accumulation on a shared signal)', () => {
    const shared = new AbortController();
    const add = vi.spyOn(shared.signal, 'addEventListener');
    const remove = vi.spyOn(shared.signal, 'removeEventListener');
    const combos = Array.from({ length: 5 }, () => anySignal([shared.signal]));
    expect(add).toHaveBeenCalledTimes(5);
    combos.forEach((c) => c.cleanup());
    expect(remove).toHaveBeenCalledTimes(5);
  });
});

describe('abortRejection', () => {
  it('rejects with the reason when the signal aborts', async () => {
    const ac = new AbortController();
    const p = abortRejection(ac.signal);
    ac.abort(new DOMException('stage_timeout', 'AbortError'));
    await expect(p).rejects.toMatchObject({ message: 'stage_timeout' });
  });

  it('rejects synchronously if already aborted', async () => {
    const ac = new AbortController();
    ac.abort(new DOMException('timeout', 'TimeoutError'));
    await expect(abortRejection(ac.signal)).rejects.toMatchObject({ message: 'timeout' });
  });

  it('never settles when no signal is given', async () => {
    const race = await Promise.race([
      abortRejection(undefined).then(() => 'settled', () => 'rejected'),
      Promise.resolve('pending'),
    ]);
    expect(race).toBe('pending');
  });
});
