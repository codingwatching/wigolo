import { select, input } from '@inquirer/prompts';
import { saveInitConfig, readInitConfig } from './utils/config-writer.js';

// Index signature lets us pass an ExtrasChoices straight to saveInitConfig
// (which writes Record<string, unknown>) without an `as` cast.
export interface ExtrasChoices extends Record<string, unknown> {
  engine?: 'v1' | 'searxng';
  rssFeeds?: string[];
  llmEndpoint?: string;
}

// Three optional onboarding questions. Each defaults to "skip" so the
// behaviour of users who hit Enter past every prompt is identical to today.
// Persists each set field to ~/.wigolo/config.json; absent fields stay
// untouched (saveInitConfig merges, not replaces).
export async function promptExtras(dataDir: string): Promise<ExtrasChoices> {
  const existing = readInitConfig(dataDir);
  const result: ExtrasChoices = {};

  try {
    const engine = (await select({
      message: 'Search engine? (v1 = direct engines + verticals, searxng = legacy)',
      choices: [
        { name: 'skip (keep current setting)', value: 'skip' as const },
        { name: 'v1 (recommended)', value: 'v1' as const },
        { name: 'searxng (legacy)', value: 'searxng' as const },
      ],
      default: 'skip',
    })) as 'skip' | 'v1' | 'searxng';
    if (engine !== 'skip') result.engine = engine;

    const rss = await input({
      message: 'RSS feed URLs to include in the news vertical (comma-separated, blank to skip)',
      default: typeof existing.rssFeeds === 'string' ? existing.rssFeeds : '',
    });
    const feeds = rss
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (feeds.length > 0) result.rssFeeds = feeds;

    const llm = await input({
      message: 'Local LLM endpoint URL for research/extract fallback (blank to skip)',
      default: typeof existing.llmEndpoint === 'string' ? existing.llmEndpoint : '',
    });
    if (llm.trim()) result.llmEndpoint = llm.trim();
  } catch (err) {
    // SIGINT (Ctrl-C) or non-TTY surfaces as an error from @inquirer/prompts.
    // Treat as "skip everything" — caller continues without touching config.
    if (err instanceof Error && /ExitPromptError|force closed/i.test(err.message)) {
      return {};
    }
    throw err;
  }

  if (Object.keys(result).length > 0) {
    saveInitConfig(dataDir, result);
  }

  return result;
}
