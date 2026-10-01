import { createStore, type StoreApi } from 'zustand/vanilla'
import type { StampedDaemonEvent } from '@shared/ipc/events'
import type { ConversationCreatedPayload } from '@shared/wire/types'
import type { ModelListEntry } from './modelListStore'
import type { RunSettingsWriteStore, SettingsChange } from './runSettingsWriteStore'

export interface ModelPreferenceStorage {
  read(): string | null
  write(value: string): void
}

export interface ModelRecallDeps {
  onDaemonEvent: (listener: (event: StampedDaemonEvent) => void) => () => void
  ownsTarget: () => boolean
  canWriteTarget: () => boolean
  subscribeOwnership: (listener: () => void) => () => void
  getModels: () => ModelListEntry | undefined
  writes: StoreApi<RunSettingsWriteStore>
  submit: (sessionId: string, change: SettingsChange, changeId: string) => void
  mintChangeId: () => string
  log: (code: string) => void
}

/** Profile-wide raw preference and one cancellable creation attempt. No active-session reads. */
export function createRememberedModel(storage: ModelPreferenceStorage) {
  const pending = createStore<{ target: string | null }>(() => ({ target: null }))
  let cancel = () => {}
  const remember = (value: string): void => { if (value !== '') storage.write(value) }
  const start = (
    created: ConversationCreatedPayload,
    serverId: string | undefined,
    deps: ModelRecallDeps,
    activate: () => void
  ): void => {
    cancel()
    if (created.is_promoted) { activate(); return }
    const value = storage.read()
    if (!value || value === 'default' || serverId === undefined) {
      deps.log('preference-skipped'); activate(); return
    }
    let stage: 'models' | 'settings' | 'ack' = 'models'
    let sessionId: string | undefined
    let changeId: string | undefined
    let activated = false
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const offs: (() => void)[] = []
    const finish = (code: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      for (const off of offs) off()
      if (changeId !== undefined && deps.writes.getState().pending.has(changeId)) {
        deps.writes.getState().dispatch({ type: 'settingsRejected', changeId })
      }
      pending.setState({ target: null })
      deps.log(code)
    }
    cancel = () => finish('cancelled')
    const own = (): boolean => {
      if (deps.ownsTarget()) return true
      finish('cancelled'); return false
    }
    const wait = (read: 'models' | 'settings'): void => {
      clearTimeout(timer)
      timer = setTimeout(() => finish(read + '-timeout'), 5000)
    }
    const write = (): void => {
      if (settled || !activated || stage !== 'settings' || sessionId === undefined || !own()) return
      if (!deps.canWriteTarget()) { finish('cancelled'); return }
      clearTimeout(timer)
      stage = 'ack'
      changeId = deps.mintChangeId()
      deps.log('submitted')
      try {
        deps.submit(sessionId, { field: 'model', value, source: 'recall' }, changeId)
      } catch {
        finish('failed')
      }
    }
    const acceptModels = (entry: ModelListEntry): void => {
      if (settled || stage !== 'models') return
      const eligible = entry.models.some(row => row.value === value &&
        (row.agent ?? 'claude') === (created.agent ?? 'claude') &&
        !row.truncated_fields?.includes('value'))
      if (!eligible) { finish('models-skipped'); return }
      stage = 'settings'
      wait('settings')
      write()
    }
    pending.setState({ target: created.id })
    deps.log('started')
    wait('models')
    offs.push(deps.onDaemonEvent(event => {
      if (settled || event.serverId !== serverId || (activated && !own())) return
      if (event.type === 'connected') {
        finish('cancelled')
      } else if (event.type === 'runConfigReceived' && event.conversationId === created.id && sessionId === undefined) {
        sessionId = event.sessionId
        if (sessionId === '') finish('empty-session')
        else write()
      } else if (event.type === 'modelList' && event.conversationId === created.id) {
        acceptModels(event)
      } else if (stage === 'ack' && (event.type === 'sessionSettingsUpdated' ||
        event.type === 'sessionSettingsRejected') && event.changeId === changeId) {
        finish(event.type === 'sessionSettingsUpdated' ? 'confirmed' : 'rejected')
      }
    }))
    offs.push(deps.subscribeOwnership(() => { if (activated && !settled) own() }))
    activate()
    activated = true
    if (settled || !own()) return
    const models = deps.getModels()
    if (models !== undefined) acceptModels(models)
    write()
  }
  return { pending, remember, start, cancel: () => cancel() }
}

export const rememberedModel = createRememberedModel({
  read: () => typeof window === 'undefined' ? null : window.localStorage.getItem('pyry.lastModel'),
  write: value => { if (typeof window !== 'undefined') window.localStorage.setItem('pyry.lastModel', value) }
})
