# #1039 — record a sent message's attachments on its timeline item

## Files read

Codegraph is indexed for this repo but every `mcp__codegraph__*` call answers "CodeGraph not initialized",
so this list came from Grep + Read. Noted as the gap it is, not as a choice.

- `src/renderer/src/store/threadTimeline.ts` → `ThreadItem`, `ThreadEvent`, `reduceTimeline`'s `userText`
  arm — the two message arms this slice widens, and the `createdAt` / `input` / `resultDetail` docblocks
  that state the optional-field idiom (absent means "none", tested `=== undefined`, carried verbatim and
  unconditionally, never a conditional spread).
- `src/renderer/src/screens/conversation/composerSend.ts` → `ComposerSendDeps`, `submitMessage` — the
  single production writer of a `userText` echo, the one object handed to both stores, and `now`'s
  docblock, which records the optional-vs-required trade this slice faces again.
- `src/renderer/src/screens/conversation/composerSend.test.ts` → the thirteen `ComposerSendDeps` literals,
  and the three `toHaveBeenCalledWith({ type: 'userText', text })` assertions that a required field would
  redden.
- `src/renderer/src/screens/conversation/ComposerAttach.tsx` → `useAttachmentUpload` (the held outcome, the
  three gesture entries and their `setOutcome(null)`), plus the four pure decision functions this file
  already exports — the shape the new rule follows.
- `src/renderer/src/screens/conversation/attachmentUploadCopy.ts` → `attachmentUploadOutcomeCopy` — the
  file family's exhaustiveness idiom over `AttachmentUploadEvent` (explicit return type, **no `default`**,
  TS2366 as the classification force) and the reason its `reason` read needs a `Map` where the
  discriminator does not.
- `src/shared/ipc/attachmentUpload.ts` → `AttachmentUploadEvent` and its `completed` member — what
  `filename` is, how it is bounded, and the containment paragraphs #1038 added.
- `src/main/attachmentUpload.ts` → `driveUpload` — `attachment_id: uploadId`, which is what makes the
  recorded identifier the daemon's own.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Composer` — the one production
  `submitMessage` call site, its deps literal built inside the handler, and `sendText`'s two callers.
- `docs/knowledge/features/composer-attach.md` § Two pure views and a container hook — the ADR 0006 ruling
  for this hook's state and the free reset a conversation switch gives it.
- `docs/knowledge/features/composer-send.md` § 1 — `now`'s thirteen-call-site trade, stated as a lesson.

## Design source

**Figma:** N/A — nothing renders and nothing is user-visible in this slice (the ticket's own ruling).
#815 draws the non-image file row and #868 the image thumbnail; both own the visual fidelity check.

## Context

Nothing in this app associates an attachment with a message. #815 and #868 each draw an attachment inside
a message bubble and neither can be mounted until a timeline item says which attachments a message has.
This slice creates that carrying, for the one direction buildable with no daemon change: attachments the
operator minted here, recorded on the operator's own echo.

The two halves of the recorded pair both already reach the window: `driveUpload` sends
`attachment_id: uploadId`, so the completed terminal's `uploadId` is the id the daemon stored the file
under, and #1038 put the display name on the same terminal and shipped it with no consumer. This is that
consumer.

No ADR is warranted: the state placement is ADR 0006 applied as written, and the field is an additive
optional member on an existing renderer-local union.

## Design

### 1. The recorded pair — `MessageAttachment` (`threadTimeline.ts`)

```ts
export interface MessageAttachment {
  attachmentId: string
  filename: string
}
```

Field names are `AttachmentSaveRequest`'s (`{ attachmentId, filename }`) so the eventual save leg hands the
record over with no remap — but this is a **declaration, not an import**: the timeline store imports
nothing today, and pulling `@shared/ipc/*` into it to save four words would put an IPC contract inside a
pure renderer reducer. The rename from `uploadId` happens here deliberately: `uploadId` names one transfer
attempt, and what the timeline records is a file the host has **stored**.

### 2. The two `userText` arms carry it (`threadTimeline.ts`)

`ThreadItem`'s `userText` member and `ThreadEvent`'s `userText` arm each gain
`attachments?: readonly MessageAttachment[]`, field-for-field, the way `createdAt` pairs across them.

- **Absent means none** (AC2). Tested `item.attachments === undefined`, never `'attachments' in item` —
  the reducer assigns the field unconditionally, and structured clone preserves an undefined property.
- The reducer's `userText` arm carries it **verbatim, unconditionally and BY REFERENCE** — `input`'s
  discipline, never `[...event.attachments]`, which on an absent list would silently mint `[]` and convert
  absence into emptiness.
- The store owns no opinion on an empty list. `[]` is representable and the sole producer never mints one
  (§3.3 normalises), so nothing downstream sees one; if a second producer ever does, the reducer carries
  it, and deciding what an empty list draws belongs to the row.

### 3. Where the two rules live

Nothing renders, so unit tests are the entire proof, and this repo's renderer specs are static server
renders with no DOM and no `renderHook`. A rule that runs only inside a React hook is reachable by no
tier. So both rules are pure functions and the hook is glue over them.

**3.1 What an arriving event does to the pending set — `reducePendingAttachments` (`ComposerAttach.tsx`)**

```ts
export function reducePendingAttachments(
  pending: readonly MessageAttachment[],
  event: AttachmentUploadEvent
): readonly MessageAttachment[]
```

- `completed` → a fresh array with the pair appended, so the set is in **completion order** (AC1).
- `refused`, `failed`, `progress` → the **same reference** (AC3): a refusal, a failure and an in-flight
  transfer each contribute nothing, and returning the same array says so structurally rather than by
  building an equal copy.
- Exhaustive `switch` on `event.type` with an explicit return type and **no `default`** — the neighbouring
  `attachmentUploadOutcomeCopy`'s documented idiom, so a member added to `AttachmentUploadEvent` upstream
  trips TS2366 here and must be classified as recording or not recording. No `Map` totality of the kind
  that module's `reason` read needs: the discriminator is minted by our own background process, never
  chosen by the daemon (§ Security review, category 1).

**3.2 The pending set itself — a ref in `useAttachmentUpload`**

`const pendingRef = useRef<readonly MessageAttachment[]>(NO_PENDING_ATTACHMENTS)`, beside the held
outcome. Ephemeral, screen-local, ADR 0006 state, and it resets on a conversation switch for free for the
reason that hook's docblock already gives — `PairedShellView` keys the chat pane on the conversation id.

**A ref rather than `useState`, because nothing renders it.** No view reads the pending set — the
consumers (#815, #868) read the timeline item, not this hook — so a state write would re-render the whole
composer on every arriving upload event for a value no markup consults, and its batching would open a real
window in which a completion that arrived after the last commit is dropped by the send that follows. The
ref is written synchronously in the listener and read synchronously in the click, so that window does not
exist. This is the one place where the ADR's "ephemeral, screen-local" applies to a value with no render
dependency at all.

The listener folds beside the existing assign:

```ts
window.pyry.onAttachmentUploadEvent((event) => {
  setOutcome(event)
  pendingRef.current = reducePendingAttachments(pendingRef.current, event)
})
```

**The pending set does not ride the gesture-clear.** `requestAttach`, `dropFile` and `pasteImage` keep
their `setOutcome(null)` and touch `pendingRef` not at all: that clear is about the *displayed* outcome,
and sharing it would erase the first file the moment the operator attached a second — which is exactly
AC1's "one or more".

The hook grows one member:

```ts
takePendingAttachments: () => readonly MessageAttachment[]
```

which reads `pendingRef.current`, resets it to the shared `NO_PENDING_ATTACHMENTS` constant, and returns
what it read. Take-and-clear in one act, so there is no window in which a caller has read the set but not
cleared it.

**3.3 When a send clears it — `submitMessage` (`composerSend.ts`)**

`ComposerSendDeps` gains `takeAttachments?: () => readonly MessageAttachment[]`, **optional**, on `now`'s
recorded trade rather than `dispatchFor`'s: thirteen call sites in `composerSend.test.ts` is above the
ten-call-site boundary this pipeline splits at, and requiring the field would cost thirteen mechanical
edits to buy a compile error. The cost is the same one `now` accepts — a forgotten wiring is silent rather
than a compile error — and it is paid the same way, with a spec that pins the wired behaviour.

It is read **once, past both `false` returns**, at the point `deps.now?.()` is read, and that placement is
the whole of AC4: a whitespace-only submit and a null-conversation submit never call it, so a submit that
sends nothing leaves the pending set intact for the next send. A send whose bridge call throws still takes
and still clears, because the echo still posts and the timeline still moved — the guarded-send contract
covers `sendCommand` alone.

The echo normalises empty to absent, which is the sole reason the store never sees `[]`:

```ts
const taken = deps.takeAttachments?.()
const echo: ThreadEvent = {
  type: 'userText',
  text: trimmed,
  createdAt: deps.now?.(),
  attachments: taken !== undefined && taken.length > 0 ? taken : undefined
}
```

One echo object, so the flat store and the keyed holder record the same array **by reference** — the
`createdAt` property restated for a list: the two stores cannot record different attachments for one
message. Sharing the reference is safe for the reason the echo itself is shared: `reduceTimeline` is pure
and `reducePendingAttachments` always builds a fresh array on change, so nothing mutates the one in flight.

### 4. The wiring (`ConversationScreen.tsx`)

`Composer.sendText`'s deps literal gains `takeAttachments: attach.takePendingAttachments`, beside
`now: Date.now`, inside the handler body — no new dereference in a render path.

`sendText` has two callers: the composer's own submit and `ComposerActionsMenu`'s `onCommand`. A picked
slash command therefore records and clears the pending set exactly as a typed message does, which is what
AC4 asks for: it is a send that actually happened.

### Not in this slice

`SendMessagePayload` is untouched, so the recorded attachment does not reach claude with the message (the
ticket's stated out-of-scope, and a wire change filed nowhere). `attachmentSave.ts` gains no renderer
consumer. `attachmentUploadCopy.ts` is untouched — its header already disclaims the layout and
non-emptiness obligations on behalf of "the first consumer", and both pass through to #815 / #868, which
are the tickets that render. The name is recorded **verbatim**: empty is representable and unreachable
(`basename` answers `''` only for a path the read guard already refuses), so no guard for it is added
where nothing draws it.

## State + concurrency model

- **Owner:** one `useRef` per mounted `Composer`, fed by the single upload subscription that hook already
  holds; the subscription's cleanup is still the bridge's own unsubscribe handle, so a remount nets one
  live listener. No store, no singleton, no new bridge member, no new channel.
- **Teardown:** a conversation switch or an unpair unmounts the composer and the ref goes with it. Nothing
  needs an explicit clear, and nothing outside the composer can hold a stale reference to the set.
- **Ordering:** completions are folded in arrival order by a listener that runs synchronously on the IPC
  event; the click reads the ref synchronously. Two concurrent uploads both land, in the order the host
  answered — which is the recorded order AC1 names.
- **Growth:** the set grows one small record per completed upload and is bounded only by the operator's
  own attaching. Deliberately uncapped — see § Security review, category 8.

## Error handling

No new I/O, no new boundary, no new failure mode. The three non-recording terminals are the error surface
and they already have one: `ComposerAttachOutcome` states the sentence, and the pending set simply does
not grow. A `failed` upload contributing nothing is the design, not a swallowed error.

## Testing strategy

Vitest only (node environment, no DOM). Nothing renders, so there is nothing for the Playwright tier to
observe and no e2e spec is added.

- **`ComposerAttach.test.tsx`** — `reducePendingAttachments`: a `completed` appends the daemon's
  `uploadId` as `attachmentId` with the name beside it; two completions record in completion order; each
  of `refused` (both members), `failed` and `progress` returns the **same reference**, asserted with
  `toBe`; the input array is never mutated; `NO_PENDING_ATTACHMENTS` is empty.
- **`composerSend.test.ts`** — `takeAttachments` is not called for whitespace-only input or a null
  conversation id (AC4's second half); it is called exactly once on a real send; what it returns reaches
  both write paths as the same reference; an empty take leaves `echo.attachments === undefined` (AC2); a
  deps literal with no `takeAttachments` at all produces today's echo, which is the shape the thirteen
  shipped call sites keep.
- **`threadTimeline.test.ts`** — a `userText` event carrying attachments produces an item holding the
  same array by reference; an event carrying none produces an item whose `attachments === undefined` and
  which still `toEqual`s today's literal; the tail-append, `phase` and `localSendPending` rules are
  unchanged. Fixture builder `userTextWith(...)` beside `userText` / `userTextAt`, following #1013's
  reason for separate builders rather than widened ones.

**What no tier proves:** the hook's own listener fold and the ref read at the click — there is no DOM, no
`renderHook` and nothing to click. Both rules it composes are unit-proven above, and the glue between them
is three lines carried by comments. Stated here so the gap is a decision rather than an omission.

## Open questions

1. Does a slash command picked from the Actions menu consume the pending attachments? — **Resolved in the
   design:** yes; it travels the same `sendText` path and AC4's rule is "a send that actually happened".
2. Should the pending set be `useState` or a ref? — **Resolved:** a ref, because nothing renders it and
   state batching opens a real drop window (§3.2).

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST FIX. The one boundary this slice touches is main → renderer on
  `ATTACHMENT_UPLOAD_EVENT_CHANNEL`, already shipped. What changes is retention: `filename` was consumed
  once for a sentence and is now **held in renderer memory** on a timeline item. It stays display text
  with no sink in this slice — nothing renders, nothing logs it, nothing builds a path from it. Its
  provenance is `basename(path)` of the operator's own file or `clipboardImageFilename`'s client-owned
  stem, trimmed once to `ATTACHMENT_FILENAME_MAX_BYTES` by `driveUpload`; the daemon does not choose it.
  No re-sanitising here, deliberately: the save leg re-runs `sanitizeAttachmentFilename` on the value it
  actually builds a path from, and a second, divergent sanitiser on this side is the shape
  `attachmentBytes.ts` already argues against. The `type` discriminant `reducePendingAttachments` switches
  on is minted by our own background process and cannot be daemon-chosen — that is what makes TS2366
  sufficient exhaustiveness here where `attachmentUploadCopy`'s daemon-chosen `reason` needed a `Map`.
- **[Tokens, secrets, credentials]** Not applicable, and worth stating precisely rather than skipping:
  `attachmentId` is a `randomUUID` minted per intent in the background process. It is an identifier, not a
  capability — the daemon authorises retrieval by the Noise session, not by knowledge of the id — so
  holding it in renderer memory grants the window nothing it does not already have. No token, key or
  credential is read, written or logged on this path.
- **[File / storage operations]** No findings — this slice performs no filesystem operation. The pair is
  in-memory renderer state on a timeline that is never persisted and is cleared on exit and on pairing end
  (#757). No path is constructed, joined, resolved or opened anywhere in the diff.
- **[Inter-process / Electron attack surface]** No findings — **no new channel, no new `contextBridge`
  member, no new `ipcMain` handler, no `webPreferences` change**. The hook consumes the shipped
  `onAttachmentUploadEvent` only, and `window.pyry` is still dereferenced only inside the effect and the
  three gesture closures, never during render. Nothing moves toward the renderer: no key, no socket, no
  byte, no host path.
- **[Cryptographic primitives]** Not applicable — no primitive, no RNG and no comparison of a secret is
  touched. `crypto.randomUUID()` at the existing `newMessageId` site is unchanged and non-security.
- **[Network & I/O]** No findings, and one residual named honestly: `SendMessagePayload` gains no
  `attachment_ids`, so the association is local to this client's timeline and the daemon is told nothing
  new. No frame, no size bound and no timeout is affected.
- **[Error messages, logs, telemetry]** No findings, as a rule the implementation must hold: this slice
  adds **no log call at all**, so neither the filename nor the identifier reaches a log line, a diagnostic
  record or the renderer console (ADR 0007, content-free diagnostics by construction). The name must never
  become a log field on a later leg either — it is the first operator-supplied string this feature retains.
- **[Concurrency]** No MUST FIX, and one design decision made *because* of this category: holding the
  pending set in `useState` would let a completion that arrives between the last commit and the click be
  read stale and then wiped by the take — a silently dropped attachment. The ref (§3.2) closes that window
  by being written and read synchronously. The subscription's lifecycle is unchanged (one listener per
  mount, the bridge's own unsubscribe as cleanup). No timer, no `AbortController`, no long-lived task is
  added.
  Growth is uncapped and that is deliberate: entries are added only by the operator's own completed
  attaches, each is a UUID plus a ≤255-byte name, and the set is cleared by the next send and by every
  conversation switch. A cap would have to drop an operator's file silently, which is the worse failure,
  and no unbounded-growth failure has been observed on this path.
- **[Threat model alignment]** A hostile daemon can decide *whether* an upload completes, so it can cause a
  `completed` for a file it did not store, and the timeline then records an attachment the host does not
  have. Blast radius in this slice is one wrong record with nothing drawing it; the retrieval that would
  surface the lie is #868's, and it fails visibly there. Out of scope and named: the daemon cannot choose
  either half of the recorded pair. Renderer compromise is unchanged — a compromised window could already
  write anything it liked into its own timeline store, and gains no new reach here.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-04

## Revisions

### 2026-09-04 — the take is a pure function, not three lines inside the hook

§3.2 planned `takePendingAttachments` as a closure reading and resetting the ref in place, and § Testing
strategy listed "the ref read at the click" among the things no tier proves. Implementing it made the
cost of that concession clearer than the plan had: AC4's clearing half — "a second message sent with no
further uploads records none" — would then have lived *only* inside the hook, which is precisely the
no-tier-can-reach-it shape the ticket's Technical Notes rule out.

So the act is now the exported pure `drainPendingAttachments(holder)`, generic over a `{ current }`
holder (a `MutableRefObject` satisfies it structurally, `fileToAttach`'s generic-over-the-element idiom),
and the hook member is one line binding it to this mount's ref. `ComposerAttach.test.tsx` walks it with a
plain object: the take empties the holder, a second take answers the shared empty constant, and the array
handed back is not mutated. Everything else in §3.2 stands — same ref, same reason for the ref, same
listener fold, same untouched gesture-clear.

What no tier proves shrinks accordingly, to the listener's own assignment line and the hook's binding.

No effect on § Security review: the value's placement, lifetime and trust posture are unchanged, and no
capability, channel or bridge member moved.
