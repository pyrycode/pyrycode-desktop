# Conversation shell — message bubble

The later redraw of the text message bubble: from the mobile thread's clipped-corner shape to the
desktop drawing's `Message` component, plus the meta row and copy control the mobile bubble never had.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its
edge cases and its links. The bubble's original shipped shape and its `assistantText`/`userText` render
arms are narrated in [Conversation shell — conversation surfaces and
modals](conversation-shell-conversation-and-modals.md#the-interactive-flip--thread-cutover-179).

## The restyle (#969)

Every other part of the desktop chat screen's message area — the tool rows, the fenced code block, the
session-reset separator, the thumbnail, the file row — had already been redrawn from the desktop
Figma (node 102-4, drawn 2026-08-21). The bubble itself still wore the mobile thread's shape (Figma
16-22 / 16-23): three corners at `--radius-md` and one clipped to `--radius-xs`, 12/14 padding, the
mobile fills, body-medium type. `#969` redrew it as the desktop `Message` component (Figma 132:4477
assistant / 132:4508 user) and added the row it draws at the bubble's foot.

**`.bubble`** now carries one shape for both sides: `border-radius: var(--radius-xs)` on all four
corners (the two side modifiers, `.bubble--user` / `.bubble--daemon`, no longer carry a radius line at
all), `padding: var(--space-4) var(--space-5)` (16/20, replacing the mobile 12/14 — and *not* by
repurposing `--space-bubble-x`, which still reads 14px for its two other consumers,
`.tool-row__result`/`.tool-row__input-value` and `.unrecognized-row__raw`, untouched by this ticket),
and the `title-small` emphasized type below in place of body-medium. `max-width: min(680px, 75%)`
stands unchanged — the drawing's one measured width (680px in a 780px column at 1280px) is exactly what
that rule already yields, so there was no drawn constant to switch to.

**`.bubble` is deliberately not a flex column**, even though the drawing's `Message` is one with a 12px
gap. The in-progress assistant branch renders `{item.text}` and the streaming cursor `<span>` as sibling
direct children of `.bubble`; a flex column would make each its own flex item and drop the cursor onto
its own line. The drawn rhythm is instead `margin-top: var(--space-3)` on `.bubble__meta`, the only new
sibling this ticket adds and so the only place the rhythm needs to appear.

**Fills and text roles** move from the mobile pair to the desktop one: `.bubble--user` from
`--color-primary-container` / `--color-on-primary-container` text to `--color-on-primary` fill (text
role unchanged); `.bubble--daemon` from `--color-surface-container-high` / `--color-on-surface` to
`--color-on-primary-fixed` fill / `--color-on-secondary-container` text. The drawing types the
assistant bubble's second paragraph in `--color-on-secondary-container` too and its first in
`--color-on-primary-container` — a drawing slip; the ticket picked the first paragraph's role for the
whole bubble since it is the one on the main text node, and the app does not draw the two paragraphs
differently.

**`title-small` — a token family added by this ticket, not written at the call site.** The theme
(`tokens.css`) carried display, headline, title-large/medium, body-large/medium/small and every label
step, but no `title-small` at any weight. Five tokens landed between the title-medium and body-large
blocks, keeping the scale's display→headline→title→body→label order:

| Token | Value |
| --- | --- |
| `--text-title-small-size` | `14px` |
| `--text-title-small-line` | `20px` |
| `--text-title-small-tracking` | `0.1px` |
| `--text-title-small-weight` | `500` (M3's base weight for the step — Figma exposes the emphasized weight only, so this one is not read off the file; ships with no consumer today, on `--text-label-medium-weight`'s precedent that shipping three quarters of a quartet would surprise the next consumer of the step) |
| `--text-title-small-weight-emphasized` | `600` (M3 SemiBold — read from the Figma **variable**, not the export's fallback) |

`.bubble` uses the emphasized weight; the base ships dormant. **`--text-label-large-*` reads 14/20/0.1
too and is deliberately not borrowed** — the `--text-label-medium-weight-emphasized` token (added by
[#721](../codebase/721.md)) has a comment ruling out exactly that reach and predicting this ticket by
name ("the same node already uses title-small-emphasized, so more are coming"). A bubble typed from the
label vocabulary would be wearing another step's name for a coincidence in the numbers.

### The meta row

`.bubble__meta` is the row every text message bubble now ends in (Figma `Meta row`, 132:4446 assistant /
132:4435 user): `display: flex`, `align-items: center`, `gap: var(--space-2)`, the body-small type
quartet, and `color: var(--color-inverse-primary)` — read from the Figma **variable**, not the export's
fallback hex (`#9dcbfc`), which is the light/dark transposition trap `tokens.css:25-33` already warns
about. `.bubble__meta--user` adds `justify-content: flex-end` (the drawing's `justify-end` on 132:4435;
the assistant row carries none, so the base rule's `flex-start` is already right).

**`min-height: var(--text-body-small-line)` is load-bearing, not decorative.** The row holds two
children: `bubble__meta-time` and the copy control. #970 split into a data slice
([#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013) — gives the `assistantText`/`userText`
[timeline items](thread-timeline.md#types) an optional `createdAt`) and a render slice
([#1014](https://github.com/pyrycode/pyrycode-desktop/issues/1014) — formats it into this slot), both
shipped. An empty inline element generates no line box, so without the `min-height` the row would collapse
to the glyph's 12px height rather than the drawn 16px whenever `createdAt` is absent — see below.

**The time itself is `formatMessageTime(epochMs)` in `messageTime.ts` (new, beside the bubble, the
`copyMessageText.ts` module-plus-spec shape again — 46 + 98 lines).** Pure: `new Date(epochMs)` read with
**local** `getDate`/`getMonth`/`getFullYear`/`getHours`/`getMinutes`, `padStart`-assembled into
`DD.MM.YYYY - HH:MM` (Figma 132:4477/132:4508's `Meta data` node — the full string on every bubble, no
relative or same-day short form). No `toLocaleString`/`toLocaleDateString`/`Intl`: those introduce locale
variation the drawing doesn't call for, and would make an exact-string assertion machine-dependent — one
of the formatter's own unit cases proves this by deleting those methods from `Date.prototype` and `Intl`
out from under the call and asserting the same string still comes back. This is the mirror image of
[`channelListViewModel.formatLastActivity`](channel-list.md)'s **UTC** getters: that formatter
dodges TZ-dependence because a relative-activity label reads the same everywhere, but the drawing's
timestamp is the viewer's own wall clock, so UTC would show the wrong time to everyone outside it. Local
getters are correct here and the flakiness risk moves to the *test* side instead — every expected string in
`messageTime.test.ts` is built from `new Date(y, m, d, h, min)` (never a hardcoded epoch constant), the
exact inverse of local getters, so each case yields the same string in any zone the suite runs in. No
`NaN`/non-finite branch: the only producer of `createdAt` is `Date.now`, so a non-finite epoch is not a
reachable input.

**The render slot: `createdAt === undefined ? null : formatMessageTime(createdAt)`, never `'createdAt' in
item`.** `BubbleMeta` gained one optional prop, `createdAt?: number`, threaded from the `assistantText` and
`userText` arms of `TimelineRow` only — no other row kind gained a call (the tool rows aren't bubbles, the
session-reset separator draws its own timestamp, `QueuedBacklog` still renders no `BubbleMeta` at all).
React renders a `null` child as no children, so the absent case is byte-identical to what #969 always
emitted (`<span class="bubble__meta-time"></span>`) — #1013's contract fixes the read as `=== undefined`
because the reducer assigns the field unconditionally on every arm that carries it, so the key is always
present and only its value distinguishes a stamped item from an unstamped one.

**Accepted consequence: the row fails WCAG AA, built as drawn anyway.**
`--color-inverse-primary` on the two new bubble fills measures 2.67:1 (assistant) and 2.04:1 (user),
against the 4.5:1 AA wants for 12px text and the 3:1 it wants for an icon control — both message texts
are fine (13.3:1 / 10.1:1), it is only this row. Substituting a colour here would put the app and the
Figma out of step, which is the exact failure this redraw exists to unwind; the fix is a Figma-side
change on nodes 132:4446 / 132:4435 and a one-token edit afterwards. The control's hover state
(`--color-primary`) incidentally clears both thresholds.

### The copy control

`.bubble__copy` is a `<button type="button">` holding a bare inline `<svg fill="currentColor"
aria-hidden="true">` with the single Font Awesome `copy-solid-full` path (the drawing's `clipPath` is a
full-bleed 11×12 rect and is dropped as the no-op it is). It inherits its resting colour from the row
through `currentColor`; hover brightens to `--color-primary` and `:focus-visible` draws `outline: 1px
solid var(--color-outline)` — `.queued-row__drop`'s existing treatment, since the drawing has no hover,
focus or pressed state of its own and shows no confirmation after a copy.

**The hit area is bigger than the glyph without growing the row.** The glyph is 11×12, far under the
app's 48px target convention, but the row's height is drawn at 16px. `padding: var(--space-2)` plus an
equal negative `margin` gives a 27×28 border box (what the pointer and focus ring get) inside an 11×12
margin box (what the layout gets) — the M3 icon-button container trick, expressed through the spacing
scale with no pixel literal. The negative margin reaches 8px into the row's own gap, stopping at the
timestamp slot rather than overlapping it.

Rendered by a module-local `BubbleMeta({ text, side })` in `ConversationScreen.tsx`, appended as the
bubble's **last child** on both the `assistantText` and `userText` arms of `TimelineRow` — after the
markdown container or the in-progress cursor on the assistant side, after the plain user text on the
other. Append-not-prepend is a hard constraint, not a preference:
`interactiveRoundtrip.test.tsx` pins the byte string `data-thread-role="assistant"><div
class="bubble__markdown"><p>` as the bubble's opening content, and the still-open attachment slots
(#691/#686) will insert themselves above this row simply by being written before it. The in-progress
tail gets the row too — omitting it would reflow the bubble the instant a turn settles, and a partial
reply is exactly as copyable as a finished one.

**No prop threading.** The copy source is the row's own `item.text`, so the click handler is a closure
over that one value calling `copyMessageText` directly — no conversation id, no store read, no
`onDrop`-style injected effect. That is deliberately *not* `QueuedBacklog`'s shape: that injection
exists because a queued row cannot see the conversation id its send needs, which is not this control's
situation. `Timeline`'s prop surface is unchanged, so the ~30 existing `<Timeline` render sites needed
no edits.

**The accessible name is a client-owned constant, `COPY_MESSAGE_LABEL = 'Copy message'`, never
interpolated with the message text.** `aria-label={`Copy: ${text}`}` would put relay-peer-authored text
into an attribute, which CLAUDE.md's 2026-08-20 ruling forbids outright — "the control needs an
accessible name" is exactly the requirement that invites that mistake.

### `copyMessageText.ts` (new)

```ts
export async function copyMessageText(text: string): Promise<boolean>
```

A pure-ish helper beside `composerSend.ts` / `dropQueuedMessage.ts`, for the same reason those exist:
the renderer test tier is static server renders with no DOM and no click, so an effect reachable only
from an `onClick` needs its own unit-testable seam. Guards `navigator.clipboard` being absent (returns
`false` without throwing — an insecure origin or a non-browser context), awaits `writeText` inside a
`try`, and on rejection logs `console.error('message copy failed')` — the event name alone, never the
text and never the caught error object. That is `questionResolution.ts`'s posture (event name only)
rather than `composerSend.ts`'s `console.error(msg, error)`: the value in flight is relay-peer-authored
text, and a `DOMException`'s message not carrying that text today is not something to depend on holding
across Chromium versions. Never throws and never propagates — a failed copy must not crash the thread,
and the drawing shows no confirmation on either outcome so none is added.

The text copied is `item.text` — the string the store coalesced from the daemon's `assistant_delta`
frames, upstream of `AssistantMarkdown` — so "the markdown source, not the rendered DOM" (the assistant
side) and "the text as sent" (the user side) both fall out of *where* the helper is called, not from any
un-rendering step inside it. Length is already bounded upstream by `parseInboundMessage`'s
`MAX_PLAINTEXT_BYTES` cap on the decrypted envelope, so no second cap was added here.

The call site is `onClick={() => void copyMessageText(item.text)}` — an explicitly voided promise.

### The clipboard permission (`src/main/index.ts`)

`session.defaultSession.setPermissionRequestHandler` denied every renderer permission unconditionally
before this ticket. Electron routes a user-gesture `navigator.clipboard.writeText` through that same
handler as `clipboard-sanitized-write` — **measured, not assumed**: `e2e/message-copy.spec.ts` seeded
the OS clipboard with a sentinel, clicked the control, and read the clipboard back through the main
process to find the sentinel still there. The write was refused with no exception the renderer could
see; the control was a silently working-looking no-op.

The handler now reads `callback(permission === 'clipboard-sanitized-write')` — **an allowlist of
exactly one string, not a denylist.** A denylist would grant every permission Chromium adds in a future
version by default, the opposite of the posture this handler exists to hold. The allowlist shape also
falls out for free: `clipboard-read` / `clipboard-sanitized-read` stay denied by the same comparison —
read is a categorically worse capability than write (it exfiltrates whatever the user last copied,
routinely a password-manager secret), and nothing in this app needs it. The e2e's second half proves the
negative: it drives `Notification.requestPermission()` (routed through the same handler, not on the
list) and asserts it still comes back denied. Granting the write directly, rather than routing it
through a new `ipcMain` channel in the `shared/ipc/unpair.ts` request/response shape, was a deliberate
choice — that idiom grants the same capability through more code and would have pushed the ticket over
its file-count boundary.

## What stays untouched

- **The queued row** (`QueuedBacklog`, [queued backlog + drop
  affordance](conversation-shell-conversation-and-modals.md#queued-backlog--drop-affordance-294-drop-since-296))
  reuses `.bubble--user` with no CSS of its own, so it inherits the new geometry, fill and type — but it
  renders no `BubbleMeta`: a queued message has no timestamp and nothing sent yet to copy. Its
  `data-thread-role="queued"` distinguishes it from a delivered row's `"user"`, so the two are
  distinguishable in a markup assertion that counts meta rows rather than greping for a class.
- **`MessageBubble`** — the retired, unmounted residue of the coarse `MessageThread` path
  [#179](../codebase/179.md) cut over from (still exported, still unit-tested, never rendered in the
  app) — emits `bubble bubble--user` / `bubble bubble--daemon` and so inherits the CSS restyle passively,
  but gained no `BubbleMeta` and no code change. Its tests still pin the message text as the bubble's
  sole child (`data-message-role="user">text m1</div>`).
- **The tool rows and the fenced code block** are untouched by the #969 restyle: they are not bubbles. The
  file row and the image thumbnail — both instances of the same `Message` component's `Slot` — inherit the
  restyle around them but drew no content of their own at the time; both have since shipped. See
  [§ The attachment file row](#the-attachment-file-row-815-816) and
  [§ The attachment image thumbnail](#the-attachment-image-thumbnail-1045) below.
- **`.bubble__markdown`** ([Assistant markdown
  renderer](assistant-markdown-renderer.md)) is unaffected structurally: `.bubble__meta` is appended as
  its *sibling* inside `.bubble`, never as its child, so the markdown container's own flex column and 8px
  block-rhythm gap never reach the meta row.
- **`e2e/assistant-whitespace.spec.ts`** reads `.bubble`'s padding at runtime and asserts inequalities
  against it rather than a literal value, so the 14px → 20px change needed no edit there.

### The attachment file row (#815, #816)

A settled, non-image attachment on a sent message draws as `.bubble__file`: an outlined document glyph
(45×60, inline `<svg>`, its extension overlaid across the lower half) and the filename beside it, 12px
apart and both vertically centred. Figma `File field` 132:4605, inside the bubble at 121:3860. `#1039`
supplied the record this reads (`MessageAttachment[]` on a `userText` [timeline item](thread-timeline.md#types));
until that ticket landed there was no name to draw.

**User-arm only, and structurally so — not a scope choice.** The drawing is an *assistant* bubble, but
`MessagePayload` carries no attachment field and there is no list verb, so an assistant-produced file
cannot reach the window at all today. `attachments` can only ever describe files the client itself
minted. Building an assistant-side mount would be building for a wire change nobody has filed.

**Rendered as one `<div className="bubble__file">` per attachment, each a direct child of `.bubble`, no
wrapper** — the same reason `.bubble__meta` uses a `margin-top` rather than a flex-column gap (`.bubble`
can't be a flex column; see above). Each row carries `margin-top: var(--space-3)`, so text → file → file
→ meta falls out at the drawn 12px rhythm with one rhythm mechanism, not two. Written between the message
text and `<BubbleMeta>` — the slot `BubbleMeta`'s own comment reserved for it — which keeps
`interactiveRoundtrip.test.tsx`'s pinned opening-child byte string intact. React key is the array index:
the list is a frozen record written once at send and never reordered, so index identity is stable
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
"a settled inherited value that's restated is a value that gets lost" ruling this file already applies to
`.bubble__markdown code` and `.bubble__markdown a` (#607/#623/#628/#629/#630). `flex: 0 0 auto` stays on
the icon despite measuring inert on this AC, kept as this file's vocabulary for a non-shrinking lead item
and because the automatic-minimum floor it duplicates is conditional in a way the declaration isn't — a
later `min-width: 0` on that rule would remove it. The guard for AC5 is `e2e/attachment-file-row.spec.ts`
alone: nothing in this AC is observable in the static (no-DOM) tier, so if `.bubble`'s `word-break` is ever
narrowed, that spec is what goes red.

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

**Image attachments no longer draw this row.** [#1045](#the-attachment-image-thumbnail-1045) takes the
same `Slot` over for a name `isImageAttachmentName` admits and draws the picture instead — see below.
In-flight/failed attachments stay the composer's own concern (`attachmentUploadCopy.ts`) — this row draws
a settled attachment only. Neither a pending state nor a failure state exists for the download itself
(#816's Open Question: no Figma node for either, so both need their own ticket) — the row is activatable
at every instant, with nothing to reset on a failure.

### The attachment image thumbnail (#1045)

An image attachment on a sent message draws as the picture its own bytes decode to, taking over the same
`Slot` (132:4466) the file row above draws into — a branch on what fills the slot, not a second slot. Split
from #868 via [#1044](attachment-image-source.md) (the bytes-to-`blob:`-URL path) and this ticket (the
`<img>`, the CSP widening, and the imageness decision itself).

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
`AttachmentThumbnail({ state, filename, onDecodeError })` takes no hooks and switches on
`AttachmentThumbnailState`:

- `pending` → `null`. Nothing drawn and nothing reserved — reserving space needs the aspect ratio, which
  needs the bytes, which is the thing being fetched. A late-loading thumbnail moving the reader's scroll
  position is consequently a real follow-up, filed and blocked on this ticket, not a defect here.
- `ready` → `<img className="bubble__image" src={url} alt={ATTACHMENT_IMAGE_ALT} onError={onDecodeError} />`.
  `alt` is the **client-owned constant** `'Attached image'`, never the filename — `alt` is an attribute, and
  #815's ruling that the untrusted name never enters one is carried across rather than reopened. `onError`
  is AC5's decode-failure half (bytes arrive, the name lied) and cannot loop: moving off `ready` unmounts the
  very `<img>` that raised it.
- `failed` → a `<p className="bubble__image-fallback">` holding the client-owned sentence `'Image could not
  be shown'` and, in its own `<span className="bubble__image-fallback-name">`, the filename as escaped React
  children — included, not omitted, because a reader who sent several pictures needs to know which is
  missing.

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

**The box, `.bubble__image` in `conversation.css`, is five declarations, two of which are the whole sizing
rule:**

```css
.bubble__image {
  margin-top: var(--space-3);
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
the window; no fixed pixel width is written anywhere. `margin-top: var(--space-3)` joins the file row's and
the meta row's existing following-sibling rhythm rather than adding a second mechanism, since `.bubble` is
deliberately not a flex column (see above). The fallback (`.bubble__image-fallback`) takes the file row's
typographic block (body-small, `--color-inverse-primary`) and the same `margin-top`, so a failed image
occupies the rhythm a drawn one would and the thread does not shift as asks settle.

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

## Testing

**vitest** (static server renders, no DOM): `copyMessageText.test.ts` mocks
`navigator.clipboard.writeText` as a global and asserts the exact string reaches it, a resolved write
returns `true`, a rejected write returns `false` without throwing, and a missing `navigator.clipboard`
returns `false` untouched. `ConversationScreen.test.tsx` asserts the assistant bubble (settled and
in-progress) and the user bubble each end in `.bubble__meta` as the bubble's *last* child (index
ordering against the message text and against `.bubble__markdown`), the user row carries
`bubble__meta--user` and the assistant row does not, the control is a `<button type="button">` with
`COPY_MESSAGE_LABEL`, and the queued row / `MessageBubble` residue render **zero** `.bubble__meta` (a
count assertion over the whole markup, not a per-string absence). `messageTime.test.ts` covers the
formatter alone — the drawing's own moment verbatim, a single-digit day/month/hour/minute together
(proving all four `padStart`s at once), midnight and 23:59 (24-hour, no meridiem), a sub-minute component
that must not leak into the string, a sub-four-digit year, and the `toLocaleString`/`Intl`-removal case
above. #1014 also added stamped `assistantText`/`userText` cases to the #969 meta-row `describe` in
`ConversationScreen.test.tsx` alongside an absent-stamp case; the 39 pre-existing stamp-free item literals
in that file were left unedited — #1013's optional field is what keeps them compiling, and they remain the
coverage for the empty-slot path.

**Playwright** (`e2e/message-copy.spec.ts`, fake-transport tier): the clipboard-permission measurement
above; the keyboard path (focus + Enter, same clipboard read-back); and the restyle's geometry as
computed style — all four `border-radius` corners equal, `padding` 16/20, and the meta row's
`justify-content` differing between the two sides. Filling the slot broke thirteen *other* specs' bubble
text assertions across the fake tier plus four raw `textContent` reads in the real-claude tier — see
[E2E test harness](e2e-harness.md#edge-cases-and-limitations) and [Real-claude liveness
e2e](real-claude-liveness-e2e.md#assertions--content-agnostic-two-turn-liveness) for the fix and the sweep
method that finds the next one.

**#815's own coverage:** `attachmentExtensionLabel.test.ts` pins the four ordering decisions (last-dot,
strip-before-cap, ASCII-only, the leading-dot `.hidden` → `HIDD` case shipped as documented rather than
carved out). A new `ConversationScreen.test.tsx` `describe` pins the row's position between the text and
`.bubble__meta`, the icon/name markup, the extension overlay present for a real extension and empty for
one without, two attachments rendering two rows in list order, and a **count** of `.bubble__file` over
the whole markup for the arms that must render none (assistant bubble, queued row, `MessageBubble`
residue) — the same count-not-absence idiom the meta row's own proof used. `e2e/attachment-file-row.spec.ts`
(new, fake tier) is the only place AC5's wrapping is actually provable, and **does not use
`bubbleTextExactly`**: that fixture is an anchored whole-bubble matcher (six existing callers), and this
is the first bubble in the suite with a text-bearing child beside the message text.

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

## Related

- [#969 architecture spec](../../specs/architecture/969-message-bubble-redraw-with-meta-row.md) — full
  design, the clipboard-permission open question and its resolution, and the security review.
- [#970](https://github.com/pyrycode/pyrycode-desktop/issues/970) — the parent ticket this meta row's
  timestamp slot was reserved for; split into [#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013)
  (shipped — gives `assistantText`/`userText` [timeline items](thread-timeline.md#types) an optional
  `createdAt`, no visible change) and [#1014](https://github.com/pyrycode/pyrycode-desktop/issues/1014)
  (shipped — `messageTime.ts` and the render slot, covered in full above), both blocked on this ticket.
- [#815 architecture spec](../../specs/architecture/815-bubble-attachment-file-row.md) — the non-image
  attachment file row's full design, the AC5 CSS-vs-inherited measurement, and the security review this
  file's § The attachment file row summarizes.
- [#816 architecture spec](../../specs/architecture/816-attachment-file-row-download-control.md) — the
  download control's full design, including the two-ask sequencing and the security review's MUST FIX
  (bounding the conversation id, not only the attachment id, before subscribing).
- [Attachment retrieval § the renderer click (#816)](attachment-retrieval.md#the-renderer-click-816) and
  [Attachment save](attachment-save.md) — the two background-process channels this row's click now
  drives, fetch then save on that fetch's `completed` terminal.
- [#686](https://github.com/pyrycode/pyrycode-desktop/issues/686) — the parent ticket the attachment slots
  split from: [#815](https://github.com/pyrycode/pyrycode-desktop/issues/815) (shipped, this section),
  [#816](https://github.com/pyrycode/pyrycode-desktop/issues/816) (shipped, the row's download action,
  covered above), and [#868](https://github.com/pyrycode/pyrycode-desktop/issues/868) (the image
  thumbnail, same slot) — instances of the same `Message` component whose bubble this ticket restyles.
  #868 itself split further into [#1044](attachment-image-source.md) (shipped, the bytes-to-URL path),
  [#1045](#the-attachment-image-thumbnail-1045) (shipped, this document's new section) and #869 (the
  thumbnail's own open-full-size click, not yet built).
- [#1045 architecture spec](../../specs/architecture/1045-image-attachment-thumbnail.md) — the image
  thumbnail's full design, the operator's 2026-08-22 sizing ruling, and the security review covering the
  CSP widening and the attacker-chosen-bytes-reach-a-decoder threat model.
- [Attachment image source](attachment-image-source.md) — the bytes-to-`blob:`-URL path #1045 consumes,
  the release-handle/refcounting contract `BubbleAttachmentImage` honours, and the CSP-widening argument
  this document's § The attachment image thumbnail carries out.
- [#1028](https://github.com/pyrycode/pyrycode-desktop/issues/1028) / [#1039](https://github.com/pyrycode/pyrycode-desktop/issues/1039) —
  the record a sent message's attachments carry on its timeline item, which #815 reads and without which
  it has no name to draw.
- [#721 codebase notes](../codebase/721.md) — the code-block redraw that introduced
  `--text-label-medium-weight-emphasized` and the "more `title-small` consumers are coming" comment this
  ticket's tokens fulfil.
- [Conversation shell — conversation surfaces and modals](conversation-shell-conversation-and-modals.md#the-interactive-flip--thread-cutover-179) —
  the bubble's original shipped shape and the queued row's reuse of it.
- [Assistant markdown renderer](assistant-markdown-renderer.md) — `.bubble__markdown`, the sibling
  container this ticket's meta row is appended alongside, not inside.
- [ADR 0003 — M3 theme tokens](../decisions/0003-m3-theme-tokens-css-custom-properties.md) — the
  off-grid-value-gets-a-named-token rule `--space-bubble-x` set the precedent for, which this ticket's
  `title-small` family follows again.
