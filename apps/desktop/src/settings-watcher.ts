/**
 * Watch one user-settings document for edits and call back debounced. Content-
 * agnostic: the callback re-reads whatever sections its owner cares about.
 * The parent directory is watched (not the file) so creates, replaces, and
 * deletes all fire; a missing parent re-arms the watcher on a short retry.
 * @module
 */

import { watch, type FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'

/** One settings-document change subscription. */
export class DesktopSettingsWatcher {
  private watcher: FSWatcher | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private retry: ReturnType<typeof setTimeout> | undefined
  private closed = false

  /**
   * @param settingsPath - the settings document to watch.
   * @param onChange - invoked after each edit, debounced around the engine's
   *   write settle window.
   */
  constructor(
    private readonly settingsPath: string,
    private readonly onChange: () => void,
  ) {}

  /** Arm the watcher, retrying until the parent directory exists. */
  start(): void {
    this.startWatcher()
  }

  /** Stop watching; pending debounces and retries are cancelled. */
  dispose(): void {
    this.closed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    if (this.retry !== undefined) clearTimeout(this.retry)
    this.watcher?.close()
    this.watcher = undefined
  }

  private startWatcher(): void {
    this.watcher?.close()
    this.watcher = undefined
    try {
      const watcher = watch(dirname(this.settingsPath), (_event, filename) => {
        if (typeof filename === 'string' && filename !== basename(this.settingsPath)) return
        this.scheduleRefresh()
      })
      watcher.unref()
      watcher.on('error', () => { watcher.close(); this.scheduleRetry() })
      this.watcher = watcher
    } catch {
      this.scheduleRetry()
    }
  }

  private scheduleRetry(): void {
    if (this.closed || this.retry !== undefined) return
    this.retry = setTimeout(() => {
      this.retry = undefined
      this.startWatcher()
    }, 2_000)
    this.retry.unref()
  }

  /** Debounce edits around the engine's write settle window. */
  private scheduleRefresh(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.closed) return
      this.onChange()
    }, 150)
    this.timer.unref()
  }
}
