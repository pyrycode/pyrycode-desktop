import { describe, it, expect, vi } from 'vitest'
import { isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  EditChannelDialogView,
  muteWriteFor,
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

function renderView(name: string, prompt: EditChannelPrompt = READING, muted = false): string {
  return renderToStaticMarkup(
    <EditChannelDialogView
      name={name}
      prompt={prompt}
      muted={muted}
      onMutedChange={noop}
      onNameChange={noop}
      onCancel={noop}
      onSave={noop}
      onArchive={noop}
    />
  )
}

// #1438's button, whose text IS its accessible name — no `aria-label`, which would put a string into an
// attribute. Spelled once here because it is a load-bearing e2e locator in two specs.
const ARCHIVE_LABEL = 'Archive channel'

/**
 * #1438 — the archive button's own props, read off the view's ELEMENT TREE rather than out of rendered
 * markup. `renderToStaticMarkup` discards every handler and nothing in this repo can click, so a walk of
 * the tree the pure view returns is the only way this environment can prove a handler is BOUND rather
 * than merely drawn. It recurses through `props.children`, which is also how it reaches inside `Modal`:
 * the dialog's content is that element's `children` PROP, unrendered and therefore still readable.
 *
 * Returns the props object so the caller can both compare `onClick` by identity and invoke it. The `as`
 * casts are the tier's allowance — this test knows the shapes it built.
 */
function archiveButtonProps(
  props: Parameters<typeof EditChannelDialogView>[0]
): { onClick?: () => void; disabled?: boolean } | null {
  const hits: Array<{ onClick?: () => void; disabled?: boolean }> = []
  const visit = (node: ReactNode): void => {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (!isValidElement(node)) return
    const elementProps = node.props as {
      className?: string
      onClick?: () => void
      disabled?: boolean
      children?: ReactNode
    }
    if (elementProps.className === 'edit-channel__archive') hits.push(elementProps)
    visit(elementProps.children)
  }
  visit(EditChannelDialogView(props))
  return hits[0] ?? null
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

  // #1476's AC2, and the reason this dialog is a new file rather than a prop on the old one: #1440's
  // Archive chat button belongs to the CHAT dialog and must not follow the pen here. Since #1438 this
  // modal HAS a put-away button, under its own word and its own namespace — so the two literals staying
  // DISJOINT is now the assertion, not their absence. They are disjoint only from their fifth-from-last
  // character on (`Archive cha|t` against `Archive cha|nnel`), which is the same razor-thin margin the
  // `Edit chat` / `Edit channel` pens keep and the same one a careless reword would close.
  it('draws no Archive chat button and none of the chat dialog namespace (#1476 AC2)', () => {
    const markup = renderView('kitchenclaw refactor')
    expect(markup).toContain(ARCHIVE_LABEL)
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

  // --- #1438's Archive channel button.

  // Copy, namespace and the ABSENCE of a disabled attribute, in one exact-markup assertion rather than
  // three loose `toContain`s: the whole element is short enough to pin, and pinning it is what makes
  // "no disabled arm of its own" an assertion about the element rather than about the string nearby.
  it('renders the outlined Archive channel button under its own namespace (AC1)', () => {
    const markup = renderView('a name', read('stored text'))
    expect(markup).toContain('class="edit-channel__actions"')
    expect(markup).toContain(
      `<button type="button" class="edit-channel__archive">${ARCHIVE_LABEL}</button>`
    )
  })

  // AC1's placement — the drawing's `Actions` frame is the LAST child of `Content`, below the text area
  // and above the centred footer. Asserted as document order, which is also the TAB order: a stop that
  // landed after Cancel would put a channel's put-away inside the dialog's answer row.
  it('places the button below the text area and above the footer actions (AC1)', () => {
    const markup = renderView('a name', read('stored text'))
    const textarea = markup.indexOf('edit-channel__textarea')
    const archive = markup.indexOf('edit-channel__archive')
    const cancel = markup.indexOf('modal__action--cancel')
    expect(textarea).toBeGreaterThan(-1)
    expect(archive).toBeGreaterThan(textarea)
    expect(cancel).toBeGreaterThan(archive)
  })

  // AC1's headline. The button reads NEITHER half of OK's disabled expression: a blank name is OK's
  // condition and the reading arm is nobody's, and putting a channel away has nothing to do with what
  // the two fields currently hold. Reusing OK's expression here is the regression this pins.
  it('stays live on a blank name and while the prompt is still being read (AC1)', () => {
    for (const markup of [renderView(''), renderView('   ', READING), renderView('a name', READING)]) {
      expect(markup).toMatch(/edit-channel__archive/)
      expect(markup).not.toMatch(/edit-channel__archive"[^>]*disabled/)
    }
    // ...while OK's own arms are untouched by its presence.
    expect(renderView('')).toMatch(/modal__action--confirm"[^>]*disabled/)
    expect(renderView('a name', read('too long', true))).toMatch(
      /modal__action--confirm"[^>]*disabled/
    )
  })

  // The copy IS the accessible name. An `aria-label` would put a string into an attribute, which this
  // dialog's other two assertions already forbid for daemon-authored text and which a client-owned
  // constant has no reason to need either.
  it('takes its accessible name from its text, with no aria-label anywhere (AC1)', () => {
    const markup = renderView('a name', read('stored text'))
    expect(markup).toContain(`>${ARCHIVE_LABEL}</button>`)
    expect(markup).not.toMatch(/aria-label="[^"]*Archive/)
  })

  // AC2's intent at this tier: the button is BOUND to the injected callback and to nothing else. Proven
  // off the element tree, since the click itself belongs to Playwright. Three spies, so "fires exactly
  // one thing" is an assertion about all three rather than about the one that was expected to fire.
  it('binds the injected onArchive, and rendering fires none of the callbacks (AC2)', () => {
    const onArchive = vi.fn()
    const onSave = vi.fn()
    const onCancel = vi.fn()
    const props = {
      name: 'a name',
      prompt: read('stored text'),
      muted: false,
      onMutedChange: noop,
      onNameChange: noop,
      onCancel,
      onSave,
      onArchive
    }
    renderToStaticMarkup(<EditChannelDialogView {...props} />)
    expect(onArchive).not.toHaveBeenCalled()

    const button = archiveButtonProps(props)
    expect(button).not.toBeNull()
    expect(button?.disabled).toBeUndefined()
    expect(button?.onClick).toBe(onArchive)
    button?.onClick?.()
    expect(onArchive).toHaveBeenCalledTimes(1)
    expect(onArchive).toHaveBeenCalledWith()
    expect(onSave).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })
})

// #1608 — the Mute notifications checkbox (Figma `Checkbox with label`, 540:2158). The click-through-OK
// path is Playwright's (`e2e/edit-channel-mute.spec.ts`); this tier pins the markup and the binding.
describe('EditChannelDialogView mute checkbox (#1608)', () => {
  const MUTE_LABEL = 'Mute notifications'

  /** The native checkbox's props, read off the element tree — the `archiveButtonProps` idiom. */
  function muteInputProps(
    props: Parameters<typeof EditChannelDialogView>[0]
  ): { checked?: boolean; onChange?: (e: { target: { checked: boolean } }) => void } | null {
    const hits: Array<{ checked?: boolean; onChange?: (e: { target: { checked: boolean } }) => void }> = []
    const visit = (node: ReactNode): void => {
      if (Array.isArray(node)) {
        node.forEach(visit)
        return
      }
      if (!isValidElement(node)) return
      const elementProps = node.props as {
        type?: string
        checked?: boolean
        onChange?: (e: { target: { checked: boolean } }) => void
        children?: ReactNode
      }
      if (node.type === 'input' && elementProps.type === 'checkbox') hits.push(elementProps)
      visit(elementProps.children)
    }
    visit(EditChannelDialogView(props))
    return hits.length === 1 ? hits[0] : null
  }

  it('draws one checkbox labelled Mute notifications under the edit-channel namespace (AC1)', () => {
    const markup = renderView('a name', read('stored text'))
    expect(markup.match(/type="checkbox"/g)).toHaveLength(1)
    expect(markup).toContain('class="edit-channel__mute"')
    expect(markup).toContain('class="edit-channel__mute-input"')
    expect(markup).toContain(`<span class="edit-channel__mute-label">${MUTE_LABEL}</span>`)
    // The label text is the accessible name; no aria-label.
    expect(markup).not.toMatch(/aria-label="[^"]*Mute/)
  })

  it('is checked, with the tick drawn, exactly when muted (AC1)', () => {
    const on = renderView('a name', read('stored text'), true)
    const off = renderView('a name', read('stored text'), false)
    expect(on).toMatch(/type="checkbox"[^>]*checked=""/)
    expect(on).toContain('edit-channel__mute-tick')
    expect(off).not.toMatch(/type="checkbox"[^>]*checked/)
    expect(off).not.toContain('edit-channel__mute-tick')
  })

  it('renders in the reading arm too, since it does not depend on the prompt read (AC1)', () => {
    expect(renderView('a name', READING, true)).toMatch(/type="checkbox"[^>]*checked=""/)
  })

  it('sits after the text area and before the Archive channel button (AC1)', () => {
    const markup = renderView('a name', read('stored text'))
    const textarea = markup.indexOf('edit-channel__textarea')
    const mute = markup.indexOf('edit-channel__mute"')
    const archive = markup.indexOf('edit-channel__archive')
    expect(mute).toBeGreaterThan(textarea)
    expect(archive).toBeGreaterThan(mute)
  })

  it('reports the toggled value through onMutedChange and fires nothing on render (AC2)', () => {
    const onMutedChange = vi.fn()
    const onSave = vi.fn()
    const props = {
      name: 'a name',
      prompt: read('stored text'),
      muted: true,
      onMutedChange,
      onNameChange: noop,
      onCancel: noop,
      onSave,
      onArchive: noop
    }
    renderToStaticMarkup(<EditChannelDialogView {...props} />)
    expect(onMutedChange).not.toHaveBeenCalled()

    const input = muteInputProps(props)
    expect(input?.checked).toBe(true)
    input?.onChange?.({ target: { checked: false } })
    expect(onMutedChange).toHaveBeenCalledTimes(1)
    expect(onMutedChange).toHaveBeenCalledWith(false)
    expect(onSave).not.toHaveBeenCalled()
  })
})

// #1608's write rule: `null` is SEND NOTHING (AC3's unchanged-OK case); otherwise the new value.
describe('muteWriteFor', () => {
  it('sends nothing when the checkbox still holds what was read (AC3)', () => {
    expect(muteWriteFor({ seed: false, draft: false })).toBeNull()
    expect(muteWriteFor({ seed: true, draft: true })).toBeNull()
  })

  it('sends the new value when the checkbox was flipped (AC2)', () => {
    expect(muteWriteFor({ seed: false, draft: true })).toEqual({ muted: true })
    expect(muteWriteFor({ seed: true, draft: false })).toEqual({ muted: false })
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
