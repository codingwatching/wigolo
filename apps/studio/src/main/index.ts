import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

// CDP for the agent drive engine (spec §2). Env-gated: never on unless studio launched with it.
const cdpPort = process.env.WIGOLO_STUDIO_CDP_PORT;
if (cdpPort) app.commandLine.appendSwitch('remote-debugging-port', cdpPort);

async function createWindow(): Promise<BrowserWindow> {
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
  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
  win.show();
  return win;
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
