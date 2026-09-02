import { describe, it, expect } from 'vitest'
import type { WireSlashCommand } from '@shared/wire/types'
import {
  createSlashCommandListStore,
  selectSlashCommandListFor,
  initialSlashCommandListState
} from './slashCommandListStore'

// Rows carry the shapes the wire capture actually measured, so no test passes on a tidier menu than
// the daemon sends: an empty `argument_hint` (33 of the capture's 51 entries), an empty `aliases`
// (42 of 51), a `truncated_fields: null` beside a row reporting a cut `description`, the
// hand-authored `truncated_fields: ['aliases']` case (no committed fixture carries one), and a name
// with a leading underscore — `name` is NOT an identifier, so nothing may assume a charset.
const clear: WireSlashCommand = {
  name: 'clear',
  argument_hint: '',
  description: 'Clear conversation history and free up context',
  aliases: ['reset'],
  truncated_fields: null
}

const claudeApi: WireSlashCommand = {
  name: 'claude-api',
  argument_hint: '<model>',
  description: 'Send a request through the API',
  aliases: [],
  truncated_fields: ['description']
}

const remoteWorkflow: WireSlashCommand = {
  name: '__remote-workflow',
  argument_hint: '',
  description: 'Run the workspace remote workflow',
  aliases: [],
  // `[]` and `null` are DIFFERENT values on this field; both appear here so a collapse in either
  // direction reddens.
  truncated_fields: []
}

const compact: WireSlashCommand = {
  name: 'compact',
  argument_hint: '[instructions]',
  description: 'Compact the conversation',
  // A cut `aliases` is unknowable from `aliases` alone — the wire collapses absent and empty into
  // `[]`, so this row's `truncated_fields` is the only signal separating "cut to nothing" from
  // "none". The store must carry it through untouched for #681 to read it as UNKNOWN.
  aliases: [],
  truncated_fields: ['aliases']
}

describe('slashCommandListStore', () => {
  it('holds one conversation’s published menu, readable through the selector (AC1)', () => {
    const store = createSlashCommandListStore()
    store.getState().setSlashCommandList({
      conversationId: 'conv-1',
      commands: [clear, claudeApi],
      droppedCommands: 2
    })

    expect(selectSlashCommandListFor('conv-1')(store.getState())).toEqual({
      commands: [clear, claudeApi],
      droppedCommands: 2
    })
  })

  it('leaves every other conversation untouched, by reference (AC1)', () => {
    const store = createSlashCommandListStore()
    store
      .getState()
      .setSlashCommandList({ conversationId: 'conv-1', commands: [clear], droppedCommands: 0 })
    const beforeA = selectSlashCommandListFor('conv-1')(store.getState())

    store
      .getState()
      .setSlashCommandList({ conversationId: 'conv-2', commands: [compact], droppedCommands: 7 })

    // Not merely equal: the SAME entry object, so a component watching conv-1 sees `Object.is` true
    // and does not re-render on a write for conv-2.
    expect(selectSlashCommandListFor('conv-1')(store.getState())).toBe(beforeA)
    expect(selectSlashCommandListFor('conv-2')(store.getState())).toEqual({
      commands: [compact],
      droppedCommands: 7
    })
  })

  it('replaces a conversation’s menu wholesale — nothing merges (AC1)', () => {
    const store = createSlashCommandListStore()
    store.getState().setSlashCommandList({
      conversationId: 'conv-1',
      commands: [clear, claudeApi],
      droppedCommands: 4
    })
    store.getState().setSlashCommandList({
      conversationId: 'conv-1',
      commands: [compact],
      droppedCommands: 0
    })

    // The frame is a SNAPSHOT of what this session in this working directory will accept, never a
    // delta: a row present only in the first frame is gone, and the drop count follows the newest
    // frame rather than accumulating.
    expect(selectSlashCommandListFor('conv-1')(store.getState())).toEqual({
      commands: [compact],
      droppedCommands: 0
    })
  })

  it('reads null for a conversation no frame has arrived for, and an empty ENTRY for one that published nothing (AC2)', () => {
    const store = createSlashCommandListStore()
    store.getState().setSlashCommandList({
      conversationId: 'published-nothing',
      commands: [],
      droppedCommands: 0
    })

    // The two states in one test so neither assertion can pass vacuously. `commands: []` is a
    // POSITIVE STATEMENT that claude offered nothing (#681 greys the fixed entries out); an absent
    // key is UNKNOWN (#681 must grey nothing out). They must never both surface as a bare empty list.
    expect(selectSlashCommandListFor('never-arrived')(store.getState())).toBeNull()
    const published = selectSlashCommandListFor('published-nothing')(store.getState())
    expect(published).not.toBeNull()
    expect(published).toEqual({ commands: [], droppedCommands: 0 })
  })

  it('an empty list still carries the frame’s own drop count (AC2, AC4)', () => {
    const store = createSlashCommandListStore()
    // Every row cut: the menu is not empty, it is entirely dropped. A store that treated an empty
    // list as "no news" would lose the count that says so.
    store
      .getState()
      .setSlashCommandList({ conversationId: 'conv-1', commands: [], droppedCommands: 51 })

    expect(selectSlashCommandListFor('conv-1')(store.getState())).toEqual({
      commands: [],
      droppedCommands: 51
    })
  })

  it('holds the rows VERBATIM — the same array and the same row objects (AC4)', () => {
    const store = createSlashCommandListStore()
    const commands = [clear, claudeApi, remoteWorkflow, compact]
    store.getState().setSlashCommandList({ conversationId: 'conv-1', commands, droppedCommands: 0 })

    const entry = selectSlashCommandListFor('conv-1')(store.getState())
    // Identity, not equality. No per-row mapping exists on this path, which is what makes "nothing
    // is normalised, lowercased, trimmed or shape-checked" true BY CONSTRUCTION rather than by a
    // guard. This assertion is the whole defence against someone introducing one later.
    expect(entry?.commands).toBe(commands)
    expect(entry?.commands[0]).toBe(clear)
    expect(entry?.commands[3]).toBe(compact)
  })

  it('keeps each row’s own truncated_fields — null never collapsed into [], nothing hoisted across rows (AC4)', () => {
    const store = createSlashCommandListStore()
    store.getState().setSlashCommandList({
      conversationId: 'conv-1',
      commands: [clear, claudeApi, remoteWorkflow, compact],
      droppedCommands: 0
    })

    const rows = selectSlashCommandListFor('conv-1')(store.getState())?.commands ?? []
    expect(rows.map((row) => row.truncated_fields)).toEqual([
      null, // nothing was cut for this row
      ['description'],
      [], // a DISTINCT value from null
      ['aliases'] // the only signal that this row's empty `aliases` means UNKNOWN, not "none"
    ])
    // No flattened "something was truncated" list anywhere on the entry: a hoisted list would be one
    // no reader could attribute back to the row it describes.
    expect(selectSlashCommandListFor('conv-1')(store.getState())).toEqual({
      commands: [clear, claudeApi, remoteWorkflow, compact],
      droppedCommands: 0
    })
  })

  it('holds every string field and every alias untouched (AC4)', () => {
    const store = createSlashCommandListStore()
    store
      .getState()
      .setSlashCommandList({ conversationId: 'conv-1', commands: [clear], droppedCommands: 0 })

    const [row] = selectSlashCommandListFor('conv-1')(store.getState())?.commands ?? []
    expect(row).toEqual({
      name: 'clear',
      argument_hint: '',
      description: 'Clear conversation history and free up context',
      // `reset` is an ALIAS of `clear`, not a command name — the exact case #681's Actions-menu
      // match depends on, so each alias string must survive verbatim.
      aliases: ['reset'],
      truncated_fields: null
    })
  })

  it('holds droppedCommands: 0 as a VALUE, never as an absence (AC4)', () => {
    const store = createSlashCommandListStore()
    store.getState().setSlashCommandList({
      conversationId: 'conv-1',
      commands: [clear, claudeApi],
      droppedCommands: 0
    })

    const entry = selectSlashCommandListFor('conv-1')(store.getState())
    expect(entry?.droppedCommands).toBe(0)
    // The menu's true size is `commands.length + droppedCommands`, and the store carries both
    // numbers so a consumer can compute it. Nothing here recomputes the count from the row count.
    expect((entry?.commands.length ?? 0) + (entry?.droppedCommands ?? 0)).toBe(2)
  })

  it('starts empty and is copy-on-write — no map is mutated in place', () => {
    const store = createSlashCommandListStore()
    expect(store.getState().menus.size).toBe(0)
    expect(initialSlashCommandListState.menus.size).toBe(0)

    const beforeMap = store.getState().menus
    store
      .getState()
      .setSlashCommandList({ conversationId: 'conv-1', commands: [clear], droppedCommands: 0 })

    expect(store.getState().menus).not.toBe(beforeMap)
    expect(beforeMap.size).toBe(0)
    // The exported initial state is shared by every instance, so a setter that mutated it would leak
    // one test's menu into the next store.
    expect(initialSlashCommandListState.menus.size).toBe(0)
  })

  it('clears EVERY conversation’s menu at once, each reading back as absent (#955 AC1, AC3)', () => {
    const store = createSlashCommandListStore()
    store
      .getState()
      .setSlashCommandList({ conversationId: 'conv-1', commands: [clear], droppedCommands: 2 })
    store.getState().setSlashCommandList({
      conversationId: 'conv-2',
      commands: [claudeApi, remoteWorkflow],
      droppedCommands: 0
    })

    store.getState().clearAllSlashCommandLists()

    expect(store.getState().menus.size).toBe(0)
    // ABSENT, not an observed-empty entry: the selector's two readings stay apart across the clear,
    // so a surface that has not yet been told anything about the new pairing reads UNKNOWN rather
    // than "the new daemon published nothing".
    expect(selectSlashCommandListFor('conv-1')(store.getState())).toBeNull()
    expect(selectSlashCommandListFor('conv-2')(store.getState())).toBeNull()
    // By reference, not a fresh empty map: every cleared state holds the SAME `menus`, so a
    // whole-map selector is `Object.is`-true across two clears from different starting states.
    expect(store.getState().menus).toBe(initialSlashCommandListState.menus)
  })

  it('clearing an already-clear store notifies NO subscriber (#955 AC4)', () => {
    const store = createSlashCommandListStore()
    const stateBefore = store.getState()
    let notified = 0
    const unsubscribe = store.subscribe(() => {
      notified += 1
    })

    store.getState().clearAllSlashCommandLists()
    unsubscribe()

    // The state OBJECT comes straight back, so zustand's `Object.is(next, state)` short-circuit
    // fires and no listener runs at all. That is what the `size === 0` guard buys and a bare
    // `set(initialSlashCommandListState)` would not: it would allocate a new state object, and only
    // a SELECTOR would then short-circuit. A raw subscriber is the only shape that tells the two
    // apart, which is why this asserts through one.
    expect(store.getState()).toBe(stateBefore)
    expect(notified).toBe(0)
  })

  it('the clear never poisons the shared initial state, and leaves the store usable (#955 AC1)', () => {
    // The hazard `clearAllActivity` pays a fresh `Map` to avoid and this store answers by test:
    // `initialSlashCommandListState.menus` is module-shared, so a writer that ever mutated held
    // state in place would leak one pairing's workspace-authored rows into every store instance
    // that had cleared — with no type error and no other failing test.
    const first = createSlashCommandListStore()
    first
      .getState()
      .setSlashCommandList({ conversationId: 'conv-1', commands: [clear], droppedCommands: 1 })
    first.getState().clearAllSlashCommandLists()

    expect(initialSlashCommandListState.menus.size).toBe(0)

    const second = createSlashCommandListStore()
    expect(second.getState().menus.size).toBe(0)
    expect(selectSlashCommandListFor('conv-1')(second.getState())).toBeNull()

    // A cleared store is empty, not wedged: the next pairing's first frame lands normally and lands
    // only under its own key.
    second
      .getState()
      .setSlashCommandList({ conversationId: 'conv-9', commands: [compact], droppedCommands: 0 })

    expect(selectSlashCommandListFor('conv-9')(second.getState())).toEqual({
      commands: [compact],
      droppedCommands: 0
    })
    expect(second.getState().menus.size).toBe(1)
    expect(initialSlashCommandListState.menus.size).toBe(0)
  })

  it('accepts a seeded initial state (the DI factory)', () => {
    const store = createSlashCommandListStore({
      menus: new Map([['conv-1', { commands: [clear], droppedCommands: 3 }]])
    })

    expect(selectSlashCommandListFor('conv-1')(store.getState())).toEqual({
      commands: [clear],
      droppedCommands: 3
    })
    expect(selectSlashCommandListFor('conv-2')(store.getState())).toBeNull()
  })
})
