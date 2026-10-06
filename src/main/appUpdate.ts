import type { IpcMain, IpcMainEvent } from 'electron'
import type { DiagnosticLog } from './diagnosticLog'
import { APP_UPDATE_ACTION_CHANNEL, APP_UPDATE_STATE_CHANNEL, isAppUpdateAction,
  validateUpdateVersion, type AppUpdateState } from '../shared/ipc/appUpdate'

export interface AppUpdaterPort {
  logger: unknown
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  disableWebInstaller: boolean
  on(event: 'update-available' | 'update-downloaded' | 'error', listener: (info: unknown) => void): unknown
  removeListener(event: 'update-available' | 'update-downloaded' | 'error', listener: (info: unknown) => void): unknown
  checkForUpdates(): Promise<{ downloadPromise?: Promise<unknown> | null; cancellationToken?: { cancel(): void } } | null>
  quitAndInstall(silent: boolean, relaunch: boolean): void
}
export function selectAppUpdateEligibility(opts: { isPackaged: boolean; platform: string }): boolean {
  if (!opts.isPackaged) return false
  return opts.platform === 'win32'
}
export function createAppUpdateController(deps: {
  isPackaged: boolean; platform: string; construct: () => AppUpdaterPort
  beforeInstall: () => Promise<void>; log: Pick<DiagnosticLog, 'event'>
}) {
  let state: AppUpdateState = { type: 'idle' }
  let phase: 'checking' | 'downloading' | 'ready' | 'failed' = 'checking'
  let started = false, dismissed = false, verified = false, installing = false, disposed = false
  let updater: AppUpdaterPort | undefined
  let token: { cancel(): void } | undefined
  const subscribers = new Set<(state: AppUpdateState) => void>()
  const publish = (next: AppUpdateState): void => {
    if (disposed) return
    state = dismissed ? { type: 'idle' } : next
    for (const listener of subscribers) listener(state)
  }
  const failure = (): void => {
    if (disposed || phase === 'failed' || (phase === 'ready' && !installing)) return
    deps.log.event({ event: 'app-update-failed', code: installing ? 'install-failed' : phase === 'downloading' ? 'download-failed' : 'check-failed' })
    if (phase === 'downloading' || installing) { verified = false; phase = 'failed'; publish({ type: 'failed' }) }
  }
  const available = (): void => {
    if (disposed || phase !== 'checking') return
    phase = 'downloading'; deps.log.event({ event: 'app-update-downloading' })
  }
  const downloaded = (info: unknown): void => {
    if (disposed || phase !== 'downloading') return
    verified = true; phase = 'ready'
    const version = validateUpdateVersion(typeof info === 'object' && info !== null && 'version' in info ? info.version : null)
    deps.log.event({ event: 'app-update-ready' }); publish({ type: 'ready', version })
  }
  return {
    snapshot: (): AppUpdateState => state,
    subscribe(listener: (state: AppUpdateState) => void): () => void {
      subscribers.add(listener); listener(state)
      return () => { subscribers.delete(listener) }
    },
    async start(): Promise<void> {
      if (started || disposed) return
      started = true
      if (!selectAppUpdateEligibility(deps)) return
      try {
        updater = deps.construct()
        updater.logger = null; updater.autoDownload = true; updater.autoInstallOnAppQuit = true; updater.disableWebInstaller = true
        updater.on('update-available', available); updater.on('update-downloaded', downloaded); updater.on('error', failure)
        deps.log.event({ event: 'app-update-checking' })
        const result = await updater.checkForUpdates()
        token = result?.cancellationToken
        if (disposed) token?.cancel()
        // The automatic download's promise rejects separately from checkForUpdates.
        await result?.downloadPromise?.catch(failure)
      } catch {
        if (updater === undefined) deps.log.event({ event: 'app-update-failed', code: 'startup-failed' })
        else failure()
      }
    },
    async command(value: unknown): Promise<void> {
      if (disposed || !isAppUpdateAction(value)) {
        deps.log.event({ event: 'app-update-refused', code: 'malformed-command' }); return
      }
      if (value.type === 'dismiss') {
        dismissed = true; deps.log.event({ event: 'app-update-dismissed' }); publish({ type: 'idle' }); return
      }
      if (!verified || installing || updater === undefined) {
        deps.log.event({ event: 'app-update-refused', code: 'not-installable' }); return
      }
      installing = true
      try {
        await deps.beforeInstall()
        if (disposed) return
        deps.log.event({ event: 'app-update-installing' }); updater.quitAndInstall(true, true)
      } catch {
        verified = false; phase = 'failed'
        deps.log.event({ event: 'app-update-failed', code: 'install-failed' }); publish({ type: 'failed' })
      }
    },
    dispose(): void {
      disposed = true; token?.cancel(); subscribers.clear()
      updater?.removeListener('update-available', available); updater?.removeListener('update-downloaded', downloaded)
      // Keep a content-free error sink until process exit: pending library work may emit error.
      updater?.removeListener('error', failure); updater?.on('error', () => {})
    }
  }
}
export function registerAppUpdate(
  target: Pick<IpcMain, 'handle' | 'removeHandler' | 'on' | 'removeListener'>,
  controller: ReturnType<typeof createAppUpdateController>, trusted: (event: Pick<IpcMainEvent, 'sender' | 'senderFrame'>) => boolean,
  emit: (state: AppUpdateState) => void
): () => void {
  target.handle(APP_UPDATE_STATE_CHANNEL, event => trusted(event) ? controller.snapshot() : { type: 'idle' })
  const listener = (event: IpcMainEvent, value: unknown): void => {
    if (trusted(event)) void controller.command(value) // command contains all failures; no IPC result data.
  }
  target.on(APP_UPDATE_ACTION_CHANNEL, listener)
  const stop = controller.subscribe(emit)
  return () => { stop(); target.removeHandler(APP_UPDATE_STATE_CHANNEL); target.removeListener(APP_UPDATE_ACTION_CHANNEL, listener) }
}

/** Shares one history drain between ordinary quit and updater installation. */
export function createQuitDrain(stop: () => void, flush: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | undefined
  return () => {
    if (pending === undefined) { stop(); pending = flush() }
    return pending
  }
}
