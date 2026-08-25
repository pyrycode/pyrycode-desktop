import { describe, it, expect, vi } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import type { RendererCommand } from '@shared/ipc/commands'
import type { ConversationCreatedPayload, HelloAckPayload, MessagePayload } from '@shared/wire/types'
import { notifyKindForEvent, subscribePushNotify } from './pushNotifyBridge'

// Framework-free data-path tests with injected spies (the notificationActivatedBridge idiom): no React,
// no Electron, no store singleton. The React glue (usePushNotify) is proven by composition in
// PairedShell — its server-render safety by PairedShell.test.tsx (no window deref at render). All three
// deps (event source, command sender, toggle read) are spies, so both gates (filter + toggle) are
// exercised without touching pushNotificationPrefStore.

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
  last_used_at: '2026-07-11T12:00:00Z'
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
function fakeBridge(): {
  onDaemonEvent: (l: (e: DaemonEvent) => void) => () => void
  emit: (e: DaemonEvent) => void
  off: ReturnType<typeof vi.fn>
} {
  let listener: ((e: DaemonEvent) => void) | undefined
  const off = vi.fn()
  const onDaemonEvent = vi.fn((l: (e: DaemonEvent) => void) => {
    listener = l
    return off
  })
  return { onDaemonEvent, emit: (e) => listener?.(e), off }
}

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
    subscribePushNotify(bridge.onDaemonEvent, vi.fn(), () => true)
    expect(bridge.onDaemonEvent).toHaveBeenCalledTimes(1)
  })

  it('turnEnd + toggle enabled → notify turn-complete, no daemon field leaks (AC1, AC4)', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true)

    bridge.emit(turnEnd)
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({ type: 'notify', payload: { kind: 'turn-complete' } })
    // AC4: none of turnId / stopReason / conversationId may ride into the payload.
    expect(JSON.stringify(sendCommand.mock.calls[0][0])).not.toContain('XYZ')
  })

  it('modalShown + toggle enabled → notify prompt, no daemon field leaks (AC2, AC4)', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true)

    bridge.emit(modalShown)
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({ type: 'notify', payload: { kind: 'prompt' } })
    // AC4: no title/prompt/modalId text may ride into the payload.
    expect(JSON.stringify(sendCommand.mock.calls[0][0])).not.toContain('XYZ')
  })

  it('turnEnd + toggle disabled → no command (AC3)', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => false)

    bridge.emit(turnEnd)
    expect(sendCommand).not.toHaveBeenCalled()
  })

  it('modalShown + toggle disabled → no command (AC3)', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => false)

    bridge.emit(modalShown)
    expect(sendCommand).not.toHaveBeenCalled()
  })

  it('reads the toggle per-event, not once at subscribe (AC3, mid-session flip)', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    let enabled = true
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => enabled)

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
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true)

    bridge.emit({ type: 'connecting' })
    bridge.emit({ type: 'messageReceived', message })
    bridge.emit({ type: 'turnState', state: 'thinking', conversationId: 'conv-1' })
    bridge.emit({ type: 'conversationCreated', conversation: created })
    bridge.emit({ type: 'toolUse', turnId: 't', toolUseId: 'u', name: 'n', inputSummary: 's' })
    bridge.emit({ type: 'notificationActivated' })
    expect(sendCommand).not.toHaveBeenCalled()
  })

  it('the same modalId twice → exactly one command, and the id never rides along (#514 AC1, AC5)', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true)

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
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true)

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
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true)

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
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => true)

    bridge.emit(turnEnd)
    bridge.emit(turnEnd)
    expect(sendCommand).toHaveBeenCalledTimes(2)
  })

  it('a first delivery dropped by the toggle is not recorded as announced (#514 AC1)', () => {
    const bridge = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    let enabled = false
    subscribePushNotify(bridge.onDaemonEvent, sendCommand, () => enabled)

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
    const cleanup = subscribePushNotify(first.onDaemonEvent, vi.fn(), () => true)
    first.emit(modalShown)
    cleanup()

    // Unpair unmounts PairedShell and tears the subscription down; a new pairing is a new daemon
    // relationship and starts with no memory. A module-level Set would swallow this command.
    const second = fakeBridge()
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    subscribePushNotify(second.onDaemonEvent, sendCommand, () => true)
    second.emit(modalShown)
    expect(sendCommand).toHaveBeenCalledTimes(1)
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribePushNotify(bridge.onDaemonEvent, vi.fn(), () => true)
    expect(bridge.off).not.toHaveBeenCalled()
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })
})
