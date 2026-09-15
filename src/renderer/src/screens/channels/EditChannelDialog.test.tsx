import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  EditChannelDialogView,
  promptWriteFor,
  type EditChannelPrompt,
  type PromptState
} from './EditChannelDialog'

// The #218/#224 idiom (the `EditChatDialog.test.tsx` twin one dialog over): server-render the pure view
// with injected props — no DOM harness, no store, no clicks (the `node` env fires none). The open /
// name-typing / send / dismiss wiring lives in the ChannelList container and belongs to Playwright,
// which is also where AC2's unchanged-name no-send and AC3's host-loss close are proven. This file
// proves the dialog's own markup.
//
// #1477 gave the view a SECOND field, so every case below now also declares which arm of the read the
// dialog is in. The default is the arm the fake tier lives in — `reading`, because `conversationStateFake`
// answers no `request_system_prompt` at all — which keeps every shipped name-field assertion above
// rendering exactly the frame the shipped e2e specs drive.
const noop = (): void => {}

const READING: EditChannelPrompt = { state: 'reading' }

function read(value: string, overLimit = false): EditChannelPrompt {
  return { state: 'read', value, overLimit, onChange: noop }
}

function renderView(name: string, prompt: EditChannelPrompt = READING): string {
  return renderToStaticMarkup(
    <EditChannelDialogView
      name={name}
      prompt={prompt}
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

  // --- #1477's Channel system prompt field.

  it('renders the Channel system prompt label over a text area in both arms (AC1)', () => {
    for (const prompt of [READING, read('stored text')]) {
      const markup = renderView('a name', prompt)
      expect(markup).toContain('Channel system prompt:')
      expect(markup).toContain('<textarea')
    }
  })

  // AC1's reading gate. `disabled` and NOT `readOnly` is load-bearing beyond the styling: a disabled
  // control stays OUT OF THE TAB ORDER, which is what keeps `conversation-create-rename.spec.ts`'s
  // two-Tab walk (input → Cancel → OK) passing at a fake tier that never answers the ask.
  it('draws a disabled empty text area and the reading line before the reply arrives (AC1)', () => {
    const markup = renderView('a name', READING)
    expect(markup).toMatch(/<textarea[^>]*disabled/)
    expect(markup).not.toMatch(/<textarea[^>]*readonly/i)
    expect(markup).toContain('Reading the stored prompt from the daemon')
    expect(markup).toContain('class="edit-channel__reading"')
  })

  it('seeds the text area verbatim once the reply arrives, and drops the reading line (AC1)', () => {
    const markup = renderView('a name', read('Answer only in haiku.'))
    expect(markup).toContain('>Answer only in haiku.</textarea>')
    expect(markup).not.toMatch(/<textarea[^>]*disabled/)
    expect(markup).not.toContain('Reading the stored prompt from the daemon')
  })

  // The tri-state's renderer half: the container maps an ABSENT prompt (`undefined`) and an explicitly
  // EMPTY one (`''`) onto the same empty seed, and this view must render that seed as an empty EDITABLE
  // box — never as the reading arm, which would make an absent prompt indistinguishable from an
  // unanswered ask and leave the box permanently unwritable.
  it('renders an empty seed as an empty editable box, not as the reading arm (AC1)', () => {
    const markup = renderView('a name', read(''))
    expect(markup).toContain('<textarea class="edit-channel__textarea" rows="4"></textarea>')
    expect(markup).not.toContain('Reading the stored prompt from the daemon')
  })

  // AC2's headline, and the finding that moved this ticket off its filed shape. Asserted as a REGRESSION
  // PIN rather than as a feature: a withheld OK would never enable at the default tier (the shared fake
  // answers no `request_system_prompt`), taking `conversation-state-fake.spec.ts`,
  // `sidebar-offline-mutations.spec.ts` and `conversation-create-rename.spec.ts` down with it.
  it('leaves OK live while the prompt is still being read (AC2)', () => {
    expect(renderView('a name', READING)).not.toMatch(/modal__action--confirm"[^>]*disabled/)
  })

  it('still disables OK on a blank name while the prompt is being read (AC2)', () => {
    expect(renderView('   ', READING)).toMatch(/modal__action--confirm"[^>]*disabled/)
  })

  it('disables OK and shows the readable notice on a prompt past the byte bound (AC2)', () => {
    const markup = renderView('a name', read('far too long', true))
    expect(markup).toMatch(/modal__action--confirm"[^>]*disabled/)
    expect(markup).toContain('Over the 8192-byte limit. Shorten it before saving.')
    expect(markup).toContain('class="edit-channel__notice"')
  })

  it('shows no over-limit notice on a prompt within the bound (AC2)', () => {
    const markup = renderView('a name', read('short enough'))
    expect(markup).not.toContain('8192-byte limit')
    expect(markup).not.toContain('edit-channel__notice')
  })

  // The locator contract, restated for the three elements this ticket adds: the shipped specs find the
  // CREATE dialog's own prompt field through `.create-channel*`, so the two must not share a selector.
  it('wears the edit-channel namespace on the text area, notice and reading line (AC1)', () => {
    expect(renderView('a name', READING)).toContain('class="edit-channel__textarea"')
    expect(renderView('a name', read('x', true))).not.toContain('create-channel')
    expect(renderView('a name', READING)).not.toContain('create-channel')
  })

  // AC3's sink clause. The prompt is operator-authored text that may hold a pasted credential and
  // arrives over the network; it reaches ONE sink, the controlled text area, which React renders as an
  // escaped TEXT CHILD here and sets as a DOM property in the browser.
  it('renders the prompt as inert escaped text, never live markup (AC3)', () => {
    const markup = renderView('a name', read('<script>alert(1)</script> & more'))
    expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; more')
    expect(markup).not.toContain('<script>')
  })

  it('never puts the prompt into an attribute or an aria-label (AC3)', () => {
    const markup = renderView('a name', read('secret-prompt-text'))
    expect(markup).not.toMatch(/aria-label="[^"]*secret-prompt-text/)
    expect(markup).not.toMatch(/value="[^"]*secret-prompt-text/)
  })
})

// #1477's write rule (AC2), the one part of the OK decision that is pure and therefore provable at this
// tier — the click that reaches it belongs to Playwright. Read `null` as SEND NOTHING; the `prompt`
// inside a returned box is the WIRE's own tri-state, where `null` means clear.
describe('promptWriteFor', () => {
  const reading: PromptState = { type: 'reading' }
  const cell = (seed: string, draft: string): PromptState => ({ type: 'read', seed, draft })

  it('sends nothing while the reading is still outstanding, whatever the box shows (AC2)', () => {
    expect(promptWriteFor(reading)).toBeNull()
  })

  it('sends the typed text verbatim and untrimmed (AC2)', () => {
    expect(promptWriteFor(cell('old text', '  new text  '))).toEqual({ prompt: '  new text  ' })
  })

  it('sends a clear when a seeded box is emptied (AC2)', () => {
    expect(promptWriteFor(cell('Answer only in haiku.', ''))).toEqual({ prompt: null })
  })

  it('sends nothing when the box still holds what was read (AC2)', () => {
    expect(promptWriteFor(cell('Answer only in haiku.', 'Answer only in haiku.'))).toBeNull()
  })

  // The tri-state's write half, and the case a truthiness read anywhere on this path would get wrong:
  // an absent AND an explicitly empty stored prompt both seed `''`, so a box left alone must send
  // nothing rather than a redundant clear.
  it('sends nothing when a box empty before is still empty after (AC2)', () => {
    expect(promptWriteFor(cell('', ''))).toBeNull()
  })

  it('sends text typed into a box that was empty when read (AC2)', () => {
    expect(promptWriteFor(cell('', 'a first prompt'))).toEqual({ prompt: 'a first prompt' })
  })

  // Whitespace is TEXT, not blankness: the value round-trips to the daemon as a write, so a box holding
  // spaces differs from an empty seed and is sent as what it holds. The `.trim() === ''` collapse the
  // create dialog applies to its own draft is that dialog's rule and deliberately not this one's — it
  // has no seed to compare against, so blankness is the only signal it has.
  it('treats a whitespace-only draft as text rather than as a clear (AC2)', () => {
    expect(promptWriteFor(cell('', '   '))).toEqual({ prompt: '   ' })
  })
})
