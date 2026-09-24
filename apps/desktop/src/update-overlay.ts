/** Shell-owned modal windows cover the parent's content without replacing its native window controls. */
import { BrowserWindow, nativeTheme } from 'electron'

/** How a shell modal presents itself over its parent. */
export type DesktopDialogSurface = 'overlay' | 'window'

/**
 * Opaque card size used where the transparent sheet cannot composite. The height is
 * the pre-measurement size only: the document reports its content height once laid
 * out and `fitDialogCard` shrinks or grows the card to it, because a fixed height
 * leaves bare backing under a short prompt and scrolls a long one.
 */
const CARD_WIDTH = 420
const CARD_HEIGHT = 320
/** Keeps a card that reports an implausibly small height from collapsing past its controls. */
const CARD_MIN_HEIGHT = 120

const unblockedInput = { revision: 0, blocked: false } as const

/**
 * Pre-paint background for an opaque shell window. The document paints the same
 * color from its `--shell-surface` token once it loads, so a mismatch would flash.
 * @returns The CSS color matching the document's surface token in the current theme.
 */
function surfaceBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#232324' : '#ffffff'
}

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
    skipTaskbar: true, backgroundColor: surfaceBackground(), title,
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  })
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
  window.setMenu(null)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return window
}

/**
 * A native framed modal retains its own title bar while the product window remains blocked.
 * @param parent - Product window whose content is blocked while the modal is open.
 * @param preload - Isolated shell-only preload.
 * @param title - Localized window title.
 * @returns A resizable framed child centered by the window manager.
 */
function createFramedModal(parent: BrowserWindow, preload: string, title: string): BrowserWindow {
  const window = new BrowserWindow({
    parent, modal: true, show: false, title,
    width: 640, height: 560, minWidth: 480, minHeight: 360,
    movable: true, resizable: true, maximizable: true,
    backgroundColor: surfaceBackground(),
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  })
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return window
}

/**
 * Resize an opaque card to the height its document measured, keeping it centered on
 * the parent. The sheet surface already spans its parent, so this is a no-op there.
 * @param window - The prompt window to fit.
 * @param height - Content height the document reported, in CSS pixels.
 * @param platform - Platform hosting the prompt, selecting whether a card is in use.
 */
export function fitDialogCard(window: BrowserWindow, height: number,
  platform: NodeJS.Platform = process.platform): void {
  if (desktopDialogSurface(platform) !== 'window' || window.isDestroyed()) return
  const parent = window.getParentWindow()
  if (parent === null || parent.isDestroyed()) return
  const bounds = parent.getContentBounds()
  const fitted = Math.min(Math.max(Math.round(height), CARD_MIN_HEIGHT), bounds.height)
  const width = Math.min(CARD_WIDTH, bounds.width)
  window.setBounds({
    x: Math.round(bounds.x + (bounds.width - width) / 2),
    y: Math.round(bounds.y + (bounds.height - fitted) / 2),
    width, height: fitted,
  })
}

/** Tracks application-owned update overlays and their parent input state. */
export class DesktopUpdateOverlays {
  private readonly inputStates = new WeakMap<BrowserWindow, { revision: number; active: number; readonly blocked: boolean }>()

  /**
   * @param parent - Product window whose input may belong to an update dialog.
   * @returns Current blocking state; its revision changes whenever an overlay opens or closes.
   */
  input(parent: BrowserWindow): { readonly revision: number; readonly blocked: boolean } {
    return this.inputStates.get(parent) ?? unblockedInput
  }

  /**
   * @param parent - Product window whose content is blocked while the overlay is open.
   * @param preload - Isolated shell-only preload.
   * @param title - Localized window title.
   * @param nativeModal - Use a native modal; false keeps overlays out of macOS sheets.
   * @param platform - Platform that hosts the overlay, deciding whether it is a native modal.
   * @returns A transparent child that follows its parent's bounds and visibility after loading and releases its listeners on close.
   */
  create(parent: BrowserWindow, preload: string, title: string, nativeModal = true,
    platform: NodeJS.Platform = process.platform): BrowserWindow {
    const window = new BrowserWindow({
      parent, modal: nativeModal || platform !== 'darwin', show: false, frame: false, transparent: true,
      ...parent.getContentBounds(), resizable: false, minimizable: false, maximizable: false,
      skipTaskbar: true, hasShadow: false, title,
      webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
    })
    this.track(parent, window)
    // macOS native modals animate the entire viewport as a sheet.
    const focus = (): void => { if (!window.isDestroyed()) window.focus() }
    const blockInput = (event: Electron.Event): void => { event.preventDefault(); focus() }
    if (!nativeModal && platform === 'darwin') {
      parent.on('focus', focus)
      // Shell dialogs block input before product shortcut listeners can dispatch it.
      parent.webContents.prependListener('before-input-event', blockInput)
      window.once('closed', () => {
        parent.off('focus', focus)
        if (!parent.isDestroyed()) parent.webContents.off('before-input-event', blockInput)
      })
    }
    const follow = (): void => { if (!window.isDestroyed()) window.setBounds(parent.getContentBounds()) }
    parent.on('move', follow)
    parent.on('resize', follow)
    window.once('closed', () => { parent.off('move', follow); parent.off('resize', follow) })
    let ready = false
    const show = (): void => {
      if (ready && !window.isDestroyed() && !parent.isDestroyed() && parent.isVisible()) window.show()
    }
    parent.on('show', show)
    window.once('closed', () => { parent.off('show', show) })
    window.once('ready-to-show', () => { ready = true; show() })
    window.setMenu(null)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    return window
  }

  /**
   * @param parent - Product window whose content is blocked while the prompt is open.
   * @param preload - Isolated shell-only preload.
   * @param title - Localized window title.
   * @param platform - Platform that hosts the prompt, selecting its surface.
   * @returns The prompt modal for that platform.
   */
  createPrompt(parent: BrowserWindow, preload: string, title: string,
    platform: NodeJS.Platform = process.platform): BrowserWindow {
    return desktopDialogSurface(platform) === 'window'
      ? this.track(parent, createDialogCard(parent, preload, title))
      : this.create(parent, preload, title, false, platform)
  }

  /**
   * @param parent - Product window whose content is blocked while the modal is open.
   * @param preload - Isolated shell-only preload.
   * @param title - Localized window title.
   * @param platform - Platform that hosts the modal, selecting its surface.
   * @returns The mandatory modal for that platform.
   */
  createMandatory(parent: BrowserWindow, preload: string, title: string,
    platform: NodeJS.Platform = process.platform): BrowserWindow {
    return mandatoryUpdateSurface(platform) === 'window'
      ? this.track(parent, createFramedModal(parent, preload, title))
      : this.create(parent, preload, title, false, platform)
  }

  /**
   * @param parent - Product window whose input this overlay blocks.
   * @param window - Overlay that owns the block.
   * @returns The tracked overlay.
   */
  private track(parent: BrowserWindow, window: BrowserWindow): BrowserWindow {
    const inputState = this.inputStates.get(parent) ?? { revision: 0, active: 0, get blocked() { return this.active > 0 } }
    this.inputStates.set(parent, inputState)
    inputState.active++; inputState.revision++
    window.once('closed', () => { inputState.active--; inputState.revision++ })
    return window
  }
}
