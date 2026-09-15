import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CreateChannelDialogView } from './CreateChannelDialog'

const noop = (): void => {}
function renderView(name = '', busy = false, error: string | null = null): string {
  return renderToStaticMarkup(<CreateChannelDialogView
    name={name} busy={busy} error={error}
    onNameChange={noop} onCancel={noop} onCreate={noop}
  />)
}

describe('CreateChannelDialogView', () => {
  it('uses the shared 640px modal with a labelled name and no location choice', () => {
    const markup = renderView()
    expect(markup).toContain('class="modal"')
    expect(markup).toContain('--modal-width:640px')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('>Create channel</h2>')
    expect(markup).toContain('aria-label="Close dialog"')
    expect(markup).toContain('Channel name:')
    expect(markup).toMatch(/create-channel__input"[^>]*autofocus=""/)
    expect(markup).toContain('value=""')
    expect(markup).toContain('>Cancel</button>')
    expect(markup).toContain('>OK</button>')
  })

  // #1436 withdrew the folder choice: the form is the name field alone until #1428 adds the
  // system prompt. Pinned here so the radios cannot return unnoticed through the shared form.
  it('renders no location radio and no folder wording', () => {
    const markup = renderView('Release planning')
    expect(markup).not.toContain('type="radio"')
    expect(markup).not.toContain('scratch')
    expect(markup).not.toContain('dedicated channel folder')
    expect(markup).not.toContain('create-channel__option')
  })

  it.each(['', '   '])('requires a nonblank trimmed name (%j)', (name) => {
    expect(renderView(name)).toMatch(/modal__action--confirm"[^>]*disabled/)
  })

  it('enables OK for a name, freezes the name field while pending, and keeps dismissal available', () => {
    expect(renderView('Release planning')).not.toMatch(/modal__action--confirm"[^>]*disabled/)
    const pending = renderView('Release planning', true)
    expect(pending).toMatch(/modal__action--confirm"[^>]*disabled/)
    expect(pending.match(/<input[^>]*disabled=""/g)).toHaveLength(1)
    expect(pending).not.toMatch(/modal__(?:close|action--cancel)"[^>]*disabled/)
  })

  it('renders error text accessibly and escapes operator input', () => {
    const markup = renderView('Tom & <img src=x onerror=boom>', false, 'Could not create that channel')
    expect(markup).toContain('value="Tom &amp; &lt;img src=x onerror=boom&gt;"')
    expect(markup).toContain('role="alert">Could not create that channel')
    expect(markup).not.toContain('<img src=x')
    expect(markup).not.toContain('title=')
  })
})
