/** Shell-owned modal windows cover the parent's content without replacing its native window controls. */
import { BrowserWindow } from 'electron'

/** How a shell modal presents itself over its parent. */
export type DesktopDialogSurface = 'overlay' | 'window'

/** Opaque card size used where the transparent sheet cannot composite. */
const CARD_WIDTH = 420
const CARD_HEIGHT = 320

/**
 * A transparent sheet needs a compositing server to blend the scrim's alpha.
 * Linux without one renders that alpha as an opaque backing, so the sheet
 * covers the parent with a dark slab; Linux gets an opaque card instead.
 * @param platform - Platform that will host the modal.
 * @returns Presentation surface for shell modals on that platform.
 */
export function desktopDialogSurface(platform: NodeJS.Platform = process.platform): DesktopDialogSurface {
  return platform === 'linux' ? 'window' : 'overlay'
}

/**
 * The mandatory modal needs native move, resize, and maximize, which the frameless
 * sheet cannot offer on Windows, so only macOS keeps the sheet there.
 * @param platform - Platform that will host the modal.
 * @returns Presentation surface for the mandatory modal on that platform.
 */
export function mandatoryUpdateSurface(platform: NodeJS.Platform = process.platform): DesktopDialogSurface {
  return platform === 'darwin' ? 'overlay' : 'window'
}

/**
 * @param parent - Product window whose content is blocked while the card is open.
 * @param preload - Isolated shell-only preload.
 * @param title - Localized window title.
 * @returns An opaque frameless card centered on its parent's content bounds.
 */
function createDialogCard(parent: BrowserWindow, preload: string, title: string): BrowserWindow {
  const bounds = parent.getContentBounds()
  const width = Math.min(CARD_WIDTH, bounds.width)
  const height = Math.min(CARD_HEIGHT, bounds.height)
  const window = new BrowserWindow({
    parent, modal: true, show: false, frame: false,
    x: Math.round(bounds.x + (bounds.width - width) / 2),
    y: Math.round(bounds.y + (bounds.height - height) / 2),
    width, height, resizable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, backgroundColor: '#ffffff', title,
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  })
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
  window.setMenu(null)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return window
}

/**
 * @param parent - Product window whose content is blocked while the prompt is open.
 * @param preload - Isolated shell-only preload.
 * @param title - Localized window title.
 * @param platform - Platform that will host the prompt.
 * @returns The prompt modal for that platform.
 */
export function createUpdatePromptWindow(parent: BrowserWindow, preload: string, title: string,
  platform: NodeJS.Platform = process.platform): BrowserWindow {
  return desktopDialogSurface(platform) === 'window'
    ? createDialogCard(parent, preload, title)
    : createUpdateOverlay(parent, preload, title)
}

/**
 * @param parent - Product window whose content is blocked while the overlay is open.
 * @param preload - Isolated shell-only preload.
 * @param title - Localized window title.
 * @returns A transparent child that follows its parent's content bounds and releases its listeners on close.
 */
function createUpdateOverlay(parent: BrowserWindow, preload: string, title: string): BrowserWindow {
  const window = new BrowserWindow({
    parent, modal: true, show: false, frame: false, transparent: true,
    ...parent.getContentBounds(), resizable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, hasShadow: false, title,
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  })
  const follow = (): void => { if (!window.isDestroyed()) window.setBounds(parent.getContentBounds()) }
  parent.on('move', follow)
  parent.on('resize', follow)
  let closed = false
  let blur: string | undefined
  const unblur = (): void => {
    if (blur === undefined || parent.isDestroyed()) return
    void parent.webContents.removeInsertedCSS(blur).catch((error: unknown) => { console.warn('desktop update: could not remove background blur', error) })
    blur = undefined
  }
  void parent.webContents.insertCSS('body { filter: blur(2px) !important; }').then((key) => {
    blur = key
    if (closed) unblur()
  }).catch((error: unknown) => { console.warn('desktop update: could not blur background', error) })
  window.once('closed', () => { closed = true; unblur() })
  window.once('closed', () => { parent.off('move', follow); parent.off('resize', follow) })
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
  window.setMenu(null)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return window
}

/** A native framed modal retains its own title bar while the product window remains blocked. */
export function createMandatoryUpdateWindow(parent: BrowserWindow, preload: string, title: string,
  platform: NodeJS.Platform = process.platform): BrowserWindow {
  if (mandatoryUpdateSurface(platform) === 'overlay') return createUpdateOverlay(parent, preload, title)
  const window = new BrowserWindow({
    parent, modal: true, show: false, title,
    width: 640, height: 560, minWidth: 480, minHeight: 360,
    movable: true, resizable: true, maximizable: true,
    backgroundColor: '#f5f5f5',
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  })
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return window
}
