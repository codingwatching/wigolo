#!/usr/bin/env node
// Generates self-hosted star-growth SVGs (light + dark) from the GitHub API,
// so the README chart always renders regardless of any third-party embed.
//
//   GITHUB_TOKEN=$(gh auth token) node scripts/star-chart.mjs
//
// Env: GITHUB_TOKEN (required), GITHUB_REPOSITORY (default KnockOutEZ/wigolo),
//      OUT_DIR (default out). Writes <OUT_DIR>/star-history.svg and
//      <OUT_DIR>/star-history-dark.svg. One summary line to stderr.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY || 'KnockOutEZ/wigolo';
const OUT_DIR = process.env.OUT_DIR || 'out';

if (!TOKEN) {
  process.stderr.write('star-chart: GITHUB_TOKEN is required\n');
  process.exit(1);
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

async function fetchStargazers() {
  const dates = [];
  for (let page = 1; ; page++) {
    const url = `https://api.github.com/repos/${REPO}/stargazers?per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github.star+json',
        Authorization: `Bearer ${TOKEN}`,
        'User-Agent': 'wigolo-star-chart',
      },
    });
    if (!res.ok) {
      const body = (await res.text()).replace(/\s+/g, ' ').slice(0, 300);
      const remaining = res.headers.get('x-ratelimit-remaining');
      const limit = res.headers.get('x-ratelimit-limit');
      process.stderr.write(
        `star-chart: GitHub API ${res.status} ${res.statusText} on page ${page} ` +
          `(ratelimit ${remaining}/${limit}): ${body}\n`,
      );
      process.exit(1);
    }
    const batch = await res.json();
    for (const entry of batch) {
      if (entry && entry.starred_at) dates.push(new Date(entry.starred_at).getTime());
    }
    if (batch.length < 100) break;
  }
  return dates.sort((a, b) => a - b);
}

// Cumulative [time, count] series with a final point at "now" holding the total.
function buildSeries(times) {
  const now = Date.now();
  if (times.length === 0) return { points: [[now, 0]], total: 0, now };
  const points = times.map((t, i) => [t, i + 1]);
  if (points[points.length - 1][0] < now) points.push([now, times.length]);
  return { points, total: times.length, now };
}

function niceCeil(n) {
  if (n <= 5) return 5;
  const pow = Math.pow(10, Math.floor(Math.log10(n)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    const step = m * pow;
    if (Math.ceil(n / step) * step >= n) return Math.ceil(n / step) * step;
  }
  return Math.ceil(n / pow) * pow;
}

function fmtDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function renderSvg({ points, total, now }, theme) {
  const W = 880;
  const H = 360;
  const padL = 64;
  const padR = 32;
  const padT = 56;
  const padB = 44;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const t0 = points[0][0];
  const t1 = points[points.length - 1][0];
  const spanT = Math.max(1, t1 - t0);
  const yMax = niceCeil(Math.max(total, 1));

  const x = (t) => padL + ((t - t0) / spanT) * plotW;
  const y = (c) => padT + plotH - (c / yMax) * plotH;

  const coords = points.map(([t, c]) => [x(t), y(c)]);
  const linePath = coords.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)} ${(padT + plotH).toFixed(1)} L${coords[0][0].toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  const bg = theme === 'dark' ? '#0d1117' : 'transparent';
  const textColor = theme === 'dark' ? '#94a3b8' : '#334155';
  const gridColor = theme === 'dark' ? '#1e293b' : '#e2e8f0';
  const line = '#7c3aed';

  // 4 horizontal gridlines (including 0 and yMax).
  const rows = [0, 1, 2, 3, 4];
  const grid = rows
    .map((r) => {
      const val = Math.round((yMax / 4) * r);
      const gy = y(val);
      return (
        `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${(padL + plotW).toFixed(1)}" y2="${gy.toFixed(1)}" stroke="${gridColor}" stroke-width="1"/>` +
        `<text x="${padL - 10}" y="${(gy + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="${textColor}">${val}</text>`
      );
    })
    .join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <rect width="${W}" height="${H}" fill="${bg}"/>
  <text x="${padL}" y="32" font-size="17" font-weight="600" fill="${textColor}">wigolo — GitHub stars over time</text>
  <text x="${W - padR}" y="30" text-anchor="end" font-size="22" font-weight="700" fill="${line}">${total} ★</text>
  <text x="${W - padR}" y="48" text-anchor="end" font-size="11" fill="${textColor}" opacity="0.7">updated ${fmtDate(now)}</text>
  ${grid}
  <path d="${areaPath}" fill="${line}" fill-opacity="0.12" stroke="none"/>
  <path d="${linePath}" fill="none" stroke="${line}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  <text x="${padL}" y="${H - 16}" text-anchor="start" font-size="12" fill="${textColor}">${fmtDate(t0)}</text>
  <text x="${padL + plotW}" y="${H - 16}" text-anchor="end" font-size="12" fill="${textColor}">${fmtDate(t1)}</text>
</svg>
`;
}

async function main() {
  const times = await fetchStargazers();
  const series = buildSeries(times);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'star-history.svg'), renderSvg(series, 'light'), 'utf-8');
  writeFileSync(join(OUT_DIR, 'star-history-dark.svg'), renderSvg(series, 'dark'), 'utf-8');
  process.stderr.write(`star-chart: ${REPO} — ${series.total} stars, ${series.points.length} points, wrote 2 SVGs to ${OUT_DIR}/\n`);
}

main().catch((err) => {
  process.stderr.write(`star-chart: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
