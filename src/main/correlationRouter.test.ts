// The correlation router (#1119): an ANSWER reaches the server that raised the thing it answers, and no
// other. Both seams are injected, so these tests drive a `connectionFor` fake over a plain Map and a
// recording sink — no Electron, no registry, no socket, no window. `conversationRouter.test.ts`'s harness,
// widened to three id spaces.
import { describe, expect, it } from 'vitest'
import {
  createCorrelationRouter,
  MAX_CORRELATION_ID_LENGTH,
  MAX_INDEXED_CORRELATIONS,
  type CorrelationRouter
} from './correlationRouter'
import type { DaemonEventSink } from './emitDaemonEvent'
import { DAEMON_EVENT_CHANNEL, type DaemonEvent, type StampedDaemonEvent } from '../shared/ipc/events'
import type { WireSessionTransitionReason } from '../shared/wire/types'
import type { DiagnosticEvent } from './diagnosticLog'

/** A stand-in connection. Identity is the whole contract — the router never calls a member. */
interface FakeConnection {
  readonly server: string
}

function modalShown(serverId: string | null, modalId: string): StampedDaemonEvent {
  return {
    type: 'modalShown',
    conversationId: 'conversation-1',
    modalId,
    class: 'permission',
    title: 'Run a command?',
    prompt: 'claude wants to run `ls`',
    options: [{ id: 'allow', label: 'Allow' }],
    defaultOptionId: 'allow',
    serverId
  }
}

function modalDismissed(serverId: string | null, modalId: string): StampedDaemonEvent {
  return { type: 'modalDismissed', modalId, outcome: 'remote', source: 'remote', serverId }
}

function modalAnswerRejected(serverId: string | null, modalId: string): StampedDaemonEvent {
  return { type: 'modalAnswerRejected', modalId, serverId }
}

function questionShown(serverId: string | null, questionBatchId: string): StampedDaemonEvent {
  return {
    type: 'questionShown',
    conversationId: 'conversation-1',
    questionBatchId,
    questions: [{ question: 'Which?', header: 'Pick', options: [], multi_select: false }],
    serverId
  }
}

function questionDismissed(serverId: string | null, questionBatchId: string): StampedDaemonEvent {
  return { type: 'questionDismissed', questionBatchId, outcome: 'unanswered', source: 'no_answer', serverId }
}

function runConfigReceived(serverId: string | null, sessionId: string): StampedDaemonEvent {
  return {
    type: 'runConfigReceived',
    // The conversation the reply describes (#1176). This index keys on the SESSION id, not this one,
    // so it is inert here — carried because the arm requires it, and held constant so a change in
    // routing behaviour cannot be mistaken for it having started to matter.
    conversationId: 'conv-1',
    sessionId,
    model: 'opus',
    effort: 'high',
    yolo: false,
    permissionMode: 'default',
    used_tokens: 1,
    window_tokens: 2,
    serverId
  }
}

function sessionSettingsUpdated(serverId: string | null, sessionId: string): StampedDaemonEvent {
  return { type: 'sessionSettingsUpdated', sessionId, changeId: 'change-1', serverId }
}

/** The `/clear` marker: the second writer of the store whose id a `setSessionSettings` carries. */
function sessionTransition(
  serverId: string | null,
  newSessionId: string,
  reason: WireSessionTransitionReason = 'clear'
): StampedDaemonEvent {
  return {
    type: 'sessionTransition',
    newSessionId,
    reason,
    occurredAt: '2026-09-05T12:00:00Z',
    workspaceCwd: null,
    serverId
  }
}

/** An arm this module reads for nothing — it must pass through untouched. */
function unreadEvent(serverId: string | null): StampedDaemonEvent {
  return { type: 'notificationActivated', serverId }
}

/** Every event the wrapper forwarded, with the channel it went out on. */
function createSinkFake(): {
  sent: { channel: string; event: DaemonEvent }[]
  destroyed: boolean
  handle: DaemonEventSink
} {
  const sent: { channel: string; event: DaemonEvent }[] = []
  const state = { destroyed: false }
  return {
    sent,
    get destroyed(): boolean {
      return state.destroyed
    },
    set destroyed(next: boolean) {
      state.destroyed = next
    },
    handle: {
      isDestroyed: () => state.destroyed,
      webContents: {
        send: (channel: string, event: DaemonEvent): void => void sent.push({ channel, event })
      }
    }
  }
}

function createLogFake(): { events: DiagnosticEvent[]; handle: { event(f: DiagnosticEvent): void } } {
  const events: DiagnosticEvent[] = []
  return { events, handle: { event: (fields: DiagnosticEvent): void => void events.push(fields) } }
}

function harness(): {
  router: CorrelationRouter<FakeConnection>
  log: ReturnType<typeof createLogFake>
  sink: ReturnType<typeof createSinkFake>
  /** The observing wrapper every test feeds events through. */
  observed: DaemonEventSink
  /** Push one already-stamped event down the wrapper, exactly as a live connection would. */
  push(event: StampedDaemonEvent): void
  /** Give `server` a live connection and hand back the object every route must answer with. */
  connect(server: string): FakeConnection
  /** Drop `server`'s connection — an unpair, from the router's point of view. */
  disconnect(server: string): void
  /** Every `code` the router logged, in order. */
  codes(): (string | undefined)[]
} {
  const log = createLogFake()
  const sink = createSinkFake()
  const connections = new Map<string, FakeConnection>()
  const router = createCorrelationRouter<FakeConnection>({
    connectionFor: (serverId) => connections.get(serverId) ?? null,
    diagnosticLog: log.handle
  })
  const observed = router.observe(sink.handle)
  return {
    router,
    log,
    sink,
    observed,
    push: (event) => observed.webContents.send(DAEMON_EVENT_CHANNEL, event),
    connect: (server) => {
      const connection: FakeConnection = { server }
      connections.set(server, connection)
      return connection
    },
    disconnect: (server) => void connections.delete(server),
    codes: () => log.events.map((entry) => entry.code)
  }
}

describe('createCorrelationRouter — learning and routing', () => {
  it('routes a modal answer to the server that raised the modal, not to the other paired server', () => {
    const h = harness()
    const alpha = h.connect('alpha')
    h.connect('beta')
    h.push(modalShown('alpha', 'modal-1'))

    expect(h.router.routeModal('modal-1')).toBe(alpha)
  })

  it('routes a question answer to the server that raised the batch', () => {
    const h = harness()
    h.connect('alpha')
    const beta = h.connect('beta')
    h.push(questionShown('beta', 'batch-1'))

    expect(h.router.routeQuestions('batch-1')).toBe(beta)
  })

  it('routes a run-config write to the server whose session the id names (runConfigReceived)', () => {
    const h = harness()
    const alpha = h.connect('alpha')
    h.connect('beta')
    h.push(runConfigReceived('alpha', 'session-1'))

    expect(h.router.routeSession('session-1')).toBe(alpha)
  })

  it('also learns a session from sessionSettingsUpdated', () => {
    const h = harness()
    const beta = h.connect('beta')
    h.push(sessionSettingsUpdated('beta', 'session-2'))

    expect(h.router.routeSession('session-2')).toBe(beta)
  })

  it('learns a session from sessionTransition — the id the store holds after a /clear', () => {
    // The store the footer controls address has two writers, and this is the one `runConfigReceived`
    // never covers: after a `/clear` the transition lands a new id while the run-config snapshot (and
    // therefore the still-active controls) is untouched, so an index blind to it would refuse every
    // model / effort / permission-mode change until the next refresh edge.
    const h = harness()
    const alpha = h.connect('alpha')
    h.connect('beta')
    h.push(runConfigReceived('alpha', 'session-1'))
    h.push(sessionTransition('alpha', 'session-2'))

    expect(h.router.routeSession('session-2')).toBe(alpha)
    // Nothing evicts in this space, so the pre-clear id stays routable beside the new one.
    expect(h.router.routeSession('session-1')).toBe(alpha)
  })

  it('treats an idle_evict transition mirroring the previous id as an identical re-write', () => {
    const h = harness()
    const alpha = h.connect('alpha')
    h.push(runConfigReceived('alpha', 'session-1'))
    h.push(sessionTransition('alpha', 'session-1', 'idle_evict'))

    expect(h.router.routeSession('session-1')).toBe(alpha)
    expect(h.log.events).toEqual([])
  })

  it('keeps the three spaces separate — an id learned in one is unroutable in another', () => {
    const h = harness()
    h.connect('alpha')
    h.push(modalShown('alpha', 'shared-id'))

    expect(h.router.routeModal('shared-id')).not.toBeNull()
    expect(h.router.routeQuestions('shared-id')).toBeNull()
    expect(h.router.routeSession('shared-id')).toBeNull()
  })

  it('never learns the empty string — AC3s "no session to address" is not an address', () => {
    const h = harness()
    h.connect('alpha')
    h.push(runConfigReceived('alpha', ''))
    h.push(sessionTransition('alpha', ''))
    h.push(modalShown('alpha', ''))
    h.push(questionShown('alpha', ''))

    expect(h.router.routeSession('')).toBeNull()
    expect(h.router.routeModal('')).toBeNull()
    expect(h.router.routeQuestions('')).toBeNull()
  })

  it('never learns an id longer than MAX_CORRELATION_ID_LENGTH, in any space', () => {
    const h = harness()
    h.connect('alpha')
    const long = 'm'.repeat(MAX_CORRELATION_ID_LENGTH + 1)
    h.push(modalShown('alpha', long))
    h.push(questionShown('alpha', long))
    h.push(runConfigReceived('alpha', long))

    expect(h.router.routeModal(long)).toBeNull()
    expect(h.router.routeQuestions(long)).toBeNull()
    expect(h.router.routeSession(long)).toBeNull()
    expect(h.log.events).toContainEqual({ event: 'correlation-index-full', code: 'modal' })
  })

  it('learns an id of exactly MAX_CORRELATION_ID_LENGTH — the guard is off-by-one free', () => {
    const h = harness()
    const alpha = h.connect('alpha')
    const exact = 'm'.repeat(MAX_CORRELATION_ID_LENGTH)
    h.push(modalShown('alpha', exact))

    expect(h.router.routeModal(exact)).toBe(alpha)
  })

  it('skips an unstamped or stand-in event rather than trusting it', () => {
    const h = harness()
    h.connect('alpha')
    h.push(modalShown(null, 'modal-unbound'))
    h.push(modalShown('', 'modal-empty-origin'))
    // An ASSIGNED `undefined` survives the structured clone across this channel, so it passes an
    // `in` check and only the `typeof` half of `originOf` rejects it. The cast is the test asserting a
    // shape the type system forbids, which is the point of the case.
    const assignedUndefined = { ...modalShown('alpha', 'modal-undefined-origin'), serverId: undefined }
    h.push(assignedUndefined as unknown as StampedDaemonEvent)

    expect(h.router.routeModal('modal-unbound')).toBeNull()
    expect(h.router.routeModal('modal-empty-origin')).toBeNull()
    expect(h.router.routeModal('modal-undefined-origin')).toBeNull()
  })
})

describe('createCorrelationRouter — forwarding', () => {
  it('forwards every observed event unchanged, on the same channel, read arms included', () => {
    const h = harness()
    const shown = modalShown('alpha', 'modal-1')
    const unread = unreadEvent('alpha')
    h.push(shown)
    h.push(unread)

    expect(h.sink.sent).toEqual([
      { channel: DAEMON_EVENT_CHANNEL, event: shown },
      { channel: DAEMON_EVENT_CHANNEL, event: unread }
    ])
    expect(h.sink.sent[0]?.event).toBe(shown)
  })

  it('records BEFORE it forwards, so a synchronous renderer can never route against a stale index', () => {
    const log = createLogFake()
    const connection: FakeConnection = { server: 'alpha' }
    let routedAtForward: FakeConnection | null = null
    let router: CorrelationRouter<FakeConnection> | undefined
    const target: DaemonEventSink = {
      isDestroyed: () => false,
      webContents: {
        send: (_channel: string, event: DaemonEvent): void => {
          if (event.type === 'modalShown') routedAtForward = router?.routeModal(event.modalId) ?? null
        }
      }
    }
    router = createCorrelationRouter<FakeConnection>({
      connectionFor: (serverId) => (serverId === 'alpha' ? connection : null),
      diagnosticLog: log.handle
    })
    router.observe(target).webContents.send(DAEMON_EVENT_CHANNEL, modalShown('alpha', 'modal-1'))

    expect(routedAtForward).toBe(connection)
  })

  it('delegates isDestroyed to the wrapped target and keeps recording while the window is gone', () => {
    const h = harness()
    const alpha = h.connect('alpha')
    h.sink.destroyed = true
    h.push(modalShown('alpha', 'modal-1'))

    expect(h.observed.isDestroyed()).toBe(true)
    expect(h.router.routeModal('modal-1')).toBe(alpha)
  })
})

describe('createCorrelationRouter — eviction on settle', () => {
  it('forgets a modal on modalDismissed, so a later answer refuses rather than routing', () => {
    const h = harness()
    h.connect('alpha')
    h.push(modalShown('alpha', 'modal-1'))
    h.push(modalDismissed('alpha', 'modal-1'))

    expect(h.router.routeModal('modal-1')).toBeNull()
    expect(h.log.events).toContainEqual({ event: 'modal-route-refused', code: 'unknown-correlation' })
  })

  it('forgets a modal on modalAnswerRejected too', () => {
    const h = harness()
    h.connect('alpha')
    h.push(modalShown('alpha', 'modal-1'))
    h.push(modalAnswerRejected('alpha', 'modal-1'))

    expect(h.router.routeModal('modal-1')).toBeNull()
  })

  it('forgets a batch on questionDismissed', () => {
    const h = harness()
    h.connect('alpha')
    h.push(questionShown('alpha', 'batch-1'))
    h.push(questionDismissed('alpha', 'batch-1'))

    expect(h.router.routeQuestions('batch-1')).toBeNull()
  })

  it('relearns a re-issued id after it settled', () => {
    const h = harness()
    const alpha = h.connect('alpha')
    h.push(modalShown('alpha', 'modal-1'))
    h.push(modalDismissed('alpha', 'modal-1'))
    h.push(modalShown('alpha', 'modal-1'))

    expect(h.router.routeModal('modal-1')).toBe(alpha)
  })

  it('ignores a settle stamped by a DIFFERENT server — no cross-host retire of the operators prompt', () => {
    const h = harness()
    const alpha = h.connect('alpha')
    h.connect('beta')
    h.push(modalShown('alpha', 'modal-1'))
    h.push(questionShown('alpha', 'batch-1'))
    h.push(modalDismissed('beta', 'modal-1'))
    h.push(modalAnswerRejected('beta', 'modal-1'))
    h.push(questionDismissed('beta', 'batch-1'))

    expect(h.router.routeModal('modal-1')).toBe(alpha)
    expect(h.router.routeQuestions('batch-1')).toBe(alpha)
  })

  it('never evicts a session — that space has no settle event and inherits the grow-and-cap posture', () => {
    const h = harness()
    const alpha = h.connect('alpha')
    h.push(runConfigReceived('alpha', 'session-1'))
    h.push(sessionSettingsUpdated('alpha', 'session-1'))

    expect(h.router.routeSession('session-1')).toBe(alpha)
  })
})

describe('createCorrelationRouter — the write rule', () => {
  it('re-points to the server that re-delivered the id, so the index agrees with the rendered prompt', () => {
    const h = harness()
    h.connect('alpha')
    const beta = h.connect('beta')
    h.push(modalShown('alpha', 'modal-1'))
    h.push(modalShown('beta', 'modal-1'))

    expect(h.router.routeModal('modal-1')).toBe(beta)
    expect(h.log.events).toContainEqual({ event: 'modal-reindexed', code: 'reassigned' })
  })

  it('re-points a batch and a session on the same terms', () => {
    const h = harness()
    h.connect('alpha')
    const beta = h.connect('beta')
    h.push(questionShown('alpha', 'batch-1'))
    h.push(questionShown('beta', 'batch-1'))
    h.push(runConfigReceived('alpha', 'session-1'))
    h.push(runConfigReceived('beta', 'session-1'))

    expect(h.router.routeQuestions('batch-1')).toBe(beta)
    expect(h.router.routeSession('session-1')).toBe(beta)
    expect(h.log.events).toContainEqual({ event: 'question-reindexed', code: 'reassigned' })
    expect(h.log.events).toContainEqual({ event: 'session-reindexed', code: 'reassigned' })
  })

  it('logs nothing when an identical re-write changes no owner', () => {
    const h = harness()
    h.connect('alpha')
    h.push(modalShown('alpha', 'modal-1'))
    h.push(modalShown('alpha', 'modal-1'))
    h.push(runConfigReceived('alpha', 'session-1'))
    h.push(sessionSettingsUpdated('alpha', 'session-1'))

    expect(h.log.events).toEqual([])
  })
})

describe('createCorrelationRouter — the two refusals', () => {
  it('refuses an id no index knows, naming which of the three kinds was refused', () => {
    const h = harness()
    h.connect('alpha')

    expect(h.router.routeModal('nope')).toBeNull()
    expect(h.router.routeQuestions('nope')).toBeNull()
    expect(h.router.routeSession('nope')).toBeNull()
    expect(h.log.events).toEqual([
      { event: 'modal-route-refused', code: 'unknown-correlation' },
      { event: 'question-route-refused', code: 'unknown-correlation' },
      { event: 'session-route-refused', code: 'unknown-correlation' }
    ])
  })

  it('refuses a known id whose server has no live connection, and names the kind there too', () => {
    const h = harness()
    h.connect('alpha')
    h.push(modalShown('alpha', 'modal-1'))
    h.disconnect('alpha')

    expect(h.router.routeModal('modal-1')).toBeNull()
    expect(h.log.events).toEqual([{ event: 'modal-route-refused', code: 'server-not-connected' }])
  })

  it('deletes the mapping on that refusal, so a reconnect alone does not make it routable again', () => {
    const h = harness()
    h.connect('alpha')
    h.push(modalShown('alpha', 'modal-1'))
    h.disconnect('alpha')
    h.router.routeModal('modal-1')
    h.connect('alpha')

    expect(h.router.routeModal('modal-1')).toBeNull()
    expect(h.codes()).toEqual(['server-not-connected', 'unknown-correlation'])
  })

  it('refuses without a diagnosticLog rather than throwing — the logger is optional', () => {
    const router = createCorrelationRouter<FakeConnection>({ connectionFor: () => null })

    expect(router.routeModal('nope')).toBeNull()
    expect(router.routeQuestions('nope')).toBeNull()
    expect(router.routeSession('nope')).toBeNull()
  })
})

describe('createCorrelationRouter — the entry cap', () => {
  it('stops learning NEW ids at the cap, in each space independently, failing closed', () => {
    const h = harness()
    h.connect('alpha')
    for (let i = 0; i < MAX_INDEXED_CORRELATIONS; i += 1) h.push(modalShown('alpha', `modal-${i}`))
    h.push(modalShown('alpha', 'one-too-many'))
    h.push(questionShown('alpha', 'batch-1'))

    expect(h.router.routeModal('modal-0')).not.toBeNull()
    expect(h.router.routeModal('one-too-many')).toBeNull()
    expect(h.router.routeQuestions('batch-1')).not.toBeNull()
  })

  it('still re-points an EXISTING id at the cap — an overwrite does not grow the map', () => {
    const h = harness()
    h.connect('alpha')
    const beta = h.connect('beta')
    for (let i = 0; i < MAX_INDEXED_CORRELATIONS; i += 1) h.push(modalShown('alpha', `modal-${i}`))
    h.push(modalShown('beta', 'modal-0'))

    expect(h.router.routeModal('modal-0')).toBe(beta)
  })

  it('latches the cap log per index, so a spraying daemon records once and not once per row', () => {
    const h = harness()
    h.connect('alpha')
    for (let i = 0; i < MAX_INDEXED_CORRELATIONS + 5; i += 1) h.push(modalShown('alpha', `modal-${i}`))

    expect(h.log.events.filter((entry) => entry.event === 'correlation-index-full')).toEqual([
      { event: 'correlation-index-full', code: 'modal' }
    ])
  })
})

describe('createCorrelationRouter — AC4s never-log rule', () => {
  it('puts no correlation id in any log field, on any path', () => {
    // Every id below is a distinctive token; if any reaches `event` or `code`, this fails. The
    // question batch id is the load-bearing one — a one-time unguessable nonce — but the rule is
    // asserted for all three so no future arm can leak one either.
    const ids = ['modal-nonce-zzz', 'batch-nonce-zzz', 'session-nonce-zzz', 'unknown-nonce-zzz']
    const h = harness()
    h.connect('alpha')
    h.connect('beta')
    h.push(modalShown('alpha', ids[0] as string))
    h.push(modalShown('beta', ids[0] as string))
    h.push(questionShown('alpha', ids[1] as string))
    h.push(runConfigReceived('alpha', ids[2] as string))
    h.push(runConfigReceived('beta', ids[2] as string))
    // The transition arm on a logging path too: a re-point back to alpha, which records `reassigned`.
    h.push(sessionTransition('alpha', ids[2] as string))
    h.push(modalShown('alpha', 'z'.repeat(MAX_CORRELATION_ID_LENGTH + 1)))
    h.disconnect('alpha')
    h.router.routeQuestions(ids[1] as string)
    h.router.routeSession(ids[3] as string)
    h.router.routeModal(ids[3] as string)

    expect(h.log.events.length).toBeGreaterThan(0)
    for (const entry of h.log.events) {
      const serialised = JSON.stringify(entry)
      for (const id of ids) expect(serialised).not.toContain(id)
    }
  })
})
