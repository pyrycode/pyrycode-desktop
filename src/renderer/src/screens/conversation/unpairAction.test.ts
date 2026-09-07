import { describe, it, expect, vi } from 'vitest'
import { runUnpair, serverIdForOpenConversation, type UnpairDeps } from './unpairAction'
import type { SessionAction } from '../../store/sessionStore'
import type { UnpairResult } from '@shared/ipc/unpair'
import type { ServerInfoValue } from '../../store/serverInfoStore'
import type { ServerConversationSummary } from '../../store/conversationListStore'

// runUnpair is a pure, React-free helper (the composerSend precedent): its effects — the per-server
// unpair invoke, the server-info refresh, the conditional App route flip, and the store dispatch —
// are injected, so it is exercised here with plain spies. No React, no store, no Electron bridge, no
// DOM. The container is thin glue; the branch logic lives here.
//
// #1163 moved this helper onto the per-server channel and made the flip CONDITIONAL. It now delegates
// the erase→refresh→maybe-flip sequence to `runUnpairServer` and adds exactly one thing on top: the
// session-store dispatch on the error path, which is the whole reason the two helpers stayed apart
// (`UnpairServerDeps` has no `dispatch` member, so a Settings row's failed erase cannot put the whole
// app into a `failed` status while another server is connected and fine). The tests below therefore
// assert the composed behaviour, not a second copy of the sequence.

const SURVIVOR: ServerInfoValue = { serverId: 'pyrybox-2', relayUrl: 'wss://second-relay.example' }

/** Build the deps with plain spies, so each test names only the arm it varies. */
function deps(
  overrides: Partial<UnpairDeps> = {}
): UnpairDeps & {
  unpairServer: ReturnType<typeof vi.fn>
  refreshServers: ReturnType<typeof vi.fn>
  onLastServerUnpaired: ReturnType<typeof vi.fn>
  dispatch: ReturnType<typeof vi.fn>
  clearServerScopedState: ReturnType<typeof vi.fn>
} {
  return {
    unpairServer: vi.fn(async (): Promise<UnpairResult> => ({ result: 'ok' })),
    refreshServers: vi.fn(async (): Promise<ServerInfoValue[]> => [SURVIVOR]),
    onLastServerUnpaired: vi.fn(),
    // #1196: inherited through `UnpairDeps extends UnpairServerDeps`, not re-declared there — which is
    // exactly what AC4 asks for, and what this file exists to pin on the composer's side of the hop.
    clearServerScopedState: vi.fn(),
    dispatch: vi.fn(),
    ...overrides
  } as never
}

/** Read back the one dispatched action, asserting it is the synthesized unpair failure. */
function expectOneUnpairFailure(dispatch: ReturnType<typeof vi.fn>): void {
  expect(dispatch).toHaveBeenCalledTimes(1)
  const action = dispatch.mock.calls[0][0] as SessionAction
  expect(action.type).toBe('failed')
  if (action.type === 'failed') {
    expect(action.error.code).toBe('unpair')
  }
}

describe('runUnpair', () => {
  it('erases exactly the named server, once, through the per-server channel (AC1)', async () => {
    const d = deps()

    await runUnpair(d, 'fake-daemon')

    expect(d.unpairServer).toHaveBeenCalledTimes(1)
    expect(d.unpairServer).toHaveBeenCalledWith('fake-daemon')
  })

  it('ok with servers remaining → refreshes, does NOT flip, dispatches nothing (AC2)', async () => {
    const d = deps()

    const outcome = await runUnpair(d, 'fake-daemon')

    expect(outcome).toBe('ok')
    expect(d.refreshServers).toHaveBeenCalledTimes(1)
    // The assertion this slice exists for. Before #1163 the flip was unconditional on `ok`, so
    // recovering server A's dead connection also ran the thirteen-store clearPairingScopedState and
    // routed the whole app to the pairing screen while server B was still paired and connected.
    expect(d.onLastServerUnpaired).not.toHaveBeenCalled()
    // #531's rule survives the migration: the session reset is owned by clearPairingScopedState, which
    // the flip reaches through PairedShell — never dispatched from here on a success path.
    expect(d.dispatch).not.toHaveBeenCalled()
    // #1196, AC4: the Re-pair path drops the departed server's rows and threads exactly as the Settings
    // row's Unpair does, because it composes with the SAME helper rather than carrying a second copy.
    // Pinned here as well as next door: a clear implemented in `ServerRowControl` alone would satisfy
    // every other criterion while leaving this path broken, and that is the half-fix AC4 exists to
    // catch. The id is the erased one, forwarded through the hop unchanged.
    expect(d.clearServerScopedState).toHaveBeenCalledTimes(1)
    expect(d.clearServerScopedState).toHaveBeenCalledWith('fake-daemon')
  })

  it('a null serverId erases nothing and therefore clears nothing (#1196)', async () => {
    // The refusal arm: the open conversation could not be attributed to exactly one server, so nothing
    // is invoked at all — and the new effect inherits that fail-safe rather than sitting outside it.
    const d = deps()

    expect(await runUnpair(d, null)).toBe('error')

    expect(d.unpairServer).not.toHaveBeenCalled()
    expect(d.clearServerScopedState).not.toHaveBeenCalled()
  })

  it('ok with an empty refreshed list → flips exactly once, dispatches nothing', async () => {
    const d = deps({ refreshServers: vi.fn(async (): Promise<ServerInfoValue[]> => []) })

    const outcome = await runUnpair(d, 'fake-daemon')

    expect(outcome).toBe('ok')
    expect(d.onLastServerUnpaired).toHaveBeenCalledTimes(1)
    expect(d.dispatch).not.toHaveBeenCalled()
  })

  it('error → dispatches one failed (error.code "unpair"), never refreshes, never flips', async () => {
    const d = deps({
      unpairServer: vi.fn(async (): Promise<UnpairResult> => ({ result: 'error' }))
    })

    const outcome = await runUnpair(d, 'fake-daemon')

    expect(outcome).toBe('error')
    // The ok-only fail-safe, inherited rather than restated: nothing downstream of the erase runs on a
    // non-ok outcome, so the UI can never claim a pairing was forgotten while its record may still sit
    // on disk. The dispatch is the one thing this helper adds — the composer's Re-pair appears only in
    // an already-terminal error, which is why escalating there is right and why the Settings row,
    // sharing the app-wide session store with a healthy second server, must not.
    expect(d.refreshServers).not.toHaveBeenCalled()
    expect(d.onLastServerUnpaired).not.toHaveBeenCalled()
    expectOneUnpairFailure(d.dispatch)
  })

  it('a rejected unpairServer() invoke is coerced to the error path — does not throw', async () => {
    const d = deps({
      unpairServer: vi.fn(async (): Promise<UnpairResult> => {
        throw new Error('handler absent')
      })
    })

    const outcome = await runUnpair(d, 'fake-daemon')

    expect(outcome).toBe('error')
    expect(d.refreshServers).not.toHaveBeenCalled()
    expect(d.onLastServerUnpaired).not.toHaveBeenCalled()
    expectOneUnpairFailure(d.dispatch)
  })

  it('an unresolvable server erases NOTHING and reports the failure', async () => {
    // The fail-safe on the one input the container cannot guarantee. `serverIdForOpenConversation`
    // answers null whenever the open conversation cannot be attributed to exactly one server, and a
    // null id must not be handed to the channel: an empty or guessed id would take a round trip to
    // main and come back `error` anyway, but only after asking the store to erase something. Refusing
    // before the invoke keeps "nothing was erased" a fact about this function rather than about the
    // handler's matched check.
    const d = deps()

    const outcome = await runUnpair(d, null)

    expect(outcome).toBe('error')
    expect(d.unpairServer).not.toHaveBeenCalled()
    expect(d.refreshServers).not.toHaveBeenCalled()
    expect(d.onLastServerUnpaired).not.toHaveBeenCalled()
    expectOneUnpairFailure(d.dispatch)
  })
})

// The rows the resolution runs against: two servers, distinct conversation ids, each row carrying the
// client-bound `serverId` stamp `bindServerOrigin` put on it main-side. Only the fields the lookup
// reads are meaningful; the rest are fixed literals.
function row(id: string, serverId: unknown): ServerConversationSummary {
  return {
    id,
    name: `chat ${id}`,
    is_promoted: false,
    is_archived: false,
    cwd: '/w',
    last_message_ts: '2026-07-07T12:00:00.000Z',
    last_used_at: '2026-07-07T12:00:00.000Z',
    serverId
  } as ServerConversationSummary
}

const TWO_SERVERS: readonly ServerConversationSummary[] = [
  row('a-1', 'pyrybox-a'),
  row('b-1', 'pyrybox-b')
]

describe('serverIdForOpenConversation', () => {
  it('answers the stamp of the row the open conversation is, across a two-server list', () => {
    expect(serverIdForOpenConversation(TWO_SERVERS, 'b-1')).toBe('pyrybox-b')
    expect(serverIdForOpenConversation(TWO_SERVERS, 'a-1')).toBe('pyrybox-a')
  })

  it('answers null with no conversation open, no list loaded, or no matching row', () => {
    expect(serverIdForOpenConversation(TWO_SERVERS, null)).toBeNull()
    expect(serverIdForOpenConversation(null, 'a-1')).toBeNull()
    expect(serverIdForOpenConversation(TWO_SERVERS, 'absent')).toBeNull()
    expect(serverIdForOpenConversation([], 'a-1')).toBeNull()
  })

  it('answers null for a row whose stamp is not a string', () => {
    // ConversationListOrigin is `string | null | undefined`, so a stamp is not necessarily a server
    // id. An unstamped row names no machine, and a Re-pair that names no machine must erase nothing.
    expect(serverIdForOpenConversation([row('a-1', null)], 'a-1')).toBeNull()
    expect(serverIdForOpenConversation([row('a-1', undefined)], 'a-1')).toBeNull()
  })

  it('answers null when TWO servers report the same conversation id (security review)', () => {
    // The conversation id being matched on is the DAEMON's, and the store holds every server's rows in
    // one flat list — ChannelList already keys rows by `c.id` alone, so a collision across servers is
    // a condition the app does not otherwise prevent. A `find` here would resolve to whichever row was
    // stamped first, letting a confused or hostile daemon on one machine steer a Re-pair pressed on
    // another into forgetting the wrong one. Ambiguity is refused instead: the fail-safe path erases
    // nothing and reports failure.
    const collided = [row('shared', 'pyrybox-a'), row('shared', 'pyrybox-b')]
    expect(serverIdForOpenConversation(collided, 'shared')).toBeNull()
    // A collision elsewhere in the list does not poison an unambiguous lookup.
    expect(serverIdForOpenConversation([...collided, row('a-1', 'pyrybox-a')], 'a-1')).toBe(
      'pyrybox-a'
    )
  })
})
