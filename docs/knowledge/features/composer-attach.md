# Composer attach (#863)

The footer's sixth and last item, right-aligned past
[the Actions menu](conversation-shell-actions-menu-and-reader-cutover.md#actions-menu-680),
[the permission-mode menu](composer-permission-mode-menu.md), [the model menu](composer-model-menu.md),
[the effort menu](composer-effort-menu.md) and the context reading (Figma `115:3654`). Part of
[Conversation shell — composer](conversation-shell-composer.md#composer-footer-row-811); see that
document's footer-row section for the row's geometry and no-placeholder rule.

It wires the renderer half of a flow that already existed headless: [#862](attachment-upload.md) shipped
`requestAttachmentUpload(): void` and `onAttachmentUploadEvent(listener)` on `window.pyry` with no caller
and no consumer. This ticket is that caller and that consumer, and it closes the family's user-facing loop
— split from #685, same as its neighbours.

## What makes this control unlike its four siblings

The other four footer controls each read a store and render one of several states depending on what has
(or hasn't) arrived from the daemon. This one does neither:

- **It renders unconditionally.** The three menus each wait on a run-config snapshot before drawing
  anything; the context reading waits on a usage figure. This button has no daemon-published anything to
  be missing, so it is the one item in the row present on a fresh launch with no snapshot at all.
- **It takes no `conversationId` and reads no store.** The intent it dispatches names no conversation and
  no file — the picker, the path and the bytes all stay in the background process. `requestAttach` is a
  fire-and-forget call with no argument.
- **The button itself needs no disabled or in-flight state.** The composition root's `pickerOpen` flag
  (#862) already drops a second intent while a picker is open, so a double-clicked button is handled
  below the bridge. Drawing a state on the *glyph* would be exactly the placeholder
  [#811](conversation-shell-composer.md#composer-footer-row-811) forbade — see § In-flight progress
  (#864) below for where the in-flight state actually lives instead: the outcome line beneath the row,
  not the button.
- **The renderer cannot correlate a click to an outcome — or to a transfer's progress.** `requestAttachmentUpload()`
  returns `void`, so this window never learns the `uploadId` its own click minted, and the main-side guard
  is scoped to the *dialog* rather than the transfer — two uploads can be live at once with distinct ids.
  So the composer states **the latest event to arrive** (a terminal, or, since #864, an in-flight
  `progress` report), and cannot state anything narrower; `uploadId` is deliberately unread on the
  renderer side, since surfacing it would invite a correlation that does not exist. Two concurrently live
  transfers interleave into this one slot — a shipped property of this ticket, made *visible* by #864's
  progress line rather than introduced by it; correlating would need the intent to return an id, which is
  [#890](https://github.com/pyrycode/pyrycode-desktop/issues/890)'s channel change.

## Two pure views and a container hook, not one component

`ComposerAttach.tsx` is the [`LogDataSection`](conversation-shell-composer.md) split, because the button
and the outcome mount in **different places**:

```
Composer
├── .composer__row
├── .composer__footer                      (unchanged five, plus:)
│   └── ComposerAttachButton                sixth and last item, margin-left: auto
└── ComposerAttachOutcome                   composer column's own last child, NOT inside the footer
```

- **`ComposerAttachButton({ onAttach })`** — a `<button type="button">` wearing
  `class="composer__footer-button composer__attach"`, `aria-label={COMPOSER_ATTACH_LABEL}`
  (`'Attach file'`), holding one `aria-hidden` inline `<svg fill="currentColor">` — Figma node `115:3655`'s
  single path, viewBox `0 0 10.9989 11.9678` (the node's own fractional box, not rounded), rendered at
  11×12. An `aria-label` is correct here, the opposite call from `ComposerErrorChip`'s hidden text and
  correct for the opposite reason: `<button>` is not on ARIA's name-prohibited list, while a bare
  `<div>`/`<span>` maps to `role="generic"` and drops its name. `.composer__send` already names its two
  icon-only variants this way.
- **`ComposerAttachOutcome({ outcome })`** — `null` when `outcome` is `null` (not an empty element holding
  the slot — [`ContextUsageReading`](conversation-shell-composer.md)'s exact-empty rule restated); an
  `outcome.type === 'progress'` branch renders `<div key="in-flight" className="composer__attach-progress">`
  with **no live-region role** (#864, see § In-flight progress below); every other (terminal) branch
  renders `<div key="terminal" className="composer__attach-outcome" role="status">` — both holding
  `attachmentUploadOutcomeCopy(outcome)`. `<div>`s, not `<p>`s — this repo ships no margin reset and it is
  a flex item in the composer column, so a `<p>`'s UA margin would move the message box for no semantic
  gain (`ComposerErrorChip`'s ruling verbatim).
- **`useAttachmentUpload()`** — `useState<AttachmentUploadEvent | null>(null)` plus one `useEffect`
  returning the bridge's own unsubscribe handle as cleanup, `[]` deps — one live listener per mount, the
  `LogDataSection` / daemon-event-bridge idiom. `requestAttach` clears the held outcome **and then** sends
  the intent — the clear happens on the click rather than on an arriving event, because a cancelled picker
  reports nothing at all, and an event-driven clear would leave a prior refusal or failure on screen for an
  attach the operator abandoned. `window.pyry` is dereferenced only inside the effect and inside
  `requestAttach`, never during render, so every static render of the composer still touches no bridge.
  One nullable holds both an in-flight report and a terminal (#864) because they are the same value: the
  listener assigns whatever arrived last, so a terminal replaces a progress line with nothing having to
  clear it first, and a connection lost mid-transfer clears the figure on exactly the path a completion
  does.

State lives in `Composer` via this hook, not in a store — [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md)
applied as written, with one wrinkle the ADR's pairing precedent didn't carry: a display-lifetime
*subscription*. It still stays component-scoped, because the subscription feeds one nullable value nothing
outside the composer reads, and the reset the ticket asks for comes free — `PairedShellView` keys the chat
pane on the conversation id, so a switch destroys and rebuilds `Composer` with a fresh `null`. A store plus
a bridge would add a module singleton needing an *explicit* clear on switch and on unpair, for no reader
outside this component.

## The outcome lives beneath the row, never inside it

Three independent reasons, each sufficient on its own:

- **The row holds a hard `height: 20px`.** A sentence inside it would overflow rather than grow the row.
- **Four shipped e2e specs assert `.composer__footer [role="alert"]` has count 0.** A live region inside
  the row would collide with that count on the next control that happens to render one.
- **The status row's trailing slot is already owned.** `ComposerStatusArea`'s `trailing` prop belongs to
  `ComposerErrorSlotControl` ([#797](conversation-shell-composer.md)'s chip, #963's re-pair button), and
  `.composer-status` is `min-height: 24px` sized *by that occupant* — a third thing there means settling
  precedence between two error surfaces and can move the composer.

So `ComposerAttachOutcome` is the composer column's own third and last child, one row below
`.composer__footer`. It has **no `height`, no `min-height`, and no `white-space: nowrap`** — the opposite
of `.composer-status`'s reserved-space guarantee, by design: the element does not exist in the DOM at all
while there is no outcome, so an absent child costs no flex gap, and it is a sentence rather than a
13-character reading, so wrapping is the correct behaviour rather than a hazard to bound.

## In-flight progress (#864) — one slot, two branches, and a `key` that only a comment proves

A large upload used to say nothing between the click and the terminal, which for a multi-hundred-chunk
file reads as a hang. [#864](attachment-upload.md) surfaces the chunk count
[attachment transfer](attachment-transfer.md) already held, one seam per hop, and lands it here as a
fourth `AttachmentUploadEvent` member — `{ type: 'progress'; uploadId; sentChunks; totalChunks }` — that
`ComposerAttachOutcome` renders in the *same slot* the terminal will occupy, never beside it: the hook
holds one nullable and the latest event wins, so mutual exclusion is a property of the branch, not
something arbitrated at render time.

**The two `key`s are load-bearing, not decoration.** React reconciles by element type and position, so
without distinct `key="in-flight"` / `key="terminal"` values the in-flight `<div>` and the terminal
`<div>` are the same DOM node, and the terminal transition would *add* `role="status"` to an existing
element while changing its text — the case assistive technology handles least reliably. Distinct keys
force the terminal to be a fresh insertion carrying its content, byte-for-byte the behaviour #863
shipped and reasoned about. **No test can see this**: `renderToStaticMarkup` drops keys and the fake e2e
tier cannot observe a screen-reader announcement, so the property is carried by a code comment naming
what it's for and nothing else — the honest state of it, not a gap to backfill.

**The in-flight line carries no live-region role, on purpose — the one place this ticket could regress a
shipped decision.** #863 chose `role="status"` for the terminal because an outcome fires at most once per
attach. Progress fires per chunk, up to `ATTACHMENT_MAX_UPLOAD_CHUNKS` (512) times for one file, and a
polite region announcing each one would be worse than the silence it replaces. Of the three ways out — a
separate non-live element, a coarser emission cadence, or a role that differs while in flight — this
takes the first: the figure is readable by browsing and announced by nothing.

**Separate classes, not a shared-treatment mix.** `conversation.css` adds `.composer__attach-progress` to
`.composer__attach-outcome`'s existing rule as a *selector list*, not by widening `.composer__attach-outcome`
itself or wearing it as a two-class mix the way `.composer__attach` wears `.composer__footer-button`.
Every shipped assertion on the terminal matches `class="composer__attach-outcome"` as a **whole attribute
run** — a prepended or appended class on that exact run reddens several assertions while an extractor
ending in `?? ''` lets one pass vacuously with no red at all, the same class-lift failure mode this repo
has hit before at the shared `.composer__footer-button` treatment.

**The sentence — `Uploading… N%`, from `uploadProgressPercent` in `attachmentUploadCopy.ts`.** Floored
and clamped into `[0, 100]`; `100%` means every chunk is on the wire and the host's answer is still
outstanding, which is exactly what "how far the transfer has got" measures — the terminal is what says
the file was actually stored. Guarded with `Number.isFinite`, never the global `isFinite` (the global
coerces, so `isFinite('5')` is `true` and a string count off `ipcRenderer.on` would reach the arithmetic
instead of resolving to `0`). This is `formatByteLimit`'s precedent, not `event.reason`'s: the figure is
computed by this client from two client-held counts, so it may be interpolated where a daemon-*selected*
`reason` may not.

**A `toContain` against a formatted number is a weak assertion by construction — a lesson from this
ticket's rework leg.** The first version of `uploadProgressPercent`'s string-coercion guard test asserted
`not.toContain('NaN')` and `toContain('0%')` against `sentChunks: '5'` / `totalChunks: '10'`. The
*coercing* global `isFinite` states `Uploading… 50%` for those inputs, which contains the substring `0%`
(from `50%`) and no `NaN` — so both assertions held under either guard, and it was the only test in the
suite that could have reddened on the swap. Repaired as whole-sentence equality against a genuine `0%`,
with counts (`'5'`/`'8'` → `62%`) whose coerced reading collides with nothing, plus an anti-vacuity line
proving the same counts read as numbers produce a different sentence. The general lesson: a formatted
number's alphabet is small and its values nest as substrings of each other, so `toContain` against one is
rarely the assertion it looks like — prefer whole-value equality.

## `attachmentUploadCopy.ts` — the copy is a selection, not a rendering

Every field on `AttachmentUploadEvent` is client-owned by construction ([#862](attachment-upload.md)'s own
docblock): no member can hold the file's bytes, its host path or its name, `reason` is a literal written in
this repo, and `limitBytes` is a client-owned constant. So there is no daemon text on this path — no
escaping obligation, no length bound, and no truncation chain of the kind `.composer__model-label` carries
for a claude-authored label. What's at stake is coverage, and `attachmentUploadOutcomeCopy(event)` closes
it with an explicit return type and **no `default`** on its `switch` — a discipline that has already fired
for real: #864's `progress` member reached this switch through the compile error rather than a silent
fallthrough, the `relayLeg`/`daemonLeg` discipline one directory over.

- **`refused`** composes its one sentence from the event's own `limitBytes` via `formatByteLimit`, and
  names the bound as **this app's**, never the host's: the union's docblock is explicit that a file under
  this bound can still come back `attachment-too-large` from the daemon, so wording it as the daemon's
  limit would state a fact the client does not have. `attachment-too-large`'s own sentence is the one that
  speaks for the host.
- **`failed`** is a lookup keyed on `event.reason` against `ATTACHMENT_UPLOAD_FAILURE_COPY`, a
  `Record<AttachmentUploadFailure, string>` — the third acceptance criterion's mechanism, since a member
  added upstream fails to typecheck rather than silently rendering blank. **No count of the union is
  written anywhere**, matching the shipped docblock's own refusal to give one after it went stale once
  already ([#999](attachment-chunk-retrieval-decode.md) added the two retrieval codes).
- **The runtime read goes through a `Map` derived from that `Record` via `Object.entries`, never through the
  object literal.** `event.reason` arrives off `ipcRenderer.on`, where the declared type is compile-time
  only — nothing validates the runtime value. Against a bare object literal, a `reason` of `'constructor'`
  or `'toString'` reads straight off `Object.prototype` and returns a **function**; `?? fallback` does not
  fall through, because a function is not nullish, and React throws "Objects are not valid as a React
  child" out of the composer's render. `Object.entries` is prototype-safe so the derivation introduces
  nothing, and a `Map.get` miss is a real miss. This is [#862](attachment-upload.md)'s own mime-type-table
  reasoning ("a `Map` rather than an object literal so a lookup key can never reach `Object.prototype`"),
  applied one process over, in the read direction — see
  [[json-parse-and-object-fromentries-are-prototype-safe]] for the write-direction precedent this
  complements. `attachmentUploadCopy.test.ts` drives `constructor`/`__proto__`/`toString` through a
  deliberate cast, and the test reddens if the `Map` indirection is removed.
- **`attachment-not-found` and `attachment-stream-aborted`** map to one shared non-committal sentence
  (`'The upload did not complete.'`), per the union's shipped ruling: both answer a `request_attachment`
  and never an `attachment_chunk`, so no conforming upload ends this way, but a *hostile* daemon can
  correlate either code to a pending chunk, so they stay representable and must not fall through to blank.
- **No arm interpolates `event.reason` into a sentence.** `` `Upload failed: ${reason}` `` would compile and
  render a client-owned literal, but it would make the rendered string *daemon-selected* rather than
  client-authored — the property the third criterion is about. The tests assert exact equality against the
  mapped constant, never `toContain`, which is what forbids the shortcut.
- **`formatByteLimit(bytes)`** picks the largest unit (MB, then kB, then bare bytes) at which the value
  reaches 1, decimal rather than binary — the figure is user-facing and macOS states file sizes the same
  way — printing at most one decimal so a small bound can never read as `0 MB`.

## CSS

Two rules beside `.composer__actions` / `.composer__permission` / `.composer__model` / `.composer__effort`:

- **`.composer__attach`** wears the shared [`.composer__footer-button`](composer-model-menu.md) treatment
  as a two-class mix — the first consumer with no label, and evaluated rather than assumed: the reset
  (padding, border, background off), the flex centring and `color: var(--color-primary)` are exactly what
  an icon-only button needs; the type block and `gap` are inert, which is harmless and consistent with the
  shared rule's own note that it is named for the row rather than for any one consumer. **No shipped
  element is re-classed.** This rule adds `margin-left: auto` — the right-alignment `.composer__footer`'s
  comment has reserved for this control since #811, reproducing without a number that the button is a
  *sibling* of Figma's `Info and buttons` group (`115:3660`) rather than its fifth member (x=714 in a
  741-wide row; 714 + 11 = 725, exactly the content-box right edge under the row's 16px inset) — plus
  `cursor: pointer` (the shared class deliberately omits it, since #988's inert model label wears it while
  opening nothing) and `flex: 0 0 auto` (so the row cannot squeeze the glyph; the four menu triggers don't
  need this because their label's own `max-width` absorbs a narrow row first).
- **`.composer__attach-outcome`** — `.composer__context`'s body-small-in-`--color-primary` treatment, with
  no `height`/`min-height` (see above) and deliberately no `white-space: nowrap`.

No glyph rule of its own, unlike the four menu chevrons — the button's only child is the glyph and the
button itself is `flex: 0 0 auto`, so nothing can squeeze it, and adding one would grow the standing
four-rule `.composer__actions-icon` tidy-up note to five for a rule that would arrive inert.

## Testing

Renderer tests are static server renders (CLAUDE.md, `renderToStaticMarkup`, no DOM). `ComposerAttach.test.tsx`
covers the button's exact class run, its accessible name, its `aria-hidden fill="currentColor"` glyph with
no hex literal anywhere in the markup, and `ComposerAttachOutcome`'s exact-empty absent arm plus its terminal
arms rendering `role="status"` and text equal to the copy module's own output (proving the view *selects*,
never composes). Since #864: a `progress` event renders `.composer__attach-progress` carrying the copy
module's own output, with **no** `role="status"` and no `role="alert"`, and the `composer__attach-outcome`
class present nowhere in the markup — the whole-attribute-run separation proved at the unit level.
`attachmentUploadCopy.test.ts` walks `Object.values` of the failure map (every value non-empty, no count, no
restated member list), drives the three hostile reason strings through the `Map` indirection, exercises
`formatByteLimit`'s three unit arms, and (#864) `uploadProgressPercent` against a mid-transfer figure, a
`sent === total` 100% reading, and — per the rework-leg lesson above — whole-sentence equality (not
`toContain`) for the totality guard's zero/negative/non-finite/string-coercion cases. `ConversationScreen.test.tsx`
gained mount proofs that the button lands after `.composer__context` (the row's last item) and that a fresh
mount carries no `.composer__attach-outcome` at all.

`e2e/composer-attach.spec.ts` (fake tier) is the interaction proof the static tier cannot reach. Because
this tier launches the *built* app, a real click reaches production's `dialog.showOpenDialog` and would
hang the run on a native OS window — the spec stubs it through `app.evaluate`
(`assistant-link-opens-externally.spec.ts`'s seam, the same one that stubbed `shell.openExternal`), answers
`{ canceled: true, filePaths: [] }`, and pushes each `AttachmentUploadEvent` on
`ATTACHMENT_UPLOAD_EVENT_CHANNEL` through the same seam with no dialog and no daemon involved. One
continuous drive proves: the button's right edge lands on the footer's content-box edge (the assertion that
actually reddens if `margin-left: auto` is dropped — the row's `height: 20px` cannot, since it's hard-coded);
a click reaches the main process with no native window opening; a cancelled pick leaves nothing on screen
over a held interval; three pushed outcomes each render their own copy and the latest always wins; a second
click clears the outcome before a new terminal arrives; and the message box's `y` is restored once the
outcome clears. Since #864, the same drive continues: a `progress` event replaces a terminal line (the
in-flight element present, `.composer__attach-outcome` count 0 — the "no second indicator" property),
a second `progress` with a higher figure advances the rendered text, and a `failed`/`connection-lost`
terminal that follows clears the in-flight element and states its own sentence — with
`.composer__footer [role="alert"]` staying at count 0 throughout, the shipped invariant this ticket had to
not disturb. No `needs-real-claude` — every drive goes through `app.evaluate` with no live daemon and no
live claude.

**What no tier proves:** the remount forced by `ComposerAttachOutcome`'s two distinct `key`s
(`renderToStaticMarkup` drops keys, and the fake e2e tier cannot observe a screen-reader announcement) —
see § In-flight progress above. Carried by a code comment, not a test.

## Security

PASS, with two SHOULD-FIX findings folded into the design above rather than left as later work: the `Map`
indirection against a prototype-polluting `reason` (finding 1), and wording the `refused` sentence as this
app's own limit rather than the host's (finding 2). This control widens no capability — no new channel, no
`contextBridge` member, no `ipcMain` handler — it only consumes the two members #862 already shipped, and
repetition is bounded below the bridge by `pickerOpen`. Nothing on this path is logged, matching
[ADR 0007](../decisions/0007-content-free-diagnostics-by-construction.md). `uploadId` crosses the bridge
and is deliberately unread by this control — see § above. A hostile daemon's blast radius is one misleading
sentence (it can choose which failure literal arrives, or claim `completed` for an upload that failed): it
cannot inject text (every sentence is a module constant), cannot render blank (exhaustive `Record` plus the
total `Map` read), and cannot move layout unboundedly (no daemon-length string reaches the DOM on this
path). See `docs/specs/architecture/863-composer-attach-button.md` for the full nine-finding review.

**#864's review, also PASS**, adds one property specific to `progress`: `totalChunks` discloses the chosen
file's size to within `ATTACHMENT_CHUNK_DATA_BYTES`, which qualifies but does not break #862's "cannot read
back what was sent" — see [Attachment upload](attachment-upload.md) for why that disclosure is accepted.
Nothing renderer-side changed the trust posture: no new channel, no new bridge member, `uploadProgressPercent`
totalises over `ipcRenderer.on`'s untyped runtime value with `Number.isFinite` rather than trusting the
declared type. See `docs/specs/architecture/864-attachment-upload-progress.md` § Security review.

## Related

- [Attachment upload](attachment-upload.md) (#862) — the headless flow this control wires: the picker
  guard, the size bound, the driver and the two bridge members. Also the wire-contract-level writeup of
  the `progress` member and its `ATTACHMENT_PROGRESS_MIN_CHUNKS` gate (#864).
- [Attachment transfer](attachment-transfer.md) (#861) — the send loop that reports `sentChunks` /
  `totalChunks` upward through the `onProgress` seam #864 added; the source of the count this control
  renders.
- [#815](https://github.com/pyrycode/pyrycode-desktop/issues/815) — the file row in the message bubble, the
  only other planned evidence that an upload produced anything; until it lands, `ComposerAttachOutcome`'s
  line is the sole evidence on screen.
- [#890](https://github.com/pyrycode/pyrycode-desktop/issues/890) (drag-and-drop) — the ticket that would
  let the renderer learn its own click's `uploadId` and correlate rather than always stating the latest
  event; not started.
- See [PR #1026](https://github.com/pyrycode/pyrycode-desktop/pull/1026),
  `docs/specs/architecture/863-composer-attach-button.md`, [PR #1027](https://github.com/pyrycode/pyrycode-desktop/pull/1027)
  and `docs/specs/architecture/864-attachment-upload-progress.md` for the full plans and their security
  reviews.
