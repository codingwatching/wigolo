import { app, BrowserWindow, WebContentsView } from 'electron';
import { join } from 'node:path';
import { TabManager, type TabView, type Rect } from './tab-manager';
import { SessionRegistry } from './session-registry';
import { registerIpc } from './ipc-host';

const CHROME_HEIGHT = 88;

const cdpPort = process.env.WIGOLO_STUDIO_CDP_PORT;
if (cdpPort) app.commandLine.appendSwitch('remote-debugging-port', cdpPort);

function makeViewFactory(win: BrowserWindow): () => TabView {
  return () => {
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.contentView.addChildView(view);
    const wc = view.webContents;
    return {
      loadURL: (url) => wc.loadURL(url),
      setBounds: (b: Rect) => view.setBounds(b),
      setVisible: (v: boolean) => view.setVisible(v),
      destroy: () => {
        win.contentView.removeChildView(view);
        wc.close();
      },
      getURL: () => wc.getURL(),
      getTitle: () => wc.getTitle(),
      onStateChange: (cb) => {
        wc.on('page-title-updated', cb);
        wc.on('did-navigate', cb);
        wc.on('did-navigate-in-page', cb);
      },
    };
  };
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const bounds = (): Rect => {
    const [width, height] = win.getContentSize();
    return { x: 0, y: CHROME_HEIGHT, width, height: height - CHROME_HEIGHT };
  };
  const tabs = new TabManager(makeViewFactory(win), bounds);
  const sessions = new SessionRegistry();
  registerIpc(win, tabs, sessions);
  win.on('resize', () => tabs.relayout());

  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
  win.show();
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
