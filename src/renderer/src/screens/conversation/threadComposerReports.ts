import { createStore } from 'zustand/vanilla'
import type { StampedDaemonEvent } from '@shared/ipc/events'
import type { ThreadSnapshot } from '../../store/threadItemStore'
import type { TimelineState } from '../../store/threadTimeline'
import { threadItemPresentations, taskLinked } from './threadItemPresentation'
import { threadTaskPresentations } from './threadTaskPresentation'

type Offer = NonNullable<TimelineState['refusalOffer']>
export interface ThreadRefusal {
  host: string; chat: string; epoch: string; session: string; item: number; rev: number; report: Offer['report']
}
export interface ThreadComposerReports {
  latest?: TimelineState['latestTurnEnd']
  banner?: TimelineState['stoppingBanner']
  refusal?: ThreadRefusal
  taskCount: number
  tool?: { name: string; elapsedSeconds?: number }
}
const order = (item: ThreadSnapshot['items'][number]) => typeof item.order === 'number' ? item.order : 0

/** Transient chrome reads the selected host's authoritative facts, never the retired timeline. */
export function threadComposerReports(snapshot: ThreadSnapshot, session: string | null, clearedThrough = 0,
  running = false): ThreadComposerReports {
  const result: ThreadComposerReports = { taskCount: threadTaskPresentations(snapshot).filter(task => task.active).length }
  if (!session) return result
  const own = snapshot.items.filter(item => item.session === session)
  const rows = threadItemPresentations({ ...snapshot, items: own }).sort((a, b) => order(a.source) - order(b.source))
  const newestEnd = own.filter(item => item.kind === 'turn_end').sort((a, b) => order(b) - order(a))[0]
  const activity = Math.max(0, ...own.filter(item => !item.parent &&
    ['user_message', 'assistant_message', 'tool_call', 'session_divider'].includes(String(item.kind))).map(order))
  for (const row of rows) {
    const item = row.item
    if (item?.kind === 'toolCall' && row.source.active === true && !row.source.parent && !taskLinked(row.source))
      result.tool = { name: item.name, elapsedSeconds: item.elapsedSeconds }
    if (item?.kind === 'turnBoundary' && row.source === newestEnd && row.source.rev > clearedThrough && !running && activity < order(row.source)) {
      const { kind: _kind, ...end } = item
      result.latest = { type: 'turnEnd', ...end }
    }
    if (item?.kind === 'banner' && item.stopsTurn && row.source.rev > clearedThrough &&
        !own.some(source => source.kind === 'user_message' && source.rev > row.source.rev)) {
      const { kind: _kind, ...banner } = item
      result.banner = banner
    }
    if (item?.kind === 'modelRefusal') result.refusal = undefined
    if (item?.kind === 'modelRefusal' && item.refusal.type === 'modelRefusalFallback' &&
        item.refusal.scope === 'session' && item.refusal.originalModel && item.refusal.fallbackModel) {
      result.refusal = { host: snapshot.hostId, chat: snapshot.conversationId, epoch: snapshot.epoch, session,
        item: row.source.id, rev: row.source.rev, report: item.refusal }
    }
  }
  return result
}

type RefusalAction = { source: ThreadRefusal; changeId?: string; rejected?: boolean; dismissed?: boolean }
const key = (host: string, chat: string) => JSON.stringify([host, chat])
/** Only recovery-control state is local. Report content and identity always come from daemon items. */
export function createThreadRefusalActions() {
  return createStore<{ entries: ReadonlyMap<string, RefusalAction>; observe: (source: ThreadRefusal) => void;
    selected: (host: string, chat: string, changeId: string) => void;
    begin: (source: ThreadRefusal, changeId: string) => void; event: (event: StampedDaemonEvent) => void;
    remove: (host: string, chat?: string) => void }>((set, get) => {
    const save = (entry: RefusalAction) => set(state => ({ entries: new Map(state.entries).set(key(entry.source.host, entry.source.chat), entry) }))
    return {
      entries: new Map(),
      observe(source) {
        const previous = get().entries.get(key(source.host, source.chat))
        if (previous && previous.source.epoch === source.epoch && previous.source.session === source.session &&
            previous.source.item === source.item && previous.source.rev === source.rev) return
        save({ source })
      },
      selected(host, chat, changeId) {
        const entry = get().entries.get(key(host, chat))
        if (entry && entry.changeId !== changeId) save({ source: entry.source, dismissed: true })
      },
      begin(source, changeId) { save({ source, changeId }) },
      event(event) {
        for (const entry of get().entries.values()) {
          if (entry.source.host !== event.serverId) continue
          if ((event.type === 'sessionSettingsUpdated' || event.type === 'sessionSettingsRejected') &&
              event.changeId === entry.changeId && (event.type === 'sessionSettingsRejected' || event.sessionId === entry.source.session))
            save({ source: entry.source, rejected: event.type === 'sessionSettingsRejected', dismissed: event.type === 'sessionSettingsUpdated' })
          else if (event.type === 'connected' && entry.changeId) save({ source: entry.source })
          else if (event.type === 'modelAnnounced' && event.conversationId === entry.source.chat &&
              event.envelopeSessionId === entry.source.session && event.model && event.model !== entry.source.report.fallbackModel)
            save({ source: entry.source, dismissed: true })
        }
      },
      remove(host, chat) { set(state => ({ entries: new Map([...state.entries].filter(([, entry]) =>
        entry.source.host !== host || chat !== undefined && entry.source.chat !== chat)) })) }
    }
  })
}
