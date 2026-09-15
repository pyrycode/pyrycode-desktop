import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MAX_SYSTEM_PROMPT_BYTES } from '@shared/wire/types'
import { SaveAsChannelDialogView, requestPromoteConversation } from './SaveAsChannelDialog'

// Static presentation and payload proof; interaction lives in save-as-channel-promote.spec.ts.
const noop = (): void => {}

function renderView(name: string, systemPrompt = '', promptOverLimit = false): string {
  return renderToStaticMarkup(
    <SaveAsChannelDialogView
      name={name}
      systemPrompt={systemPrompt}
      promptOverLimit={promptOverLimit}
      onNameChange={noop}
      onSystemPromptChange={noop}
      onCancel={noop}
      onSave={noop}
    />
  )
}

describe('SaveAsChannelDialogView', () => {
  it('renders an accessible modal dialog labelled by its title (AC1)', () => {
    const markup = renderView('My channel')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('--modal-width:640px')
    expect(markup).toContain('aria-label="Close dialog"')
    expect(markup).toContain('modal__header')
    expect(markup).toContain('modal__footer')
    expect(markup).toContain('Save as channel')
  })

  it('renders the Name field prefilled with the injected name (AC1)', () => {
    const markup = renderView('Investment Strategy Review')
    expect(markup).toContain('Channel name:')
    expect(markup).toContain('autofocus')
    expect(markup).toContain('value="Investment Strategy Review"')
  })

  // #1428 put the channel system prompt on the shared form behind an optional prop and this dialog
  // passed nothing; #1429 passes it, so the same field, treatment and accessible name now draw here.
  it('renders the system prompt field between the name input and the actions (AC1)', () => {
    const markup = renderView('Investment Strategy Review')
    expect(markup).toContain('Channel system prompt:')
    expect(markup).toContain('create-channel__textarea')
    // Ordering is part of the drawing: the label follows the name input and precedes the footer.
    expect(markup.indexOf('create-channel__input')).toBeLessThan(markup.indexOf('create-channel__textarea'))
    expect(markup.indexOf('create-channel__textarea')).toBeLessThan(markup.indexOf('modal__footer'))
  })

  it('renders an empty box for an empty draft, and never an autofocus on it (AC1)', () => {
    const markup = renderView('Investment Strategy Review')
    expect(markup).toContain('<textarea class="create-channel__textarea" rows="4"></textarea>')
  })

  // The draft may hold a pasted credential and reaches exactly one sink. React renders a controlled
  // textarea's value as an escaped TEXT CHILD server-side — assert the escaped form, not the raw one.
  it('renders the prompt draft as inert escaped text, never live markup (AC4)', () => {
    const markup = renderView('A channel', '<img src=x onerror="alert(1)"> & co')
    expect(markup).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; co')
    expect(markup).not.toContain('<img src=x')
  })

  it('shows no over-limit notice and leaves Save enabled under the bound (AC3)', () => {
    const markup = renderView('A channel', 'Answer only in haiku.')
    expect(markup).not.toContain('create-channel__notice')
    expect(markup).not.toMatch(/modal__action--confirm"[^>]*disabled/)
  })

  it('shows the over-limit notice and disables Save past the bound (AC3)', () => {
    const markup = renderView('A channel', 'far too long', true)
    expect(markup).toContain('create-channel__notice')
    expect(markup).toContain(`Over the ${MAX_SYSTEM_PROMPT_BYTES}-byte limit. Shorten it before saving.`)
    expect(markup).toMatch(/modal__action--confirm"[^>]*disabled/)
  })

  it('keeps Save disabled for a blank name however the prompt reads (AC2)', () => {
    expect(renderView('   ', 'Answer only in haiku.')).toMatch(/modal__action--confirm"[^>]*disabled/)
  })

  // #1436 withdrew the folder choice: promotion always uses the row's own workspace, so the form
  // carries neither radio nor the folder round trip's error line.
  it('renders no location radio, no folder wording and no failure line', () => {
    const markup = renderView('Investment Strategy Review')
    expect(markup).not.toContain('type="radio"')
    expect(markup).not.toContain('scratch')
    expect(markup).not.toContain('dedicated channel folder')
    expect(markup).not.toContain('create-channel__option')
    expect(markup).not.toContain('create-channel__error')
    expect(markup).not.toContain('Could not create that folder')
  })

  it('enables Save once a non-blank name is entered (AC preserved from #274)', () => {
    expect(renderView('a name')).not.toMatch(/modal__action--confirm"[^>]*disabled/)
  })

  it('disables Save when the name is empty', () => {
    expect(renderView('')).toMatch(/modal__action--confirm"[^>]*disabled/)
  })

  it('disables Save when the name is whitespace-only', () => {
    expect(renderView('   ')).toMatch(/modal__action--confirm"[^>]*disabled/)
  })

  it('renders the prefilled name as inert attribute text, never live markup (AC1)', () => {
    // React escapes `&` → `&amp;` in an attribute value; assert the value is escaped, not raw.
    const markup = renderView('Tom & Jerry')
    expect(markup).toContain('Tom &amp; Jerry')
    expect(markup).not.toContain('value="Tom & Jerry"')
  })
})

describe('requestPromoteConversation', () => {
  it('fires exactly one promoteConversation with the id, trimmed name, and explicit cwd (AC3)', () => {
    const sendCommand = vi.fn()
    requestPromoteConversation(sendCommand, 'conv-42', 'My Channel', '/home/alex/projects/demo')
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'promoteConversation',
      payload: {
        conversation_id: 'conv-42',
        name: 'My Channel',
        cwd: '/home/alex/projects/demo'
      }
    })
  })

  it('trims edge whitespace from the name while passing the workspace verbatim', () => {
    const sendCommand = vi.fn()
    requestPromoteConversation(sendCommand, 'conv-42', '  Padded Name  ', '/home/alex/projects/demo/')
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'promoteConversation',
      payload: {
        conversation_id: 'conv-42',
        name: 'Padded Name',
        cwd: '/home/alex/projects/demo/'
      }
    })
  })
})
