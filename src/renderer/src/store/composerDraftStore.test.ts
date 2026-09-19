import { describe, expect, it } from 'vitest'
import { createComposerDraftStore, selectDraft } from './composerDraftStore'

describe('session composer drafts', () => {
  it('retains exact text independently for conversations and hosts', () => {
    const store = createComposerDraftStore()
    const { setDraft } = store.getState()
    setDraft('host-a', 'channel', '  first\n\nlast \n')
    setDraft('host-a', 'chat', '\nsecond\t ')
    setDraft('host-b', 'channel', 'other host')
    expect(selectDraft(store.getState(), 'host-a', 'channel')).toBe('  first\n\nlast \n')
    expect(selectDraft(store.getState(), 'host-a', 'chat')).toBe('\nsecond\t ')
    expect(selectDraft(store.getState(), 'host-b', 'channel')).toBe('other host')
    expect(selectDraft(store.getState(), 'host-b', 'chat')).toBe('')
  })

  it('retains edits and removes only the emptied draft', () => {
    const store = createComposerDraftStore()
    const { setDraft } = store.getState()
    setDraft('host', 'one', 'first')
    setDraft('host', 'two', 'untouched')
    setDraft('host', 'one', 'edited\n\n')
    expect(selectDraft(store.getState(), 'host', 'one')).toBe('edited\n\n')
    setDraft('host', 'one', '')
    expect(selectDraft(store.getState(), 'host', 'one')).toBe('')
    expect(selectDraft(store.getState(), 'host', 'two')).toBe('untouched')
    expect(store.getState().drafts.get('host')?.has('one')).toBe(false)
    setDraft('host', 'two', '')
    expect(store.getState().drafts.has('host')).toBe(false)
  })

  it('does not collide on separators or object-property names', () => {
    const store = createComposerDraftStore()
    store.getState().setDraft('a:b', 'c', 'first')
    store.getState().setDraft('a', 'b:c', 'second')
    store.getState().setDraft('__proto__', 'constructor', 'third')
    expect(selectDraft(store.getState(), 'a:b', 'c')).toBe('first')
    expect(selectDraft(store.getState(), 'a', 'b:c')).toBe('second')
    expect(selectDraft(store.getState(), '__proto__', 'constructor')).toBe('third')
  })

  it('has no anonymous draft and does not carry text into a new app session', () => {
    const store = createComposerDraftStore()
    store.getState().setDraft('host', 'chat', 'session draft')
    expect(selectDraft(store.getState(), null, 'chat')).toBe('')
    expect(selectDraft(store.getState(), 'host', null)).toBe('')
    expect(selectDraft(createComposerDraftStore().getState(), 'host', 'chat')).toBe('')
  })

  it('keeps unrelated selections stable on edits', () => {
    const store = createComposerDraftStore()
    store.getState().setDraft('host-a', 'one', 'held')
    const before = store.getState().drafts.get('host-a')
    store.getState().setDraft('host-b', 'one', 'edited')
    expect(store.getState().drafts.get('host-a')).toBe(before)
    expect(selectDraft(store.getState(), 'host-a', 'one')).toBe('held')
  })
})
