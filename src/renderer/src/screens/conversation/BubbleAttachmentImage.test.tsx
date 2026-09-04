import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ATTACHMENT_IMAGE_ALT,
  ATTACHMENT_IMAGE_UNAVAILABLE,
  AttachmentThumbnail,
  BubbleAttachmentImage
} from './BubbleAttachmentImage'

// #1045: the three drawn states of an image attachment's thumbnail. The renderer tier is
// `renderToStaticMarkup` under `environment: 'node'` — no DOM, no stylesheet, no effects and no event
// handlers — so what it can own is the MARKUP of each state and the untrusted-text posture. It owns those
// completely only because `AttachmentThumbnail` is a PURE function of its state: the container's effect is
// unreachable here (it renders `pending` forever), and every branch behind it would be unprovable if the
// two were one component.
//
// The sizing rule, the live bounds, the decode-error transition and the load itself are boxes and events,
// and belong to e2e/attachment-image-thumbnail.spec.ts.

const FILENAME = 'holiday-photo.png'
const URL_FIXTURE = 'blob:pyry-desktop/6b1f0c2a-0000-4000-8000-000000000000'

// The decode-error seam. Static renders drop event handlers entirely, so nothing here can fire it — the
// transition it drives is e2e's. It is passed because the prop is required, and required rather than
// optional so the production path cannot forget it.
const NO_DECODE_ERROR = (): void => {}

// #869's seam, and the same story: a static render drops `onClick`, so what this tier owns is that the
// ELEMENT carrying it exists in exactly one of the three states. The activation itself — click, Enter,
// Space — is e2e/attachment-image-open.spec.ts's.
const NO_OPEN = (): void => {}

describe('AttachmentThumbnail — the three states (#1045)', () => {
  it('draws NOTHING while the fetch is in flight, and reserves nothing either', () => {
    // AC-in-flight: no spinner, no placeholder box. Reserving space needs the aspect ratio, which needs
    // the bytes, which is the thing being fetched — so there is no honest box to reserve. An empty string
    // is the assertion rather than "no img", because a placeholder element of ANY kind would fail it.
    const markup = renderToStaticMarkup(
      <AttachmentThumbnail
        state={{ type: 'pending' }}
        filename={FILENAME}
        onDecodeError={NO_DECODE_ERROR}
        onOpen={NO_OPEN}
      />
    )
    expect(markup).toBe('')
  })

  it('draws exactly one <img> pointed at the URL, named by a CLIENT-OWNED constant', () => {
    const markup = renderToStaticMarkup(
      <AttachmentThumbnail
        state={{ type: 'ready', url: URL_FIXTURE }}
        filename={FILENAME}
        onDecodeError={NO_DECODE_ERROR}
        onOpen={NO_OPEN}
      />
    )
    expect(markup).toContain(`src="${URL_FIXTURE}"`)
    expect(markup).toContain('class="bubble__image"')
    expect(markup.match(/<img/g)?.length ?? 0).toBe(1)

    // ⭐ THE ACCESSIBLE NAME IS A CONSTANT, AND THE FILENAME IS NOWHERE IN THE MARKUP. `alt` is an
    // ATTRIBUTE, and #815's row settled that the untrusted, operator- or model-chosen name does not enter
    // one — it declined an `aria-label` for exactly that reason. An <img> still needs an accessible name,
    // and a constant supplies one without reopening the ruling.
    expect(markup).toContain(`alt="${ATTACHMENT_IMAGE_ALT}"`)
    expect(markup).not.toContain(FILENAME)
    expect(markup).not.toContain('holiday')
  })

  it('draws the same plain textual fallback for every failed ask, with no reason in it', () => {
    // AC5: one client-owned sentence, never a per-reason message and never a broken-image icon. `failed`
    // carries NO reason by construction — the state has no field for one — so this is structural rather
    // than careful, and there is nothing in scope for a later edit to interpolate.
    const markup = renderToStaticMarkup(
      <AttachmentThumbnail
        state={{ type: 'failed' }}
        filename={FILENAME}
        onDecodeError={NO_DECODE_ERROR}
        onOpen={NO_OPEN}
      />
    )
    expect(markup).toContain(ATTACHMENT_IMAGE_UNAVAILABLE)
    expect(markup).toContain(FILENAME)
    // Not an <img> at all: a broken-image icon is what a failed <img src> WOULD draw, and the criterion
    // names it by name.
    expect(markup).not.toContain('<img')
    // The reasons #1044's union can carry, none of which may reach the reader.
    for (const reason of ['refused', 'unavailable', 'busy', 'not-found', 'verification-failed']) {
      expect(markup).not.toContain(reason)
    }
  })

  it('puts the failed name into the DOM as ESCAPED CHILDREN and into no attribute', () => {
    // AC5's bound on the one untrusted string this state draws. React auto-escapes children, so markup
    // and a URL both render as visible characters; what this pins is that the name reached children and
    // not an attribute, a title, an alt or a src.
    const hostile = '<script>alert(1)</script>"onerror="x'
    const markup = renderToStaticMarkup(
      <AttachmentThumbnail
        state={{ type: 'failed' }}
        filename={hostile}
        onDecodeError={NO_DECODE_ERROR}
        onOpen={NO_OPEN}
      />
    )
    expect(markup).toContain('&lt;script&gt;')
    expect(markup).not.toContain('<script>')
    // ⭐ THE QUOTE IS THE ONE THAT MATTERS, and it is asserted as an ESCAPED PRESENCE rather than as an
    // absence. `onerror=` is a substring of the hostile name by construction, so `not.toContain` on it
    // would be unsatisfiable however correct the render — #815's `README` case, met again. What actually
    // separates safe from unsafe is whether the `"` that would CLOSE an attribute survived: escaped to
    // `&quot;`, the run is inert visible text; raw, it would forge one.
    expect(markup).toContain('&quot;onerror=&quot;')
    expect(markup).not.toContain('"onerror="')
    // Sinks that cannot appear in escaped text at all, and appear nowhere in this element.
    for (const sink of ['alt=', 'src=', 'title=', 'href=', 'aria-label=']) {
      expect(markup).not.toContain(sink)
    }
  })
})

describe('AttachmentThumbnail — the drawn picture is the control (#869)', () => {
  const ready = (filename = FILENAME): string =>
    renderToStaticMarkup(
      <AttachmentThumbnail
        state={{ type: 'ready', url: URL_FIXTURE }}
        filename={filename}
        onDecodeError={NO_DECODE_ERROR}
        onOpen={NO_OPEN}
      />
    )

  it('wraps the picture in one real <button>, which is where click, Enter and Space come from', () => {
    // AC1. A `role="button"` div would need its own keydown handler for Enter and Space; the platform
    // element supplies all three, which is why the criterion costs no key handling. `type="button"` is
    // not decoration — a bare <button> inside a form would be a submit control.
    const markup = ready()
    expect(markup.match(/<button/g)?.length ?? 0).toBe(1)
    expect(markup).toContain('type="button"')
    expect(markup).toContain('class="bubble__image-button"')
    // The picture is INSIDE the control rather than beside it: that nesting is what gives the button its
    // accessible name and what makes the ring trace the picture's box.
    expect(markup).toMatch(/<button[^>]*>\s*<img/)
    expect(markup.match(/<img/g)?.length ?? 0).toBe(1)
    // No hand-rolled key handling: a static render drops handler VALUES, but a `tabindex` or a `role`
    // standing in for the platform element would survive as an attribute and reddens here.
    for (const stand_in of ['tabindex', 'role=', 'onkeydown']) {
      expect(markup.toLowerCase()).not.toContain(stand_in)
    }
  })

  it("names the control by the client-owned constant, never by the file's name", () => {
    // AC1's second half and #815's ruling, carried to the control: a <button> wrapping an <img> takes
    // its accessible name from the `alt`, so the existing constant already names it and no second name
    // is minted. The untrusted filename enters no attribute — asserted with a name that would be
    // unmistakable in one.
    const markup = ready('holiday-photo.png')
    expect(markup).toContain(`alt="${ATTACHMENT_IMAGE_ALT}"`)
    expect(markup).not.toContain('holiday')
    for (const sink of ['aria-label=', 'title=', 'aria-labelledby=', 'href=']) {
      expect(markup).not.toContain(sink)
    }
    // AC2's renderer half: no path is built here, and the one URL still reaches exactly one attribute.
    expect(markup.split(URL_FIXTURE).length - 1).toBe(1)
  })

  it('gives the in-flight and fallback states NO control at all', () => {
    // AC1's last clause. `pending` draws nothing, so there is nothing to focus or press; `failed` draws
    // a textual fallback, and what a reader would want there is a RE-FETCH — #1044's leg, not #867's.
    // Both are asserted through the same string so a control added to either state reddens.
    for (const state of [{ type: 'pending' } as const, { type: 'failed' } as const]) {
      const markup = renderToStaticMarkup(
        <AttachmentThumbnail
          state={state}
          filename={FILENAME}
          onDecodeError={NO_DECODE_ERROR}
          onOpen={NO_OPEN}
        />
      )
      expect(markup).not.toContain('<button')
      expect(markup).not.toContain('bubble__image-button')
      expect(markup.toLowerCase()).not.toContain('tabindex')
    }
  })
})

describe('BubbleAttachmentImage — the mount (#1045)', () => {
  it('draws nothing under a static render, because the fetch has not started', () => {
    // The container's own arm, and the whole of what this tier can see of it: effects do not run under
    // `renderToStaticMarkup`, so the state is `pending` and stays there. This is not a weakness of the
    // split — it is the reason for it. Importing the module also proves the singleton it closes over
    // constructs cleanly with no `window.pyry` present, since every seam dereferences the bridge inside
    // its own arrow body rather than at module load.
    const markup = renderToStaticMarkup(
      <BubbleAttachmentImage attachment={{ attachmentId: 'att-1', filename: FILENAME }} />
    )
    expect(markup).toBe('')
  })
})
