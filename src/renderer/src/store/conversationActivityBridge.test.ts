import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import type { ConversationSummary, HelloAckPayload } from '@shared/wire/types'
import {
  translateConversationActivity,
  subscribeConversationActivity,
  ConversationActivityData
} from './conversationActivityBridge'
import { createConversationActivityStore, selectActivityFor } from './conversationActivityStore'
import {
  createConversationListStore,
  selectConversationIdsFor,
  type ConversationListOrigin
} from './conversationListStore'

// Framework-free data-path tests with injected spies (the backgroundTaskRosterBridge idiom): no React,
// no Electron. The real store is wired only for the seam tests. This bridge is reactive-only — the
// daemon pushes all five arms unsolicited — so there is no requestX describe block.
//
// Every fixture id is DISTINCT from every other id in the file, so an assertion that a write carries
// the event's own id cannot pass by coincidence with the one a neighbouring fixture used.
const turnState = (conversationId: string, state: 'thinking' | 'responding' | 'idle'): DaemonEvent => ({
  type: 'turnState',
  state,
  conversationId
})
const stallDetected = (conversationId: string): DaemonEvent => ({
  type: 'stallDetected',
  conversationId
})
const apiRetry = (conversationId: string, active: boolean, current = 3, total = 5): DaemonEvent => ({
  type: 'apiRetry',
  active,
  current,
  total,
  conversationId
})
const compacting = (conversationId: string, active: boolean): DaemonEvent => ({
  type: 'compacting',
  active,
  conversationId
})

/** #1516's arm. `phase` and `handoff` DEFAULT to the daemon's own rows rather than being omitted — both
 *  cross as the contract's zero value `''` on the falling edge and as declared members otherwise — so
 *  every fixture here carries the two tokens the translator must drop, and a translator that leaked one
 *  would be caught by a fixture that had them rather than by one that never supplied them. */
const resetting = (
  conversationId: string,
  active: boolean,
  phase: 'wrapping_up' | 'restarting' | '' = active ? 'wrapping_up' : '',
  handoff: 'pending' | 'written' | 'skipped' | '' = active ? 'pending' : ''
): DaemonEvent => ({
  type: 'resetting',
  active,
  phase,
  handoff,
  conversationId
})
const conversationDeleted = (id: string): DaemonEvent => ({ type: 'conversationDeleted', id })

/** The handshake edge. `ack` is present because the arm carries it, and deliberately never read by
 *  the reset branch — the backgroundTaskRosterBridge.ts:125 posture. */
const ack: HelloAckPayload = {
  protocol_version: 'v2',
  server_id: 'srv-1',
  conn_id: 'conn-1',
  capabilities: ['interactive']
}
const connected: DaemonEvent = { type: 'connected', ack }

/** A STAMPED handshake edge (#1145). #1068's stamp rides BESIDE the union — it is applied main-side
 *  after decode by `bindServerOrigin` — so at a bare-`DaemonEvent`-typed hole it arrives structurally
 *  while the static type stays silent about it. The cast is exactly that shape, and it takes
 *  `unknown` so the three-valued origin cases can push a value no producer can emit. */
const connectedFrom = (serverId: unknown): DaemonEvent =>
  ({ type: 'connected', ack, serverId }) as DaemonEvent

const conversationRow = (id: string): ConversationSummary => ({
  id,
  name: null,
  is_promoted: false,
  is_archived: false,
  cwd: '/home/pyry/project',
  last_message_ts: '2026-07-10T12:00:00Z',
  last_used_at: '2026-07-10T12:05:00Z',
  workspace_label: null
})

describe('translateConversationActivity', () => {
  it('maps turnState{thinking} to BOTH writes — running true, and the stall clear', () => {
    expect(translateConversationActivity(turnState('conv-think', 'thinking'))).toEqual([
      { fact: 'turnRunning', conversationId: 'conv-think', turnRunning: true },
      { fact: 'stalled', conversationId: 'conv-think', stalled: false }
    ])
  })

  it('maps turnState{responding} to turnRunning true (AC2 — a one-literal gate fails HERE)', () => {
    // The #648 defect in one assertion: a gate written against `'thinking'` alone passes the scenario
    // above and fails this one, making the signal vanish for the tool-heavy bulk of a turn.
    expect(translateConversationActivity(turnState('conv-respond', 'responding'))).toEqual([
      { fact: 'turnRunning', conversationId: 'conv-respond', turnRunning: true },
      { fact: 'stalled', conversationId: 'conv-respond', stalled: false }
    ])
  })

  it('maps turnState{idle} to turnRunning false AND still clears the stall (AC3)', () => {
    // The clear is UNCONDITIONAL on any turn state, `idle` included — threadTimeline.ts:356-359's
    // shipped rule, reused rather than re-invented as a running-only variant.
    expect(translateConversationActivity(turnState('conv-idle', 'idle'))).toEqual([
      { fact: 'turnRunning', conversationId: 'conv-idle', turnRunning: false },
      { fact: 'stalled', conversationId: 'conv-idle', stalled: false }
    ])
  })

  it('maps stallDetected to one write, stalled true (onset-only, no payload beyond the id)', () => {
    expect(translateConversationActivity(stallDetected('conv-stall'))).toEqual([
      { fact: 'stalled', conversationId: 'conv-stall', stalled: true }
    ])
  })

  it('copies the apiRetry edge and carries NO counter into this store', () => {
    const writes = translateConversationActivity(apiRetry('conv-retry', true, 3, 5))

    expect(writes).toEqual([
      { fact: 'apiRetrying', conversationId: 'conv-retry', apiRetrying: true }
    ])
    // A fresh named-field literal, never a spread: `current` / `total` belong to the open
    // conversation's chrome (threadTimeline's ApiRetryStatus), and this store holds liveness only.
    expect(writes[0]).not.toHaveProperty('current')
    expect(writes[0]).not.toHaveProperty('total')
    expect(writes[0]).not.toHaveProperty('type')
  })

  it('copies the apiRetry falling edge', () => {
    expect(translateConversationActivity(apiRetry('conv-retry-off', false, 0, 0))).toEqual([
      { fact: 'apiRetrying', conversationId: 'conv-retry-off', apiRetrying: false }
    ])
  })

  it('copies both compacting edges', () => {
    expect(translateConversationActivity(compacting('conv-comp', true))).toEqual([
      { fact: 'compacting', conversationId: 'conv-comp', compacting: true }
    ])
    expect(translateConversationActivity(compacting('conv-comp-off', false))).toEqual([
      { fact: 'compacting', conversationId: 'conv-comp-off', compacting: false }
    ])
  })

  it('copies both resetting edges and carries NEITHER token into this store (#1516 AC2)', () => {
    const writes = translateConversationActivity(resetting('conv-reset', true))

    expect(writes).toEqual([{ fact: 'resetting', conversationId: 'conv-reset', resetting: true }])
    // A fresh named-field literal, never a spread. `phase` and `handoff` belong to #1517's composer
    // status row; this store holds LIVENESS only, exactly as it holds no apiRetry counter. A spread
    // would carry both, plus the arm's `type` tag, into a write unit that never agreed to hold them.
    expect(writes[0]).not.toHaveProperty('phase')
    expect(writes[0]).not.toHaveProperty('handoff')
    expect(writes[0]).not.toHaveProperty('type')

    expect(translateConversationActivity(resetting('conv-reset-off', false))).toEqual([
      { fact: 'resetting', conversationId: 'conv-reset-off', resetting: false }
    ])
  })

  it('reads `active` alone — the phase does not steer the fact (#1516 AC1, AC2)', () => {
    // The rising edge RE-FIRES as the phase advances, and the second edge is a real transition rather
    // than a duplicate to suppress. Both write the same `true`, so a translator that branched on
    // `phase` — reading `restarting` as "no longer resetting", say — would fail here while passing
    // every case above.
    expect(translateConversationActivity(resetting('conv-phase', true, 'restarting', 'written'))).toEqual(
      [{ fact: 'resetting', conversationId: 'conv-phase', resetting: true }]
    )
    // And the inverse: a daemon is free to send any of the sixteen combinations, so a falling edge
    // carrying a non-empty phase still clears. NARROWED IS NOT TRUSTED — the tokens are a report, and
    // nothing here may branch on them.
    expect(translateConversationActivity(resetting('conv-phase-off', false, 'restarting', 'skipped'))).toEqual(
      [{ fact: 'resetting', conversationId: 'conv-phase-off', resetting: false }]
    )
  })

  it('returns [] for an unowned arm rather than throwing (reactive-only, not exhaustive)', () => {
    const announced: DaemonEvent = {
      type: 'modelAnnounced',
      model: 'claude-opus-5',
      truncated: false,
      conversationId: 'conv-unowned'
    }
    const result: DaemonEvent = {
      type: 'toolResult',
      conversationId: 'conv-unowned',
      turnId: 't1',
      toolUseId: 'tu-1',
      isError: false,
      resultSummary: 'ok'
    }

    expect(translateConversationActivity(announced)).toEqual([])
    expect(translateConversationActivity(result)).toEqual([])
  })
})

describe('subscribeConversationActivity', () => {
  // A fake onDaemonEvent that captures the listener and hands back an off spy.
  function fakeBridge(): {
    onDaemonEvent: (l: (e: DaemonEvent) => void) => () => void
    emit: (e: DaemonEvent) => void
    off: ReturnType<typeof vi.fn>
    subscribeCalls: () => number
  } {
    let listener: ((e: DaemonEvent) => void) | undefined
    const off = vi.fn()
    const onDaemonEvent = vi.fn((l: (e: DaemonEvent) => void) => {
      listener = l
      return off
    })
    return {
      onDaemonEvent,
      emit: (e) => listener?.(e),
      off,
      subscribeCalls: () => onDaemonEvent.mock.calls.length
    }
  }

  function wired() {
    const bridge = fakeBridge()
    // A NAMED deps object, not a positional list: five of these six collapse to a signature another
    // slot accepts — the four setters are all `(string, boolean) => void`, and a function of fewer
    // parameters is assignable to one of more, so `dropConversation` fits any of them too. A
    // positional cross-wire among those would compile and pass every test in this file. #1145's
    // `resetActivityForServer` is the first member a setter cannot be assigned INTO, on arity.
    const deps = {
      setTurnRunning: vi.fn(),
      setStalled: vi.fn(),
      setApiRetrying: vi.fn(),
      setCompacting: vi.fn(),
      setResetting: vi.fn(),
      dropConversation: vi.fn(),
      resetActivityForServer: vi.fn()
    }
    const off = subscribeConversationActivity(bridge.onDaemonEvent, deps)
    return { bridge, ...deps, off }
  }

  it('dispatches BOTH of turnState’s writes, never stopping at the first', () => {
    // The early-return regression this catches: the precedent's shape returns after the first match,
    // which here would silently drop the stall clear.
    const w = wired()
    w.bridge.emit(turnState('conv-a', 'responding'))

    expect(w.setTurnRunning).toHaveBeenCalledWith('conv-a', true)
    expect(w.setStalled).toHaveBeenCalledWith('conv-a', false)
    expect(w.setApiRetrying).not.toHaveBeenCalled()
    expect(w.setCompacting).not.toHaveBeenCalled()
  })

  it('dispatches stallDetected to setStalled alone', () => {
    const w = wired()
    w.bridge.emit(stallDetected('conv-b'))

    expect(w.setStalled).toHaveBeenCalledWith('conv-b', true)
    expect(w.setTurnRunning).not.toHaveBeenCalled()
    expect(w.setApiRetrying).not.toHaveBeenCalled()
    expect(w.setCompacting).not.toHaveBeenCalled()
  })

  it('dispatches apiRetry to setApiRetrying alone', () => {
    const w = wired()
    w.bridge.emit(apiRetry('conv-c', true))

    expect(w.setApiRetrying).toHaveBeenCalledWith('conv-c', true)
    expect(w.setTurnRunning).not.toHaveBeenCalled()
    expect(w.setStalled).not.toHaveBeenCalled()
    expect(w.setCompacting).not.toHaveBeenCalled()
  })

  it('dispatches compacting to setCompacting alone', () => {
    const w = wired()
    w.bridge.emit(compacting('conv-d', false))

    expect(w.setCompacting).toHaveBeenCalledWith('conv-d', false)
    expect(w.setTurnRunning).not.toHaveBeenCalled()
    expect(w.setStalled).not.toHaveBeenCalled()
    expect(w.setApiRetrying).not.toHaveBeenCalled()
    expect(w.setResetting).not.toHaveBeenCalled()
  })

  it('dispatches resetting to setResetting alone (#1516 AC1)', () => {
    const w = wired()
    w.bridge.emit(resetting('conv-e', true))

    expect(w.setResetting).toHaveBeenCalledWith('conv-e', true)
    expect(w.setTurnRunning).not.toHaveBeenCalled()
    expect(w.setStalled).not.toHaveBeenCalled()
    expect(w.setApiRetrying).not.toHaveBeenCalled()
    expect(w.setCompacting).not.toHaveBeenCalled()
  })

  it('calls no setter and no removal at all for an unowned arm', () => {
    const w = wired()
    // `disconnected` in particular: the socket dropping is NOT the clear edge — the re-handshake is,
    // so a flap must not empty the store before it reconnects.
    w.bridge.emit({ type: 'disconnected' })
    w.bridge.emit({
      type: 'assistantDelta',
      turnId: 't1',
      seq: 1,
      text: 'hi',
      conversationId: 'conv-unowned'
    })

    expect(w.setTurnRunning).not.toHaveBeenCalled()
    expect(w.setStalled).not.toHaveBeenCalled()
    expect(w.setApiRetrying).not.toHaveBeenCalled()
    expect(w.setCompacting).not.toHaveBeenCalled()
    expect(w.setResetting).not.toHaveBeenCalled()
    expect(w.dropConversation).not.toHaveBeenCalled()
    expect(w.resetActivityForServer).not.toHaveBeenCalled()
  })

  it('dispatches conversationDeleted to dropConversation with the event’s OWN id, alone', () => {
    const w = wired()
    w.bridge.emit(conversationDeleted('conv-gone'))

    expect(w.dropConversation).toHaveBeenCalledWith('conv-gone')
    expect(w.dropConversation).toHaveBeenCalledTimes(1)
    expect(w.resetActivityForServer).not.toHaveBeenCalled()
    expect(w.setTurnRunning).not.toHaveBeenCalled()
    expect(w.setStalled).not.toHaveBeenCalled()
    expect(w.setApiRetrying).not.toHaveBeenCalled()
    expect(w.setCompacting).not.toHaveBeenCalled()
    expect(w.setResetting).not.toHaveBeenCalled()
  })

  it('drops a conversation whose id is the degenerate empty string', () => {
    const w = wired()
    w.bridge.emit(conversationDeleted(''))

    // `''` is falsy but is a real value the daemon can emit and a real `Map` key
    // (conversationDeletedBridge.ts:32-34 makes this point about the same arm), so the branch must
    // be discriminant-driven rather than truthiness-guarded.
    expect(w.dropConversation).toHaveBeenCalledWith('')
  })

  it('dispatches connected to resetActivityForServer with the origin off the stamp, alone', () => {
    const w = wired()
    w.bridge.emit(connectedFrom('srv-a'))

    // The branch hands the CALLER the origin it read off the stamp; turning that into the ids to
    // drop is `ConversationActivityData`'s job, which is what keeps this bridge store-free (#1145).
    expect(w.resetActivityForServer).toHaveBeenCalledTimes(1)
    expect(w.resetActivityForServer).toHaveBeenCalledWith('srv-a')
    expect(w.dropConversation).not.toHaveBeenCalled()
    expect(w.setTurnRunning).not.toHaveBeenCalled()
    expect(w.setStalled).not.toHaveBeenCalled()
    expect(w.setApiRetrying).not.toHaveBeenCalled()
    expect(w.setCompacting).not.toHaveBeenCalled()
    expect(w.setResetting).not.toHaveBeenCalled()
  })

  it('passes the three-valued origin through unchanged — a real id, null, and an absent stamp (AC2)', () => {
    // `ConversationListOrigin` is `string | null | undefined` and `byServer` is genuinely keyed by
    // all three: `null` is a producer bound while no paired record was in hand, `undefined` one that
    // never went through a binding. Treating the origin as a total, opaque lookup key is what makes
    // the unstamped case fall out of the ordinary path instead of needing a special branch.
    const w = wired()

    w.bridge.emit(connectedFrom('srv-a'))
    w.bridge.emit(connectedFrom(null))
    w.bridge.emit(connected)
    // A value no producer can emit (`bindServerOrigin` takes a `string | null` scalar) still selects
    // a slot rather than throwing, which is what keeps the read total inside a daemon-event listener.
    w.bridge.emit(connectedFrom(42))

    expect(w.resetActivityForServer.mock.calls).toEqual([['srv-a'], [null], [undefined], [undefined]])
  })

  it('reads the origin off the client-bound stamp, never the daemon’s ack.server_id (AC5)', () => {
    // The ack is the DAEMON's word; the stamp is bound main-side from a paired record this client
    // holds, and `bindServerOrigin` spreads the decoded event FIRST, so a `serverId` the daemon puts
    // in its own payload cannot overwrite it. A confused or hostile daemon must not be able to steer
    // whose dots a reset spares.
    const w = wired()

    w.bridge.emit({
      ...(connectedFrom('srv-a') as object),
      ack: { ...ack, server_id: 'srv-b' }
    } as DaemonEvent)

    expect(w.resetActivityForServer).toHaveBeenCalledWith('srv-a')
  })

  it('keeps both removals OUT of the translator — they are subscriber branches', () => {
    // Pins the decision rather than restating the code: neither removal names a store field or
    // carries a value, so neither is a member of `ConversationActivityWrite`. A later refactor that
    // folds one in fails here instead of passing silently.
    expect(translateConversationActivity(connected)).toEqual([])
    expect(translateConversationActivity(conversationDeleted('conv-gone'))).toEqual([])
  })

  it('subscribes once and returns the bridge’s own off handle as the only teardown', () => {
    const w = wired()

    expect(w.bridge.subscribeCalls()).toBe(1)
    expect(w.off).toBe(w.bridge.off)
    expect(w.bridge.off).not.toHaveBeenCalled()
    w.off()
    expect(w.bridge.off).toHaveBeenCalledTimes(1)
  })

  describe('seam (real store)', () => {
    /**
     * Both real stores, wired the way `ConversationActivityData` wires them (#1145): the bridge hands
     * the reset the ORIGIN it read off the stamp, and the composition root resolves that to the ids
     * to drop through the shared conversation-list resolution. `lists` seeds which conversations each
     * server has reported — a server absent from it has no list yet, which is the "drops nothing"
     * case, and the case a first connect always is.
     */
    function seam(
      lists: readonly (readonly [ConversationListOrigin, readonly string[]])[] = []
    ): {
      bridge: ReturnType<typeof fakeBridge>
      store: ReturnType<typeof createConversationActivityStore>
    } {
      const bridge = fakeBridge()
      const store = createConversationActivityStore()
      const list = createConversationListStore()
      for (const [origin, ids] of lists) {
        list.getState().setConversations(ids.map(conversationRow), origin)
      }
      subscribeConversationActivity(bridge.onDaemonEvent, {
        setTurnRunning: (id, v) => store.getState().setTurnRunning(id, v),
        setStalled: (id, v) => store.getState().setStalled(id, v),
        setApiRetrying: (id, v) => store.getState().setApiRetrying(id, v),
        setCompacting: (id, v) => store.getState().setCompacting(id, v),
        setResetting: (id, v) => store.getState().setResetting(id, v),
        dropConversation: (id) => store.getState().dropConversation(id),
        resetActivityForServer: (origin) =>
          store.getState().resetActivityFor(selectConversationIdsFor(origin)(list.getState()))
      })
      return { bridge, store }
    }

    it('lands an arm for a conversation the client has never opened (AC1, AC4)', () => {
      const { bridge, store } = seam()
      expect(selectActivityFor('never-opened')(store.getState())).toBeNull()

      bridge.emit(compacting('never-opened', true))

      // Nothing here consults which conversation is open — `activeConversationStore` is not imported,
      // so the `?? activeConversation` fallback events.ts:116-117 bans is unavailable, not avoided.
      expect(selectActivityFor('never-opened')(store.getState())).toEqual({
        turnRunning: false,
        stalled: false,
        apiRetrying: false,
        compacting: true,
        resetting: false
      })
    })

    it('leaves every other conversation’s entry Object.is-identical (AC1, AC3)', () => {
      const { bridge, store } = seam()
      bridge.emit(apiRetry('conv-keep', true))
      const before = selectActivityFor('conv-keep')(store.getState())

      bridge.emit(turnState('conv-other', 'thinking'))
      bridge.emit(compacting('conv-other', true))
      bridge.emit(apiRetry('conv-other', false))

      expect(selectActivityFor('conv-keep')(store.getState())).toBe(before)
      expect(before).toEqual({
        turnRunning: false,
        stalled: false,
        apiRetrying: true,
        compacting: false,
        resetting: false
      })
    })

    it('does not latch a stall, and does not let a neighbour’s turn clear it (AC3)', () => {
      const { bridge, store } = seam()
      bridge.emit(stallDetected('conv-stalled'))
      expect(selectActivityFor('conv-stalled')(store.getState())?.stalled).toBe(true)

      // Another conversation's turn activity must not reach into this one's entry.
      bridge.emit(turnState('conv-busy', 'thinking'))
      expect(selectActivityFor('conv-stalled')(store.getState())?.stalled).toBe(true)

      // Its OWN turn state clears it — any state, `idle` included.
      bridge.emit(turnState('conv-stalled', 'idle'))
      expect(selectActivityFor('conv-stalled')(store.getState())?.stalled).toBe(false)
      expect(selectActivityFor('conv-stalled')(store.getState())?.turnRunning).toBe(false)
    })

    it('leaves apiRetry and compacting uncleared by turn activity, only by their edge (AC3)', () => {
      const { bridge, store } = seam()
      bridge.emit(apiRetry('conv-edges', true))
      bridge.emit(compacting('conv-edges', true))

      // Both have an explicit wire falling edge, so a turn-state change mid-retry or mid-compaction
      // must leave the fact showing — the inverse of `stalled`.
      bridge.emit(turnState('conv-edges', 'responding'))
      expect(selectActivityFor('conv-edges')(store.getState())).toEqual({
        turnRunning: true,
        stalled: false,
        apiRetrying: true,
        compacting: true,
        resetting: false
      })

      bridge.emit(apiRetry('conv-edges', false))
      bridge.emit(compacting('conv-edges', false))
      expect(selectActivityFor('conv-edges')(store.getState())).toEqual({
        turnRunning: true,
        stalled: false,
        apiRetrying: false,
        compacting: false,
        resetting: false
      })
    })

    it('keeps resetting set across the wrap-up turn, and clears it only on its edge (#1516 AC1)', () => {
      // `resetting` takes `apiRetry`'s and `compacting`'s edge semantics, NOT `stalled`'s — and the
      // case is sharper here than for either peer, because the wrap-up turn runs INSIDE the reset. If
      // `resetting` had joined `turnState`'s clear set, the reset's own turn transitions would clear
      // the very fact they are part of, and the dot would go dark mid-reset.
      const { bridge, store } = seam()
      bridge.emit(resetting('conv-reset-edges', true))

      bridge.emit(turnState('conv-reset-edges', 'responding'))
      bridge.emit(turnState('conv-reset-edges', 'idle'))
      expect(selectActivityFor('conv-reset-edges')(store.getState())).toEqual({
        turnRunning: false,
        stalled: false,
        apiRetrying: false,
        compacting: false,
        resetting: true
      })

      bridge.emit(resetting('conv-reset-edges', false))
      expect(selectActivityFor('conv-reset-edges')(store.getState())?.resetting).toBe(false)
    })

    it('leaves resetting set when the rising edge re-fires as the phase advances (#1516 AC1)', () => {
      // `wrapping_up` → `restarting` is a real transition rather than a duplicate to suppress, and
      // both edges write the same `true`. The store's per-field guard makes the second churn no
      // listener, so nothing on this leg dedups and nothing may: suppressing the repeat upstream
      // would eat the signal that the phase moved.
      const { bridge, store } = seam()
      bridge.emit(resetting('conv-phases', true, 'wrapping_up', 'pending'))
      const afterFirst = store.getState()

      bridge.emit(resetting('conv-phases', true, 'restarting', 'written'))

      expect(store.getState()).toBe(afterFirst)
      expect(selectActivityFor('conv-phases')(store.getState())?.resetting).toBe(true)
    })

    it('holds resetting for a conversation never opened, and drops it on a delete (#1516 AC4)', () => {
      // Retention first: the arm is keyed by the event's OWN id and nothing consults which
      // conversation is open, so a reset the operator is not looking at still lights its row. Then
      // the independent clear that discharges #1515's falling-edge obligation — a daemon killed
      // mid-reset sends no `active: false`, and the delete eviction does not need one.
      const { bridge, store } = seam()
      bridge.emit(resetting('never-opened-reset', true))
      expect(selectActivityFor('never-opened-reset')(store.getState())?.resetting).toBe(true)

      bridge.emit(conversationDeleted('never-opened-reset'))
      expect(selectActivityFor('never-opened-reset')(store.getState())).toBeNull()
    })

    it('drops resetting on that conversation’s OWN server reconnect, not another’s (#1516 AC4)', () => {
      // The second independent clear, and the one that covers the killed-daemon case: no falling edge
      // arrives, but that server's next handshake drops its own conversations' entries. Scoped — a
      // neighbouring server's reconnect must leave this fact standing.
      const { bridge, store } = seam([
        ['srv-a', ['a-reset']],
        ['srv-b', ['b-reset']]
      ])
      bridge.emit(resetting('a-reset', true))
      bridge.emit(resetting('b-reset', true))

      bridge.emit(connectedFrom('srv-b'))
      expect(selectActivityFor('b-reset')(store.getState())).toBeNull()
      expect(selectActivityFor('a-reset')(store.getState())?.resetting).toBe(true)

      bridge.emit(connectedFrom('srv-a'))
      expect(selectActivityFor('a-reset')(store.getState())).toBeNull()
    })

    it('a delete evicts that conversation and leaves its neighbour Object.is-identical (AC1)', () => {
      const { bridge, store } = seam()
      bridge.emit(compacting('conv-doomed', true))
      bridge.emit(apiRetry('conv-survivor', true))
      const survivorBefore = selectActivityFor('conv-survivor')(store.getState())

      bridge.emit(conversationDeleted('conv-doomed'))

      expect(selectActivityFor('conv-doomed')(store.getState())).toBeNull()
      expect(selectActivityFor('conv-survivor')(store.getState())).toBe(survivorBefore)
    })

    it('a connected edge drops that server’s facts, and is RE-ARMABLE rather than one-shot (AC3)', () => {
      const { bridge, store } = seam([[undefined, ['conv-x', 'conv-y', 'conv-z']]])
      bridge.emit(turnState('conv-x', 'thinking'))
      bridge.emit(compacting('conv-y', true))

      bridge.emit(connected)
      expect(store.getState().entries.size).toBe(0)

      // Every completed Noise handshake emits `connected` (daemonConnection.ts:478 is its one emit
      // site), so the RECONNECT guarantee this pins is that a turn running when the socket dropped
      // may have finished while it was down and must leave no working dot behind — re-armed on every
      // handshake, not spent on the first. Until #1145 this comment argued re-armability from the
      // branch covering BOTH pairing-change paths instead. That argument is gone twice over: #1141
      // established that pairing another server ends nothing and owes no clear, and #1145 moved the
      // pairing boundary itself off this edge into `clearPairingScopedState`. The property survives;
      // its stated motive does not.
      bridge.emit(stallDetected('conv-z'))
      expect(selectActivityFor('conv-z')(store.getState())?.stalled).toBe(true)

      bridge.emit(connected)
      expect(store.getState().entries.size).toBe(0)
      expect(selectActivityFor('conv-z')(store.getState())).toBeNull()
    })

    describe('scoped to the reconnecting server (#1145)', () => {
      const twoServers = () =>
        seam([
          ['srv-a', ['a1']],
          ['srv-b', ['b1']]
        ])

      /** All four facts held for one conversation, so a reset that dropped fewer than all of them —
       *  or the wrong server's — is visible rather than merely plausible. */
      const holdAllFour = (bridge: ReturnType<typeof fakeBridge>, id: string): void => {
        bridge.emit(turnState(id, 'thinking'))
        bridge.emit(stallDetected(id))
        bridge.emit(apiRetry(id, true))
        bridge.emit(compacting(id, true))
      }

      it('leaves the OTHER server’s four facts and resets the reconnecting one’s (AC1)', () => {
        const { bridge, store } = twoServers()
        holdAllFour(bridge, 'a1')
        holdAllFour(bridge, 'b1')
        const aBefore = selectActivityFor('a1')(store.getState())

        bridge.emit(connectedFrom('srv-b'))

        // The bug: server B's reconnect used to blank server A's working dot for the remainder of a
        // turn that had not finished, because nothing re-asserts a blanked fact until that
        // conversation's next `turnState`.
        expect(selectActivityFor('a1')(store.getState())).toEqual({
          turnRunning: true,
          stalled: true,
          apiRetrying: true,
          compacting: true,
          resetting: false
        })
        // And by REFERENCE, so no selector watching A re-renders at all.
        expect(selectActivityFor('a1')(store.getState())).toBe(aBefore)
        expect(selectActivityFor('b1')(store.getState())).toBeNull()
      })

      it('drops nothing and hands back the same state when the server has no list yet (AC2)', () => {
        // srv-b has never answered list_conversations — its slot holds no list, so its reconnect edge
        // resolves to the empty set. The first connect of a fresh server is exactly this case, and it
        // is why the pairing boundary needs `clearAllActivity` rather than this edge.
        const { bridge, store } = seam([['srv-a', ['a1']]])
        holdAllFour(bridge, 'a1')
        const stateBefore = store.getState()

        bridge.emit(connectedFrom('srv-b'))

        expect(store.getState()).toBe(stateBefore)
      })

      it('scopes an unstamped or null-stamped edge to its OWN slot, nothing wider (AC2)', () => {
        const { bridge, store } = seam([
          ['srv-a', ['a1']],
          [null, ['n1']],
          [undefined, ['u1']]
        ])
        bridge.emit(compacting('a1', true))
        bridge.emit(compacting('n1', true))
        bridge.emit(compacting('u1', true))

        bridge.emit(connectedFrom(null))
        expect(selectActivityFor('n1')(store.getState())).toBeNull()
        expect(selectActivityFor('a1')(store.getState())?.compacting).toBe(true)
        expect(selectActivityFor('u1')(store.getState())?.compacting).toBe(true)

        bridge.emit(connected)
        expect(selectActivityFor('u1')(store.getState())).toBeNull()
        expect(selectActivityFor('a1')(store.getState())?.compacting).toBe(true)
      })

      it('leaves an entry whose conversation is in NO server’s list alone (AC2)', () => {
        // The accepted consequence of scoping by the list, and a real case here rather than a corner
        // one: any of the four arms can arrive for a conversation whose list has not landed. Pinned
        // so a later widening is a deliberate change rather than drift — `clearAllActivity` at the
        // pairing boundary is the only thing that ever collects such an entry.
        const { bridge, store } = twoServers()
        bridge.emit(compacting('orphan', true))

        bridge.emit(connectedFrom('srv-a'))
        bridge.emit(connectedFrom('srv-b'))
        bridge.emit(connectedFrom(null))
        bridge.emit(connected)

        expect(selectActivityFor('orphan')(store.getState())?.compacting).toBe(true)
      })

      it('scopes to the client-bound stamp, never the daemon’s ack.server_id (AC5)', () => {
        const { bridge, store } = twoServers()
        holdAllFour(bridge, 'a1')
        holdAllFour(bridge, 'b1')

        // The ack is the DAEMON's word and names srv-b; the stamp is bound main-side from a paired
        // record this client holds and names srv-a. The stamp wins, end to end.
        bridge.emit({
          ...(connectedFrom('srv-a') as object),
          ack: { ...ack, server_id: 'srv-b' }
        } as DaemonEvent)

        expect(selectActivityFor('a1')(store.getState())).toBeNull()
        expect(selectActivityFor('b1')(store.getState())?.turnRunning).toBe(true)
      })

      it('re-arms per server — B’s reconnect twice over never reaches A (AC3)', () => {
        const { bridge, store } = twoServers()
        holdAllFour(bridge, 'a1')
        holdAllFour(bridge, 'b1')

        bridge.emit(connectedFrom('srv-b'))
        bridge.emit(turnState('b1', 'responding'))
        expect(selectActivityFor('b1')(store.getState())?.turnRunning).toBe(true)

        bridge.emit(connectedFrom('srv-b'))
        expect(selectActivityFor('b1')(store.getState())).toBeNull()
        expect(selectActivityFor('a1')(store.getState())?.turnRunning).toBe(true)
      })
    })

    it('treats __proto__, constructor and ’’ as three unremarkable keys — READ BEFORE WRITE', () => {
      const { bridge, store } = seam()

      // Assertion ORDER is the whole test. Reading only AFTER the write cannot distinguish the store's
      // `Map` from a `Record`: `entries['__proto__']` yields `Object.prototype` and `'constructor'`
      // yields the `Object` function, neither of which is nullish, so `?? null` would never fire and a
      // post-write read would pass against a prototype-polluting lookup.
      for (const hostile of ['__proto__', 'constructor', '']) {
        expect(selectActivityFor(hostile)(store.getState())).toBeNull()
      }

      bridge.emit(turnState('__proto__', 'thinking'))
      bridge.emit(stallDetected('constructor'))
      bridge.emit(compacting('', true))

      expect(selectActivityFor('__proto__')(store.getState())).toEqual({
        turnRunning: true,
        stalled: false,
        apiRetrying: false,
        compacting: false,
        resetting: false
      })
      expect(selectActivityFor('constructor')(store.getState())).toEqual({
        turnRunning: false,
        stalled: true,
        apiRetrying: false,
        compacting: false,
        resetting: false
      })
      expect(selectActivityFor('')(store.getState())).toEqual({
        turnRunning: false,
        stalled: false,
        apiRetrying: false,
        compacting: true,
        resetting: false
      })
    })
  })
})

describe('ConversationActivityData (container)', () => {
  // Server-render sanity — the BackgroundTaskRosterData idiom. The binding is headless (renders null)
  // and dereferences window.pyry only inside its effect, so a server render (effects never run)
  // produces empty markup without a bridge mock. That invariant is what keeps App.test's <App/> server
  // render passing with no window stub.
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(createElement(ConversationActivityData))
    }).not.toThrow()
    expect(markup).toBe('')
  })
})
