import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import { subscribeTimeline } from '../../store/timelineBridge'
import { createTimelineStore, selectItems } from '../../store/timelineStore'
import { subscribeModal } from '../../store/modalBridge'
import { createModalStore, selectOutstanding } from '../../store/modalStore'
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

  it('surfaces an answerable panel from a modal_shown event', () => {
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
        responseAvailable={true}
        sessionPermissionChecked={false}
        onSessionPermissionChange={() => {}}
        prompt={outstanding[0]}
        armedOption={null}
        onActivate={() => {}}
        onCancel={() => {}}
      />
    )

    // One native choice per supplied option, default indication and explicit action controls.
    expect(markup).toContain('role="region"')
    expect(markup).toContain('run the build')
    const optionInputs = markup.match(/class="permission-panel__choice(?: |")/g)?.length ?? 0
    expect(optionInputs).toBe(2)
    expect(markup).toContain('permission-panel__choice--default')
    expect(markup).toContain('>Allow</button>')
    expect(markup).toContain('>Deny</button>')
    expect(markup).toContain('>Cancel</button>')
  })
})
