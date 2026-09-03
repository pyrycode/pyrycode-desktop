# #864 — show progress while a large attachment uploads

## Files read

Codegraph is not initialised in this repo (`codegraph_*` returns a hard "CodeGraph not initialized"
error rather than an empty result), so this list came from Grep and Read.

- `src/shared/ipc/attachmentUpload.ts` → `AttachmentUploadEvent`, `AttachmentUploadFailure`,
  `ATTACHMENT_UPLOAD_EVENT_CHANNEL` — the union this slice widens, and the docblock that names this
  ticket twice as the reason the flow uses two channels rather than an invoke.
- `src/main/attachmentUpload.ts` → `ATTACHMENT_MAX_UPLOAD_CHUNKS`, `AttachmentUploadDeps`,
  `driveUpload`, `uploadAttachmentFile`, `uploadAttachmentBytes` — where the threshold constant lands
  and where the gate that decides whether progress costs any IPC at all is applied.
- `src/main/transport/attachmentTransfer.ts` → `createAttachmentTransfer`, `AttachmentTransferDeps`,
  `settle`, `drive` — the module that already holds `chunks.length` and `sentEnvelopes` and reports
  neither upward. Its `settled` flag re-read at the top of every loop iteration is what makes "no
  progress after the terminal" structural rather than a promise.
- `src/main/daemonConnection.ts` → `uploadAttachment`, `sendAttachmentChunk`, the `DaemonConnection`
  interface's `uploadAttachment` docblock — the hop between the transfer and the flow module.
- `src/main/index.ts` → the attach composition-root edge (the `ATTACHMENT_UPLOAD_CHANNEL` listener and
  its `upload:` / `emit:` arrows) — the one place the two seams are joined to Electron.
- `src/renderer/src/screens/conversation/attachmentUploadCopy.ts` →
  `attachmentUploadOutcomeCopy`, `formatByteLimit`, `FAILURE_COPY_BY_REASON` — the explicit return
  type with no `default` that the union's growth reddens (TS2366), and `formatByteLimit` as the
  precedent for putting a computed figure in a sentence.
- `src/renderer/src/screens/conversation/ComposerAttach.tsx` → `ComposerAttachOutcome`,
  `useAttachmentUpload` — the single nullable that makes "progress and terminal occupy the same slot"
  true by construction, and the `role="status"` decision this slice must not regress.
- `src/renderer/src/screens/conversation/conversation.css` → the `.composer__attach-outcome` rule and
  its comment ("NO height AND NO min-height, which is the whole of AC5's second half").
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → the `ComposerAttachOutcome` mount
  and the JSX comment above it — the mount site stays untouched by this slice.
- `e2e/composer-attach.spec.ts` → the `push` helper and the outcome drive — the seam that pushes on
  `ATTACHMENT_UPLOAD_EVENT_CHANNEL` from inside `app.evaluate`, so no real daemon and no real file are
  needed to prove the transition.
- `src/main/transport/attachmentChunkPlan.ts` → `planAttachmentChunks` — `total_chunks` is
  `max(1, ceil(size / 45000))`, which is the denominator this slice reports against.
- Existing test files read for their harness shape before extending them:
  `src/shared/ipc/attachmentUpload.test.ts` (the positive key walk that is AC4's proof site),
  `src/main/attachmentUpload.test.ts` (`harness()`, `everyStringEmitted()`),
  `src/main/transport/attachmentTransfer.test.ts` (`recordingSender()`, `immediate`, `drain`),
  `src/main/daemonConnection.test.ts` (the upload block's `build`/`answer`/`drain` shape),
  `src/renderer/src/screens/conversation/ComposerAttach.test.tsx`,
  `.../attachmentUploadCopy.test.ts`, and `ConversationScreen.test.tsx`'s attach mount proofs
  (`ATTACH_TRIGGER_CLASS_RUN`, and the `not.toContain('composer__attach-outcome')` baseline).
- `docs/knowledge/features/composer-attach.md`, `attachment-upload.md`, `attachment-transfer.md` —
  the package overviews for the three layers this crosses.

## Design source

**Figma:** N/A — echoed from the ticket. Node `102-4` covers the input footer's resting appearance
only, and the attachment icon `115:3654` has no in-flight variant; #863 already declined to draw one
in shipped code ("NO DISABLED AND NO IN-FLIGHT VARIANT") on the stated grounds that it would pre-empt
this ticket. The visual-fidelity check is therefore intentionally skipped, and this slice draws no new
chrome: the progress line reuses `.composer__attach-outcome`'s shipped treatment (M3 body/small in
`--color-primary`, `--space-4` inset) through a selector list rather than inventing a look. If a
designed treatment lands later it supersedes whatever ships here, and the follow-up is a Figma-side
ticket.

## Context

A chunk carries at most `ATTACHMENT_CHUNK_DATA_BYTES` raw bytes, so a 10 MB file is over two hundred
frames across the relay. Between the click and the terminal the composer says nothing at all today:
`useAttachmentUpload` clears its state on the click and holds `null` until `completed`, `failed` or
`refused` arrives. A silent composer for thirty seconds reads as a hang.

The count that answers this already exists one layer too low to be seen —
`createAttachmentTransfer` holds the plan's `chunks.length` and the `sentEnvelopes` set and reports
neither upward. This slice surfaces it by widening one seam at each of four hops and adding a fourth
member to the union that already documents the room as deliberate.

The transport design is settled and this slice does not reopen it: progress rides
`ATTACHMENT_UPLOAD_EVENT_CHANNEL` as a fourth member of `AttachmentUploadEvent`. A new `DaemonEvent`
union member is the recorded rejected alternative (a compile-forced edit in four renderer bridges that
each end their switch in `assertNever`) and is not taken.

No ADR is warranted. Every decision here is a restatement of one already recorded — ADR 0006's
`useState` shape for screen-local ephemeral state, the two-channel choice in
`src/shared/ipc/attachmentUpload.ts`'s own header, and CLAUDE.md's "keep the transport out of the
window".

### Size: both ceilings are exceeded, deliberately

Counted against this plan: **7 production source files** (`attachmentUpload.ts` shared,
`attachmentTransfer.ts`, `daemonConnection.ts`, `attachmentUpload.ts` main, `index.ts`,
`attachmentUploadCopy.ts`, `ComposerAttach.tsx`) plus `conversation.css`, against a ceiling of 5; and
an estimated ~1400 lines of total written work against a ceiling of 800. The refiner counted six and
ruled the overage deliberate; the seventh is `index.ts`, whose composition-root arrow must forward the
new argument for any of the rest to be reachable — it does not change the shape of the judgement.

The floor beats the ceiling here, and the ticket states the argument: cutting the transport seam off
from its consumer leaves a first ticket whose entire deliverable is an injected callback nothing calls
until the second one lands — the sizing floor's "a name minted for one caller", which no resume fixes.
Every prior slice of this family has landed over 800 with the pipeline clean, measured from the merge
commits: #860 at 1214, #861 at 1859, #862 at 1529, #863 at 1639. The other four boundaries hold
comfortably — 1 new exported type (`AttachmentTransferProgress`), 1 production consumer of the widened
`uploadAttachment` signature, 4 acceptance criteria, and no new reject branches at all.

## Design

Four seams widen so one number can travel from the send loop to the composer. Nothing else moves.

### 1. The wire between the processes — `src/shared/ipc/attachmentUpload.ts`

`AttachmentUploadEvent` gains a fourth member:

```ts
| { type: 'progress'; uploadId: string; sentChunks: number; totalChunks: number }
```

`sentChunks` is how many chunk envelopes this transfer has put on the wire; `totalChunks` is the
plan's `total_chunks`. Both are frame counts, which is the vocabulary AC1 names ("derived from the
chunks put on the wire against the plan's total").

The type's docblock currently opens "The terminal outcomes of one attach intent" and must be rewritten
— the union is no longer terminals-only. What it keeps is the CONTENT-FREE BY CONSTRUCTION paragraph,
extended over the new member: neither field can hold a byte of the file, a path segment or a name.
They are counts of frames, the same class of figure as the already-allowlisted `count` and `bytes`
diagnostic fields, and the relay observes the frame count directly regardless — so nothing crosses
this bridge that was not already on the wire in front of it.

Cardinality also changes: exactly one TERMINAL is still pushed per intent that got as far as a chosen
file, now optionally preceded by zero or more `progress`. The docblock states that explicitly, because
"exactly one event per intent" is the property renderers were told to rely on.

**One thing #862's containment argument did not cover, and the docblock must now say so.** #862's
central property is that a compromised renderer "can make a picker appear; it cannot choose what that
picker opens, and it cannot read back what was sent". `totalChunks` is the first field on this union
derived from the CHOSEN FILE rather than from a client-owned constant: it reveals the file's size to
within `ATTACHMENT_CHUNK_DATA_BYTES`. The resolution is to state it, not to hide it — because the
EMISSION CADENCE reveals the same number regardless of the payload. A renderer that receives one event
per chunk can count the events, so a percent-only member would withhold nothing while being less
honest about what it costs. The disclosure is accepted on its size: a window that already holds the
whole conversation timeline learning the approximate size of a file its own user just picked is far
inside the blast radius #862 already accepts.

### 2. The send loop — `src/main/transport/attachmentTransfer.ts`

A new exported type and one optional dep:

```ts
export type AttachmentTransferProgress = (sentChunks: number, totalChunks: number) => void
// on AttachmentTransferDeps:
onProgress?: AttachmentTransferProgress
```

`drive()` calls it after `sentEnvelopes.add(envelopeId)` and before the yield, through a local helper
that returns early when `settled` — so a progress report is impossible after the terminal by the same
mechanism that stops the remaining chunks, rather than by a second rule. The call is wrapped in a
`try`/`catch` that drops the caught object unexamined: the module's header states that `drive()` never
rejects and this slice introduces the first foreign callback inside that loop, so a throwing consumer
must not turn `void drive()` into an unhandled main-process rejection. Dropping rather than inspecting
is the module's standing classify-don't-forward posture (inherited #62).

`sentEnvelopes.size` is the numerator, not a private counter — it is the same figure the settle log
already reports as `count`, so the two cannot drift.

`AttachmentTransferProgress` returns `void`, and the loop NEVER awaits it. That is a constraint rather
than a style: the `yieldToEventLoop` macrotask between chunks is what creates the window in which an
inbound reject can be observed, and an awaited consumer would let a slow renderer stall the send loop
and stretch that window arbitrarily. A `void` return type is what makes awaiting it unavailable.

No new logging. A per-chunk diagnostic record would put up to `ATTACHMENT_MAX_UPLOAD_CHUNKS` lines in
the debug bundle for one upload; the `started` record already carries `count` and the settle record
already carries how far the transfer got.

### 3. The connection hop — `src/main/daemonConnection.ts`

`uploadAttachment` takes an optional second parameter and passes it straight into the transfer's deps:

```ts
uploadAttachment(input: AttachmentChunkPlanInput, onProgress?: AttachmentTransferProgress): Promise<AttachmentTransferResult>
```

A second parameter rather than a field on `AttachmentChunkPlanInput`: that type is the plan's input and
is spread onto every chunk payload, so a callback has no business in it. Both early exits — the
`driver === null` `not-connected` return and the `createAttachmentTransfer` throw backstop — return
before any transfer exists, so neither can report progress.

### 4. The gate and the emit — `src/main/attachmentUpload.ts`

A named constant beside `ATTACHMENT_MAX_UPLOAD_CHUNKS`, expressed in chunks:

```ts
export const ATTACHMENT_PROGRESS_MIN_CHUNKS = 8
```

Eight chunks is 360000 raw bytes, ~480000 base64 characters on the wire — about half a second at the
1 MB/s effective uplink `ATTACHMENT_MAX_UPLOAD_CHUNKS`'s own docblock reasons in. Below that a progress
line is a flash the eye reads as a glitch, which is worse than the silence it replaces. It is a chunk
count and not a clock, so the decision is the same on a fast link and a slow one.

`AttachmentUploadDeps.upload` widens to `(input, onProgress?) => Promise<AttachmentTransferResult>`.
`driveUpload` passes a closure that applies two guards before `deps.emit`:

- `totalChunks < ATTACHMENT_PROGRESS_MIN_CHUNKS` → return. The threshold is evaluated here rather than
  in the transport because that is where the client's own bounds already live, and because deciding in
  the background process means a small upload costs no IPC at all (AC2).
- a local `terminal` flag, set immediately after `await deps.upload(...)` resolves and before either
  terminal arm emits → return. This is a second guard over the transport's, in different fabric and in
  a different module, and it is the module's own established posture rather than an invented defence:
  `driveUpload` already ships a backstop `try`/`catch` around `deps.upload` on the explicit grounds
  that "a contract is not a guarantee" for an injected seam. AC3 asks for the property; the injected
  seam is where it can be violated.

`reportRefused` fires before any transfer starts, so a `refused` can never be preceded by progress —
which is why AC3 parenthesises it out.

### 5. The sentence — `attachmentUploadCopy.ts`

A fourth arm on `attachmentUploadOutcomeCopy`, which is what the missing `default` and the explicit
return type exist to force (TS2366):

```
`Uploading… ${uploadProgressPercent(sentChunks, totalChunks)}%`
```

`uploadProgressPercent(sent, total)` is exported for its own tests and is TOTAL at the boundary, the
posture `FAILURE_COPY_BY_REASON`'s `Map` already takes in this module: the declared type is the
compile-time half only and nothing validates what actually crosses `ipcRenderer.on`, so a
non-finite value or a zero total must resolve to a number rather than render "NaN%". It floors, and
clamps into `[0, 100]`.

100% means every chunk is on the wire and the host's answer is still outstanding — that is what "how
far the transfer has got" measures, and the terminal is what says the file was stored. The alternative,
capping at 99, would never reach the figure it displays.

The module's "no arm interpolates" rule is untouched: it is about `reason`, a daemon-SELECTED value.
This figure is computed by this client from two client-held counts, which is `formatByteLimit`'s
precedent exactly.

### 6. The line — `ComposerAttach.tsx` and `conversation.css`

`ComposerAttachOutcome` keeps its name, its prop and its mount site, and branches on the discriminator:

- `null` → renders nothing at all (unchanged, and the strict exact-empty test stays).
- `progress` → `<div className="composer__attach-progress" key="progress">`, **no live-region role**.
- a terminal → `<div className="composer__attach-outcome" role="status" key="terminal">`, unchanged.

**The live-region decision, which is the one place this slice can regress a shipped one.** #863 chose
`role="status"` because an outcome fires at most once per attach. Progress fires per chunk — up to
`ATTACHMENT_MAX_UPLOAD_CHUNKS` times — and a polite live region announcing each is worse than silence.
Of the ticket's three options this takes the first: a separate, non-live element. The progress line is
readable by browsing and announced by nothing.

The two `key`s are load-bearing rather than decoration. React reconciles by element type and position,
so without them the progress `<div>` and the terminal `<div>` are the same DOM node and the terminal
transition would ADD `role="status"` to an existing node while changing its text — the case assistive
technology handles least reliably. Distinct keys make the terminal a fresh insertion carrying its
content, which is byte-for-byte the shipped #863 behaviour. `renderToStaticMarkup` ignores keys, so
this is invisible to the static tier and provable only by reading the code.

Separate classes rather than a shared-treatment lift or a modifier mix: every shipped assertion on
`class="composer__attach-outcome"` is a whole-attribute-run or substring match, and prepending or
appending a class to that run is the failure that reddens four assertions while a fifth passes
vacuously. `conversation.css` adds `.composer__attach-progress` to the existing rule's selector list —
one declaration block, no duplicated treatment, no shipped element re-classed.

"No second indicator appears beside it" is true by construction, not by arbitration: the hook holds one
nullable and the latest event wins, and the two branches are mutually exclusive on the discriminator.

## State + concurrency model

No store slice is added. The state stays `useAttachmentUpload`'s single `useState<AttachmentUploadEvent | null>`
— ADR 0006's screen-local ephemeral shape — and the clear-on-click stays where #863 put it, for the
reason recorded there: a cancelled picker reports nothing at all.

The main-side chain is unchanged in shape. `drive()` is the only long-lived async job and its
cancellation path is the `settled` flag it re-reads before every chunk, driven by the correlated
reject, the connection-teardown net, or a local send throw. Progress rides that same flag, so a
connection lost mid-transfer stops progress and delivers `connection-lost` on the same path a
completion takes (AC3).

Re-render cost, and **the emission is NOT paced by the uplink** — see the Revisions entry below for the
figure this replaces. Nothing in the send path awaits the wire: `sendAttachmentChunk` calls
`noiseRelayDriver.sendMessage`, which returns `void` and buffers, and the only thing between two chunks
is `yieldToEventLoop`, which `daemonConnection.uploadAttachment` leaves at its `setImmediate` default.
So the reports are paced by event-loop turns, not by bandwidth: up to `ATTACHMENT_MAX_UPLOAD_CHUNKS`
(512) `setState` calls arriving as a burst over scheduler turns rather than spread across the
transfer's wire time, each re-rendering the `Composer` subtree, while the rendered text takes at most
101 distinct values.

Coarsening the emission cadence — reporting only when the whole-percent figure changes — is still
declined, but on the honest grounds rather than on a low rate: nothing has been observed to strain, no
acceptance criterion asks for it, and the live-region problem the ticket raises coarsening for is
solved by the non-live element instead. Shipping a defence for an unmeasured cost is the trade this
pipeline declines by default. What the reader needs is the seam and the true shape of the load, and a
future ticket that observes real jank has both: the guard would go in `driveUpload`'s closure, beside
the `ATTACHMENT_PROGRESS_MIN_CHUNKS` gate that already drops reports there.

## Error handling

- A throwing `onProgress` consumer is caught and dropped inside the send loop, preserving "`drive()`
  never rejects". The caught object is never inspected: a `webContents.send` failure's message is not
  interesting and this module's rule is classify-don't-forward.
- A non-conforming `progress` event crossing the bridge (a wrong-typed or absent count) resolves to a
  clamped `0`–`100` figure rather than "NaN%", through `uploadProgressPercent`. The guard is
  `Number.isFinite` and never the global `isFinite`: the global COERCES, so `isFinite('5')` is `true`
  and a string count would reach the arithmetic. `Number.isFinite` returns `false` for every
  non-number, which is the totality this boundary needs.
- No new failure outcome, no new reject branch, and no change to `AttachmentUploadFailure`.
- `emit` at the composition root keeps its `isDestroyed()` guard, so a window closed mid-upload drops
  progress exactly as it already drops the terminal.

## Testing strategy

Vitest, node environment, `renderToStaticMarkup` for the renderer — no DOM, nothing clicks.

- **`src/shared/ipc/attachmentUpload.test.ts`** — the progress member joins the positive
  `Object.keys` walk, which is AC4's proof site: a member that later grew a `path` or a `filename`
  would have to be added to the expected key list to pass. The discriminator count moves 3 → 4.
- **`attachmentTransfer.test.ts`** — `onProgress` fires once per chunk with the running count and the
  plan's total; it does not fire after a settle arrives mid-transfer (the existing mid-transfer reject
  fixture, extended); a throwing `onProgress` neither stops the loop nor rejects, and the transfer
  still delivers its single terminal; a transfer with no `onProgress` behaves exactly as today.
- **`attachmentUpload.test.ts` (main)** — a transfer under `ATTACHMENT_PROGRESS_MIN_CHUNKS` emits no
  progress event at all (AC2); one at or above it emits progress followed by exactly one terminal
  (AC3); a driver that calls `onProgress` AFTER resolving produces no progress after the terminal;
  the emitted progress events carry exactly the four declared keys and no string field at all, so the
  existing leak walk still finds nothing.
- **`daemonConnection.test.ts`** — one test in the upload block: a listener passed to
  `uploadAttachment` receives a report per chunk against the plan's total, and receives nothing after
  the `attachment_stored` answer settles the transfer.
- **`attachmentUploadCopy.test.ts`** — the progress sentence for a mid-transfer figure; `sent ===
  total` reads 100%; a zero total, a negative count and a non-finite count each resolve to a clamped
  figure rather than "NaN"; the sentence contains no uploadId.
- **`ComposerAttach.test.tsx`** — a progress event renders `.composer__attach-progress` carrying the
  copy module's own output, with NO `role="status"` and no `role="alert"`, and without the
  `composer__attach-outcome` class anywhere in the markup; a terminal still renders exactly today's
  live region; the `null` exact-empty assertion is untouched; the uploadId reaches no attribute or
  text node in either state.
- **`e2e/composer-attach.spec.ts`** — the transition, which is the only tier that can drive it. Pushed
  through the existing `push` helper on the same channel `emit` uses: after the shipped terminal
  drive, a progress event replaces the terminal line (progress element present, outcome count 0 — AC1
  and AC3's "no second indicator"), a second progress with a higher figure advances the text, and a
  `failed`/`connection-lost` terminal then clears the progress element and states its sentence (AC3's
  connection-lost arm). `.composer__footer [role="alert"]` stays at count 0 throughout.

Fakes over mocks throughout: the transport tests drive the real `createAttachmentTransfer` through its
injected `sendChunk`, and the e2e spec pushes real union members on the real channel. Nothing here
needs `vi.mock`.

The one property no tier proves is the remount forced by the two `key`s: `renderToStaticMarkup` drops
keys and the fake tier cannot observe an announcement. It is carried by a code comment naming what it
is for, which is the honest state of it.

## Open questions

1. **The threshold's value.** 8 chunks (~360 kB) is argued from the uplink figure
   `ATTACHMENT_MAX_UPLOAD_CHUNKS` already reasons in, but the constant is the deliverable and the
   number is a judgement. To be settled in Phase B only if a test makes a different figure obviously
   better; otherwise it ships as reasoned, and a later ticket can move one named constant.
2. **The sentence's wording.** `Uploading… N%` versus naming chunks outright. Resolve in Phase B
   against the copy module's existing voice (short, client-authored, no interpolated daemon value).
3. **Whether `daemonConnection.test.ts` needs its own progress test** or whether the compiler plus the
   two layers either side of it cover the pass-through. Resolve by writing it: if the harness cost is
   more than one straightforward test, the seam is covered by its neighbours and the plan says so in a
   `## Revisions` entry.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] **SHOULD FIX — documented in the design above.** This slice adds NO
  renderer → main data at all: the intent channel is untouched, `requestAttachmentUpload()` still takes
  no argument, and every new value travels main → renderer. So no new untrusted-to-trusted boundary
  exists. What DOES change is the disclosure direction: `totalChunks` is the first field on
  `AttachmentUploadEvent` derived from the chosen file rather than from a client-owned constant, and it
  reveals the file's size to within `ATTACHMENT_CHUNK_DATA_BYTES`. It qualifies #862's "it cannot read
  back what was sent", so the union's docblock must say so. It is not withheld by shipping a percentage
  instead: at one event per chunk the renderer counts events and derives the same number, so the
  disclosure is the CADENCE, not the field. Accepted on its size — the window already holds the whole
  conversation timeline.
- [Trust boundaries, second] **SHOULD FIX — designed in.** The renderer treats the incoming event as
  declared-only; nothing validates what crosses `ipcRenderer.on`. `uploadProgressPercent` must be total
  over any input, guarding with `Number.isFinite` and never the global `isFinite` (which coerces, so
  `isFinite('5')` is `true`). The failure it prevents is a rendered "NaN%", not a code path — the value
  reaches a text node only, never an attribute, a URL, a key or a log.
- [Tokens, secrets, credentials] Not applicable, and the reason is structural: this slice adds two
  integers to an existing channel. It mints nothing, stores nothing, reads no credential and touches
  neither `safeStorage` nor disk. `uploadId` is the existing `randomUUID` and is carried unchanged.
- [File / storage operations] Not applicable. No new `fs` call, no path is constructed or joined, and
  `readChosenFile`'s open-then-stat ordering and its size guard are untouched. The threshold is applied
  to a chunk count over bytes already resident, strictly AFTER the read decision — so no gate here can
  cause a file to be read that the shipped bound would have refused.
- [Inter-process / Electron attack surface] No findings. No new channel, no new `ipcMain` handler, no
  new `contextBridge` method: `onAttachmentUploadEvent` already exists and forwards. `webPreferences`
  is untouched. The one new characteristic is VOLUME — up to `ATTACHMENT_MAX_UPLOAD_CHUNKS` messages
  per upload where there was one — and it is not renderer-amplifiable: the composition root's
  `pickerOpen` flag drops a second intent while a picker is open, and every transfer needs a human to
  pick a file. Nothing INBOUND can trigger, accelerate or extend progress either; it is driven entirely
  from this client's own send loop over its own plan.
- [Cryptographic primitives] Not applicable. No RNG, no key, no nonce, no comparison against a secret.
  The Noise variant, the handshake and the chunk envelopes are untouched — this slice adds no wire
  field and sends no frame.
- [Network & I/O] **SHOULD FIX — designed in.** No new socket, timeout, or frame. The one real risk is
  timing: `onProgress` is called inside the send loop, so `AttachmentTransferProgress` must return
  `void` and must never be awaited. An awaited consumer would let a slow renderer stall the loop and
  stretch the `yieldToEventLoop` window that exists so an inbound reject can be observed mid-transfer —
  turning a UI concern into a transport one.
- [Error messages, logs, telemetry] No findings. Progress is deliberately NOT logged: a per-chunk
  record would put hundreds of lines in the debug bundle, and the `started` and settle records already
  carry `count`. The caught `onProgress` throw is dropped unexamined (classify-don't-forward, inherited
  #62). The progress member's only string fields are `type` and `uploadId`, both already covered by
  `attachmentUpload.test.ts`'s positive leak walk over every emitted string.
- [Concurrency] **Two findings, both accepted and named.** (a) The two check-then-act guards are each
  synchronous with the action they guard — `settled` is re-read and `onProgress` called within one
  loop iteration with no await between them, and `terminal` is set immediately after `deps.upload`
  resolves and before either terminal arm emits. Neither has a gap for a concurrent settle to land in.
  (b) Two concurrently live transfers interleave into one composer slot, because the hook cannot
  correlate: `requestAttachmentUpload()` returns void, so the window never learns the uploadId its own
  click minted. This is #863's shipped property, made visible rather than introduced. OUT OF SCOPE —
  correlating would mean the intent returning an id, which is a channel change belonging to #890.
- [Threat model alignment] A hostile RELAY is on-path and content-blind: it can delay chunks, which
  makes progress advance slowly — the honest report — and it cannot forge progress, which is driven by
  local state alone. A hostile DAEMON cannot trigger progress; it can settle the transfer (which stops
  it on the same path a completion takes) or WITHHOLD the terminal, leaving the line at "Uploading…
  100%" indefinitely. That residual is the no-per-transfer-deadline gap already recorded in
  `attachmentTransfer.ts`'s header, and this slice makes it visible instead of silent, which is an
  improvement on the symptom rather than a new hazard. OUT OF SCOPE — it is fixed where the deadline
  gap is recorded, not here. Renderer compromise reaching the transport is unchanged: the bytes, the
  path, the filename and the socket all stay in the background process.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-04

## Revisions

### 2026-09-04 — the three open questions, resolved during implementation

No design changed; recorded so the questions are visibly answered rather than dropped.

1. **The threshold's value** ships as reasoned: `ATTACHMENT_PROGRESS_MIN_CHUNKS = 8`. Nothing in the
   implementation argued for a different figure, and its test asserts the property that actually
   matters — an integer strictly inside `ATTACHMENT_MAX_UPLOAD_CHUNKS`, so the feature stays reachable
   — rather than pinning the number itself, which a later ticket should be free to move.
2. **The sentence** ships as `Uploading… N%`. Its test asserts it differs from all three terminal
   sentences, which is the property the shared slot needs: the reader has only the text to tell which
   state is showing.
3. **`daemonConnection.test.ts` earned two tests, not one.** The upload block's `connected()` /
   `answer()` / `drain()` harness made the pass-through test cheap, and writing it surfaced a second
   worth having: the `not-connected` early return resolves before a transfer exists, so a request made
   while disconnected reports no progress at all. That arm is only observable at this layer — the flow
   module sees a resolved result and the transport is never constructed.

One implementation detail worth naming for a later reader: the shared-union change is RED under
`npm run typecheck` and GREEN under `vitest` from the start, because vitest does not typecheck and the
positive `Object.keys` walk passes on the object literal at runtime regardless. The typechecker is the
gate that actually holds `AttachmentUploadEvent`'s shape, which is the same reason
`attachmentUploadOutcomeCopy`'s missing `default` is load-bearing.

### 2026-09-04 — rework leg 1: a test that could not detect what it claimed, and a rate figure that was wrong

Both findings land on the same designed-in mitigation from the Security review's second trust-boundary
item, from opposite sides: the guard was right, its proof was not, and the load figure that justified
leaving the cadence alone was reasoned from the wrong clock. No interface, no contract and no shipped
behaviour changed — the diff is one test, one plan section and one comment.

1. **`uploadProgressPercent`'s string-coercion test proved nothing (MUST FIX).** It asserted
   `not.toContain('NaN')` and `toContain('0%')` against `sentChunks: '5'` / `totalChunks: '10'`. The
   coercing global `isFinite` states `Uploading… 50%` for those counts, which contains the substring
   `0%` and no `NaN` — so both assertions held under both guards, and this was the only test in the
   suite that could have reddened on the swap. The neighbouring totality test passes `NaN`, `Infinity`,
   negatives and a zero total, on every one of which the two guards agree. Swapping `Number.isFinite`
   for the global was therefore a green change, while the test's own comment told the next reader it
   was covered.

   Repaired as WHOLE-SENTENCE EQUALITY against a genuine zero rather than a substring, since a
   substring of a percent figure is a sub-figure of every percent figure ending in it. The counts moved
   to `'5'`/`'8'` so the coerced reading (`62%`) collides with nothing, and the test now carries its own
   anti-vacuity line — asserting that the same counts read as NUMBERS state a different sentence, so the
   equality above is one the module can actually fail. The general lesson, which is not specific to this
   module: a `toContain` against a formatted NUMBER is a weak assertion by construction, because the
   format's own alphabet is small and its values nest.

2. **The re-render figure was derived from a clock the code does not have (SHOULD FIX).** The section
   above read "512 `setState` calls over a transfer bounded at ~30 s, so ~17/s worst case", reasoning
   from the 1 MB/s uplink that `ATTACHMENT_MAX_UPLOAD_CHUNKS`'s docblock uses. But the send loop is not
   paced by the uplink at all: `sendMessage` returns `void` and buffers, nothing awaits socket drain,
   and `yieldToEventLoop` is left at its `setImmediate` default, so the reports burst at scheduler
   cadence. The rate was wrong by orders of magnitude in the direction that mattered — it made the load
   look mild — and a future ticket investigating jank would have read it as measured.

   The figure is corrected in place and the conclusion is deliberately unchanged: the cadence is still
   not coarsened, now on the grounds that the cost is unobserved rather than on the grounds that it is
   small. Shipping a defence for a failure mode nobody has seen is the trade this pipeline declines by
   default, and the corrected paragraph names where the guard would go if someone measures one.
