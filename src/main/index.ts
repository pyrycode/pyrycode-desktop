import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'

// The relay socket, the Noise_IK handshake, the frame codec, and event parsing
// all live in this background process. See docs/knowledge/decisions/0001. The
// renderer receives already-typed events over IPC and never sees raw bytes or keys.

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    show: false,
    title: 'Pyrycode Desktop',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
