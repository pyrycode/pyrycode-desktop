# Conversation shell — message bubble attachment slots

The two attachment-drawing arms of the same `Message` component `Slot` that
[Conversation shell — message bubble](conversation-shell-message-bubble.md) restyled: a settled,
non-image attachment draws as a file row (#815, download control #816), and an image attachment draws as
a picture (#1045, click-to-open in the OS viewer #869). Split out of the parent overview because the two
sections together outgrew the size cap `npm run check:docs` enforces; the parent's
[§ What stays untouched](conversation-shell-message-bubble.md#what-stays-untouched) is what points here.

## The attachment file row (#815, #816)

A settled, non-image attachment on a sent message draws as `.bubble__file`: an outlined document glyph
(45×60, inline `<svg>`, its extension overlaid across the lower half) and the filename beside it, 12px
apart and both vertically centred. Figma `File field` 132:4605, inside the bubble at 121:3860. `#1039`
supplied the record this reads (`MessageAttachment[]` on a `userText` [timeline item](thread-timeline-internals.md#types));
until that ticket landed there was no name to draw.

**User-arm only, and structurally so — not a scope choice.** The drawing is an *assistant* bubble, but
`MessagePayload` carries no attachment field and there is no list verb, so an assistant-produced file
cannot reach the window at all today. `attachments` can only ever describe files the client itself
minted. Building an assistant-side mount would be building for a wire change nobody has filed.

**Rendered as one `<div className="bubble__file">` per attachment, each a direct child of `.bubble`, no
wrapper** — the same reason `.bubble__meta` uses a `margin-top` rather than a flex-column gap (`.bubble`
can't be a flex column; see the parent overview). Each row carries `margin-top: var(--space-3)`, so text
→ file → file → meta falls out at the drawn 12px rhythm with one rhythm mechanism, not two. Written
between the message text and `<BubbleMeta>` — the slot `BubbleMeta`'s own comment reserved for it — which
keeps `interactiveRoundtrip.test.tsx`'s pinned opening-child byte string intact. React key is the array
index: the list is a frozen record written once at send and never reordered, so index identity is stable
(`Timeline`'s own argument), and a `filename`-derived key was deliberately avoided as the step that makes
`id={filename}` look natural next.

**`attachmentExtensionLabel(filename)`** (new, `attachmentExtensionLabel.ts`, pure, beside
`messageTime.ts`): text after the *last* dot (`archive.tar.gz` → `GZ`), uppercased, `[A-Za-z0-9]` only
(not `\p{L}` — a 44px slot can't hold an arbitrary script, so `файл.документ` draws nothing by design,
not defect), capped at 4 characters *after* stripping (so the cap bounds what's drawn, not what was
parsed). Returns `''` — never a fallback word like `FILE` — when there's no dot, a trailing dot, or the
character class removes everything. `lastIndexOf` + `slice` + one single-character-class `replace` +
`slice`, deliberately linear (no backtracking regex) since it runs on every render of untrusted-length
input.

**Colour and type follow the meta row's precedent exactly:** `--color-inverse-primary`, read off the
Figma *variable* rather than the export (same transposition trap, same accepted-contrast ruling, not
reopened here). All four body-small axes (size, line-height, tracking, weight) are restated on
`.bubble__file` because `.bubble` sets title-small emphasized — three of the four differ and are easy to
leave inherited by accident. The extension overlay additionally sets
`--text-body-small-weight-emphasized` (500), the token this ticket confirmed already exists at
`tokens.css:159` after an earlier draft claimed otherwise.

**The glyph is a stroke, not a fill — a deliberate departure from the ticket's own AC wording.** The
Figma layer is named `file-solid-full` but the export is `fill="none"` with a stroked path; the drawing
is an outline. `fill="currentColor"` as the AC literally asked would render a solid document, contradicting
the same ticket's "outlined document glyph". Shipped as `fill="none" stroke="currentColor"` instead — the
ink still comes from the row's `color`, satisfying the criterion's substance. Recorded in the code comment
and the PR body rather than silently reconciled, because it's the same "layer name lies, trust the render"
trap the ticket flags once already, one line further in.

**AC5 (wrap beside the icon, never truncate, never squeeze the icon below 45px) needed no CSS at all —
measured, not assumed.** The plan specified `.bubble__file-name { min-width: 0; overflow-wrap: anywhere }`
on the theory that a flex item's automatic minimum size is a different mechanism than `.bubble`'s
inherited `word-break: break-word`. Four mutations against a 184-character space-free name in
`e2e/attachment-file-row.spec.ts` (drop `min-width: 0`; drop `overflow-wrap: anywhere`; drop both; drop
`flex: 0 0 auto` from the icon) all passed unchanged. The reason: `word-break: break-word` behaves as
`overflow-wrap: anywhere`, which *does* reduce a box's min-content size — unlike `overflow-wrap:
break-word` — so `.bubble`'s existing rule already collapses the automatic minimum to one character.
`.bubble__file-name` ships with **no CSS of its own**; the class is a locator only. This follows the same
"a settled inherited value that's restated is a value that gets lost" ruling the parent overview already
applies to `.bubble__markdown code` and `.bubble__markdown a` (#607/#623/#628/#629/#630). `flex: 0 0 auto`
stays on the icon despite measuring inert on this AC, kept as this file's vocabulary for a non-shrinking
lead item and because the automatic-minimum floor it duplicates is conditional in a way the declaration
isn't — a later `min-width: 0` on that rule would remove it. The guard for AC5 is
`e2e/attachment-file-row.spec.ts` alone: nothing in this AC is observable in the static (no-DOM) tier, so
if `.bubble`'s `word-break` is ever narrowed, that spec is what goes red.

**Untrusted display text, first DOM sink — never sanitised here.** `filename` is IPC-delivered and, until
\#815, was rendered nowhere at all (asserted by `attachmentUploadCopy.test.ts` and
`ComposerAttach.test.tsx`). It and the extension label reach the DOM as auto-escaped React children only
— never an attribute, a `title`, an `alt`, a URL, or `dangerouslySetInnerHTML` — the [daemon-text
rendering ruling](../../../CLAUDE.md) extended to a name the client itself, not the daemon, produced.
`attachmentId` (the host-side storage handle the download action needs) is deliberately not rendered
anywhere — it reaches the click closure only. The row does **not** sanitise, trim or normalise the name:
`sanitizeAttachmentFilename` already re-runs in main on the value a save builds a path from, and a second
sanitiser here would let what the operator *sees* diverge from what a save *writes* — a worse defect than
the tidiness bought. Bidi/control-character extension spoofing (`report<U+202E>gpj.exe` reading as
`report…jpg.exe`) stays a live possibility, mitigated only by the extension overlay's character-class
filter, which #816 confirmed it must not weaken rather than fixing further — see below.

**The row became a control in #816, without redrawing anything.** `<div className="bubble__file">` became
`<button type="button" className="bubble__file" onClick={…}>` with the same two children unchanged. The
one visual addition — a `:focus-visible` outline — was forced by AC1 (keyboard activation needs a visible
focus indicator) and follows `.bubble__copy:focus-visible`'s shipped treatment
(`outline: 1px solid var(--color-outline)`) rather than inventing one; `.bubble__file:hover` matches
`.bubble__copy:hover`'s ink-brighten the same way. Six UA resets on `.bubble__file` put the button back
into #815's measured box: `width: 100%` (a form control's `width: auto` is fit-content, not
fill-available, even at `display: flex`), `padding: 0`, `border: none`, `background: transparent`,
`font-family: inherit` (the rule already restated the other three body-small axes but not the family, so
a button's UA font would otherwise win), and `text-align: left` (undoing the UA `center`, which would
centre every line of a wrapped name — the AC5 case). `word-break` is inherited and inherits into a
button, so AC5's measurement (`.bubble`'s `break-word` collapsing the name's automatic minimum size) held
unchanged, and `e2e/attachment-file-row.spec.ts`'s existing #815 geometry assertions passed with no
further declaration needed — a plan-time open question resolved by running the spec rather than reasoning
about UA defaults.

**The accessible name is the button's own text content, deliberately not an `aria-label`.** The extension
overlay beside the glyph is already `aria-hidden`, so the computed name is exactly the filename, which is
what AC1 asks for. An `aria-label` would put this untrusted, model-chosen text into an attribute — the
sink the paragraph above closes on purpose — and there is no visually-hidden utility in this repo to
prefix a client-owned verb with instead. Neither child takes a `tabIndex`: a real `<button>` rather than a
`div` with a handler gives keyboard activation (click, Enter, Space) and one tab stop for free.

**Wiring is two asks, not one, and lives in `downloadAttachment.ts`** (new, beside `copyMessageText.ts`,
same React-free module-helper shape — see [Attachment retrieval § the download
wiring](attachment-retrieval.md#the-renderer-click-816) for the full design). The button's `onClick` calls
it directly with the row's own `attachment` record — no prop drilling, `BubbleMeta`'s copy control is the
in-bubble precedent, and the open conversation id is read outside React from `activeConversationStore`
rather than threaded down through `Timeline`'s ~30 render sites.

**Image attachments no longer draw this row.** [§ The attachment image thumbnail](#the-attachment-image-thumbnail-1045)
takes the same `Slot` over for a name `isImageAttachmentName` admits and draws the picture instead — see
below. In-flight/failed attachments stay the composer's own concern (`attachmentUploadCopy.ts`) — this
row draws a settled attachment only. Neither a pending state nor a failure state exists for the download
itself (#816's Open Question: no Figma node for either, so both need their own ticket) — the row is
activatable at every instant, with nothing to reset on a failure.

## The attachment image thumbnail (#1045)

An image attachment on a sent message draws as the picture its own bytes decode to, taking over the same
`Slot` (132:4466) the file row above draws into — a branch on what fills the slot, not a second slot. Split
from #868 via [#1044](attachment-image-source.md) (the bytes-to-`blob:`-URL path), #1045 (the `<img>`, the
CSP widening, and the imageness decision itself) and #869 (the drawn picture becoming the control that
opens it in the OS viewer).

**Imageness is a client-owned decision over an untrusted name, made by `attachmentIsImage.ts` (new,
`isImageAttachmentName`) — deliberately not `attachmentExtensionLabel`.** Nothing tells the window an
attachment's type: the bytes channel carries none, the retrieval leg discards name and type on purpose, and
the minted blob has `type === ''`. The only signal is `MessageAttachment.filename`, so imageness is the
text after the *last* dot, lowercased, compared for **exact** equality against a frozen seven-member set
(`png` `jpg` `jpeg` `gif` `webp` `avif` `bmp`) — not `attachmentExtensionLabel`'s decorative
uppercase-strip-cap pipeline, which would call `photo.p-n-g` a `PNG`. `svg` is excluded because it is a
document rather than bytes (the `img-src` widening's whole argument is "a `blob:` URL only ever reaches an
`<img>` `src`", and admitting a format whose safety rests on a second browser-internal rule weakens that to
two sentences); `heic`/`heif`/`tiff` are excluded because Chromium cannot decode them, and an excluded name
falls back to the working file row rather than a dead thumbnail. Linear time, no backtracking pattern —
`attachmentExtensionLabel`'s own inherited constraint, since this also runs on an untrusted-length name on
every render. The decision governs only what is **drawn**: a name that lies produces a picture that fails to
decode, never a different file, because the fetch is addressed by `attachmentId` and this helper never sees
it.

**The mount, `BubbleAttachmentImage.tsx` (new), splits a pure state-to-markup function from a one-effect
container** so all three drawn states stay provable under `renderToStaticMarkup`'s no-DOM tier.
`AttachmentThumbnail({ state, filename, onDecodeError, onOpen })` takes no hooks and switches on
`AttachmentThumbnailState`:

- `pending` → `null`. Nothing drawn and nothing reserved — reserving space needs the aspect ratio, which
  needs the bytes, which is the thing being fetched. A late-loading thumbnail moving the reader's scroll
  position was the real follow-up this arm's header predicted; [#1046](conversation-shell.md) measured it
  and found Chromium's own scroll anchoring already holds a reader's place against a thumbnail resolving
  **above** them, so nothing changed here or in `useThreadScrollPin`. Growth **below** the reader (their
  own last row, where anchoring does not apply) was the one case left open, and
  [#1049](conversation-shell.md) closed it in `useThreadScrollPin`, not here — this file's own arms are
  unchanged.
- `ready` → `<button type="button" className="bubble__image-button" onClick={onOpen}>` wrapping the
  unchanged `<img className="bubble__image" src={url} alt={ATTACHMENT_IMAGE_ALT} onError={onDecodeError} />`
  (#869). A real `<button>`, not `role="button"`, so click, Enter and Space all come from the platform
  element and no `keydown` handler exists anywhere in this file. The accessible name is the wrapped
  `<img>`'s `alt` — the same **client-owned constant** `'Attached image'`, never the filename — so #869
  mints no second name to keep in step with the first; `alt` is an attribute, and #815's ruling that the
  untrusted name never enters one is carried across rather than reopened. `onError` is AC5's decode-failure
  half (bytes arrive, the name lied) and cannot loop: moving off `ready` unmounts the very `<img>` that
  raised it (and the button wrapping it).
- `failed` → a `<p className="bubble__image-fallback">` holding the client-owned sentence `'Image could not
  be shown'` and, in its own `<span className="bubble__image-fallback-name">`, the filename as escaped React
  children — included, not omitted, because a reader who sent several pictures needs to know which is
  missing. No control, no tab stop and no handler: what a reader would want here is a re-fetch, which is
  #1044's leg rather than #867's.

**`BubbleAttachmentImage` sends one fire-and-forget ask and does not lift a fetch-then-act shape (#869).**
`onOpen` is `() => window.pyry.openAttachment({ attachmentId: attachment.attachmentId })`, the bridge
dereferenced inside the arrow body (`downloadAttachment.ts`'s idiom) so a static render with no bridge
present stays green. No `onAttachmentOpenEvent` subscription exists: [attachment open](attachment-open.md)
answers with one of four failure reasons and none has designed feedback (the ticket's open question,
shared with #816), so a listener would have nothing to do with what it heard. This is **not** a third
instance of the [attachment image source](attachment-image-source.md#no-shared-fetch-then-act-machinery-was-lifted)
fetch-then-act shape, even though that module's header named #869 as a candidate: the drawn picture only
reaches `ready` after `attachmentImageSources` already drove the retrieval leg to `completed`, and that leg
is the sole writer of the directory [attachment open](attachment-open.md) reads — so the picture being on
screen at all is itself proof the file is on this machine, and the click needs no sequencing of its own.
This inverts the file row's situation (#816): that row draws *before* any fetch, so its click had to fetch
first or answer `unavailable` forever.

**The identifier and nothing else crosses into the ask.** `AttachmentOpenRequest` has one field; nothing in
this component builds, joins or forwards a path, and no filename reaches a URL or an attribute — the blob
URL the `ready` state holds takes no part in the ask, since the open channel addresses the file by
identifier rather than by the bytes already on screen.

**The drawable set and the openable set disagree, and #869 did not reconcile them.** `attachmentIsImage.ts`
admits `avif` and `bmp` as drawable (Chromium decodes both); [attachment open](attachment-open.md)'s
signature-matched `ImageSuffix` does not. So a `.avif`/`.bmp` attachment draws a picture whose button
answers `unsupported-type` on every click — a silently dead control on two admitted formats. Left open
deliberately: widening the signature set or narrowing the drawable set are each a change to a
security-argued closed set with its own reasoning to redo, and the operator has not asked for either.

`failed` carries no reason, structurally rather than by care: `BubbleAttachmentImage` reads the
`AttachmentImageSourceFailure` off the effect, logs it as a bare `console.error` event name, and discards it
before it reaches state — no reason is left in scope for a later edit to interpolate into the fallback,
which makes AC5's "never a per-reason message" a property of the code shape rather than a rule to remember.
The host's `not-found` is deliberately its one code for every request that yields no bytes, so a per-code
message here would have undone that indistinguishability from this side.

The effect returns the [release handle](attachment-image-source.md#the-release-handle-and-refcounting)
directly as its own cleanup — legal because the handle comes back on every branch before any terminal. A
synchronous outcome (the URL is already live) sets state from inside the effect body, the case #1044's
`takeShare` records the map entry before invoking the callback to make safe. Under `React.StrictMode`'s
development double-invoke the sequence is request → release → request; the second ask finds the retrieval
already `inFlight` main-side and is a no-op, and the second mount still settles because main answers over a
channel broadcast every listener receives, not a per-request reply.

**The box, `.bubble__image` in `conversation.css`, is four declarations, two of which are the whole sizing
rule:**

```css
.bubble__image {
  display: block;
  max-height: 160px;
  max-width: 100%;
  border-radius: var(--radius-xs);
}
```

`max-height` + `max-width` with both dimensions left `auto` is CSS's own contain behaviour for a replaced
element (CSS2.1 §10.4): the used size comes from the image's intrinsic ratio, then whichever constraint
binds clamps and the other dimension follows proportionally — the operator's 2026-08-22 sizing ruling (160px
tall, width from the ratio, capped at the bubble's content width with height falling proportionally, never
scaling a naturally-shorter image up) as one mechanism rather than computed and reapplied. `height: 160px`
was the rejected alternative and is a real trap, not a style preference: a fixed height makes `max-width`
clamp the width and *distort* the image — confirmed by mutation-testing the substitution, which reddens the
capped e2e assertion at a drawn height of 160 against an expected 57. `max-width: 100%` resolves against
`.bubble`'s own content box (`min(680px, 75%)` less `--space-5` either side), so both bounds move live with
the window; no fixed pixel width is written anywhere. The fallback (`.bubble__image-fallback`) takes the
file row's typographic block (body-small, `--color-inverse-primary`) and its own `margin-top`, so a failed
image occupies the rhythm a drawn one would and the thread does not shift as asks settle.

**`margin-top: var(--space-3)` lives on `.bubble__image-button` (#869), not on `.bubble__image`.** `.bubble`
is deliberately not a flex column (see the parent overview), so the drawing's rhythm is a margin on the
*following sibling* — and once the picture is wrapped in a button, the following sibling is the button.
Left on the image it would sit inside the button (a button's contents are their own formatting context, so
the margin does not collapse out) and the focus ring would carry a 12px band above the picture. The sum a
resolving thumbnail adds to the thread is unchanged at 160 + 12, which is what `thread-scroll-pin.spec.ts`'s
`THUMBNAIL_GROWTH_PX` floor measures — moving the declaration did not move the number.

**`.bubble__image-button` is `.bubble__file`'s UA reset minus its `width: 100%`, and that subtraction is
the whole rule (#869).** A row should fill the bubble; a picture should not — a focus ring tracing a
bubble-width band around a 160px-tall thumbnail is the failure AC3 exists to catch. `width: fit-content`
shrink-wraps the drawn picture, including the tall/narrow case where the picture's own width comes from
`max-height` binding against its ratio rather than from its intrinsic width; `display: block` rather than a
button's inline-block default keeps the box off the parent's text baseline, where an inline-block would add
descender space and push the rhythm below it. `max-width: 100%` restates the image's own cap on the box
that is now laid out. `border-radius` is restated too, so the focus outline follows the picture's own
rounded corners. `:focus-visible { outline: 1px solid var(--color-outline) }` is `.bubble__file:focus-visible`'s
exact declaration, since the Figma node shows no focus treatment of its own for the picture; there is no
`:hover` twin, since `.bubble__file:hover`'s ink-brighten means nothing on a picture and any other hover
treatment would be an invention the drawing does not authorise.

**The CSP widening, `img-src 'self' blob:`, is the one directive this ticket adds to
`src/renderer/index.html`, and its shape was settled by #1044's own security review rather than chosen
here.** It adds no network-reachable source — no `https:`, `http:`, `data:` or `*` — so it does not open the
classic `img-src` exfiltration channel; the only URLs it admits are ones this window itself minted. `'self'`
is restated because a present `img-src` *replaces* `default-src` for images entirely, so `img-src blob:`
alone would silently break every same-origin image the app later adds. The blob-of-HTML-navigation vector (a
`blob:` URL inherits the creating document's origin, so a blob of HTML *navigated to* would run script
holding the preload bridge) stays closed by three guards this ticket left untouched: `will-navigate`
confines in-place navigation to the app's own document, `setWindowOpenHandler` denies every scheme and
externalises only `http:`/`https:`, and `object-src 'none'` blocks a blob object — plus a fourth that holds
by fallback rather than declaration: no `frame-src` is declared, so a frame inherits `default-src 'self'`
and a `blob:` iframe is refused. **A `frame-src`, `child-src`, or a relaxed `default-src` would reopen
exactly what `img-src` alone does not, and none is touched.**

**Measured, not assumed: the CSP's own detector is not what it looks like.** Reverting the widening fails
the e2e spec at `toHaveCount(1)` on `img.bubble__image` — received `0` — never at a `naturalWidth` read. A
source the policy refuses raises `error` on the `<img>`, the same signal an undecodable byte stream raises,
so the element unmounts into the fallback before anything is left to measure. A spec asserting only
`naturalWidth > 0` would have thrown a locator error instead of failing cleanly.

**`e2e/attachment-image-thumbnail.spec.ts` (new) is the family's first spec to drive an attachment fetch to
completion** — `attachment-file-row.spec.ts` answers `request_attachment` with no frames on purpose, since
\#816's next step there is a save into the operator's real Downloads folder; this slice has no save, so
completion is safe and is the only way real bytes reach an `<img>`. It seeds four fixture PNGs as
`attachment-chunk` reply frames with a real SHA-256 computed at spec time (a hand-written digest fails
closed as `verification-failed`): 200×400 (portrait, proves 160-tall with width from the ratio), 800×100
(proves the width cap and the proportional height at every window size up to a 680px bubble), 40×40 (proves
no upscale), and a liar — ASCII bytes under a `.png` name — proving the decode-error fallback. **Fixture
attachment ids must be canonical** (hex and hyphen, per `CANONICAL_ATTACHMENT_ID`): `attachment-file-row.
spec.ts`'s `e2e-download-1` shape gets away with not being canonical only because that spec never drives a
retrieval as far as the store; this one does, and a non-canonical id would make `resolveAttachmentPath`
refuse and every picture silently become the fallback. Geometry assertions read a live content box
(`.bubble`'s box and its computed padding) rather than a computed constant, at both the 800px minimum window
width and a wide size via the existing `setSize` resize idiom, polling after each resize; a rounded pixel
delta is normalised with `+ 0` before any `toBe(0)`, since `Math.round` of a tiny negative fraction is `-0`
and `Object.is(-0, 0)` is `false`.

**A hostile-name test can write an unsatisfiable assertion — the same shape #815's `README` case already
warned about.** `not.toContain('onerror=')` fails on a *correctly escaped* render if the hostile filename
itself contains that substring; what actually separates safe from unsafe is whether the `"` survived
escaping (`&quot;onerror=&quot;`), not whether the raw substring is absent.

**`e2e/attachment-image-open.spec.ts` (new) replaces `shell.openPath` with a recorder in the main
process** via `app.evaluate` plus `Object.defineProperty` —
`assistant-link-opens-externally.spec.ts`'s idiom, which **records rather than suppresses** so no image
viewer opens on whoever runs the suite and the assertion reads the path the app actually handed over. The
stub is installed before the first activation and returns `''`, `shell.openPath`'s success value. A real
attachment is fetched to `ready` (`attachment-image-thumbnail.spec.ts`'s fixture: canonical attachment
ids, a real upload → `request_attachment` → `attachment_chunk` round trip with a computed SHA-256), then
activated by click and by `Shift+Tab`-then-`Enter`/`Space`; each activation records exactly one hand-off
of that attachment's derived copy (`<attachmentId>.png` under `attachment-views`). AC3's geometry is
checked both ways: the button's box equals the drawn picture's box on both axes (the detector for a
`width: 100%` band `.bubble__file` would otherwise carry over), and the 12px rhythm above and below the
picture is unchanged. A bubble whose thumbnail is `failed` has no `.bubble__image-button` at all. No sweep
debt: a `<button>` wrapping the existing `<img>` adds no text-bearing element, so neither
`toHaveText`/`toContainText` nor `textContent`/`allTextContents`/`innerText` across `e2e/` shifts.

## Testing

**#815's own coverage:** `attachmentExtensionLabel.test.ts` pins the four ordering decisions (last-dot,
strip-before-cap, ASCII-only, the leading-dot `.hidden` → `HIDD` case shipped as documented rather than
carved out). A new `ConversationScreen.test.tsx` `describe` pins the row's position between the text and
`.bubble__meta`, the icon/name markup, the extension overlay present for a real extension and empty for
one without, two attachments rendering two rows in list order, and a **count** of `.bubble__file` over
the whole markup for the arms that must render none (assistant bubble, queued row, `MessageBubble`
residue) — the same count-not-absence idiom the meta row's own proof used (see the parent overview).
`e2e/attachment-file-row.spec.ts` (new, fake tier) is the only place AC5's wrapping is actually provable,
and **does not use `bubbleTextExactly`**: that fixture is an anchored whole-bubble matcher (six existing
callers), and this is the first bubble in the suite with a text-bearing child beside the message text.

**#816's own coverage.** `downloadAttachment.test.ts` (new, plain vitest, no React, no DOM) drives the
helper against fakes for all four injected seams: the ask carries exactly `{ conversationId,
attachmentId }`; subscribe happens before the ask (an ordering assertion, since a `busy`/`not-connected`
retrieval can resolve synchronously in main); a `completed` terminal for this attachment asks the save
channel with `{ attachmentId, filename }` verbatim (a name carrying `../`, a bidi control and a leading
dot crosses unsanitised, pinning the no-second-sanitiser ruling above); a `failed` terminal saves nothing
and tears the listener down; an event naming a different attachment is ignored; a second event after the
terminal is a no-op; no open conversation or an over-length **either** identifier — the conversation id
included, since `activeConversationStore` holds the daemon's payload verbatim and a hostile daemon
chooses that string — skips both the subscribe and the ask. `e2e/attachment-file-row.spec.ts` gained a
second `test()`: three sent messages give three rows with three distinct attachment ids, and clicking,
`Enter`-ing and `Space`-ing them decodes three `request_attachment` envelopes off the wire, each naming
its own row's attachment id and nothing else — the round trip is deliberately never driven to completion
in this tier, since a real save would copy into the runner's actual Downloads folder and open a Finder
window. The same test also asserts the row is a `<button>`, becomes `document.activeElement` after a
keyboard interaction, and matches `:focus-visible` with a solid outline.

**#1045's own coverage.** `attachmentIsImage.test.ts` pins the two cases that justify the helper existing
(`photo.p-n-g` and `x.jpegg` are **not** images, where `attachmentExtensionLabel` would call them `PNG` and
`JPEG`), plus case-insensitivity, every admitted extension, `svg`/`heic` refused, and the no-dot/trailing-dot
edge cases. `BubbleAttachmentImage.test.tsx` renders `AttachmentThumbnail` directly in each of the three
states — `pending` draws nothing, `ready` draws exactly one `<img class="bubble__image">` with the URL as
`src` and the constant as `alt` and the filename absent from the markup, `failed` draws the fallback with
the name as escaped children (a name carrying `<script>` and `"` renders as visible, escaped characters) —
plus the container itself under static render (always `pending`). The extended `ConversationScreen.test.tsx`
`describe` asserts an image attachment draws no `.bubble__file`, a non-image one is unchanged, and a message
carrying both draws one of each in record order, still between the message text and `.bubble__meta`. The
bubble-text sweep (`toHaveText|toContainText` and `textContent|allTextContents|innerText` across `e2e/` with
no tier filter) found no existing site that reddens: the `<img>` bears no text, and the fallback — the only
text-bearing child this ticket adds — appears solely on a state no pre-existing spec can reach. The e2e
spec's own coverage is in [§ The attachment image thumbnail](#the-attachment-image-thumbnail-1045) above.

**#869's own coverage.** The extended `BubbleAttachmentImage.test.tsx` `describe` pins the `ready` arm to
exactly one `<button type="button" class="bubble__image-button">` with the `<img>` nested inside it (so
the accessible name and the focus ring both trace the picture), no `tabindex`/`role=`/`onkeydown` standing
in for hand-rolled key handling, the accessible name still the `alt` constant with the filename absent
from the markup and from `aria-label`/`title`/`aria-labelledby`/`href`, and the URL reaching exactly one
attribute. `pending` and `failed` are each asserted to contain no `<button` and no `bubble__image-button`
at all — the negative half of AC1. The e2e tier's own coverage is above, in § The attachment image
thumbnail.

## Related

- [Conversation shell — message bubble](conversation-shell-message-bubble.md) — the parent overview: the
  #969 restyle both slots inherit, and the point this document was split from.
- [#815 architecture spec](../../specs/architecture/815-bubble-attachment-file-row.md) — the non-image
  attachment file row's full design, the AC5 CSS-vs-inherited measurement, and the security review
  § The attachment file row above summarizes.
- [#816 architecture spec](../../specs/architecture/816-attachment-file-row-download-control.md) — the
  download control's full design, including the two-ask sequencing and the security review's MUST FIX
  (bounding the conversation id, not only the attachment id, before subscribing).
- [Attachment retrieval § the renderer click (#816)](attachment-retrieval.md#the-renderer-click-816) and
  [Attachment save](attachment-save.md) — the two background-process channels the file row's click
  drives, fetch then save on that fetch's `completed` terminal.
- [Attachment open](attachment-open.md) — the background-process channel the image thumbnail's click
  (#869) drives, one fire-and-forget ask with no listener; also the drawable/openable set mismatch this
  document's § The attachment image thumbnail records.
- [#686](https://github.com/pyrycode/pyrycode-desktop/issues/686) — the parent ticket the attachment slots
  split from: [#815](https://github.com/pyrycode/pyrycode-desktop/issues/815) (shipped, § The attachment
  file row), [#816](https://github.com/pyrycode/pyrycode-desktop/issues/816) (shipped, the row's download
  action, covered above), and [#868](https://github.com/pyrycode/pyrycode-desktop/issues/868) (the image
  thumbnail, same slot) — instances of the same `Message` component whose bubble the parent overview
  restyles. #868 itself split further into [#1044](attachment-image-source.md) (shipped, the
  bytes-to-URL path) and [#1045](#the-attachment-image-thumbnail-1045) (shipped, this document's section,
  which also covers #869 — the thumbnail's own open-in-viewer click).
- [#1045 architecture spec](../../specs/architecture/1045-image-attachment-thumbnail.md) — the image
  thumbnail's full design, the operator's 2026-08-22 sizing ruling, and the security review covering the
  CSP widening and the attacker-chosen-bytes-reach-a-decoder threat model.
- [Attachment image source](attachment-image-source.md) — the bytes-to-`blob:`-URL path #1045 consumes,
  the release-handle/refcounting contract `BubbleAttachmentImage` honours, the CSP-widening argument
  § The attachment image thumbnail carries out, and the fetch-then-act shape #869 turned out not to need.
- [#1028](https://github.com/pyrycode/pyrycode-desktop/issues/1028) / [#1039](https://github.com/pyrycode/pyrycode-desktop/issues/1039) —
  the record a sent message's attachments carry on its timeline item, which #815 reads and without which
  it has no name to draw.
