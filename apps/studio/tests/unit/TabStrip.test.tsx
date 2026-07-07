import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TabStrip } from '../../src/renderer/TabStrip';
import type { TabInfo } from '../../src/shared/ipc';

const tabs: TabInfo[] = [{ id: 't1', url: 'https://example.com', title: 'Example', active: true }];

describe('TabStrip provenance dots', () => {
  it('renders a violet agent dot when provenance is agent', () => {
    const html = renderToStaticMarkup(<TabStrip tabs={tabs} onFocus={() => {}} onClose={() => {}} onNew={() => {}} provenance={() => 'agent'} />);
    expect(html).toContain('tab__dot--agent');
    expect(html).not.toContain('tab__fav');
  });
  it('renders an amber working dot when provenance is working', () => {
    const html = renderToStaticMarkup(<TabStrip tabs={tabs} onFocus={() => {}} onClose={() => {}} onNew={() => {}} provenance={() => 'working'} />);
    expect(html).toContain('tab__dot--working');
  });
  it('renders a green human dot when provenance is human', () => {
    const html = renderToStaticMarkup(<TabStrip tabs={tabs} onFocus={() => {}} onClose={() => {}} onNew={() => {}} provenance={() => 'human'} />);
    expect(html).toContain('tab__dot--human');
  });
  it('falls back to the favicon chip when provenance is none (or absent)', () => {
    const html = renderToStaticMarkup(<TabStrip tabs={tabs} onFocus={() => {}} onClose={() => {}} onNew={() => {}} provenance={() => 'none'} />);
    expect(html).toContain('tab__fav');
    expect(html).not.toContain('tab__dot--');
    const noProp = renderToStaticMarkup(<TabStrip tabs={tabs} onFocus={() => {}} onClose={() => {}} onNew={() => {}} />);
    expect(noProp).toContain('tab__fav');
  });
});
