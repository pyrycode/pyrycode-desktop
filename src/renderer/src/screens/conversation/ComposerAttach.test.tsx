import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AttachmentUploadEvent } from '../../../../shared/ipc/attachmentUpload'
import {
  COMPOSER_ATTACH_LABEL,
  COMPOSER_DROP_ACTIVE_CLASS,
  ComposerAttachButton,
  ComposerAttachOutcome,
  composerClassName,
  dragCarriesFiles,
  fileToAttach,
  reduceFileDropDepth
} from './ComposerAttach'
import { attachmentUploadOutcomeCopy } from './attachmentUploadCopy'

// #863: the attach control's two pure views. Renderer specs here are static server renders
// (renderToStaticMarkup, environment: 'node', no DOM and no @testing-library), so what these prove is the
// MARKUP — the button's shape and its accessible name, and the outcome's present/absent matrix. The click
// itself and the outcome ARRIVING are covered in e2e/composer-attach.spec.ts, which is the only tier that
// can drive either.

// The trigger's rendered `class` attribute as one WHOLE run, the four sibling menus' idiom. One constant
// so the assertions below cannot drift apart one at a time — and a whole-run match rather than a
// toContain, because a shared-treatment lift that prepended another class would otherwise pass silently.
const ATTACH_CLASS_RUN = 'class="composer__footer-button composer__attach"'

const noop = (): void => {}

describe('ComposerAttachButton — the footer row’s last item (#863 AC1, AC2)', () => {
  // AC2's first half. The accessible name is an aria-label rather than hidden text, which is the OPPOSITE
  // call from ComposerErrorChip one component over — and correctly so: <button> is not on ARIA's
  // name-prohibited list (a bare <div>/<span> maps to role="generic" and browsers drop the name), and
  // .composer__send already names its two icon-only variants exactly this way.
  it('renders one button carrying the accessible name and the shared footer treatment', () => {
    const markup = renderToStaticMarkup(<ComposerAttachButton onAttach={noop} />)
    expect(markup).toContain(ATTACH_CLASS_RUN)
    expect(markup).toContain(`aria-label="${COMPOSER_ATTACH_LABEL}"`)
    expect(markup).toContain('type="button"')
  })

  // NO DISABLED AND NO IN-FLIGHT STATE, and that is a design decision rather than an omission. The
  // composition root's `pickerOpen` flag already drops a second intent while a picker is open, so a
  // double-clicked button is handled below the bridge; drawing a state here would pre-empt #864 AND be
  // exactly the placeholder #811 forbade.
  //
  // THE NON-EMPTY ASSERTION IS LOAD-BEARING — #988's lesson, carried over deliberately. An extractor
  // ending in `?? ''` would return nothing when the class run changed under it (a shared-treatment lift),
  // `expect('').not.toContain('disabled')` would hold, and this guard would disappear with no red.
  it('is never disabled — the picker guard lives below the bridge', () => {
    const markup = renderToStaticMarkup(<ComposerAttachButton onAttach={noop} />)
    const tag = markup.match(/<button[^>]*>/)?.[0]
    expect(tag).toBeTruthy()
    expect(tag).toContain(ATTACH_CLASS_RUN)
    expect(tag).not.toContain('disabled')
    expect(tag).not.toContain('aria-busy')
  })

  // AC1's colour half, stated as a PROPERTY rather than as a value. The Figma export's fill is #9DCBFC,
  // byte-identical to --color-primary — so `currentColor` inheriting the token off .composer__footer-button
  // is the correct translation, and the export's hex must appear nowhere. Asserting the absence of ANY hex
  // literal is stronger than asserting the absence of that one: it also catches the light scheme's
  // #32628D, which is the mistake the Actions chevron's export invited.
  it('paints the glyph from the token through currentColor, with no hex literal in the markup', () => {
    const markup = renderToStaticMarkup(<ComposerAttachButton onAttach={noop} />)
    expect(markup).toContain('fill="currentColor"')
    expect(markup).not.toMatch(/#[0-9a-fA-F]{6}/)
  })

  // The glyph is decoration: the button's name comes from its aria-label, so an exposed <svg> would add a
  // second thing for a screen reader to read out. One path, from node 115:3655.
  it('hides the glyph from the accessibility tree and draws it as one path', () => {
    const markup = renderToStaticMarkup(<ComposerAttachButton onAttach={noop} />)
    expect(markup).toContain('aria-hidden="true"')
    expect(markup.match(/<path/g)).toHaveLength(1)
  })
})

describe('ComposerAttachOutcome — the latest outcome to arrive (#863 AC3, AC5)', () => {
  // AC5's second half, in the STRICT form ContextUsageReading's absent arm uses: an exact-empty markup,
  // never a not.toContain. That is what proves "nothing is reserved" — a substring assertion would pass
  // just as happily on a rendered-but-empty <div> holding the slot open.
  it('renders nothing at all when no outcome has arrived — not an empty element', () => {
    expect(renderToStaticMarkup(<ComposerAttachOutcome outcome={null} />)).toBe('')
  })

  // AC3, through the view. The rendered text is compared against the copy module's OWN output for the
  // same event, which is what proves the view SELECTS rather than composes: any sentence assembled here
  // would diverge from the module's, and any interpolation of a discriminator would too.
  const arms: Array<[string, AttachmentUploadEvent]> = [
    ['a refusal', { type: 'refused', uploadId: 'u1', reason: 'too-large', limitBytes: 23_040_000 }],
    ['a failure', { type: 'failed', uploadId: 'u2', reason: 'not-connected' }],
    ['a completion', { type: 'completed', uploadId: 'u3' }],
    // The retrieval-leg code a conforming daemon never sends for an upload, and a hostile one can. It must
    // not fall through to a blank line.
    ['an unreachable failure', { type: 'failed', uploadId: 'u4', reason: 'attachment-not-found' }]
  ]

  for (const [name, outcome] of arms) {
    it(`states ${name} as a polite live region carrying the mapped sentence`, () => {
      const markup = renderToStaticMarkup(<ComposerAttachOutcome outcome={outcome} />)
      // role="status" and not role="alert": the line is polite (announced without stealing focus), and
      // four shipped e2e specs count role="alert" inside the composer region.
      expect(markup).toContain('role="status"')
      expect(markup).not.toContain('role="alert"')
      expect(markup).toContain('class="composer__attach-outcome"')
      expect(markup).toContain(attachmentUploadOutcomeCopy(outcome))
      // Non-blank: the element exists BECAUSE there is something to say.
      expect(attachmentUploadOutcomeCopy(outcome).trim()).not.toBe('')
    })
  }

  // A <div>, not a <p> — ComposerErrorChip's ruling one component over, for the same reason: this repo
  // ships no margin reset and the element is a flex item in the composer column, so a <p>'s UA margin
  // would be a live layout hazard against AC5 for no semantic gain.
  it('is a div, so no UA margin moves the composer', () => {
    const markup = renderToStaticMarkup(
      <ComposerAttachOutcome outcome={{ type: 'completed', uploadId: 'u1' }} />
    )
    expect(markup.startsWith('<div')).toBe(true)
    expect(markup).not.toContain('<p')
  })

  // ==============================================================================================
  // #864 — the in-flight line. It occupies the SAME SLOT as the terminal (one nullable in the hook,
  // latest event wins), so what these prove is that the two states are mutually exclusive and that
  // only one of them is a live region.
  // ==============================================================================================

  const PROGRESS: AttachmentUploadEvent = {
    type: 'progress',
    uploadId: 'u5',
    sentChunks: 50,
    totalChunks: 200
  }

  it('states progress on its own element, carrying the copy module’s figure', () => {
    const markup = renderToStaticMarkup(<ComposerAttachOutcome outcome={PROGRESS} />)
    expect(markup).toContain('class="composer__attach-progress"')
    expect(markup).toContain(attachmentUploadOutcomeCopy(PROGRESS))
    expect(markup.startsWith('<div')).toBe(true)
  })

  // ⭐ THE LIVE-REGION DECISION, and the one thing in this slice that could regress a shipped one.
  // #863 chose role="status" because an outcome fires at most once per attach. Progress fires per
  // chunk — up to ATTACHMENT_MAX_UPLOAD_CHUNKS times for one file — and a polite live region
  // announcing each is worse than the silence it replaces. The in-flight line is therefore readable
  // by browsing and announced by nothing.
  it('is not a live region while in flight — no status role and no alert role', () => {
    const markup = renderToStaticMarkup(<ComposerAttachOutcome outcome={PROGRESS} />)
    expect(markup).not.toContain('role="status"')
    expect(markup).not.toContain('role="alert"')
    expect(markup).not.toContain('aria-live')
  })

  // AC1's second half, as a property of the markup rather than of the hook: the two states cannot both
  // be on screen, because each render produces exactly one element and it is one or the other.
  it('never shows a progress line beside a terminal one, in either direction', () => {
    const inFlight = renderToStaticMarkup(<ComposerAttachOutcome outcome={PROGRESS} />)
    expect(inFlight).not.toContain('composer__attach-outcome')
    expect(inFlight.match(/<div/g)).toHaveLength(1)

    const terminal = renderToStaticMarkup(
      <ComposerAttachOutcome outcome={{ type: 'completed', uploadId: 'u6' }} />
    )
    expect(terminal).not.toContain('composer__attach-progress')
    expect(terminal.match(/<div/g)).toHaveLength(1)
  })

  it('puts the uploadId nowhere in the in-flight markup either', () => {
    const uploadId = 'b3f1c0de-1111-4000-8000-000000000000'
    const markup = renderToStaticMarkup(
      <ComposerAttachOutcome outcome={{ ...PROGRESS, uploadId }} />
    )
    expect(markup).not.toContain(uploadId)
  })

  // The uploadId reaches no attribute, no text node and no key. The renderer cannot correlate it to a
  // click anyway (requestAttachmentUpload returns void), so surfacing it could only invite a correlation
  // that does not exist.
  it('puts the uploadId nowhere in the markup', () => {
    const uploadId = 'b3f1c0de-0000-4000-8000-000000000000'
    const markup = renderToStaticMarkup(
      <ComposerAttachOutcome outcome={{ type: 'failed', uploadId, reason: 'send-failed' }} />
    )
    expect(markup).not.toContain(uploadId)
  })
})

// #890: the drop decision, as four pure functions. The static tier cannot drag — vitest runs `node` and
// nothing in this repo can click — so what it pins is every branch of the decision itself, and
// e2e/composer-file-drop.spec.ts drives the transitions through them.
describe('composerClassName', () => {
  // ⭐ THE BYTE-IDENTITY ASSERTION, and it is load-bearing rather than pedantic: three shipped
  // assertions in composerSlot.test.tsx match `class="composer"` as a WHOLE ATTRIBUTE RUN, two of them
  // as `class="composer" hidden=""`. A trailing space from a template literal, or a modifier prepended
  // to the run, reddens them — and the two-class mix is what the active state must be, so the resting
  // branch cannot be built by joining an array.
  it('is exactly the bare block class at rest, with no trailing space', () => {
    expect(composerClassName(false)).toBe('composer')
  })

  it('wears the modifier as a two-class mix when a file is held over the composer', () => {
    expect(composerClassName(true)).toBe(`composer ${COMPOSER_DROP_ACTIVE_CLASS}`)
  })

  // BEM, and the modifier belongs to the block it modifies. A name that did not start with the block's
  // would still pass the two assertions above while making the stylesheet rule a lie.
  it('names the modifier after the block', () => {
    expect(COMPOSER_DROP_ACTIVE_CLASS.startsWith('composer--')).toBe(true)
  })
})

describe('dragCarriesFiles', () => {
  it('is true for a file drag and for one that also carries other flavours', () => {
    expect([dragCarriesFiles(['Files']), dragCarriesFiles(['text/plain', 'Files'])]).toEqual([
      true,
      true
    ])
  })

  // AC3's second half: a drag carrying no file is NOT INTERCEPTED AT ALL, so text dropped into the
  // textarea keeps doing what it does today. Every one of these must stay false or that breaks — a
  // `text/uri-list` drag included, which is deliberately left to `will-navigate` in the background
  // process rather than intercepted here (widening to it would swallow link drags into the box).
  it('is false for every drag that carries no file', () => {
    const notFiles: (readonly string[] | undefined)[] = [
      ['text/plain'],
      ['text/uri-list'],
      ['text/html', 'text/plain'],
      [],
      undefined
    ]
    expect(notFiles.map(dragCarriesFiles)).toEqual(notFiles.map(() => false))
  })
})

describe('reduceFileDropDepth', () => {
  // ⭐ THE FLICKER CASE, and the whole reason this is a counter rather than a boolean. Crossing from the
  // composer onto a child fires the CHILD's dragenter and the parent-relative dragleave as a pair, both
  // of which bubble to the same handler: a boolean flipped on dragleave would clear the state mid-drag
  // and the edge would strobe as the pointer moves over the textarea, the footer and the menus.
  it('stays active while the pointer crosses a child element', () => {
    let depth = 0
    depth = reduceFileDropDepth(depth, { type: 'enter' }) // onto the composer
    depth = reduceFileDropDepth(depth, { type: 'enter' }) // onto a child, before the parent's leave
    expect(depth > 0).toBe(true)
    depth = reduceFileDropDepth(depth, { type: 'leave' }) // the composer-relative leave of the pair
    expect(depth > 0).toBe(true)
    depth = reduceFileDropDepth(depth, { type: 'leave' }) // out of the composer for real
    expect(depth > 0).toBe(false)
  })

  // A stray leave is the shape a missed enter produces — a drag that began over a child, or one whose
  // enter was swallowed by a re-render. Floored at zero, the next real enter still activates; without
  // the floor the counter goes negative and the composer never lights up again.
  it('floors at zero rather than going negative on an unmatched leave', () => {
    expect(reduceFileDropDepth(0, { type: 'leave' })).toBe(0)
    expect(reduceFileDropDepth(reduceFileDropDepth(0, { type: 'leave' }), { type: 'enter' })).toBe(1)
  })

  // A DROP FIRES NO MATCHING dragleave, which is why `settled` resets outright instead of decrementing:
  // from a depth of three (composer, footer, button) a decrement would leave the edge painted forever.
  it('clears outright from any depth when the drag settles', () => {
    expect([0, 1, 3, 17].map((depth) => reduceFileDropDepth(depth, { type: 'settled' }))).toEqual([
      0, 0, 0, 0
    ])
  })
})

describe('fileToAttach', () => {
  // Generic over the element, so this tier needs no `File`: what is being decided is the COUNT, and
  // nothing about the file is read to decide it.
  it('takes the one file, and nothing at all for none or for many', () => {
    expect(fileToAttach(['a'])).toBe('a')
    expect(fileToAttach([])).toBe(null)
    // AC3's last line: a drop of more than one file attaches nothing. It also says nothing — a refusal
    // reason would mean a new member in the shared union plus a branch in attachmentUploadCopy's
    // compiler-forced switch, which is the follow-up ticket's, together with the messaging.
    expect(fileToAttach(['a', 'b'])).toBe(null)
    expect(fileToAttach(['a', 'b', 'c'])).toBe(null)
  })
})
