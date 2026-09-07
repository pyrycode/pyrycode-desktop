# #1262 — a file tile per pending attachment above the message box

## Files read

- `src/renderer/src/screens/conversation/ComposerAttach.tsx` → `useAttachmentUpload`, `reducePendingAttachments`,
  `drainPendingAttachments`, `ComposerAttachOutcome` — the pending set, its take, and the sentence being cut. Its
  ref-not-state docblock names the drop window a naive `useState` opens; that paragraph shapes the whole state design.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `BubbleAttachmentRow`, `Composer` — the drawing to
  share, and the composer column the strip mounts into as `.composer`'s first child.
- `src/renderer/src/screens/conversation/attachmentUploadCopy.ts` → `attachmentUploadOutcomeCopy`, `COMPLETED_COPY` —
  the switch whose `completed` arm loses its sentence and keeps its exhaustiveness.
- `src/renderer/src/screens/conversation/attachmentExtensionLabel.ts` → `attachmentExtensionLabel` — the label
  derivation, already linear-time and already the only thing about a name that may be drawn.
- `src/renderer/src/screens/conversation/composerSend.ts` → `PendingAttachmentTake`, `ComposerSendDeps` — the take's
  contract, and the reason the take must stay one destructive act with a synchronous undo.
- `src/renderer/src/screens/conversation/conversation.css` → `.composer`, `.composer__row`, `.composer-status`,
  `.bubble__file-icon` / `-glyph` / `-ext` — the column's `--space-1` gap and 8px padding-top (which give the drawn
  8px above the strip for free), and the bubble's own three rules, which this ticket must leave byte-identical.
- `src/renderer/src/screens/conversation/ComposerAttach.test.tsx`, `attachmentUploadCopy.test.ts`,
  `ConversationScreen.test.tsx` § "the attachment file row" → the shipped assertions that pin the completion
  sentence and the bubble's markup.
- `e2e/composer-attach.spec.ts` → the `COMPLETED` push and the two negatives AC5 re-aims.
- `docs/knowledge/features/composer-attach.md` § the whole-attribute-run hazard → several shipped specs match
  `class="composer__attach-outcome"` as a whole run; nothing may be added to that run, here or in the bubble's.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=134-5013 — Attachment area
`390:7136`, the file variant `390:7217`, its slot `390:7182`, glyph `390:7147`, label `390:7149`.

A left-aligned row of 45×60 tiles between the status row and the message box. Read off the node boxes: the area sits
at x=0 — the same left edge as the status area and the `Input large` frame, **not** the x=16 the input's text starts
at — spans y=40..100 between a status area ending at 32 and an input beginning at 108, which is the drawn 8px above
and below; its four tiles sit at x = 0, 57, 114, 171, which is 45 wide with a 12px gap. Each tile is the `file-solid`
document outline with its extension centred across the lower half in body-small emphasised. The 20×20 badge at each
tile's top-right is #1264's remove control and the other three tiles' pictures are #1263's; neither is drawn here.

**The two inks, measured rather than read off the snippet.** `get_variable_defs` on `390:7217` resolves
`Schemes/Inverse Primary` to `#32628d` and `Schemes/Primary` to `#9dcbfc` — exactly this app's
`--color-inverse-primary` and `--color-primary`. The glyph's exported SVG bakes `stroke="#32628D"`, so the glyph is
`--color-inverse-primary`; the label is therefore `--color-primary`, which is what its own printed fallback
(`#9dcbfc`) says. **The generated snippet's variable NAME for the label is transposed** — it prints
`var(--schemes/inverse-primary, #9dcbfc)`, whose name and hex disagree — which is `tokens.css`'s standing warning
arriving in its rarer form: there the fallback hex lies and the name is true, here the name lies and the hex is true.
Neither is authoritative on its own; `get_variable_defs` plus the baked stroke are. The ticket's reading is confirmed
against the render: a mid-navy outline under a bright label.

## Context

The pending set an upload appends to is invisible: the only report a completion gets is one sentence beneath the
footer, and a pasted screenshot is a file the operator cannot see before sending it. This slice draws the set and, in
the same swap, removes the sentence — with a tile on screen the sentence says the same thing twice, and Juhana ruled
on 2026-09-05 that the tile is the report. They land together because either alone is wrong: no strip and no sentence
is a completion with no feedback at all; both is a double report.

Two things fall out that the plan has to answer rather than assume. The pending set has to become **rendered** state
without reopening the drop window its ref exists to close. And the drawing has to be **shared** with the message
bubble's file row without the bubble moving — including its two inks, which the bubble derives from a single
inherited `color` and the composer needs to differ.

No ADR is warranted: this adds no new state ownership rule, no new boundary, and no new dependency.

## Design

### 1. The shared drawing — `AttachmentFileIcon`

A new module, `src/renderer/src/screens/conversation/AttachmentFileIcon.tsx`, holding the glyph path and the label
overlay that `BubbleAttachmentRow` transcribes today. Contract:

```ts
function AttachmentFileIcon(props: {
  filename: string
  frameClassName: string
  glyphClassName: string
  labelClassName: string
}): JSX.Element
```

It renders the bubble's exact structure — a frame `<span>` holding the `viewBox="0 0 45 60"` `fill="none"`
`stroke="currentColor"` `aria-hidden` svg and an `aria-hidden` label `<span>` carrying
`attachmentExtensionLabel(filename)` — with the caller's three class names substituted verbatim.

**Why three class props rather than one shared class worn as a mix.** The bubble's `class="bubble__file-icon"` runs
are matched as whole attribute runs in `ConversationScreen.test.tsx`, and a lifted shared class would arrive in them
as a two-class mix — the degradation `composer-attach.md` records, where four assertions redden and a fifth passes
vacuously. Passing the caller's own class through makes the bubble's markup **byte-identical**, which is AC3 by
construction rather than by re-assertion, and it is why AC3 needs no new test: the shipped
`expect(markup).toContain('<span class="bubble__file-ext" aria-hidden="true">PDF</span>')` is already the detector.

**The two inks, without a second markup path.** The glyph keeps `stroke="currentColor"`, so the ink is whatever
`color` its own element resolves — and each consumer's *glyph class* is free to set that independently of the label's
class. The bubble sets neither and both halves keep inheriting the row's `color` exactly as today; the composer sets
`color: var(--color-inverse-primary)` on its glyph and `color: var(--color-primary)` on its label. One drawing, two
inks, no prop for a colour and no `style` attribute.

### 2. The strip — `ComposerAttachmentStrip`

In `ComposerAttach.tsx`, beside the outcome view it is the counterpart of:

```ts
function ComposerAttachmentStrip(props: { attachments: readonly MessageAttachment[] }): JSX.Element | null
```

`null` for an empty set — not an empty element — which is `ComposerAttachOutcome`'s shipped ruling applied one
component over, and the whole of "mounts no element and reserves no space": `.composer` is a flex column with a gap,
so an element that mounts empty moves the message box down on every launch forever. Otherwise a `.composer__attachments`
`<div>` holding one `AttachmentFileIcon` per attachment in the set's own (completion) order, keyed by array index —
`BubbleAttachmentRow`'s recorded reason: the list only appends and is cleared wholesale, so index identity is stable,
and a name-derived key is the step that makes `id={filename}` look natural next.

Every attachment draws the file tile, image or not. #1263 replaces the picture-bearing case and needs this tile as
its own undecodable fallback, so this is a shipped state rather than scaffolding.

### 3. Mount point and geometry

`ComposerAttachmentStrip` is `.composer`'s **first** child, above `.composer__row`. New rules in `conversation.css`:

- `.composer__attachments` — `display: flex`, `flex-wrap: wrap`, `gap: var(--space-3)` (the drawn 12px, in both axes,
  so the ticket's stated wrap assumption grows the strip by a second row rather than overflowing), and
  `margin-bottom: var(--space-1)`. That margin is arithmetic and is commented as such: the column's own gap is
  `--space-1`, and the drawing asks for `--space-2` between the strip and the message box. The 8px **above** needs no
  rule at all — `.composer`'s `padding-top: var(--space-2)` already sits between the status row and the column's first
  child, which is exactly the 32→40 the design draws. No horizontal padding: the strip's left edge is the composer's
  content edge, which is `.composer__row`'s own left edge, which is the design's x=0.
- `.composer__attachment` — the 45×60 frame: `position: relative` (the label's positioning context),
  `flex: 0 0 auto`, `display: block`, `width: 45px`, `height: 60px`, `border-radius: var(--radius-xs)`,
  `overflow: hidden`, and `color: var(--color-inverse-primary)` for the stroke. The clip is inert for a file tile
  (an outline drawn inside a 7px corner radius reaches nothing a 6px clip removes) and is drawn anyway because it is
  the slot's own clip in the design and #1263's picture is what it is for.
- `.composer__attachment-glyph` — `display: block`, the bubble's rule verbatim.
- `.composer__attachment-ext` — the bubble's overlay geometry (`position: absolute`, `top: 50%`, `left: 0`,
  `width: 44px`, `text-align: center`) plus the type this element does not inherit from a composer column that is not
  body-small: size, line, tracking and `--text-body-small-weight-emphasized`, and `color: var(--color-primary)`.

`composer__attachment*` shares no whole class token with `composer__attach`, `composer__attach-outcome` or
`composer__attach-progress`, so no shipped locator or attribute-run assertion can reach it.

### 4. The completion sentence's cut

`ComposerAttachOutcome` gains one branch above the others: a `completed` event renders `null`. The outcome element's
attribute run is untouched, and the `role="status"` region simply does not mount for a completion — so a completion
no longer announces to assistive technology, which is accepted here and, if wanted later, is a client-owned constant
in a live region on the strip and never the filename.

`COMPLETED_COPY` loses its only consumer and goes. The `completed` arm of `attachmentUploadOutcomeCopy` **stays**,
returning `''`: that switch carries no `default` on purpose, and deleting the arm would give up the compiler's
exhaustiveness check — which has fired for real twice (#864's `progress`, #999's two retrieval codes). The empty
string is unreachable in production, because the one view that calls this function returns before it for a completion.

## State + concurrency model

The pending set stays in `pendingRef` and stays authoritative for the take. A `useState` mirror is added **beside**
it for display only, and both are written from the same fold in the same listener call:

```ts
const next = reducePendingAttachments(pendingRef.current, event)
pendingRef.current = next        // what the click reads, synchronously
setPending(next)                 // what the strip draws
```

This is the shape the ref's own docblock demands rather than a departure from it: the drop window it names — a
completion arriving after the last commit but before the click — is a window in what the **click** reads, and the
click still reads the ref. State that only draws cannot open it. The two cannot disagree about which events happened,
because one fold feeds both.

`drainPendingAttachments` is **unchanged** — same signature, same one-act take-and-clear over a `{ current }` holder,
same synchronous rollback. The display mirror rides along through a new pure function beside it:

```ts
function mirrorTakeToDisplay(
  take: PendingAttachmentTake,
  showPending: (attachments: readonly MessageAttachment[]) => void
): PendingAttachmentTake
```

which empties the display, and hands back a take whose `rollback` restores the ref (by calling the wrapped rollback
first) and then the display. It is pure and framework-free for this file's established reason: the hook is reachable
by no tier this repo has — no DOM, no `renderHook` — so a rule living inside it would be provable nowhere.
`takePendingAttachments` becomes `mirrorTakeToDisplay(drainPendingAttachments(pendingRef), setPending)`.

Ordering is unchanged and stays sound for the reason the shipped docblock gives: `submitMessage` takes, sends and
rolls back with no `await` between, and the listener runs as a separate task, so nothing can arrive in the gap. The
`setPending` calls are display-only, so React's batching cannot affect what a send records. Who may take is likewise
untouched — `submitMessage` reads `takeAttachments` below both of its `false` returns, so a blank Enter and a submit
with no active conversation still never reach it and the tiles stay.

Lifetime: no new subscription, no new timer, nothing to cancel. The conversation switch clears the strip for free —
`PairedShellView` keys the chat pane on the conversation id, so the composer is rebuilt with a fresh ref and a fresh
empty mirror. The question panel's cover (#906) hides the strip along with the rest of `.composer`, because the strip
is a child of the element that wears `hidden`.

## Error handling

No new failure mode and no new boundary: nothing here calls the bridge, and the strip is a pure function of a set the
composer already holds. A refusal, a failure and an in-flight `progress` each return the set unchanged from
`reducePendingAttachments` (the same reference, structurally), so they draw no tile and keep reporting themselves
through the outcome line exactly as today. A `completed` event whose `filename` is empty or has no usable extension
draws a tile with an empty label — `attachmentExtensionLabel`'s designed empty case, and the glyph holds the tile's
size regardless. A hostile `filename` is discussed under § Security review.

## Testing strategy

**Unit (vitest, static server render).**
- `AttachmentFileIcon`: renders the caller's three class names verbatim; the glyph is `fill="none"` with
  `stroke="currentColor"` and is `aria-hidden`; the label is the extension and is `aria-hidden`.
- `ComposerAttachmentStrip`: an empty set renders `''` — a bare equality, never a `not.toContain`, which would pass on
  an empty element holding the slot; one tile per attachment in order; the label is drawn and the filename,
  the `attachmentId` and any path-shaped input are not.
- `ComposerAttachOutcome`: a completion renders `''`; the existing arms are re-aimed off `completed` onto a terminal
  that still draws (the completion cases in the `arms` table, the `<div>`-not-`<p>` case and the
  mutual-exclusion case each move to `failed`).
- `attachmentUploadOutcomeCopy`: the `completed` arm returns no sentence, and the failure sentences are unchanged.
- `mirrorTakeToDisplay`: the take empties the display; `rollback` restores both holder and display; the returned
  `attachments` is the same reference the wrapped take claimed.
- AC3 needs **no new test** — it is the shipped `ConversationScreen.test.tsx` byte-string assertions on
  `class="bubble__file"`, `class="bubble__file-ext"` and the row's ordering, which redden on any drift.

**e2e (fake transport, `e2e/composer-attach.spec.ts`).** The geometry, the completion's silence and the send-clears
are layout and lifecycle, which the static tier has neither of. Extending the shipped spec rather than adding one, so
the launch is shared and the sequence stays one story: with nothing pending the strip has count 0 and the message box
is where it was; a pushed `COMPLETED` draws exactly one tile, 45×60, left edge on `.composer__row`'s, 8px clear of
the status row above and the message box below; a second completion draws a second tile 12px after the first, in
completion order; the outcome line has count 0 throughout and a pushed `progress` is gone the moment the tile draws;
the two shipped negatives (`uploadId`, `filename`) are re-aimed at the strip, where they now guard a mounted element;
a blank Enter leaves the tiles; a send empties the strip and returns the message box to its launch position.
Rounded deltas are compared with `toBeCloseTo(…, 0)` per #868's `-0` rule.

The rollback arm is **deliberately not** in e2e: `window.pyry` is a frozen `contextBridge` object, so a throwing
bridge cannot be staged from the page, which is why #1055 proved its own rollback in `composerSend.test.ts`. The
display half is `mirrorTakeToDisplay`'s unit test above, and the record half is that shipped spec.

**The four specs that will now draw a tile** — `attachment-file-row`, `attachment-image-open`,
`attachment-image-thumbnail`, `thread-scroll-pin` — each push a completion and then send, so the strip is up only
between those two steps. `thread-scroll-pin` is the one to check first, since it reasons at length about the composer
shrinking the thread's viewport; its measurements are all taken after the sends. The proof is a green `npm run e2e`,
and any repair belongs in this PR.

`real-claude-attachment.spec.ts` asserts the completion sentence and is in the real-claude tier, which this fork does
not gate automatically — it is re-aimed here and the PR says the operator's `npm run e2e:real:gate` run is what
confirms it.

## Open questions

1. Does the strip appearing and disappearing perturb `thread-scroll-pin`'s anchoring proof? Resolved by running it.
2. Does `.composer__row`'s left edge equal the tile's after the flex column's `align-items: stretch`? Resolved by the
   e2e geometry assertion rather than by reading the stylesheet.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] SHOULD FIX — a hostile `filename` reaches a NEW rendered element, and only the label may go
  through.** The boundary is `ipcRenderer.on(ATTACHMENT_UPLOAD_EVENT_CHANNEL)`, where the declared type is the
  compile-time half only; `filename` is the operator-supplied string that crosses it and, unlike everything else on
  that channel, is not a literal written in this repo. This slice adds the first composer-side DOM sink for it, and
  the design admits only `attachmentExtensionLabel(filename)` — `[A-Za-z0-9]` capped at four characters, so a
  crafted name cannot widen the tile, and linear-time, so it is not a ReDoS shape on a per-render path. In Phase B:
  the raw `filename` must reach no attribute, no `title`, no `alt`, no URL, no `dangerouslySetInnerHTML`, no React
  key and no log line, and the label must be escaped React children. Asserted directly by the strip's unit test
  against a name carrying markup and a path.
- **[Trust boundaries] No findings on the id.** `attachmentId` is a host-side storage handle with no display value;
  it is not rendered and is not used as the React key (index is, per `BubbleAttachmentRow`), so it reaches no
  attribute and no text node — which is what re-aiming AC5's shipped negative at the tile now actually guards.
- **[Tokens, secrets, credentials] Not applicable** — nothing here reads, stores, or transports a credential. The
  strip is a pure function of a set the composer already holds.
- **[File / storage operations] Not applicable, and that is a property to preserve** — no path is constructed, read
  or resolved. The renderer never learns a path: `dropAttachmentFile` resolves it inside the preload and it never
  comes back. The label derivation is explicitly not a sanitiser (`attachmentExtensionLabel`'s docblock), and this
  ticket must not make it one — the name a save writes is sanitised in main, and a second, divergent cleaner on this
  side would make what the operator sees differ from what a save writes.
- **[Inter-process / Electron attack surface] No findings** — no `contextBridge` member, no `ipcMain` channel and no
  window preference changes. The strip subscribes to nothing new; it reads the listener the hook already owns.
  Nothing crosses toward main at all: the drawing is one-way.
- **[Cryptographic primitives] Not applicable** — no randomness, no comparison against a secret, no key material.
- **[Network & I/O] Not applicable** — no socket, no fetch, no subresource. The glyph is **inlined**, never
  referenced: Figma's export hands back an `https://` asset URL, and shipping it would put a remote subresource in a
  renderer whose CSP is `default-src 'self'` — failing closed, but also an outbound request to a third party on every
  render. This is `BubbleAttachmentRow`'s shipped ruling and the shared component inherits it.
- **[Error messages, logs, telemetry] No findings** — this slice adds no log call, and the design forbids one that
  could carry a name. It *removes* a user-facing sentence and adds none; the refusal and failure sentences are
  untouched and each remains client-authored rather than daemon-selected.
- **[Concurrency] No findings, one race explicitly considered.** No new async task, timer, listener or abort path.
  The check-then-act question is real and is answered by the design: the ref stays the take's single reader/writer
  and the added `useState` is display-only, so a completion arriving between React's last commit and the click is
  still in the set the click reads. The reverse race — a rollback restoring stale display over a newer arrival —
  cannot occur, because `submitMessage` takes, sends and rolls back synchronously and the listener runs as a
  separate task. **Phase B must not** make the take read the mirrored state; that substitution is exactly the drop
  window the ref exists to close, and it would fail silently.
- **[Threat model alignment] Hostile daemon: addressed.** The daemon cannot reach this channel — `filename` is
  minted by our own background process from the operator's own picked file — but a compromised main process could,
  which is why the label's character class and cap, rather than trust in the sender, are what bound the tile. A
  malicious relay is content-blind here and can at worst withhold a completion, which draws no tile. Renderer
  compromise reaching the transport is unchanged: this slice adds no capability to the window.
- **[Out of scope]** The remove control (#1264), the tooltip that would put the raw name on screen (#1265) and the
  picture inside an image tile (#1263). #1265 in particular inherits an obligation this slice does not discharge: a
  255-byte, bidi-capable name in a tooltip is a layout and a spoofing question, and `attachmentExtensionLabel`'s
  note for #816 is where the reasoning starts.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
