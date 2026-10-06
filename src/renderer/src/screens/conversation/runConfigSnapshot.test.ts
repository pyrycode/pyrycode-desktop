import { describe, it, expect, vi } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import type { MessagePayload } from '@shared/wire/types'
import {
  toRunConfigSnapshot,
  toSnapshotSessionId,
  requestRunConfigSnapshot,
  subscribeRunConfig
} from './runConfigSnapshot'

// Framework-free data-path tests with injected spies (the composerSend / logDataDownload idiom):
// no React, no store, no Electron.

// The conversation the OPEN chat is, in the subscribeRunConfig gate below (#1176). Every reply
// fixture in this file names it unless a test is deliberately exercising the mismatch.
const OPEN = 'conv-open'
// A second, real conversation — the one a reply still in flight when the operator switched chats
// describes. Shares no substring with OPEN, so a `toContain`-style miss cannot read as a match.
const OTHER = 'conv-elsewhere'

const message: MessagePayload = {
  conversation_id: 'c',
  message_id: 'm',
  role: 'assistant',
  text: 't'
}

describe('toRunConfigSnapshot', () => {
  it('preserves the optional memory search report and explicit disabled flags', () => {
    const base: DaemonEvent = {
      type: 'runConfigReceived', conversationId: OPEN, sessionId: 'session', model: '',
      effort: '', yolo: false, permissionMode: '', used_tokens: 0, window_tokens: 0
    }
    expect(toRunConfigSnapshot(base)).not.toHaveProperty('memorySearch')
    const memorySearch = { availability: 'available' as const, providers: [
      { id: 'local', display_name: 'Local index', installed: true, enabled: false, availability: 'unavailable' as const }
    ] }
    expect(toRunConfigSnapshot({ ...base, memorySearch })?.memorySearch).toEqual(memorySearch)
  })
  it('maps a runConfigReceived to the five display fields verbatim, including empty/false (AC5)', () => {
    // Input carries the two usage ints (#191); #192 widens the OUTPUT to also carry them, mapping the
    // wire snake_case (used_tokens / window_tokens) to the store's camelCase.
    const event: DaemonEvent = {
      type: 'runConfigReceived',
      conversationId: OPEN,
      sessionId: 'sess-a',
      model: '',
      effort: '',
      yolo: false,
      permissionMode: 'default',
      used_tokens: 45000,
      window_tokens: 200000
    }
    expect(toRunConfigSnapshot(event)).toEqual({
      model: '',
      effort: '',
      yolo: false,
      permissionMode: 'default',
      usedTokens: 45000,
      windowTokens: 200000
    })
  })

  it('carries non-empty values through verbatim', () => {
    const event: DaemonEvent = {
      type: 'runConfigReceived',
      conversationId: OPEN,
      sessionId: 'sess-a',
      model: 'claude-x',
      effort: 'high',
      yolo: true,
      permissionMode: 'bypassPermissions',
      used_tokens: 45000,
      window_tokens: 200000
    }
    expect(toRunConfigSnapshot(event)).toEqual({
      model: 'claude-x',
      effort: 'high',
      yolo: true,
      permissionMode: 'bypassPermissions',
      usedTokens: 45000,
      windowTokens: 200000
    })
  })

  it('carries permissionMode verbatim for each of the six modes, and for one outside them (#1020)', () => {
    // No mapping to or from `yolo`, and no client-side allowlist: the read half carries six modes
    // where the write half accepts five (#1021), so the mapper copies whatever arrived. The seventh
    // case is a value the daemon should never send — it still passes through, because deciding what
    // to DISPLAY for an unknown mode belongs to #682, not to this mapper.
    const modes = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions', 'nonsense']
    for (const mode of modes) {
      const event: DaemonEvent = {
        type: 'runConfigReceived',
        conversationId: OPEN,
        sessionId: 'sess-a',
        model: 'claude-x',
        effort: 'high',
        // Deliberately `false` beside `bypassPermissions` in one iteration: the mapper must not
        // reconcile the two, even though a real daemon keeps them in agreement.
        yolo: false,
        permissionMode: mode,
        used_tokens: 45000,
        window_tokens: 200000
      }
      expect(toRunConfigSnapshot(event)?.permissionMode).toBe(mode)
    }
  })

  it('carries permissionMode: "" (no session resolved) through, never coerced (#1020)', () => {
    // The all-zero reply's reading. '' is held as '' — not mapped to 'default', not to null, and not
    // inferred from `yolo: false`. It is the same verbatim-hold the empty session_id already gets.
    const event: DaemonEvent = {
      type: 'runConfigReceived',
      conversationId: OPEN,
      sessionId: '',
      model: '',
      effort: '',
      yolo: false,
      permissionMode: '',
      used_tokens: 0,
      window_tokens: 0
    }
    expect(toRunConfigSnapshot(event)).toHaveProperty('permissionMode', '')
    expect(toSnapshotSessionId(event)).toBe('')
  })

  it('carries window_tokens: 0 (usage unavailable) through as windowTokens: 0, not coerced', () => {
    const event: DaemonEvent = {
      type: 'runConfigReceived',
      conversationId: OPEN,
      sessionId: 'sess-a',
      model: '',
      effort: '',
      yolo: false,
      permissionMode: 'default',
      used_tokens: 0,
      window_tokens: 0
    }
    expect(toRunConfigSnapshot(event)).toEqual({
      model: '',
      effort: '',
      yolo: false,
      permissionMode: 'default',
      usedTokens: 0,
      windowTokens: 0
    })
  })

  it('returns null for a sample of unrelated daemon events (the filter)', () => {
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      { type: 'disconnected' },
      { type: 'messageReceived', message },
      { type: 'debugBundleSaved', path: '/tmp/pyry-debug.tar.gz' }
    ]
    for (const event of others) expect(toRunConfigSnapshot(event)).toBeNull()
  })
})

describe('requestRunConfigSnapshot', () => {
  it('fires exactly one requestSessionSettings naming the given conversation (#946)', () => {
    const sendCommand = vi.fn()
    requestRunConfigSnapshot(sendCommand, 'conv-1')
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'requestSessionSettings',
      payload: { conversation_id: 'conv-1' }
    })
  })

  // The daemon has answered only the conversation a request names since 2026-08-20
  // (pyrycode#1586/#1610), and answers an unnamed one with a zero-valued reply rather than an error
  // frame. #945 gave the frame the field; this asserts the renderer fills it and carries nothing
  // else — the key sets, not just the shape, so an extra field cannot slip onto the wire unnoticed.
  it('carries the conversation id and nothing else (#946)', () => {
    const sendCommand = vi.fn()
    requestRunConfigSnapshot(sendCommand, 'conv-1')
    const command = sendCommand.mock.calls[0][0]
    expect(Object.keys(command)).toEqual(['type', 'payload'])
    expect(Object.keys(command.payload)).toEqual(['conversation_id'])
  })

  // AC2, and the ONLY proof of this branch anywhere: the real-daemon spec seeds and opens a promoted
  // conversation, so an active one always exists there, and no renderer spec in this repo can run an
  // effect to drive the two mount sites. A request that names nothing draws the zero reply, and
  // `setSnapshot` replaces the WHOLE snapshot — so sending one would wipe held values that the reply
  // could never have improved. Not sending is the fix; there is nothing to degrade to.
  it('sends nothing when no conversation is active (#946)', () => {
    const sendCommand = vi.fn()
    requestRunConfigSnapshot(sendCommand, null)
    expect(sendCommand).not.toHaveBeenCalled()
  })

  // The same unresolvable request spelled differently: '' serialises to the identical frame and draws
  // the identical zero reply, so it carries the identical wipe hazard. One falsy check covers both
  // because it is one failure, not two. The IPC-boundary guard (isRequestSessionSettingsPayload)
  // deliberately still ACCEPTS '' — it checks type, not emptiness; refusing to send an unaddressable
  // id is this helper's job, not the boundary's.
  it('sends nothing for an empty conversation id (#946)', () => {
    const sendCommand = vi.fn()
    requestRunConfigSnapshot(sendCommand, '')
    expect(sendCommand).not.toHaveBeenCalled()
  })
})

describe('toSnapshotSessionId', () => {
  it('maps a runConfigReceived to its session id', () => {
    const event: DaemonEvent = {
      type: 'runConfigReceived',
      conversationId: OPEN,
      sessionId: 'sess-a',
      model: 'opus',
      effort: 'high',
      yolo: false,
      permissionMode: 'default',
      used_tokens: 0,
      window_tokens: 200000
    }
    expect(toSnapshotSessionId(event)).toBe('sess-a')
  })

  it('maps an empty session id to "" verbatim, NOT to null', () => {
    // '' is the daemon saying "I have no session to address" — a real answer. Returning null here
    // would leave a stale id in the store, so the sheet would stay operable and address a session
    // the daemon just said it cannot resolve. The gate, not this mapper, turns '' into inert.
    const event: DaemonEvent = {
      type: 'runConfigReceived',
      conversationId: OPEN,
      sessionId: '',
      model: '',
      effort: '',
      yolo: false,
      permissionMode: 'default',
      used_tokens: 0,
      window_tokens: 200000
    }
    expect(toSnapshotSessionId(event)).toBe('')
  })

  it('returns null for a sample of unrelated daemon events (the filter)', () => {
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      { type: 'disconnected' },
      { type: 'messageReceived', message }
    ]
    for (const event of others) expect(toSnapshotSessionId(event)).toBeNull()
  })
})

describe('subscribeRunConfig', () => {
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

  it('subscribes exactly once', () => {
    const bridge = fakeBridge()
    subscribeRunConfig(bridge.onDaemonEvent, vi.fn(), vi.fn(), () => OPEN)
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('writes the verbatim snapshot on a runConfigReceived event (AC3/AC5)', () => {
    const bridge = fakeBridge()
    const setSnapshot = vi.fn()
    subscribeRunConfig(bridge.onDaemonEvent, setSnapshot, vi.fn(), () => OPEN)

    bridge.emit({
      type: 'runConfigReceived',
      conversationId: OPEN,
      sessionId: 'sess-a',
      model: '',
      effort: '',
      yolo: false,
      permissionMode: 'default',
      used_tokens: 45000,
      window_tokens: 200000
    })
    expect(setSnapshot).toHaveBeenCalledTimes(1)
    expect(setSnapshot).toHaveBeenCalledWith({
      model: '',
      effort: '',
      yolo: false,
      permissionMode: 'default',
      usedTokens: 45000,
      windowTokens: 200000
    })
  })

  it('does not call setSnapshot for an unrelated event', () => {
    const bridge = fakeBridge()
    const setSnapshot = vi.fn()
    subscribeRunConfig(bridge.onDaemonEvent, setSnapshot, vi.fn(), () => OPEN)

    bridge.emit({ type: 'connecting' })
    expect(setSnapshot).not.toHaveBeenCalled()
  })

  it('a later event replaces the held value — most recent snapshot wins (AC4)', () => {
    const bridge = fakeBridge()
    const setSnapshot = vi.fn()
    subscribeRunConfig(bridge.onDaemonEvent, setSnapshot, vi.fn(), () => OPEN)

    bridge.emit({
      type: 'runConfigReceived',
      conversationId: OPEN,
      sessionId: 'sess-a',
      model: 'a',
      effort: 'low',
      yolo: false,
      permissionMode: 'default',
      used_tokens: 10000,
      window_tokens: 200000
    })
    bridge.emit({
      type: 'runConfigReceived',
      conversationId: OPEN,
      sessionId: 'sess-a',
      model: 'b',
      effort: 'high',
      yolo: true,
      permissionMode: 'bypassPermissions',
      used_tokens: 20000,
      window_tokens: 200000
    })
    expect(setSnapshot).toHaveBeenNthCalledWith(1, {
      model: 'a',
      effort: 'low',
      yolo: false,
      permissionMode: 'default',
      usedTokens: 10000,
      windowTokens: 200000
    })
    expect(setSnapshot).toHaveBeenNthCalledWith(2, {
      model: 'b',
      effort: 'high',
      yolo: true,
      permissionMode: 'bypassPermissions',
      usedTokens: 20000,
      windowTokens: 200000
    })
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeRunConfig(bridge.onDaemonEvent, vi.fn(), vi.fn(), () => OPEN)
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  it('feeds BOTH setters from ONE listener on a single event (#491)', () => {
    // The values and the session id arrive on the same frame and are only meaningful together: the
    // values describe the session the id names. One subscription, not two, so there is no state
    // where the sheet shows one session's values while addressing another.
    const bridge = fakeBridge()
    const setSnapshot = vi.fn()
    const setSessionId = vi.fn()
    subscribeRunConfig(bridge.onDaemonEvent, setSnapshot, setSessionId, () => OPEN)

    bridge.emit({
      type: 'runConfigReceived',
      conversationId: OPEN,
      sessionId: 'sess-a',
      model: 'opus',
      effort: 'high',
      yolo: false,
      permissionMode: 'default',
      used_tokens: 100,
      window_tokens: 200000
    })

    expect(bridge.subscribeCalls()).toBe(1)
    expect(setSnapshot).toHaveBeenCalledTimes(1)
    expect(setSessionId).toHaveBeenCalledTimes(1)
    expect(setSessionId).toHaveBeenCalledWith('sess-a')
  })

  it('writes an empty session id through, so the gate can close on it', () => {
    const bridge = fakeBridge()
    const setSessionId = vi.fn()
    subscribeRunConfig(bridge.onDaemonEvent, vi.fn(), setSessionId, () => OPEN)

    bridge.emit({
      type: 'runConfigReceived',
      conversationId: OPEN,
      sessionId: '',
      model: '',
      effort: '',
      yolo: false,
      permissionMode: 'default',
      used_tokens: 0,
      window_tokens: 200000
    })

    expect(setSessionId).toHaveBeenCalledWith('')
  })

  it('does not call setSessionId for an unrelated event', () => {
    const bridge = fakeBridge()
    const setSessionId = vi.fn()
    subscribeRunConfig(bridge.onDaemonEvent, vi.fn(), setSessionId, () => OPEN)

    bridge.emit({ type: 'connecting' })
    expect(setSessionId).not.toHaveBeenCalled()
  })

  // #1176 — the attribution gate. A reply describes exactly one conversation, resolved in the
  // background process from the request it answers; a reply describing anything but the open one
  // changes nothing here.

  /** A reply naming `conversationId`, with values distinct enough to spot in a wrong-chat write. */
  function reply(conversationId: string): DaemonEvent {
    return {
      type: 'runConfigReceived',
      conversationId,
      sessionId: `sess-${conversationId}`,
      model: `model-${conversationId}`,
      effort: 'high',
      yolo: false,
      permissionMode: 'default',
      used_tokens: 1000,
      window_tokens: 200000
    }
  }

  it('leaves BOTH stores untouched for a reply naming another conversation (AC2)', () => {
    // AC2 is a claim about both writes, so both are asserted: gating only the snapshot would leave
    // the write controls addressing the other chat's session, which is the sharp half of the defect.
    const bridge = fakeBridge()
    const setSnapshot = vi.fn()
    const setSessionId = vi.fn()
    subscribeRunConfig(bridge.onDaemonEvent, setSnapshot, setSessionId, () => OPEN)

    bridge.emit(reply(OTHER))

    expect(setSnapshot).not.toHaveBeenCalled()
    expect(setSessionId).not.toHaveBeenCalled()
  })

  it('leaves BOTH stores untouched for a reply arriving while no conversation is open (AC3)', () => {
    // Landed NOWHERE rather than latching. Before #1176 this reply waited in the stores for whichever
    // chat opened next; a null open id now matches no reply, since the resolved id is always a string.
    const bridge = fakeBridge()
    const setSnapshot = vi.fn()
    const setSessionId = vi.fn()
    subscribeRunConfig(bridge.onDaemonEvent, setSnapshot, setSessionId, () => null)

    bridge.emit(reply(OPEN))

    expect(setSnapshot).not.toHaveBeenCalled()
    expect(setSessionId).not.toHaveBeenCalled()
  })

  it('reads the open conversation PER EVENT, not once at subscribe time (AC2)', () => {
    // The mistake this exists to redden: resolving the id into a closure at subscription. That
    // compiles, passes every single-event test above, and reinstates the whole defect — the listener
    // is app-lifetime, so a captured id would freeze at whatever was open when the leaf mounted.
    // One subscription, one moving getter, two events: the first lands, the second must not.
    const bridge = fakeBridge()
    const setSnapshot = vi.fn()
    const setSessionId = vi.fn()
    let open: string | null = OPEN
    subscribeRunConfig(bridge.onDaemonEvent, setSnapshot, setSessionId, () => open)

    bridge.emit(reply(OPEN))
    expect(setSnapshot).toHaveBeenCalledTimes(1)

    open = OTHER
    bridge.emit(reply(OPEN))

    expect(setSnapshot).toHaveBeenCalledTimes(1)
    expect(setSessionId).toHaveBeenCalledTimes(1)
  })

  it('still lands a reply naming the open conversation in both stores, verbatim (AC3)', () => {
    // The positive half, so the three drops above cannot pass by gating everything.
    const bridge = fakeBridge()
    const setSnapshot = vi.fn()
    const setSessionId = vi.fn()
    subscribeRunConfig(bridge.onDaemonEvent, setSnapshot, setSessionId, () => OPEN)

    bridge.emit(reply(OPEN))

    expect(setSnapshot).toHaveBeenCalledWith({
      model: `model-${OPEN}`,
      effort: 'high',
      yolo: false,
      permissionMode: 'default',
      usedTokens: 1000,
      windowTokens: 200000
    })
    expect(setSessionId).toHaveBeenCalledWith(`sess-${OPEN}`)
  })
})


describe('applied effort readings', () => {
  it.each([undefined, null, '', 'medium'])('preserves %j independently of saved effort', effectiveEffort => {
    const event: DaemonEvent = {
      type: 'runConfigReceived', conversationId: OPEN, sessionId: 'session', model: '',
      effort: 'high', yolo: false, permissionMode: 'default', used_tokens: 0, window_tokens: 0,
      ...(effectiveEffort === undefined ? {} : { effectiveEffort })
    }
    const snapshot = toRunConfigSnapshot(event)
    expect(snapshot).toHaveProperty('effort', 'high')
    expect(snapshot?.effectiveEffort).toBe(effectiveEffort)
    expect(Object.prototype.hasOwnProperty.call(snapshot, 'effectiveEffort')).toBe(effectiveEffort !== undefined)
  })
})

// #1655, #1726: the four capability flags reach the snapshot verbatim. An unreported flag — which crosses IPC as
// an explicitly-undefined property — is omitted, so the snapshot never holds a key the daemon did not send.
describe('capability flags', () => {
  const FLAGS = ['slashCommands', 'mcpServers', 'contextUsageDetail', 'midTurnInput'] as const
  it.each(FLAGS.flatMap((flag) => [true, false, undefined].map((value) => [flag, value] as const)))(
    'copies %s = %j',
    (flag, value) => {
      const event: DaemonEvent = {
        type: 'runConfigReceived', conversationId: OPEN, sessionId: 'session', model: '',
        effort: '', yolo: false, permissionMode: 'default', used_tokens: 0, window_tokens: 0,
        [flag]: value
      }
      const snapshot = toRunConfigSnapshot(event)
      expect(snapshot?.[flag]).toBe(value)
      expect(Object.prototype.hasOwnProperty.call(snapshot, flag)).toBe(value !== undefined)
    }
  )
})
