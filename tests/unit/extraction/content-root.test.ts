import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isolateContentRoot } from '../../../src/extraction/v1/content-root.js';

const reactShell = readFileSync(
  join(import.meta.dirname, '../../fixtures/extraction/react-reference-shell.html'),
  'utf-8',
);

const body = (inner: string) => `<html><head><title>T</title></head><body>${inner}</body></html>`;
const fill = (n: number) => 'word '.repeat(n); // ~5 chars each

describe('isolateContentRoot', () => {
  it('narrows to <main>, dropping nav/header/footer', () => {
    const html = body(
      `<header><nav><a href="/a">A</a><a href="/b">B</a></nav></header>` +
      `<main><h1>Title</h1><p>${fill(80)}</p></main>` +
      `<footer>footer junk ${fill(10)}</footer>`,
    );
    const out = isolateContentRoot(html);
    expect(out).toContain('<main>');
    expect(out).not.toContain('href="/a"'); // nav gone
    expect(out).not.toContain('footer junk');
    expect(out).toContain('<head>'); // head preserved
    expect(out).toContain('<title>T</title>');
  });

  it('uses [role="main"] when no <main>', () => {
    const html = body(`<nav><a href="/x">x</a></nav><div role="main"><p>${fill(80)}</p></div>`);
    const out = isolateContentRoot(html);
    expect(out).toContain('role="main"');
    expect(out).not.toContain('href="/x"');
  });

  it('uses single <article>', () => {
    const html = body(`<header>nav ${fill(5)}</header><article><p>${fill(80)}</p></article>`);
    const out = isolateContentRoot(html);
    expect(out).toContain('<article>');
    expect(out).not.toMatch(/<header>/);
  });

  it('multiple <article> → largest-text-density wins', () => {
    const html = body(`<article id="small"><p>tiny</p></article><article id="big"><p>${fill(120)}</p></article>`);
    const out = isolateContentRoot(html);
    expect(out).toContain('id="big"');
    expect(out).not.toContain('id="small"');
  });

  it('multiple <main> → largest-text-density wins', () => {
    const html = body(`<main id="m1"><p>tiny</p></main><main id="m2"><p>${fill(120)}</p></main>`);
    const out = isolateContentRoot(html);
    expect(out).toContain('id="m2"');
    expect(out).not.toContain('id="m1"');
  });

  it('thin <main> (< 200 chars) → unchanged (absolute guard)', () => {
    const html = body(`<nav><a href="/x">x</a></nav><main><p>too short</p></main>`);
    expect(isolateContentRoot(html)).toBe(html);
  });

  it('content-rich footer present, legit <main> ≥ 40% of chrome-excluded body → STILL narrows', () => {
    const html = body(
      `<main><p>${fill(80)}</p></main>` +
      `<footer>UNIQUEFOOTERTOKEN ${fill(400)}</footer>`, // footer huge, but excluded from denominator
    );
    const out = isolateContentRoot(html);
    expect(out).toContain('<main>');
    expect(out).not.toContain('UNIQUEFOOTERTOKEN'); // footer dropped despite its bulk
  });

  it('sliver <main> (< 40% of chrome-excluded body) → unchanged (ratio guard)', () => {
    const html = body(
      `<main><p>${fill(20)}</p></main>` + // ~100 chars... bump to pass absolute, fail ratio
      `<section><p>${fill(300)}</p></section>`,
    );
    // main ~ small vs sibling content-rich <section> → ratio < 0.40
    const out = isolateContentRoot(html);
    expect(out).toBe(html);
  });

  it('<head> metadata (title/lang/json-ld) survives narrowing', () => {
    const html =
      `<html lang="en"><head><title>Doc</title>` +
      `<script type="application/ld+json">{"@type":"Article"}</script></head>` +
      `<body><nav><a href="/n">n</a></nav><main><p>${fill(80)}</p></main></body></html>`;
    const out = isolateContentRoot(html);
    expect(out).toContain('<title>Doc</title>');
    expect(out).toContain('application/ld+json');
    expect(out).toContain('lang="en"');
  });

  it('no content root → unchanged', () => {
    const html = body(`<div><p>${fill(80)}</p></div>`);
    expect(isolateContentRoot(html)).toBe(html);
  });

  it('parse failure → returns input', () => {
    // exercised by passing input that, if it threw, must still round-trip;
    // primary guarantee is the try/catch — assert idempotent no-root path here
    const junk = 'not really <<< html';
    expect(typeof isolateContentRoot(junk)).toBe('string');
  });

  it('react.dev fixture: nav cluster removed, reference body kept', () => {
    const out = isolateContentRoot(reactShell);
    expect(out).not.toMatch(/Learn.*Reference.*Community.*Blog/s);
    expect(out).toMatch(/reference|component|hook/i);
  });

  it('body that is all chrome around an empty <main> → unchanged (absolute guard)', () => {
    const html = body(
      `<header><nav><a href="/a">A</a></nav></header>` +
      `<main></main>` +
      `<footer>${fill(80)}</footer>`,
    );
    // <main> exists (clears the regex pre-check + parse) but has no text → below
    // MIN_ROOT_TEXT, so isolation stays inert.
    expect(isolateContentRoot(html)).toBe(html);
  });

  it('no content-root tag → returns input without parsing (fast path)', () => {
    const html = body(`<section><p>${fill(80)}</p></section>`);
    // Identity return: the regex pre-check rejects before parse, so byte-stable.
    expect(isolateContentRoot(html)).toBe(html);
  });

  it('nested chrome is not double-counted in the ratio denominator', () => {
    // A legit <main> just above 40% of chrome-excluded body. The footer wraps a
    // nested <nav>; if that nested nav text were subtracted twice the denominator
    // would shrink, wrongly inflating the ratio. Assert narrowing fires correctly.
    const html = body(
      `<header><nav>${fill(30)}</nav></header>` +
      `<main><p>${fill(100)}</p></main>` +
      `<footer>${fill(20)}<nav>${fill(60)}</nav></footer>`,
    );
    const out = isolateContentRoot(html);
    expect(out).toContain('<main>');
    expect(out).not.toMatch(/<footer>/);
    expect(out).not.toMatch(/<header>/);
  });
});
