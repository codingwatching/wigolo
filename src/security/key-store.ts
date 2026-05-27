/**
 * Key-store: implements the keychain → encrypted-file → env fallback chain
 * for LLM provider API keys.
 *
 * Resolution order (highest to lowest):
 *   1. OS keychain (via @napi-rs/keyring) — preferred when available.
 *   2. Encrypted file (~/.wigolo/keys/<provider>.enc) — AES-256-GCM.
 *   3. Environment variable (e.g. ANTHROPIC_API_KEY) — read-only, never written here.
 *
 * IMPORTANT: resolveProviderKey NEVER writes to process.env. Secrets are
 * threaded explicitly to avoid leaking into child-process environments or logs.
 *
 * The machine-id used as KEK input is the data-dir path. This is a stable
 * machine-local value that changes when the user relocates their data dir,
 * which is acceptable — they would need to re-enter their key. The threat
 * model (documented in key-crypto.ts) is protection against casual disk reads
 * by unprivileged users, not against root attackers who can read both the
 * data-dir path and the encrypted file.
 */

import { join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { keychainAvailable, keychainSet, keychainGet, keychainDelete, WIGOLO_SERVICE } from './keychain.js';
import { encryptToFile, decryptFromFile } from './key-crypto.js';
import { providerEnvVar } from '../integrations/cloud/llm/select.js';
import type { LLMProvider } from '../integrations/cloud/llm/types.js';

export interface KeyStoreOpts {
  dataDir: string;
}

export interface ReadKeyResult {
  value: string;
  location: 'keychain' | 'file' | 'env';
}

export interface ProviderEntry {
  provider: LLMProvider | 'custom';
  location: 'keychain' | 'file' | 'env';
}

// Picker-visible providers (groq hidden from picker but still env-supported)
export const PICKER_PROVIDERS: ReadonlyArray<LLMProvider | 'custom'> = [
  'anthropic',
  'openai',
  'gemini',
  'custom',
];

// All providers that can have keystore entries (including groq via env only)
const STORE_PROVIDERS: ReadonlyArray<LLMProvider> = ['anthropic', 'openai', 'gemini', 'groq'];

/** Returns the keychain service name for a given provider. */
function keychainKey(provider: LLMProvider): string {
  return `${WIGOLO_SERVICE}-${provider}`;
}

/** Returns the encrypted file path for a given provider. */
function encFilePath(provider: LLMProvider, dataDir: string): string {
  return join(dataDir, 'keys', `${provider}.enc`);
}

/**
 * Store a provider API key securely.
 * Prefers keychain; falls back to encrypted file when keychain unavailable.
 * Never writes to process.env.
 */
export async function storeKey(
  provider: LLMProvider,
  value: string,
  opts: KeyStoreOpts,
): Promise<{ location: 'keychain' | 'file' }> {
  if (keychainAvailable()) {
    try {
      keychainSet(keychainKey(provider), provider, value);
      return { location: 'keychain' };
    } catch {
      // Keychain call failed despite availability probe — fall through to file.
    }
  }
  await encryptToFile(value, opts.dataDir, encFilePath(provider, opts.dataDir));
  return { location: 'file' };
}

/**
 * Read a stored key. Returns the raw value and where it was found.
 * Returns null when neither keychain nor file has a key.
 * Does NOT fall through to env — resolveProviderKey does that.
 */
export async function readKey(
  provider: LLMProvider,
  opts: KeyStoreOpts,
): Promise<ReadKeyResult | null> {
  // 1. Keychain
  if (keychainAvailable()) {
    const kc = keychainGet(keychainKey(provider), provider);
    if (kc !== null) return { value: kc, location: 'keychain' };
  }

  // 2. Encrypted file
  const filePath = encFilePath(provider, opts.dataDir);
  if (existsSync(filePath)) {
    try {
      const value = await decryptFromFile(opts.dataDir, filePath);
      return { value, location: 'file' };
    } catch {
      // Corrupt/tampered file — treat as miss (do not silently expose garbage)
    }
  }

  return null;
}

/**
 * Delete a stored key from whichever tier holds it.
 */
export async function deleteKey(
  provider: LLMProvider,
  opts: KeyStoreOpts,
): Promise<void> {
  // Remove from keychain if present
  if (keychainAvailable()) {
    keychainDelete(keychainKey(provider), provider);
  }
  // Remove encrypted file if present
  const filePath = encFilePath(provider, opts.dataDir);
  if (existsSync(filePath)) {
    try { unlinkSync(filePath); } catch { /* ignore */ }
  }
}

/**
 * Full resolution chain: keychain → file → env.
 * Returns the raw key value or undefined if none configured.
 * NEVER mutates process.env.
 */
export async function resolveProviderKey(
  provider: LLMProvider,
  opts: KeyStoreOpts,
): Promise<string | undefined> {
  // 1 + 2: keychain and file
  const stored = await readKey(provider, opts);
  if (stored !== null) return stored.value;

  // 3: env var (read-only)
  const envVar = providerEnvVar(provider);
  const envValue = process.env[envVar];
  return envValue || undefined;
}

/**
 * List all providers that have a stored key (keychain or file; env not included).
 */
export async function listProviders(opts: KeyStoreOpts): Promise<ProviderEntry[]> {
  const results: ProviderEntry[] = [];
  for (const provider of STORE_PROVIDERS) {
    const found = await readKey(provider, opts);
    if (found !== null) {
      results.push({ provider, location: found.location });
    }
  }
  return results;
}
