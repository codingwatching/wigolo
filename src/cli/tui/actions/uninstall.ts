/**
 * uninstall action — removes the wigolo data directory and calls each
 * detected agent handler's uninstall to unwire MCP configs.
 *
 * Contract:
 *   - Requires confirmed=true; without it returns ok=false with a
 *     confirmation-required error (TUI gates via dialog, headless via --yes).
 *   - Calls detectInstalledHandlers() from SP7's registry.
 *   - Each handler's uninstall() is called; failures are captured in
 *     agentResults but do NOT abort the data-dir removal.
 *   - Removing a non-existent data dir is safe (idempotent).
 */
import { existsSync, rmSync } from 'node:fs';
import { detectInstalledHandlers } from '../../../cli/agents/registry.js';

export interface AgentUninstallResult {
  agentId: string;
  displayName: string;
  removed: string[];
  error?: string;
}

export interface UninstallOptions {
  dataDir: string;
  /** Must be true to proceed. TUI gates with confirmation dialog; headless --yes sets this. */
  confirmed: boolean;
}

export interface UninstallResult {
  ok: boolean;
  dataDirRemoved: boolean;
  agentResults: AgentUninstallResult[];
  error?: string;
}

export async function uninstall(opts: UninstallOptions): Promise<UninstallResult> {
  const { dataDir, confirmed } = opts;

  if (!confirmed) {
    return {
      ok: false,
      dataDirRemoved: false,
      agentResults: [],
      error: 'Uninstall requires confirmation. Pass confirmed: true or use --yes flag.',
    };
  }

  const agentResults: AgentUninstallResult[] = [];

  // Call agent uninstallers first (so they can clean up before data dir is gone)
  const handlers = detectInstalledHandlers();
  for (const handler of handlers) {
    try {
      const res = await handler.uninstall();
      agentResults.push({
        agentId: handler.id,
        displayName: handler.displayName,
        removed: res.removed,
      });
    } catch (err) {
      agentResults.push({
        agentId: handler.id,
        displayName: handler.displayName,
        removed: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Remove data dir
  let dataDirRemoved = false;
  try {
    if (existsSync(dataDir)) {
      rmSync(dataDir, { recursive: true, force: true });
      dataDirRemoved = true;
    } else {
      // Already absent — idempotent
      dataDirRemoved = true;
    }
  } catch (err) {
    return {
      ok: false,
      dataDirRemoved: false,
      agentResults,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    ok: true,
    dataDirRemoved,
    agentResults,
  };
}
