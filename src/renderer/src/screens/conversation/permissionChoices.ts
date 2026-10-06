import { createStore } from 'zustand/vanilla'
import type { ModalPrompt } from '../../store/modalPrompts'
import { answerPrompt, cancelPrompt, confirmPrompt, hasSessionPermission, type ModalResolveDeps } from './modalResolution'

/** Consent is local to one pane, but observes every store transition before React batching. */
export function createPermissionChoices(
  read: () => { prompt: ModalPrompt | undefined; serverId: string | null; available: boolean },
  subscribe: (changed: () => void) => () => void,
  deps: ModalResolveDeps & { report?: (code: 'armed' | 'consent-changed' | 'stale-or-unavailable' | 'invalid-choice' | 'ineligible-grant') => void }
) {
  const store = createStore<{ armedOptionId: string | null; opted: ModalPrompt | null }>(() =>
    ({ armedOptionId: null, opted: null }))
  let previous = read()
  let active = false
  const clear = () => {
    const state = store.getState()
    if (state.armedOptionId !== null || state.opted !== null) store.setState({ armedOptionId: null, opted: null })
  }
  const refresh = () => {
    const next = read()
    const a = previous.prompt, b = next.prompt
    if (!a || !b || previous.serverId !== next.serverId || a.modalId !== b.modalId
      || a.conversationId !== b.conversationId || a.class !== b.class
      || a.defaultOptionId !== b.defaultOptionId || a.options !== b.options || a.alwaysAllow !== b.alwaysAllow) clear()
    previous = next
    return next
  }
  const current = (displayed: ModalPrompt) => {
    const now = refresh()
    const valid = active && now.prompt === displayed && now.serverId !== null && now.available
    if (!valid) deps.report?.('stale-or-unavailable')
    return valid
  }
  return {
    store,
    start() {
      active = true
      refresh()
      const off = subscribe(refresh)
      return () => { active = false; off(); clear() }
    },
    activate(displayed: ModalPrompt, optionId: string) {
      if (!current(displayed)) return
      if (!displayed.options.some(o => o.id === optionId)) { deps.report?.('invalid-choice'); return }
      if (optionId === displayed.defaultOptionId) {
        clear()
        answerPrompt(displayed.modalId, optionId, deps)
      } else if (store.getState().armedOptionId === optionId) {
        const opted = store.getState().opted
        clear()
        confirmPrompt(displayed, { modalId: displayed.modalId, optionId }, opted, deps)
      } else {
        store.setState({ armedOptionId: optionId })
        deps.report?.('armed')
      }
    },
    toggle(displayed: ModalPrompt, checked: boolean) {
      if (!current(displayed)) return
      if (displayed.class !== 'permission' || displayed.alwaysAllow?.offered !== true) { deps.report?.('ineligible-grant'); return }
      store.setState({ opted: checked ? displayed : null })
      deps.report?.('consent-changed')
    },
    cancel(displayed: ModalPrompt) {
      if (!current(displayed)) return
      clear()
      cancelPrompt(displayed.modalId, deps)
    },
    checked(displayed: ModalPrompt | undefined) { return hasSessionPermission(displayed, store.getState().opted) }
  }
}
