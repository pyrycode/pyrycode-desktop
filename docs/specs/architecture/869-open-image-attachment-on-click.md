# #869 — the drawn thumbnail becomes the control that opens the picture

The thumbnail #1045 draws in the message bubble becomes a `<button>` whose activation sends that
attachment's identifier to #867's open channel. Two production files, no new module, no new export.

## Files read

| Path | Symbols that matter | Why it matters |
|---|---|---|
| `src/renderer/src/screens/conversation/BubbleAttachmentImage.tsx` | `AttachmentThumbnail`, `BubbleAttachmentImage`, `ATTACHMENT_IMAGE_ALT`, `AttachmentThumbnailState` | The file this slice edits. The pure/container split, and `onDecodeError` as the precedent for how a handler reaches the pure half. |
| `src/renderer/src/screens/conversation/BubbleAttachmentImage.test.tsx` | the four `AttachmentThumbnail` renders + the one container render | Every call site a new required prop touches, and the tier that owns the structural half of AC1. |
| `src/renderer/src/screens/conversation/conversation.css` | `.bubble`, `.bubble__image`, `.bubble__file`, `.bubble__file:focus-visible` | `.bubble__file` is the shipped precedent for an attachment slot as a control; `.bubble` is deliberately not a flex column, so rhythm is a `margin-top` on the following sibling. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx` | `BubbleAttachmentRow`, the `BubbleAttachmentImage` mount | The `<button type="button" className="bubble__file" onClick={…}>` shape this slice mirrors, and the mount that needs no edit. |
| `src/preload/index.ts` | `openAttachment`, `onAttachmentOpenEvent` | The shipped pair. Its header names this ticket as the caller it is waiting for. |
| `src/shared/ipc/attachmentOpen.ts` | `AttachmentOpenRequest`, `isAttachmentOpenRequest`, `AttachmentOpenFailure`, `AttachmentOpenEvent` | One field on the ask; four failure reasons this slice presents none of. |
| `src/main/attachmentOpen.ts` | `createAttachmentOpen`, `derivedPath`, `ATTACHMENT_OPEN_DIR_NAME` | Where the identifier is resolved and what the OS is actually handed — `<userData>/attachment-views/<id><suffix>` — which is what the e2e assertion reads. |
| `src/main/index.ts` | the `createAttachmentOpen` wiring, `open: async (path) => (await shell.openPath(path)).length === 0` | `shell.openPath` is read at call time on the property, which is what makes the e2e recorder possible with no production seam. |
| `src/renderer/src/screens/conversation/attachmentImageSource.ts` | `attachmentImageSources`, `AttachmentImageSourceFailure` | Its header names this ticket as the second instance that *could* lift a shared fetch-then-act shape. It is not lifted — see § Context. |
| `src/renderer/src/screens/conversation/downloadAttachment.ts` | `downloadAttachment`, `attachmentDownloadDeps` | The `window.pyry` dereference-inside-the-arrow-body idiom, and the fetch-then-act trap that does not apply here. |
| `e2e/attachment-image-thumbnail.spec.ts` | the whole spec | The working pattern: canonical attachment ids, `serveAttachmentFrame`, drive-the-fetch-to-completion, and the recorded warning against `bubbleTextExactly`. |
| `e2e/assistant-link-opens-externally.spec.ts` | the `app.evaluate` + `Object.defineProperty` recorder | The shipped answer to "must not open an application on whoever runs the suite" — it records rather than suppresses. |
| `e2e/thread-scroll-pin.spec.ts` | `THUMBNAIL_GROWTH_PX`, `resolveThumbnail` | A cross-spec reader of the thumbnail's 160 + 12 geometry. Its comment attributes the 12 to `.bubble__image`'s own `margin-top`; this slice moves that declaration, and the measured sum is unchanged. |
| `docs/knowledge/features/attachment-open.md` | § Composition-root wiring, § Error handling | Records that no caller is wired yet and that this ticket is it. |
| `docs/knowledge/features/attachment-image-source.md` | § the fetch-then-act shape | The second half of the "one ask is sufficient" chain. |

**Codegraph was not used: every `mcp__codegraph__*` call in this repo fails with `CodeGraph not
initialized`.** Grep and Read produced the list above.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=120-3848

A user bubble on the navy fill: one line of message text, then the picture at a 6px radius filling the
bubble's content width rhythm, then the meta row (timestamp + copy glyph). The node is the same `Slot`
(`I132:4567;132:4465`) #1045 built the thumbnail from, and it shows **no hover, focus or pressed
treatment** for the picture. This slice therefore adds exactly one thing the drawing does not show —
the focus affordance `.bubble__file:focus-visible` already uses in this same bubble, which AC3 names —
and invents nothing else. `.bubble__file:hover`'s answer (brighten the ink one step up the tonal ramp)
has no meaning on a picture and does not carry over.

## Context

#1045 draws the picture; #867 ships the channel that hands a file to the OS viewer; #1044 ships the
retrieval → bytes → blob-URL path that makes the picture appear at all. Nothing joins them, so a 160px
preview is currently the only way to look at an image attachment. This slice makes the drawn picture
the control.

**The fetch-then-act shape is deliberately not lifted.** `downloadAttachment.ts`'s header names this
ticket as a candidate second instance, and `attachmentImageSource.ts`'s header says #869 could
generalise from two. Neither applies: a picture only reaches `ready` after `attachmentImageSources`
drove the retrieval leg to `completed`, and that leg is the sole writer of the app-private attachment
directory `src/main/attachmentOpen.ts` reads. So the drawn picture is itself the proof that the file is
on this machine, and the click is **one ask with no sequencing** — no second listener, no new module.
This inverts #816's situation rather than repeating it: the file row is drawn *before* any fetch, so a
click wired straight to the save channel would have answered `source-unavailable` forever.

**No ADR is owed.** Every ruling this slice leans on is already recorded — the closed drawable set, the
closed signature set, the no-attribute-sink posture, the derived-copy hand-off.

### The drawable set and the openable set disagree, and this slice does not reconcile them

Two closed sets decide independently, one per process:

| | Decides | Members |
|---|---|---|
| `DRAWABLE_IMAGE_EXTENSIONS` (`attachmentIsImage.ts`), matched on `filename` | what is drawn as a picture | `png` `jpg` `jpeg` `gif` `webp` **`avif`** **`bmp`** |
| `ImageSuffix` / `SIGNATURES` (`imageSignature.ts`), matched on leading bytes | what may be handed to the OS | `.png` `.jpg` `.gif` `.webp` |

So an `.avif` or `.bmp` attachment draws as a picture (Chromium decodes both) and its click answers
`unsupported-type`, which this slice draws nothing for: **a silently dead control on two admitted
formats.** The gap is not closed here — widening `SIGNATURES` and narrowing
`DRAWABLE_IMAGE_EXTENSIONS` are each a change to a security-argued closed set with its own reasoning to
redo. Recorded here and owed to the package overview so the next reader meets it as a known fact; the
operator decides whether it wants a ticket.

## Design

### `AttachmentThumbnail` — one new prop, one new element

The pure component gains a **required** `onOpen: () => void`, the shape and the rationale
`onDecodeError` already carries: a prop rather than a field on `AttachmentThumbnailState`, so the union
stays a plain description of what is drawn; required rather than optional, so the production path
cannot forget it and the only omitter would be the static tier that drops handlers anyway.

```ts
function AttachmentThumbnail(props: {
  state: AttachmentThumbnailState
  filename: string
  onDecodeError: () => void
  onOpen: () => void
}): JSX.Element | null
```

Only the `ready` arm changes: the existing `<img className="bubble__image">` is wrapped in
`<button type="button" className="bubble__image-button" onClick={onOpen}>`, unchanged in every other
respect (same `src`, same `alt`, same class, same `onError`).

- **A real `<button>`, not `role="button"`.** Click, Enter and Space all come from the platform
  element. **No `keydown` handler is written**, which is what keeps AC1 from costing hand-rolled key
  handling.
- **The accessible name is the existing `ATTACHMENT_IMAGE_ALT` constant**, computed from the wrapped
  `<img>`'s `alt`. No `aria-label`, no `title`, no `filename`: #815 closed that attribute sink on
  purpose and this slice does not reopen it. No new constant is minted — a second name would be a
  second thing to keep in step.
- **`pending` and `failed` are untouched.** `pending` still returns `null` — nothing drawn, nothing
  reserved, so there is nothing to focus or press. `failed` still draws the textual fallback with no
  control, no tab stop and no handler: what a reader would want there is a re-fetch, which is #1044's
  leg rather than #867's.

### `BubbleAttachmentImage` — one ask, no listener

The container passes
`onOpen={() => window.pyry.openAttachment({ attachmentId: attachment.attachmentId })}`. The bridge is
dereferenced **inside the arrow body** (`attachmentDownloadDeps`' idiom), so neither module load nor a
static render touches `window.pyry` — which is what keeps the existing container test, which renders
with no bridge present, green.

- **The identifier and nothing else.** `AttachmentOpenRequest` has one field. Nothing here joins,
  builds or forwards a path, and no file name reaches a URL or an attribute. The blob URL the `ready`
  state holds takes no part in the ask — it is a capability handle to bytes in this origin, and the
  open channel addresses the file by identifier.
- **No conversation id is read and no store is consulted**, unlike the retrieval leg — there is
  nothing else on the ask to fill.
- **`onAttachmentOpenEvent` is not subscribed.** Four failure reasons exist and this slice presents
  none of them: there is no designed feedback (see § Open questions), so the outcome has no consumer.
  Adding a listener with nothing to do with what it hears would be machinery for an unbuilt state. The
  driver already records each terminal at its own boundary, so nothing is lost.
- **No pending, disabled or in-flight state**, `downloadAttachment`'s posture verbatim: the drawing has
  none, so "the control stays activatable" is true by construction rather than by a flag nothing
  resets.

### `.bubble__image-button` — the box the focus ring traces

A new rule beside `.bubble__image`, taking `.bubble__file`'s UA reset (`padding: 0; border: none;
background: transparent; cursor: pointer`) but **not** its `width: 100%`, which is the failure AC3
exists to catch — a full-bubble band ringing a 160px-tall picture.

- `display: block` with `width: fit-content` and `max-width: 100%`: block-level so the button does not
  sit on a text baseline (an inline-block would add descender space below the picture and shift the
  12px rhythm the thread already measures), `fit-content` so the box shrink-wraps the drawn picture
  rather than filling the bubble.
- `margin-top: var(--space-3)` **moves from `.bubble__image` onto the button.** `.bubble` is
  deliberately not a flex column, so the 12px rhythm is a margin on the following sibling — and the
  following sibling is now the button. Left on the image, the margin would sit *inside* the button
  (a button's contents are their own formatting context, so the margin does not collapse out) and the
  focus ring would carry a 12px band above the picture. The total a resolving thumbnail adds to the
  thread is unchanged at 160 + 12, which is what `thread-scroll-pin.spec.ts`'s `THUMBNAIL_GROWTH_PX`
  floor measures.
- `border-radius: var(--radius-xs)` so the ring follows the picture's own rounded corners; the image
  keeps its own radius.
- `.bubble__image-button:focus-visible { outline: 1px solid var(--color-outline) }` — the exact
  declaration `.bubble__file:focus-visible` uses. **No `:hover` rule**: brightening ink means nothing
  on a picture, and any other hover treatment would be an invention the drawing does not authorise.

## State + concurrency model

None added. No store slice, no async task, no stream, no subscription, and therefore no teardown to
own — the ask is fire-and-forget and the outcome is not listened for. The one piece of state in this
file, `BubbleAttachmentImage`'s `useState`, and the one effect are untouched. Repeated activation is
safe by construction: each click is an independent `send`, and the main-side driver's `COPYFILE_EXCL`
makes concurrent opens of one attachment reuse the winner's derived file rather than tear it.

## Error handling

The window presents no failure for this leg, deliberately. `refused`, `unavailable`,
`unsupported-type` and `open-failed` all resolve main-side and are logged at their own boundary; none
is drawn, and none is logged a second time here. `unavailable` is off the routine path — a drawn
picture proves the file is on this machine — and `unsupported-type` is reachable on `.avif`/`.bmp`,
which is the gap recorded above.

The one renderer-side failure that already exists is unchanged: bytes that do not decode raise `error`
on the `<img>`, the state moves to `failed`, and the button unmounts with the picture it wrapped.

## Testing strategy

**Renderer tier (`BubbleAttachmentImage.test.tsx`, `renderToStaticMarkup` under `environment: 'node'`)
— structure only, since static renders drop every handler:**

- the `ready` arm renders exactly one `<button type="button" class="bubble__image-button">` and the
  `<img>` is inside it;
- the button carries no `aria-label`, no `title` and no `filename` — the accessible name is the `alt`
  constant, asserted as before;
- `pending` still renders the empty string — no button, no reserved box;
- `failed` renders no `<button>` and no `bubble__image-button` at all;
- the four existing renders gain the new required prop; a shared no-op fixture beside
  `NO_DECODE_ERROR`.

**Browser tier (`e2e/attachment-image-open.spec.ts`, new) — AC1's activation half, AC2, AC3's geometry
and all of AC4.** `attachment-image-thumbnail.spec.ts`'s fixture shape: canonical attachment ids
(`/^[0-9a-f-]{1,64}$/`, load-bearing at the store write), a real upload → send → `request_attachment` →
single `attachment_chunk` round trip with a computed SHA-256, driven to completion so real bytes reach
the `<img>`.

- **`shell.openPath` is replaced with a recorder in the main process** via `app.evaluate` plus
  `Object.defineProperty`, `assistant-link-opens-externally.spec.ts`'s idiom — it **records rather than
  suppresses**, so what is asserted is the path the app actually handed over, and no image viewer opens
  on whoever runs the suite. The stub is installed **before the first activation**; it returns `''`,
  which is `shell.openPath`'s success value.
- click, then keyboard: reach the button by `Shift+Tab` from the composer (a bounded walk that proves
  the tab stop is real), assert the computed `outline` while it holds keyboard focus (AC3's affordance
  half, and `:focus-visible` genuinely matches only on a keyboard-driven focus), then `Enter`, then
  `Space`.
- each activation records **exactly one** hand-off, and each recorded path is that attachment's derived
  copy — under `attachment-views`, named `<attachmentId>.png`.
- AC3's geometry half: the button's box equals the drawn picture's box on both axes, which is the
  detector for a `width: 100%` band; and the rhythm above and below the picture is still 12px.
- AC1's negative half: a bubble whose thumbnail failed has no `.bubble__image-button` at all.

No sweep debt is incurred: a `<button>` wrapping the existing `<img>` adds **no text-bearing element**,
so no `toHaveText`/`textContent` site in either tier can shift. Both greps are run across `e2e/` with
no tier filter as a check before the markup changes.

## Open questions

1. **A failed open still has no designed feedback**, and this slice still does not invent one — the
   Figma has no error state and the success signal is the OS viewer appearing. Carried forward from
   #867 and #816 unchanged, except that `unsupported-type` has moved *onto* the routine path
   (`.avif`/`.bmp` draw and cannot open), which may make the failure state worth a ticket sooner than
   the download row did. Resolution: unchanged by implementation; no listener is wired.
2. **Does `width: fit-content` on the button shrink-wrap a replaced child whose width comes from
   `max-height`?** The tall 200×400 case draws 80×160 because `max-height: 160px` binds, and the
   button's intrinsic width must follow the *used* width rather than the 200px intrinsic one, or the
   ring is 120px too wide. This is measured in the browser tier rather than reasoned about; if
   Chromium disagrees, the fallback is to move the two `max-*` declarations onto the button and let the
   image fill it. Resolution to be recorded in `## Revisions` if the fallback is taken.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new boundary, and the existing one is unmoved. The single untrusted→trusted
  crossing is `ATTACHMENT_OPEN_CHANNEL`, guarded by `isAttachmentOpenRequest` (shape, length) in the
  main receiver and then by `resolveAttachmentPath` (canonicity, before any filesystem call). This
  slice adds a *caller* on the untrusted side only; it adds no validation, which is correct — a second
  renderer-side check on the identifier would be the divergent-checks shape both modules' headers
  argue against, and a renderer-side check is worthless against a compromised renderer anyway. The
  value sent is `attachment.attachmentId` off the timeline store — daemon-supplied and therefore
  untrusted — and it is treated as untrusted the whole way: main re-checks it regardless of who sent
  it.
- **[Tokens, secrets, credentials]** Not applicable, and concretely so: this slice touches no
  credential, mints no identifier, and reads no storage. `safeStorage`, the device token and the Noise
  static key are nowhere in the reachable graph from `AttachmentThumbnail`.
- **[File / storage operations]** No path is built, joined, resolved or forwarded on the renderer side
  — the whole reason `AttachmentOpenRequest` carries one field. Path traversal is therefore not
  expressible from here: `../..` in an identifier reaches `resolveAttachmentPath` and is refused
  before any filesystem call, which `src/main/attachmentOpen.test.ts` already pins. TOCTOU is
  unchanged and main-side (open-then-read on a descriptor). The derived copy stays under
  `app.getPath('userData')/attachment-views`.
- **[Inter-process / Electron attack surface]** No new IPC channel, no new `contextBridge` member, no
  widening of an existing one — the ask this slice sends is the shape `openAttachment` has shipped
  with, and `ATTACHMENT_OPEN_CHANNEL` stays fixed inside the preload so the renderer still cannot
  address an arbitrary channel. `setWindowOpenHandler`'s `file:` and custom-protocol denies are
  untouched, which is exactly why this channel exists. **One scenario worth naming: a renderer
  compromise can now call `openAttachment` from a click handler it controls — but it could already
  call `window.pyry.openAttachment` directly, so the reachable capability is unchanged by this slice.**
  What bounds it is main-side and unchanged: an identifier that does not resolve inside
  `attachmentDir` is refused, and a file whose leading bytes match no member of the closed
  `ImageSuffix` set is refused rather than opened — so no attacker-chosen extension, and in particular
  no `.command`/`.desktop`/`.app`, is spellable.
- **[Cryptographic primitives]** Not applicable — no randomness, no comparison against a secret, no
  key material and no handshake code is reachable from either changed file. The e2e fixture's SHA-256
  is `createHash('sha256')` over invented bytes, matching the sibling spec.
- **[Network & I/O]** No socket, no frame, no timeout and no relay interaction. The one new e2e
  fixture serves a frame the sibling spec's `serveAttachmentFrame` already shapes and dials nothing.
- **[Error messages, logs, telemetry]** Nothing is logged by this slice, and that is the finding rather
  than an omission: the four failure reasons are recorded main-side at their own boundary, and a
  second line here would duplicate the record. Nothing daemon-supplied reaches a log, an attribute, a
  URL or a cache key — the filename does not enter the `ready` arm's markup at all, and the blob URL
  still reaches exactly one place, the `<img>`'s `src`. The e2e spec asserts on a recorded path, which
  is the app's own derived path under a throwaway `--user-data-dir` and carries no secret and no
  daemon text (the derived name is the identifier plus a suffix from the closed set).
- **[Concurrency]** No async work is launched, so nothing is owed a cancellation path. The ask is
  fire-and-forget with no listener, so no subscription can leak across a remount and no handler can
  double-fire. Repeated activation is safe main-side (`COPYFILE_EXCL`). Unmount teardown is unchanged:
  the one effect still returns `attachmentImageSources`' release handle.
- **[Threat model alignment]** *Hostile daemon response* is the live one: `filename` and
  `attachmentId` are both daemon-chosen. `filename` decides only what is *drawn* and never what is
  fetched or opened — it does not enter this slice's markup at all — and `attachmentId` is refused
  main-side unless canonical. *Malicious relay* is unaffected (nothing new crosses the wire).
  *Renderer compromise reaching the transport* is addressed above. **OUT OF SCOPE, named:** the
  drawable/openable set disagreement (`.avif`, `.bmp` draw and answer `unsupported-type`) — a dead
  control rather than a vulnerability, deferred to the operator's decision per § Context, and the
  reason the failure state may be worth a ticket.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-04
