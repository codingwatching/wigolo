// Post-extraction sanitizer for markdown returned by ensemble extractors.
// Currently targets a Node-docs pattern where tab labels ("javascript",
// "typescript", etc.) leak into a fenced code block as a bare line.

const STRAY_LABELS = new Set([
  'javascript',
  'typescript',
  'mjs',
  'cjs',
  'json',
  'html',
  'css',
  'bash',
  'sh',
  'shell',
  'python',
  'py',
  'go',
  'rust',
  'java',
  'kotlin',
  'swift',
  'cpp',
  'c++',
  'csharp',
  'ruby',
  'php',
]);

function isFenceLine(line: string): { open: boolean; close: boolean; lang?: string } {
  const m = line.match(/^(```+|~~~+)([a-zA-Z0-9_+-]*)\s*$/);
  if (!m) return { open: false, close: false };
  const lang = m[2]?.trim() || undefined;
  return { open: !!lang, close: !lang, lang };
}

export function sanitizeExtractedMarkdown(md: string): string {
  if (!md.includes('```') && !md.includes('~~~')) return md;
  const lines = md.split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceMarker: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inFence) {
      const f = line.match(/^(```+|~~~+)/);
      if (f) {
        inFence = true;
        fenceMarker = f[1];
      }
      out.push(line);
      continue;
    }
    // inside a fence
    if (fenceMarker && line.startsWith(fenceMarker) && line.replace(fenceMarker, '').trim() === '') {
      inFence = false;
      fenceMarker = null;
      out.push(line);
      continue;
    }
    const trimmed = line.trim();
    if (trimmed && STRAY_LABELS.has(trimmed.toLowerCase()) && !line.includes(' ')) {
      // Drop the stray language label line.
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}
