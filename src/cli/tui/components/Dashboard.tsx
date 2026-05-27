/**
 * Dashboard component — SP5 management dashboard.
 *
 * Shows:
 *   - Per-component storage sizes + hogs sorted desc
 *   - Cache stats (entry count, size, age range)
 *   - Navigation to cleanup, export, and uninstall screens
 *
 * All data is fetched via the actions layer (computeStorage, getCacheStatsAction).
 * No business logic here.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { getConfig } from '../../../config.js';
import type { ScreenId } from '../actions/index.js';
import type { StorageResult } from '../actions/index.js';
import type { CacheStatsResult } from '../actions/index.js';

interface DashboardProps {
  onNavigate: (screen: ScreenId) => void;
  onBack: () => void;
}

type LoadState = 'loading' | 'loaded' | 'error';

interface DashboardData {
  storage: StorageResult | null;
  cacheStats: CacheStatsResult | null;
  loadError?: string;
}

const MENU_ITEMS: Array<{ label: string; screen: ScreenId }> = [
  { label: 'Cleanup components', screen: 'dashboard-cleanup' },
  { label: 'Export config', screen: 'dashboard-export' },
  { label: 'Uninstall wigolo', screen: 'dashboard-uninstall' },
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function Dashboard({ onNavigate, onBack }: DashboardProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [data, setData] = useState<DashboardData>({ storage: null, cacheStats: null });
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const config = getConfig();
        const { computeStorage, getCacheStatsAction } = await import('../actions/index.js');
        const [storage, cacheStats] = await Promise.all([
          computeStorage(config.dataDir),
          getCacheStatsAction(),
        ]);
        if (!cancelled) {
          setData({ storage, cacheStats });
          setLoadState('loaded');
        }
      } catch (err) {
        if (!cancelled) {
          setData({ storage: null, cacheStats: null, loadError: err instanceof Error ? err.message : String(err) });
          setLoadState('error');
        }
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  useInput(useCallback((input, key) => {
    if (loadState !== 'loaded') {
      if (key.escape || input === 'q') onBack();
      return;
    }
    if (key.upArrow) setCursor((c) => (c > 0 ? c - 1 : MENU_ITEMS.length - 1));
    else if (key.downArrow) setCursor((c) => (c < MENU_ITEMS.length - 1 ? c + 1 : 0));
    else if (key.return) {
      const item = MENU_ITEMS[cursor];
      if (item) onNavigate(item.screen);
    } else if (key.escape || input === 'q') onBack();
  }, [loadState, cursor, onNavigate, onBack]));

  if (loadState === 'loading') {
    return (
      <Box paddingX={2}>
        <Text dimColor>Loading storage data…</Text>
      </Box>
    );
  }

  if (loadState === 'error') {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text color="red">Failed to load dashboard: {data.loadError}</Text>
        <Box marginTop={1}>
          <Text dimColor>Press q or esc to go back</Text>
        </Box>
      </Box>
    );
  }

  const { storage, cacheStats } = data;

  return (
    <Box flexDirection="column" paddingX={2}>
      <Text bold>Wigolo — dashboard</Text>

      {/* Storage map */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold underline>Storage</Text>
        {storage?.hogs.map((item) => (
          <Box key={item.id} paddingLeft={2}>
            <Text>
              <Text bold>{item.label.padEnd(22)}</Text>
              <Text color="yellow">{formatBytes(item.bytes)}</Text>
            </Text>
          </Box>
        ))}
        {storage && storage.hogs.length === 0 && (
          <Box paddingLeft={2}>
            <Text dimColor>No data on disk</Text>
          </Box>
        )}
        {storage && (
          <Box paddingLeft={2} marginTop={1}>
            <Text dimColor>Total: {formatBytes(storage.totalBytes)}</Text>
          </Box>
        )}
      </Box>

      {/* Cache stats */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold underline>Cache</Text>
        <Box paddingLeft={2}>
          {cacheStats?.error ? (
            <Text color="red">Error: {cacheStats.error}</Text>
          ) : (
            <Text>
              {cacheStats?.totalEntries ?? 0} entries
              {' · '}
              {cacheStats ? formatBytes(Math.round((cacheStats.sizeMb) * 1024 * 1024)) : '0 B'}
              {cacheStats?.oldest ? ` · oldest: ${cacheStats.oldest.slice(0, 10)}` : ''}
            </Text>
          )}
        </Box>
      </Box>

      {/* Actions menu */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold underline>Actions</Text>
        {MENU_ITEMS.map((item, i) => {
          const isFocused = i === cursor;
          return (
            <Box key={item.screen} paddingLeft={2}>
              <Text>
                {isFocused ? <Text color="cyan">{'❯ '}</Text> : '  '}
                <Text bold={isFocused}>{item.label}</Text>
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>↑/↓ navigate · enter select · q/esc back</Text>
      </Box>
    </Box>
  );
}
