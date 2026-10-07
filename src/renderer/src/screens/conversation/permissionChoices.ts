import { createStore } from 'zustand/vanilla'
import type { ModalPrompt } from '../../store/modalPrompts'
import { answerPrompt, cancelPrompt, confirmPrompt, hasSessionPermission, type ModalResolveDeps } from './modalResolution'
import type { createPermissionConsent } from './permissionConsent'

/** Pane-local arming with optional app-lifetime consent; observe transitions before React batching. */
export function createPermissionChoices(
  read: () => { prompt: ModalPrompt | undefined; serverId: string | null; available: boolean },
  subscribe: (changed: () => void) => () => void,
  deps: ModalResolveDeps & { report?: (code: 'armed' | 'consent-changed' | 'stale-or-unavailable' | 'invalid-choice' | 'ineligible-grant') => void },
  retained?: ReturnType<typeof createPermissionConsent>
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
    if (retained) {
      const opted = retained.get(next.prompt, next.serverId)
      if (store.getState().opted !== opted) store.setState({ opted })
    }
    return next
  }
  const current = (displayed: ModalPrompt, displayedServerId: string | null) => {
    const now = refresh()
    const valid = active && now.prompt === displayed && now.serverId !== null
      && now.serverId === displayedServerId && now.available
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
    activate(displayed: ModalPrompt, optionId: string, displayedServerId = previous.serverId) {
      if (!current(displayed, displayedServerId)) return
      if (!displayed.options.some(o => o.id === optionId)) { deps.report?.('invalid-choice'); return }
      if (optionId === displayed.defaultOptionId) {
        retained?.set(displayed, previous.serverId, false)
        clear()
        answerPrompt(displayed.modalId, optionId, deps)
      } else if (store.getState().armedOptionId === optionId) {
        const opted = store.getState().opted
        retained?.set(displayed, previous.serverId, false)
        clear()
        confirmPrompt(displayed, { modalId: displayed.modalId, optionId }, opted, deps)
      } else {
        store.setState({ armedOptionId: optionId })
        deps.report?.('armed')
      }
    },
    toggle(displayed: ModalPrompt, checked: boolean, displayedServerId = previous.serverId) {
      if (!current(displayed, displayedServerId)) return
      if (displayed.class !== 'permission' || displayed.alwaysAllow?.offered !== true) { deps.report?.('ineligible-grant'); return }
      store.setState({ opted: checked ? displayed : null })
      retained?.set(displayed, previous.serverId, checked)
      deps.report?.('consent-changed')
    },
    cancel(displayed: ModalPrompt, displayedServerId = previous.serverId) {
      if (!current(displayed, displayedServerId)) return
      retained?.set(displayed, previous.serverId, false)
      clear()
      cancelPrompt(displayed.modalId, deps)
    },
    checked(displayed: ModalPrompt | undefined) { return hasSessionPermission(displayed, store.getState().opted) }
  }
}
