import type { HostedAppRecord, HostedControlEnvelope } from '../../shared/wire/types'
import type { DiagnosticLog } from '../diagnosticLog'
import type { createHostedResources } from './hostedResources'
import { decodeHostedControl, encodeHostedControl } from './hostedCodec'

type Failure = 'timeout' | 'limit' | 'invalid' | 'bridge' | 'send-failed'
export type HostedAppsState =
  | { type: 'unavailable' | 'unsupported' | 'loading' }
  | { type: 'failed'; error: Failure }
  | { type: 'ready'; revision: number; items: HostedAppRecord[] }
type Update = Extract<HostedControlEnvelope, { type: 'app_updated' | 'app_removed' }>
type Slot = { id: number; release: () => void }

/** Native-only authority. No cached record or caller-supplied release grants a binding. */
export function createHostedApps(deps: {
  nextId: () => number; now: () => string; connected: () => boolean
  resources: ReturnType<typeof createHostedResources>; log?: DiagnosticLog
}) {
  let state: HostedAppsState = { type: 'unavailable' }, enabled = false
  let pending: Slot | undefined, expires = 0, idleExpires = 0
  let deadline: ReturnType<typeof setTimeout> | undefined, idle: ReturnType<typeof setTimeout> | undefined
  let restart: ReturnType<typeof setTimeout> | undefined
  let revision: number | undefined, items: HostedAppRecord[] = [], updates: Update[] = []
  const observers = new Set<() => void>()
  const bindings = new Map<object, { app: string; release: string; retire: () => void }>()
  const cancels = new Map<number, { target: number; release: () => void; timer: ReturnType<typeof setTimeout> }>()
  const log = (code: string): void => deps.log?.event({ event: 'hosted-discovery', code })
  function notify(): void {
    for (const listener of [...observers]) { try { listener() } catch { /* Observers cannot change dispatch. */ } }
  }
  function invalidate(): void {
    for (const binding of [...bindings.values()]) binding.retire()
  }
  function forgetCancel(id: number): void {
    const c = cancels.get(id)
    if (c) { clearTimeout(c.timer); c.release(); cancels.delete(id) }
  }
  function clearWalk(): void {
    clearTimeout(deadline); clearTimeout(idle); clearTimeout(restart)
    deadline = idle = restart = undefined
    items = []; updates = []; revision = undefined
  }
  function retirePending(cancel = true): boolean {
    const p = pending
    if (!p) return true
    pending = undefined; p.release(); clearTimeout(idle)
    if (!cancel || !enabled || !deps.connected()) return true
    const release = deps.resources.reserveControl()
    if (!release) return false
    const id = deps.nextId()
    cancels.set(id, { target: p.id, release, timer: setTimeout(() => forgetCancel(id), 5000) })
    try {
      if (!deps.resources.sendControl(encodeHostedControl({ id, ts: deps.now(), type: 'app_cancel', payload: { request_id: p.id } }, 'client-to-daemon'), outcome => {
        if (outcome.type === 'dropped') { forgetCancel(id); log('send-failed') }
      })) { forgetCancel(id); log('limit'); return false }
    } catch { forgetCancel(id); log('send-failed') }
    return true
  }
  function fail(error: Failure): void {
    state = { type: 'failed', error }; clearWalk(); retirePending(); invalidate(); log(error); notify()
  }
  function expired(): boolean {
    if (Date.now() >= expires || Date.now() >= idleExpires) { fail('timeout'); return true }
    return false
  }
  function request(cursor?: string): void {
    if (Date.now() >= expires || Date.now() >= idleExpires) { fail('timeout'); return }
    const release = deps.resources.reserveControl()
    if (!release) { fail('limit'); return }
    const p = { id: deps.nextId(), release }; pending = p
    clearTimeout(idle)
    idle = setTimeout(() => fail('timeout'), Math.max(0, idleExpires - Date.now()))
    try {
      if (!deps.resources.sendControl(encodeHostedControl({ id: p.id, ts: deps.now(), type: 'list_apps', payload: cursor === undefined ? {} : { cursor } }, 'client-to-daemon'), outcome => {
        if (pending === p && outcome.type === 'dropped') fail('send-failed')
      })) fail('limit')
    } catch { if (pending === p) fail('send-failed') }
  }
  function refresh(): void {
    if (!enabled || !deps.connected() || state.type === 'loading') return
    state = { type: 'loading' }; invalidate(); clearWalk()
    expires = Date.now() + 30000; idleExpires = Date.now() + 5000
    deadline = setTimeout(() => fail('timeout'), 30000)
    log('started'); request(); notify()
  }
  function restartWalk(): void {
    if (restart !== undefined) return
    if (state.type !== 'loading') { refresh(); return }
    if (!retirePending()) { fail('limit'); return }
    items = []; updates = []; revision = undefined
    log('restart')
    restart = setTimeout(() => { restart = undefined; request() }, 0)
  }
  function apply(records: HostedAppRecord[], at: number, changes: Update[]): { items: HostedAppRecord[]; revision: number } | undefined {
    const map = new Map(records.map(record => [record.app_id, record]))
    for (const update of changes) {
      if (update.payload.revision <= at) continue
      if (update.payload.revision !== at + 1) return undefined
      at++
      if (update.type === 'app_removed') map.delete(update.payload.app_id)
      else map.set(update.payload.app_id, update.payload)
      if (map.size > 256) return undefined
    }
    return { items: [...map.values()].sort((a, b) => a.app_id.localeCompare(b.app_id)), revision: at }
  }
  function receive(bytes: Uint8Array, hint: { type?: unknown; in_reply_to?: unknown }): boolean {
    const id = hint.in_reply_to, p = pending
    const cancel = typeof id === 'number' ? cancels.get(id) : undefined
    const owned = p !== undefined && id === p.id
    const notification = hint.type === 'app_updated' || hint.type === 'app_removed'
    if (!owned && !cancel && !notification && hint.type !== 'apps') return false
    if (!enabled || !deps.connected()) return true
    if (!owned && !cancel && !notification) return true
    let reply: HostedControlEnvelope
    try { reply = decodeHostedControl(bytes, 'daemon-to-client') }
    catch { if (owned || notification) fail('invalid'); else if (typeof id === 'number') { forgetCancel(id); log('invalid') }; return true }
    if (cancel && typeof id === 'number') {
      if (reply.type !== 'app_cancelled' || reply.payload.request_id !== cancel.target || reply.payload.app_id !== undefined) log('invalid')
      forgetCancel(id); return true
    }
    if (notification && (reply.type === 'app_updated' || reply.type === 'app_removed')) {
      if (state.type === 'loading') {
        if (expired()) return true
        if (revision !== undefined && reply.payload.revision <= revision) return true
        if (updates.length === 256) restartWalk()
        else updates.push(reply)
      } else if (state.type === 'ready') {
        const next = apply(state.items, state.revision, [reply])
        if (!next) { refresh(); return true }
        state = { type: 'ready', ...next }
        for (const b of [...bindings.values()]) {
          const record = next.items.find(item => item.app_id === b.app)
          if (record?.state !== 'running' || record.active_release !== b.release) b.retire()
        }
        notify()
      }
      return true
    }
    if (!owned || expired()) return true
    if (reply.type === 'error') {
      if (reply.payload.code === 'apps.changed') restartWalk()
      else fail('bridge')
      return true
    }
    if (reply.type !== 'apps') { fail('invalid'); return true }
    const page = reply.payload
    if ((revision !== undefined && revision !== page.revision) ||
      (items.length > 0 && page.items.length > 0 && items[items.length - 1].app_id >= page.items[0].app_id)) { restartWalk(); return true }
    if (items.length + page.items.length > 256 || (page.next_cursor !== null && page.items.length === 0)) { fail('limit'); return true }
    retirePending(false); revision = page.revision; items.push(...page.items); idleExpires = Date.now() + 5000
    if (page.next_cursor !== null) { request(page.next_cursor); return true }
    const next = apply(items, revision, updates)
    if (!next) { restartWalk(); return true }
    clearWalk(); state = { type: 'ready', ...next }; log('ready'); notify(); return true
  }
  function reset(supported?: boolean): void {
    enabled = false; state = { type: supported === undefined ? 'unavailable' : 'unsupported' }
    retirePending(false); clearWalk(); for (const id of cancels.keys()) forgetCancel(id)
    invalidate(); enabled = supported === true
    if (enabled) refresh(); else notify()
  }
  function openView(appId: string) {
    const record = state.type === 'ready' ? state.items.find(item => item.app_id === appId) : undefined
    if (record?.state !== 'running' || record.active_release === null || record.active_release === undefined)
      return { ok: false as const, error: 'unconfirmed' as const }
    const view = deps.resources.openView(appId, record.active_release)
    const retire = (): void => { bindings.delete(view); view.retire() }
    bindings.set(view, { app: appId, release: record.active_release, retire })
    return { ok: true as const, view: { request: view.request, retire } }
  }
  return { read: (): HostedAppsState => structuredClone(state), refresh, openView, receive, reset,
    subscribe(listener: () => void): () => void { observers.add(listener); return () => { observers.delete(listener) } },
    dispose(): void { reset(); observers.clear() } }
}
