import { ipcMain, type BrowserWindow } from 'electron';
import { IPC, type StudioState } from '../shared/ipc';
import type { TabManager } from './tab-manager';
import type { SessionRegistry } from './session-registry';

export function registerIpc(win: BrowserWindow, tabs: TabManager, sessions: SessionRegistry): void {
  const state = (): StudioState => ({
    sessionName: sessions.current().name,
    tabs: tabs.listTabs(),
  });
  const broadcast = () => win.webContents.send(IPC.stateChanged, state());
  tabs.onChange(broadcast);

  ipcMain.handle(IPC.getState, () => state());
  ipcMain.handle(IPC.tabCreate, (_e, url: string) => {
    const id = tabs.createTab(url);
    sessions.addTab(sessions.current().id, id);
    return id;
  });
  ipcMain.handle(IPC.tabClose, (_e, id: string) => {
    tabs.closeTab(id);
    sessions.removeTab(sessions.current().id, id);
  });
  ipcMain.handle(IPC.tabFocus, (_e, id: string) => tabs.focusTab(id));
  ipcMain.handle(IPC.tabNavigate, (_e, id: string, url: string) => tabs.navigate(id, url));
}
