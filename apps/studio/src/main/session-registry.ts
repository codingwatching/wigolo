import { randomUUID } from 'node:crypto';

export interface StudioSession {
  id: string;
  name: string;
  tabIds: string[];
  createdAt: number;
}

export class SessionRegistry {
  private sessions = new Map<string, StudioSession>();
  private currentId: string;

  constructor() {
    const def: StudioSession = { id: randomUUID(), name: 'default', tabIds: [], createdAt: Date.now() };
    this.sessions.set(def.id, def);
    this.currentId = def.id;
  }

  current(): StudioSession {
    return this.sessions.get(this.currentId)!;
  }

  list(): StudioSession[] {
    return [...this.sessions.values()];
  }

  addTab(sessionId: string, tabId: string): void {
    this.get(sessionId).tabIds.push(tabId);
  }

  removeTab(sessionId: string, tabId: string): void {
    const s = this.get(sessionId);
    s.tabIds = s.tabIds.filter((t) => t !== tabId);
  }

  private get(sessionId: string): StudioSession {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`unknown session: ${sessionId}`);
    return s;
  }
}
