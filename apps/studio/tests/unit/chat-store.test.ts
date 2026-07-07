import { describe, it, expect } from 'vitest';
import { createChatStore } from '../../src/renderer/chat-store';

describe('chat-store', () => {
  it('appends messages in order and lists them', () => {
    const s = createChatStore();
    s.add({ author: 'agent', text: 'looking at the pricing page', ts: 1 });
    s.add({ author: 'human', text: 'focus on the Pro tier', ts: 2 });
    expect(s.list().map((m) => m.text)).toEqual(['looking at the pricing page', 'focus on the Pro tier']);
    expect(s.list().map((m) => m.author)).toEqual(['agent', 'human']);
  });
  it('notifies subscribers on add and on clear', () => {
    const s = createChatStore();
    let ticks = 0;
    const off = s.subscribe(() => { ticks++; });
    s.add({ author: 'agent', text: 'hi', ts: 1 });
    expect(ticks).toBe(1);
    s.clear();
    expect(ticks).toBe(2);
    expect(s.list()).toEqual([]);
    off();
    s.add({ author: 'agent', text: 'after unsub', ts: 2 });
    expect(ticks).toBe(2);
  });
});
