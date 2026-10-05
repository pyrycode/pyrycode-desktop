import { describe, it, expect, vi } from 'vitest'
import type { DaemonEvent, StampedDaemonEvent } from '@shared/ipc/events'
import type { RendererCommand } from '@shared/ipc/commands'
import type {
  ConversationCreatedPayload,
  ConversationSummary,
  HelloAckPayload,
  MessagePayload
} from '@shared/wire/types'
import { isNotificationToken } from '@shared/ipc/commands'
import {
  NOTIFICATION_TARGETS_CAP,
  conversationMutedIn,
  conversationNameIn,
  createNotificationTargets,
  notificationRowFor,
  notifyKindForEvent,
  subscribePushNotify,
  type NotificationTarget
} from './pushNotifyBridge'
import type { ConversationListState, ServerConversationSummary } from './conversationListStore'

// Framework-free data-path tests with injected spies (the notificationActivatedBridge idiom): no React,
// no Electron, no store singleton. The React glue (usePushNotify) is proven by composition in
// PairedShell — its server-render safety by PairedShell.test.tsx (no window deref at render). All four
// deps (event source, command sender, toggle read, name lookup) are fakes, so both gates (filter +
// toggle) are exercised without touching pushNotificationPrefStore or conversationListStore.

const message: MessagePayload = {
  conversation_id: 'c',
  message_id: 'm',
  role: 'assistant',
  text: 't'
}

const created: ConversationCreatedPayload = {
  id: 'conv-new',
  is_promoted: false,
  cwd: '/home/pyry/project',
  name: null,
  last_used_at: '2026-07-11T12:00:00Z',
  workspace_label: null
}

// Distinctive daemon-supplied values on the two owned arms: the assertions below prove NONE of these
// reach the sent payload (AC4 — only the closed `kind` literal, never daemon text).
const turnEnd: DaemonEvent = {
  type: 'turnEnd',
  turnId: 'turn-XYZ',
  stopReason: 'end_turn-XYZ',
  conversationId: 'conv-XYZ'
}
const modalShown: DaemonEvent = {
  type: 'modalShown',
  conversationId: 'conv-modal-XYZ',
  modalId: 'modal-XYZ',
  class: 'permission',
  title: 'title-XYZ',
  prompt: 'prompt-XYZ',
  options: [],
  defaultOptionId: 'opt-XYZ'
}

// #514: a genuinely different prompt — same shape, different modalId. Keeps an XYZ-bearing value so the
// AC5 no-leak assertions stay meaningful when it is the one that gets sent.
const otherModalShown: DaemonEvent = {
  type: 'modalShown',
  conversationId: 'conv-modal-XYZ-2',
  modalId: 'modal-XYZ-2',
  class: 'trust',
  title: 'title-XYZ-2',
  prompt: 'prompt-XYZ-2',
  options: [],
  defaultOptionId: 'opt-XYZ-2'
}

// The reconnect edge (#415): every supervisor re-handshake re-emits `connected`, and the daemon then
// re-sends every still-outstanding modal_shown behind it. Shape copied from modalBridge.test.ts.
const ack: HelloAckPayload = {
  protocol_version: 'v2',
  server_id: 'srv-1',
  conn_id: 'conn-1',
  capabilities: ['interactive']
}

// A fake onDaemonEvent that captures the listener and hands back an off spy — the bridge-test idiom.
// `emit` stamps the origin the way main's bindServerOrigin does (#1593 reads it for the name lookup);
// it defaults to a present null, the honest-unknown stamp.
function fakeBridge(): {
  onDaemonEvent: (l: (e: StampedDaemonEvent) => void) => () => void
  emit: (e: DaemonEvent, serverId?: string | null) => void
  off: ReturnType<typeof vi.fn>
} {
  let listener: ((e: StampedDaemonEvent) => void) | undefined
  const off = vi.fn()
  const onDaemonEvent = vi.fn((l: (e: StampedDaemonEvent) => void) => {
    listener = l
    return off
  })
  return {
    onDaemonEvent,
    emit: (e, serverId = null) => listener?.({ ...e, serverId } as StampedDaemonEvent),
    off
  }
}

// The name lookup for tests that are not about naming: every conversation is unnamed, so the payload
// stays the bare `{ kind }` the pre-#1593 assertions pin.
const noName = (): string | null => null

describe('notifyKindForEvent', () => {
  it('maps turnEnd → turn-complete', () => {
    expect(notifyKindForEvent(turnEnd)).toBe('turn-complete')
  })

  it('maps modalShown → prompt', () => {
    expect(notifyKindForEvent(modalShown)).toBe('prompt')
  })

  it('maps a sample of unrelated events → null', () => {
    expect(notifyKindForEvent({ type: 'connecting' })).toBeNull()
    expect(notifyKindForEvent({ type: 'messageReceived', message })).toBeNull()
    expect(notifyKindForEvent({ type: 'turnState', state: 'thinking', conversationId: 'conv-1' })).toBeNull()
    expect(notifyKindForEvent({ type: 'conversationCreated', conversation: created })).toBeNull()
    expect(notifyKindForEvent({ type: 'notificationActivated' })).toBeNull()
  })
})

describe('subscribePushNotify', () => {
  it('subscribes exactly once', () => {
    const bridge = fakeBridge()
    subscribePushNotify(bridge.onDaemonEvent, vi.fn(), () => true, noName)
    expect(bridge.onDaemonEvent).toHaveBeenCalledTimes(1)
  })

  it('turnEnd + toggle enabled → notify turn-complete, no daemon field leaks (AC1, AC4)', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true, noName)

    bridge.emit(turnEnd)
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({ type: 'notify', payload: { kind: 'turn-complete' } })
    // AC4: none of turnId / stopReason / conversationId may ride into the payload.
    expect(JSON.stringify(sendCommand.mock.calls[0][0])).not.toContain('XYZ')
  })

  it('modalShown + toggle enabled → notify prompt, no daemon field leaks (AC2, AC4)', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true, noName)

    bridge.emit(modalShown)
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({ type: 'notify', payload: { kind: 'prompt' } })
    // AC4: no title/prompt/modalId text may ride into the payload.
    expect(JSON.stringify(sendCommand.mock.calls[0][0])).not.toContain('XYZ')
  })

  it('turnEnd + toggle disabled → no command (AC3)', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => false, noName)

    bridge.emit(turnEnd)
    expect(sendCommand).not.toHaveBeenCalled()
  })

  it('modalShown + toggle disabled → no command (AC3)', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => false, noName)

    bridge.emit(modalShown)
    expect(sendCommand).not.toHaveBeenCalled()
  })

  it('reads the toggle per-event, not once at subscribe (AC3, mid-session flip)', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    let enabled = true
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => enabled, noName)

    bridge.emit(turnEnd)
    expect(sendCommand).toHaveBeenCalledTimes(1)
    // User flips the Settings toggle off mid-session — the NEXT event must not fire.
    enabled = false
    bridge.emit(turnEnd)
    expect(sendCommand).toHaveBeenCalledTimes(1)
  })

  it('ignores every other daemon event even with the toggle enabled (AC4)', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true, noName)

    bridge.emit({ type: 'connecting' })
    bridge.emit({ type: 'messageReceived', message })
    bridge.emit({ type: 'turnState', state: 'thinking', conversationId: 'conv-1' })
    bridge.emit({ type: 'conversationCreated', conversation: created })
    bridge.emit({
      type: 'toolUse',
      conversationId: 'conv-1',
      turnId: 't',
      toolUseId: 'u',
      name: 'n',
      inputSummary: 's'
    })
    bridge.emit({ type: 'notificationActivated' })
    expect(sendCommand).not.toHaveBeenCalled()
  })

  it('the same modalId twice → exactly one command, and the id never rides along (#514 AC1, AC5)', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true, noName)

    bridge.emit(modalShown)
    bridge.emit(modalShown)
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({ type: 'notify', payload: { kind: 'prompt' } })
    // AC5: the dedup key is read, but it must not reach the payload.
    expect(JSON.stringify(sendCommand.mock.calls[0][0])).not.toContain('XYZ')
  })

  it('the same modalId across a reconnect → exactly one command (#514 AC2)', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true, noName)

    // The shape this ticket exists for: prompt left outstanding, link drops, re-handshake, daemon
    // re-sends the still-outstanding prompt (#415 reconcile). `connected` lands BEFORE the re-send,
    // so memory cleared on that edge would be empty here — this test fails on that fix sketch.
    bridge.emit(modalShown)
    bridge.emit({ type: 'connected', ack })
    bridge.emit(modalShown)
    expect(sendCommand).toHaveBeenCalledTimes(1)
  })

  it('a genuinely new modalId after a suppressed re-delivery still notifies (#514 AC3)', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true, noName)

    bridge.emit(modalShown)
    bridge.emit(modalShown)
    bridge.emit(otherModalShown)
    expect(sendCommand).toHaveBeenCalledTimes(2)
    expect(sendCommand).toHaveBeenNthCalledWith(1, { type: 'notify', payload: { kind: 'prompt' } })
    expect(sendCommand).toHaveBeenNthCalledWith(2, { type: 'notify', payload: { kind: 'prompt' } })
  })

  it('two turnEnds with the toggle on still send two commands — suppression is prompt-only (#514 AC4)', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true, noName)

    bridge.emit(turnEnd)
    bridge.emit(turnEnd)
    expect(sendCommand).toHaveBeenCalledTimes(2)
  })

  it('a first delivery dropped by the toggle is not recorded as announced (#514 AC1)', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    let enabled = false
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => enabled, noName)

    // Push off while the prompt arrives — nothing announced, so nothing to remember.
    bridge.emit(modalShown)
    expect(sendCommand).not.toHaveBeenCalled()
    // User turns push on; the daemon re-sends the still-outstanding prompt. It must fire.
    enabled = true
    bridge.emit(modalShown)
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({ type: 'notify', payload: { kind: 'prompt' } })
  })

  it('the announced-prompt memory is per-subscription, not module-level (#514, unpair reset edge)', () => {
    const first = fakeBridge()
    const cleanup = subscribePushNotify(first.onDaemonEvent, vi.fn(), () => true, noName)
    first.emit(modalShown)
    cleanup()

    // Unpair unmounts PairedShell and tears the subscription down; a new pairing is a new daemon
    // relationship and starts with no memory. A module-level Set would swallow this command.
    const second = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    subscribePushNotify(second.onDaemonEvent, sendCommand, () => true, noName)
    second.emit(modalShown)
    expect(sendCommand).toHaveBeenCalledTimes(1)
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribePushNotify(bridge.onDaemonEvent, vi.fn(), () => true, noName)
    expect(bridge.off).not.toHaveBeenCalled()
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  it('a named conversation sends its name, looked up by the event’s own origin (#1593)', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    const nameFor = vi.fn((_serverId: string | null, _conversationId: string): string | null => 'deploy-bot')
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true, nameFor)

    bridge.emit(turnEnd, 'srv-A')
    bridge.emit(modalShown, 'srv-B')
    expect(nameFor).toHaveBeenNthCalledWith(1, 'srv-A', 'conv-XYZ')
    expect(nameFor).toHaveBeenNthCalledWith(2, 'srv-B', 'conv-modal-XYZ')
    expect(sendCommand).toHaveBeenNthCalledWith(1, {
      type: 'notify',
      payload: { kind: 'turn-complete', name: 'deploy-bot' }
    })
    expect(sendCommand).toHaveBeenNthCalledWith(2, {
      type: 'notify',
      payload: { kind: 'prompt', name: 'deploy-bot' }
    })
    // The conversation id is a lookup key only — it never crosses to main.
    for (const [command] of sendCommand.mock.calls) expect(JSON.stringify(command)).not.toContain('XYZ')
  })

  it('an unnamed or unknown conversation sends no name key at all (#1593)', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true, noName)

    bridge.emit(turnEnd, 'srv-A')
    const [command] = sendCommand.mock.calls[0]
    expect(command.type === 'notify' && 'name' in command.payload).toBe(false)
  })

  it('does not look the name up for an event that sends nothing (#1593)', () => {
    const bridge = fakeBridge()
    const nameFor = vi.fn((): string | null => 'deploy-bot')
    let enabled = false
    subscribePushNotify(bridge.onDaemonEvent, vi.fn(), () => enabled, nameFor)

    bridge.emit(turnEnd) // toggle off
    enabled = true
    bridge.emit(modalShown)
    bridge.emit(modalShown) // deduped re-delivery
    bridge.emit({ type: 'connecting' }) // not a notify arm
    expect(nameFor).toHaveBeenCalledTimes(1)
  })
})

// #1593 AC1: the production lookup. Keyed by the event's own server, so a same-id row that belongs to
// another host never names the notification.
describe('conversationNameIn', () => {
  function row(id: string, name: string | null, serverId: string | null): ServerConversationSummary {
    const summary: ConversationSummary = {
      ...created,
      id,
      name,
      is_archived: false,
      last_message_ts: '2026-07-11T12:00:00Z'
    }
    return { ...summary, serverId }
  }

  const state: ConversationListState = {
    conversations: null,
    byServer: new Map([
      ['srv-A', [row('c-1', 'deploy-bot', 'srv-A'), row('c-2', null, 'srv-A')]],
      ['srv-B', [row('c-3', 'other-host-only', 'srv-B')]],
      [null, [row('c-9', 'origin-unknown', null)]]
    ])
  }

  it('resolves a named row on the event’s server', () => {
    expect(conversationNameIn(state, 'srv-A', 'c-1')).toBe('deploy-bot')
    expect(conversationNameIn(state, null, 'c-9')).toBe('origin-unknown')
  })

  it('answers null for an unnamed row, an unknown id and an unknown server', () => {
    expect(conversationNameIn(state, 'srv-A', 'c-2')).toBeNull()
    expect(conversationNameIn(state, 'srv-A', 'c-404')).toBeNull()
    expect(conversationNameIn(state, 'srv-Z', 'c-1')).toBeNull()
  })

  it('never names a notification from a same-id row on another host', () => {
    expect(conversationNameIn(state, 'srv-A', 'c-3')).toBeNull()
    expect(conversationNameIn(state, 'srv-B', 'c-1')).toBeNull()
  })
})

// #1597: the token main echoes back on a click. Minted per notification, mapped to its own server and
// conversation, and never carrying either across.
describe('subscribePushNotify tokens (#1597)', () => {
  it('mints a token from the event’s own origin and sends only the token', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    const mintToken = vi.fn((_target: NotificationTarget) => `tok-${mintToken.mock.calls.length}`)
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true, noName, mintToken)

    bridge.emit(turnEnd, 'srv-A')
    bridge.emit(modalShown, 'srv-B')
    expect(mintToken).toHaveBeenNthCalledWith(1, { serverId: 'srv-A', conversationId: 'conv-XYZ' })
    expect(mintToken).toHaveBeenNthCalledWith(2, { serverId: 'srv-B', conversationId: 'conv-modal-XYZ' })
    expect(sendCommand).toHaveBeenNthCalledWith(1, { type: 'notify', payload: { kind: 'turn-complete', token: 'tok-1' } })
    expect(sendCommand).toHaveBeenNthCalledWith(2, { type: 'notify', payload: { kind: 'prompt', token: 'tok-2' } })
    for (const [command] of sendCommand.mock.calls) {
      expect(JSON.stringify(command)).not.toContain('XYZ')
      expect(JSON.stringify(command)).not.toContain('srv-')
    }
  })

  it('mints nothing for an event that sends nothing', () => {
    const bridge = fakeBridge()
    const mintToken = vi.fn(() => 'tok')
    let enabled = false
    subscribePushNotify(bridge.onDaemonEvent, vi.fn(), () => enabled, noName, mintToken)

    bridge.emit(turnEnd) // toggle off
    enabled = true
    bridge.emit(modalShown)
    bridge.emit(modalShown) // deduped re-delivery
    bridge.emit({ type: 'connecting' })
    expect(mintToken).toHaveBeenCalledTimes(1)
  })
})

// #1607: a conversation muted on its host sends nothing. Read per event like the toggle, keyed by the
// event's own server, and a prompt dropped while muted is not remembered as announced.
describe('subscribePushNotify mute (#1607)', () => {
  it('sends and mints nothing for a muted conversation, for either kind', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    const mintToken = vi.fn(() => 'tok')
    const isMuted = vi.fn(() => true)
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true, noName, mintToken, isMuted)

    bridge.emit(turnEnd, 'srv-A')
    bridge.emit(modalShown, 'srv-B')
    expect(sendCommand).not.toHaveBeenCalled()
    expect(mintToken).not.toHaveBeenCalled()
    expect(isMuted).toHaveBeenNthCalledWith(1, 'srv-A', 'conv-XYZ')
    expect(isMuted).toHaveBeenNthCalledWith(2, 'srv-B', 'conv-modal-XYZ')
  })

  it('reads mute per event, and notifies a prompt re-sent after it is unmuted', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    let muted = false
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true, noName, undefined, () => muted)

    bridge.emit(turnEnd)
    expect(sendCommand).toHaveBeenCalledTimes(1)
    muted = true
    bridge.emit(turnEnd)
    bridge.emit(modalShown)
    expect(sendCommand).toHaveBeenCalledTimes(1)
    muted = false
    bridge.emit(modalShown) // the daemon's re-send after a reconnect
    expect(sendCommand).toHaveBeenCalledTimes(2)
    expect(sendCommand).toHaveBeenLastCalledWith({ type: 'notify', payload: { kind: 'prompt' } })
  })
})

// #1737: the body previews the reply or the pending action. Looked up only on the send path, after every
// gate, and an absent preview leaves the key off the payload.
describe('subscribePushNotify previews (#1737)', () => {
  it('sends the looked-up preview, and looks it up with the stamped event', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    const previewFor = vi.fn(() => 'All tests pass.')
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true, noName, undefined, undefined, previewFor)

    bridge.emit(turnEnd, 'srv-A')
    expect(previewFor).toHaveBeenCalledWith({ ...turnEnd, serverId: 'srv-A' })
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'notify',
      payload: { kind: 'turn-complete', preview: 'All tests pass.' }
    })
  })

  it('omits the preview key when there is none', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true, noName, undefined, undefined, () => null)

    bridge.emit(modalShown)
    expect(sendCommand).toHaveBeenCalledTimes(1)
    const sent = sendCommand.mock.calls[0][0]
    expect(sent).toEqual({ type: 'notify', payload: { kind: 'prompt' } })
    expect(sent.type === 'notify' && 'preview' in sent.payload).toBe(false)
  })

  it('looks nothing up when the toggle is off, the conversation is muted or the prompt was announced', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    const previewFor = vi.fn(() => 'preview')
    let enabled = false
    let muted = false
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => enabled, noName, undefined, () => muted, previewFor)

    bridge.emit(turnEnd)
    enabled = true
    muted = true
    bridge.emit(turnEnd)
    expect(previewFor).not.toHaveBeenCalled()
    muted = false
    bridge.emit(modalShown)
    bridge.emit(modalShown)
    expect(previewFor).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledTimes(1)
  })
})

// #1691: a question batch notifies like a modal prompt — same gates, name lookup and click token —
// once per batch, deduplicated apart from modal ids (mobile's `batch:<questionBatchId>` key).
const questionShown: Extract<DaemonEvent, { type: 'questionShown' }> = {
  type: 'questionShown',
  conversationId: 'conv-q-XYZ',
  questionBatchId: 'batch-XYZ',
  questions: [
    {
      question: 'question-XYZ',
      header: 'header-XYZ',
      options: [{ label: 'label-XYZ', description: 'desc-XYZ' }],
      multi_select: false
    }
  ]
}

describe('subscribePushNotify question batches (#1691)', () => {
  it('maps questionShown → prompt', () => {
    expect(notifyKindForEvent(questionShown)).toBe('prompt')
  })

  it('a batch sends one named prompt with a token from its own origin, and no batch field', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    const nameFor = vi.fn(() => 'deploy-bot')
    const mintToken = vi.fn(() => 'tok')
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true, nameFor, mintToken)

    bridge.emit(questionShown, 'srv-Q')
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'notify',
      payload: { kind: 'prompt', name: 'deploy-bot', token: 'tok' }
    })
    expect(nameFor).toHaveBeenCalledWith('srv-Q', 'conv-q-XYZ')
    expect(mintToken).toHaveBeenCalledWith({ serverId: 'srv-Q', conversationId: 'conv-q-XYZ' })
    expect(JSON.stringify(sendCommand.mock.calls[0][0])).not.toContain('XYZ')
  })

  it('a re-sent batch sends nothing more; a new batch id does', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true, noName)

    bridge.emit(questionShown)
    bridge.emit(questionShown)
    expect(sendCommand).toHaveBeenCalledTimes(1)
    bridge.emit({ ...questionShown, questionBatchId: 'batch-XYZ-2' })
    expect(sendCommand).toHaveBeenCalledTimes(2)
  })

  it('toggle off or muted sends and mints nothing, and does not record the batch', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    const mintToken = vi.fn(() => 'tok')
    let enabled = false
    let muted = false
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => enabled, noName, mintToken, () => muted)

    bridge.emit(questionShown)
    enabled = true
    muted = true
    bridge.emit(questionShown)
    expect(sendCommand).not.toHaveBeenCalled()
    expect(mintToken).not.toHaveBeenCalled()
    muted = false
    bridge.emit(questionShown) // the daemon's re-send
    expect(sendCommand).toHaveBeenCalledTimes(1)
  })

  it('a batch id equal to an announced modal id still notifies once, and vice versa', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true, noName)

    bridge.emit(modalShown)
    bridge.emit({ ...questionShown, questionBatchId: 'modal-XYZ' })
    bridge.emit({ ...questionShown, questionBatchId: 'modal-XYZ' })
    expect(sendCommand).toHaveBeenCalledTimes(2)

    bridge.emit(questionShown)
    bridge.emit({ ...modalShown, modalId: 'batch-XYZ' } as DaemonEvent)
    bridge.emit({ ...modalShown, modalId: 'batch-XYZ' } as DaemonEvent)
    expect(sendCommand).toHaveBeenCalledTimes(4)
  })
})

describe('conversationMutedIn (#1607)', () => {
  function row(id: string, serverId: string | null, is_muted?: boolean): ServerConversationSummary {
    const summary: ConversationSummary = {
      ...created,
      id,
      is_archived: false,
      last_message_ts: '2026-07-11T12:00:00Z',
      ...(is_muted === undefined ? {} : { is_muted })
    }
    return { ...summary, serverId }
  }

  const state: ConversationListState = {
    conversations: null,
    byServer: new Map([
      ['srv-A', [row('c-1', 'srv-A', true), row('c-2', 'srv-A', false), row('c-3', 'srv-A')]],
      ['srv-B', [row('c-4', 'srv-B', true)]]
    ])
  }

  it('is true only for a row muted on the event’s own server', () => {
    expect(conversationMutedIn(state, 'srv-A', 'c-1')).toBe(true)
    expect(conversationMutedIn(state, 'srv-B', 'c-4')).toBe(true)
  })

  it('is false for an unmuted, unset or missing row, and for a row muted only under another host', () => {
    expect(conversationMutedIn(state, 'srv-A', 'c-2')).toBe(false)
    expect(conversationMutedIn(state, 'srv-A', 'c-3')).toBe(false)
    expect(conversationMutedIn(state, 'srv-A', 'c-404')).toBe(false)
    expect(conversationMutedIn(state, 'srv-Z', 'c-1')).toBe(false)
    expect(conversationMutedIn(state, 'srv-A', 'c-4')).toBe(false)
  })
})

describe('createNotificationTargets (#1597)', () => {
  const counter = (): (() => string) => {
    let n = 0
    return () => `t${++n}`
  }

  it('resolves each token to its own target, and an unknown token to null', () => {
    const targets = createNotificationTargets(counter())
    const a = targets.mint({ serverId: 'srv-A', conversationId: 'c-1' })
    const b = targets.mint({ serverId: 'srv-B', conversationId: 'c-2' })
    expect(a).not.toBe(b)
    expect(targets.resolve(b)).toEqual({ serverId: 'srv-B', conversationId: 'c-2' })
    expect(targets.resolve(a)).toEqual({ serverId: 'srv-A', conversationId: 'c-1' })
    expect(targets.resolve('never-minted')).toBeNull()
  })

  it('holds at most the cap, dropping the oldest first', () => {
    const targets = createNotificationTargets(counter())
    const tokens = Array.from({ length: NOTIFICATION_TARGETS_CAP + 1 }, (_, i) =>
      targets.mint({ serverId: 'srv-A', conversationId: `c-${i}` })
    )
    expect(targets.resolve(tokens[0])).toBeNull()
    expect(targets.resolve(tokens[1])).toEqual({ serverId: 'srv-A', conversationId: 'c-1' })
    expect(targets.resolve(tokens[NOTIFICATION_TARGETS_CAP])).toEqual({
      serverId: 'srv-A',
      conversationId: `c-${NOTIFICATION_TARGETS_CAP}`
    })
  })

  it('mints tokens the notify guard admits by default', () => {
    const token = createNotificationTargets().mint({ serverId: null, conversationId: 'c-1' })
    expect(isNotificationToken(token)).toBe(true)
  })
})

describe('notificationRowFor (#1597)', () => {
  function row(id: string, serverId: string | null, is_archived = false): ServerConversationSummary {
    return { ...created, id, is_archived, last_message_ts: '2026-07-11T12:00:00Z', serverId }
  }

  const state: ConversationListState = {
    conversations: null,
    byServer: new Map([
      ['srv-A', [row('c-1', 'srv-A'), row('c-old', 'srv-A', true)]],
      ['srv-B', [row('c-2', 'srv-B')]]
    ])
  }

  it('answers the row on the target’s own server', () => {
    expect(notificationRowFor(state, { serverId: 'srv-B', conversationId: 'c-2' })).toEqual(row('c-2', 'srv-B'))
  })

  it('answers null for no target, another host’s same id, a missing server, a missing row or an archived row', () => {
    expect(notificationRowFor(state, null)).toBeNull()
    expect(notificationRowFor(state, { serverId: 'srv-B', conversationId: 'c-1' })).toBeNull()
    expect(notificationRowFor(state, { serverId: 'srv-gone', conversationId: 'c-1' })).toBeNull()
    expect(notificationRowFor(state, { serverId: 'srv-A', conversationId: 'c-deleted' })).toBeNull()
    expect(notificationRowFor(state, { serverId: 'srv-A', conversationId: 'c-old' })).toBeNull()
  })
})
