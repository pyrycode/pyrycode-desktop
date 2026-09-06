import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import { subscribeTimeline } from '../../store/timelineBridge'
import { createTimelineStore, selectItems } from '../../store/timelineStore'
import { subscribeModal } from '../../store/modalBridge'
import { createModalStore, selectOutstanding } from '../../store/modalStore'
import { Timeline } from './ConversationScreen'
import { PermissionModalView } from './PermissionModal'

// #179 AC5: the interactive round-trip end-to-end through the REAL renderer bridges + stores +
// views — no transport, no jsdom (the timelineBridge/modalBridge spy-onDaemonEvent + real-store
// precedent). This proves the flip lights up the mounted pipeline: a user echo plus a structured
// daemon stream render as one ordered thread, and a modal_shown surfaces an answerable dialog. The
// click→command wiring is unit-proven in modalResolution.test.ts / PermissionModal.test.tsx (#237);
// this proves the modal_shown→answerable-dialog path, not a re-test of the click.

// A fake onDaemonEvent that captures the listener and hands back an off spy — the bridge-test idiom.
function fakeBridge(): {
  onDaemonEvent: (l: (e: DaemonEvent) => void) => () => void
  emit: (e: DaemonEvent) => void
} {
  let listener: ((e: DaemonEvent) => void) | undefined
  const onDaemonEvent = vi.fn((l: (e: DaemonEvent) => void) => {
    listener = l
    return vi.fn()
  })
  return { onDaemonEvent, emit: (e) => listener?.(e) }
}

const CURSOR = 'bubble__cursor'

describe('#179 interactive round-trip — the flip lights up the mounted pipeline (AC5)', () => {
  it('renders a userText echo + structured stream as one ordered, resolved thread', () => {
    const bridge = fakeBridge()
    const store = createTimelineStore()
    subscribeTimeline(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    // The composer's optimistic echo writes straight into the timeline (composerSend's new target).
    store.getState().dispatch({ type: 'userText', text: 'help me refactor' })

    // Then the daemon's structured stream for one turn: thinking, two coalescing deltas, a tool
    // use + its correlated result, and the turn boundary.
    const stream: DaemonEvent[] = [
      { type: 'turnState', state: 'thinking', conversationId: 'conv-1' },
      { type: 'assistantDelta', turnId: 't1', seq: 0, text: 'Sure, ', conversationId: 'conv-1' },
      { type: 'assistantDelta', turnId: 't1', seq: 1, text: 'reading now.', conversationId: 'conv-1' },
      {
        type: 'toolUse',
        conversationId: 'conv-1',
        turnId: 't1',
        toolUseId: 'tu-1',
        name: 'read_file',
        inputSummary: 'schema.ts'
      },
      {
        type: 'toolResult',
        conversationId: 'conv-1',
        turnId: 't1',
        toolUseId: 'tu-1',
        isError: false,
        resultSummary: '184 lines'
      },
      { type: 'turnEnd', turnId: 't1', stopReason: 'end_turn', conversationId: 'conv-1' }
    ]
    for (const event of stream) bridge.emit(event)

    const markup = renderToStaticMarkup(<Timeline items={selectItems(store.getState())} />)

    // The single ordered thread: user bubble → one coalesced assistant bubble → one resolved tool row.
    expect(markup).toContain('data-thread-role="user">help me refactor')
    // #609 re-pointed the assistant half. `turnEnd` closes the turn, so this bubble is SETTLED and
    // renders through the markdown path — its content opens with the container, not with the reply text
    // flush against the bubble tag (the same re-point ConversationScreen.test.tsx:396 took). The single
    // `<p>` carrying both deltas is what keeps this a coalescing assertion: deltas that failed to
    // coalesce would be two timeline items, hence two bubbles and two paragraphs, and neither the
    // container-then-paragraph opening nor this joined paragraph would appear.
    expect(markup).toContain('data-thread-role="assistant"><div class="bubble__markdown"><p>')
    expect(markup).toContain('<p>Sure, reading now.</p>')
    expect(markup).toContain('tool-row--resolved')
    expect(markup).toContain('data-thread-role="tool"')
    // Arrival order preserved across the two write paths (echo + stream).
    expect(markup.indexOf('help me refactor')).toBeLessThan(markup.indexOf('Sure, reading now.'))
    expect(markup.indexOf('Sure, reading now.')).toBeLessThan(markup.indexOf('read_file'))
    // The turn closed (turnEnd → trailing turnBoundary), so no streaming cursor trails any bubble.
    expect(markup).not.toContain(CURSOR)
  })

  it('surfaces an answerable dialog from a modal_shown event', () => {
    const bridge = fakeBridge()
    const store = createModalStore()
    // #1140: the injected per-server conversation resolution. This case emits no `connected`, so it is
    // never consulted — an empty answer keeps the stub honest about that rather than implying a list.
    subscribeModal(
      bridge.onDaemonEvent,
      (e) => store.getState().dispatch(e),
      () => new Set()
    )

    bridge.emit({
      type: 'modalShown',
      conversationId: 'conv-1',
      modalId: 'mdl-1',
      class: 'permission',
      title: 'Allow Bash?',
      prompt: 'run the build',
      options: [
        { id: 'allow', label: 'Allow' },
        { id: 'deny', label: 'Deny' }
      ],
      defaultOptionId: 'deny'
    })

    const outstanding = selectOutstanding(store.getState())
    expect(outstanding).toHaveLength(1)

    const markup = renderToStaticMarkup(
      <PermissionModalView
        prompt={outstanding[0]}
        pendingOption={null}
        onSelect={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
        onCancel={() => {}}
      />
    )

    // Answerable: the dialog chrome, the prompt text, one option button per option (the default
    // visually distinguished), plus the leading Cancel affordance.
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('run the build')
    // Match an option button's class start (option followed by a space or the closing quote), not the
    // plural `permission-modal__options` container that also begins with `permission-modal__option`.
    const optionButtons = markup.match(/class="permission-modal__option[ "]/g)?.length ?? 0
    expect(optionButtons).toBe(2)
    expect(markup).toContain('permission-modal__option--default')
    expect(markup).toContain('>Allow</button>')
    expect(markup).toContain('>Deny</button>')
    expect(markup).toContain('>Cancel</button>')
  })
})
