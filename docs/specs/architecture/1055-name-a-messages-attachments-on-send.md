# #1055 — name a message's attachments on the outbound `send_message`

## Files read

- `src/renderer/src/screens/conversation/composerSend.ts` → `ComposerSendDeps`, `submitMessage` — the
  payload literal that has no attachment field, and the `takeAttachments` docblock this ticket un-says.
- `src/renderer/src/screens/conversation/ComposerAttach.tsx` → `drainPendingAttachments`,
  `useAttachmentUpload`, `NO_PENDING_ATTACHMENTS`, `reducePendingAttachments` — the pending set's owner,
  and the second docblock that states the old ordering.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → the composer's `submitMessage` deps
  literal (`takeAttachments: attach.takePendingAttachments`) — the sole production wiring site.
- `src/shared/wire/types.ts` → `SendMessagePayload` (the three-field frame this widens),
  `RequestAttachmentPayload` (**the load-bearing precedent**: a renderer-supplied id that becomes a
  directory component on the host, deliberately *documented, not validated* on this side).
- `src/shared/ipc/commands.ts` → `isSendMessagePayload` (the structural-minimum guard),
  `isAnswerQuestionsPayload` (**the only recursing guard in the file**, and the `for…of`-not-`every`
  sparse-array lesson this ticket inherits), `sendMessageCommand`, `RendererCommand`.
- `src/main/transport/sendMessageEnvelope.ts` → `buildSendMessage` — serializes the payload verbatim, so
  the absent-key form is `JSON.stringify`'s and nothing else's.
- `src/main/daemonConnection.ts` → `send` — hands the payload straight to the builder; `requestSessionSettings`
  is the neighbour that went the other way (#945).
- `src/main/index.ts` → the `onCommand` switch's `sendMessage` arm and the `requestSessionSettings` arm
  carrying #945's "fresh literal, so no renderer-supplied key reaches the wire" comment.
- `e2e/real-claude.spec.ts` → `nonEmptyAssistantCount`, `ASSISTANT_ROW`, `META_SELECTOR` — the strip
  discipline every real-claude text read owes, and the pair → UI-create → send drive.
- `e2e/composer-attach.spec.ts` → the `dialog.showOpenDialog` `defineProperty` stub — the only way to
  drive the picker, since the native dialog is invisible to every Playwright locator.
- `e2e/fixtures/realDaemon.ts` → `RealDaemonOptions` (`skipPermissions` defaults `true`, `interactiveRunner`).
- `docs/knowledge/features/composer-send.md` § the #1039 block — **states "the echo and its attachments
  show regardless of the wire outcome", which AC3 falsifies**; flagged for the documentation phase below.
- `docs/knowledge/features/live-e2e-runbook.md` § *Current real-claude gate state* — the tier is 11 specs
  and the untracked `PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` floor needs bumping; this PR adds the 12th.
- Upstream SSOT `pyrycode` `docs/protocol-mobile.md` § *Naming a message's attachments* / § *The
  `attachment_id` shape* — `attachment_ids` is an optional array of lowercase-UUIDv4 strings, at most 32
  elements, absent/`null`/`[]` indistinguishable to a receiver, consumed since pyrycode#2038.
- `mcp__codegraph__*` is not initialized in this repo (every call errors), so the reading list above came
  from Grep + Read rather than `codegraph_context`.

## Design source

**Figma:** N/A — no UI surface changes. The composer, the footer, the outcome line and the timeline item
all render exactly what they render today; this slice moves an existing value onto the wire.

## Context

An attached file reaches the daemon host at *attach* time and is stored there under the id the client
minted, but nothing on the wire says which message it belongs to, so claude never sees it. `#866` shipped
the upload, `#1039` shipped the client-side display, and the daemon's half is merged and waiting
(pyrycode#2036 declared `attachment_ids`, pyrycode#2038 consumes it). This is the leg between them: the
composer already holds the id, and the payload literal simply has nowhere to put it.

No ADR is warranted. The wire field is upstream's decision, already recorded in `protocol-mobile.md`; the
client-side changes are local to the composer's submit path.

## Design

### The wire field

`SendMessagePayload` gains `attachment_ids?: string[]`, mirroring the daemon's
`AttachmentIDs []string \`json:"attachment_ids,omitempty"\`` field-for-field. The type carries the
canonical shape in its docblock and validates nothing — `RequestAttachmentPayload`'s posture verbatim,
for the identical hazard (an element becomes a directory component on the host) and the identical reason:
enforcement is the daemon's, which owns the reject path.

The **absent-key form (AC1) falls out of `JSON.stringify`**, which drops a key whose value is `undefined`.
`buildSendMessage` serializes the payload as-is, so assigning `attachment_ids` unconditionally — the
`createdAt` idiom this module already runs — produces the no-key wire form with no conditional key and no
`null`. Nothing else in the chain re-serializes.

### The transactional take

`drainPendingAttachments` changes its return from the bare set to a `PendingAttachmentTake`:

```ts
export interface PendingAttachmentTake {
  attachments: readonly MessageAttachment[]
  rollback: () => void
}
```

`ComposerSendDeps.takeAttachments` becomes `?: () => PendingAttachmentTake` — still optional, still with
no fallback (an unwired take means no attachments), for the reasons its current docblock gives.

**Why the take grows an undo rather than splitting into peek + consume.** The ids must be known before the
payload literal is built, so the take can no longer sit below the guarded send — and AC3 then needs a way
to *not* have consumed them when the send throws. A peek/consume pair would re-open exactly the window
`drainPendingAttachments`'s "TAKE AND CLEAR CANNOT BE SPLIT" paragraph closes, and a second optional
`restoreAttachments` dep would be a wiring that can silently go missing (the `now` lesson). Handing the
undo back *with* the take makes it impossible to hold one without the other, and the `rollback` closure
captures the holder, so it cannot restore into the wrong one.

Rolling back is sound because `submitMessage` is synchronous end to end: the upload listener that adds to
the set runs as a separate task, so nothing can be appended between the take and the rollback, and the
restore cannot clobber a newer arrival.

### `submitMessage`'s new shape

Order, with both `false` returns unchanged above it:

1. Mint `message_id`.
2. Read `takeAttachments` — **once**, still below both `false` returns, so a blank Enter and a submit with
   no active conversation still take nothing (the surviving half of the retired reasoning).
3. Build the payload with `attachment_ids` derived from the take: the ids when the set is non-empty,
   `undefined` when it is empty or the take is unwired. **Empty normalises to absent** on this path for
   the same reason it already does on the echo's.
4. The guarded send. On a throw: log as today, `rollback()`, and record that the frame did not go.
5. Build the echo from the *same* take, gated on the send having gone.

**AC2 is structural, not conventional.** One `taken` value feeds both the frame and the echo, normalised
by one rule and gated by one boolean, so the two cannot disagree on any path — the `now`/`createdAt`
discipline that already makes the two timeline writes share one object, extended one layer out to the
wire.

**AC2 and AC3 meet on the throw path**: the frame did not go, so it named nothing, so the echo records
nothing and the files stay attached for the retry. The alternative (echo shows them *and* they stay
pending) duplicates them on the next send. The echo itself is still dispatched — "optimistic" still means
show-immediately, and `submitMessage` still returns `true` — only its `attachments` field is empty.

### The IPC boundary

`isSendMessagePayload` gains an `attachment_ids` arm: absent → accept; present → must be an array whose
every element is a **non-empty string**. Iterated with `for…of`, never `Array.prototype.every`, for
`isAnswerQuestionsPayload`'s recorded reason — `every` skips holes, sparse arrays survive structured
clone, and `JSON.stringify` emits `null` for a hole, i.e. a `null` inside a declared `string[]`.

Non-empty rather than merely `string`, because `isAttachmentRetrievalRequest` — the boundary guard for the
*identical* value class one channel over, and the layer-matched precedent — already refuses the empty
string there, and `RequestAttachmentPayload`'s docblock says why: joining `''` onto a directory yields
that directory, so the zero value fails silently rather than loudly on the far side. This side declines to
originate it.

A **present key holding `undefined`** must be accepted: structured clone preserves an own property whose
value is `undefined`, so the unconditional assignment in step 3 above arrives main-side as a present key,
and a bare `'attachment_ids' in value` rejection would refuse every ordinary send.

### Two things deliberately NOT done

- **No canonical lowercase-UUIDv4 check client-side.** Upstream places that check on the *receiver* and
  mandates it there — § *Naming a message's attachments* says one canonical-shape check answers both
  hazards (path component, prompt content) and that it is "not optional even for a consumer that never
  touches the filesystem" — and #2038 enforces it, with resolution confined to the message's own
  conversation. On this side, `RequestAttachmentPayload`'s docblock already ruled on the same value class:
  *"DOCUMENTED, NOT VALIDATED… enforcement is the daemon's"*. A shape check here would refuse nothing a
  conforming client can produce (see the provenance argument in the security review below), would not
  change the operator's outcome (a bad id loses the message either way — refused here, or
  `protocol.malformed` there), and would put a second, divergent posture on one feature's ids. What the
  guard *does* buy is the type-lie `isAnswerQuestionsPayload` names: a non-string element would otherwise
  reach `JSON.stringify` and take the whole message down with `protocol.malformed`.
- **No fresh-literal rebuild in `buildSendMessage`.** #945's line is about *smuggled* keys, and
  `send_message` has ridden verbatim since #11 for all three of its renderer-supplied fields. This field
  adds no smuggling capability that the frame did not already have, so closing that hole is a separate,
  frame-wide concern, not this slice's. Named here rather than left unsaid, because the ticket asks for
  the decision to be deliberate.

### The 32-id bound

Out of scope, per the ticket: reaching it needs 33 attach gestures on one message, the pending set has no
bound today either, and what to do with the 33rd file is a UX decision with no design behind it.

## State + concurrency model

No new store, no new subscription, no new async work. The pending set stays in `useAttachmentUpload`'s
ref, written by the one upload-event listener and read by the send synchronously; the take and its
possible rollback both happen inside one synchronous `submitMessage` call, so there is no interleaving to
guard and nothing to cancel. Teardown is unchanged — the ref dies with the mount, which is still the whole
of the conversation-switch reset.

## Error handling

The only failure mode this slice adds a path for is the one AC3 names: `deps.sendCommand` throwing. It
stays swallowed (never propagated — the guarded-send contract), and now also rolls the take back. Both
store writes stay outside the `try`, as today; the guarded-send contract still covers `sendCommand` alone.

Main-side, a malformed `attachment_ids` is refused by `isRendererCommand` at the boundary and the whole
command is dropped — the file's standing posture, and the only sound answer when there is no reply
channel. Nothing is logged: the ids are unvalidated on this side, and `RequestAttachmentPayload`'s rule is
that an unvalidated id may not be logged (log-injection shape).

## Testing strategy

**vitest (node, static renders — nothing here can click):**

- `composerSend.test.ts` — the frame names the taken ids in the pending set's order; a send with nothing
  pending carries **no `attachment_ids` key** (asserted through `JSON.stringify` on the built command, so
  the absent-key form itself is what is pinned, not merely an `undefined` value); frame and echo agree; a
  throwing `sendCommand` leaves the echo without attachments, calls `rollback` and still returns `true`;
  both `false` returns still take nothing; the take is still read exactly once.
- `ComposerAttach.test.tsx` — `drainPendingAttachments` returns the set and empties the holder (existing
  assertions, ported to the new return shape); `rollback` restores exactly the taken set; a take after a
  rollback yields the same set again.
- `commands.test.ts` — the guard accepts an absent key, a present-but-`undefined` key, an empty array and
  an array of strings; refuses a non-array, a non-string element, and a **sparse** array (the `for…of`
  proof — this is the assertion that reddens if the iteration ever becomes `every`).
- `sendMessageEnvelope.test.ts` — a payload carrying ids serializes them; a payload without the key
  serializes to the exact three-key JSON (the wire-level absent-key regression case).

**Playwright, real tier — `e2e/real-claude-attachment.spec.ts` (AC4):** pair against a real spawned `pyry`
daemon, create the conversation through the UI, stub `dialog.showOpenDialog` in the main process to answer
with a real PNG this spec wrote to a temp dir, click Attach, wait for the completed outcome (the imported
production constant, never a typed-out sentence), send a message asking claude to name the image's
dominant colour, and poll the assistant rows' stripped text for that colour. The assertion is on the
**reply's text**, never on client state — a client that recorded the attachment perfectly and sent no ids
fails it. The image is a solid-colour PNG so the expected word is unambiguous; `skipPermissions` stays at
its `true` default so claude's read does not block on a permission modal.

The spec is `real-*`-named, so it is `testIgnore`d out of the default tier and runs only under
`npm run e2e:real-claude` / `npm run e2e:real:gate`.

## Open questions

- **Does the model reliably name the colour?** Resolved by construction rather than by hope: the prompt
  asks for the dominant colour in one word and the fixture is a pure `#FF0000` field, so the assertion is
  a case-insensitive `red` against the whole assistant text. If a live run shows the model answering with
  a synonym, the fix is the prompt, not the assertion.
- **Does the tier's floor need a bump?** Yes — `PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` is untracked and
  operator-owned; the tier goes 11 → 12. Called out in the PR body, which is the runbook's own stated
  mechanism ("a PR that adds a `real-*` spec must say so").

## For the documentation phase (not written here)

- `docs/knowledge/features/composer-send.md` currently states that *"the echo and its attachments show
  regardless of the wire outcome"*. AC3 falsifies the attachments half: a failed send now records none.
  The surviving half — the echo itself still shows, and the take still sits below both `false` returns —
  should stay.
- `docs/knowledge/features/composer-attach.md` § pending attachments describes `drainPendingAttachments`'s
  old return shape.
- `docs/knowledge/features/live-e2e-runbook.md` § *Current real-claude gate state* — the tier is 12.

## Size

`size:s` **with a stated line overage**, restating the refiner's estimate after writing the plan. Four
production files (`types.ts`, `commands.ts`, `composerSend.ts`, `ComposerAttach.tsx`) against a ceiling of
5; one new exported type (`PendingAttachmentTake`) against 5; two production consumer sites for the
changed return shape (`useAttachmentUpload`'s `takePendingAttachments`, `submitMessage`) plus eight test
sites, against 10; four acceptance criteria against 5; no new reject branches. Only *total written work*
exceeds 800, and it does so because the live proof this ticket exists for is a new e2e spec — the one cut
the shared-test-infrastructure boundary forbids, since a fix and its liveness test stay coupled in one
ticket.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings — the design has exactly one new boundary crossing, and it is
  explicit: `isSendMessagePayload` in `src/shared/ipc/commands.ts`, the single function `isRendererCommand`
  routes every `sendMessage` through. The **provenance argument is the load-bearing one and was verified
  rather than assumed**: the values that reach `attachment_ids` are minted by `randomUUID()` inside
  `driveUpload` in `src/main/attachmentUpload.ts` and closed over that call, so the `completed` event's
  `uploadId` is *this process's own* id — it is **never read off the daemon's `attachment_stored` frame**.
  A hostile daemon therefore has no path into this array at all; the only actor who can put a
  non-conforming element in it is a compromised renderer, which is the boundary's declared adversary.
  Downstream, nothing on this side treats the array as trusted: it is serialized and sent, never joined
  onto a path, never resolved, never logged.
- **[Trust boundaries / the canonical-shape question]** Decided, not skipped. Upstream mandates the
  lowercase-UUIDv4 check on the receiver and enforces it (pyrycode#2038), naming both hazards it answers —
  an element becoming a directory component, and an element becoming prompt content (§ Security model
  threat 1, prompt injection). This client neither joins nor prompts with the value, and the desktop
  repo's shipped posture for the identical value class is `RequestAttachmentPayload`'s *documented, not
  validated*. The guard therefore checks structure only — array, every element a non-empty string,
  iterated with `for…of` — mirroring `isAttachmentRetrievalRequest`, the layer-matched precedent, which
  refuses the empty string for the reason `RequestAttachmentPayload` records (joining `''` onto a directory
  yields that directory). Re-open this only if upstream's receiver-side check is ever weakened.
- **[Tokens, secrets, credentials]** No findings — no token, key or credential is created, read, stored or
  moved. An `attachment_id` is explicitly **not a capability** on this wire (`RequestAttachmentPayload`:
  "not secret, not unguessable"), so nothing here needs `safeStorage`, rotation or revocation.
- **[File / storage operations]** No findings in production code — this slice performs no filesystem
  operation on either side and adds no path join. The daemon-side path join is confined to the message's
  own conversation directory by the authenticated session, never by a client-asserted id. The e2e spec
  writes one fixture PNG under `mkdtemp` in the OS temp dir and reaps it in the fixture's `finally`; it is
  test-only, contains no secret, and is not read by production code.
- **[Inter-process / Electron attack surface]** No findings — no new IPC channel, no new `contextBridge`
  member, no new `ipcMain` listener, no window options touched. The change widens one field on an existing
  validated command. The e2e spec's `dialog.showOpenDialog` override runs through `app.evaluate` against
  the test-launched app only, exactly as `composer-attach.spec.ts` already does; production code is not
  patched and no dev affordance is added.
- **[Cryptographic primitives]** No findings — no primitive is chosen, called or re-implemented. The ids
  the array carries originate from `node:crypto`'s `randomUUID` (a CSPRNG), though nothing here relies on
  their unpredictability, and must not be read as doing so.
- **[Network & I/O]** No findings, one bound worth naming. A compromised renderer could send a very long
  array; the frame is already bounded by `MAX_PLAINTEXT_BYTES` in `buildSendMessage`, which throws
  `WireEncodeError` on an over-cap envelope and whose sole caller (`daemonConnection.send`) catches it and
  drops the send — no new unbounded allocation, no new socket, no new timeout to set. Upstream's 32-id
  bound is a contract-clarity number rather than a DoS mitigation (it says so) and is out of scope by the
  ticket's own ruling.
- **[Error messages, logs, telemetry]** No findings — nothing new is logged on either side. The ids are
  unvalidated on this side, and upstream's rule is that an element is loggable only *after* its shape is
  validated (raw, it is the log-injection shape); the guard's refusal path is therefore deliberately
  silent, matching every sibling guard in `commands.ts`, and the rollback path adds no line. The existing
  `console.error('composer send failed', error)` is unchanged and carries no attachment value.
- **[Concurrency]** No findings — the take, the send and the possible rollback all execute inside one
  synchronous `submitMessage` call with no `await` between them, so the upload listener that appends to
  the pending set (a separate task) cannot interleave, and the rollback cannot clobber a newer arrival.
  No timer, no listener, no long-lived task is added, so there is nothing to cancel on teardown.
  **One honest non-guarantee, pre-existing and unchanged:** "the send did not throw" means the bridge
  accepted the command, not that the frame reached the daemon — `daemonConnection.send` is an inert no-op
  with no driver. That state is unreachable from the composer, whose send is gated by
  `composerAvailability` on a `connected` status; AC3 is about a throwing bridge, which is what
  `submitMessage` can actually observe.
- **[Threat model alignment]** Malicious relay: unchanged — the array rides inside the Noise session, so a
  content-blind relay learns only that a frame grew by a bounded number of bytes. Hostile daemon: no path
  into this field, per the provenance finding above. Token theft from disk: not touched. Renderer
  compromise reaching the transport: unchanged — no key, socket or raw byte becomes reachable from the
  window, and the widened field is refused at the boundary unless structurally well-formed, then refused
  again upstream unless canonically shaped.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-04

## Revisions

*(none yet — appended if implementation departs from the design above)*
