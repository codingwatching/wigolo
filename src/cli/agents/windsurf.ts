import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { mergeMcpJson, removeMcpJson, mergeBlock, removeBlock, readAsset } from './utils.js';

const MCP_KEY_PATH = ['mcpServers', 'wigolo'];

function windsurfDir(): string {
  return join(homedir(), '.codeium', 'windsurf');
}

function detect(): boolean {
  const home = homedir();
  if (existsSync(join(home, '.codeium', 'windsurf'))) return true;
  if (existsSync(join(home, '.windsurf'))) return true;
  try {
    execSync('which windsurf', { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

async function installMcp(cmd: { command: string; args: string[] }): Promise<void> {
  const dir = windsurfDir();
  mkdirSync(dir, { recursive: true });
  const configPath = join(dir, 'mcp_config.json');
  mergeMcpJson(configPath, { command: cmd.command, args: cmd.args }, MCP_KEY_PATH);
}

async function installInstructions(): Promise<void> {
  const block = readAsset('blocks/windsurf/mcp_config.json.block');
  const dir = windsurfDir();
  mkdirSync(dir, { recursive: true });
  const target = join(dir, 'wigolo-instructions.md');
  mergeBlock(target, block);
}

async function uninstall(): Promise<{ removed: string[] }> {
  const removed: string[] = [];

  const configPath = join(windsurfDir(), 'mcp_config.json');
  if (existsSync(configPath)) {
    removeMcpJson(configPath, MCP_KEY_PATH);
    removed.push('~/.codeium/windsurf/mcp_config.json (wigolo entry)');
  }

  const instructionsFile = join(windsurfDir(), 'wigolo-instructions.md');
  if (existsSync(instructionsFile) && removeBlock(instructionsFile)) {
    removed.push('~/.codeium/windsurf/wigolo-instructions.md block');
  }

  return { removed };
}

export const windsurfHandler = {
  id: 'windsurf' as const,
  displayName: 'Windsurf',
  supportsSkills: false,
  supportsCommands: false,
  detect,
  installMcp,
  installInstructions,
  uninstall,
};
