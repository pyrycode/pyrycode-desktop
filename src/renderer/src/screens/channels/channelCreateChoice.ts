import type { ConversationSummary, WireAgent, WireModelOption } from '@shared/wire/types'
import type { ModelListState } from '../../store/modelListStore'

export function cachedChannelModels(
  conversations: readonly ConversationSummary[] | null,
  state: ModelListState
): readonly WireModelOption[] | null {
  for (const conversation of conversations ?? []) {
    const entry = state.lists.get(conversation.id)
    if (entry !== undefined) return entry.models
  }
  return null
}

export function channelCreateChoice(
  row: WireModelOption | undefined,
  lastEffort: string | null
): { agent?: WireAgent; model?: string; effort?: string } | undefined {
  if (row === undefined) return undefined
  return {
    ...(row.agent === 'codex' ? { agent: 'codex', model: row.value } :
      row.value === 'default' ? {} : { model: row.value }),
    ...(lastEffort !== null && row.effort_levels.includes(lastEffort) ? { effort: lastEffort } : {})
  }
}
