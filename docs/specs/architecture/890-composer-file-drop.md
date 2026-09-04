# #890 — drop a file from the file explorer onto the message box to attach it

A second ENTRY into #862's finished attach flow, not a second flow. Everything from the size guard
onward already exists and is called, not copied. The one thing a drop changes is where the path comes
from: with the picker the background process owns it from the moment the dialog closes; with a drop the
operating system hands the file to the WINDOW, so the path is recovered in the preload
(`webUtils.getPathForFile`) and shipped to main on the channel #862 already ships.

## Files read

Codegraph is not initialised in this repo (`codegraph_*` answers "CodeGraph not initialized" as a hard
error, not an empty result), so this list came from Grep/Read.

- `src/shared/ipc/attachmentUpload.ts` → `ATTACHMENT_UPLOAD_CHANNEL`, `AttachmentUploadEvent` — the
  channel this slice widens, and the header paragraph that names this ticket as owing a request guard.
- `src/shared/ipc/attachmentBytes.ts` → `isAttachmentBytesRequest`, `MAX_BYTES_IDENTIFIER_LENGTH` — the
  guard shape this slice copies verbatim: narrow to `object`, `in`-guard the key, typeof the value
  actually found, bound the length. Its docblock is where the `__proto__` argument is already written.
- `src/shared/ipc/attachmentSave.ts` → `isAttachmentSaveRequest`, `MAX_SAVE_FILENAME_LENGTH` — the
  two-bound sibling; 4096 is its filename ceiling and the nearest precedent for a path bound.
- `src/main/attachmentUpload.ts` → `uploadAttachmentFile`, `readChosenFile`,
  `ATTACHMENT_MAX_UPLOAD_BYTES` — the flow this drop joins. Its docblock already names this ticket as
  its second caller; `readChosenFile`'s `isFile()` check is what answers a dropped FOLDER.
- `src/main/index.ts` → `attachmentUploadListener`, `pickerOpen`, the `will-navigate` guard and
  `isSameTarget` — the listener this slice widens, the flag that must stay scoped to the dialog, and the
  main-side navigation block the renderer guard backs up.
- `src/preload/index.ts` → `requestAttachmentUpload`, `api`, `PyryApi` — the sender this slice sits
  beside, and the object `PyryApi` is inferred from (so `index.d.ts` needs no edit).
- `src/renderer/src/screens/conversation/ComposerAttach.tsx` → `useAttachmentUpload`, `requestAttach`,
  `ComposerAttachOutcome` — the outcome surface the drop reports through, and the hook that owns the
  clear-on-intent.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Composer` — the `.composer` element
  the drop target is, and its `className` / `hidden` prop order.
- `src/renderer/src/screens/conversation/conversation.css` → `.composer`, `.composer__row:has(...)` —
  no resting border on the block, and the shipped no-reflow focus-ring precedent one rule above it.
- `src/renderer/src/screens/conversation/composerSlot.test.tsx` → the three `class="composer"`
  whole-attribute-run assertions (two of them `class="composer" hidden=""`).
- `src/renderer/src/screens/conversation/dropQueuedMessage.ts` → the injected-effect pure-module idiom.
- `e2e/composer-attach.spec.ts` → the `app.evaluate` push seam this slice reuses to prove the join.
- `docs/knowledge/features/composer-attach.md` § Testing, § Security — #863's tiers and its PASS
  verdict; the reason the outcome line lives beneath the footer row rather than inside it.
- `docs/knowledge/features/attachment-upload.md` — #862's headless flow, referenced for the guard's
  claim-not-capability posture.

## Design source

**Figma:** N/A — the design has no drag-over state for the composer. Node `102-4` covers the input's
resting appearance and nothing in the file shows the message box while a file is held over it. Juhana's
ruling, 2026-09-02: a border shift on the tokens already in `conversation.css` is the drop state until
he draws one. This slice builds exactly that — an edge change on `.composer`, no new colour, no caption
— and a drawn treatment landing later supersedes it as a Figma-side follow-up, not a redesign here.
The verifier's visual-fidelity check is intentionally skipped for this slice.

## Context

Attaching a file today means a detour through the file picker. #862 shipped the headless flow, #863 the
renderer's outcome surface, #864 the in-flight progress. This slice adds the second entry — a drop — and
nothing else: no second guard, no second driver, no second outcome surface.

The design decision worth an ADR is already recorded in the two shipped headers this slice corrects
(`src/shared/ipc/attachmentUpload.ts`'s intent paragraph and `src/main/index.ts`'s listener comment):
the dropped path rides the EXISTING channel as an optional request body rather than a new channel, so
there stays exactly one place a path enters main from the window. No new ADR is warranted; the
documentation phase owns that call.

## Design

Five production files, the ticket's budget exactly.

### 1. `src/shared/ipc/attachmentUpload.ts` — the request and its boundary guard

Three additions, in `attachmentBytes.ts`'s shape:

- `MAX_UPLOAD_PATH_LENGTH = 4096` — a SIZE bound at the boundary, not a shape or canonicity one, so the
  single-gate argument stays intact: `readChosenFile` remains the sole thing that decides whether a path
  names a readable regular file. 4096 is `MAX_SAVE_FILENAME_LENGTH`'s figure and the platform ceiling
  for a host path.
- `interface AttachmentUploadRequest { path: string }` — one field. camelCase, client-internal IPC, not
  a wire type. Extra keys are accepted and never read: nothing downstream rebuilds a value from them.
- `isAttachmentUploadRequest(value: unknown): value is AttachmentUploadRequest` — narrow to non-null
  `object`, `in`-guard `path`, typeof the value actually found, non-empty, at or under the bound. The
  `in`-guarded read on a narrowed `object` is what makes a `__proto__`-carrying literal refuse itself:
  the polluting object has no OWN `path`.

Plus the two comment corrections the ticket names: the header's opening summary (`:3`, which says main
"opens the picker" as though that were the only entry) and the "THE INTENT CARRIES NO REQUEST BODY"
paragraph with its `#890` forward reference. `:109`'s "ADDITIVE ROOM IS DELIBERATE" is already correct
and is not touched.

### 2. `src/preload/index.ts` — the sole path resolver

One new `api` member beside `requestAttachmentUpload`, same shape, never exposing `ipcRenderer` or
`webUtils` themselves:

```ts
dropAttachmentFile: (file: File) => void
```

It calls `webUtils.getPathForFile(file)` inside a `try` — that call THROWS when handed something that is
not a `File` — and sends `{ path }` on `ATTACHMENT_UPLOAD_CHANNEL` only when the result is a non-empty
string. This is the deliberate, narrow exception to #862's *renderer names an intent, main owns the
path* rule, and the reason the ticket carries `security-sensitive`.

Why the exception is safe: `getPathForFile` returns the empty string for a `File` the page constructed
itself, so only a file the OS delivered is backed by a path. A compromised renderer therefore cannot
name an arbitrary file on disk — it can only forward what the operator physically dropped. That
property holds only while the preload is the sole resolver and main refuses an empty or non-string path
outright, which is what the guard above is for. `webUtils` is available in a sandboxed preload, which
this app runs (`sandbox: true`).

`PyryApi` is inferred from `api`, so `src/preload/index.d.ts` needs no edit.

### 3. `src/main/index.ts` — the widened listener

`attachmentUploadListener` gains a second parameter, typed `unknown` because the renderer is untrusted
at this boundary regardless of any declared type. Two arms:

- **No argument** → the picker path, byte-for-byte what ships today: `pickerOpen` gate, dialog, cancel
  is a total no-op, `finally` clears the flag.
- **An argument** → `isAttachmentUploadRequest` or DROP. A rejected request makes no filesystem call and
  emits no event, which is the posture every other attachment channel documents. Nothing an operator can
  physically do produces one: a real drop always carries a real path, so an empty or malformed request
  means a page-constructed `File` or a compromised renderer, and neither is owed a sentence in the
  composer. A passing request calls `uploadAttachmentFile(request.path, deps)` — the same deps object
  the picker arm builds.

`pickerOpen` stays scoped to the DIALOG: a drop opens none, so it is neither gated by that flag nor sets
it, and two transfers may be live at once by #862's design. The `emit` closure moves to the top of the
listener so both arms share one definition rather than two that can drift; `sender` is still
`event.sender`, closed in for the same #519 reason.

Plus the comment correction at the listener's "The listener reads NEITHER IPC argument" paragraph.

### 4. `src/renderer/src/screens/conversation/ComposerAttach.tsx` — the drop decision and its container

The pure half — exported, node-testable, no React, no DOM types in the signatures:

| Symbol | Contract |
|---|---|
| `COMPOSER_DROP_ACTIVE_CLASS` | The modifier literal, exported so the e2e spec locates by the production constant. |
| `composerClassName(active: boolean): string` | `'composer'` when inactive — BYTE-IDENTICAL, no trailing space — and the two-class mix when active. |
| `dragCarriesFiles(types: readonly string[] \| undefined): boolean` | Whether a drag carries files, read off `DataTransfer.types`. |
| `reduceFileDropDepth(depth: number, event: FileDropEvent): number` | The enter/leave counter. `FileDropEvent` is a sealed union on `type`: `'enter'` \| `'leave'` \| `'settled'`. |
| `fileToAttach<T>(files: readonly T[]): T \| null` | The one file, or `null` for none and for many. Generic so the unit tier needs no `File`. |

A COUNTER, NOT A BOOLEAN, and that is the whole of "it survives the pointer crossing a child element
rather than flickering": `dragover` fires continuously and child elements fire `dragleave`/`dragenter`
pairs, so a boolean flipped on `dragleave` alone is the classic bug here. `'leave'` floors at zero;
`'settled'` (a drop, or the drag ending) resets outright rather than decrementing, because a drop fires
no matching `dragleave`.

The container half, two changes:

- `useAttachmentUpload` returns a third member, `dropFile(file: File): void`, which clears the held
  outcome and calls `window.pyry.dropAttachmentFile(file)`. It mirrors `requestAttach` exactly, and it
  is why the clear stays in ONE owner rather than being re-implemented at the drop site: "dropping
  clears whatever outcome line is showing" is the same act `requestAttach` already performs.
- `useComposerFileDrop({ onFile })` — holds the depth in `useState`, returns `{ active, handlers }`
  where `handlers` are the four drag props for `.composer`. It also mounts the window-level navigation
  guard in an effect: `dragover` and `drop` on `window`, `preventDefault` for FILE drags only, plus a
  `'settled'` reset on window `drop`/`dragend`. Both listeners are removed in the effect cleanup.

Scoping the window guard to file drags is what keeps "a drag carrying no file is not intercepted at
all" true — text dropped into the textarea keeps working because nothing prevents its default. The
guard rides this hook rather than `App.tsx` because it is mounted wherever the composer is; it is
defence in depth behind `will-navigate`, and it is why a missed drop is a silent no-op today rather than
a hijacked window.

### 5. `src/renderer/src/screens/conversation/ConversationScreen.tsx` — the mount

```tsx
<div className={composerClassName(drop.active)} hidden={covered} {...drop.handlers}>
```

`className` stays ahead of `hidden` in JSX order and the inactive branch is the bare literal, so the
three shipped whole-attribute-run assertions on `class="composer"` and `class="composer" hidden=""`
stay green. The spread carries event handlers only, which render no markup.

The target is the whole `.composer` block, so a drop on the footer row counts.

### CSS (not a production source file by the sizing table)

`.composer--drop-target { outline: 1px solid var(--color-primary); outline-offset: -1px; }`

`outline`, not `border`: `.composer` has NO resting border — it is padding plus a surface background —
so a `border:` in the active state reflows the whole column by 2px. The shipped no-reflow precedent is
one rule above, `.composer__row:has(.composer__input:focus-visible)`. `--color-primary` rather than that
rule's `--color-outline` so the drop edge is not the focus ring's twin when the box inside it also has
focus; both are tokens already in this stylesheet, and no new colour is introduced.
`outline-offset: -1px` draws the edge inside the border box — the composer's bottom edge is the window's,
where an outward outline can be clipped.

## State + concurrency model

No store. The drag depth is ephemeral, screen-local, read by nothing else — ADR 0006's `useState`
shape, the same call `useAttachmentUpload` already makes for the held outcome. It resets for free on a
conversation switch, because `PairedShellView` keys the chat pane on the conversation id.

The one long-lived thing is the window listener pair, owned by the hook's effect and removed in its
cleanup, so a remount nets exactly one live pair (the `onDaemonEvent` / `useAttachmentUpload` idiom).
There is no async work in the renderer half at all: `dropFile` is fire-and-forget.

Main-side, the drop arm starts a transfer without touching `pickerOpen`, so a drop during an open picker
and two drops in a row are both fine — #862's design already admits concurrent transfers with distinct
ids, and `uploadAttachmentFile` never rejects, which is what makes the bare `void` safe.

## Error handling

| Failure | Where it is answered | What the operator sees |
|---|---|---|
| Not a `File` handed to `dropAttachmentFile` | preload `try` | nothing — the send never happens |
| Page-constructed `File` (no path) | preload's empty-string check | nothing |
| Malformed / oversized / non-string request | `isAttachmentUploadRequest` in main | nothing: no filesystem call, no event |
| A dropped FOLDER | `readChosenFile`'s `isFile()` (#862, unchanged) | the existing `failed` / `unreadable` line |
| Over the client byte bound | #862's size guard, unchanged | the existing `refused` line with the limit |
| Transport / daemon failure | #861's driver, unchanged | the existing `failed` line |
| More than one file dropped | `fileToAttach` returns `null` | nothing attached and nothing said (see below) |

**A multi-file drop attaches nothing and says nothing in this slice.** Saying why would mean a new
refusal reason in the shared union plus a branch in `attachmentUploadCopy`'s compiler-forced switch — a
sixth production file, and copy for a feature that does not exist yet. The follow-up ticket owns
multi-file support and its messaging together; the daemon's concurrency bound
(`attachment.too_many_uploads`, #861) is why a naive loop is the wrong first cut.

**Nothing on this path is logged renderer-side**, matching ADR 0007. The path never enters renderer
state, a log line or a diagnostic record: the `File` handle is passed straight into the bridge call and
the resolved string exists only inside the preload function's frame. Main's existing
`diagnosticLog.event` calls in `uploadAttachmentFile` are content-free code literals and are unchanged.

## Testing strategy

**Static / unit (vitest, node — `renderToStaticMarkup`, no DOM, nothing can click):**

- `src/shared/ipc/attachmentUpload.test.ts` (extend the shipped file) — `isAttachmentUploadRequest`
  accepts a well-formed request and one carrying extra keys; rejects `null`, `undefined`, a string, a
  number, an array, `{}`, a non-string `path`, an empty `path`, a path one over
  `MAX_UPLOAD_PATH_LENGTH`, and a `__proto__`-carrying literal. The polluting fixture is built with
  `JSON.parse`, never as an object literal: a literal `{ __proto__: {...} }` creates no own key at all
  and would pass vacuously.
- `ComposerAttach.test.tsx` (extend) — `composerClassName(false)` is exactly `'composer'` (the
  byte-identity the three shipped `composerSlot.test.tsx` assertions depend on) and `true` is the
  two-class mix; `dragCarriesFiles` over `['Files']`, `['text/plain']`, the mixed pair and `undefined`;
  `reduceFileDropDepth` over enter → enter → leave (still active: the flicker case) and leave-at-zero
  flooring and `'settled'` from any depth; `fileToAttach` over zero, one and two.

**Interaction (`e2e/composer-file-drop.spec.ts`, fake tier):** one launch, one continuous drive, a
page-context `DataTransfer` carrying a page-built `File` dispatched onto `.composer`. It proves the state
appears on `dragenter`, survives a child's `dragleave`/`dragenter` pair, clears on `dragleave` and on
`drop`, never appears for a `text/plain` drag, that the window stays on the conversation screen after a
drop on the composer AND after one anywhere else, and that nothing is inserted into the textarea. The
JOIN is proven at this tier without a real path: an outcome is pushed first through
`composer-attach.spec.ts`'s shipped `app.evaluate` seam, and the drop CLEARS it — which only
`dropFile` can do.

**What no tier proves, and why.** A page-built `File` has no path, so this tier cannot carry a real one
across. The path-carrying leg is proven by the shared guard's unit tests plus #862's existing
real-temp-file coverage of `uploadAttachmentFile`; the composition-root join and the preload are this
repo's untested glue, as they are for every other channel. CDP's `Input.dispatchDragEvent` is the
ticket's optional route and is NOT attempted: it still cannot back a `File` with a real OS path, so it
would not close the gap it was nominated for. Stated in the PR.

## Open questions

1. **Does the window-level `drop` suppressor race the composer's own `onDrop`?** Expectation: no —
   React 18 delegates at the root container, which is inside `window`, so the composer's handler runs
   first and the window listener's `'settled'` reset is idempotent. To confirm in Phase B via the e2e
   drive; if it does not hold, the reset moves entirely to the composer's own handler.
2. **Is `--color-primary` visible enough against `--color-surface` at 1px?** Resolve by eye against the
   built app if wall clock allows; the fallback is `--color-outline`, the focus ring's own token.

## Size — stated, not split

Re-counted against this written plan: **5** production source files (the budget exactly), **2** new
exported types (`AttachmentUploadRequest`, `FileDropEvent`), **0** consumer call sites needing a
simultaneous update (every change is additive — `useAttachmentUpload`'s return widens, the listener
gains an arm), **4** acceptance criteria, and no state machine with reject-branch fan-out (the guard has
five reject conditions in one function).

The one boundary this trips is total written work: ~1100 lines against the 800 ceiling. It is stated
rather than split, on the sizing FLOOR, which wins when the two disagree. The only cut available is the
shared channel arm from its sole consumer, and a channel arm nothing drops onto is unverifiable on its
own — it would ship a guard with unit tests and no proof that anything reaches it. Both analogues shipped
clean at over 1500 (#862 at 1529 total, #863 at 1639).

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST FIX. The design adds ONE untrusted→trusted crossing — the request body
  on `ATTACHMENT_UPLOAD_CHANNEL` — and it is explicit rather than scattered: a single named guard
  (`isAttachmentUploadRequest`) in the shared module, applied at the one receiver. Downstream, main
  treats the path as a CLAIM, not a capability: `readChosenFile` opens it, refuses anything that is not
  a regular file, and drops the errno unexamined because it carries the host path.
  **SHOULD FIX, folded into the design:** the plan's containment sentence was "only a file the OS
  delivered is backed by a path", which is true of `getPathForFile` but understates the reachable set.
  `dropAttachmentFile` is callable by any renderer code holding any `File`, so the honest property is
  *only an operator gesture mints a path-backed `File`* — a drop, a `<input type=file>` (this app has
  none), or a file-system picker. The marginal capability a compromised renderer gains is forwarding a
  path-backed `File` it holds from an earlier gesture, not naming an arbitrary path. The preload
  docblock must state it in that form; the `try` is also what stops a thrown `getPathForFile` from
  crossing the bridge, not only a non-`File` filter.
- **[Tokens, secrets, credentials]** Not applicable, and the decision that makes it so: the request
  carries one field and no credential, and the outcome union is content-free by construction and
  unchanged. The adjacent secret-ish value is the PATH itself (a host path names a home directory and
  often a project). It never crosses back to the window and never reaches a log — `uploadAttachmentFile`'s
  diagnostic events are code literals, and `readChosenFile` drops the errno for exactly this reason.
- **[File / storage]** No findings. **Path traversal is not a category error here, it is the accepted
  capability:** the design deliberately does NOT confine the path to a root, because the operator drops
  a file from anywhere on their own disk; the bound is the gesture, per finding 1, not a prefix check.
  **TOCTOU checked and clean** — `readChosenFile` is open-then-check on the file descriptor (`open()`,
  then `handle.stat()` and `handle.readFile()` on the handle), which is the preferred shape, not
  `existsSync`-then-read. Nothing is written to disk on this path, so encryption at rest, atomic writes
  and storage scope are all vacuous here.
- **[Electron attack surface]** No MUST FIX. `sandbox: true` / `contextIsolation: true` /
  `nodeIntegration: false` are unchanged and `webUtils` works in a sandboxed preload. The one new
  `contextBridge` member exposes neither `ipcRenderer` nor `webUtils` and fixes the channel in its
  closure, so it cannot address an arbitrary one; the resolved path is a local const in an isolated-world
  frame and the function returns `void`, so the main world never observes it.
  **STATED AND ACCEPTED — repetition is unbounded on the drop arm.** `pickerOpen` is deliberately not
  consulted, so a compromised renderer can call `dropAttachmentFile` in a loop with one `File` and start
  N concurrent transfers from a single gesture. Bounds: #862's per-upload byte guard caps each, and the
  daemon answers past its own concurrency bound with `attachment.too_many_uploads` → a `failed` outcome.
  It is a self-DoS by a renderer that already holds the command channel (it can spam `send_message`
  today), so the marginal capability is small and a client-side concurrency cap belongs with #861's
  bound, not here — a sixth concern in a slice already over the line ceiling.
  **A `text/uri-list`-only drag is deliberately NOT intercepted**, which is what keeps "a drag carrying
  no file keeps whatever it does today" true. A `file:///…` URL dragged onto the page background
  therefore reaches the browser's own navigation, and `will-navigate` + `isSameTarget` in
  `src/main/index.ts` is what refuses it. That is the coverage for the case, and widening
  `dragCarriesFiles` to uri-list would break ordinary link drags into the textarea.
- **[Cryptographic primitives]** Not applicable: this slice adds no randomness, no comparison against a
  secret and no key handling. `uploadId`'s `randomUUID` lives in `uploadAttachmentFile`, unchanged and
  already reviewed under #862.
- **[Network & I/O]** No findings. No socket, URL, timeout or TLS setting is introduced; the transfer a
  drop starts is #861's, with its shipped chunk bound and #862's byte bound applied before a byte goes
  on the wire. The only thing added to that path is a second way to START one — see the concurrency
  note above.
- **[Error messages, logs, telemetry]** No findings, as a decision rather than an omission. A rejected
  request is dropped with no event AND no log, matching `attachmentBytes`, `attachmentSave` and
  `attachmentOpen`, all of which drop silently at their guard. Logging there would also hand a looping
  renderer a way to drive the main-process logger. Nothing renderer-side is logged at all (ADR 0007).
- **[Concurrency]** No findings. The window listener pair is owned by the hook's effect and removed in
  its cleanup, so a remount (StrictMode's double-invoke included) nets one live pair. The drag depth is
  component state, reset by `PairedShellView`'s conversation-keyed remount. The drop arm reads no shared
  mutable state, so it introduces no check-then-act across an `await`; the picker arm's `pickerOpen`
  check-then-set stays synchronous ahead of its first `await`, unchanged. `sender.isDestroyed()` and the
  `will-quit` removal are #862's and unchanged.
- **[Threat model alignment]** A malicious relay stays content-blind and on-path; a drop starts the same
  Noise-wrapped transfer. Token-at-rest is untouched. A hostile daemon's blast radius on this path is
  the one misleading sentence #863's review already accepted, since the outcome union is unchanged.
  **Renderer compromise reaching the transport** is the threat this ticket is labelled for: process
  isolation still denies the renderer the keys, the token and the socket, and what it gains is bounded
  by findings 1 and 4 — forwarding a path-backed `File` it holds, and repetition.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-04
