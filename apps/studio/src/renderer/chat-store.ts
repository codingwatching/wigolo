import type { ChatMsgDto } from '../shared/ipc';

// Renderer-side chat transcript for the Agent/Chat rail. Same subscriber pattern as marks/captures store.
// Agent messages arrive live via studio_say (main → renderer); human messages are added optimistically when
// the composer posts (and delivered to the agent via sendChat → the observe drain).

export interface ChatStore {
  add(msg: ChatMsgDto): void;
  list(): ChatMsgDto[];
  clear(): void;
  subscribe(cb: () => void): () => void;
}

export function createChatStore(): ChatStore {
  let msgs: ChatMsgDto[] = [];
  const subs = new Set<() => void>();
  const emit = (): void => { for (const cb of subs) cb(); };
  return {
    add(msg) { msgs = [...msgs, msg]; emit(); },
    list() { return msgs; },
    clear() { msgs = []; emit(); },
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb); },
  };
}
