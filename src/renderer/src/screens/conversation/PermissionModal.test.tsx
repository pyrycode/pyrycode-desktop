import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PermissionModal, PermissionModalView } from './PermissionModal'
import type { ModalPrompt } from '../../store/modalPrompts'

// No DOM harness — mirrors ConversationScreen.test.tsx. PermissionModalView is the pure, exported view
// (ModalPrompt in, markup out), so a server-rendered string proves the render: title/prompt, one button
// per option in array order, the default modifier on the matching option, untrusted text escaped, and
// the dialog chrome. PermissionModal is the store-bound container; zustand v5's useStore reads
// getInitialState() (empty `outstanding`) under server rendering, so the container is exercised only for
// the empty case — the populated rendering is proven through PermissionModalView (the RepairControl note).
// The click → answerPrompt / cancelPrompt behavior lives in modalResolution.test.ts (plain spies): the
// `node` environment fires no clicks, so the view is server-rendered for structure only.

// #237: onAnswer / onCancel are required props now (a view that cannot answer is a bug). The structural
// tests inject no-op effects; the wiring is exercised in modalResolution.test.ts.
const noop = (): void => {}
function renderView(prompt: ModalPrompt): string {
  return renderToStaticMarkup(
    <PermissionModalView prompt={prompt} onAnswer={noop} onCancel={noop} />
  )
}

// Count OPTION buttons specifically (match the class attribute's leading token, bounded by a closing
// quote or the space before the --default modifier), so neither the `permission-modal__options`
// container div nor the new leading `permission-modal__cancel` button inflates the count. The default
// option's class is `permission-modal__option permission-modal__option--default`, but only its leading
// token is preceded by `class="`, so it still counts once.
function optionCount(markup: string): number {
  return markup.match(/class="permission-modal__option["\s]/g)?.length ?? 0
}

// The default marked neither first nor last, so order and default-marking are independent (spec note).
const PROMPT: ModalPrompt = {
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

  it('renders one button per option in array order (AC2)', () => {
    const markup = renderView(PROMPT)
    expect(optionCount(markup)).toBe(3)
    expect(markup.indexOf('Allow once')).toBeLessThan(markup.indexOf('Deny'))
    expect(markup.indexOf('Deny')).toBeLessThan(markup.indexOf('Allow always'))
  })

  it('marks only the defaultOptionId option with the --default modifier (AC3)', () => {
    const markup = renderView(PROMPT)
    // Exactly one default, and it is the Deny button (the middle option).
    expect(markup.match(/permission-modal__option--default/g)?.length ?? 0).toBe(1)
    expect(markup).toContain('permission-modal__option--default">Deny</button>')
    // The other two carry only the base class, never the modifier.
    expect(markup).toContain('class="permission-modal__option">Allow once</button>')
    expect(markup).toContain('class="permission-modal__option">Allow always</button>')
  })

  it('renders title / prompt / labels as inert text, never live markup (AC4)', () => {
    // No apostrophes — renderToStaticMarkup escapes ' → &#x27; (prior desktop lesson).
    const injected: ModalPrompt = {
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

  it('renders an accessible modal dialog labelled by its title', () => {
    const markup = renderView(PROMPT)
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-labelledby="permission-modal-title"')
    expect(markup).toContain('id="permission-modal-title"')
  })

  it('renders exactly one button for a single-option prompt', () => {
    const single: ModalPrompt = {
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
    // A dedicated cancel button with its own class + client-owned label (not `permission-modal__option`,
    // so it does not inflate optionCount and is styleable as the leading-dismissive M3 action).
    expect(markup).toContain('class="permission-modal__cancel">Cancel</button>')
    expect(optionCount(markup)).toBe(3)
    // It is the leading (first) child of the action row — before the first daemon option button.
    // Compare against the plain option button's exact class (`…__option"`, quote-terminated) so the
    // `permission-modal__options` container div — which naturally precedes all its children — is not
    // what we measure against.
    expect(markup.indexOf('permission-modal__cancel')).toBeLessThan(
      markup.indexOf('class="permission-modal__option"')
    )
  })
})

describe('PermissionModal — the store-bound container', () => {
  it('renders nothing when no prompt is outstanding (AC2)', () => {
    // The modal store singleton is at its initial (empty) state; zustand v5 reads getInitialState()
    // under server render → no outstanding[0] → null.
    expect(renderToStaticMarkup(<PermissionModal />)).toBe('')
  })
})
