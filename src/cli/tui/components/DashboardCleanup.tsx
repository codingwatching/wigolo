/**
 * DashboardCleanup component — SP5 one-click cleanup per component.
 *
 * Shows storage per component; user can navigate to a component and
 * press enter to trigger cleanup. Reports freed bytes after completion.
 * No business logic here — delegates to cleanupComponent action.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { getConfig } from '../../../config.js';
import type { CleanableComponentId, ComponentStorageItem } from '../actions/index.js';

interface CleanupItem extends ComponentStorageItem {
  id: CleanableComponentId;
  cleanedBytes?: number;
  status?: 'cleaning' | 'done' | 'error';
  error?: string;
}

interface DashboardCleanupProps {
  onBack: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const CLEANABLE_IDS: CleanableComponentId[] = ['cache', 'embeddings', 'models', 'browser', 'searxng'];

export function DashboardCleanup({ onBack }: DashboardCleanupProps) {
  const [items, setItems] = useState<CleanupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const config = getConfig();
      const { computeStorage } = await import('../actions/index.js');
      const result = await computeStorage(config.dataDir);
      if (cancelled) return;
      const cleaned: CleanupItem[] = CLEANABLE_IDS.map((id) => {
        const found = result.items.find((i) => i.id === id);
        return {
          id,
          label: found?.label ?? id,
          path: found?.path ?? '',
          bytes: found?.bytes ?? 0,
        };
      });
      setItems(cleaned);
      setLoading(false);
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  const runCleanup = useCallback(async (idx: number) => {
    const item = items[idx];
    if (!item || item.status === 'cleaning') return;

    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, status: 'cleaning' as const } : it)),
    );

    const config = getConfig();
    const { cleanupComponent } = await import('../actions/index.js');
    const result = await cleanupComponent(item.id, config.dataDir);

    setItems((prev) =>
      prev.map((it, i) =>
        i === idx
          ? {
              ...it,
              status: result.ok ? ('done' as const) : ('error' as const),
              cleanedBytes: result.freedBytes,
              bytes: result.ok ? 0 : it.bytes,
              error: result.error,
            }
          : it,
      ),
    );
  }, [items]);

  useInput(useCallback((input, key) => {
    if (loading) {
      if (key.escape || input === 'q') onBack();
      return;
    }
    if (key.upArrow) setCursor((c) => (c > 0 ? c - 1 : items.length - 1));
    else if (key.downArrow) setCursor((c) => (c < items.length - 1 ? c + 1 : 0));
    else if (key.return) void runCleanup(cursor);
    else if (key.escape || input === 'q') onBack();
  }, [loading, items.length, cursor, runCleanup, onBack]));

  if (loading) {
    return (
      <Box paddingX={2}>
        <Text dimColor>Loading storage data…</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2}>
      <Text bold>Wigolo — cleanup components</Text>
      <Text dimColor>Select a component and press enter to free space</Text>
      <Box flexDirection="column" marginTop={1}>
        {items.map((item, i) => {
          const isFocused = i === cursor;
          const statusColor =
            item.status === 'done' ? 'green'
            : item.status === 'error' ? 'red'
            : item.status === 'cleaning' ? 'yellow'
            : undefined;
          return (
            <Box key={item.id} flexDirection="column">
              <Text>
                {isFocused ? <Text color="cyan">{'❯ '}</Text> : '  '}
                <Text bold={isFocused}>{item.label.padEnd(24)}</Text>
                {item.status === 'cleaning' ? (
                  <Text color="yellow"> cleaning…</Text>
                ) : item.status === 'done' ? (
                  <Text color="green"> freed {formatBytes(item.cleanedBytes ?? 0)}</Text>
                ) : item.status === 'error' ? (
                  <Text color="red"> error: {item.error}</Text>
                ) : (
                  <Text color={item.bytes > 0 ? undefined : 'gray'}>
                    {' '}{formatBytes(item.bytes)}
                  </Text>
                )}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑/↓ navigate · enter cleanup · q/esc back</Text>
      </Box>
    </Box>
  );
}
