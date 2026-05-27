/**
 * `wigolo config` / `wigolo dashboard` — reconfigure and management entry.
 *
 * In interactive TTY mode, mounts the Ink main-menu router (runInkConfig).
 * In non-TTY / --plain / --non-interactive mode, prints a summary of current
 * settings and exits cleanly (headless parity requirement §8).
 *
 * SP5 headless flags (non-interactive parity):
 *   --export [path]      Export config to file (default: ~/wigolo-config-export.json)
 *   --import <path>      Import config from file
 *   --cleanup <component> Cleanup a component (cache|embeddings|models|browser|searxng)
 *   --uninstall [--yes]  Full uninstall (requires --yes to skip confirmation)
 *   --storage            Print storage usage map
 *   --cache-stats        Print cache statistics
 *
 * HARD invariant: NEVER called from the MCP stdio path. Only mounted here,
 * from `init`, and from `doctor --interactive`.
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getConfig } from '../config.js';

const CONFIG_USAGE = [
  'Usage: wigolo config [options]',
  '',
  'Opens the interactive reconfiguration menu.',
  '',
  'Options:',
  '  --plain, -p              Print current settings and exit (non-interactive)',
  '  --storage                Print storage usage map',
  '  --cache-stats            Print cache statistics',
  '  --export [path]          Export config to file (secrets excluded)',
  '  --import <path>          Import config from file',
  '  --cleanup <component>    Free storage for: cache|embeddings|models|browser|searxng',
  '  --uninstall              Full uninstall (requires --yes)',
  '  --yes                    Skip interactive confirmation (use with --uninstall)',
  '  --help, -h               Show this message',
  '',
].join('\n');

const CLEANABLE = new Set(['cache', 'embeddings', 'models', 'browser', 'searxng']);

interface ConfigFlags {
  plain: boolean;
  help: boolean;
  storage: boolean;
  cacheStats: boolean;
  export: string | null;  // path or null (use default when flag present, undefined when absent)
  exportRequested: boolean;
  import: string | null;
  cleanup: string | null;
  uninstall: boolean;
  yes: boolean;
}

function parseConfigFlags(args: string[]): ConfigFlags {
  const flags: ConfigFlags = {
    plain: false,
    help: false,
    storage: false,
    cacheStats: false,
    export: null,
    exportRequested: false,
    import: null,
    cleanup: null,
    uninstall: false,
    yes: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (!arg) { i++; continue; }

    if (arg === '--plain' || arg === '-p') { flags.plain = true; i++; continue; }
    if (arg === '--help' || arg === '-h') { flags.help = true; i++; continue; }
    if (arg === '--storage') { flags.storage = true; i++; continue; }
    if (arg === '--cache-stats') { flags.cacheStats = true; i++; continue; }
    if (arg === '--yes' || arg === '-y') { flags.yes = true; i++; continue; }
    if (arg === '--uninstall') { flags.uninstall = true; i++; continue; }

    if (arg === '--export') {
      flags.exportRequested = true;
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        flags.export = next;
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    if (arg.startsWith('--export=')) {
      flags.exportRequested = true;
      flags.export = arg.slice('--export='.length) || null;
      i++;
      continue;
    }

    if (arg === '--import') {
      const next = args[i + 1];
      if (!next || next.startsWith('-')) {
        process.stderr.write('--import requires a path argument\n');
        process.exit(1);
      }
      flags.import = next;
      i += 2;
      continue;
    }
    if (arg.startsWith('--import=')) {
      flags.import = arg.slice('--import='.length);
      i++;
      continue;
    }

    if (arg === '--cleanup') {
      const next = args[i + 1];
      if (!next || next.startsWith('-')) {
        process.stderr.write(`--cleanup requires a component: ${[...CLEANABLE].join('|')}\n`);
        process.exit(1);
      }
      flags.cleanup = next;
      i += 2;
      continue;
    }
    if (arg.startsWith('--cleanup=')) {
      flags.cleanup = arg.slice('--cleanup='.length);
      i++;
      continue;
    }

    // unknown flag — ignore (forward-compat)
    i++;
  }

  return flags;
}

export async function runConfig(args: string[]): Promise<number> {
  const flags = parseConfigFlags(args);

  if (flags.help) {
    process.stderr.write(CONFIG_USAGE);
    return 0;
  }

  // ----- Headless SP5 actions -----

  if (flags.storage) {
    const { computeStorage } = await import('./tui/actions/index.js');
    const config = getConfig();
    const result = await computeStorage(config.dataDir);
    process.stdout.write('Storage usage\n');
    process.stdout.write('=============\n');
    for (const item of result.items) {
      const mb = (item.bytes / (1024 * 1024)).toFixed(2);
      process.stdout.write(`  ${item.label.padEnd(24)} ${mb} MB\n`);
    }
    process.stdout.write(`\n  ${'Total'.padEnd(24)} ${(result.totalBytes / (1024 * 1024)).toFixed(2)} MB\n`);
    return 0;
  }

  if (flags.cacheStats) {
    const { getCacheStatsAction } = await import('./tui/actions/index.js');
    const stats = await getCacheStatsAction();
    if (stats.error) {
      process.stderr.write(`Cache stats error: ${stats.error}\n`);
      return 1;
    }
    process.stdout.write('Cache statistics\n');
    process.stdout.write('================\n');
    process.stdout.write(`  Entries: ${stats.totalEntries}\n`);
    process.stdout.write(`  Size:    ${stats.sizeMb.toFixed(2)} MB\n`);
    if (stats.oldest) process.stdout.write(`  Oldest:  ${stats.oldest}\n`);
    if (stats.newest) process.stdout.write(`  Newest:  ${stats.newest}\n`);
    return 0;
  }

  if (flags.exportRequested) {
    const { exportConfig } = await import('./tui/actions/index.js');
    const defaultPath = join(homedir(), 'wigolo-config-export.json');
    const exportPath = flags.export ?? defaultPath;
    const config = getConfig();
    const configPath = process.env.WIGOLO_CONFIG_PATH ?? join(homedir(), '.wigolo', 'config.json');
    const result = await exportConfig(exportPath, configPath);
    if (result.ok) {
      process.stdout.write(`Config exported to ${exportPath} (secrets excluded)\n`);
      return 0;
    }
    process.stderr.write(`Export failed: ${result.error}\n`);
    return 1;
  }

  if (flags.import !== null) {
    const { importConfig } = await import('./tui/actions/index.js');
    const configPath = process.env.WIGOLO_CONFIG_PATH ?? join(homedir(), '.wigolo', 'config.json');
    const result = await importConfig(flags.import, configPath);
    if (result.ok) {
      process.stdout.write(`Config imported from ${flags.import}\n`);
      return 0;
    }
    process.stderr.write(`Import failed: ${result.error}\n`);
    return 1;
  }

  if (flags.cleanup !== null) {
    const component = flags.cleanup;
    if (!CLEANABLE.has(component)) {
      process.stderr.write(`Unknown component: ${component}. Valid: ${[...CLEANABLE].join(', ')}\n`);
      return 1;
    }
    const { cleanupComponent } = await import('./tui/actions/index.js');
    const config = getConfig();
    const result = await cleanupComponent(
      component as 'cache' | 'embeddings' | 'models' | 'browser' | 'searxng',
      config.dataDir,
    );
    if (result.ok) {
      const mb = (result.freedBytes / (1024 * 1024)).toFixed(2);
      process.stdout.write(`Cleaned ${component}: freed ${mb} MB\n`);
      return 0;
    }
    process.stderr.write(`Cleanup failed: ${result.error}\n`);
    return 1;
  }

  if (flags.uninstall) {
    if (!flags.yes) {
      process.stderr.write(
        'Uninstall requires confirmation. Use --uninstall --yes to proceed.\n',
      );
      return 1;
    }
    const { uninstall } = await import('./tui/actions/index.js');
    const config = getConfig();
    const result = await uninstall({ dataDir: config.dataDir, confirmed: true });
    if (result.dataDirRemoved) {
      process.stdout.write(`Removed data directory: ${config.dataDir}\n`);
    }
    for (const ar of result.agentResults) {
      if (ar.error) {
        process.stderr.write(`${ar.displayName}: error — ${ar.error}\n`);
      } else if (ar.removed.length > 0) {
        process.stdout.write(`${ar.displayName}: removed ${ar.removed.join(', ')}\n`);
      }
    }
    if (!result.ok) {
      process.stderr.write(`Uninstall error: ${result.error}\n`);
      return 1;
    }
    process.stdout.write('Wigolo uninstalled.\n');
    return 0;
  }

  // ----- Interactive / plain mode -----

  const isTTY = Boolean(process.stdout.isTTY);
  const isCI =
    process.env.CI === 'true' ||
    process.env.CI === '1' ||
    process.env.GITHUB_ACTIONS === 'true';

  const useInk = !flags.plain && isTTY && !isCI;

  if (useInk) {
    const { runInkConfig } = await import('./tui/router/ink-config.js');
    await runInkConfig();
    return 0;
  }

  // Plain / non-interactive: print current settings.
  // The actions layer is imported lazily here (not at module top) so the MCP
  // stdio startup graph (src/index.ts → cli/config.ts is eager) stays lean and
  // does not transitively pull system-check / agents / config-writer.
  const { readEnvSettings, CURATED_ENV_VARS, ENV_GROUP_LABELS } = await import('./tui/actions/index.js');
  const config = getConfig();
  const settings = readEnvSettings();

  process.stdout.write('Wigolo current settings\n');
  process.stdout.write('=======================\n\n');

  const groupsSeen = new Set<string>();
  for (const meta of CURATED_ENV_VARS) {
    if (!groupsSeen.has(meta.group)) {
      groupsSeen.add(meta.group);
      process.stdout.write(`[${ENV_GROUP_LABELS[meta.group]}]\n`);
    }
    const val = settings[meta.settingsKey] ?? meta.defaultValue;
    const isDefault = val === meta.defaultValue;
    process.stdout.write(
      `  ${meta.label.padEnd(30)} ${val}${isDefault ? ' (default)' : ''}\n`,
    );
  }

  process.stdout.write(`\nData directory: ${config.dataDir}\n`);
  process.stdout.write('\nRun `wigolo config` in an interactive terminal to change settings.\n');
  process.stdout.write('\nHeadless commands:\n');
  process.stdout.write('  wigolo config --storage          Show storage usage\n');
  process.stdout.write('  wigolo config --cache-stats      Show cache statistics\n');
  process.stdout.write('  wigolo config --export           Export settings to file\n');
  process.stdout.write('  wigolo config --import <path>    Import settings from file\n');
  process.stdout.write('  wigolo config --cleanup <comp>   Free storage per component\n');
  process.stdout.write('  wigolo config --uninstall --yes  Full uninstall\n');

  return 0;
}
