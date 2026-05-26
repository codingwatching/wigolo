import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { youtubeExtractor } from '../../../../src/extraction/site-extractors/youtube.js';

const fixturesDir = join(import.meta.dirname, '../../../fixtures/site-extractors');
const loadFixture = (name: string) => readFileSync(join(fixturesDir, name), 'utf-8');

const WITH_CAPTIONS = loadFixture('youtube-watch-with-captions.html');
const NO_CAPTIONS = loadFixture('youtube-watch-no-captions.html');
const AGE_RESTRICTED = loadFixture('youtube-watch-age-restricted.html');

// WHY: extractor must select YouTube URLs only — false positives steal traffic
// from generic extractors and false negatives drop the site from the pipeline.
describe('youtubeExtractor.canHandle', () => {
  it('matches standard youtube.com/watch URLs', () => {
    expect(youtubeExtractor.canHandle('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
  });

  it('matches youtube.com without www', () => {
    expect(youtubeExtractor.canHandle('https://youtube.com/watch?v=abc123')).toBe(true);
  });

  it('matches mobile m.youtube.com', () => {
    expect(youtubeExtractor.canHandle('https://m.youtube.com/watch?v=abc123')).toBe(true);
  });

  it('matches youtu.be short links', () => {
    expect(youtubeExtractor.canHandle('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
  });

  it('matches music.youtube.com watch URLs', () => {
    expect(youtubeExtractor.canHandle('https://music.youtube.com/watch?v=abc123')).toBe(true);
  });

  it('does not match youtube channel pages (no watch path)', () => {
    expect(youtubeExtractor.canHandle('https://www.youtube.com/@ChannelName')).toBe(false);
  });

  it('does not match unrelated domains', () => {
    expect(youtubeExtractor.canHandle('https://example.com/watch?v=abc')).toBe(false);
  });

  it('does not match URLs that merely mention youtube in path', () => {
    expect(youtubeExtractor.canHandle('https://example.com/youtube/watch')).toBe(false);
  });

  it('does not match a malformed URL', () => {
    expect(youtubeExtractor.canHandle('not a url')).toBe(false);
  });
});

// WHY: video_id is the canonical identifier. If extraction silently mis-IDs a
// video, downstream caching and cross-references corrupt — regression-critical.
describe('youtubeExtractor — video_id parsing', () => {
  const html = WITH_CAPTIONS;

  it('extracts video_id from ytInitialPlayerResponse', () => {
    const result = youtubeExtractor.extract(html, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')!;
    expect(result).not.toBeNull();
    expect((result.metadata as Record<string, unknown>).video_id).toBe('dQw4w9WgXcQ');
  });
});

// WHY: per-spec output shape contract — title/channel/description/duration are
// the metadata fields downstream tools (research, agent) cite.
describe('youtubeExtractor — metadata fields', () => {
  const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

  it('returns non-null result for a normal watch page', () => {
    expect(youtubeExtractor.extract(WITH_CAPTIONS, url)).not.toBeNull();
  });

  it('extracts the video title', () => {
    const result = youtubeExtractor.extract(WITH_CAPTIONS, url)!;
    expect(result.title).toBe('Example Video Title');
  });

  it('extracts the channel name into metadata', () => {
    const result = youtubeExtractor.extract(WITH_CAPTIONS, url)!;
    expect((result.metadata as Record<string, unknown>).channel).toBe('Example Channel');
  });

  it('extracts duration in seconds and exposes ISO 8601 form', () => {
    const result = youtubeExtractor.extract(WITH_CAPTIONS, url)!;
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.duration_seconds).toBe(642);
    expect(meta.duration).toBe('PT10M42S');
  });

  it('extracts view_count as a number', () => {
    const result = youtubeExtractor.extract(WITH_CAPTIONS, url)!;
    expect((result.metadata as Record<string, unknown>).view_count).toBe(123456789);
  });

  it('extracts posted_at as ISO 8601', () => {
    const result = youtubeExtractor.extract(WITH_CAPTIONS, url)!;
    const posted = (result.metadata as Record<string, unknown>).posted_at as string;
    expect(posted).toBe('2024-01-15T10:30:00Z');
  });

  it('exposes posted_at in standard metadata.date too', () => {
    const result = youtubeExtractor.extract(WITH_CAPTIONS, url)!;
    expect(result.metadata.date).toBe('2024-01-15T10:30:00Z');
  });

  it('extracts description text', () => {
    const result = youtubeExtractor.extract(WITH_CAPTIONS, url)!;
    expect(result.metadata.description).toContain('Example description line one.');
  });

  it('marks extractor as site-specific', () => {
    const result = youtubeExtractor.extract(WITH_CAPTIONS, url)!;
    expect(result.extractor).toBe('site-specific');
  });

  it('sets author to channel name', () => {
    const result = youtubeExtractor.extract(WITH_CAPTIONS, url)!;
    expect(result.metadata.author).toBe('Example Channel');
  });
});

// WHY: chapters define video structure for search & research summaries; missed
// chapter parsing means we hand back unstructured timelines.
describe('youtubeExtractor — chapters', () => {
  const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

  it('parses chapters from ytInitialData', () => {
    const result = youtubeExtractor.extract(WITH_CAPTIONS, url)!;
    const chapters = (result.metadata as Record<string, unknown>).chapters as Array<{
      start: number;
      title: string;
    }>;
    expect(Array.isArray(chapters)).toBe(true);
    expect(chapters).toHaveLength(3);
    expect(chapters[0]).toEqual({ start: 0, title: 'Intro' });
    expect(chapters[1]).toEqual({ start: 60, title: 'Main Topic' });
    expect(chapters[2]).toEqual({ start: 540, title: 'Conclusion' });
  });

  it('returns empty chapters array when none present in HTML', () => {
    const result = youtubeExtractor.extract(NO_CAPTIONS, 'https://www.youtube.com/watch?v=abc123XYZ_-')!;
    expect((result.metadata as Record<string, unknown>).chapters).toEqual([]);
  });
});

// WHY: transcript is the headline feature. We MUST signal whether captions are
// available even if we can't fetch them sync — otherwise downstream callers
// silently see no transcript and assume the video has none.
describe('youtubeExtractor — captions / transcript', () => {
  const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

  it('returns an empty transcript array (sync extractor cannot fetch network resources)', () => {
    const result = youtubeExtractor.extract(WITH_CAPTIONS, url)!;
    const transcript = (result.metadata as Record<string, unknown>).transcript;
    expect(transcript).toEqual([]);
  });

  it('exposes caption_tracks so callers can fetch transcripts asynchronously', () => {
    const result = youtubeExtractor.extract(WITH_CAPTIONS, url)!;
    const tracks = (result.metadata as Record<string, unknown>).caption_tracks as Array<{
      language_code: string;
      base_url: string;
      kind: string;
      name: string;
    }>;
    expect(tracks).toHaveLength(1);
    expect(tracks[0].language_code).toBe('en');
    expect(tracks[0].base_url).toContain('timedtext');
    expect(tracks[0].kind).toBe('asr');
  });

  it('returns empty caption_tracks when the video has no captions', () => {
    const result = youtubeExtractor.extract(NO_CAPTIONS, 'https://www.youtube.com/watch?v=abc123XYZ_-')!;
    expect((result.metadata as Record<string, unknown>).caption_tracks).toEqual([]);
  });

  it('does not throw on no-captions videos', () => {
    expect(() =>
      youtubeExtractor.extract(NO_CAPTIONS, 'https://www.youtube.com/watch?v=abc123XYZ_-'),
    ).not.toThrow();
  });
});

// WHY: age-restricted / login-required pages have most data zeroed out by
// YouTube. Returning a structured "unavailable" result beats both a crash and
// silently returning bogus metadata.
describe('youtubeExtractor — age-restricted / unavailable videos', () => {
  const url = 'https://www.youtube.com/watch?v=restricted1';

  it('does not throw on age-restricted videos', () => {
    expect(() => youtubeExtractor.extract(AGE_RESTRICTED, url)).not.toThrow();
  });

  it('returns a result with playability_status surfaced', () => {
    const result = youtubeExtractor.extract(AGE_RESTRICTED, url)!;
    expect((result.metadata as Record<string, unknown>).playability_status).toBe('LOGIN_REQUIRED');
  });

  it('returns minimal video_id even when unplayable', () => {
    const result = youtubeExtractor.extract(AGE_RESTRICTED, url)!;
    expect((result.metadata as Record<string, unknown>).video_id).toBe('restricted1');
  });

  it('returns empty transcript and empty caption_tracks for unplayable videos', () => {
    const result = youtubeExtractor.extract(AGE_RESTRICTED, url)!;
    expect((result.metadata as Record<string, unknown>).transcript).toEqual([]);
    expect((result.metadata as Record<string, unknown>).caption_tracks).toEqual([]);
  });
});

// WHY: markdown body is what gets stored in the cache and surfaced in
// search/research previews — empty markdown breaks downstream UX.
describe('youtubeExtractor — markdown body', () => {
  it('includes the title in markdown', () => {
    const result = youtubeExtractor.extract(WITH_CAPTIONS, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')!;
    expect(result.markdown).toContain('Example Video Title');
  });

  it('includes channel in markdown', () => {
    const result = youtubeExtractor.extract(WITH_CAPTIONS, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')!;
    expect(result.markdown).toContain('Example Channel');
  });

  it('includes description in markdown', () => {
    const result = youtubeExtractor.extract(WITH_CAPTIONS, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')!;
    expect(result.markdown).toContain('Example description line one.');
  });
});

// WHY: pipeline calls extract on whatever HTML it has; an empty / unparseable
// page must not crash the whole extraction chain. github/stackoverflow set this
// precedent — youtube must follow.
describe('youtubeExtractor — edge cases', () => {
  it('returns null for empty HTML', () => {
    expect(youtubeExtractor.extract('', 'https://www.youtube.com/watch?v=abc')).toBeNull();
  });

  it('returns null when ytInitialPlayerResponse is missing', () => {
    const html = '<html><body><p>nothing here</p></body></html>';
    expect(youtubeExtractor.extract(html, 'https://www.youtube.com/watch?v=abc')).toBeNull();
  });

  it('returns null when ytInitialPlayerResponse is malformed JSON', () => {
    const html = '<script>var ytInitialPlayerResponse = {bad json;</script>';
    expect(youtubeExtractor.extract(html, 'https://www.youtube.com/watch?v=abc')).toBeNull();
  });
});

// WHY: registration is the integration seam — without it, the extractor exists
// but is never invoked. Regression-critical for the C2 slice.
describe('youtubeExtractor — pipeline registration', () => {
  it('is registered in the site-extractor list', async () => {
    const { getSiteExtractors, _resetSiteExtractorsForTest } = await import(
      '../../../../src/extraction/v1/site-extractors.js'
    );
    _resetSiteExtractorsForTest();
    const names = getSiteExtractors().map((e) => e.name);
    expect(names).toContain('youtube');
  });
});
