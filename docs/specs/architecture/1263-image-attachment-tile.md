# #1263 — the picture in an image attachment tile

## Files read

- `src/renderer/src/screens/conversation/ComposerAttach.tsx` → `ComposerAttachmentStrip` — the one call site this
  slice branches, and its recorded reasons for `null`-on-empty and for the array-index key; `reducePendingAttachments`
  — where `attachmentId` comes from (`event.uploadId`, the id `driveUpload` sent as `attachment_id`, so the host has
  it); `mirrorTakeToDisplay` — the drain and its `rollback`, which is the one lifecycle this slice adds tiles to.
- `src/renderer/src/screens/conversation/BubbleAttachmentImage.tsx` → `AttachmentThumbnailState`,
  `AttachmentThumbnail`, `BubbleAttachmentImage`, `ATTACHMENT_IMAGE_ALT` — the pure-view / container split this
  module copies, the state union it reuses, and the client-owned `alt` AC3 names.
- `src/renderer/src/screens/conversation/attachmentImageSource.ts` → `attachmentImageSources`, `request`,
  `takeShare`, `addressable`, `toBlob` — the singleton consumed here: its release-handle contract (returned on every
  branch before any terminal), its refcount, and its recorded ruling that `img-src` is the ONLY policy that may widen.
- `src/renderer/src/screens/conversation/attachmentIsImage.ts` → `isImageAttachmentName` — the branch predicate, and
  its standing rule that the name decides what is DRAWN, never what is fetched or from where.
- `src/renderer/src/screens/conversation/AttachmentFileIcon.tsx` → `AttachmentFileIcon` — the fallback drawing and
  why it takes three class props rather than wearing a shared class.
- `src/renderer/src/screens/conversation/conversation.css` → `.composer__attachment`, `-glyph`, `-ext` — the shipped
  45×60 frame, its `overflow: hidden` + `--radius-xs` clip (whose own comment says this ticket's picture is what it
  is for), and `.bubble__image`, which this tile must NOT copy: that rule is `max-*` against an unbounded box.
- `src/renderer/src/screens/conversation/ComposerAttach.test.tsx` § "ComposerAttachmentStrip" → `tileCount`, and the
  shipped `tile('shot.png')` assertion that an image name draws the file tile — the one assertion this slice
  deliberately re-aims, plus the hostile-name test whose posture the image arm has to inherit.
- `e2e/attachment-image-thumbnail.spec.ts` → `serveAttachmentFrame`, `buildReplyFrames`, `SERVED`, the canonical
  id shape (`/^[0-9a-f-]{1,64}$/`, gating the store write) and the computed SHA-256 — the pattern the new spec follows.
- `e2e/composer-attach.spec.ts` → its `tiles` locator and the `.pdf`/`.zip` names it pushes; nothing there is an
  image name, so that 385-line continuous drive is untouched by this branch.
- `e2e/real-claude-attachment.spec.ts` → `IMAGE_FILENAME` (`attached-swatch.png`) and the
  `toHaveText(attachmentExtensionLabel(...))` assertion on `tiles.first()`, which this slice BREAKS and replaces
  with AC4 itself.
- `docs/knowledge/features/composer-attach.md` § "Three pure views, a shared drawing, and a container hook" — the
  mount map the strip sits in; § the whole-attribute-run hazard, which decides the new class name.
- `docs/knowledge/features/attachment-bytes.md` — the sole-writer rule for the app-private attachment directory,
  which is why this slice fetches rather than retaining the picked file.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=134-5013 — `Input attachment`
`390:7199` (the image variant), `Slot` `390:7182`, `Input attachment image` `390:7159`.

A 45×60 slot, `overflow-clip` at a 6px radius, filled edge to edge by one picture. Read off the node boxes rather
than inferred: `390:7159` holds a **60×60** rectangle at x=-7.5 inside the 45-wide slot — a square picture
overflowing 7.5px each side and clipped — and the generated snippet draws it as `absolute inset-0 size-full
object-cover`. So `cover` is drawn, not guessed. The 20×20 `circle-xmark` badge at the tile's top-right is #1264's
remove control and is not drawn here.

## Context

#1262 shipped the strip: `ComposerAttachmentStrip` draws a 45×60 tile per completed upload, and every tile is
`AttachmentFileIcon` — an outlined document with an extension label. A pasted screenshot therefore reads "PNG",
which is the whole of the gap #891 raised. This slice makes an image-named attachment draw the picture instead.

Three things fall out that the plan has to answer rather than assume. The bytes are **not on this machine** — the
upload leg streams the picked file and retains nothing, and the app-private attachment directory has one writer
(the retrieval leg), so the picture the operator has just attached must come back from the host before an `<img>`
can point at it. The tile therefore has a **state**, where #1262's had none. And the strip's tile is a fixed box,
so the in-flight arm can draw a frame where the bubble's `pending` arm deliberately draws nothing.

No ADR is warranted: no new state ownership rule, no new boundary, no new channel, no new dependency.

## Design

### 1. The module — `ComposerAttachmentImage.tsx`

New, at `src/renderer/src/screens/conversation/ComposerAttachmentImage.tsx`, beside `BubbleAttachmentImage.tsx` and
split the same way, for that module's recorded reason: the renderer tier is `renderToStaticMarkup` under
`environment: 'node'`, so a state reachable only from a `useEffect` is provable nowhere.

```ts
function ComposerAttachmentTile(props: {
  state: AttachmentThumbnailState
  filename: string
  onDecodeError: () => void
}): JSX.Element                                   // pure — no hooks, every arm a static render

function ComposerAttachmentImage(props: { attachment: MessageAttachment }): JSX.Element
```

**`AttachmentThumbnailState` is REUSED, not re-declared.** It is the same closed set for the same reason — bytes
absent, bytes here, ask ended without a drawable picture — and its docblock's argument (the `failed` arm carries no
reason, so there is no reason IN SCOPE for a later edit to interpolate) holds verbatim here and matters more: this
tile's failure arm draws a file icon, which has no text node at all. The import edge to that module already exists
because AC3 requires `ATTACHMENT_IMAGE_ALT` from it. The name says "thumbnail" where this is a tile; a rename would
cascade through `BubbleAttachmentImage.test.tsx` for nothing and is declined.

**The three arms, and where each departs from the bubble's:**

- `pending` → `<span className="composer__attachment" />`. **The frame is drawn and empty.** This is the deliberate
  departure the ticket names: `AttachmentThumbnail`'s `pending` draws nothing because reserving a box would need the
  picture's aspect ratio, and here the box is 45×60 whatever the picture turns out to be. No spinner, no fill. AC2's
  "no tile shifts under the operator" is then true by construction rather than by timing, because all three arms
  wear the same frame class and therefore the same fixed box.
- `ready` → the same frame span holding one `<img className="composer__attachment-image" src={state.url}`
  `alt={ATTACHMENT_IMAGE_ALT} onError={onDecodeError} />`. **No `<button>` wrapper and no `onOpen`**, which is the
  second departure: #869 gave the bubble's picture a control, and clicking a composer tile to open the file is not
  planned. The tile gains no tab stop, no handler and no accessible control in this slice; #1264 brings the one
  control it will have. No `width`/`height` attribute either — the box is the frame's, and an intrinsic-size
  attribute would fight it.
- `failed` → `AttachmentFileIcon` with the strip's three class names, **directly**, not nested inside a second
  frame: the image tile and the file tile are alternative drawings of the same `.composer__attachment` frame.

**The URL reaches exactly one place** — that `src`. It is a capability handle to the file's bytes within this
origin, so it goes in no log line, no second attribute, no cache key and no lookup path.

`onDecodeError` is a required prop rather than a field on the `ready` state, `AttachmentThumbnail`'s ruling carried
across: the union stays a plain description of what is drawn. It cannot loop — moving off `ready` unmounts the very
`<img>` that raised it.

### 2. The container's one effect

`ComposerAttachmentImage` owns one `useState` and one `useEffect`, and the effect body is
`BubbleAttachmentImage`'s: `return attachmentImageSources.request(attachment.attachmentId, onOutcome)`, keyed
`[attachment.attachmentId]`. The **singleton is consumed, never reconstructed** — a second instance would mint a URL
per mount and revoke none of the others, and would revoke one the bubble's thumbnails are still showing. The release
handle is the cleanup, returned directly, which the contract licenses by handing it back on every branch before any
terminal. The failure reason is dropped rather than carried into state, and nothing is logged here:
`attachmentImageSource.ts` already records each terminal at its own boundary.

### 3. The strip's branch — the only edit to `ComposerAttach.tsx`

Inside `ComposerAttachmentStrip`'s existing `map`, `isImageAttachmentName(attachment.filename)` picks
`ComposerAttachmentImage` over `AttachmentFileIcon`. Nothing else in that component changes: the `null`-on-empty
ruling, the array-index key and the three class names all stand. The predicate is the message bubble's own rule over
the same untrusted string — an exact whole-extension comparison, deliberately not `attachmentExtensionLabel`.

### 4. One CSS rule

`.composer__attachment-image` — `display: block`, `width: 100%`, `height: 100%`, `object-fit: cover`. That is all of
it. **The clip and the radius are the frame's**, already shipped with `overflow: hidden` + `--radius-xs`, so the
image restates neither (`.bubble__image` restates its radius only because it has no clipping parent). `centred` needs
no declaration: `object-position` defaults to `50% 50%`, which is the criterion, and a redundant restatement would be
a second place for it to drift. The class name shares no **whole** class token with `.composer__attachment`,
`-glyph` or `-ext` — a class selector does not prefix-match, and `ComposerAttach.test.tsx`'s `tileCount` regex
matches `class="composer__attachment"` including its closing quote, so neither the shipped e2e locator nor the
shipped count assertion can reach this element.

## State + concurrency model

State is one `useState` per image tile, private to the tile, holding `AttachmentThumbnailState`. No store slice is
added and no store is read here; `attachmentImageSources` reads the open conversation itself, from the same
`activeConversationStore` expression the composer's send uses.

Teardown is the release handle, called on unmount and on an `attachmentId` change. **Releasing is load-bearing, not
hygiene** — URLs are refcounted and the last release is what revokes, so a tile that never released would hold the
file's bytes for the window's lifetime.

Two lifecycles are new here and neither exists for the bubble:

- **Drain on send.** `mirrorTakeToDisplay` clears the displayed set, every tile unmounts, every release runs, and
  the last one revokes. A **rolled-back** send (the bridge threw) restores the set, the tiles remount, and each
  re-fetches from scratch — one more round trip, and the tile blinks back to its empty frame. That is correct rather
  than merely tolerable: no leak, no stale URL, no double-revoke, because `release` is idempotent and the map entry
  is recorded before `onOutcome` runs. It is also the honest cost of not retaining the picked file locally.
- **Strict-mode double invoke.** `React.StrictMode` runs request → release → request. The second ask finds the
  retrieval already in flight main-side and is a no-op, and the second mount still settles, because main answers on
  a channel broadcast every listener receives and filters by attachment id — `BubbleAttachmentImage`'s recorded
  behaviour, unchanged.

No renderer-side queue and no main-side cap is touched. Both legs cap at 4 concurrent, so a fifth pending image tile
meets `busy`, which arrives as an ordinary terminal and draws the file tile.

## Error handling

Every way an ask can end without a drawable picture collapses to one drawn state, the file tile, and it carries no
reason at all:

- The retrieval leg fails (`refused`, `not-found`, `busy`, `not-connected`, …) → `failed` → file tile.
- The bytes leg fails (`unavailable`, `busy`, …) → `failed` → file tile.
- Bytes arrive and do not decode, because the name lied → `<img>` raises `error` → `failed` → file tile.
- The host never answers → the tile stays `pending`, an empty frame, for the composer's lifetime. **Inherited, not
  introduced**: `awaitTerminal` has no deadline and the bubble behaves identically. Named under Security review §6.

There is never a broken-image icon, because the element that would draw one is unmounted by the same transition.
The reason is dropped at the container, so it reaches neither the DOM nor a log — and structurally could not, since
the fallback drawing has no text node of its own.

## Testing strategy

**Static renderer tier** (`ComposerAttachmentImage.test.tsx`, new) — the markup of each state, as scenarios:

- `pending` renders exactly the empty frame: the `composer__attachment` run is present, and there is no `<img>`, no
  `<svg>` and no text. Asserted as an equality on the whole string, so a placeholder element of any kind fails it.
- `ready` renders exactly one `<img>` pointed at the URL, classed `composer__attachment-image`, named by
  `ATTACHMENT_IMAGE_ALT` and by nothing else, inside the same frame run.
- `failed` renders the file tile in the strip's three classes — the same markup `AttachmentFileIcon` produces — and
  no `<img>` at all.
- All three wear the same `composer__attachment` frame run exactly once, which is AC2's "the tile count never
  changes" at the level a static render can own it.
- A hostile filename (the shipped `../../etc/passwd"><img src=x onerror=alert(1)>.pdf` shape, given an image
  extension) reaches no attribute in any of the three arms: no `title=`, no `aria-label`, and in `pending`/`ready`
  no `alt` but the constant. This is AC3's second sentence.
- The container renders its `pending` arm under a static render, which is the one arm this tier can reach through it.

**Static renderer tier** (`ComposerAttach.test.tsx`, edited) — the branch: an image name draws the image tile's
frame and a non-image name draws the file tile, in one mixed set that pins the order. The shipped `tile('shot.png')`
assertion, which asserts an image name draws `>PNG</span>`, is **re-aimed rather than deleted** — #1262's own
comment marks it as the case this ticket replaces.

**Fake-transport Playwright tier** (`e2e/composer-attachment-image.spec.ts`, new) — the geometry, the load and the
transitions, none of which a static render can reach. Following `attachment-image-thumbnail.spec.ts`: canonical hex
attachment ids, a `buildReplyFrames` that answers `request_attachment` with one whole-file `attachment_chunk` whose
SHA-256 is computed, and completions pushed on `ATTACHMENT_UPLOAD_EVENT_CHANNEL` so no native picker opens. It is a
**separate spec file** rather than an addition to `composer-attach.spec.ts`, because that file is one continuous
drive launched with the default `buildReplyFrames` and serving attachment bytes would change the daemon under all of
it. Four tiles are pushed, in this order, and the order is the proof:

- An image name whose id the fake daemon serves **nothing** for → permanently `pending`. Its neighbour's left edge
  then sits at 57px (45 + the 12px gap) instead of 0, which is a **deterministic detector for AC2's first half**: had
  the in-flight arm drawn nothing, the neighbour would start at 0 and shift when a picture arrived.
- A non-image name → the file tile, with its label.
- An image name served an 800×100 PNG → the picture. `objectFit` computes to `cover`, the `<img>`'s laid-out box is
  exactly 45×60 while its natural ratio is 8, and `naturalWidth > 0` (which is also the CSP detector — a refused
  source never decodes and reads 0). Cover is separated from `fill` by the computed value and from letterboxing by
  the box filling the frame in both axes.
- An image name served ASCII → `<img>` raises `error` → the file tile draws in its place, and no `<img>` remains.

Tile count is read as 4 throughout, and every tile's box is 45×60. #868's rule applies to any rounded delta compared
with `toBe(0)`: normalise `-0` first.

**Real-claude tier** (`e2e/real-claude-attachment.spec.ts`, edited) — AC4, and this edit is **forced rather than
optional**: that spec attaches `attached-swatch.png` to a conversation with no messages and asserts
`tiles.first()` has the text `PNG`, which this slice makes false. It becomes the criterion itself — the tile
resolves to a drawn `<img>` with `naturalWidth > 0`, proving the real host answers `request_attachment` for an
attachment no message references yet. The fake tier answers that request itself and therefore cannot prove it; only
the operator's `npm run e2e:real:gate` run can, which is why the ticket carries `needs-real-claude` and why the PR
says so.

## Open questions

1. **Does the real host answer `request_attachment` for an attachment no message references?** The ticket's own
   named unknown. Nothing this pipeline runs can settle it — resolved, if at all, by the operator's real-claude
   gate, and recorded in the PR either way.
2. **Is one round trip per image tile fast enough in daily use?** Unmeasured. If not, retaining the picked file
   locally is its own ticket, and it would have to answer `attachment-bytes.md`'s sole-writer rule first.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST FIX — the two untrusted inputs are named and each has one sink. `filename` arrives
  over `ipcRenderer.on`, where the declared type is the compile-time half only; it reaches `isImageAttachmentName`
  (a read, no sink) and, in the `failed` arm only, `AttachmentFileIcon`, which reduces it to at most four
  `[A-Za-z0-9]` characters as escaped React children. It reaches **no attribute in any arm** — the `alt` is the
  client-owned `ATTACHMENT_IMAGE_ALT`, which is the ruling #815 made when it declined an `aria-label`. The bytes are
  host-chosen and reach `URL.createObjectURL` inside the shipped module and then one `<img> src`. Both closures are
  asserted, not assumed: the hostile-name scenario above is the detector for the first.
- **[Trust boundaries]** No MUST FIX, but stated because it is new in this component — an untrusted name now decides
  whether a **fetch happens at all** in the composer, where in the bubble every drawn attachment was already recorded
  on a timeline item. It decides only *whether*, never *what*: the request payload is `{ conversationId,
  attachmentId }`, built inside `attachmentImageSources` from this window's own values (`attachmentId` is the
  `uploadId` main minted and `driveUpload` sent as `attachment_id`), and the name takes no part in it. A name that
  lies produces a picture that fails to decode — never a different file, a path, or a different request. Nothing in
  this slice may construct that payload itself.
- **[Tokens, secrets, credentials]** No findings — no credential is read, written or logged. The one secret-adjacent
  value is the `blob:` URL, a capability handle to the file's bytes within this origin; it reaches exactly one `src`
  and no log line, and this slice adds no logging at all (the failure reason is dropped at the container, as the
  bubble drops it, because `attachmentImageSource.ts` already records every terminal at its own boundary).
- **[File / storage operations]** No findings — no path is built, joined, resolved or forwarded, and no second
  writer of the app-private attachment directory is introduced. That is precisely why this slice pays a round trip
  rather than retaining the picked file: the sole-writer rule `attachment-bytes.md` records. Canonicity stays the
  single gate at `resolveAttachmentPath` in main, untouched. There is no save leg and nothing reaches the operator's
  filesystem.
- **[Inter-process / Electron attack surface]** No findings — no new IPC channel, no new `contextBridge` API, no new
  `ipcMain` handler. The two channels used are the shipped ones with their shipped guards
  (`isAttachmentRetrievalRequest`, `isAttachmentBytesRequest`, `MAX_RETRIEVAL_IDENTIFIER_LENGTH`), re-checked in main
  regardless of the renderer's own `addressable` precondition. **The CSP is not touched**: `img-src 'self' blob:`
  shipped with #1045 and already permits this, and `toBlob`'s recorded argument — that a typeless blob is safe
  because it only ever reaches an `<img>` — holds only while `frame-src`, `child-src`, `object-src` and `default-src`
  stay as they are. This slice widens none of them and must not.
- **[Cryptographic primitives]** Not applicable, stated as a decision rather than skipped: this slice performs no
  comparison against a secret, derives no key and consumes no randomness. The SHA-256 the retrieval leg verifies
  chunks against is main's and is untouched; the only randomness in reach is the UUID `URL.createObjectURL` mints
  inside the browser, which is not security-relevant and is not chosen here.
- **[Network & I/O]** OUT OF SCOPE, inherited — `awaitTerminal` sets **no deadline**, so a host that accepts a
  `request_attachment` and never answers leaves the tile `pending` forever. Not introduced here (the bubble has the
  identical property) and strictly less visible in its consequence: an empty 45×60 frame rather than a thumbnail
  that never appears. A per-ask deadline belongs to `attachmentImageSource.ts` and is a ticket of its own; this slice
  must not add a renderer-local timer, which would be a second, divergent lifetime rule over a shared module.
- **[Errors, logs, telemetry]** No findings — no new log line and structurally no place for one: the failure arm
  draws a file icon with no text node of its own, so no reason can be interpolated into what the operator sees. The
  host's `not-found` is its single code for every request yielding no bytes, made indistinguishable on purpose so the
  verb cannot become a path-existence oracle; collapsing every failure to one drawn state keeps that true from this
  side.
- **[Concurrency]** No MUST FIX — the effect returns the release handle unconditionally, which the module's contract
  licenses by handing it back on every branch before any terminal, and `release` is idempotent, which is what makes
  the drain/rollback unmount-remount above safe against a double decrement. No check-then-act is added: the
  mint-or-join block with no `await` in it is the shipped module's and this slice adds no suspension point. One
  resource note, accepted rather than fixed: both legs cap at 4 concurrent, so a fifth pending image tile meets
  `busy` and draws the file tile. That is a drawn outcome, not a hang or a leak; raising a cap is
  `attachmentImageSource.ts`'s own named follow-up.
- **[Threat model alignment]** OUT OF SCOPE, and worth naming because this slice is where it first bites. **The host
  is authoritative for the picture the operator sees before sending.** The upload leg retains no local copy, so a
  hostile or buggy daemon answering `request_attachment` with different bytes would draw a picture that is not the
  file about to be sent — the send names the attachment by id regardless of what drew, so the operator is misled
  about content, not about destination. This is inherent to the fetch-then-bytes design the ticket accepts
  explicitly, and its mitigation is the ticket's own named follow-up (retain the picked file locally), which must
  answer the sole-writer rule first. A malicious *image* is the other half — decoder-exploit surface — and is not
  widened here: `DRAWABLE_IMAGE_EXTENSIONS` excludes `svg` precisely so the licensing argument stays the single
  sentence "a `blob:` URL only ever reaches an `<img>` src", and this slice admits no format that set does not.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
