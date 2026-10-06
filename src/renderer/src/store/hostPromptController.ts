import { createStore } from 'zustand/vanilla'
import type { RendererCommand } from '@shared/ipc/commands'
import type { StampedDaemonEvent } from '@shared/ipc/events'
import { MAX_SYSTEM_PROMPT_BYTES } from '@shared/wire/types'

type Ready = { type: 'ready'; original: string; draft: string; defaultText: string; saveFailed: boolean }
type Reading = { type: 'reading' } | { type: 'read-failed' }
export type HostPromptState = Reading | Ready |
  { type: 'saving-name'; previous: Ready | Reading } |
  { type: 'saving-prompt'; previous: Ready; requestId: string }

/** One modal interaction, no cache/persistence. All network text stays inert and unlogged. */
export function createHostPromptController(
  serverId: string,
  send: (command: RendererCommand) => void,
  close: () => void,
  nextId: () => string = () => crypto.randomUUID()
) {
  const store = createStore<HostPromptState>(() => ({ type: 'reading' }))
  let alive = true, epoch = 0, readId = ''
  const set = (state: HostPromptState): void => { if (alive) store.setState(state, true) }
  function connectionLost(): void {
    if (!alive) return
    epoch++
    const s = store.getState()
    if (s.type === 'saving-name' || s.type === 'saving-prompt') {
      set(s.previous.type === 'ready' ? { ...s.previous, saveFailed: true } : { type: 'read-failed' })
    } else if (s.type === 'reading') set({ type: 'read-failed' })
  }
  return {
    store,
    open(): void {
      alive = true; epoch++; readId = nextId(); set({ type: 'reading' })
      try { send({ type: 'requestHostSystemPrompt', serverId, requestId: readId }) }
      catch { set({ type: 'read-failed' }) }
    },
    receive(event: StampedDaemonEvent): void {
      if (!alive || event.serverId !== serverId) return
      const s = store.getState()
      if (event.type !== 'hostSystemPromptReceived' && event.type !== 'hostSystemPromptFailed') return
      const reading = s.type === 'saving-name' ? s.previous : s
      if (reading.type === 'reading' && event.operation === 'read' && event.requestId === readId) {
        const received: Ready | Reading = event.type === 'hostSystemPromptFailed' ? { type: 'read-failed' } : {
          type: 'ready', original: event.systemPrompt, draft: event.systemPrompt,
          defaultText: event.defaultSystemPrompt, saveFailed: false
        }
        set(s.type === 'saving-name' ? { ...s, previous: received } : received)
      } else if (s.type === 'saving-prompt' && event.operation === 'write' && event.requestId === s.requestId) {
        if (event.type === 'hostSystemPromptFailed') set({ ...s.previous, saveFailed: true })
        else { alive = false; epoch++; close() }
      }
    },
    edit(draft: string): void {
      const s = store.getState()
      if (s.type === 'ready') set({ ...s, draft })
    },
    reset(): void {
      const s = store.getState()
      if (s.type === 'ready') set({ ...s, draft: s.defaultText })
    },
    async save(saveName: () => Promise<boolean>): Promise<void> {
      const previous = store.getState()
      if (!alive || previous.type === 'saving-name' || previous.type === 'saving-prompt' ||
          (previous.type === 'ready' && new TextEncoder().encode(previous.draft).length > MAX_SYSTEM_PROMPT_BYTES)) return
      const version = ++epoch
      set({ type: 'saving-name', previous })
      let saved = false
      try { saved = await saveName() } catch { /* Classified by the name consumer. */ }
      if (!alive || version !== epoch) return
      const current = store.getState()
      const settled = current.type === 'saving-name' ? current.previous : previous
      if (!saved) { set(settled); return }
      if (settled.type !== 'ready' || settled.draft === settled.original) {
        alive = false; close(); return
      }
      const requestId = nextId()
      set({ type: 'saving-prompt', previous: settled, requestId })
      try { send({ type: 'setHostSystemPrompt', serverId, requestId, payload: { system_prompt: settled.draft } }) }
      catch { set({ ...settled, saveFailed: true }) }
    },
    connectionLost,
    dispose(): void { alive = false; epoch++ }
  }
}
