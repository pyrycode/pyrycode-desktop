import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WireModelOption } from '@shared/wire/types'
import { composerModelMenuModel } from './ComposerModelMenu'
import { RunConfigView, selectConnectedModel, usePendingAgentSwitchRow } from './RunConfigSections'

import { conversationListStore } from '../../store/conversationListStore'
import { sessionStore } from '../../store/sessionStore'
import { sessionIdStore } from '../../store/sessionIdStore'
import { activeConversationStore } from '../../store/activeConversationStore'
import { agentSwitchStore } from '../../store/agentSwitchStore'
import { runSettingsWriteStore } from '../../store/runSettingsWriteStore'

// Static React renders otherwise read Zustand's initial server snapshot.
vi.mock('zustand', async importActual => ({
  ...await importActual<typeof import('zustand')>(),
  useStore: (store: { getState: () => unknown }, selector: (state: unknown) => unknown) => selector(store.getState())
}))

const claude: WireModelOption = { value: 'shared', display_name: 'Claude published', resolved_model: 'claude-shared-5',
  effort_levels: ['low', 'high'], supports_auto_mode: false, truncated_fields: null }
const codex: WireModelOption = { ...claude, agent: 'codex', display_name: 'GPT-6 Luna',
  resolved_model: 'gpt-luna', effort_levels: ['low', 'xhigh'] }
const models = { models: [codex, { ...claude, value: 'default' }, claude, codex], droppedModels: 0 }
const layers = { picked: '', announced: '', stored: 'shared' }

describe('merged model picker rows', () => {
  it.each(['claude', 'codex'] as const)('preserves all non-default rows and unique position IDs for %s', agent => {
    const menu = composerModelMenuModel(models, layers, agent)
    expect(menu?.options).toEqual([
      { id: '0', label: 'GPT-6 Luna' }, { id: '1', label: 'Shared' }, { id: '2', label: 'GPT-6 Luna' }
    ])
    expect(menu?.currentId).toBe(agent === 'claude' ? '1' : '0')
    const markup = renderToStaticMarkup(<RunConfigView model="shared" effort="low" yolo={false}
      usedTokens={0} windowTokens={0} models={models} agent={agent} />)
    expect([...markup.matchAll(/run-config__model-name">([^<]*)</g)].map(m => m[1]))
      .toEqual(['GPT-6 Luna', 'Claude published', 'GPT-6 Luna'])
    expect(markup.match(/Current model/g)).toHaveLength(1)
  })

  it('overlays only the selected pending model while retaining outgoing effort offerings', () => {
    const menu = composerModelMenuModel(models, layers, 'claude', codex)
    expect(menu?.label).toBe('GPT-6 Luna')
    expect(menu?.currentId).toBe('0')
    const markup = renderToStaticMarkup(<RunConfigView model="shared" modelLayers={layers} effort="low" yolo={false}
      usedTokens={0} windowTokens={0} models={models} agent="claude" pendingSwitchRow={codex} />)
    expect(markup).toContain('>high</')
    expect(markup).not.toContain('>xhigh</')
    expect(markup.match(/Current model/g)).toHaveLength(1)
    expect(composerModelMenuModel(models, layers, 'claude')?.label).toBe('Shared')
  })

  it('marks the retained picked row when another target row has the same raw value', () => {
    const picked = { ...codex, display_name: 'Another published Codex label', resolved_model: 'another-resolution' }
    const menu = composerModelMenuModel({ models: [codex, claude, picked], droppedModels: 0 }, layers, 'claude', picked)
    expect(menu?.label).toBe('Another published Codex label')
    expect(menu?.currentId).toBe('2')
  })

  it('does not let foreign rows make inherited matching ambiguous', () => {
    const inherited = { ...layers, stored: '', announced: 'claude-shared-5' }
    expect(composerModelMenuModel(models, inherited, 'claude')?.currentId).toBe('1')
  })
})

// These test the action boundary; real click handlers are exercised in Playwright.

it.each(['claude', 'codex'] as const)('routes the exact row from %s and scopes pending to its owner', agent => {
  const stores = [conversationListStore, sessionStore, sessionIdStore, activeConversationStore, agentSwitchStore, runSettingsWriteStore] as const
  const restore = stores.map(store => {
    const old = store.getState()
    const setState = store.setState as (state: unknown, replace: true) => void
    return () => setState(old, true)
  })
  const send = vi.fn()
  vi.stubGlobal('window', { pyry: { sendCommand: send, sendDiagnostic: vi.fn() } })
  const summary = { id: 'chat', name: 'Chat', cwd: '/fake', workspace_label: null,
    is_promoted: false, is_archived: false, last_message_ts: '', last_used_at: '', agent }
  const pendingMarkup = () => renderToStaticMarkup(<Pending />)
  function Pending(): JSX.Element { return <span>{usePendingAgentSwitchRow('chat')?.display_name ?? 'underlying'}</span> }
  try {
    conversationListStore.getState().setConversations([summary], 'owner')
    activeConversationStore.getState().setActiveConversation(summary)
    sessionStore.getState().dispatch({ type: 'connected', serverId: 'owner',
      ack: { protocol_version: 'v2', server_id: 'owner', conn_id: 'conn', capabilities: [] } })
    sessionIdStore.getState().setSessionId('session')
    agentSwitchStore.getState().dispatch({ type: 'paneChanged', pane: { serverId: 'owner', conversationId: 'chat' } })
    const own = agent === 'claude' ? claude : codex
    const other = agent === 'claude' ? codex : claude
    selectConnectedModel('chat', own)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ type: 'setSessionSettings',
      payload: { session_id: 'session', model: 'shared' }, changeId: expect.any(String) })
    expect(agentSwitchStore.getState().dialog).toBeNull()
    send.mockClear()
    selectConnectedModel('chat', other)
    expect(agentSwitchStore.getState().dialog?.row).toEqual(other)
    expect(send).not.toHaveBeenCalled()
    expect(pendingMarkup()).toContain('underlying')
    agentSwitchStore.getState().dispatch({ type: 'cancel' })
    expect(pendingMarkup()).toContain('underlying')
    selectConnectedModel('chat', other)
    agentSwitchStore.getState().dispatch({ type: 'confirm' })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toMatchObject({ type: 'switchAgent', payload: {
      conversation_id: 'chat', agent: agent === 'claude' ? 'codex' : 'claude', model: 'shared' } })
    expect(pendingMarkup()).toContain(other.display_name)
    selectConnectedModel('chat', other)
    expect(agentSwitchStore.getState().dialog).toBeNull()
    expect(send).toHaveBeenCalledTimes(1)
    const held = agentSwitchStore.getState().statuses.get('chat')!
    agentSwitchStore.setState({ statuses: new Map([['chat', { ...held, serverId: 'foreign' }]]) })
    expect(pendingMarkup()).toContain('underlying')
    agentSwitchStore.setState({ statuses: new Map() })
    sessionIdStore.getState().setSessionId('')
    selectConnectedModel('chat', other)
    expect(agentSwitchStore.getState().dialog).toBeNull()
    sessionIdStore.getState().setSessionId('session')
    sessionStore.getState().dispatch({ type: 'disconnected', serverId: 'owner' })
    selectConnectedModel('chat', own); selectConnectedModel('chat', other)
    expect(send).toHaveBeenCalledTimes(1)
    expect(agentSwitchStore.getState().dialog).toBeNull()
  } finally {
    restore.forEach(reset => reset())
    vi.unstubAllGlobals()
  }
})
