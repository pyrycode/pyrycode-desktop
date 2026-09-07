import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AttachmentFileIcon } from './AttachmentFileIcon'

// #1262: the file drawing, lifted out of BubbleAttachmentRow so the composer's tile and the bubble's row
// are the same glyph and the same label rather than two transcriptions of one Figma node.
//
// WHAT THIS TIER OWNS is the markup and the class SUBSTITUTION — the mechanism that keeps the bubble's own
// three attribute runs byte-identical while the composer wears its own. What it cannot own is the ink: the
// two consumers differ by `color` resolved on the glyph and the label elements, and `environment: 'node'`
// has no stylesheet. The bubble's half of that is guarded by the shipped byte-string assertions in
// ConversationScreen.test.tsx; the composer's is e2e/composer-attach.spec.ts.
describe('AttachmentFileIcon — the shared file drawing (#1262 AC3)', () => {
  const render = (filename: string): string =>
    renderToStaticMarkup(
      <AttachmentFileIcon
        filename={filename}
        frameClassName="frame-class"
        glyphClassName="glyph-class"
        labelClassName="label-class"
      />
    )

  // ⭐ THE WHOLE POINT OF THE THREE PROPS, asserted as WHOLE attribute runs rather than as toContain.
  // A shared class lifted into these runs as a two-class mix is exactly what degrades the bubble's shipped
  // assertions — four redden and a fifth passes vacuously — so the substitution has to be total.
  it('wears each caller’s class as a whole attribute run, adding none of its own', () => {
    const markup = render('report.pdf')
    expect(markup).toContain('<span class="frame-class">')
    expect(markup).toContain('class="glyph-class"')
    expect(markup).toContain('<span class="label-class" aria-hidden="true">PDF</span>')
    // No class of the drawing's own leaked into any of the three.
    expect(markup).not.toContain('attachment-file')
  })

  // STROKE, NOT FILL. The export is fill="none" over a stroked path, so filling it would render a solid
  // document — the trap the layer's own name (`file-solid-full`) sets, and one this repo has been caught
  // by once already. `currentColor` is what lets the two consumers differ: each one's glyph class resolves
  // its own `color`, with no colour prop and no style attribute here.
  it('draws the outline in currentColor at the drawn 45x60, hidden from assistive tech', () => {
    const markup = render('report.pdf')
    expect(markup).toContain('viewBox="0 0 45 60"')
    expect(markup).toContain('width="45"')
    expect(markup).toContain('height="60"')
    expect(markup).toContain('fill="none"')
    expect(markup).toContain('stroke="currentColor"')
    expect(markup).not.toContain('fill="currentColor"')
    // Both children are decorative: the label restates characters the name already carries, and the glyph
    // says nothing a reader needs. Whatever accessible name the drawing sits inside is the caller's.
    expect(markup.match(/aria-hidden="true"/g)).toHaveLength(2)
  })

  // The label is `attachmentExtensionLabel`'s answer and nothing else — the derivation's own tests pin the
  // characters; what this pins is that the component asks it rather than slicing the name itself.
  it('draws the extension label, and the designed empty case as an empty element', () => {
    expect(render('archive.tar.gz')).toContain('>GZ</span>')
    expect(render('README')).toContain('<span class="label-class" aria-hidden="true"></span>')
  })

  // ⭐ THE NAME IS UNTRUSTED AND ONLY THE LABEL MAY GO THROUGH (the plan's security review). The raw name
  // reaches no attribute, no text node and no URL — the label's character class is [A-Za-z0-9] capped at
  // four, so a crafted name cannot widen the drawing or smuggle markup into it either.
  it('puts nothing of the raw filename in the markup but the derived label', () => {
    const hostile = '../../etc/passwd"><img src=x onerror=alert(1)>.pdf'
    const markup = render(hostile)
    expect(markup).not.toContain('passwd')
    expect(markup).not.toContain('onerror')
    expect(markup).not.toContain('..')
    expect(markup).toContain('>PDF</span>')
  })
})
