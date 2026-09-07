import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ATTACHMENT_IMAGE_ALT } from './BubbleAttachmentImage'
import { ComposerAttachmentImage, ComposerAttachmentTile } from './ComposerAttachmentImage'

// #1263 — the three drawn states of a pending image attachment's tile. The renderer tier is
// `renderToStaticMarkup` under `environment: 'node'` — no DOM, no stylesheet, no effects and no handlers — so
// what it owns is the MARKUP of each state and the untrusted-text posture, and it owns them completely only
// because `ComposerAttachmentTile` is a PURE function of its state. `object-fit: cover`, the 45x60 box, the
// load itself and the decode-error transition are boxes and events, and belong to
// e2e/composer-attachment-image.spec.ts.

const FILENAME = 'holiday-photo.png'
const URL_FIXTURE = 'blob:pyry-desktop/7c2e1d3b-0000-4000-8000-000000000000'

// A static render drops event handlers entirely, so nothing here can fire it. It is passed because the prop is
// required, and required rather than optional so the production path cannot forget it.
const NO_DECODE_ERROR = (): void => {}

/** The frame run every state wears, counted the way `ComposerAttach.test.tsx` counts tiles: the closing quote
 *  is part of the match, so `class="composer__attachment-image"` is not a frame. */
const frameCount = (markup: string): number =>
  markup.match(/class="composer__attachment"/g)?.length ?? 0

describe('ComposerAttachmentTile — the three states (#1263 AC1, AC2)', () => {
  it('draws the frame and NOTHING inside it while the bytes are in flight', () => {
    // AC2's first half. The frame is drawn from the moment the attachment joins the set, so the strip's tile
    // count and each tile's position never change as bytes arrive — where `AttachmentThumbnail`'s `pending`
    // arm draws nothing at all, because reserving a box there would need the picture's aspect ratio and here
    // the box is a fixed 45x60 whatever the picture turns out to be. An equality rather than a `not.toContain`
    // because a spinner or a placeholder fill of ANY kind must fail it.
    const markup = renderToStaticMarkup(
      <ComposerAttachmentTile
        state={{ type: 'pending' }}
        filename={FILENAME}
        onDecodeError={NO_DECODE_ERROR}
      />
    )
    expect(markup).toBe('<span class="composer__attachment"></span>')
  })

  it('draws exactly one <img> pointed at the URL, named by a CLIENT-OWNED constant', () => {
    const markup = renderToStaticMarkup(
      <ComposerAttachmentTile
        state={{ type: 'ready', url: URL_FIXTURE }}
        filename={FILENAME}
        onDecodeError={NO_DECODE_ERROR}
      />
    )
    expect(markup).toContain(`src="${URL_FIXTURE}"`)
    expect(markup).toContain('class="composer__attachment-image"')
    expect(markup).toContain(`alt="${ATTACHMENT_IMAGE_ALT}"`)
    expect(markup.match(/<img/g)?.length ?? 0).toBe(1)
    // Inside the SAME frame the other two states wear — not a second frame of its own, which is what keeps
    // the tile's box identical across the transition.
    expect(frameCount(markup)).toBe(1)
    expect(markup.startsWith('<span class="composer__attachment">')).toBe(true)
    // ⭐ NO CONTROL, and that is the second deliberate departure from the bubble's picture. #869 wrapped that
    // one in a real <button> so it could be opened; clicking a composer tile to open the file is not planned,
    // and #1264's remove control is the one control this tile will ever get. No tab stop, no handler, no
    // width/height attribute either — the box is the frame's, and an intrinsic size would fight it.
    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('width=')
    expect(markup).not.toContain('height=')
  })

  it('draws the FILE TILE when the picture cannot be shown — never a broken-image icon', () => {
    // AC2's second half, and one drawing for every way an ask can end without a picture: a retrieval that
    // failed, bytes that could not be read, and bytes that arrived and did not decode. The element that would
    // draw a broken-image icon is unmounted by the very transition that reaches this state.
    const markup = renderToStaticMarkup(
      <ComposerAttachmentTile
        state={{ type: 'failed' }}
        filename={FILENAME}
        onDecodeError={NO_DECODE_ERROR}
      />
    )
    expect(markup).not.toContain('<img')
    expect(markup).toContain('class="composer__attachment-glyph"')
    expect(markup).toContain('<span class="composer__attachment-ext" aria-hidden="true">PNG</span>')
    // ONE frame, not a tile nested in a tile: the image tile and the file tile are alternative drawings of
    // the same `.composer__attachment` box, and the strip picks one per attachment.
    expect(frameCount(markup)).toBe(1)
  })
})

describe('ComposerAttachmentTile — the untrusted name (#1263 AC3)', () => {
  // The name is operator- or model-chosen text arriving over `ipcRenderer.on`, where the declared type is the
  // compile-time half only. `ComposerAttachmentStrip`'s shipped posture, carried to the arm that draws a
  // picture: no attribute sink at all, and only the derived label as escaped children.
  const HOSTILE = '../../etc/passwd"><img src=x onerror=alert(1)>.png'

  it('puts nothing of the name in an attribute in ANY state', () => {
    for (const state of [
      { type: 'pending' },
      { type: 'ready', url: URL_FIXTURE },
      { type: 'failed' }
    ] as const) {
      const markup = renderToStaticMarkup(
        <ComposerAttachmentTile
          state={state}
          filename={HOSTILE}
          onDecodeError={NO_DECODE_ERROR}
        />
      )
      expect(markup).not.toContain(HOSTILE)
      expect(markup).not.toContain('passwd')
      expect(markup).not.toContain('onerror')
      expect(markup).not.toContain('title=')
      expect(markup).not.toContain('aria-label')
    }
  })

  it('names the picture by the constant and by nothing derived from the file', () => {
    const markup = renderToStaticMarkup(
      <ComposerAttachmentTile
        state={{ type: 'ready', url: URL_FIXTURE }}
        filename={HOSTILE}
        onDecodeError={NO_DECODE_ERROR}
      />
    )
    // The ONLY `alt` in the markup is the client-owned constant — the sink #815 closed when it declined an
    // `aria-label` built from the name, kept closed here.
    expect(markup.match(/alt="/g)?.length ?? 0).toBe(1)
    expect(markup).toContain(`alt="${ATTACHMENT_IMAGE_ALT}"`)
  })
})

describe('ComposerAttachmentImage — the container (#1263)', () => {
  // The one arm this tier can reach through the container: its effect never runs under a static render, so it
  // renders `pending` forever. Every branch behind that effect would be unprovable if the two were one
  // component — `BubbleAttachmentImage`'s recorded reason for the same split.
  it('renders the in-flight frame before any fetch has settled', () => {
    const markup = renderToStaticMarkup(
      <ComposerAttachmentImage
        attachment={{ attachmentId: 'b3f1c0de-0000-4000-8000-000000000000', filename: FILENAME }}
      />
    )
    expect(markup).toBe('<span class="composer__attachment"></span>')
  })

  it('puts the host-side storage handle nowhere in the DOM', () => {
    const attachmentId = 'b3f1c0de-0000-4000-8000-000000000000'
    const markup = renderToStaticMarkup(
      <ComposerAttachmentImage attachment={{ attachmentId, filename: FILENAME }} />
    )
    expect(markup).not.toContain(attachmentId)
  })
})
