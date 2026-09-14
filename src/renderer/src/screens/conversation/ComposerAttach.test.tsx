import { afterEach, describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AttachmentUploadEvent } from '../../../../shared/ipc/attachmentUpload'
import {
  COMPOSER_ATTACH_LABEL,
  COMPOSER_DROP_ACTIVE_CLASS,
  ComposerAttachButton,
  ComposerAttachOutcome,
  ComposerAttachmentStrip,
  NO_PENDING_ATTACHMENTS,
  REMOVE_ATTACHMENT_LABEL,
  attachmentAskTarget,
  composerClassName,
  dragCarriesFiles,
  drainPendingAttachments,
  fileToAttach,
  mirrorTakeToDisplay,
  pasteCarriesImageOnly,
  pendingAttachmentKeys,
  reduceFileDropDepth,
  reducePendingAttachments,
  removePendingAttachment
} from './ComposerAttach'
import type { MessageAttachment } from '../../store/threadTimeline'
import { conversationListStore } from '../../store/conversationListStore'
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
  // #1262 TOOK THE COMPLETION OFF THIS TABLE, and its absence is the assertion one test below rather than a
  // gap here: a completion draws a TILE now, so a sentence saying the same thing twice was cut, and the
  // arms that remain are the three this line still speaks for.
  const arms: Array<[string, AttachmentUploadEvent]> = [
    ['a refusal', { type: 'refused', uploadId: 'u1', reason: 'too-large', limitBytes: 23_040_000 }],
    ['a failure', { type: 'failed', uploadId: 'u2', reason: 'not-connected' }],
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
      <ComposerAttachOutcome outcome={{ type: 'failed', uploadId: 'u1', reason: 'unreadable' }} />
    )
    expect(markup.startsWith('<div')).toBe(true)
    expect(markup).not.toContain('<p')
  })

  // ⭐ #1262 — THE COMPLETION'S SENTENCE IS GONE, and this is the whole of the second criterion on this
  // side. The tile is the report now, so a line beneath the footer would state the same fact twice; a
  // completion therefore renders NOTHING AT ALL rather than an empty element, which is `null`'s own ruling
  // one arm up. A bare equality, never a not.toContain: an element holding the slot open would be
  // invisible, would still cost the column's gap, and would still satisfy a substring assertion.
  //
  // It also carries #1038's guarantee forward at no cost: the stored file's NAME cannot reach this markup,
  // because there is no markup. The tile is where a name could now be rendered and where the guard moved.
  it('#1262: renders nothing at all for a completion — the tile is the report', () => {
    const filename = 'Raportti-läpivienti-日本語.pdf'
    expect(
      renderToStaticMarkup(
        <ComposerAttachOutcome outcome={{ type: 'completed', uploadId: 'u7', filename }} />
      )
    ).toBe('')
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
      <ComposerAttachOutcome outcome={{ type: 'failed', uploadId: 'u6', reason: 'send-failed' }} />
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

// #1033: the PASTE decision, `dragCarriesFiles`'s sibling. The static tier cannot press a key any more
// than it can drag, so what it pins is every branch of the predicate and
// e2e/composer-paste-image.spec.ts drives the keystroke through it.
describe('pasteCarriesImageOnly', () => {
  // ⭐ THE IMAGE TEST IS A DISJUNCTION, and the two arms are two spellings of the same fact rather than
  // belt and braces. Chromium normalises the OS clipboard before a page sees it, and a bitmap can
  // surface as the file-item spelling ('Files') or as an explicit image MIME entry. Shipping only one
  // risks a screenshot paste that silently does nothing; e2e/composer-paste-image.spec.ts measures which
  // spelling a real trusted paste actually produces and asserts this predicate answers true for it.
  it('is true for every spelling of an image with no text alongside', () => {
    const imageOnly: (readonly string[])[] = [
      ['Files'],
      ['image/png'],
      ['image/png', 'Files'],
      ['Files', 'text/html'],
      ['image/jpeg']
    ]
    expect(imageOnly.map(pasteCarriesImageOnly)).toEqual(imageOnly.map(() => true))
  })

  // ⭐ THE SECURITY BOUND, and the reason it is stated as a TABLE rather than as one case: a
  // password-manager secret is text/plain, so no clipboard advertising it may ever take the attach
  // branch — whatever else rides alongside, and a copied web-page selection routinely carries both.
  // Every entry below holds an image AND text, which is exactly the combination a single-conjunct
  // predicate would get wrong.
  it('is false whenever plain text rides alongside the image', () => {
    const withText: (readonly string[])[] = [
      ['text/plain', 'Files'],
      ['Files', 'text/plain'],
      ['text/plain', 'image/png'],
      ['text/html', 'text/plain', 'Files']
    ]
    expect(withText.map(pasteCarriesImageOnly)).toEqual(withText.map(() => false))
  })

  // AC2's other half: a clipboard with no image is not intercepted at all, so the default paste runs
  // exactly as it does today. `undefined` is accepted and answers false for `dragCarriesFiles`'s reason
  // — `event.clipboardData` is nullable on the DOM type.
  it('is false for every clipboard that advertises no image', () => {
    const notImages: (readonly string[] | undefined)[] = [
      ['text/plain'],
      ['text/html'],
      ['text/uri-list'],
      [],
      undefined
    ]
    expect(notImages.map(pasteCarriesImageOnly)).toEqual(notImages.map(() => false))
  })

  // The image arm matches a PREFIX, not a substring: a flavour that merely mentions an image type
  // somewhere in its name is not an image, and a text flavour must not be able to smuggle itself in by
  // being called one.
  it('reads the image arm as a prefix, so a look-alike flavour is not an image', () => {
    expect(pasteCarriesImageOnly(['text/image/png'])).toBe(false)
    expect(pasteCarriesImageOnly(['x-image/png'])).toBe(false)
  })
})

// #1039: the pending-attachment accumulator — what an arriving upload event does to the set a send will
// record. It is a pure function for the reason the four above are, and for one more: this repo's renderer
// specs are static server renders with no DOM and no `renderHook`, so a rule that lived inside the hook
// would be reachable by NO tier at all. Nothing renders it, so there is no e2e spec either — these are the
// whole proof.
describe('reducePendingAttachments', () => {
  const completed = (uploadId: string, filename: string): AttachmentUploadEvent => ({
    type: 'completed',
    uploadId,
    filename
  })

  it('starts from nothing', () => {
    expect(NO_PENDING_ATTACHMENTS).toEqual([])
  })

  // AC1's first half. The identifier recorded is the completed terminal's `uploadId`, which is the id the
  // DAEMON stored the file under (`driveUpload` sends `attachment_id: uploadId`) — that is what makes the
  // pair usable by the row that draws it and by the save leg, rather than a local correlation key.
  it('records the daemon’s identifier and the display name of a completed upload', () => {
    expect(reducePendingAttachments(NO_PENDING_ATTACHMENTS, completed('u-1', 'report.pdf'))).toEqual([
      { attachmentId: 'u-1', filename: 'report.pdf' }
    ])
  })

  // AC1's second half: "one or more", in the order they completed. This is also what the gesture-clear
  // must not touch — a set that rode `setOutcome(null)` would lose the first file the moment the operator
  // attached the second, which is exactly this case.
  it('records two completions in the order they completed', () => {
    const first = reducePendingAttachments(NO_PENDING_ATTACHMENTS, completed('u-1', 'a.pdf'))
    const second = reducePendingAttachments(first, completed('u-2', 'b.png'))
    expect(second).toEqual([
      { attachmentId: 'u-1', filename: 'a.pdf' },
      { attachmentId: 'u-2', filename: 'b.png' }
    ])
  })

  // ⭐ AC3, asserted as the SAME REFERENCE rather than as an equal array. An upload that was refused, that
  // failed, or that is still in flight contributes nothing — and returning the set unchanged says so
  // structurally, where an equal copy would merely happen to agree. Both `refused` members are here: they
  // share a discriminator and only one carries a limit, so a switch that read `reason` could split them.
  it('contributes nothing for a refusal, a failure or an in-flight transfer', () => {
    const pending = reducePendingAttachments(NO_PENDING_ATTACHMENTS, completed('u-1', 'a.pdf'))
    const quiet: AttachmentUploadEvent[] = [
      { type: 'refused', uploadId: 'u-2', reason: 'too-large', limitBytes: 23_040_000 },
      { type: 'refused', uploadId: 'u-3', reason: 'no-image' },
      { type: 'failed', uploadId: 'u-4', reason: 'connection-lost' },
      { type: 'failed', uploadId: 'u-5', reason: 'attachment-storage-failed' },
      { type: 'progress', uploadId: 'u-6', sentChunks: 3, totalChunks: 9 }
    ]
    for (const event of quiet) {
      expect(reducePendingAttachments(pending, event)).toBe(pending)
    }
  })

  it('never mutates the set it is handed', () => {
    const pending = reducePendingAttachments(NO_PENDING_ATTACHMENTS, completed('u-1', 'a.pdf'))
    const next = reducePendingAttachments(pending, completed('u-2', 'b.png'))
    expect(next).not.toBe(pending)
    expect(pending).toHaveLength(1)
    expect(NO_PENDING_ATTACHMENTS).toHaveLength(0)
  })

  // The name is recorded VERBATIM — no trim, no fallback, no non-empty guard. Empty is representable and
  // unreachable (`basename` answers '' only for a path the read guard already refuses), and the two
  // obligations #1038 deferred — a layout bound and not assuming non-emptiness — belong to the tickets
  // that DRAW the name (#815, #868). Adding a guard here would be inventing a value the daemon was not told.
  it('records the name verbatim, the empty and the 255-byte cases included', () => {
    const long = 'ä'.repeat(127)
    expect(reducePendingAttachments(NO_PENDING_ATTACHMENTS, completed('u-1', ''))).toEqual([
      { attachmentId: 'u-1', filename: '' }
    ])
    expect(reducePendingAttachments(NO_PENDING_ATTACHMENTS, completed('u-2', long))).toEqual([
      { attachmentId: 'u-2', filename: long }
    ])
  })
})

// #1039: the take, over a plain `{ current }` holder — a MutableRefObject satisfies it structurally, so
// this tier walks the rule with no React. What it proves is the fourth criterion's clearing half, which
// would otherwise live only inside the hook, where no tier in this repo can reach it.
describe('drainPendingAttachments', () => {
  const REPORT = { attachmentId: 'u-1', filename: 'report.pdf' }

  it('hands back the pending set and empties the holder in one act', () => {
    const holder = { current: [REPORT] as readonly MessageAttachment[] }
    expect(drainPendingAttachments(holder).attachments).toEqual([REPORT])
    expect(holder.current).toEqual([])
  })

  // ⭐ AC4's second half: a second message sent with no further uploads records NONE. The first take is
  // what makes the second one empty, which is the whole of "cleared by a send that actually happened".
  it('answers empty on a second take with nothing recorded in between', () => {
    const holder = { current: [REPORT] as readonly MessageAttachment[] }
    drainPendingAttachments(holder)
    expect(drainPendingAttachments(holder).attachments).toBe(NO_PENDING_ATTACHMENTS)
  })

  // #1055: the undo the take now carries. A send whose bridge throws named nothing on the wire, so the
  // files must still be attached for the retry — and putting them back is only sound because the whole
  // take/send/rollback sequence is synchronous, so no arriving upload can be clobbered by the restore.
  it('#1055: rollback restores exactly the taken set', () => {
    const pending: readonly MessageAttachment[] = [REPORT]
    const holder = { current: pending }
    const take = drainPendingAttachments(holder)
    expect(holder.current).toBe(NO_PENDING_ATTACHMENTS)
    take.rollback()
    expect(holder.current).toBe(pending)
  })

  // A rolled-back take is a take that never happened: the next send sees the same set again.
  it('#1055: a take after a rollback answers the same set', () => {
    const holder = { current: [REPORT] as readonly MessageAttachment[] }
    drainPendingAttachments(holder).rollback()
    expect(drainPendingAttachments(holder).attachments).toEqual([REPORT])
  })

  // Emptied to the SHARED constant, not to a fresh `[]`, so repeated takes stay reference-identical and
  // `submitMessage` normalises every one of them to an absent field.
  it('empties to the shared constant', () => {
    const holder = { current: [REPORT] as readonly MessageAttachment[] }
    drainPendingAttachments(holder)
    expect(holder.current).toBe(NO_PENDING_ATTACHMENTS)
  })

  it('does not mutate the set it handed back', () => {
    const pending: readonly MessageAttachment[] = [REPORT]
    const holder = { current: pending }
    const taken = drainPendingAttachments(holder).attachments
    expect(taken).toBe(pending)
    expect(pending).toEqual([REPORT])
  })
})

// #1264 — the third pure rule, and pure for its two siblings' reason: the click that calls it belongs to
// a tier that cannot render, and the hook that holds it belongs to a tier that cannot click. What is
// proved here is the fold; that the CONTROL reaches it is e2e/composer-attachment-remove.spec.ts.
describe('removePendingAttachment (#1264 AC2)', () => {
  const REPORT = { attachmentId: 'u-1', filename: 'report.pdf' }
  const BUNDLE = { attachmentId: 'u-2', filename: 'bundle.zip' }
  const NOTES = { attachmentId: 'u-3', filename: 'notes.txt' }

  it('takes out the named position and leaves the rest in order', () => {
    expect(removePendingAttachment([REPORT, BUNDLE, NOTES], 1)).toEqual([REPORT, NOTES])
    expect(removePendingAttachment([REPORT, BUNDLE, NOTES], 0)).toEqual([BUNDLE, NOTES])
    expect(removePendingAttachment([REPORT, BUNDLE, NOTES], 2)).toEqual([REPORT, BUNDLE])
  })

  // ⭐ AC2's SECOND CLAUSE, and the whole reason the parameter is an index rather than an id: the same
  // file attached twice completes twice, so two tiles can carry one `attachmentId`. Removing by id would
  // take both for one click — a file the operator never asked to drop off a message they are still
  // writing. Position is also what the strip's own `map` hands each control, so the control's index and the
  // set's index are the same number by construction rather than by correlation. (The strip's REACT key is a
  // different thing and is deliberately not the position — see `pendingAttachmentKeys` below.)
  it('removes tiles carrying the SAME attachmentId independently', () => {
    const twice: readonly MessageAttachment[] = [REPORT, { ...REPORT }, BUNDLE]
    const once = removePendingAttachment(twice, 0)
    expect(once).toHaveLength(2)
    expect(once).toEqual([REPORT, BUNDLE])
    expect(removePendingAttachment(once, 0)).toEqual([BUNDLE])
  })

  // The SAME REFERENCE for an index that names no tile — `reducePendingAttachments`'s idiom for "this
  // changes nothing", structural rather than incidental. It is what makes an impossible index unable to
  // clear a set: a removal racing a send (the take empties first) folds against `[]`, where every index
  // is out of range.
  it('answers the same reference for an index that names no tile', () => {
    const pending: readonly MessageAttachment[] = [REPORT, BUNDLE]
    expect(removePendingAttachment(pending, -1)).toBe(pending)
    expect(removePendingAttachment(pending, 2)).toBe(pending)
    expect(removePendingAttachment(pending, 99)).toBe(pending)
    expect(removePendingAttachment(NO_PENDING_ATTACHMENTS, 0)).toBe(NO_PENDING_ATTACHMENTS)
  })

  it('does not mutate the set it was given', () => {
    const pending: readonly MessageAttachment[] = [REPORT, BUNDLE]
    removePendingAttachment(pending, 0)
    expect(pending).toEqual([REPORT, BUNDLE])
  })

  // Removing the last tile leaves the set the strip renders NOTHING for — the empty-set case its own
  // describe pins, reached this way for the first time.
  it('empties a one-tile set', () => {
    expect(removePendingAttachment([REPORT], 0)).toEqual([])
  })
})

// ⭐ #1264 — THE KEY RULE, AND WHY IT IS A PURE FUNCTION AT ALL. `renderToStaticMarkup` drops React keys
// outright, so no static render can see one and a key living inline in the strip's `map` would be provable
// nowhere; the click that exercises it belongs to a tier that cannot render. So the rule is lifted out and
// pinned here, and the BEHAVIOUR it buys — the survivor keeps its own picture and asks the host for nothing —
// is driven over two image tiles in e2e/composer-attachment-remove.spec.ts.
//
// What an index key cost, restated as the property below: reconciliation reuses a fiber whenever two renders
// agree on a key, and the tile behind a key owns state plus a refcounted object URL. So the claim that has to
// hold across a removal is that every SURVIVING entry keeps the key it had.
describe('pendingAttachmentKeys (#1264 — the identity a mid-list removal needs)', () => {
  const REPORT = { attachmentId: 'u-1', filename: 'report.pdf' }
  const BUNDLE = { attachmentId: 'u-2', filename: 'bundle.zip' }
  const NOTES = { attachmentId: 'u-3', filename: 'notes.txt' }

  it('gives one key per position, in order', () => {
    expect(pendingAttachmentKeys([REPORT, BUNDLE, NOTES])).toEqual(['u-1#0', 'u-2#0', 'u-3#0'])
    expect(pendingAttachmentKeys([])).toEqual([])
  })

  // AC2's duplicate case, which is what rules a bare `attachmentId` out: two tiles can carry one id and must
  // remove independently, so the id alone is not a key — duplicate React keys are undefined behaviour.
  it('qualifies a repeated attachmentId by which occurrence it is', () => {
    const keys = pendingAttachmentKeys([REPORT, { ...REPORT }, BUNDLE, { ...REPORT }])
    expect(keys).toEqual(['u-1#0', 'u-1#1', 'u-2#0', 'u-1#2'])
    expect(new Set(keys).size).toBe(keys.length)
  })

  // ⭐ THE PROPERTY THE VERIFIED DEFECT NEEDED, stated over every position of every removal: a survivor's key
  // is the key it already had. Under the index key this is false for every entry after the removed one, which
  // is exactly how a survivor came to be drawn by the removed tile's fiber.
  it('leaves every surviving entry’s key unchanged by a removal at any position', () => {
    const pending: readonly MessageAttachment[] = [REPORT, BUNDLE, NOTES]
    const before = pendingAttachmentKeys(pending)
    for (let removed = 0; removed < pending.length; removed += 1) {
      const after = pendingAttachmentKeys(removePendingAttachment(pending, removed))
      expect(after).toEqual(before.filter((_, index) => index !== removed))
    }
  })

  // The same property where it is least obvious: the survivors of a duplicate-id run. Removing the FIRST of
  // three tiles sharing an id renumbers the two behind it — `u-1#1` and `u-1#2` become `u-1#0` and `u-1#1` —
  // so a fiber IS reused across the shift here. That is sound rather than tolerated: a key match implies an
  // id match, and a tile drawing the same attachment already holds the right state, the right URL and an
  // unchanged effect dep. The distinct-id neighbour is what must not move, and does not.
  it('reuses a key across a duplicate-id shift only between tiles drawing the same attachment', () => {
    const pending: readonly MessageAttachment[] = [REPORT, { ...REPORT }, BUNDLE, { ...REPORT }]
    const after = pendingAttachmentKeys(removePendingAttachment(pending, 0))
    expect(after).toEqual(['u-1#0', 'u-2#0', 'u-1#1'])
    // Each surviving key still addresses the attachment its own position draws — which is the whole of "a
    // reused fiber is only ever reused for the same attachment".
    expect(after.map((key) => key.slice(0, key.lastIndexOf('#')))).toEqual(['u-1', 'u-2', 'u-1'])
  })

  // The key is injective in (id, occurrence) even for an id carrying the separator, because the occurrence is
  // a decimal that never does: the LAST `#` splits a key back into exactly one pair. An untrusted id cannot
  // therefore collide two distinct tiles into one fiber.
  it('cannot collide two positions, even for an id carrying the separator', () => {
    const keys = pendingAttachmentKeys([
      { attachmentId: 'u#1', filename: 'a.pdf' },
      { attachmentId: 'u', filename: 'b.pdf' },
      { attachmentId: 'u', filename: 'c.pdf' }
    ])
    expect(keys).toEqual(['u#1#0', 'u#0', 'u#1'])
    expect(new Set(keys).size).toBe(3)
  })

  // The id reaches the key and nothing else: keys are consumed by the reconciler and emitted nowhere, so
  // #1262's "the host's storage handle stays out of the DOM" survives this change byte for byte.
  it('puts the attachmentId in the key and not in the markup', () => {
    const attachmentId = 'b3f1c0de-0000-4000-8000-000000000000'
    expect(pendingAttachmentKeys([{ attachmentId, filename: 'a.pdf' }])).toEqual([`${attachmentId}#0`])
    const markup = renderToStaticMarkup(
      <ComposerAttachmentStrip attachments={[{ attachmentId, filename: 'a.pdf' }]} onRemove={() => {}} />
    )
    expect(markup).not.toContain(attachmentId)
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

// ================================================================================================
// #1262 — the strip. The pending set #1039 accumulated is finally drawn, and this tier owns exactly
// what a static render can see: the present/absent matrix, one tile per attachment in the set's order,
// and what of the record reaches the DOM. The geometry (45x60, the 12px gap, the 8px above and below,
// the left edge) and the send-clears are layout and lifecycle, so they are e2e/composer-attach.spec.ts.
// ================================================================================================

describe('ComposerAttachmentStrip — the pending attachments, drawn (#1262 AC1, AC5)', () => {
  const tile = (filename: string): MessageAttachment => ({ attachmentId: 'att-1', filename })

  // Counts the tile frame without also counting `-glyph` / `-ext` / `-slot` / `-remove`, which share the
  // prefix — the `rowCount` idiom the bubble's own spec established for exactly this hazard. #1264's two
  // new classes are covered by the same closing quote: the count stays one per attachment.
  const tileCount = (markup: string): number =>
    markup.match(/class="composer__attachment"/g)?.length ?? 0

  // #1264: every render below now supplies the removal callback, which a static render drops along with
  // every other handler — the click is e2e/composer-attachment-remove.spec.ts's.
  const noop = (): void => {}

  // #1264: the markup of each tile's SLOT, in DOM order — the wrapper that holds the tile and its control
  // as siblings outside the frame's clip. Splitting on the slot's own open tag is what lets an assertion
  // speak about one tile's drawing without counting characters, which is what the `indexOf` arithmetic
  // this replaces was doing.
  const slots = (markup: string): string[] =>
    markup.split('<span class="composer__attachment-slot">').slice(1)

  // ⭐ AC1's LAST CLAUSE, and the reason this is an equality rather than a not.toContain: `.composer` is a
  // flex column with a gap, so an element that mounts empty is not free — it would move the message box
  // down on every launch, in every spec, forever. `ComposerAttachOutcome`'s shipped ruling, one component
  // over, applied to the column's FIRST child instead of its last.
  it('renders nothing at all when nothing is pending — not an empty element', () => {
    expect(renderToStaticMarkup(<ComposerAttachmentStrip attachments={[]} onRemove={noop} />)).toBe(
      ''
    )
    expect(
      renderToStaticMarkup(
        <ComposerAttachmentStrip attachments={NO_PENDING_ATTACHMENTS} onRemove={noop} />
      )
    ).toBe('')
  })

  it('draws one tile per pending attachment, in the set’s own completion order', () => {
    const markup = renderToStaticMarkup(
      <ComposerAttachmentStrip
        attachments={[tile('first.pdf'), tile('second.txt'), tile('third.zip')]}
        onRemove={noop}
      />
    )
    expect(tileCount(markup)).toBe(3)
    expect(markup.indexOf('PDF')).toBeLessThan(markup.indexOf('TXT'))
    expect(markup.indexOf('TXT')).toBeLessThan(markup.indexOf('ZIP'))
  })

  // The drawing is the bubble's, reached through the shared component rather than transcribed again —
  // asserted here as the three class runs the strip passes down, since a second transcription would be
  // free to drift from the first.
  it('wears its own three classes, sharing no whole class token with the outcome line', () => {
    const markup = renderToStaticMarkup(
      <ComposerAttachmentStrip attachments={[tile('a.pdf')]} onRemove={noop} />
    )
    expect(markup).toContain('<div class="composer__attachments">')
    expect(markup).toContain('<span class="composer__attachment">')
    expect(markup).toContain('class="composer__attachment-glyph"')
    expect(markup).toContain('<span class="composer__attachment-ext" aria-hidden="true">PDF</span>')
    // Neither shipped run of the sentence beneath the footer is reachable from this markup.
    expect(markup).not.toContain('class="composer__attach-outcome"')
    expect(markup).not.toContain('class="composer__attach-progress"')
  })

  // ⭐ #1263 — THE BRANCH, and the one assertion this ticket re-aimed rather than added. #1262 asserted here
  // that an image name draws the file tile too; that was the picture-bearing case this slice replaces, and the
  // file tile survives as its undecodable FALLBACK rather than as its shipped state. What must not change is
  // that both drawings wear the same frame in the same box, so the strip's tile count and each tile's position
  // are a property of the SET and not of what any picture is doing.
  it('draws the picture-bearing tile for an image name and the file tile for every other', () => {
    const markup = renderToStaticMarkup(
      <ComposerAttachmentStrip
        attachments={[tile('shot.png'), tile('notes.pdf'), tile('grab.JPEG')]}
        onRemove={noop}
      />
    )
    expect(tileCount(markup)).toBe(3)
    // The two image tiles are in flight (a static render never runs their effect), so they are empty frames —
    // and the ONLY extension label in the strip is the one non-image tile's.
    expect(markup.match(/composer__attachment-ext/g)?.length ?? 0).toBe(1)
    expect(markup).toContain('>PDF</span>')
    expect(markup).not.toContain('>PNG</span>')
    expect(markup).not.toContain('>JPEG</span>')
    // Order is the set's own, unchanged by the branch: image, file, image. Asserted per SLOT rather than at
    // the two ends — #1264 hung a control after each tile, so neither end of the strip is a frame any more,
    // and the claim is stated where it actually lives instead of by counting characters. Each drawing is
    // read at the START of its own slot, where an empty frame is unambiguous: the file tile's frame is never
    // empty, so a branch that drew the wrong drawing in any position fails here rather than being absorbed
    // by a substring match somewhere in the middle.
    expect(slots(markup)).toHaveLength(3)
    expect(slots(markup)[0].startsWith('<span class="composer__attachment"></span>')).toBe(true)
    expect(
      slots(markup)[1].startsWith('<span class="composer__attachment"><svg class="composer__attachment-glyph"')
    ).toBe(true)
    expect(slots(markup)[2].startsWith('<span class="composer__attachment"></span>')).toBe(true)
  })

  // ⭐ EVERY ATTRIBUTE THE STRIP RENDERS, AS ONE LIST. #1265 puts the file name in the DOM on purpose, so
  // the criterion can no longer be spelled as "the name appears nowhere" — it is "the name appears only as
  // escaped CHILDREN", and its other half is this enumeration.
  //
  // THE REGEX IS SOUND BECAUSE REACT ESCAPES TEXT, and that is worth stating rather than assuming: a text
  // child's `"`, `<` and `>` each come back as an entity (`&quot;`, `&lt;`, `&gt;`), so no rendered text can
  // present a bare quote for this to mistake for an attribute boundary. A name interpolated into an
  // attribute therefore cannot hide from this list, which a `not.toContain('title=')` on attribute NAMES
  // could never see.
  const attributes = (markup: string): string[] => markup.match(/[a-zA-Z-]+="[^"]*"/g) ?? []

  // ⭐ AC5, AND THE ELEMENT THE SHIPPED e2e NEGATIVES ARE RE-AIMED AT. Against an outcome line that no
  // longer mounts for a completion those two assertions pass vacuously and guard nothing; here they guard
  // a mounted element. The host's storage handle still reaches nothing at all, and the NAME — which #1265
  // draws in a pill — reaches escaped React children and no attribute anywhere.
  it('puts nothing of the record in the DOM but the derived label and the escaped name', () => {
    const attachmentId = 'b3f1c0de-0000-4000-8000-000000000000'
    const filename = '../../etc/passwd"><img src=x onerror=alert(1)>.pdf'
    const markup = renderToStaticMarkup(
      <ComposerAttachmentStrip attachments={[{ attachmentId, filename }]} onRemove={noop} />
    )
    expect(markup).not.toContain(attachmentId)
    expect(markup).toContain('>PDF</span>')
    // ⭐ #1265 AC2 — THE NAME IS CHILDREN AND THE PAYLOAD IS INERT. The `<img>` arrives entity-escaped, so
    // no element is created and the break-out sequence `">` never appears as markup. The raw name is
    // therefore ABSENT from the markup even though every character of it is rendered, which is the
    // property that makes rendering it safe rather than a `not.toContain` that would forbid the feature.
    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(markup).not.toContain('<img')
    expect(markup).not.toContain('passwd">')
    expect(markup).not.toContain(filename)
    // ...and no attribute of any element in the strip carries any fragment of it.
    expect(attributes(markup).filter((value) => /passwd|onerror|etc/.test(value))).toEqual([])
    // No title and no alt: the two attribute sinks a tooltip is usually built from, and the ones #696's
    // security review rejected as a MUST FIX for exactly this string.
    expect(markup).not.toContain('title=')
    expect(markup).not.toContain('alt=')
    // ⭐ #1264 AC4, AND THE ONE ASSERTION THIS TICKET RE-AIMED. This line read `not.toContain('aria-label')`
    // while the strip had no control in it; the remove control has one BY DESIGN, so the criterion is
    // restated as what it always meant — an ENUMERATION of every aria-label the strip renders, each of which
    // must be the client-owned constant. Stronger than the negative it replaces: a name interpolated into an
    // otherwise-correct label fails here, where a `not.toContain` on the attribute NAME could not see it.
    expect(markup.match(/aria-label="[^"]*"/g)).toEqual([`aria-label="${REMOVE_ATTACHMENT_LABEL}"`])
  })

  // ⭐ #1264 AC1's structural half — the criterion the geometry in e2e can only measure once the element
  // exists. One control per tile, and it is a SIBLING of the frame rather than a child: `.composer__attachment`
  // declares `overflow: hidden` for #1263's `cover` picture, so a control rendered inside it would be clipped
  // away with nothing in this repo reddening to say so. The slot is what it hangs on instead.
  it('hangs one remove control per tile, outside the frame that clips', () => {
    const markup = renderToStaticMarkup(
      <ComposerAttachmentStrip
        attachments={[tile('a.pdf'), tile('b.png'), tile('c.zip')]}
        onRemove={noop}
      />
    )
    expect(slots(markup)).toHaveLength(3)
    // One slot per tile and one tile per slot: the wrapper does not double the count the shipped e2e
    // locators and the regex above both read.
    expect(tileCount(markup)).toBe(3)
    expect(markup.match(/class="composer__attachment-remove"/g)?.length ?? 0).toBe(3)
    // Every control opens AFTER a frame closed — never inside one.
    expect(
      markup.match(/<\/span><button type="button" class="composer__attachment-remove"/g)?.length ?? 0
    ).toBe(3)
    // A real button with a real type: the strip sits inside the composer, and a submit-typed control there
    // would send the message it exists to edit.
    expect(markup).toContain(
      `<button type="button" class="composer__attachment-remove" aria-label="${REMOVE_ATTACHMENT_LABEL}">`
    )
    // The two inks: the glyph off the button's own `currentColor`, the disc off its own class, because a
    // presentation attribute cannot hold a var().
    expect(markup).toContain('class="composer__attachment-remove-disc"')
    expect(markup).toContain('fill="currentColor"')
  })

  // The name is a CLIENT-OWNED CONSTANT and says what the control does, not which file it drops. The
  // filename is untrusted display text; naming the button after it would put that string in an attribute.
  //
  // #1265 RE-AIMED THE NEGATIVE FROM THE MARKUP TO THE ATTRIBUTES. This read `not.toContain('quarterly')`
  // while the strip rendered no name at all; the pill renders one BY DESIGN, so the claim is restated as
  // what it always meant — the ACCESSIBLE NAME is the constant and the file name is in no attribute — which
  // is stronger than the whole-markup negative it replaces, since that one could not have distinguished a
  // name in an attribute from a name in a text node.
  it('names the control with a constant that carries no file name', () => {
    expect(REMOVE_ATTACHMENT_LABEL).toBe('Remove attachment')
    const markup = renderToStaticMarkup(
      <ComposerAttachmentStrip
        attachments={[{ attachmentId: 'att-9', filename: 'quarterly-secrets.pdf' }]}
        onRemove={noop}
      />
    )
    expect(markup).toContain(`aria-label="${REMOVE_ATTACHMENT_LABEL}"`)
    expect(attributes(markup).filter((value) => /quarterly|secrets/.test(value))).toEqual([])
  })

  // ⭐ #1265 AC3's STRUCTURAL HALF, AND THE ONLY TIER THAT CAN ANSWER IT. `.composer__attachment` declares
  // `overflow: hidden` for #1263's `cover` picture, so a pill rendered inside that frame is laid out exactly
  // where a boundingBox() reports and PAINTED nowhere — a geometry assertion in Playwright cannot tell the
  // two apart, because layout boxes are reported whether or not an ancestor clipped the pixels away. Where
  // the element sits in the tree is a markup fact, so it is provable here and nowhere else.
  //
  // LAST IN THE SLOT, and that is load-bearing against the two shipped adjacency guards above rather than a
  // preference: the frame still opens each slot and the control still follows the frame's own `</span>`.
  it('hangs one name pill per tile, last in the slot and outside the frame that clips', () => {
    const markup = renderToStaticMarkup(
      <ComposerAttachmentStrip
        attachments={[tile('a.pdf'), tile('b.png'), tile('c.zip')]}
        onRemove={noop}
      />
    )
    expect(slots(markup)).toHaveLength(3)
    expect(tileCount(markup)).toBe(3)
    expect(markup.match(/class="composer__attachment-name"/g)?.length ?? 0).toBe(3)
    // Every pill opens after a CONTROL closed — so it is the slot's last child and the frame's sibling,
    // never a descendant of the frame.
    expect(
      markup.match(/<\/button><span class="composer__attachment-name">/g)?.length ?? 0
    ).toBe(3)
    // ...and each slot closes immediately after its pill, which is the "last child" half. Not anchored at
    // the fragment's end: `slots` splits on the slot's OPENING tag, so the final fragment also carries the
    // strip's own `</div>`. The adjacency below is the claim itself and holds for every slot.
    for (const slot of slots(markup)) {
      expect(slot.startsWith('<span class="composer__attachment"')).toBe(true)
      expect(slot).toMatch(/<span class="composer__attachment-name">[^<]*<\/span><\/span>/)
    }
  })

  // AC1's content half: the pill states THAT tile's name, whole and in the set's own order. Rendered as
  // children of a plain <span> — no title, no alt, no aria-label, and no hex literal from the design's
  // transposed export (the property assertion #863 established one component over).
  it('states each tile’s own file name in its pill, as escaped children', () => {
    const markup = renderToStaticMarkup(
      <ComposerAttachmentStrip
        attachments={[tile('quarterly-report.pdf'), tile('holiday-snap.png')]}
        onRemove={noop}
      />
    )
    expect(slots(markup)[0]).toContain(
      '<span class="composer__attachment-name">quarterly-report.pdf</span>'
    )
    expect(slots(markup)[1]).toContain(
      '<span class="composer__attachment-name">holiday-snap.png</span>'
    )
    expect(markup).not.toMatch(/#[0-9a-fA-F]{6}/)
    // The strip's only accessible names are still the two controls' constant — the pill adds none, so it
    // cannot be read out twice or read out as a label for something it does not label.
    expect(markup.match(/aria-label="[^"]*"/g)).toEqual([
      `aria-label="${REMOVE_ATTACHMENT_LABEL}"`,
      `aria-label="${REMOVE_ATTACHMENT_LABEL}"`
    ])
  })

  // A name with no extension at all still gets its pill: the derived label is empty for `README`, which is
  // precisely the tile the pill is the only identification for.
  it('draws a pill for a name the extension label cannot speak for', () => {
    const markup = renderToStaticMarkup(
      <ComposerAttachmentStrip attachments={[tile('README')]} onRemove={noop} />
    )
    expect(markup).toContain('<span class="composer__attachment-ext" aria-hidden="true"></span>')
    expect(markup).toContain('<span class="composer__attachment-name">README</span>')
  })

  // A name with no usable extension draws an empty label rather than a fallback word — the derivation's
  // designed empty case. The glyph holds the tile's size regardless, so the tile is still 45x60.
  it('draws a tile for a name with no usable extension', () => {
    const markup = renderToStaticMarkup(
      <ComposerAttachmentStrip attachments={[tile('README')]} onRemove={noop} />
    )
    expect(tileCount(markup)).toBe(1)
    expect(markup).toContain('<span class="composer__attachment-ext" aria-hidden="true"></span>')
  })
})

// #1262: the take's DISPLAY half, and a pure function for `drainPendingAttachments`'s own reason — the
// hook it serves is reachable by no tier this repo has. What it must not do is change the act it wraps:
// the ref take-and-clear stays one act and its rollback stays synchronous, because the send takes, sends
// and rolls back with no `await` between and a display update cannot be allowed to reorder that.
describe('mirrorTakeToDisplay (#1262 AC4)', () => {
  const REPORT_A: MessageAttachment = { attachmentId: 'att-1', filename: 'report.pdf' }

  const recorder = (): {
    shown: Array<readonly MessageAttachment[]>
    show: (attachments: readonly MessageAttachment[]) => void
  } => {
    const shown: Array<readonly MessageAttachment[]> = []
    return { shown, show: (attachments) => void shown.push(attachments) }
  }

  it('empties the display as the take claims the set, handing the same set back', () => {
    const holder = { current: [REPORT_A] as readonly MessageAttachment[] }
    const { shown, show } = recorder()
    const take = mirrorTakeToDisplay(drainPendingAttachments(holder), show)
    expect(take.attachments).toEqual([REPORT_A])
    expect(holder.current).toBe(NO_PENDING_ATTACHMENTS)
    expect(shown).toEqual([NO_PENDING_ATTACHMENTS])
  })

  // #1055's undo, carried through to the tiles: a send whose bridge threw named nothing on the wire, so
  // the files are still attached AND still drawn for the retry.
  it('restores both the holder and the display on rollback', () => {
    const pending: readonly MessageAttachment[] = [REPORT_A]
    const holder = { current: pending }
    const { shown, show } = recorder()
    mirrorTakeToDisplay(drainPendingAttachments(holder), show).rollback()
    expect(holder.current).toBe(pending)
    expect(shown).toEqual([NO_PENDING_ATTACHMENTS, pending])
  })

  // ⭐ THE ORDER INSIDE ROLLBACK IS LOAD-BEARING: the holder is restored FIRST, so a reader that ran
  // between the two writes would never see a drawn tile the next send would fail to record.
  it('restores the holder before it restores the display', () => {
    const pending: readonly MessageAttachment[] = [REPORT_A]
    const holder = { current: pending }
    const seen: Array<readonly MessageAttachment[]> = []
    mirrorTakeToDisplay(drainPendingAttachments(holder), () => void seen.push(holder.current))
    seen.length = 0
    mirrorTakeToDisplay(drainPendingAttachments(holder), () => void seen.push(holder.current))
    expect(seen[0]).toBe(NO_PENDING_ATTACHMENTS)
  })

  it('leaves a take of nothing showing the shared empty constant', () => {
    const holder = { current: NO_PENDING_ATTACHMENTS }
    const { shown, show } = recorder()
    const take = mirrorTakeToDisplay(drainPendingAttachments(holder), show)
    expect(take.attachments).toBe(NO_PENDING_ATTACHMENTS)
    expect(shown[0]).toBe(NO_PENDING_ATTACHMENTS)
  })
})

describe('attachmentAskTarget — the host the three asks name', () => {
  const initialRows = conversationListStore.getState()
  afterEach(() => {
    conversationListStore.setState(initialRows, true)
  })
  const row = {
    id: 'chat-1',
    name: null,
    is_promoted: false,
    is_archived: false,
    cwd: '/',
    last_message_ts: '',
    last_used_at: '',
    workspace_label: null
  }

  it('names the open chat’s host, read off the conversation list', () => {
    conversationListStore.setState({ conversations: [{ ...row, serverId: 'owner' }] })
    expect(attachmentAskTarget('chat-1')).toEqual({ conversationId: 'chat-1', serverId: 'owner' })
  })

  it('omits the key outright when the list does not hold the chat — never `serverId: undefined`', () => {
    conversationListStore.setState({ conversations: null })
    const unloaded = attachmentAskTarget('chat-1')
    expect(unloaded).toEqual({ conversationId: 'chat-1' })
    expect('serverId' in unloaded).toBe(false)
    conversationListStore.setState({ conversations: [{ ...row, id: 'other-chat', serverId: 'owner' }] })
    expect('serverId' in attachmentAskTarget('chat-1')).toBe(false)
  })

  it('omits the key rather than guess when two hosts hold a row with the same id', () => {
    conversationListStore.setState({
      conversations: [
        { ...row, serverId: 'first' },
        { ...row, serverId: 'second' }
      ]
    })
    expect('serverId' in attachmentAskTarget('chat-1')).toBe(false)
  })

  it('omits the key when the row carries no server of its own', () => {
    conversationListStore.setState({ conversations: [{ ...row, serverId: null }] })
    expect('serverId' in attachmentAskTarget('chat-1')).toBe(false)
  })
})
