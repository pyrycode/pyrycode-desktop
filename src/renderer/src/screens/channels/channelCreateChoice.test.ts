import { describe, expect, it } from 'vitest'
import type { WireModelOption } from '@shared/wire/types'
import { createConversationListStore, selectConversationsFor } from '../../store/conversationListStore'
import { createModelListStore } from '../../store/modelListStore'
import { cachedChannelModels, channelCreateChoice } from './channelCreateChoice'

const row = (value: string, agent?: 'claude' | 'codex'): WireModelOption => ({
  value, agent, display_name: 'Published label', resolved_model: value,
  effort_levels: ['low', 'high'], supports_auto_mode: false, truncated_fields: null
})

describe('channelCreateChoice', () => {
  it.each([
    [row('default'), {}],
    [row('default', 'claude'), {}],
    [row('sonnet'), { model: 'sonnet' }],
    [row('sonnet', 'claude'), { model: 'sonnet' }],
    [row('gpt-6-luna', 'codex'), { agent: 'codex', model: 'gpt-6-luna' }],
    [row('default', 'codex'), { agent: 'codex', model: 'default' }]
  ])('maps the exact published agent/model (%j)', (selected, expected) => {
    expect(channelCreateChoice(selected, null)).toEqual(expected)
  })

  it.each([
    [row('default'), { effort: 'low' }],
    [row('sonnet'), { model: 'sonnet', effort: 'low' }],
    [row('gpt-6-luna', 'codex'), { agent: 'codex', model: 'gpt-6-luna', effort: 'low' }]
  ])(
    'includes compatible remembered effort on any row (%j)', (selected, expected) => {
      expect(channelCreateChoice(selected, 'low')).toEqual(expected)
      for (const remembered of ['Low', 'medium', '', null]) {
        expect(channelCreateChoice(selected, remembered)).not.toHaveProperty('effort')
      }
      expect(channelCreateChoice({ ...selected, effort_levels: [] }, 'low'))
        .not.toHaveProperty('effort')
    }
  )

  it('omits every optional create field without a selected row', () => {
    expect(channelCreateChoice(undefined, 'low')).toBeUndefined()
  })
})

describe('cachedChannelModels', () => {
  const conversation = (id: string) => ({ id, name: null, cwd: '/same/path',
    is_promoted: true, is_archived: false, workspace_label: null,
    last_message_ts: '2026-09-25T00:00:00Z', last_used_at: '2026-09-25T00:00:00Z' })

  it('uses only target-host conversations, including a later cached conversation', () => {
    const conversations = createConversationListStore()
    conversations.getState().setConversations([conversation('other')], 'other-host')
    conversations.getState().setConversations([conversation('uncached'), conversation('target')], 'target-host')
    const models = createModelListStore()
    const other = [row('other-model', 'codex')]
    const target = [row('default'), row('same'), row('same', 'codex')]
    models.getState().setModelList({ conversationId: 'other', models: other, droppedModels: 0 })
    expect(cachedChannelModels(selectConversationsFor('target-host')(conversations.getState()), models.getState()))
      .toBeNull()
    models.getState().setModelList({ conversationId: 'target', models: target, droppedModels: 0 })
    expect(cachedChannelModels(selectConversationsFor('target-host')(conversations.getState()), models.getState()))
      .toBe(target)
    expect(cachedChannelModels(selectConversationsFor('other-host')(conversations.getState()), models.getState()))
      .toBe(other)
  })

  it('preserves a cached empty list and never substitutes a different cache', () => {
    const models = createModelListStore()
    const empty: WireModelOption[] = []
    models.getState().setModelList({ conversationId: 'empty', models: empty, droppedModels: 0 })
    models.getState().setModelList({ conversationId: 'other', models: [row('default')], droppedModels: 0 })
    expect(cachedChannelModels([conversation('empty'), conversation('other')], models.getState())).toBe(empty)
    expect(cachedChannelModels([], models.getState())).toBeNull()
    expect(cachedChannelModels(null, models.getState())).toBeNull()
  })
})
