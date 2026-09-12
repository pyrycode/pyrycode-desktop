import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PermissionModal, PermissionModalView, RejectionSurfaceView } from './PermissionModal'
import { resolvePendingOption, type PendingConfirm } from './modalResolution'
import {
  reduceModal,
  initialModalState,
  selectOutstanding,
  type ModalEvent,
  type ModalOption,
  type ModalPrompt,
  type ModalState
} from '../../store/modalPrompts'

// No DOM harness — mirrors ConversationScreen.test.tsx. PermissionModalView is the pure, exported view
// (ModalPrompt in, markup out), so a server-rendered string proves the render: title/prompt, one button
// per option in array order, the default modifier on the matching option, untrusted text escaped, and
// the dialog chrome. PermissionModal is the store-bound container; zustand v5's useStore reads
// getInitialState() (empty `outstanding`) under server rendering, so the container is exercised only for
// the empty case — the populated rendering is proven through PermissionModalView (the RepairControl note).
// The click → answerPrompt / cancelPrompt behavior lives in modalResolution.test.ts (plain spies): the
// `node` environment fires no clicks, so the view is server-rendered for structure only.

// #237/#226: onSelect / onConfirm / onBack / onCancel are required props (a view that cannot answer is a
// bug). The structural tests inject no-op effects; the wiring is exercised in modalResolution.test.ts.
// `pendingOption` selects the render mode: null = the option list, set = the confirm sub-step (#226).
const noop = (): void => {}
function renderView(prompt: ModalPrompt, pendingOption: ModalOption | null = null): string {
  return renderToStaticMarkup(
    <PermissionModalView
      prompt={prompt}
      pendingOption={pendingOption}
      selectedOption={null}
      onContinue={noop}
      onSelect={noop}
      onConfirm={noop}
      onBack={noop}
      onCancel={noop}
    />
  )
}

// Count native choices independently from the action buttons.
function optionCount(markup: string): number {
  return markup.match(/type="radio"/g)?.length ?? 0
}

// The default marked neither first nor last, so order and default-marking are independent (spec note).
const PROMPT: ModalPrompt = {
  // #878: derived from, but never equal to, the modal id — both are `string`, so only distinct values
  // can catch a transposition of the two adjacent fields.
  conversationId: 'conv-m1',
  modalId: 'm1',
  class: 'permission',
  title: 'Allow file write',
  prompt: 'claude wants to write to schema.ts',
  options: [
    { id: 'allow-once', label: 'Allow once' },
    { id: 'deny', label: 'Deny' },
    { id: 'allow-always', label: 'Allow always' }
  ],
  defaultOptionId: 'deny'
}

describe('PermissionModalView — the outstanding permission/trust prompt', () => {
  it('renders the title and prompt text (AC2)', () => {
    const markup = renderView(PROMPT)
    expect(markup).toContain('Allow file write')
    expect(markup).toContain('claude wants to write to schema.ts')
  })

  it('renders one radio per option in array order (AC2)', () => {
    const markup = renderView(PROMPT)
    expect(optionCount(markup)).toBe(3)
    expect(markup.indexOf('Allow once')).toBeLessThan(markup.indexOf('Deny'))
    expect(markup.indexOf('Deny')).toBeLessThan(markup.indexOf('Allow always'))
  })

  it('marks only the supplied default option (AC3)', () => {
    const markup = renderView(PROMPT)
    // Exactly one default, and it is the middle supplied choice.
    expect(markup.match(/permission-panel__default/g)?.length ?? 0).toBe(1)
    expect(markup).toContain('Deny<span class="permission-panel__default"> Default</span>')
    // The other labels remain unadorned.
    expect(markup).toContain('Allow once</span>')
    expect(markup).toContain('Allow always</span>')
  })

  it('renders title / prompt / labels as inert text, never live markup (AC4)', () => {
    // No apostrophes — renderToStaticMarkup escapes ' → &#x27; (prior desktop lesson).
    const injected: ModalPrompt = {
      conversationId: 'conv-m2',
      modalId: 'm2',
      class: 'trust',
      title: '<b>Trust</b>',
      prompt: '<script>alert(1)</script>',
      options: [{ id: 'a', label: '<i>ok</i>' }],
      defaultOptionId: 'a'
    }
    const markup = renderView(injected)
    expect(markup).toContain('&lt;b&gt;Trust&lt;/b&gt;')
    expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(markup).toContain('&lt;i&gt;ok&lt;/i&gt;')
    expect(markup).not.toContain('<b>Trust</b>')
    expect(markup).not.toContain('<script>alert(1)</script>')
    expect(markup).not.toContain('<i>ok</i>')
  })

  it('renders an accessible nonmodal region labelled by its title', () => {
    const markup = renderView(PROMPT)
    expect(markup).toContain('role="region"')
    expect(markup).not.toContain('aria-modal')
    expect(markup).toContain('aria-labelledby="permission-modal-title"')
    expect(markup).toContain('id="permission-modal-title"')
  })

  it('renders exactly one radio for a single-option prompt', () => {
    const single: ModalPrompt = {
      conversationId: 'conv-m3',
      modalId: 'm3',
      class: 'trust',
      title: 'Trust this workspace',
      prompt: 'Grant access',
      options: [{ id: 'ok', label: 'OK' }],
      defaultOptionId: 'ok'
    }
    const markup = renderView(single)
    expect(optionCount(markup)).toBe(1)
  })

  it('renders a leading cancel affordance in the action row (AC1)', () => {
    const markup = renderView(PROMPT)
    // Cancel precedes Continue in the action row; choices are separate native inputs.
    expect(markup).toContain('class="button-small question-panel__cancel permission-modal__cancel">Cancel</button>')
    expect(optionCount(markup)).toBe(3)
    expect(markup.indexOf('permission-modal__cancel')).toBeLessThan(markup.indexOf('>Continue</button>'))
    expect(markup).toContain('disabled=""')
    expect(markup).not.toContain('checked=""')
  })
})

// #226: the confirm sub-step — when `pendingOption` is set, the view renders a client-owned confirm
// sentence + a Back/Confirm action row INSTEAD of the daemon option list, reusing the same dialog chrome.
describe('PermissionModalView — the second-confirm sub-step (#226)', () => {
  const pending: ModalOption = { id: 'allow-once', label: 'Allow once' }

  it('renders a client-owned confirm sentence naming the held option, not the daemon option list (AC1)', () => {
    const markup = renderView(PROMPT, pending)
    expect(markup).toContain('Send')
    expect(markup).toContain('Allow once')
    // The daemon option list is NOT rendered in confirm mode…
    expect(optionCount(markup)).toBe(0)
    // …nor the daemon prompt body or the other (unselected) daemon options.
    expect(markup).not.toContain('claude wants to write to schema.ts')
    expect(markup).not.toContain('Allow always')
  })

  it('renders a leading Back and a trailing Confirm affordance (AC1)', () => {
    const markup = renderView(PROMPT, pending)
    expect(markup).toContain('class="button-small question-panel__cancel permission-modal__back">Back</button>')
    expect(markup).toContain('class="button-small question-panel__continue permission-modal__confirm">Confirm</button>')
    // Back is the leading (left) action; Confirm trails it. The list-mode Cancel is gone in this mode.
    expect(markup.indexOf('permission-modal__back')).toBeLessThan(
      markup.indexOf('permission-modal__confirm')
    )
    expect(markup).not.toContain('permission-modal__cancel')
  })

  it('escapes an untrusted held-option label in the confirm sentence (AC4)', () => {
    const markup = renderView(PROMPT, { id: 'x', label: '<img src=x onerror=alert(1)>' })
    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(markup).not.toContain('<img src=x onerror=alert(1)>')
  })

  it('keeps the panel region and title so the user stays oriented on what is being approved', () => {
    const markup = renderView(PROMPT, pending)
    expect(markup).toContain('role="region"')
    expect(markup).not.toContain('aria-modal')
    expect(markup).toContain('aria-labelledby="permission-modal-title"')
    expect(markup).toContain('Allow file write')
  })
})

// #511: the second-confirm marker is scoped to the prompt it was selected on. These drive the REAL
// reducer through the two routes that swap `outstanding[0]` under a live marker, then render the pure
// view with the derived `pendingOption` — the interactiveRoundtrip precedent (real store logic + pure
// view, no jsdom). The fixtures use the real daemon `permission` vocabulary, so A and B share their
// ENTIRE option-id set; a pair with disjoint ids would not exercise the bug (AC1).
describe('PermissionModal — the second-confirm marker is scoped to its prompt (#511)', () => {
  const DAEMON_OPTIONS: readonly ModalOption[] = [
    { id: 'allow_once', label: 'Allow once' },
    { id: 'allow_always', label: 'Allow always' },
    { id: 'reject_once', label: 'Reject once' },
    { id: 'reject_always', label: 'Reject always' }
  ]

  function shown(modalId: string): ModalEvent {
    return {
      type: 'shown',
      conversationId: `conv-${modalId}`,
      modalId,
      class: 'permission',
      title: `Allow Bash (${modalId})`,
      prompt: `claude wants to run the build (${modalId})`,
      options: DAEMON_OPTIONS,
      defaultOptionId: 'reject_once'
    }
  }

  function run(events: readonly ModalEvent[]): ModalState {
    return events.reduce(reduceModal, initialModalState)
  }

  // What the user armed by clicking A's non-default "Allow always" (the selectOption gate holds it
  // pending a confirm rather than answering — modalResolution.test.ts).
  const ARMED_ON_A: PendingConfirm = { modalId: 'mdl-a', optionId: 'allow_always' }

  it('falls back to list mode when a remote dismissed swaps outstanding[0] to another prompt (AC1)', () => {
    // A and B are outstanding; A is resolved elsewhere (another device, or the daemon's
    // deny-on-timeout), so B becomes outstanding[0] under a marker armed on A.
    const state = run([
      shown('mdl-a'),
      shown('mdl-b'),
      { type: 'dismissed', modalId: 'mdl-a', outcome: 'allow_once', source: 'remote' }
    ])
    const prompt = selectOutstanding(state)[0]
    expect(prompt.modalId).toBe('mdl-b')
    // Non-vacuous: B genuinely offers the held id, so a list-mode render is the modalId guard firing.
    expect(prompt.options.some((o) => o.id === ARMED_ON_A.optionId)).toBe(true)

    const pendingOption = resolvePendingOption(prompt, ARMED_ON_A)
    expect(pendingOption).toBeNull()
    const markup = renderView(prompt, pendingOption)
    expect(optionCount(markup)).toBe(4)
    expect(markup).toContain('class="button-small question-panel__cancel permission-modal__cancel">Cancel</button>')
    expect(markup).not.toContain('permission-modal__confirm')
    expect(markup).not.toContain('This grants the requested action')
  })

  it('does not survive the empty-outstanding window across a reconnect (AC2)', () => {
    // #1140: the reconnect names the conversations belonging to the server that came back, and both
    // seeded prompts are on it — so this stays the same whole-slice empty window it was written for.
    const emptied = run([
      shown('mdl-a'),
      shown('mdl-b'),
      { type: 'reconnected', conversationIds: new Set(['conv-mdl-a', 'conv-mdl-b']) }
    ])
    // The empty window is explicitly exercised: the container returns null here, but returning null
    // does NOT unmount it (ConversationScreen mounts it unconditionally), so the marker survives.
    expect(selectOutstanding(emptied)).toHaveLength(0)
    expect(resolvePendingOption(selectOutstanding(emptied)[0], ARMED_ON_A)).toBeNull()

    // The daemon repopulates via its connect-time re-sends; their order need not match the old one,
    // so outstanding[0] can come back as a different prompt.
    const state = reduceModal(emptied, shown('mdl-b'))
    const prompt = selectOutstanding(state)[0]
    expect(prompt.modalId).toBe('mdl-b')
    expect(prompt.options.some((o) => o.id === ARMED_ON_A.optionId)).toBe(true)

    const pendingOption = resolvePendingOption(prompt, ARMED_ON_A)
    expect(pendingOption).toBeNull()
    expect(optionCount(renderView(prompt, pendingOption))).toBe(4)
  })

  it('still renders the confirm sub-step for the prompt the option WAS selected on (AC3)', () => {
    // The mutation control, and it is not optional: every assertion above is "→ null", so a
    // resolvePendingOption that simply returned null always would pass all of them. This is the one
    // that fails against that stub.
    const state = run([shown('mdl-a'), shown('mdl-b')])
    const prompt = selectOutstanding(state)[0]
    expect(prompt.modalId).toBe('mdl-a')

    const pendingOption = resolvePendingOption(prompt, ARMED_ON_A)
    expect(pendingOption).toEqual({ id: 'allow_always', label: 'Allow always' })

    const markup = renderView(prompt, pendingOption)
    expect(markup).toContain('class="button-small question-panel__cancel permission-modal__back">Back</button>')
    expect(markup).toContain('class="button-small question-panel__continue permission-modal__confirm">Confirm</button>')
    expect(optionCount(markup)).toBe(0)
  })
})

// #249: the rejection surface — a transient "your answer was rejected" banner stack at the modal host.
// A pure, exported view (rejection modalIds in, markup out), server-render-tested like PermissionModalView.
// The dismiss click → dispatch wiring is proven at two seams instead of a DOM click (the `node` env fires
// none): the `rejectionDismissed` reduce arm (modalPrompts.test.ts) and the button's presence here.
describe('RejectionSurfaceView — the modal-answer rejection surface (#249)', () => {
  function renderRejections(rejections: readonly string[]): string {
    return renderToStaticMarkup(
      <RejectionSurfaceView rejections={rejections} onDismiss={noop} />
    )
  }

  it('renders nothing when there are no rejections (AC5 — zero layout footprint)', () => {
    expect(renderRejections([])).toBe('')
  })

  it('renders the client-owned category copy and a dismiss control, never the raw modalId (AC1/AC3/AC4)', () => {
    // A distinctive nonce so the "not rendered" assertion is meaningful — the modalId is the React key
    // and the onDismiss argument only, never visible text (it is meaningless to a human, AC4).
    const markup = renderRejections(['mdl-nonce-deadbeef'])
    expect(markup).toContain('Your answer was rejected.')
    // A dismiss control with an accessible name (its visible text).
    expect(markup).toContain('class="modal-rejection__dismiss">Dismiss</button>')
    // No daemon content and no raw nonce reaches the DOM.
    expect(markup).not.toContain('mdl-nonce-deadbeef')
  })

  it('announces each banner to assistive tech via a live region', () => {
    const markup = renderRejections(['m1'])
    expect(markup).toContain('role="alert"')
  })

  it('stacks one banner per rejection, keyed by modalId (AC1 — ≥1 rejection)', () => {
    const markup = renderRejections(['m1', 'm2'])
    // Count banner elements (the container is `modal-rejections`, quote-terminated differently).
    expect(markup.match(/class="modal-rejection"/g)?.length ?? 0).toBe(2)
  })
})

describe('PermissionModal — the store-bound container', () => {
  it('renders nothing when no prompt is outstanding and no rejection is showing (AC2)', () => {
    // The modal store singleton is at its initial (empty) state; zustand v5 reads getInitialState()
    // under server render → no outstanding[0] and no rejections → null.
    expect(renderToStaticMarkup(<PermissionModal conversationId={null} />)).toBe('')
  })
})
