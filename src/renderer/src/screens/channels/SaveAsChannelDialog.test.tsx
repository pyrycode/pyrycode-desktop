import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SaveAsChannelDialogView, requestPromoteConversation } from './SaveAsChannelDialog'

// Static presentation and payload proof; interaction lives in save-as-channel-promote.spec.ts.
const noop = (): void => {}

function renderView(name: string): string {
  return renderToStaticMarkup(
    <SaveAsChannelDialogView name={name} onNameChange={noop} onCancel={noop} onSave={noop} />
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

  // #1428 put the channel system prompt on the shared form behind an optional prop, and this dialog
  // does not pass it: promotion has no create confirmation to hang the second write on, so Save as
  // channel keeps the name field alone (#1429 is the ticket that gives it one).
  it('renders the name field alone, with no system prompt field', () => {
    const markup = renderView('Investment Strategy Review')
    expect(markup).not.toContain('<textarea')
    expect(markup).not.toContain('Channel system prompt:')
    expect(markup).not.toContain('create-channel__textarea')
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
