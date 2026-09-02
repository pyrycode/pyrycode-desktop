# #937 — carry the slash-command list across IPC as a typed `DaemonEvent` arm

The IPC half of the slash-command family: #936's fail-closed decode stops in the background process,
and this slice carries its result to the window as one new sealed-union arm plus the emit that
produces it, with a no-op case in each exhaustive bridge so the `assertNever` guards still compile.
Ships dormant — nothing renders the list when this lands.

## Files read

- `src/shared/wire/types.ts` → `WireSlashCommand`, `SlashCommandListPayload` — the wire shape this arm
  carries. Its docblocks are the SSOT for every content rule repeated below: the four strings are
  workspace-authored, `aliases` is a plain array whose `[]` is a collapse, `truncated_fields: null` is a
  value distinct from `[]`, `dropped_commands: 0` is a value, and `commands.length + dropped_commands`
  is the menu's true size.
- `src/main/transport/inboundMessage.ts` → the `slash_command_list` case of `decodeInbound`'s envelope
  switch and `parseSlashCommandListPayload` — where the decode ends today (`{ kind:
  'slash-command-list', slashCommandList }`), and the content-free log this slice must not duplicate.
- `src/main/daemonConnection.ts` → the inbound-`kind` switch, specifically its `question-shown`,
  `question-dismissed` and `background-task-roster` cases — the fresh-named-field-literal emit
  discipline and the bare-read rule this arm copies. The switch has no catch-all, which is why the
  decoded value is dropped today.
- `src/shared/ipc/events.ts` → `DaemonEvent`, and its `backgroundTaskRoster` and `questionShown` arms —
  the structural analogue (id + rows + drop count) and the verbatim-nested-row house rule.
- `src/renderer/src/store/daemonEventBridge.ts` → `translateDaemonEvent`; `timelineBridge.ts` →
  `translateTimelineEvent`; `modalBridge.ts` → `translateModalEvent`; `questionBridge.ts` →
  `translateQuestionEvent` — the four `DaemonEvent` switches ending in `assertNever`, each of which is
  a compile error until it gains a case.
- `src/main/daemonConnection.test.ts` → the `question_shown` and `question_dismissed` describe blocks
  plus the `questionShownPlaintext` helper — the emit-test shape (exact `toEqual`, planted-extra-key
  no-spread check, malformed-drop check) this slice mirrors.
- `docs/knowledge/features/slash-command-list-wire-types.md` § Edge cases — the note that no committed
  upstream fixture carries `truncated_fields: ['aliases']`; that case is hand-authored, and this slice's
  AC3 wants it, so do not go hunting for a fixture.
- `docs/knowledge/features/daemon-event-channel-sealed-union.md` — the per-arm history of this union.
  **Its prose says "all three exhaustive bridges" throughout and is stale**; `questionBridge` (#900)
  is the fourth. Derived by grep rather than from the prose, per § The bridge set below.

## Design source

**Figma:** N/A — transport and IPC only. Nothing in this slice renders, and no component, token or
layout is touched. The visual-fidelity check is intentionally skipped.

## Context

The decoded slash-command menu currently dies twice in the background process: `daemonConnection`'s
inbound-`kind` switch has no `slash-command-list` case and no catch-all, so the decoded value falls out
of the switch, and `DaemonEvent` has no arm for it, so nothing could cross the bridge even if it did.
This slice closes both, in the shape #885 (`question_shown`) and #559 (`modelAnnounced`) already used.

The consumers are the two slices after this one: #938 holds the list per conversation, and #681 matches
an Actions-menu entry against a command name or alias. Neither exists yet, so the arm ships **dormant**
and every bridge no-ops it.

No ADR is warranted — this is the established atomic-arm pattern, not a new decision. The one thing the
documentation phase should record is that the "three exhaustive bridges" phrasing across
`daemon-event-channel-sealed-union.md`, `modalBridge.ts`'s and `timelineBridge.ts`'s docblocks is now
wrong in four places; this slice corrects the two code docblocks it must touch anyway and leaves the
overview to that phase.

**File-count overage, declared.** Six production files against the size table's five. The four bridge
no-ops are compile-forced by the union arm and cannot land in a separate ticket without a red build in
between; the arm alone is a type whose only consumer is this ticket's own emit, which the sizing floor
forbids as a ticket. The floor wins over the ceiling, so the overage stands rather than being cut.

## The bridge set — derived, not quoted

Four files switch on `DaemonEvent` and end in `default: return assertNever(event)`:
`daemonEventBridge`, `timelineBridge`, `modalBridge`, `questionBridge`. Each is a compile error until it
gains a case. The set was derived by grepping `assertNever(event)` across `src/` and checking each hit's
switch subject — eleven files match the call, and seven of them switch on a *different* union
(`ThreadEvent` in `threadTimeline`, `ModalEvent` in `modalPrompts`, `QuestionBatchEvent` in
`questionBatches`, plus `questionPicksStore`, `runSettingsWriteStore`, `newFolderStore`, `pairingState`),
so they are unaffected. The ~20 sibling bridges ending in `default: return null` are likewise
unaffected; `pushNotifyBridge.ts` carries a comment explaining that it is deliberately in that group.

## Design

### The union arm — `src/shared/ipc/events.ts`

One new arm, placed after `backgroundTaskRoster` is *not* the choice: it goes at the end of the union,
beside `relayLinkChanged`, because it opens no family and its nearest structural relative
(`backgroundTaskRoster`) is mid-file inside the background-task family block. Contract:

```ts
| {
    type: 'slashCommandList'
    conversationId: string
    commands: readonly WireSlashCommand[]
    droppedCommands: number
  }
```

- `WireSlashCommand` is added to the existing `import type { … } from '../wire/types'` block.
- Named `slashCommandList` after `backgroundTaskRoster`'s precedent: a noun naming the snapshot, not a
  past-participle naming an occurrence. The frame REPLACES a reader's view of the menu; it is not a
  delta and not a turn-stream item.
- Top level is snake→camel (`conversation_id`→`conversationId`,
  `dropped_commands`→`droppedCommands`). **The row type is reused VERBATIM**, so `argument_hint` and
  `truncated_fields` stay snake_case — the settled house rule for nested arrays, with four precedents
  (`queueState`, `conversationsReceived`, `backgroundTaskRoster`, `questionShown`). `parseSlashCommand`
  already stripped each row to its five known fields, so there is nothing to drop and no mapping to
  write. This family nests ONE level, unlike `questionShown`'s two.
- `readonly` on the outer array mirrors `queueState` and `backgroundTaskRoster`; `WireSlashCommand`
  itself stays a mutable interface, exactly as `QueuedItem` and `BackgroundTask` do.
- All three fields are REQUIRED, never optional. The wire has them always-present, the decode requires
  all three, and an assigned `undefined` survives the structured clone across this channel — so an
  optional field would invent an absence case the daemon never produces.
- `droppedCommands` is this frame's ONLY frame-level truncation report and rides beside the rows rather
  than being recomputed from them; `truncated_fields` stays per row and is never hoisted or flattened.

The arm's docblock carries, in the file's established voice: the workspace-authored trust tier (a tier
BELOW the claude-authored strings `modelAnnounced` and `questionShown` carry, not a restatement of it);
the plain-text-never-HTML / never-an-attribute / never-a-URL / never-a-filename / never-a-cache-key /
never-a-log obligations the render slice owes; the `[]`-is-a-collapse rule for `aliases` and why a
`truncated_fields` naming `aliases` must be read as UNKNOWN rather than "none"; that
`commands.length + droppedCommands` is the true size; and that the no-op in all FOUR exhaustive bridges
is DORMANT (it flips when #938 lands its own subscriber), not permanent like the question arms'.

### The emit — `src/main/daemonConnection.ts`

A new `case 'slash-command-list':` in the inbound-`kind` switch, beside `question-dismissed`:

```ts
emitDaemonEvent(sink, {
  type: 'slashCommandList',
  conversationId: inbound.slashCommandList.conversation_id,
  commands: inbound.slashCommandList.commands,
  droppedCommands: inbound.slashCommandList.dropped_commands
})
```

- An UNSOLICITED daemon report (it rides a `control_response` but is not correlated by this client's
  outstanding-request memory), so it emits unconditionally on decode.
- A **fresh literal naming three fields**, never a spread of `inbound.slashCommandList`, so a decoder
  that later grows a field cannot smuggle it across IPC.
- Every field read **BARE** — no `??`, no optional handling, no `|| 0` on the count. The decode requires
  all three; a `?? ''` here would turn a fail-closed drop into a silent misattribution, filing a menu
  against the wrong conversation, and a `|| 0` would turn a real defect into a plausible zero.
- `commands` passes **by reference**, verbatim. Do not "fix" that into a `.map`: the fresh-literal rule
  governs the EVENT OBJECT, and deep-remapping the rows would break the verbatim-row rule instead.
- **NO log call.** #936's decode already emitted the content-free record, and this leg is where a
  workspace-authored `description` could reach a sink. Nothing here counts the commands either — how
  many verbs a workspace offers is a fact about the repository the user has open.
- Nothing recomputes or cross-checks `droppedCommands` against `commands.length`.
- The inner switch has no `assertNever`, so this emit is not compile-forced; the round-trip tests guard
  it.

### The four bridge no-ops

Each gains `case 'slashCommandList':` in its existing null group, with one sentence naming the #938
consumer and the reason the arm is not that bridge's business. No behaviour changes in any of them, and
none of them reads a field off the event.

**These four cases are a security control, not bookkeeping** (§ Security review, finding 7b). Every one
of the four guards is `throw new Error(\`Unhandled daemon event: ${JSON.stringify(event)}\`)`, so a
missing case serialises the WHOLE event — every workspace-authored `name`, `argument_hint`,
`description` and alias, embedded newlines included — into an Error message. The `daemonEventBridge`
comment already says this of the question arms; each new case's comment says it of this one. The two docblocks that miscount the bridges
(`modalBridge`'s "this bridge, `daemonEventBridge`, and `timelineBridge`" and `timelineBridge`'s "both
this bridge and `daemonEventBridge`") are corrected to name all four while I am in the file.

Per-bridge reasoning, one line each:

- `daemonEventBridge` — no session-store action; the session store holds no slash-command state.
- `timelineBridge` — no `turn_id`, opens and closes no turn ⇒ daemon STATE by the `queueState` rule
  (#720), not a turn-stream item. A menu of verbs is not something that happened during a turn.
- `modalBridge` — nothing is waiting on an answer; a published vocabulary is not a permission prompt.
- `questionBridge` — no question state; the frame is not an ask.

## State + concurrency model

None added. This slice is a pure translation inside an already-running synchronous handler: the relay
driver's `message` event → `decodeInbound` → the inbound-`kind` switch → `emitDaemonEvent` →
`webContents.send`. No store, no timer, no subscription, no async task, no `AbortSignal` — so there is
nothing new to tear down on window close, and no ownership question to answer. The four bridges gain
`return null` cases and hold nothing.

## Error handling

The decode is the only failure boundary and it belongs to #936: `parseSlashCommandListPayload` throws
`WireDecodeError` on any malformed frame, the existing per-message try/catch upstream of this switch
swallows it, and no event is emitted — the whole line is dropped fail-closed. This slice adds **no new
failure mode and no new catch**: it runs only on an already-validated payload, reads three fields that
the decode guarantees, and can throw nothing of its own. A reject therefore surfaces as *no arm*, which
is exactly AC2's second half. Nothing surfaces to the UI, because nothing consumes the arm yet.

## Testing strategy

Vitest only, `environment: 'node'`. No Playwright spec: nothing renders and nothing is clickable.

**`src/main/daemonConnection.test.ts`** — a new `createDaemonConnection — slash_command_list stream
(#937)` describe block after the `question_dismissed` one, with a `slashCommandListPlaintext(payload:
unknown)` helper mirroring `questionShownPlaintext`. A shared `MENU` fixture with values lifted from the
upstream capture shape: one row with a populated `argument_hint` and a `truncated_fields: null`, one row
whose `description` carries an embedded `\n` and a non-ASCII rune, one row with a non-empty `aliases`
and `truncated_fields: ['aliases']`, and one all-zero row (empty `argument_hint`, empty `aliases`).
Scenarios:

- emits three camelCase top-level fields with the rows verbatim, in wire order — one exact `toEqual`
  covering AC1, AC3 and AC4 at once, so `argument_hint` staying snake_case and `truncated_fields: null`
  staying `null` are both pinned by value (AC3);
- an explicit `=== null` on the first row's `truncated_fields`, and `expect(row).not.toHaveProperty` is
  NOT used — the memory's rule inverted: structured clone preserves an assigned `undefined`, so
  presence checks lie and only a value check is sound;
- `truncated_fields: ['aliases']` arrives intact and `aliases` is non-empty beside it (AC3) — the
  reading-rule case that separates "cut to nothing" from "none";
- emits exactly four modeled properties, never a spread — an extra key planted at BOTH levels (payload
  and row), asserted with a sorted `Object.keys` on the event plus a `JSON.stringify(...).not
  .toContain('must-not-cross')` sweep (AC1);
- `dropped_commands: 0` crosses as `0`, and a frame carrying `dropped_commands: 3` with a single command
  crosses as `3` against one entry — nothing recomputes or reconciles the two (AC4);
- an empty `commands: []` with `dropped_commands: 0` emits an arm carrying `commands: []`, distinguish-
  able from no frame at all: assert the emitted array has exactly one element (AC3);
- a malformed frame (`aliases: null` — the field whose contract forbids null, and the one a truthiness
  check waves through) emits nothing and does not throw, asserted on the raw
  `sink.webContents.send.mock.calls.length` rather than on `emitted()` (AC2).

**The four bridge test files** — one `it` each, asserting `translateX(event) === null` (and, in
`questionBridge.test.ts`, that its subscriber emits no question event), against a
`const slashCommandList: DaemonEvent` fixture. These are the AC5 tests; the compile error is the real
guard and the test is the record of the decision.

**Not tested:** any entry-count or byte bound (nothing enforces one and a test would pin a fiction), and
any store or render behaviour (there is none).

**Gate:** `npm test -- src/main/daemonConnection.test.ts src/renderer/src/store/daemonEventBridge.test.ts
src/renderer/src/store/timelineBridge.test.ts src/renderer/src/store/modalBridge.test.ts
src/renderer/src/store/questionBridge.test.ts` and `npm run build`. On a red `npm run typecheck`, run
`npx tsc --noEmit -p tsconfig.web.json` separately before reading any error count as the blast radius —
the `&&` short-circuits and a node-side error hides every renderer one.

## Open questions

1. **Arm name — `slashCommandList` or `slashCommandsReceived`?** Resolved in favour of
   `slashCommandList`: the union's `…Received` arms (`conversationsReceived`,
   `recentWorkspacesReceived`) name a *reply to a request this client made*, and this frame is an
   unsolicited snapshot. `backgroundTaskRoster` is the matching precedent.
2. **Does the arm belong beside the question arms (its wire neighbours) or at the end of the union?**
   Resolved to the end: `questionShown` was placed mid-file because it copies `modalShown`'s
   conversation-scoping shape and the two families are read together. This arm opens its own family and
   has no such neighbour.
3. Whether #938's store consumes this through the `daemonEventBridge` or through a dedicated fifth
   subscriber is **#938's call, not this slice's** — the no-op comments must therefore say *dormant*,
   and must not assert which bridge will eventually claim it.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The boundary is explicit and singular — `parseSlashCommandListPayload`
  in `src/main/transport/inboundMessage.ts` — and this slice runs strictly downstream of it, adding no
  second parse and no re-validation. The concrete gap worth naming rather than waving past: that narrower
  makes the SHAPE trusted and nothing else, `string` carries no provenance signal in the type system, and
  this arm ships with NO consumer, so the untrusted-text obligation must survive to #938 and #681 through
  the arm's docblock alone. That is why the docblock is specified in § Design rather than left to the
  implementer. Directionally this is main→renderer (trusted→untrusted); **the slice adds no
  renderer→main surface at all**, which is what keeps category 4 below small.
- **[Tokens, secrets, credentials]** No findings. No token, key or credential is generated, stored,
  rotated or compared. Concretely, and unlike its nearest sibling: `questionShown` carries
  `questionBatchId`, an unguessable one-time nonce, whereas `SlashCommandListPayload.conversation_id` is
  an outbound routing/scoping key that the wire docblock states is neither a nonce nor a secret. The
  never-log rule still applies to this arm, but for log forgery (7a), not for secrecy — same rule,
  different reason, and a reader who collapses the two will draw the wrong conclusion about #938.
- **[File / storage operations]** No findings. Nothing here touches the filesystem: no path is built, no
  cache key or lookup path is derived from `name`, and nothing is persisted. The one real adjacency is
  that the diagnostic log IS a disk file under the app data dir which the operator can ship in a debug
  bundle — which is why the load-bearing category for this slice is 7 rather than this one.
- **[Inter-process / Electron attack surface]** No findings. No `BrowserWindow`, no `webPreferences`
  change, no protocol handler, no navigation guard, and **no new IPC channel or `contextBridge` method**
  — the arm rides the existing `DAEMON_EVENT_CHANNEL`, whose preload subscription already exists, so the
  renderer→main capability set is unchanged. On the by-reference `commands` pass: the array is briefly
  aliased between the decoded inbound value and the emitted event *inside the main process*, but
  `emitDaemonEvent` sends synchronously and nothing retains the inbound value past the switch, so there
  is no aliasing window; the renderer receives a structured-clone copy and cannot reach main-process
  state through it.
- **[Cryptographic primitives]** No findings. No randomness, primitive, key, nonce or secret comparison
  is introduced. `conversationId` is compared against nothing in this slice; when #938 keys a held menu
  by it, that is a local routing decision between two values the client already holds, wanting plain
  `===` rather than `timingSafeEqual`.
- **[Network & I/O]** No findings. No socket, URL, timeout or TLS decision is made or changed. The
  memory-exhaustion answer is upstream and was verified rather than assumed: `relayConnection` sets
  `maxPayload: maxFrameBytes` on the inbound WebSocket, and `decodeEnvelope` rejects a plaintext over
  `MAX_PLAINTEXT_BYTES` before any parse runs — so an unbounded `commands` array cannot reach this emit.
  This slice deliberately models **no second bound**: a duplicate cap would be a second number to keep in
  agreement with the daemon's.
- **[Error messages, logs, telemetry]** SHOULD FIX, three items — the load-bearing category here.
  **(a)** The emit must add **no** `diagnosticLog?.event` call and no `count` of commands. #936's decode
  already emitted the content-free record, and this leg is the one place a workspace-authored
  `description` could reach a sink; `0x0a` is the only sub-`0x20` byte measured across the capture's 51
  entries, so an author who can write a description holds a log-forgery primitive against a JSON-lines
  file the operator can ship off-box. Verify by reading the diff, not by trusting this plan.
  **(b)** The four bridge no-ops are a **security control**, not typecheck bookkeeping. All four guards
  are `throw new Error(\`Unhandled daemon event: ${JSON.stringify(event)}\`)`, so a missing case
  serialises every workspace-authored string on the frame into an Error message. AC5 reads as a
  formality and is not one; the design already carries all four cases, so this is implement-and-verify.
  **(c)** Test fixtures must be obviously synthetic — no real repository path, no real command name —
  because a failing `toEqual` prints the whole object into CI output.
- **[Concurrency]** No findings. Nothing async is added: the emit is a synchronous statement inside an
  already-running handler with no `await`, so there is no check-then-act gap across a suspension point,
  no task to own or abort, no timer or listener to clear, and no shutdown path changed. The four bridges
  gain `return null` and hold no state.
- **[Threat model alignment]** One deferral. *Hostile daemon*: it can put arbitrary bounded text in all
  four string fields; #936 polices type only, this slice polices nothing further and adds no consumer, so
  the exposure is exactly #936's and is not widened here. *Renderer compromise reaching the transport*:
  unchanged, since no renderer→main capability is added. *Malicious / on-path relay*: it is content-blind
  but can drop, delay or stall this frame, and the frame is a SNAPSHOT THAT REPLACES rather than a delta
  — so a dropped or late frame leaves a reader's menu silently wrong rather than merely absent, and a
  greyed-out working command is the visible failure. Nothing in this slice holds a menu, so
  **staleness and replace-ordering are OUT OF SCOPE and belong to #938**, which holds the list per
  conversation; #938 must name the question rather than inherit it silently.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
