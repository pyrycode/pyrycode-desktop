import { ipcMain, type BrowserWindow, type Rectangle } from 'electron'
import { HOSTED_PANE_CHANNEL, isHostedPaneCommand, type HostedPaneState } from '../shared/ipc/hostedPane'
import type { createHostedAppViews } from './hostedAppView'
import type { ConnectionRegistry } from './connectionRegistry'
import type { DiagnosticLog } from './diagnosticLog'

/** Only windows explicitly attached at the composition root have this capability. */
export function registerHostedPane(views: ReturnType<typeof createHostedAppViews>, registry: ConnectionRegistry,
  labelFor: (serverId: string) => Promise<string | null>, log: DiagnosticLog) {
  const owners = new Map<Electron.WebContents, ReturnType<typeof attach>>()
  function attach(parent: BrowserWindow) {
    const client = parent.webContents
    let state: HostedPaneState = { type: 'closed', generation: 0 }, serial = 0
    let identity = 0
    let view: Extract<ReturnType<typeof views.open>, { ok: true }>['view'] | undefined
    let apps: ReturnType<ConnectionRegistry['connectionFor']> = null
    let offDiscovery = (): void => {}, offView = (): void => {}
    let bounds: Rectangle | undefined, visible = false, automatic = true, release: string | null = null
    const publish = (): void => { if (!parent.isDestroyed()) parent.webContents.send(HOSTED_PANE_CHANNEL, state) }
    const status = (type: Exclude<HostedPaneState['type'], 'closed'>): void => {
      if (state.type !== 'closed') { state = { ...state, type }; publish() }
    }
    function retire(): void { const old = view; view = undefined; offView(); offView = () => {}; old?.close() }
    function close(): void {
      offDiscovery(); offDiscovery = () => {}; retire(); apps = null; bounds = undefined; identity++
      state = { type: 'closed', generation: ++serial }; publish()
      log.event({ event: 'hosted-pane', code: 'closed' })
    }
    function sync(): void {
      if (state.type === 'closed') return
      const selectedApp = state.appId
      const discovery = apps?.hostedApps.read()
      const record = discovery?.type === 'ready' ? discovery.items.find(r => r.app_id === selectedApp) : undefined
      if (record) state = { ...state, appLabel: record.title.slice(0, 128) }
      const running = record?.state === 'running' && record.active_release !== null
      if (view && (!running || record?.active_release !== release)) {
        const replacement = running && discovery?.type === 'ready'
        retire(); automatic = Boolean(replacement)
        if (replacement) { state = { ...state, generation: ++serial }; status('loading') }
        else status(discovery?.type === 'unavailable' ? 'disconnected' : discovery?.type === 'unsupported' ? 'unsupported' : 'unavailable')
      }
      if (!view && automatic && discovery?.type === 'ready' && running && bounds) {
        const result = views.open(parent, state.serverId, state.appId, bounds)
        if (result.ok) {
          view = result.view; release = record?.active_release ?? null
          const current = view
          current.content.setVisible(visible)
          offView = current.subscribe(() => {
            if (view !== current || state.type === 'closed') return
            const next = current.read().type
            if (next === 'loading' || next === 'ready') status(next)
            else { retire(); automatic = false; status(next === 'closed' ? 'unavailable' : next) }
          })
          status(current.read().type === 'ready' ? 'ready' : 'loading')
          return
        }
        status(result.state.type === 'closed' ? 'unavailable' : result.state.type)
      } else if (view) { publish(); return }
      if (discovery?.type === 'unavailable' || !apps) status('disconnected')
      else if (discovery?.type === 'unsupported') status('unsupported')
      else if (automatic && discovery?.type === 'loading') status('loading')
      else if (automatic && running && !bounds) status('loading')
      else if (automatic || state.type === 'ready') status('unavailable')
      else publish()
    }
    const owner = { read: () => state, close,
      command(command: import('../shared/ipc/hostedPane').HostedPaneCommand) {
        if (command.type === 'snapshot') return true
        if (command.type === 'select') {
          const connection = registry.connectionFor(command.serverId)
          if (!connection) return false
          close(); apps = connection; automatic = true; visible = false; release = null
          state = { type: 'loading', generation: ++serial, serverId: command.serverId, appId: command.appId,
            hostLabel: 'Server', appLabel: 'App' }
          const selected = identity
          void labelFor(command.serverId).then(label => {
            if (identity === selected && state.type !== 'closed' && label?.trim()) {
              state = { ...state, hostLabel: label.slice(0, 128) }; publish()
            }
          }).catch(() => log.event({ event: 'hosted-pane', code: 'label-failed' }))
          offDiscovery = connection.hostedApps.subscribe(sync); sync(); return true
        }
        if (state.type === 'closed' || command.generation !== state.generation) return false
        if (command.type === 'close') { close(); return true }
        if (command.type === 'reopen') {
          const discovery = apps?.hostedApps.read()
          if (!discovery || discovery.type === 'unavailable' || discovery.type === 'unsupported') return true
          retire(); state = { ...state, generation: ++serial }; automatic = true
          apps?.hostedApps.refresh(); sync(); return true
        }
        const size = parent.getContentBounds(), b = command.bounds
        if (b.x + b.width > size.width || b.y + b.height > size.height) return false
        bounds = b; visible = command.visible && b.width > 0 && b.height > 0
        view?.resize(b); view?.content.setVisible(visible); if (!view) sync()
        return true
      } }
    owners.set(parent.webContents, owner)
    parent.webContents.on('did-start-loading', close)
    parent.once('closed', () => { close(); owners.delete(client) })
    return owner
  }
  ipcMain.handle(HOSTED_PANE_CHANNEL, (event, command: unknown) => {
    const owner = owners.get(event.sender)
    if (!owner || event.senderFrame !== event.sender.mainFrame || !isHostedPaneCommand(command) || !owner.command(command)) {
      log.event({ event: 'hosted-pane', code: 'refused' })
      return { ok: false, error: 'refused' }
    }
    return { ok: true, state: owner.read() }
  })
  return { attach, dispose(): void { ipcMain.removeHandler(HOSTED_PANE_CHANNEL); for (const owner of owners.values()) owner.close(); owners.clear() } }
}
