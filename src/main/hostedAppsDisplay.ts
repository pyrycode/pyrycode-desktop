import { ipcMain, type BrowserWindow } from 'electron'
import { HOSTED_APPS_DISPLAY_CHANNEL, isHostedAppsDisplayCommand, type HostedAppsDisplayState } from '../shared/ipc/hostedAppsDisplay'
import type { ConnectionRegistry } from './connectionRegistry'
import type { DiagnosticLog } from './diagnosticLog'

export function registerHostedAppsDisplay(registry: ConnectionRegistry, log: DiagnosticLog) {
  const owners = new Map<Electron.WebContents, ReturnType<typeof attach>>()
  function attach(parent: BrowserWindow) {
    const client = parent.webContents
    const watches = new Map<string, { token: number; service: ReturnType<ConnectionRegistry['connectionFor']>; off: () => void; sync: () => void }>()
    const clear = (): void => { for (const watch of watches.values()) watch.off(); watches.clear() }
    function watch(serverId: string, token: number): void {
      watches.get(serverId)?.off()
      const held = { token, service: registry.connectionFor(serverId), off: (): void => {}, sync }
      function sync(): void {
        if (watches.get(serverId) !== held || parent.isDestroyed()) return
        const current = registry.connectionFor(serverId)
        if (current?.hostedApps !== held.service?.hostedApps) { watch(serverId, token); return }
        const value = current?.hostedApps.read()
        const state: HostedAppsDisplayState = value?.type === 'ready'
          ? { serverId, type: 'ready', items: value.items.map(item => ({ appId: item.app_id, title: item.title.slice(0, 128), state: item.state })) }
          : { serverId, type: value?.type ?? 'unavailable' }
        client.send(HOSTED_APPS_DISPLAY_CHANNEL, { token, state })
      }
      watches.set(serverId, held)
      held.off = held.service?.hostedApps.subscribe(sync) ?? (() => {})
      sync()
      log.event({ event: 'hosted-apps-display', code: 'watched' })
    }
    const owner = { clear, reconcile: (): void => { for (const held of [...watches.values()]) held.sync() },
      command(command: import('../shared/ipc/hostedAppsDisplay').HostedAppsDisplayCommand): boolean {
        if (command.type === 'unwatch') {
          const held = watches.get(command.serverId)
          if (held?.token === command.token) { held.off(); watches.delete(command.serverId); log.event({ event: 'hosted-apps-display', code: 'unwatched' }) }
          return true
        }
        const connection = registry.connectionFor(command.serverId)
        if (!connection) return false
        if (command.type === 'watch') watch(command.serverId, command.token)
        else connection.hostedApps.refresh()
        return true
      } }
    owners.set(client, owner)
    client.on('did-start-loading', clear)
    parent.once('closed', () => { clear(); owners.delete(client) })
    return owner
  }
  ipcMain.handle(HOSTED_APPS_DISPLAY_CHANNEL, (event, command: unknown) => {
    const owner = owners.get(event.sender)
    if (!owner || event.senderFrame !== event.sender.mainFrame || !isHostedAppsDisplayCommand(command) || !owner.command(command)) {
      log.event({ event: 'hosted-apps-display', code: 'refused' }); return { ok: false, error: 'refused' }
    }
    return { ok: true }
  })
  return { attach, reconcile(): void { for (const owner of owners.values()) owner.reconcile() },
    dispose(): void { ipcMain.removeHandler(HOSTED_APPS_DISPLAY_CHANNEL); for (const owner of owners.values()) owner.clear(); owners.clear() } }
}
