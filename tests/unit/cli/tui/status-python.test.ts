import { describe, expect, it, vi, beforeEach } from 'vitest';

const { execSyncMock, existsSyncMock, readdirSyncMock } = vi.hoisted(() => ({
  execSyncMock: vi.fn(),
  existsSyncMock: vi.fn(),
  readdirSyncMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execSync: execSyncMock,
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: existsSyncMock, readdirSync: readdirSyncMock };
});

vi.mock('../../../../src/python-env.js', () => ({
  getPythonBin: () => '/fake/python',
}));

import { probePythonPackages } from '../../../../src/cli/tui/status-python.js';

beforeEach(() => {
  execSyncMock.mockReset();
  existsSyncMock.mockReset();
  readdirSyncMock.mockReset();
});

describe('probePythonPackages', () => {
  it('marks each package ok when every probe succeeds', () => {
    execSyncMock.mockReturnValue(Buffer.from(''));
    existsSyncMock.mockReturnValue(true);
    readdirSyncMock.mockReturnValue(['model.onnx'] as unknown as ReturnType<typeof readdirSyncMock>);

    const result = probePythonPackages('/tmp/data');

    expect(result.reranker).toBe('ok');
    expect(result.trafilatura).toBe('ok');
    expect(result.embeddings).toBe('ok');
  });

  it('marks each package missing when its probe fails', () => {
    execSyncMock.mockImplementation(() => { throw new Error('ModuleNotFoundError'); });
    existsSyncMock.mockReturnValue(false);
    readdirSyncMock.mockReturnValue([] as unknown as ReturnType<typeof readdirSyncMock>);

    const result = probePythonPackages('/tmp/data');

    expect(result.reranker).toBe('missing');
    expect(result.trafilatura).toBe('missing');
    expect(result.embeddings).toBe('missing');
  });

  it('marks reranker missing but trafilatura ok (per-package failure isolation)', () => {
    existsSyncMock.mockReturnValue(false);
    execSyncMock.mockImplementation(() => Buffer.from(''));
    readdirSyncMock.mockReturnValue([] as unknown as ReturnType<typeof readdirSyncMock>);

    const result = probePythonPackages('/tmp/data');

    expect(result.reranker).toBe('missing');
    expect(result.trafilatura).toBe('ok');
    expect(result.embeddings).toBe('missing');
  });
});
