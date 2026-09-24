import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, onTestFinished, vi, type Mock } from 'vitest'
import type { BrowserWindow, BrowserWindowConstructorOptions, Menu, WebContents } from 'electron'
import {
  DesktopUpdateOverlays,
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
afterEach(() => { vi.restoreAllMocks() })

type Bounds = { x: number; y: number; width: number; height: number }

/** Parent window fixture answering the bounds, visibility, and destruction checks the surfaces read. */
interface ParentFixture extends EventEmitter {
  webContents: EventEmitter
  getContentBounds(): Bounds
  isDestroyed(): boolean
  isVisible(): boolean
}

/** Child window fixture standing in for the window the mock constructor returns. */
interface ChildFixture extends EventEmitter {
  webContents: EventEmitter & Pick<WebContents, 'setWindowOpenHandler'>
  show(): void
  focus(): void
  setBounds(bounds: Bounds): void
  setMenu(menu: Menu | null): void
  isDestroyed(): boolean
  destroy(): void
  getParentWindow(): BrowserWindow | null
}

/** Recorded calls behind a child fixture; Electron's own type carries no mock API. */
interface ChildCalls {
  show: Mock
  focus: Mock
  setBounds: Mock
  setMenu: Mock
  setWindowOpenHandler: Mock
}

function fakeParent(visible = true): { parent: BrowserWindow; visibility: { visible: boolean } } {
  const visibility = { visible }
  const parent: ParentFixture = Object.assign(new EventEmitter(), {
    webContents: new EventEmitter(),
    getContentBounds: (): Bounds => ({ x: 100, y: 200, width: 900, height: 650 }),
    isDestroyed: (): boolean => false,
    isVisible: (): boolean => visibility.visible,
  })
  return { parent: parent as BrowserWindow, visibility }
}

function fakeWindow(parent?: BrowserWindow): { window: ChildFixture; calls: ChildCalls } {
  const calls: ChildCalls = { show: vi.fn(), focus: vi.fn(), setBounds: vi.fn(), setMenu: vi.fn(), setWindowOpenHandler: vi.fn() }
  let destroyed = false
  const window: ChildFixture = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), { setWindowOpenHandler: calls.setWindowOpenHandler }),
    show: calls.show, focus: calls.focus, setBounds: calls.setBounds, setMenu: calls.setMenu,
    isDestroyed: (): boolean => destroyed,
    destroy: (): void => { destroyed = true; window.emit('closed') },
    getParentWindow: (): BrowserWindow | null => parent ?? null,
  })
  return { window, calls }
}

function visibilityFixture(visible = true) {
  const { parent, visibility } = fakeParent(visible)
  const { window, calls } = fakeWindow(parent)
  native.create.mockReturnValue(window)
  new DesktopUpdateOverlays().create(parent, 'owned', 'Update required', false)
  return { parent, window, calls, visibility }
}

it('restores a ready overlay each time its parent is shown and releases visibility ownership on close', async () => {
  const { parent, window, calls, visibility } = visibilityFixture()
  window.emit('ready-to-show')
  expect(calls.show).toHaveBeenCalledOnce()
  for (let index = 0; index < 2; index++) {
    visibility.visible = false
    parent.emit('hide')
    visibility.visible = true
    parent.emit('show')
    await Promise.resolve()
  }
  expect(calls.show).toHaveBeenCalledTimes(3)
  window.destroy()
  expect(parent.listenerCount('show')).toBe(0)
  parent.emit('show')
  expect(calls.show).toHaveBeenCalledTimes(3)
})

it('waits for both a visible parent and a ready document, in either order', async () => {
  for (const readyFirst of [true, false]) {
    const { parent, window, calls, visibility } = visibilityFixture(false)
    if (readyFirst) window.emit('ready-to-show')
    else { visibility.visible = true; parent.emit('show') }
    expect(calls.show).not.toHaveBeenCalled()
    if (readyFirst) { visibility.visible = true; parent.emit('show') }
    else window.emit('ready-to-show')
    await Promise.resolve()
    expect(calls.show).toHaveBeenCalledOnce()
    window.destroy()
  }
})

it('does not show or change parent styles when closed before its document is ready', async () => {
  const { parent, window, calls, visibility } = visibilityFixture(false)
  window.destroy()
  window.emit('ready-to-show')
  visibility.visible = true
  parent.emit('show')
  await Promise.resolve()
  expect(calls.show).not.toHaveBeenCalled()
  expect(parent.listenerCount('show')).toBe(0)
})

it('releases a macOS overlay after its parent has already been destroyed', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  const { parent, window } = visibilityFixture()
  await Promise.resolve()
  vi.spyOn(parent, 'isDestroyed').mockReturnValue(true)
  Object.defineProperty(parent, 'webContents', { get() { throw new Error('Object has been destroyed') } })
  expect(() => { window.destroy() }).not.toThrow()
  for (const event of ['focus', 'move', 'resize', 'show']) expect(parent.listenerCount(event)).toBe(0)
})

it('blocks each parent until its last owned overlay closes and invalidates each transition', () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  const firstParent = fakeParent().parent
  const secondParent = fakeParent().parent
  const overlays = new DesktopUpdateOverlays()
  const isolated = new DesktopUpdateOverlays()
  native.create.mockImplementation(() => {
    const { window } = fakeWindow()
    onTestFinished(() => { window.destroy() })
    return window
  })
  expect(overlays.input(firstParent)).toEqual({ revision: 0, blocked: false })
  const first = overlays.create(firstParent, 'owned', 'Update required', false)
  const second = overlays.create(firstParent, 'owned', 'Confirm installation', false)
  const other = overlays.create(secondParent, 'owned', 'Update required', false)
  expect(overlays.input(firstParent)).toMatchObject({ revision: 2, blocked: true })
  expect(overlays.input(secondParent)).toMatchObject({ revision: 1, blocked: true })
  expect(isolated.input(firstParent)).toEqual({ revision: 0, blocked: false })
  first.emit('closed')
  expect(overlays.input(firstParent)).toMatchObject({ revision: 3, blocked: true })
  expect(firstParent.webContents.listenerCount('before-input-event')).toBe(1)
  second.emit('closed')
  expect(overlays.input(firstParent)).toMatchObject({ revision: 4, blocked: false })
  expect(firstParent.listenerCount('move')).toBe(0)
  expect(firstParent.listenerCount('resize')).toBe(0)
  expect(firstParent.listenerCount('focus')).toBe(0)
  expect(firstParent.webContents.listenerCount('before-input-event')).toBe(0)
  expect(overlays.input(secondParent)).toMatchObject({ revision: 1, blocked: true })
  other.emit('closed')
  expect(overlays.input(secondParent)).toMatchObject({ revision: 2, blocked: false })
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

it('gives the Windows mandatory modal native move, resize, and maximize controls', () => {
  const { window, calls } = fakeWindow()
  native.create.mockReturnValue(window)
  const { parent } = fakeParent()
  expect(new DesktopUpdateOverlays().createMandatory(parent, 'owned', 'Update required', 'win32')).toBe(window)
  expect(native.create).toHaveBeenCalledWith(expect.objectContaining({
    parent, modal: true, show: false, title: 'Update required',
    movable: true, resizable: true, maximizable: true,
    minWidth: 480, minHeight: 360,
  }))
  const options = native.create.mock.calls[0]![0]
  expect(options.webPreferences).toMatchObject({ preload: 'owned', sandbox: true, nodeIntegration: false })
  expect(options).not.toHaveProperty('frame', false)
  window.emit('ready-to-show')
  expect(calls.show).toHaveBeenCalledOnce()
  expect(calls.setWindowOpenHandler).toHaveBeenCalledOnce()
})

it('gives the Linux mandatory modal the same framed controls', () => {
  const { window } = fakeWindow()
  native.create.mockReturnValue(window)
  const { parent } = fakeParent()
  expect(new DesktopUpdateOverlays().createMandatory(parent, 'owned', 'Update required', 'linux')).toBe(window)
  const options = native.create.mock.calls[0]![0]
  expect(options).toMatchObject({ modal: true, movable: true, resizable: true, minWidth: 480, minHeight: 360 })
  expect(options).not.toHaveProperty('transparent')
})

it('centers an opaque card on Linux instead of a transparent sheet', () => {
  const { window } = fakeWindow()
  native.create.mockReturnValue(window)
  const { parent } = fakeParent()
  expect(new DesktopUpdateOverlays().createPrompt(parent, 'owned', 'Check for updates', 'linux')).toBe(window)
  const options = native.create.mock.calls[0]![0]
  expect(options).toMatchObject({
    parent, modal: true, frame: false, backgroundColor: '#ffffff', resizable: false,
    x: 100 + (900 - 420) / 2, y: 200 + (650 - 320) / 2, width: 420, height: 320,
  })
  // A transparent window without a compositor paints its alpha as an opaque backing.
  expect(options).not.toHaveProperty('transparent')
})

it('prepaints the opaque surfaces in the theme the document will paint itself', () => {
  const { parent } = fakeParent()
  const overlays = new DesktopUpdateOverlays()
  native.create.mockReturnValue(fakeWindow().window)
  overlays.createPrompt(parent, 'owned', 'Check for updates', 'linux')
  native.create.mockReturnValue(fakeWindow().window)
  overlays.createMandatory(parent, 'owned', 'Update required', 'win32')
  // 文档加载后会用 --shell-surface 覆盖这个底色，取值不一致就会闪一下白。
  expect(native.create.mock.calls[0]![0]).toMatchObject({ backgroundColor: '#ffffff' })
  expect(native.create.mock.calls[1]![0]).toMatchObject({ backgroundColor: '#ffffff' })
  native.create.mockClear()
  native.theme.shouldUseDarkColors = true
  native.create.mockReturnValue(fakeWindow().window)
  overlays.createPrompt(parent, 'owned', 'Check for updates', 'linux')
  expect(native.create.mock.calls[0]![0]).toMatchObject({ backgroundColor: '#232324' })
})

it('fits the card to its measured content and keeps it centered', () => {
  const { parent } = fakeParent()
  const { window, calls } = fakeWindow(parent)
  fitDialogCard(window as BrowserWindow, 214, 'linux')
  // 固定 320 高会在短文案下留出一片裸白底，因此按文档量出的高度重新定尺寸。
  expect(calls.setBounds).toHaveBeenCalledWith({
    x: 100 + (900 - 420) / 2, y: 200 + (650 - 214) / 2, width: 420, height: 214,
  })
  // A report below the controls' own height would collapse the card past its buttons.
  calls.setBounds.mockClear()
  fitDialogCard(window as BrowserWindow, 12, 'linux')
  expect(calls.setBounds).toHaveBeenCalledWith(expect.objectContaining({ height: 120 }))
  // Content taller than the parent cannot grow past it.
  calls.setBounds.mockClear()
  fitDialogCard(window as BrowserWindow, 5_000, 'linux')
  expect(calls.setBounds).toHaveBeenCalledWith(expect.objectContaining({ height: 650, y: 200 }))
  // The sheet already spans its parent, so a measurement there must not resize it.
  calls.setBounds.mockClear()
  fitDialogCard(window as BrowserWindow, 214, 'darwin')
  expect(calls.setBounds).not.toHaveBeenCalled()
})

it('covers the parent with a transparent sheet where compositing is available', () => {
  const { window } = fakeWindow()
  native.create.mockReturnValue(window)
  const { parent } = fakeParent()
  new DesktopUpdateOverlays().createPrompt(parent, 'owned', 'Check for updates', 'darwin')
  const options = native.create.mock.calls[0]![0]
  // 非原生 sheet 靠自身拦截输入，因此不设 modal。
  expect(options).toMatchObject({ parent, modal: false, frame: false, transparent: true, x: 100, y: 200, width: 900, height: 650 })
})

it('keeps the macOS overlay stationary and blocks parent keyboard input until close', () => {
  const { window, calls } = fakeWindow()
  native.create.mockReturnValue(window)
  const { parent } = fakeParent()
  // A non-native sheet does not block its parent, so the sheet owns the block itself.
  new DesktopUpdateOverlays().createPrompt(parent, 'owned', 'Update required', 'darwin')
  expect(native.create).toHaveBeenLastCalledWith(expect.objectContaining({ modal: false, transparent: true, frame: false }))
  const event = { preventDefault: vi.fn() }
  parent.webContents.emit('before-input-event', event)
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(calls.focus).toHaveBeenCalledOnce()
  window.emit('closed')
  expect(parent.listenerCount('focus')).toBe(0)
  expect(parent.webContents.listenerCount('before-input-event')).toBe(0)
})
