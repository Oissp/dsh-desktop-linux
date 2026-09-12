import { describe, expect, it, vi } from 'vitest'
import type { AppUpdater } from 'electron-updater'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import { parseDesktopRelease } from '../src/release.ts'
import type { DesktopUpdateState } from '../src/ipc.ts'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('electron-updater', () => ({
  default: { autoUpdater: { autoDownload: true, autoInstallOnAppQuit: true } },
}))

const { DesktopUpdateCoordinator } = await import('../src/update-coordinator.ts')

describe('desktop release metadata', () => {
  it('accepts one exact release identity for Electron and dsh', () => {
    expect(parseDesktopRelease({
      schemaVersion: 1,
      version: '1.2.3',
      hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
      nodeVersion: '24.17.0',
      pnpmVersion: '11.7.0',
    })).toEqual({
      schemaVersion: 1,
      version: '1.2.3',
      hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
      nodeVersion: '24.17.0',
      pnpmVersion: '11.7.0',
    })
  })

  it('rejects invalid versions and unsupported host protocols', () => {
    const base = {
      schemaVersion: 1,
      version: '1.2.3',
      hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
      nodeVersion: '24.17.0',
      pnpmVersion: '11.7.0',
    }
    expect(() => parseDesktopRelease({ ...base, version: 'latest' })).toThrow(/invalid desktop release metadata/u)
    expect(() => parseDesktopRelease({ ...base, hostProtocolVersion: 999 })).toThrow(/invalid desktop release metadata/u)
  })
})

describe('desktop update coordinator', () => {
  it('installs one Electron release and restarts after download', async () => {
    const states: DesktopUpdateState[] = []
    const downloadUpdate = vi.fn(async () => [])
    const quitAndInstall = vi.fn()
    const beforeRestart = vi.fn(async () => undefined)
    const updater = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      on: vi.fn(),
      removeListener: vi.fn(),
      checkForUpdates: vi.fn(async () => ({
        isUpdateAvailable: true,
        updateInfo: { version: '1.1.0' },
      })),
      downloadUpdate,
      quitAndInstall,
    } as unknown as AppUpdater
    const coordinator = new DesktopUpdateCoordinator(
      (state) => {
        states.push(state)
        return state
      },
      beforeRestart,
      updater,
      () => true,
    )

    await expect(coordinator.check()).resolves.toEqual({ phase: 'available', version: '1.1.0' })
    await expect(coordinator.install()).resolves.toEqual({ phase: 'ready', version: '1.1.0' })
    expect(downloadUpdate).toHaveBeenCalledOnce()
    expect(beforeRestart).toHaveBeenCalledOnce()
    expect(quitAndInstall).toHaveBeenCalledWith(false, true)
    expect(states.map(state => state.phase)).toEqual(['checking', 'available', 'installing', 'ready'])
  })

  it('surfaces a failed install and undoes the prepared restart', async () => {
    const states: DesktopUpdateState[] = []
    let errorHandler: ((error: Error) => void) | undefined
    const undoRestart = vi.fn(async () => {})
    const updater = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      on: vi.fn((event: string, listener: (error: Error) => void) => {
        if (event === 'error') errorHandler = listener
      }),
      removeListener: vi.fn((event: string) => {
        if (event === 'error') errorHandler = undefined
      }),
      checkForUpdates: vi.fn(async () => ({
        isUpdateAvailable: true,
        updateInfo: { version: '1.1.0' },
      })),
      downloadUpdate: vi.fn(async () => []),
      quitAndInstall: vi.fn(() => { errorHandler?.(new Error('pkexec: no authentication agent found')) }),
    } as unknown as AppUpdater
    const coordinator = new DesktopUpdateCoordinator(
      (state) => {
        states.push(state)
        return state
      },
      async () => undoRestart,
      updater,
      () => true,
    )

    await expect(coordinator.check()).resolves.toEqual({ phase: 'available', version: '1.1.0' })
    await expect(coordinator.install()).resolves.toEqual({
      phase: 'error',
      version: '1.1.0',
      message: 'pkexec: no authentication agent found',
    })
    expect(undoRestart).toHaveBeenCalledOnce()
    expect(states.map(state => state.phase)).toEqual(['checking', 'available', 'installing', 'error'])
  })

  it('publishes an error and skips install when the before-restart stop fails', async () => {
    const states: DesktopUpdateState[] = []
    const quitAndInstall = vi.fn()
    const updater = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      on: vi.fn(),
      removeListener: vi.fn(),
      checkForUpdates: vi.fn(async () => ({
        isUpdateAvailable: true,
        updateInfo: { version: '1.1.0' },
      })),
      downloadUpdate: vi.fn(async () => []),
      quitAndInstall,
    } as unknown as AppUpdater
    const coordinator = new DesktopUpdateCoordinator(
      (state) => {
        states.push(state)
        return state
      },
      async () => { throw new Error('backend stop failed') },
      updater,
      () => true,
    )

    await expect(coordinator.check()).resolves.toEqual({ phase: 'available', version: '1.1.0' })
    await expect(coordinator.install()).resolves.toEqual({
      phase: 'error',
      version: '1.1.0',
      message: 'backend stop failed',
    })
    expect(quitAndInstall).not.toHaveBeenCalled()
    expect(states.map(state => state.phase)).toEqual(['checking', 'available', 'installing', 'error'])
  })

  it('queues install behind an in-flight check instead of returning the check result', async () => {
    const checked = Promise.withResolvers<{
      isUpdateAvailable: true
      updateInfo: { version: string }
    }>()
    const downloadUpdate = vi.fn(async () => [])
    const updater = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      on: vi.fn(),
      removeListener: vi.fn(),
      checkForUpdates: vi.fn(() => checked.promise),
      downloadUpdate,
      quitAndInstall: vi.fn(),
    } as unknown as AppUpdater
    const coordinator = new DesktopUpdateCoordinator(state => state, async () => {}, updater, () => true)

    const checking = coordinator.check()
    const installing = coordinator.install()
    expect(downloadUpdate).not.toHaveBeenCalled()
    checked.resolve({ isUpdateAvailable: true, updateInfo: { version: '1.2.0' } })

    await expect(checking).resolves.toEqual({ phase: 'available', version: '1.2.0' })
    await expect(installing).resolves.toEqual({ phase: 'ready', version: '1.2.0' })
    expect(downloadUpdate).toHaveBeenCalledOnce()
  })
})
