import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import {
  createMandatoryUpdateWindow,
  createUpdatePromptWindow,
  desktopDialogSurface,
  fitDialogCard,
  mandatoryUpdateSurface,
} from '../src/update-overlay.ts'

const native = vi.hoisted(() => ({
  create: vi.fn<(options: BrowserWindowConstructorOptions) => object>(),
  theme: { shouldUseDarkColors: false },
}))
vi.mock('electron', () => ({
  BrowserWindow: function (options: object) { return native.create(options) },
  nativeTheme: native.theme,
}))

beforeEach(() => {
  native.create.mockReset()
  native.theme.shouldUseDarkColors = false
})

function fakeWindow() {
  return Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() }),
    show: vi.fn(), focus: vi.fn(), setBounds: vi.fn(), setMenu: vi.fn(), isDestroyed: () => false,
  })
}

/** Parent that answers the content bounds and CSS insertion the sheet surface needs. */
function fakeParent() {
  const insertCSS = vi.fn(async () => 'blur')
  const parent = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), { insertCSS, removeInsertedCSS: vi.fn(async () => {}) }),
    getContentBounds: () => ({ x: 100, y: 200, width: 900, height: 650 }),
    isDestroyed: () => false,
  }) as unknown as BrowserWindow
  return { parent, insertCSS }
}

it('gives the Windows mandatory modal native move, resize, and maximize controls', () => {
  const window = fakeWindow()
  native.create.mockReturnValue(window)
  const parent = {} as BrowserWindow
  expect(createMandatoryUpdateWindow(parent, 'owned', 'Update required', 'win32')).toBe(window)
  expect(native.create).toHaveBeenCalledWith(expect.objectContaining({
    parent, modal: true, show: false, title: 'Update required',
    movable: true, resizable: true, maximizable: true,
    minWidth: 480, minHeight: 360,
  }))
  const options = native.create.mock.calls[0]![0]
  expect(options.webPreferences).toMatchObject({ preload: 'owned', sandbox: true, nodeIntegration: false })
  expect(options).not.toHaveProperty('frame', false)
  window.emit('ready-to-show')
  expect(window.show).toHaveBeenCalledOnce()
  expect(window.webContents.setWindowOpenHandler).toHaveBeenCalledOnce()
})

it('gives the Linux mandatory modal the same framed controls', () => {
  const window = fakeWindow()
  native.create.mockReturnValue(window)
  expect(createMandatoryUpdateWindow(fakeParent().parent, 'owned', 'Update required', 'linux')).toBe(window)
  const options = native.create.mock.calls[0]![0]
  expect(options).toMatchObject({ modal: true, movable: true, resizable: true, minWidth: 480, minHeight: 360 })
  expect(options).not.toHaveProperty('transparent')
})

it('selects the surface each platform can actually composite', () => {
  expect(desktopDialogSurface('linux')).toBe('window')
  expect(desktopDialogSurface('darwin')).toBe('overlay')
  expect(desktopDialogSurface('win32')).toBe('overlay')
  // The mandatory modal needs native window controls, which the frameless sheet cannot offer.
  expect(mandatoryUpdateSurface('darwin')).toBe('overlay')
  expect(mandatoryUpdateSurface('win32')).toBe('window')
  expect(mandatoryUpdateSurface('linux')).toBe('window')
})

it('centers an opaque card on Linux instead of a transparent sheet', () => {
  const window = fakeWindow()
  native.create.mockReturnValue(window)
  const { parent, insertCSS } = fakeParent()
  expect(createUpdatePromptWindow(parent, 'owned', 'Check for updates', 'linux')).toBe(window)
  const options = native.create.mock.calls[0]![0]
  expect(options).toMatchObject({
    parent, modal: true, frame: false, backgroundColor: '#ffffff', resizable: false,
    x: 100 + (900 - 420) / 2, y: 200 + (650 - 320) / 2, width: 420, height: 320,
  })
  // A transparent window without a compositor paints its alpha as an opaque backing.
  expect(options).not.toHaveProperty('transparent')
  expect(insertCSS).not.toHaveBeenCalled()
})

it('prepaints the opaque surfaces in the theme the document will paint itself', () => {
  const { parent } = fakeParent()
  const card = fakeWindow()
  native.create.mockReturnValue(card)
  createUpdatePromptWindow(parent, 'owned', 'Check for updates', 'linux')
  const mandatory = fakeWindow()
  native.create.mockReturnValue(mandatory)
  createMandatoryUpdateWindow(parent, 'owned', 'Update required', 'win32')
  // 文档加载后会用 --shell-surface 覆盖这个底色，取值不一致就会闪一下白。
  expect(native.create.mock.calls[0]![0]).toMatchObject({ backgroundColor: '#ffffff' })
  expect(native.create.mock.calls[1]![0]).toMatchObject({ backgroundColor: '#ffffff' })
  native.create.mockClear()
  native.theme.shouldUseDarkColors = true
  createUpdatePromptWindow(parent, 'owned', 'Check for updates', 'linux')
  expect(native.create.mock.calls[0]![0]).toMatchObject({ backgroundColor: '#232324' })
})

it('fits the card to its measured content and keeps it centered', () => {
  const { parent } = fakeParent()
  const window = Object.assign(fakeWindow(), { getParentWindow: () => parent })
  fitDialogCard(window as unknown as BrowserWindow, 214, 'linux')
  // 固定 320 高会在短文案下留出一片裸白底，因此按文档量出的高度重新定尺寸。
  expect(window.setBounds).toHaveBeenCalledWith({
    x: 100 + (900 - 420) / 2, y: 200 + (650 - 214) / 2, width: 420, height: 214,
  })
  // A report below the controls' own height would collapse the card past its buttons.
  window.setBounds.mockClear()
  fitDialogCard(window as unknown as BrowserWindow, 12, 'linux')
  expect(window.setBounds).toHaveBeenCalledWith(expect.objectContaining({ height: 120 }))
  // Content taller than the parent cannot grow past it.
  window.setBounds.mockClear()
  fitDialogCard(window as unknown as BrowserWindow, 5_000, 'linux')
  expect(window.setBounds).toHaveBeenCalledWith(expect.objectContaining({ height: 650, y: 200 }))
  // The sheet already spans its parent, so a measurement there must not resize it.
  window.setBounds.mockClear()
  fitDialogCard(window as unknown as BrowserWindow, 214, 'darwin')
  expect(window.setBounds).not.toHaveBeenCalled()
})

it('covers the parent with a transparent sheet where compositing is available', () => {
  const window = fakeWindow()
  native.create.mockReturnValue(window)
  const { parent, insertCSS } = fakeParent()
  createUpdatePromptWindow(parent, 'owned', 'Check for updates', 'darwin')
  const options = native.create.mock.calls[0]![0]
  // 非原生 sheet 靠自身拦截输入，因此不设 modal。
  expect(options).toMatchObject({ parent, modal: false, frame: false, transparent: true, x: 100, y: 200, width: 900, height: 650 })
  expect(insertCSS).toHaveBeenCalledOnce()
})

it('keeps the macOS overlay stationary and blocks parent keyboard input until close', () => {
  const window = fakeWindow()
  native.create.mockReturnValue(window)
  const { parent } = fakeParent()
  // A non-native sheet does not block its parent, so the sheet owns the block itself.
  createUpdatePromptWindow(parent, 'owned', 'Update required', 'darwin')
  expect(native.create).toHaveBeenLastCalledWith(expect.objectContaining({ modal: false, transparent: true, frame: false }))
  const event = { preventDefault: vi.fn() }
  parent.webContents.emit('before-input-event', event)
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(window.focus).toHaveBeenCalledOnce()
  window.emit('closed')
  expect(parent.listenerCount('focus')).toBe(0)
  expect(parent.webContents.listenerCount('before-input-event')).toBe(0)
})
