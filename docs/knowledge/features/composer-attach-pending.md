# Composer attach — pending attachments and the strip (#1039, #1262, #1263)

Split from [Composer attach](composer-attach.md) on 2026-09-08 to stay under the size cap. Part of the same
feature: the button (#863), the outcome line, `useAttachmentUpload`, its in-flight progress (#864) and the
copy module are documented on the parent page; this page covers only the pending-attachments set an upload
completing accumulates (#1039), the tile strip that draws it above the message box (#1262), and the picture
an image-named tile draws instead of the file icon (#1263).

## Pending attachments (#1039) — what an upload completing means to the message not yet sent

The first thing in this app that associates an attachment with a message. Nothing rendered by
[the outcome line](composer-attach.md) needed to change when this landed — but the composer now also
*remembers* which uploads have completed since the operator last pressed send, so
[`submitMessage`](composer-send.md) can record them on the message's own timeline item. See [Thread
timeline § Types](thread-timeline.md#types) for `MessageAttachment` and the `userText` item/event fields
this feeds. Since [#1055](https://github.com/pyrycode/pyrycode-desktop/issues/1055), the same ids also
name the message's attachments on the outbound `send_message` frame — display was the whole of it before;
now it is also how claude learns which files to read.

**It is a pure function for a reason this file's other four are not.** `composerClassName`,
`dragCarriesFiles`, `reduceFileDropDepth`, `fileToAttach` and `pasteCarriesImageOnly` are pure so the
static tier can walk gestures nothing in this repo can perform. `reducePendingAttachments` is pure because
there is no other tier *at all*: nothing renders the pending set, so Playwright has nothing to observe,
and this repo's renderer specs are static server renders with no DOM and no `renderHook`, so a rule living
only inside the hook would be reachable by no test anywhere.

```ts
export const NO_PENDING_ATTACHMENTS: readonly MessageAttachment[] = []

export function reducePendingAttachments(
  pending: readonly MessageAttachment[],
  event: AttachmentUploadEvent
): readonly MessageAttachment[]

export function drainPendingAttachments(holder: {
  current: readonly MessageAttachment[]
}): PendingAttachmentTake
```

- **`reducePendingAttachments`** folds one arriving event into the set the next send will record. Only
  `completed` adds anything — `refused`, `failed` and `progress` each return the **same reference**, not
  an equal copy, so "an upload that was refused, that failed, or that is still in flight contributes
  nothing" is structural rather than incidental. The pair recorded is `{ attachmentId: event.uploadId,
  filename: event.filename }` — the daemon's own id (`driveUpload` sends `attachment_id: uploadId`) and
  #1038's display name, its first consumer. Order is **completion order**, the only order this window can
  know: the composer never learns the `uploadId` its own click minted
  (`requestAttachmentUpload()` returns `void`), so it cannot order by gesture. An explicit return type and
  **no `default`**, `attachmentUploadOutcomeCopy`'s idiom — a member added to `AttachmentUploadEvent`
  upstream trips TS2366 here too, and is sufficient (unlike that module's `reason` read) because this
  switches on the *discriminator*, which only this app's own background process mints, never a value a
  hostile daemon chooses.
- **`drainPendingAttachments`** hands the set to a send and empties it, in one act — generic over a
  `{ current }` holder the way `fileToAttach` is generic over the element, so a `MutableRefObject`
  satisfies it with no React import. Take-and-clear cannot be split: a reader that didn't empty, or an
  emptier a caller had to remember to call, would each open a window in which one send's attachments could
  be recorded twice. Since [#1055](https://github.com/pyrycode/pyrycode-desktop/issues/1055) it returns a
  `PendingAttachmentTake` — `{ attachments, rollback }` — rather than the bare set: `attachments` is the
  same take as before, and `rollback` restores exactly it to the holder, undoing the drain without
  splitting it into a peek/consume pair. The type is declared in `composerSend.ts`, its consumer, not
  here — see [Composer send § 10](composer-send.md#10-attachments-named-on-the-outbound-frame---takeattachments-1039-reworked-by-1055)
  for why the boundary runs that way and why restoring is sound (the caller is synchronous end to end, so
  nothing can arrive between the take and a rollback for it to clobber).

**The pending set lives in a `useRef`, and #1262 did not move it — it added a `useState` mirror beside
it.** The ref's original reason ("nothing renders it") is now half false: since #1262,
`ComposerAttachmentStrip` does render the set. The half that carries the weight survives untouched, because
it was never about rendering — it is about the *take*. A `useState` holding the set of record would open a
real drop window through React's batching: a completion arriving after the last commit but before the
click would be invisible to the closure the click reads, and a subsequent take would then clear it unsent.
So the set is held **twice**, and the two holdings answer different questions: the ref is the record — what
`takePendingAttachments` reads, authoritative, synchronous — and the `useState` beside it is the *display*'s
own copy, written from the same fold in the same listener call, allowed to be batched precisely because
nothing reads it to decide anything. **Do not collapse the two by making the take read the state** — that
reopens the drop window silently, and the security review calls this out as the one thing a later ticket
must not do. Both are still [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md)
state in every other respect — ephemeral, screen-local, per-mount — and both reset on a conversation switch
for the held outcome's own free reason: `PairedShellView` keys the chat pane on the conversation id, so a
switch rebuilds this component with an empty set and an empty strip.

The listener folds into both holdings from one fold, so the two cannot disagree about which events
happened:

```ts
window.pyry.onAttachmentUploadEvent((event) => {
  setOutcome(event)
  const next = reducePendingAttachments(pendingRef.current, event)
  pendingRef.current = next
  setPending(next)
})
```

`takePendingAttachments` wraps `drainPendingAttachments(pendingRef)` in `mirrorTakeToDisplay`, which empties
the display and returns a take whose `rollback` restores the **holder before the display** — there is no
instant at which a tile is drawn for an attachment the next send would fail to record. `drainPendingAttachments`
itself is unchanged: same one-act take-and-clear, same synchronous rollback.

**The pending set does not ride the gesture-clear, and this is the one place a shared clear would be
wrong.** `requestAttach`, `dropFile` and `pasteImage` each call `setOutcome(null)` on the gesture — about
the *displayed* line, since a cancelled picker or an unresolvable drop reports nothing at all, and an
event-driven clear would otherwise strand a stale refusal on screen. A pending set sharing that clear
would erase the first file the moment the operator attached a second, which is exactly the "one or more"
the acceptance criteria ask for. The two clears answer different questions and are kept apart on purpose.

**What this falsifies, honestly.** [Composer attach § Three pure views](composer-attach.md) still states the
hook's *display* correctly — one nullable, latest event wins, and `uploadId` is still unread by everything
that renders — but a paragraph used to conclude from "the renderer cannot correlate a click to an id" that
the listener "assigns; it does not merge, queue or correlate," full stop. That conclusion was too broad: a
message's attachments don't need a click correlated to an id, only the completions that *arrived* since the
last send, which the events give on their own arrival order. The listener now assigns **and** accumulates;
it still correlates nothing to a gesture.

**Where the send reads it — `submitMessage` (`composerSend.ts`).** See [Composer send §
10](composer-send.md#10-attachments-named-on-the-outbound-frame---takeattachments-1039-reworked-by-1055)
for the read site, why it sits below both of `submitMessage`'s early `false` returns, why it now sits
*above* the guarded send (the ids ride the outbound `send_message` frame since #1055), and how an empty
or unwired take normalises to an absent field on both the frame and the echo.

## The pending strip and the shared file drawing (#1262)

The completion sentence beneath the footer ("File attached.", `COMPLETED_COPY`) is **deleted**, and its cut
is one swap with the strip's arrival, not two: Juhana ruled 2026-09-05 that the tile is the report, and no
strip and no sentence would leave a completion with no feedback at all, while both would report it twice.
`attachmentUploadOutcomeCopy`'s `completed` arm **stays** and returns `''` — the switch carries no `default`
on purpose, and deleting the arm would give up the compiler-forced exhaustiveness that has caught two real
additions already (#864's `progress`, #999's two retrieval codes). The empty string is unreachable in
production, since `ComposerAttachOutcome` returns `null` for a completion before it can call the copy
function. **Cost, stated plainly:** a completion no longer announces to assistive technology — the tile's
two children are both `aria-hidden` and its frame exposes no accessible name. If that is wanted later it is
a client-owned constant in a live region on the strip, never the filename, and not a debt this ticket left
implicit — both the plan and the code state it.

**The drawing is shared through a component, not a class — `AttachmentFileIcon.tsx`.** It takes three class
name props (`frameClassName`, `glyphClassName`, `labelClassName`) rather than a shared class, because the
bubble's own `class="bubble__file-icon"` / `bubble__file-glyph"` / `"bubble__file-ext"` runs are matched as
**whole attribute runs** across 315 assertions in `ConversationScreen.test.tsx`; a lifted shared class would
land in them as a two-class mix, the degradation [Composer attach § In-flight progress](composer-attach.md)
has recorded before at `.composer__footer-button`. Passing the caller's own class through makes
`BubbleAttachmentRow`'s markup byte-identical after the lift, so AC3 needs no new test — the shipped
assertions are already the detector. Both consumers render `stroke="currentColor"` on the glyph, so each
resolves its own ink: the bubble sets `color` nowhere and keeps inheriting the row's colour on both halves
exactly as before, while the composer's tile sets `color: var(--color-inverse-primary)` on
`.composer__attachment` (the glyph's frame) and `color: var(--color-primary)` on `.composer__attachment-ext`
(the label) — two inks out of a drawing that has only ever had one, with no colour prop and no `style`
attribute. Only `attachmentExtensionLabel(filename)` reaches the DOM as escaped children; the raw name
reaches neither an attribute, a `title`, an `alt`, a URL nor a React key (the strip's own unit test drives a
name carrying a path and an `onerror` payload through it).

**Reading a Figma variable pair, the rarer trap.** `tokens.css` already warns that a generated snippet's
*fallback hex* can print the light scheme's value while the *variable name* is the one telling the truth.
Node `390:7217`'s label came back as `var(--schemes/inverse-primary, #9dcbfc)` — name and hex disagreeing in
the **other** direction: here the name is transposed and the hex is true. Neither half is authoritative
alone; `get_variable_defs` on the node (`Schemes/Inverse Primary` → `#32628d`, `Schemes/Primary` → `#9dcbfc`)
plus the glyph export's own baked `stroke="#32628D"` are what settle it. Worth checking both ways on any
future read of this same file.

**Geometry: a strip added above the message box does not move the message box.** `.composer` sits
`flex: 0 0 auto` at the bottom of a column whose thread takes the slack, so growing the composer moves its
own top edge up into the thread — everything *below* the new child keeps its screen position. This is the
opposite of the outcome line beneath the footer, which moves the message box down when it appears. The
detector for "reserves no space" with nothing pending is therefore the *composer's own height* at launch
versus after a take clears it, not the message box's position.

## The picture inside an image tile (#1263)

An attachment whose name `isImageAttachmentName` accepts draws its own picture in the 45×60 tile instead of
`AttachmentFileIcon`'s outline — closing [#891](https://github.com/pyrycode/pyrycode-desktop/issues/891):
until this, every tile #1262 drew read "PNG", picture or not. Any other name keeps the file tile, which is
also the fallback for a picture that fails to retrieve or fails to decode.

**New module, `ComposerAttachmentImage.tsx`, split the way
[`BubbleAttachmentImage.tsx`](conversation-shell-message-bubble-attachments.md#the-attachment-image-thumbnail-1045)
is split — a pure `ComposerAttachmentTile` and a container owning one `useState` plus one `useEffect`.** Renderer
specs are `renderToStaticMarkup` under `environment: 'node'` with no DOM and no effects, so a state reachable only
from a `useEffect` is unprovable there; splitting keeps every one of the three drawn states an ordinary static
render. `ComposerAttachmentStrip` picks this component over `AttachmentFileIcon` per attachment with one branch
on `isImageAttachmentName(attachment.filename)` — the message bubble's own rule, over the same untrusted string,
deciding only what is *drawn*, never what is fetched or from where (the fetch is addressed by `attachmentId`,
which the predicate never sees).

**`AttachmentThumbnailState` is reused from `BubbleAttachmentImage.tsx`, not re-declared.** Same closed set for
the same reason (bytes absent, bytes here, ask ended with nothing drawable), and its `failed` arm still carries
no reason — more load-bearing here than in the bubble, since this tile's failure drawing has no text node at
all to interpolate one into. The container consumes the shipped `attachmentImageSources` singleton directly —
never a second instance, which would mint its own URL per mount, revoke none of the others, and could revoke a
URL the bubble's own thumbnails are still showing on a different screen.

**Two deliberate departures from the bubble's three arms, both in `ComposerAttachmentTile`'s switch:**

- **`pending` draws the frame, not nothing.** `AttachmentThumbnail`'s `pending` arm draws nothing because
  reserving a box would need the picture's aspect ratio; here the box is a fixed 45×60 regardless of what the
  picture turns out to be, so drawing an empty `<span className="composer__attachment" />` is what makes the
  strip's tile count and every tile's position a property of the *pending set* rather than of what any one
  picture is doing. No spinner and no placeholder fill — the design draws no loading state for the slot.
- **`ready` wraps no `<button>` and adds no control.** #869 gave the bubble's picture a click-to-open; clicking
  a composer tile to open the file was never planned, and #1264's remove control is the one control this tile
  will ever get. No tab stop, no handler, no `width`/`height` attribute (the box is the frame's).

**The fetch is a real round trip, and that is the accepted cost, not an oversight.** The upload leg streams the
picked file and keeps no local copy, and the app-private attachment directory has one writer — the retrieval
leg (see [Attachment bytes](attachment-bytes.md)'s sole-writer rule). So the picture the operator has just
attached has to come back from the host before an `<img>` can point at it, one round trip per image tile. A
send drains the strip (`mirrorTakeToDisplay`); a rolled-back send remounts every tile and each re-fetches from
scratch, blinking back to its empty frame — correct rather than merely tolerable, since `release` is idempotent
and the map entry is recorded before `onOutcome` runs. If the round trip proves slow in daily use, retaining
the picked file locally is its own ticket, and it would have to answer the sole-writer rule first.

**CSS is one rule, `.composer__attachment-image`** — `display: block; width: 100%; height: 100%;
object-fit: cover`. No radius and no clip of its own: `.composer__attachment` already carries
`overflow: hidden` and `--radius-xs`, and #1262's own comment records that this picture is what that clip was
for. `centred` needs no declaration either — `object-position` defaults to `50% 50%`. Shares no whole class
token with `.composer__attachment`, `-glyph` or `-ext`, so no shipped locator or whole-attribute-run assertion
reaches it.

**AC4 — the one criterion no fake tier can reach.** Nothing had asked the host for an attachment *no message
references yet* before this ticket: every retrieval shipped so far names an attachment already recorded on a
timeline item, where a pending composer attachment is not. The client half was never in doubt — composer and
retrieval driver read the conversation id from the same `activeConversationStore` expression, and the pending
attachment's id is the `attachment_id` the host itself acknowledged at upload — but whether the *real* daemon
answers `request_attachment` for such an id was an open question the fake tier cannot settle, since it answers
that request itself. `real-claude-attachment.spec.ts` carries the proof now: its old `toHaveText('PNG')` gate
(a `.png` tile is no longer a label) is replaced by polling the tile's `<img>` for `naturalWidth > 0`, so a host
that never answers reads as a timeout rather than a wrong value. This is why the ticket carried
`needs-real-claude`, and confirming the real host's answer is the operator's `npm run e2e:real:gate` run —
CLAUDE.md's real-claude-tier trap applies: read the skip reasons, not the exit code.

**A geometry assertion on the `<img>`'s own box is not a detector for `object-fit`.** An `<img>` at
`width/height: 100%` lays out at 45×60 under `fill`, `contain` *and* `cover` alike — only what it paints
*inside* that box differs, which is the computed `object-fit` value, not the box. `e2e/composer-attachment-image.spec.ts`
keeps the box read (it proves the element fills the frame in both axes) but asserts the computed style
separately; deleting the CSS rule flips the computed value to `fill` and is what actually reddens the spec.

**A never-answered `request_attachment` is a usable fixture, not a hang.** `attachmentRetrieval` sets no
deadline, so an id the fake daemon serves nothing for holds a tile in `pending` for the whole run. The e2e spec
uses exactly this to turn "the frame is drawn while bytes are in flight" from a race into a deterministic
position assertion on the *neighbouring* tile (a permanently-pending first tile puts the second tile's left
edge at 57px rather than 0 — the tell that the in-flight arm reserves the box rather than collapsing it).

## Testing

Renderer specs are static server renders (`environment: 'node'`, no DOM). `ComposerAttach.test.tsx` walks
`reducePendingAttachments` across all four `AttachmentUploadEvent` arms (a `completed` appends;
`refused`/`failed`/`progress` each return the same reference via `toBe`; two completions record in
completion order; the input array is never mutated), `drainPendingAttachments` against a plain `{ current }`
object (empties the holder; its `attachments` is the shared empty constant on a second take; `rollback`
restores exactly the taken set, and a take after a rollback yields that same set again), and (#1262)
`mirrorTakeToDisplay` (the take empties the display; `rollback` restores the holder before the display; the
returned `attachments` is the same reference the wrapped take claimed). `AttachmentFileIcon.test.tsx` covers
the caller's three class names rendered verbatim, the glyph's `fill="none"`/`stroke="currentColor"`/
`aria-hidden`, the label as the extension and `aria-hidden`, and a hostile filename (a path, an `onerror`
payload) producing only the derived label with no attribute, `title`, `alt` or key carrying the raw name.
`ComposerAttachmentStrip`'s own unit tests: an empty set renders `''` (bare equality, not `not.toContain` —
which would pass on an empty element holding the slot); one tile per attachment in order; nothing but the
label reaches the DOM.

`e2e/composer-attach.spec.ts` (fake transport, extending the shipped drive) is the geometry, lifecycle and
completion-silence proof the static tier cannot reach: a pushed `COMPLETED` draws one 45×60 tile, left edge
on `.composer__row`'s, 8px clear of the status row and the message box; a second completion draws 12px after
the first, in completion order; the outcome line stays at count 0 throughout and a `progress` push is gone
the moment a tile draws; the two shipped negatives (`uploadId`, `filename`) are re-aimed at the strip; a
blank Enter leaves the tiles; a send empties the strip. Rounded deltas use `toBeCloseTo(…, 0)` per #868's
`-0` rule. The rollback arm stays unit-only (`mirrorTakeToDisplay`'s test) for the reason #1055's own
rollback proof gives: `window.pyry` is a frozen `contextBridge` object, so a throwing bridge cannot be
staged from the page. Four further specs that push a `completed` event on the same channel
(`attachment-file-row`, `attachment-image-open`, `attachment-image-thumbnail`, `thread-scroll-pin`) needed no
repair — confirmed by a green `npm run e2e`, per § Geometry above (the strip growing moves the composer's own
top edge, not the message box's position, which is why `thread-scroll-pin`'s post-send measurements were
unaffected).

**#1263's tests.** `ComposerAttachmentImage.test.tsx` (new, static tier) asserts each of the three drawn
states as an exact markup equality — `pending` is the bare frame with no `<img>`, no `<svg>` and no text;
`ready` is exactly one `<img>` classed `composer__attachment-image`, named by `ATTACHMENT_IMAGE_ALT` and
nothing else; `failed` is the file tile's own markup with no `<img>` at all — plus a hostile filename
reaching no attribute in any of the three arms. `ComposerAttach.test.tsx`'s own `tile('shot.png')` assertion,
which used to assert an image name draws `>PNG</span>`, is re-aimed to the image tile's frame — the case
\#1262's comment named as this ticket's to replace. `e2e/composer-attachment-image.spec.ts` (new, fake
transport, separate from `composer-attach.spec.ts` because serving attachment bytes would change the daemon
under that file's one continuous drive) pushes four tiles in a fixed order — a permanently-`pending` image,
a non-image, a served 800×100 PNG, and one served bytes that fail to decode — and reads tile count, each
tile's box, the neighbour-position tell above, `object-fit`'s computed value, and `naturalWidth` (also the
CSP detector: a refused source never decodes and reads 0). `real-claude-attachment.spec.ts`'s upload gate,
which used to assert the tile's text against `attachmentExtensionLabel`, now polls the tile's `<img>` for
`naturalWidth > 0` — a stronger gate, and the one AC4 above rests on.

## Security

**#1039's review, PASS.** No new channel, no new bridge member, no new capability — the pending set only
reads the two fields the completed terminal already carries. Retention is the property that changed:
`filename` was consumed once for a sentence and is now held in renderer memory on a timeline item, with no
sink in this slice (nothing renders, logs, or builds a path from it) and no re-sanitising, since the save
leg re-runs `sanitizeAttachmentFilename` on the value it actually builds a path from. `attachmentId` is a
`randomUUID` identifier, not a capability — the daemon authorises retrieval by the Noise session, not by
knowledge of the id. A hostile daemon can claim `completed` for an upload it never stored, so the timeline
can record an attachment the host doesn't have; blast radius is one wrong record, surfaced visibly since
\#868's retrieval landed: the image thumbnail's `failed` fallback (or, for a non-image name, a file row whose
download/open click answers `unavailable`). See
`docs/specs/architecture/1039-record-sent-attachments-on-timeline-item.md` § Security review.

**#1262's review, also PASS.** No new channel, no new bridge member, no new capability — the strip is a
pure function of the pending set the composer already held, and the drawing is one-way (nothing crosses
toward main). The one SHOULD-FIX — a hostile `filename` reaching a new DOM sink — is discharged by
`attachmentExtensionLabel`'s existing bound (`[A-Za-z0-9]`, capped at four characters, linear time) rather
than a new sanitiser, and is asserted directly against a name carrying markup and a path. `attachmentId`
reaches no attribute and is not the React key (index is), which is what re-aiming the AC5 negatives at the
tile now actually guards. The glyph is inlined, never a Figma `https://` asset URL, inheriting
`BubbleAttachmentRow`'s CSP ruling. See `docs/specs/architecture/1262-composer-attachment-strip.md` §
Security review for the full write-up, including the concurrency note that the take must keep reading the
ref rather than the display mirror.

**#1263's review, also PASS.** No new channel, no new bridge member, no new `ipcMain` handler, and the CSP
is untouched — `img-src 'self' blob:` already permitted this since #1045. The two untrusted inputs each keep
one sink: `filename` reaches `isImageAttachmentName` (a read) and, only in the `failed` arm,
`AttachmentFileIcon`'s existing bound — never an attribute in any arm, since `alt` is the client-owned
`ATTACHMENT_IMAGE_ALT`. The host-chosen bytes reach `URL.createObjectURL` inside the shipped singleton and
then one `<img> src`, never a second attribute, a log line or a lookup path. New in this component
specifically: an untrusted name now decides *whether a fetch happens at all* in the composer, where in the
bubble every drawn attachment was already recorded on a timeline item — but the name takes no part in the
request payload (`{ conversationId, attachmentId }`, built from this window's own values), so a lying name
produces only a picture that fails to decode, never a different file or a different request. Two properties
inherited rather than introduced: `awaitTerminal` sets no deadline, so a host that never answers leaves the
tile `pending` forever (identical to the bubble, and less visible in consequence — an empty 45×60 frame
rather than a thumbnail that never appears); and the host is authoritative for the picture the operator sees
before sending, since the upload leg retains no local copy — a hostile or buggy daemon answering
`request_attachment` with different bytes would draw a picture that is not the file about to be sent (the
send still names the attachment by id regardless of what drew, so the risk is misleading content, not
misdirected destination). Both are named follow-ups, not gaps this slice must close. See
`docs/specs/architecture/1263-image-attachment-tile.md` § Security review for the full write-up.

## Related

- [Composer attach](composer-attach.md) — the parent page: the button, the outcome line, in-flight
  progress, the copy module, and the CSS shared across the whole family.
- [Composer send § 10](composer-send.md#10-attachments-named-on-the-outbound-frame---takeattachments-1039-reworked-by-1055) —
  the read site for the take.
- [Thread timeline § Types](thread-timeline.md#types) — `MessageAttachment` and the `userText` fields the
  taken set feeds.
- [Conversation shell — message bubble § The attachment file
  row](conversation-shell-message-bubble-attachments.md#the-attachment-file-row-815-816) (#815) — the other
  consumer of `AttachmentFileIcon`, untouched by the lift.
- [Attachment image source](attachment-image-source.md) — the `attachmentImageSources` singleton #1263
  consumes as its second caller, alongside the bubble's thumbnails; the release-handle contract and refcount
  this page's tile relies on.
- [Attachment bytes](attachment-bytes.md) — the sole-writer rule for the app-private attachment directory,
  which is why #1263 fetches rather than retaining the picked file.
- #1264 (the remove control) and #1265 (the name-on-hover tooltip) are the next two slices of this family
  and are still open.
- [PR #1269](https://github.com/pyrycode/pyrycode-desktop/pull/1269),
  [PR #1270](https://github.com/pyrycode/pyrycode-desktop/pull/1270),
  `docs/specs/architecture/1039-record-sent-attachments-on-timeline-item.md`,
  `docs/specs/architecture/1262-composer-attachment-strip.md` and
  `docs/specs/architecture/1263-image-attachment-tile.md` for the full plans and their security reviews.
