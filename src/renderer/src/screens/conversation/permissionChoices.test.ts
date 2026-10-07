import { describe, it, expect, vi } from 'vitest'
import { createPermissionChoices } from './permissionChoices'
import { createPermissionConsent } from './permissionConsent'
import { initialModalState, reduceModal, type ModalPrompt } from '../../store/modalPrompts'

const prompt: ModalPrompt = { modalId: 'request', conversationId: 'chat', class: 'permission',
  title: 'Permission', prompt: 'Read?', defaultOptionId: 'reject_once',
  options: [{ id: 'allow_once', label: 'Allow' }, { id: 'reject_once', label: 'Reject' }],
  alwaysAllow: { offered: true, rules: ['Read(*)'] } }
function fixture() {
  let current = { prompt: prompt as ModalPrompt | undefined, serverId: 'host' as string | null, available: true }
  let transition = () => {}
  const sendCommand = vi.fn()
  const control = createPermissionChoices(() => current, fn => { transition = fn; return () => {} },
    { sendCommand, dispatch: event => {
      const state = reduceModal({ ...initialModalState, outstanding: current.prompt ? [current.prompt] : [] }, event)
      current = { ...current, prompt: state.outstanding[0] }; transition()
    } })
  const stop = control.start()
  return { control, sendCommand, stop, change(next: Partial<typeof current>) { current = { ...current, ...next }; transition() } }
}
describe('permission choices', () => {
  it('rejects captured host callbacks after ownership changes without prompt replacement', () => {
    const f = fixture()
    f.change({ serverId: 'other-host' })
    f.control.activate(prompt, 'reject_once', 'host')
    f.control.toggle(prompt, true, 'host')
    f.control.cancel(prompt, 'host')
    expect(f.sendCommand).not.toHaveBeenCalled()
    expect(f.control.store.getState().opted).toBeNull()
  })
  it('retains checked grants across disposed panes but needs two fresh activations', () => {
    let displayed = true
    let notify = () => {}
    const retained = createPermissionConsent(() => [{ prompt, serverId: 'host' }], () => () => {})
    const sendCommand = vi.fn()
    const pane = () => createPermissionChoices(() => ({ prompt: displayed ? prompt : undefined,
      serverId: 'host', available: true }), fn => { notify = fn; return () => {} },
      { sendCommand, dispatch: vi.fn() }, retained)
    const first = pane(), stop = first.start()
    first.toggle(prompt, true); first.activate(prompt, 'allow_once')
    displayed = false; notify(); stop()
    first.activate(prompt, 'allow_once'); first.toggle(prompt, false); first.cancel(prompt)
    expect(sendCommand).not.toHaveBeenCalled()
    displayed = true
    const next = pane(), finish = next.start()
    expect(next.checked(prompt)).toBe(true)
    expect(next.store.getState().armedOptionId).toBeNull()
    next.activate(prompt, 'allow_once')
    expect(sendCommand).not.toHaveBeenCalled()
    next.activate(prompt, 'allow_once')
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand.mock.calls[0][0].payload.always_allow).toBe(true)
    expect(retained.get(prompt, 'host')).toBeNull()
    finish(); retained.dispose()
  })
  it('defaults send once without grants; non-default requires the same choice twice', () => {
    const f = fixture()
    f.control.toggle(prompt, true)
    f.control.activate(prompt, 'allow_once')
    expect(f.sendCommand).not.toHaveBeenCalled()
    f.control.activate(prompt, 'allow_once')
    f.control.activate(prompt, 'allow_once')
    expect(f.sendCommand).toHaveBeenCalledTimes(1)
    expect(f.sendCommand.mock.calls[0][0].payload).toMatchObject({ option_id: 'allow_once', always_allow: true })
    const d = fixture()
    d.control.toggle(prompt, true)
    d.control.activate(prompt, 'reject_once')
    expect(d.sendCommand).toHaveBeenCalledTimes(1)
    expect(d.sendCommand.mock.calls[0][0].payload).not.toHaveProperty('always_allow')
  })
  it('changing non-default arms afresh and toggling neither arms nor answers', () => {
    const f = fixture()
    const supplied = { ...prompt, options: [...prompt.options, { id: 'allow_always', label: 'Always' }] }
    f.change({ prompt: supplied })
    f.control.toggle(supplied, true)
    expect(f.control.store.getState().armedOptionId).toBeNull()
    f.control.activate(supplied, 'allow_once')
    f.control.toggle(supplied, false)
    expect(f.control.store.getState().armedOptionId).toBe('allow_once')
    f.control.activate(supplied, 'allow_always')
    expect(f.sendCommand).not.toHaveBeenCalled()
    f.control.activate(supplied, 'allow_always')
    expect(f.sendCommand.mock.calls[0][0].payload).not.toHaveProperty('always_allow')
  })
  it('a checked affirmative default responds on one activation without a grant', () => {
    const f = fixture(), supplied = { ...prompt, defaultOptionId: 'allow_once' }
    f.change({ prompt: supplied }); f.control.toggle(supplied, true); f.control.activate(supplied, 'allow_once')
    expect(f.sendCommand).toHaveBeenCalledTimes(1)
    expect(f.sendCommand.mock.calls[0][0].payload).not.toHaveProperty('always_allow')
  })
  it.each(['options', 'default', 'class', 'offer', 'owner', 'navigation'])(
    'change then restoration of %s loses arm and consent before a render', kind => {
      const f = fixture()
      f.control.toggle(prompt, true)
      f.control.activate(prompt, 'allow_once')
      const changed = { ...prompt, ...(kind === 'options' ? { options: [...prompt.options].reverse() }
        : kind === 'default' ? { defaultOptionId: 'allow_once' }
          : kind === 'class' ? { class: 'trust' as const }
            : kind === 'offer' ? { alwaysAllow: undefined } : {}) }
      f.change(kind === 'owner' ? { serverId: null } : { prompt: kind === 'navigation' ? undefined : changed })
      f.change({ prompt, serverId: 'host' })
      expect(f.control.store.getState()).toEqual({ armedOptionId: null, opted: null })
      f.control.activate(prompt, 'allow_once')
      expect(f.sendCommand).not.toHaveBeenCalled()
    })
  it('rejects stale answer, checkbox, Cancel, offline and disposed callbacks', () => {
    const f = fixture()
    f.change({ prompt: { ...prompt, modalId: 'replacement' } })
    f.control.activate(prompt, 'reject_once'); f.control.toggle(prompt, true); f.control.cancel(prompt)
    expect(f.control.store.getState().opted).toBeNull()
    f.change({ prompt, available: false })
    f.control.activate(prompt, 'reject_once'); f.control.toggle(prompt, true); f.control.cancel(prompt)
    f.change({ available: true }); f.stop(); f.control.activate(prompt, 'reject_once')
    expect(f.sendCommand).not.toHaveBeenCalled()
  })
  it('reducer preserves identical options/offer but breaks both consent identities on ordered changes', () => {
    const shown = { type: 'shown' as const, ...prompt }
    const first = reduceModal(initialModalState, shown)
    const same = reduceModal(first, { ...shown, options: prompt.options.map(o => ({ ...o })), description: 'Updated context' })
    expect(same.outstanding[0].options).toBe(first.outstanding[0].options)
    expect(same.outstanding[0].alwaysAllow).toBe(first.outstanding[0].alwaysAllow)
    for (const over of [{ options: [...prompt.options].reverse() }, { defaultOptionId: 'allow_once' },
      { options: prompt.options.map(o => ({ ...o, label: 'Changed' })) }, { class: 'trust' as const }]) {
      const changed = reduceModal(first, { ...shown, ...over })
      const restored = reduceModal(changed, shown)
      expect(restored.outstanding[0].alwaysAllow).not.toBe(first.outstanding[0].alwaysAllow)
      expect(restored.outstanding[0].options).not.toBe(first.outstanding[0].options)
    }
  })
})
