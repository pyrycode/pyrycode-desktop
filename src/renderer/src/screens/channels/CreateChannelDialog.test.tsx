import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MAX_SYSTEM_PROMPT_BYTES } from '@shared/wire/types'
import type { ConversationCreatedPayload } from '@shared/wire/types'
import { CreateChannelDialogView, confirmsPending, systemPromptOverLimit } from './CreateChannelDialog'

const noop = (): void => {}
function renderView(
  name = '',
  busy = false,
  error: string | null = null,
  systemPrompt = '',
  promptOverLimit = false
): string {
  return renderToStaticMarkup(<CreateChannelDialogView
    name={name} busy={busy} error={error}
    systemPrompt={systemPrompt} promptOverLimit={promptOverLimit}
    onNameChange={noop} onSystemPromptChange={noop} onCancel={noop} onCreate={noop}
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

  // #1436 withdrew the folder choice; #1428 added the prompt. The form is those two fields and
  // nothing else — pinned here so the radios cannot return unnoticed through the shared form.
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

  // AC1: the labelled text area sits between the name input and the actions, at the modal's full
  // content width, and is optional — an empty box leaves OK enabled for a named channel.
  it('renders the labelled system prompt text area under the name field', () => {
    const markup = renderView('Release planning')
    expect(markup).toContain('Channel system prompt:')
    expect(markup).toMatch(/create-channel__textarea"[^>]*>/)
    expect(markup.indexOf('Channel name:')).toBeLessThan(markup.indexOf('Channel system prompt:'))
    expect(markup.indexOf('Channel system prompt:')).toBeLessThan(markup.indexOf('>OK</button>'))
    expect(markup).not.toMatch(/modal__action--confirm"[^>]*disabled/)
  })

  // AC4: the prompt reaches one sink, an escaped React text child inside the controlled text area —
  // never markup, never an attribute.
  it('escapes prompt text into the text area and nowhere else', () => {
    const markup = renderView('Release planning', false, null, 'Tom & <img src=x onerror=boom>')
    expect(markup).toContain('>Tom &amp; &lt;img src=x onerror=boom&gt;</textarea>')
    expect(markup).not.toContain('<img src=x')
    expect(markup).not.toContain('placeholder=')
  })

  // AC1: disabled while the create is pending exactly as the name field is.
  it('freezes the text area while the create is pending', () => {
    const pending = renderView('Release planning', true, null, 'Answer only in haiku.')
    expect(pending).toMatch(/create-channel__textarea"[^>]*disabled=""/)
    expect(renderView('Release planning', false, null, 'Answer only in haiku.'))
      .not.toMatch(/create-channel__textarea"[^>]*disabled=""/)
  })

  // AC3: over the bound, OK is disabled and a readable client-owned notice says so. Under it nothing
  // extra is shown, as drawn.
  it('shows the over-limit notice with a disabled OK, and shows nothing extra under the bound', () => {
    const over = renderView('Release planning', false, null, 'Too long', true)
    expect(over).toContain('create-channel__notice')
    expect(over).toContain(`${MAX_SYSTEM_PROMPT_BYTES}-byte limit`)
    expect(over).toMatch(/modal__action--confirm"[^>]*disabled/)
    const under = renderView('Release planning', false, null, 'Short enough')
    expect(under).not.toContain('create-channel__notice')
    expect(under).not.toContain('byte limit')
  })
})

describe('systemPromptOverLimit', () => {
  it('counts UTF-8 bytes rather than code units', () => {
    // 8190 ASCII bytes + one 3-byte U+2693: 8193 bytes but only 8191 code units, so a `.length`
    // count would report "under" on a value main refuses. That divergence is the point.
    const anchored = 'a'.repeat(MAX_SYSTEM_PROMPT_BYTES - 2) + '⚓'
    expect(anchored.length).toBeLessThanOrEqual(MAX_SYSTEM_PROMPT_BYTES)
    expect(systemPromptOverLimit(anchored)).toBe(true)
  })

  it('treats the bound as inclusive, matching main', () => {
    expect(systemPromptOverLimit('')).toBe(false)
    expect(systemPromptOverLimit('a'.repeat(MAX_SYSTEM_PROMPT_BYTES))).toBe(false)
    expect(systemPromptOverLimit('a'.repeat(MAX_SYSTEM_PROMPT_BYTES + 1))).toBe(true)
  })
})

describe('confirmsPending', () => {
  const asked = { type: 'channel', name: 'Release planning', cwd: '/home/alex/demo',
    systemPrompt: 'Answer only in haiku.' } as const
  const created = (over: Partial<ConversationCreatedPayload> = {}): ConversationCreatedPayload => ({
    id: 'created-1', is_promoted: true, cwd: '/home/alex/demo', name: 'Release planning',
    last_used_at: '2026-09-15T00:00:00Z', workspace_label: null, ...over
  })

  it('confirms the create this dialog asked for', () => {
    expect(confirmsPending(created(), asked)).toBe(true)
  })

  // AC2: a same-host confirmation whose payload does not match what this dialog sent is somebody
  // else's create, and the operator's prompt must not be written onto it.
  it.each([
    ['a different name', { name: 'Someone else' }],
    ['a null name', { name: null }],
    ['a different cwd', { cwd: '/home/alex/other' }],
    ['an unpromoted conversation', { is_promoted: false }]
  ])('rejects a confirmation with %s', (_label, over) => {
    expect(confirmsPending(created(over), asked)).toBe(false)
  })

  it('rejects any confirmation while the draft has asked for nothing', () => {
    expect(confirmsPending(created(), { type: 'idle' })).toBe(false)
  })
})
