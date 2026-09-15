import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { EditChannelDialogView } from './EditChannelDialog'

// The #218/#224 idiom (the `EditChatDialog.test.tsx` twin one dialog over): server-render the pure view
// with injected props — no DOM harness, no store, no clicks (the `node` env fires none). The open /
// name-typing / send / dismiss wiring lives in the ChannelList container and belongs to Playwright,
// which is also where AC2's unchanged-name no-send and AC3's host-loss close are proven. This file
// proves the dialog's own markup.
const noop = (): void => {}

function renderView(name: string): string {
  return renderToStaticMarkup(
    <EditChannelDialogView
      name={name}
      onNameChange={noop}
      onCancel={noop}
      onSave={noop}
    />
  )
}

describe('EditChannelDialogView', () => {
  it('renders an accessible 640px modal dialog labelled by its title (AC2)', () => {
    const markup = renderView('kitchenclaw refactor')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    const titleId = markup.match(/aria-labelledby="([^"]+)"/)?.[1]
    expect(titleId).toBeTruthy()
    expect(markup).toContain(`id="${titleId}"`)
    expect(markup).toContain('class="modal"')
    // The drawing's preferred width (500:2120), carried by the shared Modal's `--modal-width`.
    expect(markup).toContain('--modal-width:640px')
    // The header's close control (the circled x at 489:1898), the shared Modal's own.
    expect(markup).toContain('aria-label="Close dialog"')
  })

  // The retitle's whole point. BOTH old words are asserted GONE rather than merely unmentioned: five
  // e2e specs locate a dialog on this pen by its role name, and a header that carried `Edit chat`
  // alongside `Edit channel` would let every one of them pass while the retitle had not happened.
  it('is headed Edit channel, with neither Edit chat nor Rename anywhere in it (AC2)', () => {
    const markup = renderView('kitchenclaw refactor')
    expect(markup).toContain('Edit channel')
    expect(markup).not.toContain('Edit chat')
    expect(markup).not.toContain('Rename')
  })

  it('renders the Channel name field prefilled with the injected current name (AC2)', () => {
    const markup = renderView('kitchenclaw refactor')
    expect(markup).toContain('Channel name:')
    expect(markup).toContain('value="kitchenclaw refactor"')
  })

  // AC2's "prefilled with the row's displayed title including the Untitled fallback". The fallback is
  // resolved by `titleFor` in the container, so what this view owes is that it renders whatever it is
  // handed verbatim — including the placeholder word, which must NOT be treated as "no name".
  it('renders the Untitled fallback as an ordinary prefilled value (AC2)', () => {
    const markup = renderView('Untitled')
    expect(markup).toContain('value="Untitled"')
    expect(markup).not.toMatch(/modal__action--confirm"[^>]*disabled/)
  })

  it('renders centred Cancel and OK actions (AC2)', () => {
    const markup = renderView('a name')
    expect(markup).toContain('modal__action--cancel')
    expect(markup).toContain('modal__action--confirm')
    expect(markup).toContain('>Cancel</button>')
    expect(markup).toContain('>OK</button>')
  })

  it('disables OK when the name is empty (AC2)', () => {
    // Assert on the OK button specifically — the class marker followed by `disabled` before its `>`.
    expect(renderView('')).toMatch(/modal__action--confirm"[^>]*disabled/)
  })

  it('disables OK when the name is whitespace-only (AC2)', () => {
    expect(renderView('   ')).toMatch(/modal__action--confirm"[^>]*disabled/)
  })

  it('enables OK once a non-blank name is entered (AC2)', () => {
    expect(renderView('a name')).not.toMatch(/modal__action--confirm"[^>]*disabled/)
  })

  // AC2's closing clause, and the reason this dialog is a new file rather than a prop on the old one:
  // #1440's Archive chat button belongs to the CHAT dialog and must not follow the pen here. #1438
  // draws this modal's own outlined button, under the `.edit-channel*` namespace, not this one.
  it('draws no Archive chat button and none of the chat dialog namespace (AC2)', () => {
    const markup = renderView('kitchenclaw refactor')
    expect(markup).not.toContain('Archive chat')
    expect(markup).not.toContain('rename-conversation')
  })

  // The `.edit-channel*` namespace itself, asserted because it is a locator contract: the shipped specs
  // find the chat dialog through `.rename-conversation*`, so the two must not share a selector.
  it('wears its own edit-channel namespace on the overlay, scrim, field and input (AC2)', () => {
    const markup = renderView('kitchenclaw refactor')
    expect(markup).toContain('class="edit-channel-overlay"')
    expect(markup).toContain('class="edit-channel-overlay__scrim"')
    expect(markup).toContain('class="edit-channel__field"')
    expect(markup).toContain('class="edit-channel__label"')
    expect(markup).toContain('class="edit-channel__input"')
  })

  // AC3's second half: the conversation title is daemon-authored and reaches the controlled input and
  // nothing else. React escapes `&` → `&amp;` in an attribute value; assert the value is escaped, not
  // raw — and that the title never becomes an `aria-label` on any element (CLAUDE.md's outright ban).
  it('renders the prefilled name as inert escaped attribute text, never live markup (AC3)', () => {
    const markup = renderView('Tom & Jerry')
    expect(markup).toContain('Tom &amp; Jerry')
    expect(markup).not.toContain('value="Tom & Jerry"')
  })

  it('never puts the daemon-authored name into an aria-label (AC3)', () => {
    const markup = renderView('kitchenclaw refactor')
    expect(markup).not.toMatch(/aria-label="[^"]*kitchenclaw/)
  })
})
