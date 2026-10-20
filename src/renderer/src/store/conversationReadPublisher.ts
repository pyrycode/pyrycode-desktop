import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { RendererCommand } from '@shared/ipc/commands'
import type { RendererDiagnosticEvent } from '@shared/ipc/diagnostics'
import { conversationListStore } from './conversationListStore'
import { sessionStore } from './sessionStore'
import type { ThreadSnapshot } from './threadItemStore'
import { conversationReadRouteStore } from './conversationReadRouteStore'

const useReadLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect
const sendReadDiagnostic = (event: RendererDiagnosticEvent): void => {
  if (typeof window !== 'undefined') window.pyry?.sendDiagnostic?.(event)
}

type ReadRow = { id: string; serverId?: string | null; read_up_to?: number; latest_entry_id?: number; last_shown_version?: number }
type ReadCommand = Extract<RendererCommand, { type: 'markConversationRead' }>
export type ThreadReadInputs = { snapshot: ThreadSnapshot; row: ReadRow; readerOpen?: boolean;
  /** Completed newest-window/catch-up progress represented by this immutable snapshot, never a page. */
  completeThrough: number;
  compact?: { snapshot: ThreadSnapshot; through: number; roots: ReadonlySet<number>; routeEpoch: string; current: () => boolean };
  publisher?: ReturnType<typeof createReadPublisher> }

export function createReadPublisher(deps: {
  rows: () => readonly ReadRow[]; connected: (host: string) => boolean; send: (command: ReadCommand) => void
  epoch: (host: string, id: string) => string | undefined
}) {
  const pending = new Map<string, Map<string, { target: number; epoch: string; attempted?: number; generation?: number }>>()
  const links = new Map<string, { connected: boolean; generation: number }>()
  const owner = (host: string, id: string, epoch: string) => {
    if (deps.epoch(host, id) !== epoch) return undefined
    const matches = deps.rows().filter(r => r.id === id && r.serverId === host)
    return matches.length === 1 && matches[0].serverId === host ? matches[0] : undefined
  }
  const eligible = (row: ReadRow | undefined) => row?.read_up_to !== undefined && row.last_shown_version !== undefined
  const sync = () => {
    for (const host of new Set([...deps.rows().flatMap(r => typeof r.serverId === 'string' ? [r.serverId] : []), ...links.keys()])) {
      const connected = deps.connected(host)
      const prior = links.get(host)
      links.set(host, { connected, generation: (prior?.generation ?? 0) + (connected && !prior?.connected ? 1 : 0) })
    }
    for (const [host, conversations] of pending) for (const [id, mark] of conversations) {
      const row = owner(host, id, mark.epoch)
      if (!eligible(row) || row?.read_up_to === undefined || row.read_up_to >= mark.target) {
        conversations.delete(id); continue
      }
      const link = links.get(host)
      if (!link?.connected || mark.attempted === mark.target && mark.generation === link.generation) continue
      mark.attempted = mark.target; mark.generation = link.generation
      try { deps.send({ type: 'markConversationRead', serverId: host, payload: { conversation_id: id, up_to: mark.target } }) }
      catch { /* The attempt remains unconfirmed; only a newer observation or reconnect permits send. */ }
    }
    for (const [host, records] of pending) if (records.size === 0) pending.delete(host)
    for (const host of links.keys()) if (!deps.rows().some(r => r.serverId === host)) links.delete(host)
  }
  return {
    sync,
    observe(host: string, id: string, target: number, epoch: string) {
      if (!Number.isSafeInteger(target) || target < 0) return
      const row = owner(host, id, epoch)
      if (!eligible(row) || row?.read_up_to === undefined || row.read_up_to >= target) return
      const records = pending.get(host) ?? new Map()
      const held = records.get(id)
      if (held === undefined || held.epoch !== epoch) records.set(id, { target, epoch })
      else held.target = Math.max(held.target, target)
      pending.set(host, records); sync()
    },
    forget(host: string, id: string) { pending.get(host)?.delete(id) }
  }
}

function newestShown(snapshot: ThreadSnapshot) {
  return snapshot.items.filter(i => i.shown === true && i.status !== 'queued' &&
    typeof i.order === 'number' && i.order > 0).at(-1)
}

export function readTargetFor(thread: ThreadReadInputs, log = sendReadDiagnostic): number | undefined {
  const { snapshot: s, row } = thread, target = row.last_shown_version, tail = newestShown(s), order = tail?.order
  const reject = (code: 'scope-unavailable' | 'scope-mismatch' | 'read-metadata-unavailable' | 'target-invalid' |
    'checkpoint-insufficient' | 'completion-insufficient' | 'repair-pending' | 'tail-unavailable' |
    'coverage-insufficient' | 'shown-tail-pending' | 'compact-snapshot-mismatch' | 'compact-stale' |
    'compact-completion-insufficient' | 'compact-tail-uncovered'): undefined => { log({ event: 'read-target', code }); return undefined }
  if (row.serverId === undefined || row.serverId === null) return reject('scope-unavailable')
  if (s.hostId !== row.serverId || s.conversationId !== row.id) return reject('scope-mismatch')
  if (row.read_up_to === undefined || target === undefined) return reject('read-metadata-unavailable')
  if (!Number.isSafeInteger(target) || target < 0) return reject('target-invalid')
  if (!tail || typeof order !== 'number') return reject('tail-unavailable')
  if (thread.compact) {
    const proof = thread.compact
    if (proof.snapshot !== s) return reject('compact-snapshot-mismatch')
    if (!proof.current()) return reject('compact-stale')
    if (!Number.isSafeInteger(proof.through) || target > proof.through) return reject('compact-completion-insufficient')
    if (!proof.roots.has(tail.id)) return reject('compact-tail-uncovered')
  } else {
    if (target > s.checkpoint) return reject('checkpoint-insufficient')
    if (!Number.isSafeInteger(thread.completeThrough) || target > thread.completeThrough) return reject('completion-insufficient')
    if (s.repair && target > s.repair.fromVersion) return reject('repair-pending')
    if (!s.ranges.some(r => r.start <= order && r.start < r.end)) return reject('coverage-insufficient')
  }
  if (s.items.some(i => i.shown === true && (i.status === 'queued' || typeof i.order !== 'number' || i.order <= 0))) return reject('shown-tail-pending')
  return target
}

const publisher = createReadPublisher({
  epoch: (host, id) => conversationReadRouteStore.getState().epochFor(host, id),
  rows: () => conversationListStore.getState().conversations ?? [],
  connected: host => sessionStore.getState().statuses.get(host)?.type === 'connected',
  send: command => window.pyry.sendCommand(command)
})

export function useReadPublication(selected = publisher): void {
  useEffect(() => {
    const offList = conversationListStore.subscribe(selected.sync)
    const offRoute = conversationReadRouteStore.subscribe(selected.sync)
    const offLink = sessionStore.subscribe(selected.sync)
    const offEvent = window.pyry.onDaemonEvent(event => {
      if (event.type === 'conversationDeleted' && 'serverId' in event && typeof event.serverId === 'string') {
        selected.forget(event.serverId, event.id)
      }
    })
    selected.sync()
    return () => { offList(); offRoute(); offLink(); offEvent() }
  }, [selected])
}

export function useReadObservation(inputs: ThreadReadInputs | undefined,
  pane: RefObject<HTMLDivElement>, thread: RefObject<HTMLDivElement>, log = sendReadDiagnostic): void {
  const committed = useRef(inputs)
  const setup = useRef<{ key: string; region: HTMLElement; covered: HTMLElement; tail: HTMLElement;
    observe: () => void; dispose: () => void }>()
  useReadLayoutEffect(() => { committed.current = inputs })
  useReadLayoutEffect(() => {
    const region = thread.current, covered = pane.current
    const newest = inputs && newestShown(inputs.snapshot)
    const routeEpoch = inputs?.compact?.routeEpoch ?? inputs?.snapshot.epoch
    const key = inputs && newest && JSON.stringify([inputs.snapshot.hostId, inputs.snapshot.conversationId, routeEpoch, newest.id])
    const held = setup.current
    if (held && key === held.key && region === held.region && covered === held.covered &&
      !inputs?.readerOpen && held.tail.isConnected) {
      log({ event: 'read-observer-setup', code: 'reused' }); held.observe(); return
    }
    held?.dispose(); setup.current = undefined
    if (!inputs) { log({ event: 'read-observer-setup', code: 'inputs-unavailable' }); return }
    const target = readTargetFor(inputs, log)
    if (target === undefined || !newest || !key) return // Target rejection already logged; success guarantees newest/key.
    if (inputs.readerOpen) { log({ event: 'read-observer-setup', code: 'reader-open' }); return }
    if (!region || !covered) { log({ event: 'read-observer-setup', code: 'dom-unavailable' }); return }
    const tail = region.querySelector<HTMLElement>(`[data-read-row="${newest.id}"]`)
    if (!tail) { log({ event: 'read-observer-setup', code: 'tail-dom-unavailable' }); return }
    const { hostId, conversationId, epoch } = inputs.snapshot
    const observe = () => {
      const current = committed.current
      const stop = (code: 'inputs-unavailable' | 'reader-open' | 'scope-stale' | 'tail-stale' | 'route-stale' |
        'document-unfocused' | 'document-hidden' | 'tail-disconnected' | 'tail-hidden' | 'tail-queued' |
        'viewport-empty' | 'viewport-above' | 'viewport-below'): void => log({ event: 'read-observer', code })
      if (!current) return stop('inputs-unavailable')
      if (current.readerOpen) return stop('reader-open')
      if (current.snapshot.hostId !== hostId || current.snapshot.conversationId !== conversationId || current.snapshot.epoch !== epoch) return stop('scope-stale')
      const target = readTargetFor(current, log)
      if (target === undefined) return // The delegated rejection already emitted its one record.
      if (newestShown(current.snapshot)?.id !== newest.id) return stop('tail-stale')
      if ((current.compact?.routeEpoch ?? current.snapshot.epoch) !== routeEpoch ||
        conversationReadRouteStore.getState().epochFor(hostId, conversationId) !== routeEpoch) return stop('route-stale')
      if (!document.hasFocus()) return stop('document-unfocused')
      if (document.visibilityState !== 'visible') return stop('document-hidden')
      if (!tail.isConnected) return stop('tail-disconnected')
      if (tail.closest('[hidden]')) return stop('tail-hidden')
      if (tail.classList.contains('message-row--queued')) return stop('tail-queued')
      const viewport = region.getBoundingClientRect(), rect = tail.getBoundingClientRect()
      const shell = covered.closest('.conversation__covered') ?? covered
      const top = Math.max(viewport.top, shell.querySelector('.conversation__top-chrome')?.getBoundingClientRect().bottom ?? viewport.top)
      const bottom = Math.min(viewport.bottom, shell.querySelector('.conversation__input-chrome')?.getBoundingClientRect().top ?? viewport.bottom)
      if (rect.height <= 0) return stop('viewport-empty')
      if (rect.bottom <= top) return stop('viewport-above')
      if (rect.bottom > bottom) return stop('viewport-below')
      ;(current.publisher ?? publisher).observe(hostId, conversationId, target, routeEpoch ?? epoch)
    }
    const resize = new ResizeObserver(observe)
    resize.observe(region); resize.observe(covered); resize.observe(tail)
    for (const chrome of (covered.closest('.conversation__covered') ?? covered).querySelectorAll('.conversation__top-chrome, .conversation__input-chrome')) resize.observe(chrome)
    region.addEventListener('scroll', observe); window.addEventListener('focus', observe)
    document.addEventListener('visibilitychange', observe)
    const off = conversationListStore.subscribe(observe)
    setup.current = { key, region, covered, tail, observe, dispose() { off(); resize.disconnect();
      region.removeEventListener('scroll', observe); window.removeEventListener('focus', observe); document.removeEventListener('visibilitychange', observe) } }
    observe()
  })
  useReadLayoutEffect(() => () => { setup.current?.dispose(); setup.current = undefined }, [])
}
