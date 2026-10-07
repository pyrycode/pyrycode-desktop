import { createStore } from 'zustand/vanilla'
import type { RendererCommand } from '@shared/ipc/commands'
import type { StampedDaemonEvent } from '@shared/ipc/events'
import type { WireAgent, WireModelOption } from '@shared/wire/types'
import { activeConversationStore } from './activeConversationStore'
import { conversationListStore, selectConversations, selectConversationsFor, selectConversationAgentFor } from './conversationListStore'
import { sessionStore } from './sessionStore'
import { runConfigStore } from './runConfigStore'
import { runSettingsWriteStore } from './runSettingsWriteStore'
import { announcedModelStore } from './announcedModelStore'
import { selectDisplayedEffort } from '../screens/conversation/ComposerEffortMenu'
import { serverIdForOpenConversation } from '../screens/conversation/unpairAction'
import { requestRunConfigSnapshot } from '../screens/conversation/runConfigSnapshot'

type Attempt = { conversationId: string; serverId: string; outgoing: WireAgent; target: WireAgent; row: WireModelOption }
export type AgentSwitchStatus =
  | ({ type: 'pending' } & Attempt)
  | { type: 'refused'; serverId: string; retryable: boolean }
type Action =
  | { type: 'open'; conversationId: string; row: WireModelOption }
  | { type: 'cancel' | 'confirm' | 'reconcile' }
  | { type: 'paneChanged'; pane: { conversationId: string; serverId: string } | null }
  | { type: 'hostRemoved'; serverId: string }
  | { type: 'outcome'; event: StampedDaemonEvent }
type Binding = { serverId: string; agent: WireAgent; connected: boolean; open: boolean; effort: string | null | undefined }

/** Pending belongs to the conversation, not the mounted pane. All writes use typed actions. */
export function createAgentSwitchStore(deps: {
  binding: (conversationId: string, owningServerId?: string) => Binding | null
  send: (command: RendererCommand) => void
  log: (code: string) => void
  onSucceeded: (conversationId: string) => void
  onActiveSucceeded?: (conversationId: string) => void
}) {
  return createStore<{
    pane: { conversationId: string; serverId: string } | null
    dialog: Attempt | null
    statuses: ReadonlyMap<string, AgentSwitchStatus>
    dispatch: (action: Action) => void
  }>((set, get) => ({
    pane: null, dialog: null, statuses: new Map(),
    dispatch: action => {
      const { dialog, statuses } = get()
      const valid = (a: Attempt): Binding | null => {
        const b = deps.binding(a.conversationId)
        return b?.connected && b.open && b.serverId === a.serverId && b.agent === a.outgoing ? b : null
      }
      switch (action.type) {
        case 'paneChanged':
          set({ pane: action.pane, dialog: null }); return
        case 'open': {
          if (statuses.get(action.conversationId)?.type === 'pending') return
          const b = deps.binding(action.conversationId)
          const target = action.row.agent ?? 'claude'
          if (!b?.connected || !b.open || b.agent === target) return
          const next = new Map(statuses); next.delete(action.conversationId)
          set({ dialog: { conversationId: action.conversationId, serverId: b.serverId,
            outgoing: b.agent, target, row: { ...action.row, effort_levels: [...action.row.effort_levels] } }, statuses: next })
          deps.log('opened'); return
        }
        case 'cancel':
          set({ dialog: null }); deps.log('cancelled'); return
        case 'confirm': {
          if (dialog === null) return
          const b = valid(dialog)
          if (b === null || statuses.get(dialog.conversationId)?.type === 'pending') {
            set({ dialog: null }); deps.log('unavailable'); return
          }
          const next = new Map(statuses)
          next.set(dialog.conversationId, { type: 'pending', ...dialog })
          set({ dialog: null, statuses: next })
          deps.log('submitted')
          deps.send({ type: 'switchAgent', payload: {
            conversation_id: dialog.conversationId, agent: dialog.target, model: dialog.row.value,
            ...(typeof b.effort === 'string' && dialog.row.effort_levels.includes(b.effort) ? { effort: b.effort } : {})
          } }); return
        }
        case 'reconcile': {
          const next = new Map(statuses)
          for (const [id, status] of statuses) {
            const b = deps.binding(id, status.serverId)
            if (!b?.connected || b.serverId !== status.serverId) { next.delete(id); deps.log('abandoned') }
          }
          const nextDialog = dialog !== null && valid(dialog) === null ? null : dialog
          if (next.size !== statuses.size || nextDialog !== dialog) set({ statuses: next, dialog: nextDialog })
          return
        }
        case 'hostRemoved': {
          const next = new Map(statuses)
          for (const [id, status] of statuses) if (status.serverId === action.serverId) { next.delete(id); deps.log('abandoned') }
          set({ statuses: next, dialog: dialog?.serverId === action.serverId ? null : dialog }); return
        }
        case 'outcome': {
          const e = action.event
          if (typeof e.serverId !== 'string' || e.serverId.length === 0) return
          const next = new Map(statuses)
          if (e.type === 'switchAgentRejected') {
            const pending = statuses.get(e.conversationId)
            if (pending?.type !== 'pending' || pending.serverId !== e.serverId) return
            next.set(e.conversationId, { type: 'refused', serverId: e.serverId, retryable: e.retryable })
            deps.log('refused')
          } else if (e.type === 'conversationsReceived') {
            for (const [id, pending] of statuses) {
              if (pending.type !== 'pending' || pending.serverId !== e.serverId) continue
              const row = e.conversations.find(r => r.id === id)
              if (row === undefined || (row.agent ?? 'claude') === pending.target) {
                next.delete(id); deps.log(row === undefined ? 'abandoned' : 'succeeded')
                if (row !== undefined) deps.onSucceeded(id)
                const pane = get().pane
                const binding = deps.binding(id, pending.serverId)
                if (row !== undefined && pane?.conversationId === id && pane.serverId === pending.serverId &&
                    binding?.open && binding.serverId === pending.serverId) deps.onActiveSucceeded?.(id)
              }
            }
          } else return
          set({ statuses: next }); return
        }
      }
    }
  }))
}

export const agentSwitchStore = createAgentSwitchStore({
  binding: (id, owningServerId) => {
    const lists = conversationListStore.getState()
    const serverId = owningServerId ?? serverIdForOpenConversation(selectConversations(lists), id)
    if (serverId === null || !selectConversationsFor(serverId)(lists)?.some(row => row.id === id)) return null
    return { serverId, agent: selectConversationAgentFor(serverId, id)(lists),
      connected: sessionStore.getState().statuses.get(serverId)?.type === 'connected',
      open: activeConversationStore.getState().activeConversation?.id === id &&
        agentSwitchStore.getState().pane?.conversationId === id && agentSwitchStore.getState().pane?.serverId === serverId,
      effort: selectDisplayedEffort(runConfigStore.getState().snapshot, runSettingsWriteStore.getState()) }
  },
  send: command => window.pyry.sendCommand(command),
  log: code => window.pyry.sendDiagnostic({ event: 'agent-switch', code }),
  onSucceeded: id => announcedModelStore.getState().clearAnnouncedModelFor(id),
  onActiveSucceeded: id => {
    runSettingsWriteStore.getState().dispatch({ type: 'agentSwitched' })
    requestRunConfigSnapshot(window.pyry.sendCommand, id)
  }
})

/** Menu entry points are owned by the next ticket; this opening has no side effect until confirmed. */
export function openAgentSwitch(conversationId: string, row: WireModelOption): void {
  agentSwitchStore.getState().dispatch({ type: 'open', conversationId, row })
}
