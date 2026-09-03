import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AttachmentUploadEvent } from '../../../../shared/ipc/attachmentUpload'
import {
  COMPOSER_ATTACH_LABEL,
  ComposerAttachButton,
  ComposerAttachOutcome
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
