import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import type { ArtifactDelta } from 'wigolo/studio';

/**
 * Client for the studio DB broker (a plain-Node child process that owns the cache DB — the Electron
 * main must never load a native module, spec §13.7/§13.9). Talks newline-delimited JSON-RPC over the
 * child's stdio. §11 resilience: fail-fast (a down/silent broker rejects, never hangs), respawn with
 * backoff on an unexpected exit.
 */
export interface BrokerClient {
  ready(): Promise<void>;
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
  onArtifact(handler: (delta: ArtifactDelta) => void): void;
  stop(): Promise<void>;
}

type SpawnFn = (cmd: string, args: string[], opts: object) => ChildProcess;

export interface BrokerClientOptions {
  dataDir?: string;
  nodePath?: string;
  brokerPath?: string;
  spawnFn?: SpawnFn;
  callTimeoutMs?: number;
  bootTimeoutMs?: number;
}

/** The built broker entry, resolved via the `wigolo/studio-db-broker` export subpath (spawned, not imported). */
export function resolveBrokerPath(): string {
  return createRequire(import.meta.url).resolve('wigolo/studio-db-broker');
}
/**
 * MUST be a real Node binary (Node ABI). Electron's own binary (`process.execPath`) is Electron ABI and
 * would fail to load better-sqlite3; `ELECTRON_RUN_AS_NODE` does not change that. Fall back to PATH `node`.
 */
export function resolveNodePath(): string {
  return process.env.WIGOLO_STUDIO_BROKER_NODE || process.env.npm_node_execpath || 'node';
}

export function createBrokerClient(opts: BrokerClientOptions = {}): BrokerClient {
  const spawnFn = opts.spawnFn ?? (nodeSpawn as unknown as SpawnFn);
  const nodePath = opts.nodePath ?? resolveNodePath();
  // Resolving the broker entry must NEVER crash app boot — a failure here degrades captures to
  // `capture_unavailable` (§11), it does not take down the human UI or the P1/P2 agent line.
  let brokerPath: string;
  try {
    brokerPath = opts.brokerPath ?? resolveBrokerPath();
  } catch {
    return {
      ready: () => Promise.reject(new Error('studio background service unavailable')),
      call: () => Promise.reject(new Error('studio background service unavailable')),
      onArtifact: () => { /* never fires */ },
      stop: async () => { /* nothing to stop */ },
    };
  }
  const callTimeoutMs = opts.callTimeoutMs ?? 15_000;
  const bootTimeoutMs = opts.bootTimeoutMs ?? 20_000;

  let child: ChildProcess | null = null;
  let nextId = 1;
  let buf = '';
  let stopped = false;
  let backoff = 250;
  let readyResolve: (() => void) | null = null;
  let readyPromise: Promise<void> = new Promise((r) => { readyResolve = r; });
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const artifactHandlers: Array<(d: ArtifactDelta) => void> = [];

  const rejectAllPending = (reason: string): void => {
    for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error(reason)); }
    pending.clear();
  };

  const onLine = (line: string): void => {
    if (!line.trim()) return;
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(line) as Record<string, unknown>; } catch { return; }
    if (msg.notify === 'ready') { readyResolve?.(); return; }
    if (msg.notify === 'artifact') { for (const h of artifactHandlers) h(msg.delta as ArtifactDelta); return; }
    const id = msg.id as number | undefined;
    if (id == null) return;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error((msg.error as { message?: string })?.message ?? 'broker error'));
  };

  const start = (): void => {
    try {
      child = spawnFn(nodePath, [brokerPath], {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: { ...process.env, WIGOLO_STUDIO_BROKER_MAIN: '1', ...(opts.dataDir ? { WIGOLO_DATA_DIR: opts.dataDir } : {}) },
      });
    } catch {
      // spawn failed (e.g. no node on PATH) — schedule a backoff retry; call()/ready() reject meanwhile.
      child = null;
      if (!stopped) { setTimeout(() => { if (!stopped) start(); }, backoff); backoff = Math.min(backoff * 2, 5_000); }
      return;
    }
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); onLine(line); }
    });
    child.on('exit', () => {
      rejectAllPending('studio background service exited');
      if (stopped) return;
      readyPromise = new Promise((r) => { readyResolve = r; });
      setTimeout(() => { if (!stopped) start(); }, backoff);
      backoff = Math.min(backoff * 2, 5_000);
    });
  };
  start();

  const bootGuard = <T>(pr: Promise<T>): Promise<T> =>
    Promise.race([pr, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('studio background service not ready')), bootTimeoutMs))]);

  return {
    ready: () => bootGuard(readyPromise),
    async call<T>(method: string, params?: unknown): Promise<T> {
      await this.ready();
      if (!child || child.exitCode != null) throw new Error('studio background service unavailable');
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('studio background service timed out')); }, callTimeoutMs);
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
        child!.stdin?.write(JSON.stringify({ id, method, params }) + '\n');
      });
    },
    onArtifact(handler) { artifactHandlers.push(handler); },
    async stop() { stopped = true; rejectAllPending('stopped'); child?.kill(); child = null; },
  };
}
