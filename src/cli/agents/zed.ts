import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { mergeMcpJson, removeMcpJson, mergeBlock, removeBlock, readAsset } from './utils.js';

const MCP_KEY_PATH = ['context_servers', 'wigolo'];

function zedConfigDir(): string {
  return join(homedir(), '.config', 'zed');
}

function detect(): boolean {
  if (existsSync(zedConfigDir())) return true;
  try {
    execSync('which zed', { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

async function installMcp(cmd: { command: string; args: string[] }): Promise<void> {
  const configPath = join(zedConfigDir(), 'settings.json');
  mkdirSync(zedConfigDir(), { recursive: true });
  mergeMcpJson(configPath, { command: cmd.command, args: cmd.args }, MCP_KEY_PATH);
}

async function installInstructions(): Promise<void> {
  const block = readAsset('blocks/zed/settings.json.block');
  const instructionsDir = join(zedConfigDir(), 'instructions');
  mkdirSync(instructionsDir, { recursive: true });
  const target = join(instructionsDir, 'wigolo.md');
  mergeBlock(target, block);
}

async function uninstall(): Promise<{ removed: string[] }> {
  const removed: string[] = [];

  const configPath = join(zedConfigDir(), 'settings.json');
  if (existsSync(configPath)) {
    removeMcpJson(configPath, MCP_KEY_PATH);
    removed.push('~/.config/zed/settings.json (wigolo context_servers entry)');
  }

  const instructionsFile = join(zedConfigDir(), 'instructions', 'wigolo.md');
  if (existsSync(instructionsFile)) {
    try {
      rmSync(instructionsFile);
      removed.push('~/.config/zed/instructions/wigolo.md');
    } catch {
      if (removeBlock(instructionsFile)) {
        removed.push('~/.config/zed/instructions/wigolo.md block');
      }
    }
  }

  return { removed };
}

export const zedHandler = {
  id: 'zed' as const,
  displayName: 'Zed',
  supportsSkills: false,
  supportsCommands: false,
  detect,
  installMcp,
  installInstructions,
  uninstall,
};
