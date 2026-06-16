import { describe, it, expect } from 'vitest';
import { computeFingerprint, assignRefs } from '../../../../src/studio/perception/id.js';

describe('computeFingerprint — fixed normalization (pinned; the 2D numbers transfer only if this is stable)', () => {
  it('is role+name based, case-folds the role, trims + collapses whitespace in the name', () => {
    const a = computeFingerprint({ role: 'button', name: 'Save' });
    expect(computeFingerprint({ role: 'BUTTON', name: '  Save  ' })).toBe(a); // role case + name trim
    expect(computeFingerprint({ role: 'button', name: 'Save\n  Now' })).toBe(computeFingerprint({ role: 'button', name: 'Save Now' })); // whitespace collapse
    expect(computeFingerprint({ role: 'button', name: 'Delete' })).not.toBe(a); // different name → different fp
    expect(computeFingerprint({ role: 'link', name: 'Save' })).not.toBe(a); // different role → different fp
  });

  it('includes a SMALL stable attribute subset (type/name/placeholder), order-independent, and ignores volatile attrs', () => {
    const base = computeFingerprint({ role: 'textbox', name: 'Email' });
    const withType = computeFingerprint({ role: 'textbox', name: 'Email', attrs: { type: 'email' } });
    expect(withType).not.toBe(base); // a stable attr distinguishes
    // attribute ORDER must not matter
    expect(computeFingerprint({ role: 'textbox', name: 'Email', attrs: { type: 'email', name: 'q' } }))
      .toBe(computeFingerprint({ role: 'textbox', name: 'Email', attrs: { name: 'q', type: 'email' } }));
    // volatile attrs (id/class/style) must NOT enter the fingerprint (else re-render drift)
    expect(computeFingerprint({ role: 'textbox', name: 'Email', attrs: { id: 'react-xyz', class: 'a b' } })).toBe(base);
  });
});

describe('assignRefs — PURE function of live state (no counter, no registry; cold == warm)', () => {
  it('is deterministic: identical input → identical refs (a cold service yields the same handles as a warm one)', () => {
    const nodes = [
      { fingerprint: 'button\x00Task 1', positionPath: 'section[0]/div[0]/button[0]' },
      { fingerprint: 'button\x00Task 2', positionPath: 'section[0]/div[1]/button[0]' },
    ];
    const first = assignRefs(nodes);
    const second = assignRefs(nodes.map((n) => ({ ...n }))); // separate call, fresh objects
    expect(second).toEqual(first);
    expect(first.every((r) => /^e[0-9a-z]+$/.test(r.ref))).toBe(true);
  });

  it('a UNIQUE fingerprint ignores position — its ref is stable across reorder', () => {
    const atP1 = assignRefs([{ fingerprint: 'button\x00Task 3', positionPath: '/a' }])[0];
    const atP2 = assignRefs([{ fingerprint: 'button\x00Task 3', positionPath: '/b' }])[0];
    expect(atP2.ref).toBe(atP1.ref); // unique → position not in the key → survives reorder
    expect(atP1.confidence).toBeUndefined(); // unique → high confidence
  });

  it('a COLLIDING fingerprint is disambiguated by position AND flagged low-confidence AT SNAPSHOT TIME', () => {
    const out = assignRefs([
      { fingerprint: 'button\x00Delete', positionPath: 'section[1]/button[0]' },
      { fingerprint: 'button\x00Delete', positionPath: 'section[1]/button[1]' },
      { fingerprint: 'button\x00Delete', positionPath: 'section[1]/button[2]' },
    ]);
    expect(new Set(out.map((r) => r.ref)).size).toBe(3); // distinct refs — NOT ambiguous (the fp-only failure)
    expect(out.every((r) => r.confidence === 'low')).toBe(true); // ≥2 identical-fingerprint siblings → low NOW
  });

  it('mixed: unique siblings stay high-confidence, identical run is low-confidence — in the SAME snapshot', () => {
    const out = assignRefs([
      { fingerprint: 'button\x00Open', positionPath: '/x' },
      { fingerprint: 'button\x00Delete', positionPath: '/y' },
      { fingerprint: 'button\x00Delete', positionPath: '/z' },
    ]);
    expect(out[0].confidence).toBeUndefined(); // unique
    expect(out[1].confidence).toBe('low');
    expect(out[2].confidence).toBe('low');
  });
});
