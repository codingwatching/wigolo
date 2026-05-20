import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getPythonBin } from '../../python-env.js';

export interface PythonProbeResult {
  reranker: 'ok' | 'missing';
  trafilatura: 'ok' | 'missing';
  embeddings: 'ok' | 'missing';
}

const PROBE_TIMEOUT_MS = 10000;

export function probePythonPackages(dataDir: string): PythonProbeResult {
  const py = getPythonBin(dataDir);
  return {
    reranker: probeRerankerCache(dataDir),
    trafilatura: tryImport(py, 'trafilatura'),
    embeddings: probeFastembedCache(dataDir),
  };
}

function probeRerankerCache(dataDir: string): 'ok' | 'missing' {
  // Transformers.js writes the cross-encoder model under
  // `<dataDir>/transformers/`. Presence of that directory with content
  // is a good proxy for "model has been downloaded at least once".
  const cacheDir = join(dataDir, 'transformers');
  if (!existsSync(cacheDir)) return 'missing';
  try {
    return readdirSync(cacheDir).length > 0 ? 'ok' : 'missing';
  } catch {
    return 'missing';
  }
}

function probeFastembedCache(dataDir: string): 'ok' | 'missing' {
  const cacheDir = join(dataDir, 'fastembed');
  if (!existsSync(cacheDir)) return 'missing';
  try {
    return readdirSync(cacheDir).length > 0 ? 'ok' : 'missing';
  } catch {
    return 'missing';
  }
}

function tryImport(py: string, moduleName: string): 'ok' | 'missing' {
  try {
    execSync(`${py} -c "import ${moduleName}"`, {
      stdio: 'pipe',
      timeout: PROBE_TIMEOUT_MS,
    });
    return 'ok';
  } catch {
    return 'missing';
  }
}
