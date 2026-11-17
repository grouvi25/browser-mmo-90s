// Кооператив для ПК (Дима 17.11: «отдельным окном, установочный файл — так и нужно»).
// Окно с игрой kooperativ.space: без адресной строки, со своим ярлыком, запоминает
// размер окна. Ссылки на чужие сайты открываются в обычном браузере. Без сети
// показывает экран «нет связи» с повтором. Сама игра не меняется: это тот же сайт.
const { app, BrowserWindow, shell, Menu } = require('electron')
const path = require('path')
const fs = require('fs')

const SITE = 'https://kooperativ.space'
// Метки, чтобы в отчёте «откуда пришли» видеть игроков из программы для ПК.
const START = `${SITE}/?utm_source=desktop&utm_medium=app`
const STATE_FILE = path.join(app.getPath('userData'), 'window.json')

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return { width: 1366, height: 860 } }
}
function saveState(win) {
  try {
    const bounds = win.getNormalBounds()
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...bounds, maximized: win.isMaximized() }))
  } catch { /* не записалось — откроемся с размером по умолчанию */ }
}
const isGame = url => { try { return new URL(url).hostname.endsWith('kooperativ.space') } catch { return false } }

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let win
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    const state = readState()
    win = new BrowserWindow({
      ...state,
      minWidth: 1024,
      minHeight: 680,
      title: 'Кооператив',
      backgroundColor: '#faeadd',
      icon: path.join(__dirname, 'build', 'icon.png'),
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
    })
    if (state.maximized) win.maximize()
    win.once('ready-to-show', () => win.show())
    win.webContents.setUserAgent(`${win.webContents.getUserAgent()} KooperativDesktop/${app.getVersion()}`)

    // Чужие ссылки (документы, соцсети, оплата у банка) — в обычный браузер.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isGame(url)) { win.loadURL(url); return { action: 'deny' } }
      shell.openExternal(url)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event, url) => {
      if (url.startsWith('file:') || isGame(url)) return
      event.preventDefault()
      shell.openExternal(url)
    })
    win.webContents.on('did-fail-load', (_event, code, _desc, url, isMainFrame) => {
      if (isMainFrame && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'), { query: { back: url || START } })
    })
    // F5 — обновить, F11 — во весь экран, Ctrl+колесо/плюс/минус — масштаб.
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      if (input.key === 'F5') { win.webContents.reload(); event.preventDefault() }
      if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); event.preventDefault() }
      if (input.control && (input.key === '=' || input.key === '+')) { win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5); event.preventDefault() }
      if (input.control && input.key === '-') { win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5); event.preventDefault() }
      if (input.control && input.key === '0') { win.webContents.setZoomLevel(0); event.preventDefault() }
    })
    win.on('close', () => saveState(win))
    win.loadURL(START)
  })

  app.on('window-all-closed', () => app.quit())
}
