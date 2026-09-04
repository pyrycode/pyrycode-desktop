# #816 — make the attachment file row a download control

Wires the file row #815 drew to the two background-process channels that already exist: fetch the
attachment back from the host (#996), then, on that fetch's `completed` terminal and only then, ask the
save channel (#814) to copy it into Downloads. Split from #686.

## Files read

Codegraph was not consulted: every `mcp__codegraph__*` call in this repo answers "CodeGraph not
initialized", so this list was built with Grep and Read. The gap is recorded here rather than worked
around silently.

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `BubbleAttachmentRow` — the row this
  ticket turns into a control, and `BubbleMeta` beside it, whose copy control is the in-bubble precedent
  for a `<button>` that calls a module-level helper and drills no prop.
- `src/renderer/src/screens/conversation/conversation.css` → `.bubble__file`, `.bubble__file-icon`,
  `.bubble__file-ext`, `.bubble__copy` — the row's shipped box, and the sibling control's own button
  reset plus its `:hover` / `:focus-visible` treatment, which this row follows rather than inventing.
- `src/shared/ipc/attachmentRetrieval.ts` → `AttachmentRetrievalRequest`,
  `isAttachmentRetrievalRequest`, `MAX_RETRIEVAL_IDENTIFIER_LENGTH`, `AttachmentRetrievalEvent` — the
  fetch ask's shape, its boundary guard, and the terminal this slice sequences on.
- `src/shared/ipc/attachmentSave.ts` → `AttachmentSaveRequest`, `isAttachmentSaveRequest`,
  `MAX_SAVE_IDENTIFIER_LENGTH`, `AttachmentSaveEvent` — the save ask, and its header's ruling that the
  name crosses as untrusted display-derived text which main re-sanitises.
- `src/preload/index.ts` → `requestAttachment`, `onAttachmentRetrievalEvent`, `saveAttachment`,
  `onAttachmentSaveEvent` — all four already exposed, all four documented "no caller is wired yet — the
  click that calls this is #816". Nothing is added to the bridge here.
- `src/main/attachmentRetrieval.ts` → `ATTACHMENT_MAX_CONCURRENT_RETRIEVALS` (4) and the `inFlight` map
  — the two facts the e2e design turns on: a duplicate ask for an attachment already in flight puts NO
  second envelope on the wire, and four distinct attachments fit under the cap.
- `src/renderer/src/store/threadTimeline.ts` → `MessageAttachment` — `{ attachmentId, filename }`, whose
  field names are already `AttachmentSaveRequest`'s so the save ask takes the record with no remap.
- `src/renderer/src/store/conversationLastReadBridge.ts` → `conversationLastReadDeps` — the
  `getOpenConversationId` getter this plan duplicates a third time, and the comment recording that a
  third consumer is the trigger for a shared selector.
- `src/renderer/src/store/activeConversationStore.ts` → `activeConversationStore`,
  `selectActiveConversation` — the singleton read outside React.
- `src/renderer/src/activateConversation.ts` → `setActiveConversation` runs unconditionally on both the
  create and the open branch, which is what makes the id available in the fake tier.
- `src/renderer/src/screens/conversation/copyMessageText.ts` — the module-helper shape (one function,
  one sink, no React) and the renderer's content-free `console.error('<event name>')` logging posture.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` § "the attachment file row" — the
  four static assertions this ticket must keep green, including the byte-string pin
  `data-thread-role="user">here is the report<div class="bubble__file">` that a tag change reddens.
- `e2e/attachment-file-row.spec.ts` — the geometry spec, its `decodeEnvelope` seam and its
  `AttachmentUploadEvent` push helper, both reused here.
- `docs/knowledge/features/conversation-shell-message-bubble.md` § The attachment file row (#815) — the
  AC5 measurement (`.bubble`'s inherited `word-break: break-word` is what makes the long name wrap;
  `.bubble__file-name` ships with no CSS at all) and the bidi deferral this slice must not weaken.
- `docs/knowledge/features/attachment-save.md`, `docs/knowledge/features/attachment-retrieval.md` — the
  save channel does not fetch, and the retrieval leg deliberately keeps no name.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4605 (the file field), inside
the bubble at https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=121-3860

Read as a screenshot: a 45×60 outlined document glyph with `PDF` across its lower half, and the filename
beside it in one body-small line, all in the same blue. One appearance, no hover, focus, pressed, pending
or error state — exactly what #815 already ships. **This slice draws nothing new.** The one visual
addition is a focus indicator, which AC 1 forces and the drawing does not supply; it takes
`.bubble__copy:focus-visible`'s shipped treatment (`outline: 1px solid var(--color-outline)`) rather
than inventing one. Everything else the change touches is a button's UA styling being reset back to the
row already drawn.

## Context

The row is drawn but inert. This ticket makes it a control and wires it — and the wiring is two asks,
not one, because the save channel does not fetch and nothing else puts a timeline attachment in the
directory it copies from. A click wired straight to the save channel would answer `source-unavailable`
on every activation forever while satisfying a criterion that reads "sends the identifier to the save
channel". The ticket body verified that against all three merged blockers; this plan takes it as given
and sequences fetch → `completed` → save.

Three things this slice deliberately does not build: a pending state, a failure state, and any shared
fetch-then-act machinery for #868/#869. AC 4 says every non-`completed` terminal draws nothing, and the
Open Question at the foot of the ticket records both gaps as needing a Figma node and their own ticket.

**Size, re-counted against this written plan.** Three production source files, one new exported
interface, one call site, four acceptance criteria, no state machine — every line of the size table
holds except total written work, which lands around 900 lines against a 800 ceiling. **Stated rather
than split, and the floor is why.** The only seam is fetch / save, and the fetch leg's sole consumer is
the save leg inside the same activation: a child holding it would be consumed by exactly one sibling in
its own family, which is the floor rule, and the floor beats the ceiling. The split-depth walk agrees
that a split would be *permitted* (parent #686, no grandparent) — it is simply the wrong cut. The
refiner reached the same conclusion from the same two rules; this is a re-derivation, not a deferral.

**Worth an ADR? No.** Nothing here decides anything the three merged blockers did not already decide;
this is the first consumer of decisions already recorded in `attachment-save.md` and
`attachment-retrieval.md`. The documentation phase should fold this into
`conversation-shell-message-bubble.md` § The attachment file row and update `attachment-save.md`'s
"wiring its click to this channel is still #816, not yet started".

**One observation for a future three-line ticket.** `conversationLastReadBridge`'s comment records that
its `getOpenConversationId` getter is duplicated from `App.tsx` and that "two consumers is the signal
that a `selectOpenConversationId` selector on `activeConversationStore` would have a home — a separate
three-line ticket for whoever needs a third." This plan is the third. It duplicates the getter again
rather than refactoring (CLAUDE.md: don't refactor adjacent code while you are there) and records the
trigger here.

## Design

### 1. `downloadAttachment.ts` (new) — the sequencing, React-free

`src/renderer/src/screens/conversation/downloadAttachment.ts`, beside `copyMessageText.ts` and for its
recorded reason: the renderer test tier is static server renders with no DOM and no click, so an effect
reachable only from an `onClick` would otherwise be unprovable. One function, injected effects, and a
module-level production deps object.

```ts
export interface AttachmentDownloadDeps {
  getOpenConversationId: () => string | null
  requestAttachment: (request: AttachmentRetrievalRequest) => void
  onAttachmentRetrievalEvent: (listener: (event: AttachmentRetrievalEvent) => void) => () => void
  saveAttachment: (request: AttachmentSaveRequest) => void
}

/** One activation of one row. Subscribes, asks, and on that ask's own `completed` terminal asks the
 *  save channel. Never throws; every other terminal is silent. */
export function downloadAttachment(deps: AttachmentDownloadDeps, attachment: MessageAttachment): void

/** The production wiring — `window.pyry` dereferenced inside the arrow bodies only, never at module
 *  load and never during render (the `conversationLastReadDeps` / `runConfigLive` idiom). */
export const attachmentDownloadDeps: AttachmentDownloadDeps
```

Behaviour, in order:

1. Read the open conversation. `null` → log and return, having subscribed to nothing and asked nothing.
2. Refuse an ask the retrieval boundary guard would drop — **either** identifier empty or over
   `MAX_RETRIEVAL_IDENTIFIER_LENGTH` → log and return. **This is a listener-lifetime precondition, not
   a second security gate.** A dropped ask yields no event at all, so a subscription taken for one would
   outlive the activation forever; refusing here is what makes "at most one listener per activation,
   torn down on its own terminal" true by construction. It is a SIZE and non-empty check only —
   canonicity stays the single gate at `resolveAttachmentPath`, and the bound is imported from
   `attachmentRetrieval.ts` rather than restated, so there is no number to drift.

   **BOTH identifiers, and the conversation id is the one that matters.** `attachmentId` is client-side
   in origin (main mints the upload id and the timeline records it), so bounding it is hygiene. The
   conversation id is not: `activeConversationStore` holds the daemon's `ConversationCreatedPayload`
   **verbatim** off the wire, so a hostile or buggy daemon chooses that string. Checking only the
   attachment id would leave a remote party able to make every activation's ask fail the guard while
   this helper subscribes for it — one accumulated listener per click, driven by remote input. This is
   the security review's MUST FIX against the first draft of this plan, which checked the attachment id
   alone.
3. Subscribe, **then** ask — in that order. A `busy` or `not-connected` retrieval resolves immediately
   in main, so subscribing after the ask is a race by construction even though the bridge happens to be
   asynchronous today. Pinned by a test that asserts the subscribe ran before the ask.
4. The listener ignores every event whose `attachmentId` is not this row's, unsubscribes on the first
   one that is, and calls `saveAttachment({ attachmentId, filename })` only for `type: 'completed'`.
   `failed` unsubscribes and does nothing but log.

The unsubscribe handle is held in a `let` the listener reads through, with a `settled` flag, so a bridge
that fired synchronously during subscription would still tear down exactly once. Two lines, and they are
what make the lifetime claim independent of a preload implementation detail.

**No save-event subscription.** AC 4 draws nothing on a save failure, so there is no consumer; adding a
second subscription purely to log would double a listener's lifetime for a line main already owns.

**No local-cache check and no de-duplication of activations.** The ticket is explicit that a second
activation simply fetches again. Main's own `inFlight` map already collapses a duplicate ask for an
attachment already being fetched into the live retrieval's single terminal, which both listeners see.

### 2. `BubbleAttachmentRow` — the row becomes the control

`<div className="bubble__file">` becomes `<button type="button" className="bubble__file" onClick=…>`,
with `type` written first so the rendered attribute run matches `.bubble__copy`'s. Children unchanged:
the icon span (glyph + `aria-hidden` extension overlay) and the name span.

**The accessible name comes from the button's own text content — no `aria-label`.** The button's name is
computed from its contents, the extension overlay is already `aria-hidden`, so the name is exactly the
filename, satisfying AC 1's "includes the file name the row draws". Deliberately not an `aria-label`:
#815 recorded that this name reaches the DOM as auto-escaped React children only and "never an
attribute, a title, an alt, a URL", and there is no visually-hidden utility in this repo to prefix a
client-owned verb with (`PairingScreen` records that adding one is unticketed). A content-derived name
is the one shape that satisfies the criterion without opening the attribute sink #815 closed.

**One tab stop, and Enter/Space for free.** A real `<button>` rather than a `div` with a handler — the
`ChannelList` row's recorded reason: keyboard activation and screen-reader semantics come for free
rather than being rebuilt. Neither child takes a `tabIndex`.

`attachmentId` is still rendered nowhere. It reaches the click closure only, exactly as #815 predicted.

### 3. `conversation.css` — resetting a button back to the drawn row

`.bubble__file` gains the reset a `<button>` needs for #815's measured geometry to survive:
`width: 100%` (reproducing the block-level `div`'s box exactly, so no assertion depends on how a UA
sizes a `display: flex` form control), `padding: 0`, `border: none`, `background: transparent`,
`color: inherit` is already implied by the rule's own `color`, `font-family: inherit` (the rule already
restates the other four body-small axes but not the family, which a button's UA font would otherwise
win), `text-align: left` (a button's UA `center` would centre a wrapped name's lines) and
`cursor: pointer`.

`word-break` is inherited and inherits into a button, so #815's AC5 measurement — `.bubble`'s
`break-word` is what collapses the name's automatic minimum size — is unaffected, and
`.bubble__file-name` still ships with no CSS of its own.

Two new rules follow `.bubble__copy`'s shipped treatments verbatim rather than inventing one:
`.bubble__file:hover { color: var(--color-primary) }` and
`.bubble__file:focus-visible { outline: 1px solid var(--color-outline) }`. The drawing has no hover or
focus state; the copy control in the same bubble already answered that question, and AC 1 forces the
focus half.

## State + concurrency model

No store slice, no reducer, no React state. The activation's whole state is two locals in one function
call: the unsubscribe handle and a `settled` flag.

**The one long-lived thing is the retrieval subscription, and its cancellation path is its own
terminal.** Every ask that passes main's boundary guard yields exactly one terminal — including
`timed-out`, which is what detects a stream that simply dies — so the listener is torn down on the first
event naming this attachment. The only way an ask yields no terminal is being dropped at the guard,
which step 2 above makes unreachable from this helper. No `AbortController` is threaded: there is
nothing to abort, only a listener to remove, and the ipcRenderer listener does not outlive the terminal.

The listener is deliberately **not** scoped to the component's lifetime with a `useEffect` cleanup. An
activation is a user action whose completion should not depend on the row staying mounted — the thread
re-renders constantly — and an unmount mid-fetch leaves at most one listener that removes itself when
the terminal arrives. Three activations of three rows are three independent listeners; main caps
concurrent retrievals at four and collapses duplicates for the same attachment.

## Error handling

Every failure is silent in the UI and logged content-free. There is no result type to thread: both
channels are fire-and-forget with a pushed terminal.

| Where | Outcome | What happens |
|---|---|---|
| No open conversation | no ask at all | `console.error('attachment download without an open conversation')` |
| Identifier the guard would drop | no ask at all | `console.error('attachment download refused a malformed identifier')` |
| Retrieval `failed` (any of eleven reasons) | nothing drawn, row still activatable | `console.error('attachment download fetch failed', reason)` |
| Save `failed` / `saved` | nothing drawn | not observed here; main owns its own logging |

The retrieval reason is logged **with** its value, and that is safe by the type rather than by care:
`AttachmentRetrievalFailure` is a closed set of client-owned string literals, so it provably carries no
daemon text, no filename, no digest, no host path and no local path. Nothing else is logged — not the
filename, not the identifier, not a caught error object.

AC 4 is satisfied structurally rather than by a branch: with no pending state and no disabled state, the
row is activatable at every instant, so "leaves the row activatable again" is a property of there being
nothing to reset.

## Testing strategy

**Static tier — `downloadAttachment.test.ts` (new), plain vitest, no React, no DOM.** Fakes for all four
deps; each scenario asserts on recorded calls.

- The ask carries exactly `{ conversationId, attachmentId }` — no filename key, no path key, no extra.
- Subscribe happens before the ask (ordering, recorded on a shared call log).
- `completed` for this attachment → exactly one save ask, `{ attachmentId, filename }` and nothing else.
- `failed` for this attachment → no save ask, and the listener is torn down.
- An event naming a **different** attachment → ignored, listener still live, then the real terminal
  still saves.
- A second event after the terminal → no second save.
- No open conversation → no subscribe and no ask.
- An empty and an over-`MAX_RETRIEVAL_IDENTIFIER_LENGTH` **attachment** id → no subscribe and no ask.
- An over-`MAX_RETRIEVAL_IDENTIFIER_LENGTH` **conversation** id → no subscribe and no ask. The security
  review's MUST FIX: this is the identifier a hostile daemon chooses, so it is the one whose absence
  would let remote input accumulate listeners.
- Two activations of two attachments are independent: two asks, two terminals, two saves.
- The filename crosses **verbatim** — a name carrying `../`, a bidi control and a leading dot is neither
  sanitised, trimmed nor normalised on this side.

**Static tier — `ConversationScreen.test.tsx` § the attachment file row (edits).** The tag change
reddens the existing byte-string pin, which is the point of that pin; it is updated, not deleted. Added:
the row renders as `<button type="button">`; it carries no `aria-label` and no `tabIndex`, so its
accessible name is its text content; `attachmentId` still appears nowhere in the markup; two attachments
still render two independent buttons.

**Playwright fake tier — a second `test()` in `e2e/attachment-file-row.spec.ts`.** The click cannot be
driven in the static tier at all, and the round trip must not be driven to completion here: a real save
copies into the real Downloads folder and opens a Finder window on whoever ran the suite. The division
the ticket prescribes: the **fetch ask** is observed on the wire, the **fetch-terminal → save ask**
sequencing is the static tier's.

Three completed uploads on three sent messages give three rows with three distinct identifiers — which
is load-bearing, because main puts no second `request_attachment` on the wire for an attachment already
in flight, and four is the concurrency cap. `buildReplyFrames` answers `send_message` and
`request_attachment` with no frames at all, so all three retrievals stay open, nothing reaches
`completed`, no save is asked and no folder opens. Asserted:

- Click row 1, `Enter` on row 2, `Space` on row 3 → three `request_attachment` envelopes decoded off the
  wire, each naming the seeded conversation and its own row's attachment id, and nothing else.
- The row is a `<button>`, is the focused element after a keyboard interaction, matches
  `:focus-visible`, and draws the outline; neither the icon nor the name is separately focusable.
- The button reset did not disturb the drawn box: row height 60, icon 45×60, name 12px right of the
  icon, meta row 12px below — the same constants the first test already holds.

The whole-suite run belongs to the verifier's gate; this run verifies the touched files plus
`npm run build`.

## Open questions

1. Does a `<button>`'s UA `white-space` or `align-items` disturb the first test's geometry beyond the
   reset listed above? Resolved by running that spec in Phase B, not by reasoning — #815 already
   measured that this row's layout defies prediction. Any additional declaration lands with a comment
   naming the assertion that demanded it.
2. Does `:focus-visible` match after `locator.press()` in this Chromium build? If it proves
   environment-dependent the assertion narrows to "the row is `document.activeElement` after a keyboard
   interaction", and the outline check is dropped rather than made flaky. Recorded in `## Revisions` if
   it changes.

Both are verification questions with no design fork behind them; neither can change the contract above.

## Security review

**Verdict:** PASS (second pass — the first returned FAIL on the trust-boundary finding below, and the
Design was revised inline before this section was written).

**Findings:**

- **[Trust boundaries] MUST FIX — fixed in this plan before commit.** The first draft's listener-lifetime
  pre-check bounded `attachmentId` only. `attachmentId` is client-side in origin, but `conversationId`
  is not: `activeConversationStore` holds the daemon's `ConversationCreatedPayload` **verbatim** off the
  wire (`activeConversationStore.ts` — "holds the payload VERBATIM, no camelCase remap"), so a hostile
  or buggy daemon chooses that string. An id over `MAX_RETRIEVAL_IDENTIFIER_LENGTH` makes
  `isAttachmentRetrievalRequest` drop every ask, so no terminal is ever pushed, so the subscription
  taken for it never tears down — one leaked ipcRenderer listener per activation, chosen remotely.
  Design § 1 step 2 now bounds **both** identifiers, and `downloadAttachment.test.ts` carries the
  conversation-id case as its own test rather than as a variation of the attachment-id one.
- **[Trust boundaries] No further findings.** The renderer→main crossing stays a single explicit
  boundary per channel — `isAttachmentRetrievalRequest` and `isAttachmentSaveRequest` — re-checked in
  main unconditionally. Nothing in this plan touches either guard, and the renderer-side pre-check is a
  strict subset of the retrieval one (size + non-empty), imported rather than restated, so it cannot
  diverge and cannot be mistaken for authorisation. Canonicity remains the single gate at
  `resolveAttachmentPath`, uncopied on this side.
- **[Tokens, secrets, credentials] Not applicable — stated, not skipped.** No token, key, credential or
  `safeStorage` value is read, written, logged or forwarded. `attachmentId` is a storage handle, not a
  capability: main resolves it *inside* the app's own attachment directory, so holding one grants
  nothing the window does not already have.
- **[File / storage operations] No findings.** The renderer builds, joins and forwards no path (AC 3) —
  structurally, since it holds none. `filename` becomes a path component only in main, where
  `sanitizeAttachmentFilename` re-runs on the value the path is actually built from. **The plan
  deliberately adds no renderer-side sanitiser**, and `downloadAttachment.test.ts` pins the verbatim
  crossing with a name carrying `../`, a bidi control and a leading dot — a second sanitiser here would
  make what the operator *sees* diverge from what a save *writes*, which is worse than the tidiness.
- **[File / storage operations] Residual, deferred with its mitigation already shipped: extension
  spoofing.** Making the row a control is what gives a spoofed name (`report<U+202E>gpj.exe`, reading
  as `report…jpg.exe`) something to mislead the operator *into*. #815 deferred the class here but landed
  the mitigation: `attachmentExtensionLabel`'s `[A-Za-z0-9]` filter drops bidi controls, so the overlay
  keeps drawing the true extension when the name run renders reversed, and `attachmentExtensionLabel.test.ts`
  pins it. This slice's obligation is only not to weaken it — so the overlay keeps its content and its
  `aria-hidden`, and no renderer-side rewrite of the name is introduced. Carried into Phase B as a check
  that `attachmentExtensionLabel.test.ts` and the overlay assertions stay green untouched.
- **[Inter-process / Electron attack surface] No findings, and this is the strongest reason the slice is
  low-risk.** No new IPC channel, no new `contextBridge` method, no new `ipcMain` registration, no
  `webPreferences` change, no custom protocol, no navigation, no remote content. All four bridge methods
  already ship, each documented "no caller is wired yet — #816". **This ticket adds a UI caller, not a
  capability**: a compromised renderer could already call `saveAttachment` and `requestAttachment` from
  DevTools before it. The filename reaches the DOM as auto-escaped React children only — no `aria-label`,
  no `title`, no `id`, no `data-*` — which is why the accessible name is content-derived, and
  `ConversationScreen.test.tsx` asserts the absence of the attribute rather than trusting the review.
- **[Cryptographic primitives] Not applicable — stated, not skipped.** No RNG, no hash, no key, no
  handshake. The listener's `event.attachmentId !== attachment.attachmentId` test is a correlation-key
  comparison, not a secret compare: both sides are this window's own value and neither is a secret, so
  `===` is correct and `timingSafeEqual` would be meaningless ceremony.
- **[Network & I/O] No findings.** No socket, URL, TLS decision or frame cap is made here. The relay
  round trip's `maxPayload`, connect/idle deadlines and the `timed-out` terminal are all main's,
  established by #996 and unchanged. **No file name reaches a URL** (AC 3) structurally — the renderer
  constructs no URL at all.
- **[Error messages, logs, telemetry] No findings.** Three `console.error` lines, two of them a bare
  client-owned event name. The third carries `AttachmentRetrievalFailure`, whose every inhabitant is a
  string literal written in this repo — provably no daemon text, no filename, no digest, no host path,
  no local path. Nothing logs the filename, the attachment id, the conversation id, or a caught error
  object. This is `questionResolution` / `copyMessageText`'s posture, not `composerSend`'s
  `console.error(msg, error)`.
- **[Concurrency] No further findings beyond the fixed MUST FIX.** No `await`, so no check-then-act race
  across one. `settled` makes double-fire a no-op. Above main's cap of 4 concurrent retrievals the extra
  asks answer `busy` — which is still a terminal, so the listener tears down and the cap leaks nothing.
  A duplicate ask for an attachment already in flight is collapsed in main and answered by the live
  retrieval's own terminal, which **every** registered listener receives (`webContents.send`), so two
  clicks on one row yield two save asks and two Downloads copies. Accepted, not a finding: the ticket
  states that a second activation simply fetches again, and the collision suffix is #814's.
- **[Threat model alignment] Named, and each either addressed or deferred.** *Malicious / compromised
  relay*: on-path and content-blind — it can drop, delay or reorder the stream, which the idle deadline
  answers with `timed-out`, drawing nothing and tearing the listener down; it cannot forge a `completed`
  without the Noise session. *Hostile daemon response*: the returned bytes may not be what the name
  implies — **and this slice does not open or execute them.** The save reveals the file with
  `shell.showItemInFolder` (select, not launch), which is #814's ruling and is not reopened here; the
  #867 open leg is a separate, already-landed channel this row does not call. *Hostile daemon supplying
  the conversation id*: the MUST FIX above. *Renderer compromise reaching the transport*: unchanged —
  no key, socket, path or raw byte becomes reachable from the window.
- **[Threat model alignment] Accepted coupling, non-exploitable.** `MAX_SAVE_IDENTIFIER_LENGTH` and
  `MAX_RETRIEVAL_IDENTIFIER_LENGTH` are both 256 today, so an id that passed the fetch always passes the
  save. Were they ever to diverge downward on the save side, the consequence is a save ask silently
  dropped after a successful fetch — nothing drawn, per AC 4, and no listener is live by then. Recorded
  rather than defended against: adding a third bound here would be the divergent-checks shape again.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-04

## Revisions

### 2026-09-04 — both Open Questions resolved by measurement, no design change

Recorded rather than deleted, because "we predicted a risk and measured it away" is the useful half.

1. **A `<button>`'s UA styling needed exactly the six declarations the plan listed, and no seventh.**
   `e2e/attachment-file-row.spec.ts`'s existing #815 test passed unchanged on the first run with the
   reset in place — every drawn constant it measures (row top 48, row height 60, icon 45×60, name 12px
   right of the icon, meta rhythm 12, and all five AC5 reads on the 184-character space-free name) held.
   No `appearance: none`, no `white-space`, no `align-items` override and no `min-width` was needed. The
   new test re-reads four of those constants plus `text-align` on a row that is now a form control, so
   the reset has its own detector rather than relying on #815's test to notice.
2. **`:focus-visible` matches after `locator.press()` in this Chromium build**, so the assertion stayed
   as planned: after the `Space` activation the row is `document.activeElement`, matches
   `:focus-visible`, and computes `outline-style: solid`. The narrowed fallback the plan held in reserve
   was not needed and is not shipped.

Nothing in § Design changed. The one design change this ticket made after its first draft was the
security review's MUST FIX (bounding the conversation id as well as the attachment id), which was
applied inline *before* the plan commit and is recorded in § Security review rather than here.
