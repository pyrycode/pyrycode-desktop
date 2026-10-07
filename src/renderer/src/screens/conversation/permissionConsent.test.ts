import { describe, it, expect } from 'vitest'
import { createPermissionConsent } from './permissionConsent'
import { initialModalState, reduceModal, type ModalPrompt } from '../../store/modalPrompts'

const prompt: ModalPrompt = { modalId: 'request', conversationId: 'chat', class: 'permission',
  title: 'Permission', prompt: 'Read?', defaultOptionId: 'reject_once',
  options: [{ id: 'allow_once', label: 'Allow' }, { id: 'reject_once', label: 'Reject' }],
  alwaysAllow: { offered: true, rules: ['Read(*)', 'Bash(*)'] } }
function fixture() {
  let state = reduceModal(initialModalState, { type: 'shown', ...prompt })
  let owner: string | null = 'host'
  let changed = () => {}
  const consent = createPermissionConsent(() => state.outstanding.map(prompt => ({ prompt, serverId: owner })),
    fn => { changed = fn; return () => {} })
  const held = () => state.outstanding[0]
  consent.set(held(), owner, true)
  return { consent, held, change(over: Partial<ModalPrompt>) {
    state = reduceModal(state, { type: 'shown', ...prompt, ...over }); changed()
  }, owner(value: string | null) { owner = value; changed() }, clear(type: 'reset' | 'reconnected') {
    state = reduceModal(state, type === 'reset' ? { type } : { type, conversationIds: new Set(['chat']) }); changed()
  } }
}
describe('navigation-retained permission consent', () => {
  it('retains content-only delivery, refusing a stale checkbox callback', () => {
    const f = fixture(), original = f.held()
    f.change({ description: 'New context' })
    expect(f.consent.get(f.held(), 'host')).toBe(original)
    f.consent.set(original, 'host', false)
    expect(f.consent.get(f.held(), 'host')).toBe(original)
    expect(f.consent.get(f.held(), 'other-host')).toBeNull()
    f.consent.dispose()
  })
  it.each([
    { options: [...prompt.options].reverse() },
    { options: prompt.options.map(o => ({ ...o, label: 'Changed' })) },
    { options: [{ id: 'allow_always', label: 'Allow' }] },
    { defaultOptionId: 'allow_once' }, { class: 'trust' as const },
    { alwaysAllow: undefined }, { alwaysAllow: { offered: false, rules: [] } },
    { alwaysAllow: { offered: true, rules: [...prompt.alwaysAllow!.rules].reverse() } },
    { conversationId: 'replacement' }
  ])('evicts changed identity before restoration without a mounted pane: %j', over => {
    const f = fixture()
    f.change(over); f.change({})
    expect(f.consent.get(f.held(), 'host')).toBeNull()
    f.consent.dispose()
  })
  it.each([null, 'other-host'])('evicts loss/change of unique owner even when restored: %s', owner => {
    const f = fixture()
    f.owner(owner); f.owner('host')
    expect(f.consent.get(f.held(), 'host')).toBeNull()
    f.consent.dispose()
  })
  it.each(['reset', 'reconnected'] as const)('evicts %s even before restoration renders', type => {
    const f = fixture()
    f.clear(type); f.change({})
    expect(f.consent.get(f.held(), 'host')).toBeNull()
    f.consent.dispose()
  })
})
