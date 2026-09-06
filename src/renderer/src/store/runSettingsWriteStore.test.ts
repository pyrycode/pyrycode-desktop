import { describe, it, expect } from 'vitest'
import {
  createRunSettingsWriteStore,
  initialRunSettingsWriteState,
  selectEffectiveSettings,
  selectError,
  selectPendingFields,
  type RunSettingsWriteState,
  type SettingsChange
} from './runSettingsWriteStore'
import type { RunConfigSnapshot } from './runConfigStore'

// Plain-function store tests over isolated createRunSettingsWriteStore() instances — the
// runConfigStore.test idiom. No React, no bridge: the store is pure renderer state driven by a
// sealed event union through one `dispatch`. The pure `selectEffectiveSettings` derivation is
// asserted directly against a fake snapshot, mirroring how #187 tests its data path in isolation.

const snap: RunConfigSnapshot = {
  model: 'sonnet',
  effort: 'low',
  yolo: false,
  permissionMode: 'default',
  usedTokens: 0,
  windowTokens: 0
}

const change = (c: SettingsChange): SettingsChange => c

describe('runSettingsWriteStore reducer', () => {
  it('starts empty: no pending, no confirmed overrides, no error', () => {
    const store = createRunSettingsWriteStore()
    const s = store.getState()
    expect(s.pending.size).toBe(0)
    expect(s.confirmed).toEqual({})
    expect(selectError(s)).toBeNull()
  })

  it('changeDispatched records the pending change and optimistically reflects it; confirmed + snapshot base unchanged; error cleared (AC1)', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    const s = store.getState()
    expect(s.pending.get('c1')).toEqual({ field: 'model', value: 'opus' })
    // Optimistic: the effective view shows the requested value...
    expect(selectEffectiveSettings(snap, s).model).toBe('opus')
    // ...while the last confirmed value is left unchanged (no override committed yet).
    expect(s.confirmed.model).toBeUndefined()
    expect(selectError(s)).toBeNull()
  })

  it('changeDispatched clears a prior rejection error (a fresh attempt supersedes it)', () => {
    const store = createRunSettingsWriteStore({
      pending: new Map(),
      confirmed: {},
      error: 'effort'
    })
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    expect(selectError(store.getState())).toBeNull()
  })

  it('settingsConfirmed with a matching changeId commits the SENT value into confirmed and clears the pending marker (AC2)', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'effort', value: 'high' })
    })
    store.getState().dispatch({ type: 'settingsConfirmed', changeId: 'c1' })
    const s = store.getState()
    expect(s.pending.has('c1')).toBe(false)
    expect(s.confirmed.effort).toBe('high')
    // The effective view still shows the value after the pending marker clears (now via confirmed).
    expect(selectEffectiveSettings(snap, s).effort).toBe('high')
  })

  it('settingsRejected with a matching changeId rolls the view back and raises the field error; no optimistic value survives (AC3)', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'yolo', value: true })
    })
    // Optimistic overlay is visible before rejection.
    expect(selectEffectiveSettings(snap, store.getState()).yolo).toBe(true)

    store.getState().dispatch({ type: 'settingsRejected', changeId: 'c1' })
    const s = store.getState()
    expect(s.pending.has('c1')).toBe(false)
    expect(s.confirmed.yolo).toBeUndefined()
    expect(selectError(s)).toBe('yolo')
    // Rolled back to the snapshot base (no optimistic value survives the failure).
    expect(selectEffectiveSettings(snap, s).yolo).toBe(false)
  })

  it('settingsConfirmed with a non-matching changeId is a no-op — no commit (AC4 fail-closed)', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    store.getState().dispatch({ type: 'settingsConfirmed', changeId: 'other' })
    const s = store.getState()
    expect(s.pending.has('c1')).toBe(true) // still pending — nothing resolved
    expect(s.confirmed.model).toBeUndefined() // nothing committed
    expect(selectError(s)).toBeNull()
  })

  it('settingsRejected with a non-matching changeId is a no-op — no rollback, error unchanged (AC4 fail-closed)', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    store.getState().dispatch({ type: 'settingsRejected', changeId: 'stale' })
    const s = store.getState()
    expect(s.pending.has('c1')).toBe(true)
    expect(selectError(s)).toBeNull()
    expect(selectEffectiveSettings(snap, s).model).toBe('opus') // overlay intact
  })

  it('tells two outstanding changes apart by changeId: confirming one resolves only its change (AC4)', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c2',
      change: change({ field: 'effort', value: 'high' })
    })
    store.getState().dispatch({ type: 'settingsConfirmed', changeId: 'c1' })
    const s = store.getState()
    expect(s.pending.has('c1')).toBe(false)
    expect(s.confirmed.model).toBe('opus')
    // The other change stays pending with its optimistic overlay intact.
    expect(s.pending.has('c2')).toBe(true)
    expect(selectEffectiveSettings(snap, s).effort).toBe('high')
    expect(s.confirmed.effort).toBeUndefined()
  })

  it('two outstanding changes to the SAME field: the effective view shows the last-dispatched value', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c2',
      change: change({ field: 'model', value: 'haiku' })
    })
    expect(selectEffectiveSettings(snap, store.getState()).model).toBe('haiku')
  })

  it('same-field changes resolve to the correct confirmed value regardless of resolution order', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c2',
      change: change({ field: 'model', value: 'haiku' })
    })
    // Resolve the FIRST-dispatched one first; the second's overlay must still win the view.
    store.getState().dispatch({ type: 'settingsConfirmed', changeId: 'c1' })
    expect(selectEffectiveSettings(snap, store.getState()).model).toBe('haiku')
    // Then resolve the second; confirmed lands haiku and no pending overlay remains.
    store.getState().dispatch({ type: 'settingsConfirmed', changeId: 'c2' })
    const s = store.getState()
    expect(s.confirmed.model).toBe('haiku')
    expect(s.pending.size).toBe(0)
    expect(selectEffectiveSettings(snap, s).model).toBe('haiku')
  })
})

describe('runSettingsWriteStore reconnected (#539)', () => {
  it('clears every outstanding pending entry, however many were in flight (AC1)', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c2',
      change: change({ field: 'effort', value: 'high' })
    })
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c3',
      change: change({ field: 'yolo', value: true })
    })
    // Precondition — without it this passes on a store that never recorded anything.
    expect(store.getState().pending.size).toBe(3)

    store.getState().dispatch({ type: 'reconnected' })
    expect(store.getState().pending.size).toBe(0)
  })

  it('rolls the display back to the last confirmed value — the rollback is by deletion, not a new mutation (AC3)', () => {
    const store = createRunSettingsWriteStore({
      pending: new Map([['c1', { field: 'model', value: 'opus' }]]),
      confirmed: { model: 'haiku' },
      error: null
    })
    expect(selectEffectiveSettings(snap, store.getState()).model).toBe('opus')

    store.getState().dispatch({ type: 'reconnected' })
    expect(selectEffectiveSettings(snap, store.getState()).model).toBe('haiku')
  })

  it('rolls back to the snapshot base when there is no confirmed override (AC3)', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'yolo', value: true })
    })
    expect(selectEffectiveSettings(snap, store.getState()).yolo).toBe(true)

    store.getState().dispatch({ type: 'reconnected' })
    expect(selectEffectiveSettings(snap, store.getState()).yolo).toBe(snap.yolo)
  })

  it('leaves confirmed and error untouched: a standing rejection is still true and a confirmed override is still what the daemon has (AC3)', () => {
    const store = createRunSettingsWriteStore({
      pending: new Map([['c1', { field: 'model', value: 'opus' }]]),
      confirmed: { effort: 'high' },
      error: 'yolo'
    })
    store.getState().dispatch({ type: 'reconnected' })
    const s = store.getState()
    expect(s.pending.size).toBe(0)
    expect(s.confirmed).toEqual({ effort: 'high' })
    expect(selectError(s)).toBe('yolo')
  })

  it('is a same-reference no-op when nothing is pending, even with a dirty confirmed + error (AC4)', () => {
    // The dirty-but-not-pending state is the case that pins the predicate on `pending.size` rather
    // than on the whole state being empty. #257 selects the WHOLE raw write state
    // (RunConfigSections.tsx:327), so the same reference is what suppresses the re-render.
    const store = createRunSettingsWriteStore({
      pending: new Map(),
      confirmed: { model: 'opus' },
      error: 'effort'
    })
    const before = store.getState()
    store.getState().dispatch({ type: 'reconnected' })
    expect(store.getState()).toBe(before)
  })

  it('is idempotent: a second reconnected returns the same reference as the first', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    store.getState().dispatch({ type: 'reconnected' })
    const cleared = store.getState()
    store.getState().dispatch({ type: 'reconnected' })
    expect(store.getState()).toBe(cleared)
  })

  it('does not latch the store: a change dispatched after the clear confirms normally', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({ type: 'reconnected' })
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'effort', value: 'high' })
    })
    store.getState().dispatch({ type: 'settingsConfirmed', changeId: 'c1' })
    const s = store.getState()
    expect(s.confirmed.effort).toBe('high')
    expect(s.pending.size).toBe(0)
  })

  it('the compounding regression: a change stranded by a reconnect cannot shadow a later confirmed one (AC2)', () => {
    // A base distinct from both changed values, so the effective read below can only come from
    // `confirmed` — never from the snapshot fallback.
    const base: RunConfigSnapshot = { ...snap, model: 'haiku' }
    const store = createRunSettingsWriteStore()
    // The user sets opus; the connection drops before the reply, so main abandons the correlation.
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    store.getState().dispatch({ type: 'reconnected' })
    // Later the user sets sonnet and the daemon confirms it.
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c2',
      change: change({ field: 'model', value: 'sonnet' })
    })
    store.getState().dispatch({ type: 'settingsConfirmed', changeId: 'c2' })
    expect(selectEffectiveSettings(base, store.getState()).model).toBe('sonnet')
    expect(store.getState().pending.size).toBe(0)

    // Cannot RESURFACE, not merely currently absent: a late reply for the stranded change hits the
    // no-match fail-closed guard and commits nothing.
    store.getState().dispatch({ type: 'settingsConfirmed', changeId: 'c1' })
    const s = store.getState()
    expect(selectEffectiveSettings(base, s).model).toBe('sonnet')
    expect(s.confirmed.model).toBe('sonnet')
  })
})

describe('selectEffectiveSettings composition', () => {
  it('precedence per field: pending overlay > confirmed override > snapshot base', () => {
    const state: RunSettingsWriteState = {
      pending: new Map([['c1', { field: 'model', value: 'pending-model' }]]),
      confirmed: { model: 'confirmed-model', effort: 'confirmed-effort' },
      error: null
    }
    const effective = selectEffectiveSettings(snap, state)
    expect(effective.model).toBe('pending-model') // pending wins over confirmed + base
    expect(effective.effort).toBe('confirmed-effort') // confirmed wins over base
    expect(effective.yolo).toBe(snap.yolo) // falls through to snapshot base
  })

  it('holds empty-string and yolo:false overrides verbatim — never coerced', () => {
    const state: RunSettingsWriteState = {
      pending: new Map(),
      confirmed: { model: '', yolo: false },
      error: null
    }
    const nonEmptyBase: RunConfigSnapshot = { ...snap, model: 'sonnet', yolo: true }
    const effective = selectEffectiveSettings(nonEmptyBase, state)
    expect(effective.model).toBe('') // '' override held, not fallen-through to the base
    expect(effective.yolo).toBe(false) // false override held, not fallen-through to the base
  })

  it('falls to empty-string / empty-string / false / empty-string when the snapshot is null', () => {
    const state: RunSettingsWriteState = { pending: new Map(), confirmed: {}, error: null }
    expect(selectEffectiveSettings(null, state)).toEqual({
      model: '',
      effort: '',
      yolo: false,
      permissionMode: ''
    })
  })

  it('RETURNS permissionMode composed pending > confirmed > base — not merely tolerates it (#1021)', () => {
    // The compiler forces a `case`, not a returned FIELD: a case that assigns a local and never threads
    // it into the return object would satisfy assertNever while leaving the overlay silently dead. These
    // three readings are what separate a returned field from a swallowed one.
    const base: RunConfigSnapshot = { ...snap, permissionMode: 'default' }

    const overlaid: RunSettingsWriteState = {
      pending: new Map([['c1', { field: 'permissionMode', value: 'plan' }]]),
      confirmed: { permissionMode: 'acceptEdits' },
      error: null
    }
    expect(selectEffectiveSettings(base, overlaid).permissionMode).toBe('plan')

    const confirmedOnly: RunSettingsWriteState = {
      pending: new Map(),
      confirmed: { permissionMode: 'acceptEdits' },
      error: null
    }
    expect(selectEffectiveSettings(base, confirmedOnly).permissionMode).toBe('acceptEdits')

    const neither: RunSettingsWriteState = { pending: new Map(), confirmed: {}, error: null }
    expect(selectEffectiveSettings(base, neither).permissionMode).toBe('default')
  })
})

describe('permissionMode round-trip (#1021)', () => {
  it('overlays optimistically, then commits the SENT value on the correlated confirm', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'permissionMode', value: 'plan' })
    })
    // Optimistic: pending beats the snapshot base before any reply.
    expect(selectEffectiveSettings(snap, store.getState()).permissionMode).toBe('plan')

    store.getState().dispatch({ type: 'settingsConfirmed', changeId: 'c1' })
    const s = store.getState()
    expect(s.pending.size).toBe(0)
    expect(s.confirmed.permissionMode).toBe('plan')
    // The overlay is gone but the value survives as the client-confirmed override.
    expect(selectEffectiveSettings(snap, s).permissionMode).toBe('plan')
  })

  it('rolls back to the snapshot base on rejection and reports the field through selectError', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'permissionMode', value: 'dontAsk' })
    })
    store.getState().dispatch({ type: 'settingsRejected', changeId: 'c1' })
    const s = store.getState()

    // Deleting the pending marker IS the rollback — the effective value falls back through.
    expect(s.pending.size).toBe(0)
    expect(s.confirmed.permissionMode).toBeUndefined()
    expect(selectEffectiveSettings(snap, s).permissionMode).toBe(snap.permissionMode)
    expect(selectError(s)).toBe('permissionMode')
  })

  it('holds a value outside the daemon closed five verbatim — the store normalises nothing', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'permissionMode', value: 'bypassPermissions' })
    })
    expect(selectEffectiveSettings(snap, store.getState()).permissionMode).toBe('bypassPermissions')
    // No mapping onto the yolo bit anywhere on the write path (AC3).
    expect(selectEffectiveSettings(snap, store.getState()).yolo).toBe(snap.yolo)
  })

  it('is cleared by reconnected along with every other pending field (#539 covers it for free)', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'permissionMode', value: 'plan' })
    })
    store.getState().dispatch({ type: 'reconnected' })
    expect(store.getState().pending.size).toBe(0)
    expect(selectEffectiveSettings(snap, store.getState()).permissionMode).toBe(snap.permissionMode)
  })
})

describe('selectPendingFields', () => {
  it('flags exactly the fields with an outstanding pending change', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c2',
      change: change({ field: 'yolo', value: true })
    })
    expect(selectPendingFields(store.getState())).toEqual({
      model: true,
      effort: false,
      yolo: true,
      permissionMode: false
    })
  })

  it('returns an in-flight flag for permissionMode, set and cleared like its siblings (#1021)', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'permissionMode', value: 'plan' })
    })
    expect(selectPendingFields(store.getState())).toEqual({
      model: false,
      effort: false,
      yolo: false,
      permissionMode: true
    })

    store.getState().dispatch({ type: 'settingsConfirmed', changeId: 'c1' })
    expect(selectPendingFields(store.getState()).permissionMode).toBe(false)
  })

  it('clears a field flag once its change resolves', () => {
    const store = createRunSettingsWriteStore()
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    store.getState().dispatch({ type: 'settingsConfirmed', changeId: 'c1' })
    expect(selectPendingFields(store.getState()).model).toBe(false)
  })
})

describe('runSettingsWriteStore conversationSwitched (#1167)', () => {
  it('drops pending, confirmed AND error together — every layer described the chat being left (AC1)', () => {
    const store = createRunSettingsWriteStore({
      pending: new Map([['c1', { field: 'model', value: 'opus' }]]),
      confirmed: { effort: 'high', yolo: true },
      error: 'permissionMode'
    })
    store.getState().dispatch({ type: 'conversationSwitched' })
    const s = store.getState()
    expect(s.pending.size).toBe(0)
    expect(s.confirmed).toEqual({})
    expect(selectError(s)).toBeNull()
  })

  it('reconnected on the SAME seeded state still preserves confirmed and error — the two arms pinned against each other (AC1)', () => {
    // The contrast case, and the reason it lives beside the arm rather than in the #539 block: the two
    // arms differ ONLY in what they preserve, and the reason is that a reconnect abandons correlations
    // for a session that is still the one being described, while a switch changes which session is
    // being described at all. An edit that collapses them into one clear reddens exactly here.
    const seed = (): RunSettingsWriteState => ({
      pending: new Map([['c1', { field: 'model', value: 'opus' }]]),
      confirmed: { effort: 'high', yolo: true },
      error: 'permissionMode'
    })
    const reconnected = createRunSettingsWriteStore(seed())
    reconnected.getState().dispatch({ type: 'reconnected' })
    expect(reconnected.getState().confirmed).toEqual({ effort: 'high', yolo: true })
    expect(selectError(reconnected.getState())).toBe('permissionMode')

    const switched = createRunSettingsWriteStore(seed())
    switched.getState().dispatch({ type: 'conversationSwitched' })
    expect(switched.getState().confirmed).toEqual({})
    expect(selectError(switched.getState())).toBeNull()
  })

  it('composes the NEXT chat’s snapshot verbatim afterwards — the detector for an arm that clears pending only (AC3)', () => {
    // The assertion that catches a partial clear. A `case` dropping only `pending` leaves `confirmed`
    // beating the base in selectEffectiveSettings, so the layered read is what has to be asserted —
    // reading `s.confirmed` alone would pass on an arm that cleared it while leaving `error` standing,
    // and reading `pending.size` alone would pass on the shipped defect itself.
    const store = createRunSettingsWriteStore({
      pending: new Map([['c1', { field: 'effort', value: 'brisk' }]]),
      confirmed: { model: 'opus', effort: 'deep', permissionMode: 'plan', yolo: true },
      error: 'model'
    })
    store.getState().dispatch({ type: 'conversationSwitched' })
    // `snap` here stands in for the newly opened chat's own reply: every field must be ITS value.
    expect(selectEffectiveSettings(snap, store.getState())).toEqual({
      model: snap.model,
      effort: snap.effort,
      yolo: snap.yolo,
      permissionMode: snap.permissionMode
    })
  })

  it('falls all the way through to the not-known rendering when no snapshot has arrived yet (AC3)', () => {
    // The state a freshly opened chat is actually in: cleared overrides over a NULL snapshot. `''`/
    // `false` is what makes the effort and permission-mode controls draw nothing at all — the
    // rendering the shipped defect made unreachable for every chat once any chat had set something.
    const store = createRunSettingsWriteStore({
      pending: new Map(),
      confirmed: { model: 'opus', effort: 'deep', permissionMode: 'plan', yolo: true },
      error: null
    })
    store.getState().dispatch({ type: 'conversationSwitched' })
    expect(selectEffectiveSettings(null, store.getState())).toEqual({
      model: '',
      effort: '',
      yolo: false,
      permissionMode: ''
    })
    expect(selectPendingFields(store.getState())).toEqual({
      model: false,
      effort: false,
      yolo: false,
      permissionMode: false
    })
  })

  it('is a same-reference no-op on an untouched store (AC4)', () => {
    // #257 selects the WHOLE raw write state, so this is what keeps a switch between two chats that
    // never wrote anything from re-rendering the sheet. The predicate spans all THREE fields here,
    // where reconnected's spans only `pending` — asserted below, one field at a time.
    const store = createRunSettingsWriteStore()
    const before = store.getState()
    store.getState().dispatch({ type: 'conversationSwitched' })
    expect(store.getState()).toBe(before)
  })

  it('is NOT a no-op when only confirmed, or only error, is dirty (AC1)', () => {
    // The pair that pins the early-out's predicate at three fields. With `pending.size === 0` alone as
    // the guard — reconnected's predicate, the obvious copy — both of these return early and the
    // durable half of the defect survives the switch untouched.
    const confirmedOnly = createRunSettingsWriteStore({
      pending: new Map(),
      confirmed: { effort: 'high' },
      error: null
    })
    confirmedOnly.getState().dispatch({ type: 'conversationSwitched' })
    expect(confirmedOnly.getState().confirmed).toEqual({})

    const errorOnly = createRunSettingsWriteStore({
      pending: new Map(),
      confirmed: {},
      error: 'yolo'
    })
    errorOnly.getState().dispatch({ type: 'conversationSwitched' })
    expect(selectError(errorOnly.getState())).toBeNull()
  })

  it('still records the next chat’s own change afterwards (#1167)', () => {
    // The clear is a lifetime move, not a latch: the store must accept the newly opened chat's first
    // write immediately after.
    const store = createRunSettingsWriteStore({
      pending: new Map(),
      confirmed: { effort: 'high' },
      error: null
    })
    store.getState().dispatch({ type: 'conversationSwitched' })
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c9',
      change: change({ field: 'effort', value: 'low' })
    })
    store.getState().dispatch({ type: 'settingsConfirmed', changeId: 'c9' })
    expect(store.getState().confirmed).toEqual({ effort: 'low' })
  })
})

describe('runSettingsWriteStore DI + independence', () => {
  it('seeds from an injected initial state', () => {
    const store = createRunSettingsWriteStore({
      pending: new Map([['c1', { field: 'effort', value: 'high' }]]),
      confirmed: { model: 'opus' },
      error: 'yolo'
    })
    const s = store.getState()
    expect(s.pending.get('c1')).toEqual({ field: 'effort', value: 'high' })
    expect(s.confirmed.model).toBe('opus')
    expect(selectError(s)).toBe('yolo')
  })

  it('keeps two stores independent', () => {
    const a = createRunSettingsWriteStore()
    const b = createRunSettingsWriteStore()
    a.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    expect(a.getState().pending.size).toBe(1)
    expect(b.getState().pending.size).toBe(0)
  })

  it('keeps the dispatch reference stable across updates', () => {
    const store = createRunSettingsWriteStore()
    const before = store.getState().dispatch
    store.getState().dispatch({
      type: 'changeDispatched',
      changeId: 'c1',
      change: change({ field: 'model', value: 'opus' })
    })
    expect(store.getState().dispatch).toBe(before)
  })

  it('initialRunSettingsWriteState is empty', () => {
    expect(initialRunSettingsWriteState.pending.size).toBe(0)
    expect(initialRunSettingsWriteState.confirmed).toEqual({})
    expect(initialRunSettingsWriteState.error).toBeNull()
  })
})
