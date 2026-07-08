import { describe, it, expect } from 'vitest';
import { inferRows, type MatchSubtree } from '../../../src/studio/extract-set.js';

// CDP DOM.Node-shaped minimal fixtures: nodeType 1 = element, 3 = text.
const el = (name: string, children: MatchSubtree[]): MatchSubtree => ({ nodeType: 1, nodeName: name, children });
const txt = (v: string): MatchSubtree => ({ nodeType: 3, nodeName: '#text', nodeValue: v, children: [] });
const card = (title: string, price: string): MatchSubtree =>
  el('DIV', [el('H3', [txt(title)]), el('SPAN', [txt(price)])]);

describe('inferRows', () => {
  it('derives stable columns from a repeating card structure', () => {
    const { columns, rows } = inferRows([card('Pro', '$20'), card('Team', '$40'), card('Free', '$0')]);
    expect(columns.length).toBe(2);
    expect(rows).toHaveLength(3);
    expect(Object.values(rows[0])).toEqual(['Pro', '$20']);
  });

  it('degrades a non-repeating / single unique element to one text column (NEGATIVE: no bogus wide cluster)', () => {
    const { columns, rows } = inferRows([el('P', [txt('just one paragraph of text')])]);
    expect(columns).toEqual(['text']);
    expect(rows[0].text).toContain('just one paragraph');
  });

  it('degrades to text when matches share no majority sub-path (NEGATIVE)', () => {
    const { columns } = inferRows([el('DIV', [el('H1', [txt('a')])]), el('DIV', [el('SPAN', [txt('b')])])]);
    expect(columns).toEqual(['text']);
  });

  it('leaves a cell empty when a match lacks a column', () => {
    const full = card('Pro', '$20');
    const partial = el('DIV', [el('H3', [txt('NoPrice')])]);
    const { columns, rows } = inferRows([full, full, partial]);
    // the price column (2nd) is absent on the partial match → empty string, not an undefined crash
    expect(rows[2][columns[1]] ?? '').toBe('');
  });

  it('returns empty for zero matches', () => {
    expect(inferRows([])).toEqual({ columns: [], rows: [] });
  });
});
