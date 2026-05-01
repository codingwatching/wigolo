import { Defuddle } from 'defuddle/node';
import type { ExtractionResult } from '../types.js';
import { htmlToMarkdown } from './markdown.js';

const MIN_CONTENT_THRESHOLD = 100;

export async function defuddleExtract(html: string, url: string): Promise<ExtractionResult | null> {
  try {
    const result = await Defuddle(html, url);
    if (!result.content) return null;
    const markdown = htmlToMarkdown(result.content);
    if (markdown.length < MIN_CONTENT_THRESHOLD) return null;
    return {
      title: result.title ?? '',
      markdown,
      metadata: {
        description: result.description || undefined,
        author: result.author || undefined,
        date: result.published || undefined,
        language: result.language || undefined,
      },
      links: [],
      images: [],
      extractor: 'defuddle',
    };
  } catch {
    return null;
  }
}
