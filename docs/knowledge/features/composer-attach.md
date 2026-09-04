# Composer attach (#863, drag-and-drop entry #890, paste entry #1033)

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
  progress line rather than introduced by it. [#890](https://github.com/pyrycode/pyrycode-desktop/issues/890)
  widened the channel to carry a path for the *drop* entry below, but it did not add correlation — a click
  and a drop both still surface only the latest event, and fixing that remains open, unclaimed by any
  landed ticket.

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

- **`refused` is a second, nested `switch` on `event.reason` (#1032), also with no `default`.** The `refused`
  member split in two — `too-large` (`limitBytes: number`) and `no-image` (no figure) — because
  `attachmentUploadOutcomeCopy`'s single `case 'refused'` used to read `limitBytes` unconditionally, which
  would have silently rendered the too-large sentence for a paste that found nothing had `reason` been
  widened in place instead of split. The nested switch's absent `default` is what makes a *third* refusal
  reason a compile error here too, exactly as `progress` was for the outer one — see
  [Attachment upload § The paste ask](attachment-upload.md#the-paste-ask-and-the-refused-split-1032) for
  the union shape and why the split was forced rather than chosen.
- **`too-large`** composes its one sentence from the event's own `limitBytes` via `formatByteLimit`, and
  names the bound as **this app's**, never the host's: the union's docblock is explicit that a file under
  this bound can still come back `attachment-too-large` from the daemon, so wording it as the daemon's
  limit would state a fact the client does not have. `attachment-too-large`'s own sentence is the one that
  speaks for the host.
- **`no-image`** (#1032) names the clipboard rather than describing a failure — nothing was attempted and
  nothing went wrong, so `NO_IMAGE_COPY` reads "No image on the clipboard — nothing was attached." It
  states no figure and nothing about what the clipboard *did* hold (no flavour, no length), which is AC4
  at the copy layer: the event carries none of that, and inventing it in a sentence would be the leak the
  content-free union is shaped to prevent.
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

## The drop entry (#890) — a second way in, not a second flow

Dragging a file from Finder or Explorer onto `.composer` attaches it through the same
[attachment-upload](attachment-upload.md) flow the button drives: the same guard, the same driver, the
same outcome channel, the same terminal, rendered by `ComposerAttachOutcome` above. The only new thing is
*where the path comes from* — the operating system hands a dropped file to the **window** as a DOM
`File`, so the path has to be recovered on the window side of the process boundary, in the preload, via
`webUtils.getPathForFile` (see [Attachment upload § The bridge](attachment-upload.md) for the resolver and
its containment argument). Renderer code here holds the `File` handle and nothing else — the path never
reaches this component, a store, or a log.

**Four pure functions, framework-free, in the `composerSend.ts` / `dropQueuedMessage.ts` idiom** — so the
static tier can walk every branch of a drag gesture no test in this repo can perform:

- **`composerClassName(active: boolean): string`** — `'composer'` when inactive, byte-identical to the
  literal the three shipped `composerSlot.test.tsx` assertions match as a whole attribute run (two of
  them `class="composer" hidden=""`), and `` `composer ${COMPOSER_DROP_ACTIVE_CLASS}` `` when active. A
  branch, not an interpolation with an empty tail, for exactly that reason.
- **`dragCarriesFiles(types)`** — reads `DataTransfer.types` for `'Files'`, since the files themselves are
  deliberately unreadable during `dragover`. This is the whole of "interception is scoped to file drags":
  every downstream effect — the edge, the `preventDefault` that stops a navigation, the attach itself — is
  gated on it, so text, a URL, or an image dragged out of a web page is left alone and keeps doing exactly
  what it does today, including text dropped into the textarea. `text/uri-list` is deliberately **not**
  treated as a file drag — a `file:///…` URL dragged onto the page is `will-navigate`'s coverage
  (`src/main/index.ts`), not this one's, and widening here would swallow ordinary link drags into the
  message box.
- **`reduceFileDropDepth(depth, event)`** — the drag-over state as a depth counter, not a boolean, which
  is the whole of "it survives the pointer crossing a child element rather than flickering". `dragover`
  fires continuously and every child fires its own `dragenter`/`dragleave` pair, both bubbling to the
  composer's handler; a boolean flipped on `dragleave` would clear the instant the pointer crossed from
  the composer onto the textarea. `'leave'` floors at zero (a stray leave outnumbering enters, from a
  drag that began over a child); `'settled'` (a drop, or the drag ending) resets outright rather than
  decrementing, because a drop fires no matching `dragleave` at all.
- **`fileToAttach(files)`** — the one file, or `null` for zero and for more than one. Generic over the
  element so the unit tier needs no `File`. **A multi-file drop attaches nothing and says nothing** — a
  refusal would need a new reason in the shared union plus a branch in `attachmentUploadCopy`'s
  compiler-forced switch, copy for a feature (multi-file upload) that doesn't exist yet. The daemon's own
  concurrency bound (`attachment.too_many_uploads`, #861) is why a naive per-file loop would be the wrong
  first cut; a follow-up ticket owns multi-file support and its messaging together.

**`useAttachmentUpload()` grew a third member, `dropFile(file: File): void`**, mirroring `requestAttach`
exactly: it clears the held outcome and calls `window.pyry.dropAttachmentFile(file)`. It stays inside this
hook rather than being reimplemented at the drop site, because "dropping clears whatever outcome line is
showing" is the same act `requestAttach` already performs, and a second copy is where the two could drift.

**`useComposerFileDrop({ onFile })`** is the container: a `useState` depth counter (ADR 0006 — ephemeral,
screen-local, read by nothing else, the same shape `useAttachmentUpload` already uses for the held
outcome; it resets for free on a conversation switch because `PairedShellView` keys the chat pane on the
conversation id) plus the four drag handlers `.composer` wears, plus one `useEffect` that mounts a
**window-level navigation guard**: `preventDefault` on `window`'s `dragover` and `drop`, gated on
`dragCarriesFiles` so a text or link drag is untouched. This is the only part of the feature not scoped to
the composer, and it rides this hook (rather than `App.tsx`) so it is mounted wherever the composer is,
with no second mount point to keep in step. It is **defence in depth**: `will-navigate` in the background
process already refuses every navigation target but the app's own document, which is why a missed drop is
a silent no-op today rather than a hijacked window replaced by a rendering of the dropped file. The window
listener pair lives and dies with the effect, so a remount (including React StrictMode's double-invoke)
nets exactly one live pair — the `onDaemonEvent` / `useAttachmentUpload` idiom.

**The mount**, in `Composer` (`ConversationScreen.tsx`):

```tsx
<div className={composerClassName(fileDrop.active)} hidden={covered} {...fileDrop.handlers}>
```

`className` stays ahead of `hidden` in JSX order — same reason as `composerClassName`'s resting branch:
the three shipped whole-attribute-run assertions. The drop target is the **whole** `.composer` block, so a
drop landing on the footer row counts the same as one on the message box. `fileDrop` takes no
`conversationId` and reads no store, for the attach button's own reason: the intent it dispatches names no
conversation.

**The channel and the boundary guard** — `AttachmentUploadRequest`, `isAttachmentUploadRequest`, and the
widened `attachmentUploadListener` arm the path travels through — are documented at
[Attachment upload § The request body and its guard](attachment-upload.md); this document covers only the
renderer-visible half.

### Testing the drop entry

`ComposerAttach.test.tsx` (static, extended) covers all four pure functions across their branches,
including the enter → enter → leave "still active" case and the leave-at-zero floor.

`e2e/composer-file-drop.spec.ts` (fake tier, new) drives a page-context `DataTransfer` carrying a
page-built `File` onto `.composer`: the drop-target class appears on `dragenter`, survives a child's
`dragleave`/`dragenter` pair, clears on `dragleave` and on `drop`, never appears for a `text/plain` drag,
the window stays on the conversation screen after a drop on the composer *and* after one anywhere else in
the window, and nothing is inserted into the textarea. The join to the existing flow is proven without a
real path: an outcome is pushed first through `composer-attach.spec.ts`'s shipped `app.evaluate` seam, and
the drop **clears** it — an effect only `dropFile` produces.

**Two lessons from writing that spec:**

- **An untrusted `DragEvent`'s `preventDefault` leaves no trace in the URL, so "the window did not
  navigate" is not what to assert.** That assertion holds identically whether the navigation guard is
  mounted or not, i.e. it's vacuous on its own. What *is* observable is `dispatchEvent`'s own return
  value: it comes back `false` exactly when `preventDefault` ran. The spec asserts that in both
  directions — prevented for a file drag, *not* prevented for a text drag — which reddens if the listener
  is unmounted or its file gate is inverted. The URL check stays alongside as corroboration, labelled as
  such rather than as the proof.
- **A drag crossing from the composer onto a child nets to zero, not to a needed second `dragleave`.**
  Moving the pointer from `.composer` onto its own textarea fires `dragenter` on the child *and*
  `dragleave` on the parent — both bubble to the same handler, and they are exactly the arithmetic the
  depth counter exists to get right (net change: 0, state: still active). A first draft of this spec
  assumed the two enters needed two closing leaves before the state would clear, and asserted a
  `dragleave` count that never matched what the browser actually dispatches.

**What no tier proves.** A page-built `File` has no path, so this tier cannot carry a real one across; the
path-carrying leg is proven by the shared guard's unit tests plus #862's existing real-temp-file coverage
of `uploadAttachmentFile`. The composition-root join and the preload's `dropAttachmentFile` are this
repo's untested glue, as they are for every other attachment channel. CDP's `Input.dispatchDragEvent` was
the ticket's named optional route and was **not** attempted: it still cannot back a `File` with a real OS
path, so it would not have closed the gap it was nominated for.

### Security (drop entry)

PASS, self-reviewed. One property to hold onto: the honest containment claim is *only an operator gesture
mints a path-backed `File`* (a drop, or a file-system picker — this app renders no `<input type=file>`),
not "only a drop" — `dropAttachmentFile` is callable by any renderer code holding any `File`, so a
compromised renderer's marginal capability is forwarding a path-backed `File` it already holds, not naming
an arbitrary path. Repetition on the drop arm is unbounded by design (`pickerOpen` is scoped to the
*dialog* and deliberately not consulted here), bounded instead by #862's per-upload byte guard and the
daemon's own concurrency answer — a self-DoS by a renderer that already holds the command channel, and a
sixth concern judged not worth a client-side cap in a slice already over its line ceiling. See
[Attachment upload § Security](attachment-upload.md#security) for the boundary guard's own review.

## The paste entry (#1033) — the third way in, and the opposite mount-point call from the drop

[#1032](attachment-upload.md#the-paste-ask-and-the-refused-split-1032) shipped the entire background
half headless: the content-free ask (`window.pyry.pasteAttachmentImage()`), the main-side clipboard
read, the `no-image` refusal and its sentence. #1033 is the keystroke half only — the decision about
whether a given paste is an attach or ordinary text, and the handler that acts on it. No new component,
no new store: one pure predicate beside `dragCarriesFiles`, a third member on `useAttachmentUpload`, and
one JSX prop.

**It mounts on `.composer__input`, not on `.composer` — the opposite call from the drop entry above,
and deliberately so.** #890 spreads its handlers onto the outer `.composer` div so a drop on the footer
row counts as much as one on the message box. A `paste` fires on the *focused* element and bubbles, so
either mount point is reachable — this is a choice about scope, not reachability — but the handler's
whole job is to suppress a default paste, and the textarea is the only element in the composer that has
one. Mounting on `.composer` would also intercept a paste made while a footer button holds focus — a
keystroke with no default to prevent, turned into an upload — so narrower is correct for a handler that
starts a network transfer. A bare React `onPaste` prop renders no attribute under `renderToStaticMarkup`,
so `composerSlot.test.tsx`'s whole-run match on `class="composer__input"` stays untouched by construction.

**`pasteCarriesImageOnly(types: readonly string[] | undefined): boolean`** — `dragCarriesFiles`'s sibling
in `ComposerAttach.tsx`: advertised types in, boolean out, `undefined` tolerated and answering `false`
(`event.clipboardData` is nullable on the DOM type). Two conjuncts, both required:

- **Advertises an image** — `'Files'` present, or any entry `startsWith('image/')`. The prefix test
  (not `includes`) keeps a flavour that merely *mentions* an image type, such as `'text/image/png'`, from
  smuggling itself in.
- **Advertises no plain text** — `'text/plain'` anywhere in the list forces `false`, whatever else rides
  alongside. A copied web-page selection routinely carries both an image and text; this conjunct is what
  keeps that ordinary paste completely untouched, and it is why the static tests table the case rather
  than asserting it once — a single-conjunct predicate gets exactly this combination wrong.

**The disjunction was resolved by measurement, not left as an open question.** It was not obvious
up front whether Chromium normalises an OS-clipboard bitmap to the file-item spelling (`'Files'`) or an
explicit `image/png` entry before handing it to a page. `e2e/composer-paste-image.spec.ts` seeds a real
bitmap onto the real OS clipboard, drives a **trusted** paste with `webContents.paste()`, and captures
the advertised list with a page-side probe: **exactly `['Files']`, no `image/png` entry at all**. So the
`'Files'` arm is what makes the feature work, not defensive breadth — an `image/*`-only predicate would
have shipped a screenshot paste that silently did nothing. The `image/*` arm stays for the page-image
spelling a copied web-page image can produce. The one thing `'Files'` additionally admits is a *file*
copied in Finder or Explorer, out of scope per the ticket: main reads the clipboard, finds no bitmap, and
answers `no-image` — an honest refusal instead of silence, no path or byte involved either way.

**`text/plain` is a security-shaped bound, but this predicate is not where it is enforced.** A
password-manager secret is `text/plain`, so it can never take the attach branch through this handler —
but `contextBridge` exposes `pasteAttachmentImage()` to the whole renderer, so a compromised window calls
it directly and never runs this predicate at all. The bound that actually holds is main's:
`clipboard.readImage()` returns a bitmap or nothing, so a text-flavoured secret yields an empty image and
a `no-image` refusal whatever the ask claims. This predicate is the ergonomic half of the rule; #1032's
clipboard read is its enforcement.

**`pasteImage(): void`** — the third member of `useAttachmentUpload`, alongside `requestAttach` and
`dropFile`, performing the identical clear-then-fire act (`setOutcome(null)` then
`window.pyry.pasteAttachmentImage()`). Reused rather than rebuilt at the gesture site, `dropFile`'s own
reason for being where it is. **The clear here is for consistency of ownership, not for a stranding it
prevents** — worth stating because the two members above it clear for a reason that does not arise on
this path: a cancelled picker and an unresolvable dropped path each report nothing at all, which is what
strands a previous line, while #1032's clipboard path draws exactly one terminal for every ask,
`no-image` included. It clears anyway, so all three entries behave identically and the line that appears
next is unambiguously about the paste just made.

**The handler, in `Composer` (`ConversationScreen.tsx`):**

```tsx
const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
  if (!pasteCarriesImageOnly(event.clipboardData?.types)) return
  event.preventDefault()
  attach.pasteImage()
}
```

The early return is the whole of "text pastes stay text": a clipboard the predicate declines is not
consumed, not prevented and not reported, so the default paste runs exactly as it does today.
`clipboardData` is read for `types` and nothing else — `getAsFile`, `getAsString` and `.files` are never
touched anywhere in this feature, which is AC3 stated as an absence at the only site that could violate
it. No new state, no async work, no `AbortSignal`: the ask is fire-and-forget and its terminal arrives on
the outcome subscription `useAttachmentUpload` already owns.

### Testing the paste entry

`ComposerAttach.test.tsx` gains `describe('pasteCarriesImageOnly')`: every measured image spelling with
no text (true, as a table), every list carrying `'text/plain'` alongside an image (false, as a table —
the security bound), every non-image list plus `[]` and `undefined` (false), and the prefix-not-substring
case (`'text/image/png'`, `'x-image/png'`).

`e2e/composer-paste-image.spec.ts` (fake tier, no `real-*` name, no `needs-real-claude`) is the spec that
pays off what #1032 deliberately left unproven — that the whole paste chain joins — and it is also the
in-tier proof for the measurement above. One continuous drive, two halves:

1. **The branch matrix, synthetically.** `composer-file-drop.spec.ts`'s shape applied to `paste`: a
   `DataTransfer` built in page context, a `ClipboardEvent` dispatched on `.composer__input`, and
   `dispatchEvent(...) === false` read as the only observable proof `preventDefault` ran — an untrusted
   event performs no default action, so watching the textarea proves nothing. Image-only prevents;
   image+text does not; text-only does not.
2. **The whole chain, for real.** A real bitmap seeded onto the real OS clipboard
   (`app.evaluate`'s `clipboard.writeImage` seam, `message-copy.spec.ts`'s already-accepted
   clobber-without-restore price for touching it), a trusted paste via `webContents.paste()` against the
   focused message box, and a terminal rendered in `.composer__attach-outcome` — keystroke → predicate →
   ask → main's clipboard read → PNG encode → guard → transfer → wire → terminal → composer, joined
   end to end for the first time. A real **text** clipboard pasted the same way lands its text in the
   message box and produces no outcome at all.

**The ask is not intercepted in this tier — a real trap the first draft fell into.** It crosses to the
real main handler, which reads the real OS clipboard, so seeding must happen *before* the first paste
fires or the synthetic image-only arm earns a terminal from whatever the machine's clipboard happened to
hold. The spec seeds first, so the synthetic arm now earns a **deterministic** terminal and doubles as
proof the ask reaches the flow, not merely that `preventDefault` ran.

**Because `attachmentTransfer.ts` has no per-transfer deadline, the fake daemon must answer every
chunk or the assertion hangs to the suite timeout rather than failing.** `buildReplyFrames` rejects each
`attachment_chunk` with a real `error` frame correlated via `sentEnvelope`, which `daemonConnection`'s
`daemon-error` case turns into `failed`/`<reason>`.

**Both arms land in the same single outcome slot, so a second "a sentence is present" assertion would
pass on the first arm's line** — the `?? ''` vacuous-pass shape this repo has hit before, in a different
costume. The fake daemon rejects the first upload and every later one with **different** daemon codes
(`attachment.storage_failed`, then `attachment.too_many_uploads`), so the trusted paste's terminal is a
fresh observation rather than a stale one, and the expected sentence is derived by calling
`attachmentUploadOutcomeCopy` rather than typed out. **The fall-through arms additionally assert the
outcome line is still standing** — a stronger detector than "prevented", since clearing the line on a
gesture is something only the attach path (`pasteImage`) does; a handler that prevented nothing but asked
anyway would pass the prevention check and fail this one.

### Security (paste entry)

PASS, self-reviewed. This slice widens no boundary: the one crossing is the already-shipped
`ATTACHMENT_UPLOAD_CHANNEL` send `pasteAttachmentImage()` performs with no renderer-supplied value, and
`pasteCarriesImageOnly` is not itself a security control — see above. The handler adds no new capability:
any renderer script that could synthesise the `ClipboardEvent` this handler consumes could call
`window.pyry.pasteAttachmentImage()` directly, which is strictly easier. **SHOULD FIX, addressed in the
diff rather than left open:** the handler and the predicate must log nothing — a `console.log` of `types`
would put clipboard *shape* in DevTools and any diagnostic bundle, undoing #1032's content-free logging
posture; the measurement that the type list is `['Files']` lives in the e2e spec's page probe only, never
in `ComposerAttach.tsx` or `ConversationScreen.tsx`. **Out of scope, per the ticket's explicit
instruction:** #1032's named residual — a compromised renderer can cause an unprompted upload of whatever
image the operator is holding — stays open. A confirmation added at this handler would be bypassed by the
direct `contextBridge` call above, costing an interruption on every legitimate paste for no gain against
the attacker it would name; this ticket adds no gesture correlation and no permission prompt. See
`docs/specs/architecture/1033-paste-image-to-attach.md` § Security review for the full findings and the
Open-Questions-resolved-by-measurement revision.

## CSS

Two rules beside `.composer__actions` / `.composer__permission` / `.composer__model` / `.composer__effort`,
plus the drop-target rule below:

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
- **`.composer--drop-target`** (#890) — `outline: 1px solid var(--color-primary); outline-offset: -1px`,
  the drop-in-progress edge. `outline`, not `border`: `.composer` has no resting border at all — it is
  padding plus `background: var(--color-surface)` — so a `border:` in the active state would reflow the
  whole conversation column by 2px every time a file crossed it. The shipped no-reflow precedent is
  `.composer__row:has(.composer__input:focus-visible)`, further down this file. `--color-primary` rather
  than that rule's `--color-outline`, so the drop edge is not the focus ring's twin when a drag crosses a
  composer whose textarea also holds focus — both tokens already exist in this stylesheet; no new colour
  is introduced. `outline-offset: -1px` draws the edge inside the border box, since the composer is the
  conversation column's last child and its bottom padding edge is the window's, where an outward outline
  would be clipped. Per Juhana's ruling of 2026-09-02, this is the drop state until a treatment is drawn
  in Figma (node `102-4` covers only the input's resting appearance) — a drawn treatment landing later
  supersedes this rule as a Figma-side follow-up, not a redesign.

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
`toContain`) for the totality guard's zero/negative/non-finite/string-coercion cases. (#1032) The `no-image`
sentence is asserted non-blank, distinct from the too-large sentence and from every failure-map value,
naming the clipboard, stating no byte figure and carrying no `uploadId`; the too-large arm's shipped
assertions are re-run unchanged to prove the split left it alone. `ConversationScreen.test.tsx`
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
- [#890](https://github.com/pyrycode/pyrycode-desktop/issues/890) (drag-and-drop) — landed; see § The drop
  entry above. Widened the shared channel to carry a path but did not add correlation — the renderer still
  cannot learn its own gesture's `uploadId`, so that remains open for a future ticket.
- [#1032](attachment-upload.md#the-paste-ask-and-the-refused-split-1032) (clipboard paste, background
  half) — landed; shipped the content-free ask, the main-side clipboard read, and the `no-image` refusal
  and its sentence this document's copy section covers. Left the keystroke half, and the whole-chain
  proof, to #1033.
- [#1033](https://github.com/pyrycode/pyrycode-desktop/issues/1033) (clipboard paste, keystroke half) —
  landed; see § The paste entry above. A third concurrent-upload entry alongside the click and the drop,
  interleaving into the same one-slot outcome the same way; adds no correlation either.
- See [PR #1026](https://github.com/pyrycode/pyrycode-desktop/pull/1026),
  `docs/specs/architecture/863-composer-attach-button.md`, [PR #1027](https://github.com/pyrycode/pyrycode-desktop/pull/1027),
  `docs/specs/architecture/864-attachment-upload-progress.md`, [PR #1031](https://github.com/pyrycode/pyrycode-desktop/pull/1031),
  `docs/specs/architecture/890-composer-file-drop.md`, `docs/specs/architecture/1032-paste-clipboard-image-attach.md`
  and `docs/specs/architecture/1033-paste-image-to-attach.md` for the full plans and their security reviews.
