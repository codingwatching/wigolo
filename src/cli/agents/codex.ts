import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { parse as parseToml, stringify as stringifyToml } from '@iarna/toml';
import { mergeBlock, removeBlock, readAsset } from './utils.js';

const TOML_TABLE_PATH = ['mcp_servers', 'wigolo'];

function codexDir(): string {
  return join(homedir(), '.codex');
}

function detect(): boolean {
  if (existsSync(codexDir())) return true;
  try {
    execSync('which codex', { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function mergeTomlEntry(
  configPath: string,
  tablePath: string[],
  entry: Record<string, unknown>,
): void {
  mkdirSync(dirname(configPath), { recursive: true });

  let root: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      if (raw.trim().length > 0) {
        root = parseToml(raw) as Record<string, unknown>;
      }
    } catch {
      root = {};
    }
  }

  let obj = root;
  for (let i = 0; i < tablePath.length - 1; i++) {
    const k = tablePath[i];
    if (typeof obj[k] !== 'object' || obj[k] === null) {
      obj[k] = {};
    }
    obj = obj[k] as Record<string, unknown>;
  }
  obj[tablePath[tablePath.length - 1]] = entry;

  writeFileSync(configPath, stringifyToml(root as Parameters<typeof stringifyToml>[0]));
}

function removeTomlEntry(configPath: string, tablePath: string[]): void {
  if (!existsSync(configPath)) return;

  let root: Record<string, unknown>;
  try {
    root = parseToml(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return;
  }

  let obj = root;
  for (let i = 0; i < tablePath.length - 1; i++) {
    const k = tablePath[i];
    if (typeof obj[k] !== 'object' || obj[k] === null) return;
    obj = obj[k] as Record<string, unknown>;
  }
  delete obj[tablePath[tablePath.length - 1]];

  writeFileSync(configPath, stringifyToml(root as Parameters<typeof stringifyToml>[0]));
}

async function installMcp(cmd: { command: string; args: string[] }): Promise<void> {
  const dir = codexDir();
  mkdirSync(dir, { recursive: true });
  mergeTomlEntry(join(dir, 'config.toml'), TOML_TABLE_PATH, {
    command: cmd.command,
    args: cmd.args,
  });
}

async function installInstructions(): Promise<void> {
  const block = readAsset('blocks/codex/AGENTS.md.block');
  // Codex reads AGENTS.md from CWD or home directory
  const target = join(process.cwd(), 'AGENTS.md');
  mergeBlock(target, block);
}

async function uninstall(): Promise<{ removed: string[] }> {
  const removed: string[] = [];

  const configPath = join(codexDir(), 'config.toml');
  if (existsSync(configPath)) {
    removeTomlEntry(configPath, TOML_TABLE_PATH);
    removed.push('~/.codex/config.toml (wigolo mcp_servers entry)');
  }

  const agentsMd = join(process.cwd(), 'AGENTS.md');
  if (existsSync(agentsMd) && removeBlock(agentsMd)) {
    removed.push('AGENTS.md block');
  }

  return { removed };
}

export const codexHandler = {
  id: 'codex' as const,
  displayName: 'Codex (OpenAI CLI)',
  supportsSkills: false,
  supportsCommands: false,
  detect,
  installMcp,
  installInstructions,
  uninstall,
};
