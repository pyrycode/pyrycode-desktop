import { describe, it, expect, vi } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import type { RendererCommand } from '@shared/ipc/commands'
import type { ConversationCreatedPayload, MessagePayload } from '@shared/wire/types'
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
const turnEnd: DaemonEvent = { type: 'turnEnd', turnId: 'turn-XYZ', stopReason: 'end_turn-XYZ' }
const modalShown: DaemonEvent = {
  type: 'modalShown',
  modalId: 'modal-XYZ',
  class: 'permission',
  title: 'title-XYZ',
  prompt: 'prompt-XYZ',
  options: [],
  defaultOptionId: 'opt-XYZ'
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
    expect(notifyKindForEvent({ type: 'turnState', state: 'thinking' })).toBeNull()
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
    // AC4: neither turnId nor stopReason may ride into the payload.
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
    bridge.emit({ type: 'turnState', state: 'thinking' })
    bridge.emit({ type: 'conversationCreated', conversation: created })
    bridge.emit({ type: 'toolUse', turnId: 't', toolUseId: 'u', name: 'n', inputSummary: 's' })
    bridge.emit({ type: 'notificationActivated' })
    expect(sendCommand).not.toHaveBeenCalled()
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribePushNotify(bridge.onDaemonEvent, vi.fn(), () => true)
    expect(bridge.off).not.toHaveBeenCalled()
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })
})
