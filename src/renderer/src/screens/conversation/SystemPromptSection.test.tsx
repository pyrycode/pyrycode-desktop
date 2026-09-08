import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MAX_SYSTEM_PROMPT_BYTES } from '@shared/wire/types'
import type { SystemPromptReading } from '../../store/systemPromptStore'
import type { SystemPromptWrite } from '../../store/systemPromptWriteStore'
import { deriveSystemPromptSection, SystemPromptSectionView } from './SystemPromptSection'

// #1078: the channel info sheet's System prompt section. `deriveSystemPromptSection` holds the whole
// state machine, so every arm below is a plain function call rather than a render; `SystemPromptSectionView`
// is the pure exported view (the ChannelInfoSheetView / WorkspacePickerSheetView pattern) server-rendered
// with an injected model. Typing, saving and clearing are driven in e2e/channel-system-prompt.spec.ts —
// the `node` env fires no clicks and runs no effects, so the container's window.pyry dispatch and its
// useState are reviewed glue here, exactly as the ChannelInfoSheet container is.
const noop = (): void => {}

function reading(overrides: Partial<SystemPromptReading> = {}): SystemPromptReading {
  return { systemPrompt: 'stored text', sessionPromptStatus: 'no_session', ...overrides }
}

// The ready arm, narrowed — every assertion below reads a field that only exists on it, and a `loading`
// return would otherwise fail as an unhelpful type error rather than a named expectation.
function ready(
  r: SystemPromptReading | null,
  w: SystemPromptWrite | null,
  draft: string | null
): Extract<ReturnType<typeof deriveSystemPromptSection>, { state: 'ready' }> {
  const model = deriveSystemPromptSection(r, w, draft)
  if (model.state !== 'ready') throw new Error(`expected a ready model, got ${model.state}`)
  return model
}

// Isolate one element's opening tag so attribute presence (`disabled`) is directly assertable. It THROWS
// on a miss rather than returning '': a `?? ''` fallback turns a class rename into a vacuous pass, which
// is exactly how a guard assertion goes quietly green.
function tagFor(markup: string, className: string): string {
  const tag = markup.match(new RegExp(`<[a-z]+[^>]*class="${className}"[^>]*>`))?.[0]
  if (tag === undefined) throw new Error(`no element with class="${className}" in the markup`)
  return tag
}

describe('deriveSystemPromptSection — the section state machine (#1078)', () => {
  it('reports `loading` while the reading has not arrived, so nothing can be saved blank (AC1)', () => {
    expect(deriveSystemPromptSection(null, null, null)).toEqual({ state: 'loading' })
  })

  it('stays `loading` even when a write marker is held — the reading is the whole gate (AC1)', () => {
    expect(deriveSystemPromptSection(null, { status: 'confirmed' }, null).state).toBe('loading')
  })

  it('seeds the editor empty for a conversation holding NO prompt — an ordinary state (AC1)', () => {
    expect(ready(reading({ systemPrompt: undefined }), null, null).text).toBe('')
  })

  it('seeds the editor empty for an EXPLICITLY EMPTY stored prompt, the same as holding none', () => {
    expect(ready(reading({ systemPrompt: '' }), null, null).text).toBe('')
  })

  it('seeds the editor with the stored text verbatim — no trim, no normalisation', () => {
    expect(ready(reading({ systemPrompt: '  spaced\n\n' }), null, null).text).toBe('  spaced\n\n')
  })

  it('lets a typed draft WIN over a reading, so a late reply cannot overwrite typed text', () => {
    // The security-review Concurrency finding: an on-path relay can delay the `system_prompt` reply
    // arbitrarily. Once the operator has typed, `draft` is non-null and the reading is never read for
    // display again — otherwise their text would be silently replaced and the next Save would store the
    // daemon's value under the operator's intent.
    expect(ready(reading({ systemPrompt: 'from the daemon' }), null, 'typed by hand').text).toBe(
      'typed by hand'
    )
  })

  it('treats an emptied draft as a draft, not as untouched — `` is not `null`', () => {
    expect(ready(reading({ systemPrompt: 'from the daemon' }), null, '').text).toBe('')
  })

  it('counts UTF-8 BYTES, not code units', () => {
    // 'é' is 2 bytes, '𝄞' is 4 (and 2 UTF-16 code units) — a `.length` read would say 3.
    expect(ready(reading(), null, 'é𝄞').byteLength).toBe(6)
  })

  it('allows exactly MAX_SYSTEM_PROMPT_BYTES — the bound is INCLUSIVE (AC3)', () => {
    const model = ready(reading(), null, 'a'.repeat(MAX_SYSTEM_PROMPT_BYTES))
    expect(model.byteLength).toBe(MAX_SYSTEM_PROMPT_BYTES)
    expect(model.overLimit).toBe(false)
    expect(model.canSave).toBe(true)
  })

  it('withholds the save one byte over the bound, before the attempt (AC3)', () => {
    const model = ready(reading(), null, 'a'.repeat(MAX_SYSTEM_PROMPT_BYTES + 1))
    expect(model.overLimit).toBe(true)
    expect(model.canSave).toBe(false)
  })

  it('trips the bound on multi-byte text whose code-unit length is well under it (AC3)', () => {
    const text = 'é'.repeat(MAX_SYSTEM_PROMPT_BYTES / 2 + 1)
    expect(text.length).toBeLessThan(MAX_SYSTEM_PROMPT_BYTES)
    expect(ready(reading(), null, text).overLimit).toBe(true)
  })

  it('keeps Clear available while over the limit — a clear carries no bytes (AC2, AC3)', () => {
    const model = ready(reading(), null, 'a'.repeat(MAX_SYSTEM_PROMPT_BYTES + 1))
    expect(model.canClear).toBe(true)
  })

  it('withholds BOTH controls while a write is in flight — #1250 two-writes ambiguity (AC2)', () => {
    const model = ready(reading(), { status: 'in-flight' }, 'text')
    expect(model.canSave).toBe(false)
    expect(model.canClear).toBe(false)
    expect(model.writeLine).not.toBeNull()
  })

  it('reports a confirmed write, and says the running session keeps what it started with (AC2)', () => {
    const model = ready(reading(), { status: 'confirmed' }, null)
    expect(model.writeLine).toMatch(/Saved/)
    expect(model.canSave).toBe(true)
  })

  it.each([
    ['prompt-too-long' as const, /8192/],
    ['protocol-malformed' as const, /refused/],
    ['conversation-not-found' as const, /channel/],
    ['unclassified' as const, /refused/]
  ])('reports the reason for a %s refusal, in client-owned copy (AC2)', (reason, matcher) => {
    const model = ready(reading(), { status: 'rejected', reason }, null)
    expect(model.writeLine).toMatch(matcher)
    expect(model.canSave).toBe(true)
  })

  it('says nothing about a write when none is known — the fourth reading (AC2)', () => {
    expect(ready(reading(), null, null).writeLine).toBeNull()
  })

  it('names New session when the running session was started with a different prompt (AC4)', () => {
    const model = ready(reading({ sessionPromptStatus: 'differs' }), null, null)
    expect(model.sessionLine).toMatch(/New session/)
  })

  it.each(['matches' as const, 'no_session' as const])(
    'says nothing of the kind when the status is %s (AC4)',
    (sessionPromptStatus) => {
      expect(ready(reading({ sessionPromptStatus }), null, null).sessionLine).toBeNull()
    }
  )

  it('shows the count against the imported constant, never a restated literal (AC3)', () => {
    expect(ready(reading(), null, 'abc').countLine).toBe(`3 / ${MAX_SYSTEM_PROMPT_BYTES} bytes`)
  })
})

describe('SystemPromptSectionView — the rendered section (#1078)', () => {
  it('renders the section header in both arms', () => {
    const loading = renderToStaticMarkup(
      <SystemPromptSectionView
        model={{ state: 'loading' }}
        onTextChange={noop}
        onSave={noop}
        onClear={noop}
      />
    )
    expect(loading).toContain('System prompt')
  })

  it('offers NO editor and NO controls while the reading has not arrived (AC1)', () => {
    const markup = renderToStaticMarkup(
      <SystemPromptSectionView
        model={{ state: 'loading' }}
        onTextChange={noop}
        onSave={noop}
        onClear={noop}
      />
    )
    expect(markup).not.toContain('<textarea')
    expect(markup).not.toContain('<button')
  })

  it('renders the prompt as an escaped textarea child, never as markup (AC5)', () => {
    const markup = renderToStaticMarkup(
      <SystemPromptSectionView
        model={ready(reading({ systemPrompt: '<script>alert(1)</script>' }), null, null)}
        onTextChange={noop}
        onSave={noop}
        onClear={noop}
      />
    )
    expect(markup).not.toContain('<script>')
    expect(markup).toContain('&lt;script&gt;')
  })

  it('marks Save disabled once the count is over the limit (AC3)', () => {
    const markup = renderToStaticMarkup(
      <SystemPromptSectionView
        model={ready(reading(), null, 'a'.repeat(MAX_SYSTEM_PROMPT_BYTES + 1))}
        onTextChange={noop}
        onSave={noop}
        onClear={noop}
      />
    )
    expect(tagFor(markup, 'system-prompt__save')).toContain('disabled')
    expect(tagFor(markup, 'system-prompt__clear')).not.toContain('disabled')
  })

  it('marks BOTH controls disabled while a write is in flight (AC2)', () => {
    const markup = renderToStaticMarkup(
      <SystemPromptSectionView
        model={ready(reading(), { status: 'in-flight' }, null)}
        onTextChange={noop}
        onSave={noop}
        onClear={noop}
      />
    )
    expect(tagFor(markup, 'system-prompt__save')).toContain('disabled')
    expect(tagFor(markup, 'system-prompt__clear')).toContain('disabled')
  })

  it('renders the differs notice and the write line when the model carries them (AC2, AC4)', () => {
    const markup = renderToStaticMarkup(
      <SystemPromptSectionView
        model={ready(
          reading({ sessionPromptStatus: 'differs' }),
          { status: 'rejected', reason: 'conversation-not-found' },
          null
        )}
        onTextChange={noop}
        onSave={noop}
        onClear={noop}
      />
    )
    expect(tagFor(markup, 'system-prompt__session')).toBeTruthy()
    expect(tagFor(markup, 'system-prompt__write')).toBeTruthy()
  })

  it('omits the notice and the write line when the model has neither', () => {
    const markup = renderToStaticMarkup(
      <SystemPromptSectionView
        model={ready(reading(), null, null)}
        onTextChange={noop}
        onSave={noop}
        onClear={noop}
      />
    )
    expect(markup).not.toContain('system-prompt__session')
    expect(markup).not.toContain('system-prompt__write')
  })
})
