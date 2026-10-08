import { useEffect, useLayoutEffect, type RefObject } from 'react'
import type { RendererCommand } from '@shared/ipc/commands'
import { conversationListStore } from './conversationListStore'
import { sessionStore } from './sessionStore'
import { conversationTimelineStore, useConversationTimelineStore, type ConversationSlice } from './conversationTimelineStore'

type ReadRow = { id: string; serverId?: string | null; read_up_to?: number; latest_entry_id?: number }
type ReadCommand = Extract<RendererCommand, { type: 'markConversationRead' }>

export function createReadPublisher(deps: {
  rows: () => readonly ReadRow[]; connected: (host: string) => boolean; send: (command: ReadCommand) => void
}) {
  const pending = new Map<string, Map<string, { target: number; attempted?: number; generation?: number }>>()
  const links = new Map<string, { connected: boolean; generation: number }>()
  const owner = (host: string, id: string) => {
    const matches = deps.rows().filter(r => r.id === id)
    return matches.length === 1 && matches[0].serverId === host ? matches[0] : undefined
  }
  const sync = () => {
    for (const host of new Set([...deps.rows().flatMap(r => typeof r.serverId === 'string' ? [r.serverId] : []), ...links.keys()])) {
      const connected = deps.connected(host)
      const prior = links.get(host)
      links.set(host, { connected, generation: (prior?.generation ?? 0) + (connected && !prior?.connected ? 1 : 0) })
    }
    for (const [host, conversations] of pending) for (const [id, mark] of conversations) {
      const row = owner(host, id)
      if (row === undefined || row.read_up_to === undefined || row.latest_entry_id === undefined || row.read_up_to >= mark.target) {
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
    observe(host: string, id: string, target: number) {
      if (!Number.isSafeInteger(target) || target < 0) return
      const row = owner(host, id)
      if (row?.read_up_to === undefined || row.latest_entry_id === undefined || row.read_up_to >= target) return
      const records = pending.get(host) ?? new Map()
      const held = records.get(id)
      if (held === undefined) records.set(id, { target })
      else held.target = Math.max(held.target, target)
      pending.set(host, records); sync()
    },
    forget(host: string, id: string) { pending.get(host)?.delete(id) }
  }
}

export function readTargetFor(slice: ConversationSlice | undefined): number | undefined {
  if (slice === undefined) return undefined
  const { items, rowKeys } = slice.timeline
  const index = items.reduce((last, item, index) => item.kind === 'assistantText' || item.kind === 'userText' ? index : last, -1)
  if (index < 0) return undefined
  const key = rowKeys?.[index]
  const keys = new Set(rowKeys)
  const retained = slice.display?.filter(d => d.rowKey !== undefined && keys.has(d.rowKey)) ?? []
  if (key === undefined || !retained.some(d => d.rowKey === key)) return undefined
  const ids = retained.map(d => d.lastId ?? d.id)
  if (slice.displayStateId !== undefined) ids.push(slice.displayStateId)
  return ids.reduce<number | undefined>((held, id) => held === undefined ? id : Math.max(held, id), undefined)
}

const publisher = createReadPublisher({
  rows: () => conversationListStore.getState().conversations ?? [],
  connected: host => sessionStore.getState().statuses.get(host)?.type === 'connected',
  send: command => window.pyry.sendCommand(command)
})

export function useReadPublication(): void {
  useEffect(() => {
    const offList = conversationListStore.subscribe(publisher.sync)
    const offLink = sessionStore.subscribe(publisher.sync)
    const offEvent = window.pyry.onDaemonEvent(event => {
      if (event.type === 'conversationDeleted' && 'serverId' in event && typeof event.serverId === 'string') {
        publisher.forget(event.serverId, event.id)
      }
    })
    publisher.sync()
    return () => { offList(); offLink(); offEvent() }
  }, [])
}

export function useReadObservation(id: string | null, readerOpen: boolean,
  pane: RefObject<HTMLDivElement>, thread: RefObject<HTMLDivElement>): void {
  const slice = useConversationTimelineStore(s => id === null ? undefined : s.timelines.get(id))
  useLayoutEffect(() => {
    const region = thread.current
    const covered = pane.current
    if (id === null || region === null || covered === null || readerOpen || slice === undefined) return
    const target = readTargetFor(slice)
    const index = slice.timeline.items.reduce((last, item, index) => item.kind === 'assistantText' || item.kind === 'userText' ? index : last, -1)
    const key = slice.timeline.rowKeys?.[index]
    const tail = Array.from(region.querySelectorAll<HTMLElement>('[data-read-row]')).find(node => node.dataset.readRow === String(key))
    if (target === undefined || key === undefined || tail === undefined) return
    const observe = () => {
      if (!document.hasFocus() || document.visibilityState !== 'visible' || tail.closest('[hidden]') || tail.classList.contains('message-row--queued')) return
      const viewport = region.getBoundingClientRect()
      const top = Math.max(viewport.top, covered.querySelector('.conversation__top-chrome')?.getBoundingClientRect().bottom ?? viewport.top)
      const bottom = Math.min(viewport.bottom, covered.querySelector('.conversation__input-chrome')?.getBoundingClientRect().top ?? viewport.bottom)
      const rect = tail.getBoundingClientRect()
      if (rect.height <= 0 || rect.bottom <= top || rect.bottom > bottom) return
      const matches = conversationListStore.getState().conversations?.filter(r => r.id === id) ?? []
      const host = matches.length === 1 ? matches[0].serverId : undefined
      if (typeof host === 'string' && slice.serverId === host) publisher.observe(host, id, target)
    }
    const resize = new ResizeObserver(observe)
    resize.observe(region); resize.observe(covered); resize.observe(tail)
    for (const chrome of covered.querySelectorAll('.conversation__top-chrome, .conversation__input-chrome')) resize.observe(chrome)
    region.addEventListener('scroll', observe); window.addEventListener('focus', observe)
    observe()
    return () => { resize.disconnect(); region.removeEventListener('scroll', observe); window.removeEventListener('focus', observe) }
  }, [id, readerOpen, slice, pane, thread])
}
