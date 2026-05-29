import { describe, it, expect } from 'vitest';
import {
  migrateV1ToV2,
  type PersistedConfigV1,
  type PersistedConfigV2,
} from '../../../../../src/cli/tui/schema/migrate.js';

describe('migrateV1ToV2', () => {
  it('passes through browserTypes/dataDir/cacheTtlSearch unchanged', () => {
    const v1: PersistedConfigV1 = {
      version: 1,
      settings: {
        browserTypes: ['chromium'],
        dataDir: '/tmp/wigolo',
        cacheTtlSearch: 3600,
      },
    };
    const v2 = migrateV1ToV2(v1);
    expect(v2.version).toBe(2);
    expect(v2.settings.browserTypes).toEqual(['chromium']);
    expect(v2.settings.dataDir).toBe('/tmp/wigolo');
    expect(v2.settings.cacheTtlSearch).toBe(3600);
  });

  it('renames WIGOLO_SEARCH to searchBackend', () => {
    const v1: PersistedConfigV1 = {
      version: 1,
      settings: { WIGOLO_SEARCH: 'hybrid' },
    };
    const v2 = migrateV1ToV2(v1);
    expect(v2.settings.searchBackend).toBe('hybrid');
    expect('WIGOLO_SEARCH' in v2.settings).toBe(false);
  });

  it('lifts provider.name to llmProvider and provider.keyLocation to llmKeyLocation', () => {
    const v1: PersistedConfigV1 = {
      version: 1,
      settings: {},
      provider: { name: 'anthropic', keyLocation: 'env:ANTHROPIC_API_KEY' },
    };
    const v2 = migrateV1ToV2(v1);
    expect(v2.settings.llmProvider).toBe('anthropic');
    expect(v2.settings.llmKeyLocation).toBe('env:ANTHROPIC_API_KEY');
  });

  it('preserves unknown legacy keys under __legacy.<key>', () => {
    const v1: PersistedConfigV1 = {
      version: 1,
      settings: {
        someOldFlag: 'on',
        anotherDeprecated: 42,
      },
    };
    const v2 = migrateV1ToV2(v1);
    const legacy = v2.settings.__legacy as Record<string, unknown>;
    expect(legacy).toBeDefined();
    expect(legacy.someOldFlag).toBe('on');
    expect(legacy.anotherDeprecated).toBe(42);
    // and they should NOT appear at the top level
    expect('someOldFlag' in v2.settings).toBe(false);
    expect('anotherDeprecated' in v2.settings).toBe(false);
  });

  it('does not create __legacy when there are no unknown keys', () => {
    const v1: PersistedConfigV1 = {
      version: 1,
      settings: { browserTypes: ['chromium'] },
    };
    const v2 = migrateV1ToV2(v1);
    expect('__legacy' in v2.settings).toBe(false);
  });

  it('preserves a v1 firefox entry in browserTypes (TUI handles legacy labeling)', () => {
    const v1: PersistedConfigV1 = {
      version: 1,
      settings: { browserTypes: ['chromium', 'firefox'] },
    };
    const v2 = migrateV1ToV2(v1);
    expect(v2.settings.browserTypes).toEqual(['chromium', 'firefox']);
  });

  it('returns an already-v2 input unchanged', () => {
    const v2In: PersistedConfigV2 = {
      version: 2,
      settings: { browserTypes: ['chromium'], searchBackend: 'core' },
    };
    const v2Out = migrateV1ToV2(v2In);
    expect(v2Out).toBe(v2In);
    expect(v2Out.version).toBe(2);
    expect(v2Out.settings.searchBackend).toBe('core');
  });

  it('handles missing provider gracefully', () => {
    const v1: PersistedConfigV1 = {
      version: 1,
      settings: { browserTypes: ['chromium'] },
    };
    const v2 = migrateV1ToV2(v1);
    expect('llmProvider' in v2.settings).toBe(false);
    expect('llmKeyLocation' in v2.settings).toBe(false);
  });

  it('emits v2 with version field set to 2', () => {
    const v1: PersistedConfigV1 = { version: 1, settings: {} };
    expect(migrateV1ToV2(v1).version).toBe(2);
  });
});
