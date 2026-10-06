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

// The view receives effects as callbacks; controller tests prove consent and response routing.
const noop = (): void => {}
function renderView(prompt: ModalPrompt, armedOption: ModalOption | null = null, available = true): string {
  return renderToStaticMarkup(
    <PermissionModalView
      responseAvailable={available}
      sessionPermissionChecked={false}
      onSessionPermissionChange={noop}
      prompt={prompt}
      armedOption={armedOption}
      onActivate={noop}
      onCancel={noop}
    />
  )
}

// Count native choices independently from the action buttons.
function optionCount(markup: string): number {
  return markup.match(/class="permission-panel__choice(?: |")/g)?.length ?? 0
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
  it('renders one unchecked checkbox and every escaped rule in source order in both steps', () => {
    const prompt = { ...PROMPT, alwaysAllow: { offered: true, rules: ['Read(<img src=x>)', 'Bash(touch:*)', 'Read(<img src=x>)'] } }
    for (const pending of [null, PROMPT.options[0]]) {
      const markup = renderView(prompt, pending)
      expect(markup.match(/type="checkbox"/g)).toHaveLength(1)
      expect(markup).toContain('Don&#x27;t ask again this session for:')
      expect(markup.match(/Read\(&lt;img src=x&gt;\)/g)).toHaveLength(2)
      expect(markup.indexOf('Read(&lt;')).toBeLessThan(markup.indexOf('Bash(touch:*)'))
      expect(markup).not.toContain('checked=""')
      expect(markup).not.toContain('<img src=x>')
      expect(markup).not.toContain(' title=')
    }
  })

  it('disables every decision and grant control when the unique owner is unavailable', () => {
    const markup = renderView({ ...PROMPT, alwaysAllow: { offered: true, rules: ['Read'] } }, null, false)
    expect(markup.match(/disabled=""/g)).toHaveLength(5)
    expect(markup).not.toContain('aria-label="Read"')
  })

  it('hides legacy, unavailable and trust offers', () => {
    for (const prompt of [PROMPT, { ...PROMPT, alwaysAllow: { offered: false, rules: [] } },
      { ...PROMPT, class: 'trust' as const, alwaysAllow: { offered: true, rules: ['Read'] } }]) {
      expect(renderView(prompt)).not.toContain('type="checkbox"')
    }
  })

  it('keeps the context-free presentation without empty secondary rows', () => {
    expect(renderView(PROMPT)).not.toContain('permission-panel__context')
  })

  it.each([
    [{ reason: 'Needs review' }, 'Reason: Needs review'],
    [{ reasonType: 'classifier' }, 'The auto classifier could not approve this'],
    [{ reasonType: 'rule' }, 'A permission rule asks'],
    [{ reasonType: 'classifier', reason: 'Uncertain' }, 'The auto classifier could not approve this: Uncertain'],
    [{ reasonType: 'rule', reason: 'Review rule' }, 'A permission rule asks: Review rule'],
    [{ reasonType: 'future-category', reason: 'Keep this' }, 'Reason type: future-category: Keep this'],
    [{ reasonType: 'future-category' }, 'Reason type: future-category'],
    [{ reason: null }, 'Reason: null'],
    [{ reason: false }, 'Reason: false'],
    [{ reason: 0 }, 'Reason: 0'],
    [{ reason: { checks: [false, 0, null] } }, 'Reason: {&quot;checks&quot;:[false,0,null]}']
  ])('renders independent category and meaningful reason for %j', (context, expected) => {
    const markup = renderView({ ...PROMPT, ...context })
    expect(markup).toContain('permission-panel__context-text')
    expect(markup).toContain(expected)
  })

  it.each([{ description: 'Review description' }, { blockedPath: '/workspace/report' },
    { description: 'Review description', blockedPath: '/workspace/report' }])('shows description/path without inferring reason: %j', (context) => {
    const markup = renderView({ ...PROMPT, ...context })
    for (const value of Object.values(context)) expect(markup).toContain(`>${value}</p>`)
    expect(markup).not.toContain('Reason:')
    expect(markup).not.toContain('A permission rule asks')
  })

  it('renders every context field as escaped text, never an attribute or markup', () => {
    const text = '<img src=x onerror="alert(1)">'
    const markup = renderView({ ...PROMPT, reason: { nested: text }, reasonType: text,
      description: text, blockedPath: text, defaultToNo: true })
    expect(markup).not.toContain('<img src=x')
    expect(markup.match(/&lt;img/g)).toHaveLength(4)
    expect(markup).not.toContain(' title=')
    expect(markup).not.toContain(' href=')
    expect(markup).not.toContain('checked=""')
    expect(markup).not.toContain('disabled=""')
    expect(markup).toContain('Deny</button>')
  })

  it('renders the title and prompt text (AC2)', () => {
    const markup = renderView(PROMPT)
    expect(markup).toContain('Allow file write')
    expect(markup).toContain('claude wants to write to schema.ts')
  })

  it('renders one choice button per option in array order (AC2)', () => {
    const markup = renderView(PROMPT)
    expect(optionCount(markup)).toBe(3)
    expect(markup.indexOf('Allow once')).toBeLessThan(markup.indexOf('Deny'))
    expect(markup.indexOf('Deny')).toBeLessThan(markup.indexOf('Allow always'))
  })

  it('marks only the supplied default option (AC3)', () => {
    const markup = renderView(PROMPT)
    // Exactly one default, and it is the middle supplied choice.
    expect(markup.match(/permission-panel__choice--default/g)?.length ?? 0).toBe(1)
    expect(markup).toContain('Deny</button>')
    // The other labels remain unadorned.
    expect(markup).toContain('Allow once</button>')
    expect(markup).toContain('Allow always</button>')
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

  it('renders exactly one choice button for a single-option prompt', () => {
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

  it('renders a Cancel after the card (AC1)', () => {
    const markup = renderView(PROMPT)
    // Cancel precedes Continue in the action row; choices are separate native inputs.
    expect(markup).toContain('class="button-small question-panel__cancel permission-modal__cancel">Cancel</button>')
    expect(optionCount(markup)).toBe(3)
    expect(markup.indexOf('permission-modal__cancel')).toBeGreaterThan(markup.indexOf('>Allow always</button>'))
    expect(markup).not.toContain('disabled=""')
    expect(markup).not.toContain('checked=""')
  })
})

describe('PermissionModalView — armed choice', () => {
  it('keeps the complete card and options with a client-owned accessible instruction', () => {
    const markup = renderView(PROMPT, PROMPT.options[0])
    expect(optionCount(markup)).toBe(3)
    expect(markup).toContain('permission-panel__choice--armed')
    expect(markup).toContain('aria-describedby="permission-choice-confirm"')
    expect(markup).toContain('Activate this choice again to confirm.')
    expect(markup).toContain('claude wants to write to schema.ts')
    expect(markup).toContain('>Cancel</button>')
    expect(markup).not.toContain('>Continue</button>')
    expect(markup).not.toContain('>Confirm</button>')
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

  it('still renders the armed choice for the prompt the option WAS selected on (AC3)', () => {
    // The mutation control, and it is not optional: every assertion above is "→ null", so a
    // resolvePendingOption that simply returned null always would pass all of them. This is the one
    // that fails against that stub.
    const state = run([shown('mdl-a'), shown('mdl-b')])
    const prompt = selectOutstanding(state)[0]
    expect(prompt.modalId).toBe('mdl-a')

    const pendingOption = resolvePendingOption(prompt, ARMED_ON_A)
    expect(pendingOption).toEqual({ id: 'allow_always', label: 'Allow always' })

    const markup = renderView(prompt, pendingOption)
    expect(markup).toContain('class="button-small question-panel__cancel permission-modal__cancel">Cancel</button>')
    expect(markup).toContain('Activate this choice again to confirm.')
    expect(optionCount(markup)).toBe(4)
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
