import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { RendererCommand } from '@shared/ipc/commands'
import { conversationListStore } from './conversationListStore'
import { sessionStore } from './sessionStore'
import { useConversationTimelineStore, type ConversationSlice } from './conversationTimelineStore'
import type { ThreadSnapshot } from './threadItemStore'
import { conversationReadRouteStore } from './conversationReadRouteStore'

const useReadLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect

type ReadRow = { id: string; serverId?: string | null; read_up_to?: number; latest_entry_id?: number; last_shown_version?: number }
type ReadCommand = Extract<RendererCommand, { type: 'markConversationRead' }>
export type ThreadReadInputs = { snapshot: ThreadSnapshot; row: ReadRow; readerOpen?: boolean;
  /** Completed newest-window/catch-up progress represented by this immutable snapshot, never a page. */
  completeThrough: number;
  publisher?: ReturnType<typeof createReadPublisher> }

export function createReadPublisher(deps: {
  rows: () => readonly ReadRow[]; connected: (host: string) => boolean; send: (command: ReadCommand) => void
  epoch?: (host: string, id: string) => string | undefined
}) {
  const pending = new Map<string, Map<string, { target: number; epoch?: string; attempted?: number; generation?: number }>>()
  const links = new Map<string, { connected: boolean; generation: number }>()
  const owner = (host: string, id: string, epoch?: string) => {
    if (deps.epoch?.(host, id) !== epoch) return undefined
    const matches = deps.rows().filter(r => r.id === id && (epoch === undefined || r.serverId === host))
    return matches.length === 1 && matches[0].serverId === host ? matches[0] : undefined
  }
  const eligible = (row: ReadRow | undefined, epoch?: string) => row?.read_up_to !== undefined &&
    (epoch === undefined ? row.latest_entry_id !== undefined : row.last_shown_version !== undefined)
  const sync = () => {
    for (const host of new Set([...deps.rows().flatMap(r => typeof r.serverId === 'string' ? [r.serverId] : []), ...links.keys()])) {
      const connected = deps.connected(host)
      const prior = links.get(host)
      links.set(host, { connected, generation: (prior?.generation ?? 0) + (connected && !prior?.connected ? 1 : 0) })
    }
    for (const [host, conversations] of pending) for (const [id, mark] of conversations) {
      const row = owner(host, id, mark.epoch)
      if (!eligible(row, mark.epoch) || row?.read_up_to === undefined || row.read_up_to >= mark.target) {
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
    observe(host: string, id: string, target: number, epoch?: string) {
      if (!Number.isSafeInteger(target) || target < 0) return
      const row = owner(host, id, epoch)
      if (!eligible(row, epoch) || row?.read_up_to === undefined || row.read_up_to >= target) return
      const records = pending.get(host) ?? new Map()
      const held = records.get(id)
      if (held === undefined || held.epoch !== epoch) records.set(id, { target, epoch })
      else held.target = Math.max(held.target, target)
      pending.set(host, records); sync()
    },
    forget(host: string, id: string) { pending.get(host)?.delete(id) }
  }
}

function newestReadRowKey(slice: ConversationSlice): number | undefined {
  const { items, rowKeys } = slice.timeline
  for (let index = items.length - 1; index >= 0; index--) {
    if (items[index].kind === 'assistantText' || items[index].kind === 'userText') return rowKeys?.[index]
  }
  return undefined
}

function newestShown(snapshot: ThreadSnapshot) {
  return snapshot.items.filter(i => i.shown === true && i.status !== 'queued' &&
    typeof i.order === 'number' && i.order > 0).at(-1)
}

export function readTargetFor(slice: ConversationSlice | undefined, thread?: ThreadReadInputs): number | undefined {
  if (thread) {
    const { snapshot: s, row } = thread, target = row.last_shown_version, tail = newestShown(s), order = tail?.order
    if (s.hostId !== row.serverId || s.conversationId !== row.id || row.read_up_to === undefined ||
      target === undefined || !Number.isSafeInteger(target) || target < 0 || target > s.checkpoint ||
      !Number.isSafeInteger(thread.completeThrough) || target > thread.completeThrough ||
      s.repair && target > s.repair.fromVersion || !tail || typeof order !== 'number' ||
      !s.ranges.some(r => r.start <= order && r.start < r.end)) return undefined
    if (s.items.some(i => i.shown === true && (i.status === 'queued' || typeof i.order !== 'number' || i.order <= 0))) return undefined
    return target
  }
  if (slice === undefined) return undefined
  const key = newestReadRowKey(slice)
  if (key === undefined) return undefined
  const keys = new Set(slice.timeline.rowKeys)
  const retained = slice.display?.filter(d => d.rowKey !== undefined && keys.has(d.rowKey)) ?? []
  if (!retained.some(d => d.rowKey === key)) return undefined
  const ids = retained.map(d => d.lastId ?? d.id)
  if (slice.displayStateId !== undefined) ids.push(slice.displayStateId)
  return ids.reduce<number | undefined>((held, id) => held === undefined ? id : Math.max(held, id), undefined)
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

export function useReadObservation(id: string | null, readerOpen: boolean,
  pane: RefObject<HTMLDivElement>, thread: RefObject<HTMLDivElement>, authoritative?: ThreadReadInputs): void {
  useThreadReadObservation(authoritative, pane, thread)
  const slice = useConversationTimelineStore(s => id === null || authoritative ? undefined : s.timelines.get(id))
  const committed = useRef<{ slice: ConversationSlice | undefined; target: number | undefined }>({ slice: undefined, target: undefined })
  const setup = useRef<{
    id: string; key: number; region: HTMLDivElement; covered: HTMLDivElement; tail: HTMLElement
    observe: () => void; dispose: () => void
  }>()
  useReadLayoutEffect(() => {
    // Callbacks may run on list receipt before React commits a newer timeline.
    // Only this layout effect advances their displayed identity and target.
    committed.current = { slice, target: readTargetFor(slice) }
    const region = thread.current
    const covered = pane.current
    const key = slice === undefined ? undefined : newestReadRowKey(slice)
    const held = setup.current
    if (!readerOpen && id !== null && key !== undefined && held?.id === id && held.key === key &&
      held.region === region && held.covered === covered && held.tail.isConnected && region?.contains(held.tail)) {
      // Identity can advance without a resize (including initially unknown identity).
      held.observe()
      return
    }
    held?.dispose()
    setup.current = undefined
    if (id === null || region === null || covered === null || readerOpen || key === undefined) return
    const tail = region.querySelector<HTMLElement>(`[data-read-row="${key}"]`)
    if (tail === null) return
    const observe = () => {
      const { slice: displayed, target } = committed.current
      if (displayed === undefined || target === undefined) return
      if (!document.hasFocus() || document.visibilityState !== 'visible' || tail.closest('[hidden]') || tail.classList.contains('message-row--queued')) return
      const viewport = region.getBoundingClientRect()
      const top = Math.max(viewport.top, covered.querySelector('.conversation__top-chrome')?.getBoundingClientRect().bottom ?? viewport.top)
      const bottom = Math.min(viewport.bottom, covered.querySelector('.conversation__input-chrome')?.getBoundingClientRect().top ?? viewport.bottom)
      const rect = tail.getBoundingClientRect()
      if (rect.height <= 0 || rect.bottom <= top || rect.bottom > bottom) return
      const matches = conversationListStore.getState().conversations?.filter(r => r.id === id) ?? []
      const host = matches.length === 1 ? matches[0].serverId : undefined
      if (typeof host === 'string' && displayed.serverId === host &&
        conversationReadRouteStore.getState().epochFor(host, id) === undefined) publisher.observe(host, id, target)
    }
    const resize = new ResizeObserver(observe)
    resize.observe(region); resize.observe(covered); resize.observe(tail)
    for (const chrome of covered.querySelectorAll('.conversation__top-chrome, .conversation__input-chrome')) resize.observe(chrome)
    region.addEventListener('scroll', observe); window.addEventListener('focus', observe)
    // A list can establish read eligibility without changing the committed display.
    const offList = conversationListStore.subscribe(observe)
    setup.current = { id, key, region, covered, tail, observe,
      dispose: () => { offList(); resize.disconnect(); region.removeEventListener('scroll', observe); window.removeEventListener('focus', observe) } }
    observe()
  })
  useReadLayoutEffect(() => () => { setup.current?.dispose(); setup.current = undefined }, [])
}

function useThreadReadObservation(inputs: ThreadReadInputs | undefined,
  pane: RefObject<HTMLDivElement>, thread: RefObject<HTMLDivElement>): void {
  const committed = useRef(inputs)
  const setup = useRef<{ key: string; region: HTMLElement; covered: HTMLElement; tail: HTMLElement;
    observe: () => void; dispose: () => void }>()
  useReadLayoutEffect(() => { committed.current = inputs })
  useReadLayoutEffect(() => {
    const region = thread.current, covered = pane.current
    const target = inputs && readTargetFor(undefined, inputs), newest = inputs && newestShown(inputs.snapshot)
    const key = inputs && newest && JSON.stringify([inputs.snapshot.hostId, inputs.snapshot.conversationId, inputs.snapshot.epoch, newest.id])
    const held = setup.current
    if (held && key === held.key && region === held.region && covered === held.covered &&
      !inputs?.readerOpen && target !== undefined && held.tail.isConnected) { held.observe(); return }
    held?.dispose(); setup.current = undefined
    if (!inputs || inputs.readerOpen || !region || !covered || target === undefined || !newest || !key) return
    const tail = region.querySelector<HTMLElement>(`[data-read-row="${newest.id}"]`)
    if (!tail) return
    const { hostId, conversationId, epoch } = inputs.snapshot
    const observe = () => {
      const current = committed.current
      if (!current || current.readerOpen || current.snapshot.hostId !== hostId || current.snapshot.conversationId !== conversationId || current.snapshot.epoch !== epoch) return
      const target = readTargetFor(undefined, current)
      if (target === undefined || newestShown(current.snapshot)?.id !== newest.id ||
        conversationReadRouteStore.getState().epochFor(hostId, conversationId) !== epoch ||
        !document.hasFocus() || document.visibilityState !== 'visible' || !tail.isConnected || tail.closest('[hidden]') || tail.classList.contains('message-row--queued')) return
      const viewport = region.getBoundingClientRect(), rect = tail.getBoundingClientRect()
      const shell = covered.closest('.conversation__covered') ?? covered
      const top = Math.max(viewport.top, shell.querySelector('.conversation__top-chrome')?.getBoundingClientRect().bottom ?? viewport.top)
      const bottom = Math.min(viewport.bottom, shell.querySelector('.conversation__input-chrome')?.getBoundingClientRect().top ?? viewport.bottom)
      if (rect.height <= 0 || rect.bottom <= top || rect.bottom > bottom) return
      ;(current.publisher ?? publisher).observe(hostId, conversationId, target, epoch)
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
