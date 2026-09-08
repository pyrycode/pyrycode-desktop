import { describe, it, expect } from 'vitest'
import {
  createAnnouncedModelStore,
  initialAnnouncedModelState,
  selectAnnouncedModelFor,
  type AnnouncedModel,
  type AnnouncedModelSnapshot
} from './announcedModelStore'

// Plain-function store tests over isolated createAnnouncedModelStore() instances — the
// runConfigStore.test idiom. No React, no bridge: the store is pure renderer
// state with a single set-on-event mutation. `model` is held VERBATIM (untrusted, model-influenced
// daemon-relayed text; the plain-text-never-HTML rendering discipline belongs to #560) — no normalising,
// no lowercasing, no allow-list, no family regex, no shape check.
//
// #1146 keyed the map by `conversationId`, so every case below reads back through a selector bound to
// one id. Two things follow for a reader of this file. The per-key contracts are the SAME contracts
// #588 / #593 shipped — a later announcement replaces with no merge, a verbatim repeat is written
// again, `{ model: '', truncated: false }` is a real record — restated per key rather than rewritten.
// And the hostile-key reads near the bottom are the whole defence for the `ReadonlyMap` mandate: a swap
// to `Record<string, …>` produces no type error and breaks no other assertion in this file.

const CONV = 'conv-1'

const snapshot = (over: Partial<AnnouncedModelSnapshot> = {}): AnnouncedModelSnapshot => ({
  conversationId: CONV,
  model: 'claude-haiku-4-5-20251001',
  truncated: false,
  ...over
})

/** Read one conversation's announcement — the only read surface. */
const announcedFor = (
  store: ReturnType<typeof createAnnouncedModelStore>,
  conversationId: string
): AnnouncedModel | null => selectAnnouncedModelFor(conversationId)(store.getState())

describe('announcedModelStore', () => {
  it('starts not-yet-announced — every conversation reads null (AC1)', () => {
    const store = createAnnouncedModelStore()
    expect(store.getState().announced.size).toBe(0)
    expect(announcedFor(store, CONV)).toBeNull()
  })

  it('setAnnouncedModel records the announcement; the selector returns it (AC1)', () => {
    const store = createAnnouncedModelStore()
    store.getState().setAnnouncedModel(snapshot())
    expect(announcedFor(store, CONV)).toEqual({
      model: 'claude-haiku-4-5-20251001',
      truncated: false
    })
  })

  it('a later announcement wholly replaces that id’s record — no merge (AC2)', () => {
    const store = createAnnouncedModelStore()
    store.getState().setAnnouncedModel(snapshot({ model: 'old-model', truncated: true }))
    store.getState().setAnnouncedModel(snapshot({ model: 'new-model', truncated: false }))
    expect(announcedFor(store, CONV)).toEqual({
      model: 'new-model',
      truncated: false
    })
  })

  it('writes a verbatim repeat again rather than deduping it (AC2)', () => {
    const store = createAnnouncedModelStore()
    store.getState().setAnnouncedModel(snapshot({ model: 'same-model' }))
    const first = announcedFor(store, CONV)
    store.getState().setAnnouncedModel(snapshot({ model: 'same-model' }))
    const second = announcedFor(store, CONV)
    expect(second).toEqual(first)
    expect(second).toEqual({ model: 'same-model', truncated: false })
  })

  it('holds an empty identifier as a REAL record, not an absent key (AC2)', () => {
    const store = createAnnouncedModelStore()
    store.getState().setAnnouncedModel(snapshot({ model: '' }))
    const held = announcedFor(store, CONV)
    expect(held).not.toBeNull()
    expect(held?.model).toBe('')
    expect(held).toEqual({ model: '', truncated: false })
  })

  it('holds an identifier that appears in no published model list byte-for-byte (AC1)', () => {
    const store = createAnnouncedModelStore()
    // claude echoes an identifier at least as specific as the one it was given: `claude-haiku-4-5`
    // announces back undated and appears in no published list. A lookup miss is #560's ordinary case;
    // the store must not date-stamp, family-map, or allow-list it away.
    store.getState().setAnnouncedModel(snapshot({ model: 'claude-haiku-4-5' }))
    expect(announcedFor(store, CONV)?.model).toBe('claude-haiku-4-5')
  })

  it('holds mixed case, underscores, dots and a control character byte-for-byte (AC1)', () => {
    const store = createAnnouncedModelStore()
    // No normalising and no lowercasing. The control character / terminal escape is held as-is because
    // the escaping obligation belongs to the DOM sink (#560), not to this holder.
    const raw = 'Claude_Opus.4-5_BETA\u001b[31m\u0007'
    store.getState().setAnnouncedModel(snapshot({ model: raw }))
    expect(announcedFor(store, CONV)?.model).toBe(raw)
  })

  it('holds truncated: true alongside the identifier (AC2)', () => {
    const store = createAnnouncedModelStore()
    store
      .getState()
      .setAnnouncedModel(snapshot({ model: 'claude-opus-4-5-2025', truncated: true }))
    expect(announcedFor(store, CONV)).toEqual({
      model: 'claude-opus-4-5-2025',
      truncated: true
    })
  })

  it('a write differing only in truncated replaces — the report is not sticky (AC2)', () => {
    const store = createAnnouncedModelStore()
    store.getState().setAnnouncedModel(snapshot({ model: 'claude-opus-4-5', truncated: true }))
    store.getState().setAnnouncedModel(snapshot({ model: 'claude-opus-4-5', truncated: false }))
    expect(announcedFor(store, CONV)).toEqual({
      model: 'claude-opus-4-5',
      truncated: false
    })
  })

  it('keeps two stores independent (DI)', () => {
    const a = createAnnouncedModelStore()
    const b = createAnnouncedModelStore()
    a.getState().setAnnouncedModel(snapshot())
    expect(announcedFor(a, CONV)).not.toBeNull()
    expect(announcedFor(b, CONV)).toBeNull()
  })

  it('starts from an injected initial state (DI)', () => {
    const seed: AnnouncedModel = { model: 'seeded-model', truncated: true }
    const store = createAnnouncedModelStore({ announced: new Map([[CONV, seed]]) })
    expect(announcedFor(store, CONV)).toEqual(seed)
  })

  it('initialAnnouncedModelState is an empty map', () => {
    expect(initialAnnouncedModelState.announced.size).toBe(0)
  })

  it('keeps the setAnnouncedModel reference stable across updates', () => {
    const store = createAnnouncedModelStore()
    const before = store.getState().setAnnouncedModel
    store.getState().setAnnouncedModel(snapshot())
    expect(store.getState().setAnnouncedModel).toBe(before)
  })

  describe('per-conversation scoping (#1146)', () => {
    it('holds several conversations’ announcements at once — neither replaces the other (AC2)', () => {
      const store = createAnnouncedModelStore()
      store.getState().setAnnouncedModel(
        snapshot({ conversationId: 'on-server-a', model: 'model-on-A', truncated: true })
      )
      store.getState().setAnnouncedModel(
        snapshot({ conversationId: 'on-server-b', model: 'model-on-B', truncated: false })
      )

      // Each reads back its OWN identifier and its OWN truncation report.
      expect(announcedFor(store, 'on-server-a')).toEqual({ model: 'model-on-A', truncated: true })
      expect(announcedFor(store, 'on-server-b')).toEqual({ model: 'model-on-B', truncated: false })
    })

    it('a conversation that has announced nothing reads null, whatever another announced (AC1)', () => {
      const store = createAnnouncedModelStore()
      store.getState().setAnnouncedModel(snapshot({ conversationId: 'on-server-a' }))
      // The whole defect: opening a conversation on another server must show no running model, rather
      // than the previous daemon's. Same on the SAME server — the key is the conversation, not the host.
      expect(announcedFor(store, 'on-server-b')).toBeNull()
      expect(announcedFor(store, 'sibling-on-server-a')).toBeNull()
    })

    it('an announcement under an unselectable id is read by NOTHING — no fallback (AC3)', () => {
      const store = createAnnouncedModelStore()
      store.getState().setAnnouncedModel(snapshot({ conversationId: 'open-conversation' }))
      store.getState().setAnnouncedModel(
        snapshot({ conversationId: 'matches-no-conversation', model: 'stray-model' })
      )

      // Held under its own key...
      expect(announcedFor(store, 'matches-no-conversation')).toEqual({
        model: 'stray-model',
        truncated: false
      })
      // ...and it never displaces, or leaks onto, the conversation a reader can actually select.
      expect(announcedFor(store, 'open-conversation')?.model).toBe('claude-haiku-4-5-20251001')
    })

    it('a write for one conversation leaves every other entry identical BY REFERENCE (AC2)', () => {
      const store = createAnnouncedModelStore()
      store.getState().setAnnouncedModel(snapshot({ conversationId: 'other' }))
      const before = announcedFor(store, 'other')

      store.getState().setAnnouncedModel(snapshot({ conversationId: 'written', model: 'fresh' }))

      // Object.is-true, so a component watching `other` does not re-render. This is what the
      // copy-on-write buys, and a setter that rebuilt every entry would break it with no type error.
      expect(announcedFor(store, 'other')).toBe(before)
    })

    it('is copy-on-write — no map is mutated in place', () => {
      const store = createAnnouncedModelStore()
      const empty = store.getState().announced
      store.getState().setAnnouncedModel(snapshot())
      expect(store.getState().announced).not.toBe(empty)
      expect(empty.size).toBe(0)
    })

    it('keys the map by conversationId alone — the held record carries no id', () => {
      const store = createAnnouncedModelStore()
      store.getState().setAnnouncedModel(snapshot())
      // The id rides the WRITE, never the value: a key copied into the record would be a second copy to
      // keep in agreement with the map key, and it would put an untrusted string inside what a reader
      // holds and renders.
      expect(announcedFor(store, CONV)).toEqual({
        model: 'claude-haiku-4-5-20251001',
        truncated: false
      })
      expect(announcedFor(store, CONV)).not.toHaveProperty('conversationId')
    })
  })

  describe('hostile conversation ids (the ReadonlyMap mandate)', () => {
    // `Map.prototype.get('__proto__')` performs no prototype-chain lookup and
    // `Map.prototype.set('__proto__', v)` creates an ordinary own entry, so these are three unremarkable
    // keys BY CONSTRUCTION rather than by validation. A swap of `Map` for `Record<string, …>` produces
    // no type error and breaks no other assertion in this file — these reads are the whole defence.
    const hostileKeys = ['__proto__', 'constructor', ''] as const

    it('reads null for a hostile key BEFORE any write — no prototype-chain walk (AC1)', () => {
      const store = createAnnouncedModelStore()
      for (const id of hostileKeys) {
        // The half that matters. On a `Record`, `'__proto__'` yields `Object.prototype` and
        // `'constructor'` yields the `Object` function; neither is nullish, so `?? null` never fires and
        // the selector hands a reader a TRUTHY object whose `model` is undefined — which both views
        // branch on as "an announcement exists". Only these two assertions catch that.
        expect(announcedFor(store, id)).toBeNull()
      }
    })

    it('holds a hostile key as an ordinary entry, reaching nothing outside the keyspace', () => {
      const store = createAnnouncedModelStore()
      store.getState().setAnnouncedModel(snapshot({ conversationId: '__proto__', model: 'hostile' }))

      expect(announcedFor(store, '__proto__')).toEqual({ model: 'hostile', truncated: false })
      // Nothing was written through to Object.prototype, and an unrelated conversation is unaffected.
      expect(({} as Record<string, unknown>).model).toBeUndefined()
      expect(announcedFor(store, CONV)).toBeNull()
    })

    it('holds the three hostile keys independently — none aliases another', () => {
      const store = createAnnouncedModelStore()
      for (const id of hostileKeys) {
        store.getState().setAnnouncedModel(snapshot({ conversationId: id, model: `model-for-${id}` }))
      }
      for (const id of hostileKeys) {
        expect(announcedFor(store, id)).toEqual({ model: `model-for-${id}`, truncated: false })
      }
    })
  })

  describe('clearAnnouncedModel (#593, whole-map since #1146)', () => {
    it('drops EVERY conversation’s announcement at once (#1146 AC4)', () => {
      const store = createAnnouncedModelStore()
      for (const id of ['on-server-a', 'on-server-b', '__proto__']) {
        store.getState().setAnnouncedModel(snapshot({ conversationId: id }))
      }

      store.getState().clearAnnouncedModel()

      expect(store.getState().announced.size).toBe(0)
      for (const id of ['on-server-a', 'on-server-b', '__proto__']) {
        expect(announcedFor(store, id)).toBeNull()
      }
    })

    it('drops a degenerate empty-identifier record to absent, not to that record (#593 AC1)', () => {
      // The one case that distinguishes the two states the store deliberately keeps apart: a received
      // `{ model: '', truncated: false }` is a REAL announcement while held, but the pairing-ended state
      // is the freshly-launched absent key — never a record carrying an empty identifier.
      const store = createAnnouncedModelStore({
        announced: new Map([[CONV, { model: '', truncated: false }]])
      })
      store.getState().clearAnnouncedModel()
      expect(announcedFor(store, CONV)).toBeNull()
    })

    it('is unconditional — clearing an already-clear store stays empty (#593 AC3)', () => {
      const store = createAnnouncedModelStore()
      store.getState().clearAnnouncedModel()
      expect(store.getState().announced.size).toBe(0)
      store.getState().clearAnnouncedModel()
      expect(store.getState().announced.size).toBe(0)
    })

    it('never poisons the shared initial state, and leaves the store usable', () => {
      // The clear returns `initialAnnouncedModelState` BY REFERENCE, so that module-shared constant is
      // reachable from every cleared instance. A writer that ever mutated `s.announced` in place would
      // poison it and hand ONE PAIRING's announcements to the next, with no type error — this is what
      // makes the copy-on-write above load-bearing rather than stylistic.
      const first = createAnnouncedModelStore()
      first.getState().setAnnouncedModel(snapshot({ model: 'from-pairing-one' }))
      first.getState().clearAnnouncedModel()
      first.getState().setAnnouncedModel(snapshot({ conversationId: 'later', model: 'after-clear' }))

      expect(initialAnnouncedModelState.announced.size).toBe(0)
      const second = createAnnouncedModelStore()
      expect(announcedFor(second, CONV)).toBeNull()
      expect(announcedFor(second, 'later')).toBeNull()
      // ...and the cleared store still records normally: a clear does not make it one-shot.
      expect(announcedFor(first, 'later')).toEqual({ model: 'after-clear', truncated: false })
    })

    it('keeps the clearAnnouncedModel reference stable across updates', () => {
      const store = createAnnouncedModelStore()
      const before = store.getState().clearAnnouncedModel
      store.getState().setAnnouncedModel(snapshot())
      store.getState().clearAnnouncedModel()
      expect(store.getState().clearAnnouncedModel).toBe(before)
    })
  })
})
