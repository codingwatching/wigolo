import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const skip = !process.env.WIGOLO_RERANKER_TEST;

// vi.spyOn() on a `node:child_process` import fails under vitest's ESM loader
// (the module namespace is frozen — "Cannot redefine property: spawn"). The
// hoisted vi.mock() below replaces the module so spawnSpy records every call
// while still delegating to the real child_process.spawn implementation.
const spawnSpy = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  // Forward calls to the real spawn so subprocesses actually launch, while
  // also recording every call on spawnSpy for assertion.
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      spawnSpy(...args);
      return actual.spawn(...args);
    },
  };
});

// Imported AFTER vi.mock so they see the mocked module (vi.mock is hoisted by
// vitest, but keeping these here keeps the dependency order explicit).
const { onnxRerank } = await import('../../src/search/reranker/onnx.js');
const { resetAllRerankSubprocesses } = await import('../../src/python/reranker-subprocess.js');

describe.skipIf(skip)('integration: rerank spawns python subprocess', () => {
  beforeEach(() => {
    resetAllRerankSubprocesses();
    spawnSpy.mockClear();
  });
  afterEach(() => resetAllRerankSubprocesses());

  it('first onnxRerank spawns one python subprocess; second reuses', async () => {
    await onnxRerank('test query', [
      { text: 'doc 1' },
      { text: 'doc 2' },
    ]);
    const pyCallsAfter1 = spawnSpy.mock.calls.filter(([cmd]) =>
      typeof cmd === 'string' && /python/.test(cmd),
    ).length;
    expect(pyCallsAfter1).toBe(1);
    await onnxRerank('test query 2', [{ text: 'doc 3' }]);
    const pyCallsAfter2 = spawnSpy.mock.calls.filter(([cmd]) =>
      typeof cmd === 'string' && /python/.test(cmd),
    ).length;
    expect(pyCallsAfter2).toBe(1);
  });
});
