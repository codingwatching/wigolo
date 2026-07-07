import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatPanel } from '../../src/renderer/ChatPanel';
import type { ChatMsgDto } from '../../src/shared/ipc';

const msgs: ChatMsgDto[] = [
  { author: 'agent', text: 'I found the pricing table', ts: 1 },
  { author: 'human', text: 'compare the Pro tier', ts: 2 },
  { author: 'agent', text: 'replying on your mark', markId: 'm3', ts: 3 },
];

describe('ChatPanel', () => {
  it('renders each message tagged by author', () => {
    const html = renderToStaticMarkup(<ChatPanel messages={msgs} />);
    expect(html).toContain('chat__msg--agent');
    expect(html).toContain('chat__msg--human');
    expect(html).toContain('I found the pricing table');
    expect(html).toContain('compare the Pro tier');
  });
  it('shows an on-mark affordance for a threaded reply', () => {
    const html = renderToStaticMarkup(<ChatPanel messages={msgs} />);
    expect(html.toLowerCase()).toContain('mark');
    expect(html).toContain('m3');
  });
  it('renders nothing but the empty container when there are no messages', () => {
    const html = renderToStaticMarkup(<ChatPanel messages={[]} />);
    expect(html).not.toContain('chat__msg--');
  });
});
