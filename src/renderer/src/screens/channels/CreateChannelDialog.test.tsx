import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CreateChannelDialogView } from './CreateChannelDialog'
import { slugForChannel } from './SaveAsChannelDialog'

const noop = (): void => {}
function renderView(name = '', busy = false, error: string | null = null): string {
  return renderToStaticMarkup(<CreateChannelDialogView
    name={name} location="scratch" busy={busy} error={error}
    onNameChange={noop} onLocationChange={noop} onCancel={noop} onCreate={noop}
  />)
}

describe('CreateChannelDialogView', () => {
  it('uses the shared 640px modal with a labelled name and both location choices', () => {
    const markup = renderView()
    expect(markup).toContain('class="modal"')
    expect(markup).toContain('--modal-width:640px')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('>Create channel</h2>')
    expect(markup).toContain('aria-label="Close dialog"')
    expect(markup).toContain('Channel name:')
    expect(markup).toContain('Use shared scratch folder')
    expect(markup).toContain('Create a dedicated channel folder')
    expect(markup).toMatch(/type="radio"[^>]*checked=""[^>]*value="scratch"/)
    expect(markup).toMatch(/create-channel__input"[^>]*autofocus=""/)
    expect(markup).toContain('value=""')
    expect(markup).toContain('>Cancel</button>')
    expect(markup).toContain('>OK</button>')
  })

  it.each(['', '   '])('requires a nonblank trimmed name (%j)', (name) => {
    expect(renderView(name)).toMatch(/modal__action--confirm"[^>]*disabled/)
  })

  it('enables OK for a name, freezes editable controls while pending, and keeps dismissal available', () => {
    expect(renderView('Release planning')).not.toMatch(/modal__action--confirm"[^>]*disabled/)
    const pending = renderView('Release planning', true)
    expect(pending).toMatch(/modal__action--confirm"[^>]*disabled/)
    expect(pending.match(/<input[^>]*disabled=""/g)).toHaveLength(3)
    expect(pending).not.toMatch(/modal__(?:close|action--cancel)"[^>]*disabled/)
  })

  it('renders error text accessibly and escapes operator input', () => {
    const markup = renderView('Tom & <img src=x onerror=boom>', false, 'Could not create that folder')
    expect(markup).toContain('value="Tom &amp; &lt;img src=x onerror=boom&gt;"')
    expect(markup).toContain('role="alert">Could not create that folder')
    expect(markup).not.toContain('<img src=x')
    expect(markup).not.toContain('title=')
  })

  it('reuses the folder conversion while preserving a distinct display name', () => {
    expect(slugForChannel(' Release planning ')).toBe('release-planning')
    expect(slugForChannel('../ /')).toBe('channel')
  })
})
