import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CreateChannelDialogView } from './CreateChannelDialog'

// The RenameConversationDialog test twin (#360's idiom): server-render the pure view with injected props
// — no DOM harness, no store, no clicks (the `node` env fires none). Which tree draws the plus that opens
// this dialog is `ChannelList.test.tsx`'s (AC1/AC4); the click, the focus and the round trip are
// `e2e/sidebar-create-channel.spec.ts`'s. This file proves the dialog's own markup (AC2).
const noop = (): void => {}

function renderView(name: string): string {
  return renderToStaticMarkup(
    <CreateChannelDialogView
      name={name}
      onNameChange={noop}
      onCancel={noop}
      onCreate={noop}
    />
  )
}

describe('CreateChannelDialogView', () => {
  it('renders an accessible modal dialog titled Create channel (AC2)', () => {
    const markup = renderView('')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-labelledby="create-channel-title"')
    expect(markup).toContain('id="create-channel-title"')
    expect(markup).toContain('>Create channel</h2>')
  })

  it('renders one Name field, empty and focused on open (AC2)', () => {
    const markup = renderView('')
    expect(markup).toContain('>Name</span>')
    // `autofocus=""` is what React's server renderer emits for `autoFocus`, and React DOM focuses the
    // element on mount — so this one attribute IS the "focused" half of AC2, assertable here rather
    // than only in a running window.
    expect(markup).toMatch(/create-channel__input"[^>]*autofocus=""/)
    expect(markup).toContain('value=""')
    // Exactly one field: a second input would be a location choice, which this dialog deliberately has
    // none of — the workspace is fixed by the row whose plus was clicked.
    expect(markup.split('<input').length - 1).toBe(1)
  })

  it('renders Cancel and Create actions (AC2)', () => {
    const markup = renderView('Release notes')
    expect(markup).toContain('create-channel__cancel')
    expect(markup).toContain('create-channel__create')
    expect(markup).toContain('>Cancel</button>')
    expect(markup).toContain('>Create</button>')
  })

  it('disables Create when the name is empty (AC2)', () => {
    expect(renderView('')).toMatch(/create-channel__create"[^>]*disabled/)
  })

  it('disables Create when the name is whitespace-only (AC2)', () => {
    expect(renderView('   ')).toMatch(/create-channel__create"[^>]*disabled/)
  })

  it('enables Create once a non-blank name is entered (AC2)', () => {
    expect(renderView('Release notes')).not.toMatch(/create-channel__create"[^>]*disabled/)
  })

  it('never disables Cancel — it closes and sends nothing in every state (AC2)', () => {
    expect(renderView('')).not.toMatch(/create-channel__cancel"[^>]*disabled/)
  })

  it('renders the typed name as inert attribute text, never live markup', () => {
    // The name is client-owned free text bound for the wire; it reaches exactly ONE sink, the
    // controlled input's auto-escaped value. The assertion is about the DELIMITERS and not about the
    // payload's words: `onerror=boom` survives verbatim inside the value and is inert there — what
    // makes it inert is that `<` and `>` are escaped, so no tag is ever opened. Asserting the absence
    // of the words instead would be a detector for the wrong thing and would pass on a sink that
    // interpolated the value into, say, a `title` attribute.
    const markup = renderView('Tom & <img src=x onerror=boom>')
    expect(markup).toContain('value="Tom &amp; &lt;img src=x onerror=boom&gt;"')
    expect(markup).not.toContain('<img')
  })

  it('carries no title attribute anywhere, and no cwd can reach one (AC2)', () => {
    // The view takes NO `cwd` prop at all, so no attribute of the overlay, panel, field, input or
    // either action can derive from the workspace path even by a future edit. This assertion pins the
    // `title=` half of that claim; the prop's absence is what pins the rest, and it is a type error to
    // pass one.
    expect(renderView('Release notes')).not.toContain('title=')
  })
})
