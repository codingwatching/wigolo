const VISIBLE_TEXT_THRESHOLD = 200;
const SCRIPT_RATIO_THRESHOLD = 0.8;

function stripScriptsAndStyles(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
}

function extractVisibleText(html: string): string {
  const stripped = stripScriptsAndStyles(html);
  const noTags = stripped.replace(/<[^>]+>/g, ' ');
  return noTags.replace(/\s+/g, ' ').trim();
}

function hasSpaShellIndicator(html: string): boolean {
  const emptyShell = [
    /<div[^>]+id=["']root["'][^>]*>\s*<\/div>/i,
    /<div[^>]+id=["']app["'][^>]*>\s*<\/div>/i,
    /<div[^>]+id=["']__next["'][^>]*>\s*<\/div>/i,
  ];
  if (emptyShell.some((pattern) => pattern.test(html))) return true;

  // Non-empty root div but no semantic content: react.dev / nextjs.org SSR
  // a small nav skeleton into <div id="root"> yet ship the real article
  // content via client-side hydration. If a shell ID is present AND the page
  // lacks a <main>/<article> block, treat it as a SPA so the router escalates.
  const hasShellId = /<div[^>]+id=["'](?:root|app|__next)["']/i.test(html);
  if (!hasShellId) return false;
  const hasSemanticContent = /<main[\s>]|<article[\s>]/i.test(html);
  return !hasSemanticContent;
}

function hasNextData(html: string): boolean {
  if (!/__NEXT_DATA__/.test(html)) return false;
  const withoutScripts = stripScriptsAndStyles(html);
  const visibleText = withoutScripts.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return visibleText.length < VISIBLE_TEXT_THRESHOLD;
}

function hasNoscriptRequired(html: string): boolean {
  const noscriptMatches = html.match(/<noscript[^>]*>([\s\S]*?)<\/noscript>/gi);
  if (!noscriptMatches) return false;
  return noscriptMatches.some((tag) => {
    const inner = tag.replace(/<[^>]+>/g, '').toLowerCase();
    return inner.includes('javascript') || inner.includes('enable');
  });
}

function hasHighScriptRatio(html: string): boolean {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : html;

  const scriptMatches = bodyContent.match(/<script[\s\S]*?<\/script>/gi) ?? [];
  const scriptText = scriptMatches.join('');

  const scriptLen = scriptText.length;
  const totalLen = bodyContent.length;

  if (totalLen === 0) return false;
  return scriptLen / totalLen > SCRIPT_RATIO_THRESHOLD;
}

export function contentAppearsEmpty(html: string): boolean {
  const visibleText = extractVisibleText(html);
  if (visibleText.length < VISIBLE_TEXT_THRESHOLD) return true;

  if (hasSpaShellIndicator(html)) return true;
  if (hasNextData(html)) return true;
  if (hasNoscriptRequired(html)) return true;
  if (hasHighScriptRatio(html)) return true;

  return false;
}
