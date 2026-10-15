import type { createThreadRuntime } from './threadRuntime'
import { activeConversationStore } from './activeConversationStore'
import { threadLiveInputs } from '../screens/conversation/threadLiveInputs'
import { runConfigStore } from './runConfigStore'
import { sessionIdStore } from './sessionIdStore'
import { announcedModelStore } from './announcedModelStore'
import { modelListStore } from './modelListStore'
import { slashCommandListStore } from './slashCommandListStore'
import { sessionFactsStore } from './sessionFactsStore'
import { mcpStatusStore } from './mcpStatusStore'

/** Keep existing footer/sheet readers on the selected authoritative session's inputs. */
export function connectThreadLiveProjection(runtime: ReturnType<typeof createThreadRuntime>): () => void {
  let offLive: (() => void) | undefined
  let selected: ReturnType<typeof runtime.live> | undefined
  let previous: ReturnType<ReturnType<typeof runtime.live>['getState']> | undefined
  function publish(): void {
    const state = selected?.getState(), binding = state?.binding
    if (!state || !binding || state === previous) return
    const old = previous
    previous = state
    const input = threadLiveInputs(state), id = binding.conversationId
    if (old?.binding !== binding || old?.readings.get('session_settings') !== state.readings.get('session_settings')) {
      runConfigStore.setState({ snapshot: input.runConfig })
      if (input.sessionId === null) sessionIdStore.getState().clearSessionId()
      else sessionIdStore.getState().setSessionId(input.sessionId)
    }
    if (old?.binding !== binding || old?.readings.get('model_announced') !== state.readings.get('model_announced')) {
      announcedModelStore.setState(s => {
        const announced = new Map(s.announced)
        if (input.announcedModel) announced.set(id, input.announcedModel); else announced.delete(id)
        return { announced }
      })
    }
    if (old?.binding !== binding || old?.readings.get('model_list') !== state.readings.get('model_list')) {
      if (input.modelList) modelListStore.getState().setModelList(input.modelList)
      else modelListStore.setState(s => { const lists = new Map(s.lists); lists.delete(id); return { lists } })
    }
    if (old?.binding !== binding || old?.readings.get('slash_command_list') !== state.readings.get('slash_command_list')) {
      if (input.slashCommands) slashCommandListStore.getState().setSlashCommandList(input.slashCommands)
      else slashCommandListStore.setState(s => { const menus = new Map(s.menus); menus.delete(id); return { menus } })
    }
    if (old?.binding !== binding || old?.readings.get('session_facts') !== state.readings.get('session_facts')) {
      if (input.sessionFacts) sessionFactsStore.getState().setSessionFacts(input.sessionFacts)
      else sessionFactsStore.setState(s => { const facts = new Map(s.facts); facts.delete(id); return { facts } })
    }
    if (old?.binding !== binding || old?.readings.get('mcp_status') !== state.readings.get('mcp_status')) {
      if (input.mcpStatus) mcpStatusStore.getState().setMcpStatus(input.mcpStatus)
      else mcpStatusStore.setState(s => { const reports = new Map(s.reports); reports.delete(id); return { reports } })
    }
  }
  function sync(): void {
    const row = activeConversationStore.getState().activeConversation
    const next = row && 'serverId' in row && typeof row.serverId === 'string' && runtime.isThread(row.serverId, row.id)
      ? runtime.live(row.serverId, row.id) : undefined
    if (selected !== next) {
      offLive?.(); selected = next; previous = undefined
      offLive = selected?.subscribe(publish)
    }
    publish()
  }
  const offActive = activeConversationStore.subscribe(sync), offRoute = runtime.state.subscribe(sync)
  sync()
  return () => { offLive?.(); offActive(); offRoute() }
}
