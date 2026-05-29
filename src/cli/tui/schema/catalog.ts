import type { CategoryDef } from './types.js';
import { browserCategory } from './browser.js';
import { searchCategory } from './search.js';
import { llmCategory } from './llm.js';
import { agentsCategory } from './agents.js';
import { cacheCategory } from './cache.js';
import { advancedCategory } from './advanced.js';

export const CATALOG: ReadonlyArray<CategoryDef> = [
  browserCategory,
  searchCategory,
  llmCategory,
  agentsCategory,
  cacheCategory,
  advancedCategory,
];
