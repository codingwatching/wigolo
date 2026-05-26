import { parseHTML } from 'linkedom';
import type { ExtractionResult } from '../../types.js';
import { defuddleExtract } from '../defuddle.js';
import { readabilityExtract } from '../readability.js';
import { htmlToMarkdown } from '../markdown.js';
import { stripBoilerplateDom } from '../boilerplate.js';
import { createLogger } from '../../logger.js';
import { classifyContent, type ContentType } from './classifier.js';
import { extractRecipe } from './recipe.js';
import { extractProduct } from './product.js';
import { extractNews } from './news.js';
import { getSiteExtractors } from './site-extractors.js';
import { detectAntiBotBlock as detectRedditBlock } from '../site-extractors/reddit.js';
import { detectAntiBotBlock as detectAmazonBlock } from '../site-extractors/amazon.js';

const log = createLogger('extract');

export interface RoutedExtractInput {
  html: string;
  url: string;
  cleanedHtml?: string;
  contentType?: string;
}

/**
 * V1 routed extractor — picks a category-specific extractor based on the
 * classifier output, with defuddle → readability → turndown fallbacks. Site
 * extractors (github/stackoverflow/mdn/docs-generic + plugins) run first and
 * short-circuit on match, matching legacy behavior.
 *
 * PDF handling lives in V1Extractor — this router assumes HTML.
 */
export async function routedExtract(input: RoutedExtractInput): Promise<ExtractionResult> {
  const { html, url } = input;
  const cleanedHtml = input.cleanedHtml ?? cleanHtml(html, url);

  const siteHit = trySiteExtractors(cleanedHtml, url, html);
  if (siteHit) return siteHit;

  // Slice S7 (C5): when no site extractor matched, the URL might still belong
  // to a site we know — Reddit / Amazon — and the body might be an anti-bot
  // challenge or "page not found" landing. Detect that case so the caller
  // sees an honest `fetch_failed="blocked"` instead of silent fake success.
  const blocked = detectSiteBlock(url, html);

  const type = classifyContent(url, html);
  log.debug('classified content', { url, type, blocked });

  const result = await (async () => {
    switch (type) {
      case 'recipe':
        return (
          (await extractRecipe(cleanedHtml, url)) ?? (await fallbackChain(cleanedHtml, url))
        );
      case 'product':
        return (
          (await extractProduct(cleanedHtml, url)) ?? (await fallbackChain(cleanedHtml, url))
        );
      case 'news':
        return (await extractNews(cleanedHtml, url)) ?? (await fallbackChain(cleanedHtml, url));
      case 'code':
      case 'docs':
      case 'generic':
      default:
        return fallbackChain(cleanedHtml, url, type);
    }
  })();

  if (blocked) {
    result.site_data_blocked = blocked;
  }
  return result;
}

// Slice S7 (C5): URL-scoped block detection. Only fires for hosts where we
// have a site extractor and a known anti-bot body shape — Reddit / Amazon.
// A generic block body on an unrelated host is not our problem here; that
// case is covered by the fetch tier's http_status / router escalation.
function detectSiteBlock(url: string, html: string): string | null {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }

  if (host === 'reddit.com' || host === 'redd.it' ||
      host.endsWith('.reddit.com') || host.endsWith('.redd.it')) {
    return detectRedditBlock(html);
  }

  if (host.includes('amazon.') || host === 'amzn.to' || host === 'a.co' ||
      host.endsWith('.amzn.to') || host.endsWith('.a.co')) {
    return detectAmazonBlock(html);
  }

  return null;
}

function cleanHtml(html: string, url: string): string {
  try {
    const { document } = parseHTML(html);
    stripBoilerplateDom(document);
    return document.toString();
  } catch (err) {
    log.warn('boilerplate DOM pre-pass failed', { url, error: String(err) });
    return html;
  }
}

function trySiteExtractors(
  cleanedHtml: string,
  url: string,
  originalHtml: string,
): ExtractionResult | null {
  const extractors = getSiteExtractors();
  const match = extractors.find((e) => e.canHandle(url, originalHtml));
  if (!match) return null;
  // Site extractors that emit a structured record populate `site_data`
  // directly on the ExtractionResult (see reddit / amazon / youtube). The
  // structured shape is built once, inside the extractor's single HTML
  // parse — no re-parse, no helper re-call here.
  return match.extract(cleanedHtml, url);
}

async function fallbackChain(
  cleanedHtml: string,
  url: string,
  _type?: ContentType,
): Promise<ExtractionResult> {
  const fromDefuddle = await defuddleExtract(cleanedHtml, url);
  if (fromDefuddle) return fromDefuddle;

  const fromReadability = readabilityExtract(cleanedHtml, url);
  if (fromReadability) return fromReadability;

  return {
    title: '',
    markdown: htmlToMarkdown(cleanedHtml),
    metadata: {},
    links: [],
    images: [],
    extractor: 'turndown',
  };
}
