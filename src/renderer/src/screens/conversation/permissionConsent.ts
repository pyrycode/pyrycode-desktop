import type { ModalPrompt } from '../../store/modalPrompts'
import { hasSessionPermission } from './modalResolution'

/** Observe continuous offers independently of pane lifetime; never persist this memory. */
export function createPermissionConsent(
  read: () => readonly { prompt: ModalPrompt; serverId: string | null }[],
  subscribe: (changed: () => void) => () => void
) {
  const checked = new Map<string, { prompt: ModalPrompt; serverId: string }>()
  const valid = (prompt: ModalPrompt, previous: ModalPrompt) =>
    hasSessionPermission(prompt, previous) && prompt.options === previous.options
      && prompt.defaultOptionId === previous.defaultOptionId
  const refresh = () => {
    const held = read()
    for (const [id, grant] of checked) {
      const now = held.find(entry => entry.prompt.modalId === id)
      if (!now || now.serverId !== grant.serverId || !valid(now.prompt, grant.prompt)) checked.delete(id)
    }
  }
  const off = subscribe(refresh)
  return {
    get(prompt: ModalPrompt | undefined, serverId: string | null): ModalPrompt | null {
      if (!prompt || serverId === null) return null
      const grant = checked.get(prompt.modalId)
      return grant?.serverId === serverId && valid(prompt, grant.prompt) ? grant.prompt : null
    },
    set(prompt: ModalPrompt, serverId: string | null, value: boolean) {
      const held = read().find(entry => entry.prompt === prompt && entry.serverId === serverId)
      if (!held || serverId === null || prompt.class !== 'permission' || prompt.alwaysAllow?.offered !== true) return
      if (value) checked.set(prompt.modalId, { prompt, serverId })
      else checked.delete(prompt.modalId)
    },
    dispose() { off(); checked.clear() }
  }
}
