# #871 — carry the conversation id on the `modalShown` IPC arm

#870 decoded `conversation_id` off the `modal_shown` frame and stopped at the background process.
This slice carries it the remaining hop, main → renderer, by widening the `modalShown` `DaemonEvent`
arm. Nothing consumes it: `modalBridge.ts` rebuilds a fresh `ModalEvent` from named fields and
therefore drops it with **no edit**, so the field lands dormant. #872 is the consumer.

**Two executable production lines.** Everything else is comment repair and a fixture cascade.

This is the tenth arm to gain `conversationId`, and it follows the shipped pattern of #675's widening
family (`turnState` #724, `stallDetected` #732, `apiRetry` #737, `compacting` #742, `assistantDelta`
#751, `turnEnd` #752, `toolUse` #763, `toolResult` #766, `unrecognizedMessage` #784) rather than
re-deriving it. It is not a *member* of that family — it belongs to #802's modal chain (#870 → #871 →
#872) — but the shape, the wording, and the rulings are the same, and the sibling commits are the
authority on all three.

## Design source

N/A — a transport/IPC widening with no rendered surface. The ticket body has no `## Figma` section and
needs none: the field is deliberately not forwarded past `modalBridge.ts`, so nothing an operator sees
changes. The sidebar dot this chain ends in is #872's and carries its own Figma anchor. The
visual-fidelity check is intentionally skipped.

## Base — verified this pass

Measured against `1c55fdd`, which is both `HEAD` and `origin/main` (`git fetch origin --prune` run
this pass). **Every line number below was re-checked against the working tree**, and the probe in
§ Measured probe was run live on that commit. Use the citations as written.

## Files to read first

codegraph is wired but not indexed for this repo (`.codegraph/` holds `config.json` only, no DB) —
`codegraph_status` errors `CodeGraph not initialized`, re-confirmed 2026-09-01. This list was built by
grep + Read + a live compile/test probe instead.

| Path | What to extract |
| --- | --- |
| `src/shared/ipc/events.ts:635-649` | The arm. Doc block at `:635-640` (the false parenthetical is at `:637-638`); the braced union member at `:641-649` that gains the field. **Edit site for AC1 and stale comment (1).** |
| `src/shared/ipc/events.ts:105-129` | **The prose template.** #751's shipped `assistantDelta` paragraphs: "copied BY NAME at the emit", "REQUIRED, never optional", "daemon-asserted ROUTING KEY, not rendered text", and "It STOPS at the renderer bridge". Read before writing any comment. |
| `src/main/daemonConnection.ts:1027-1046` | The `case 'modal-shown':` emit. Comment at `:1028-1036` (stale claim at `:1031-1033`), fresh literal at `:1037-1045` that gains one line. **Edit site for AC1 and stale comment (2).** |
| `src/main/daemonConnection.ts:1047-1056` | The `case 'modal-dismissed':` comment. `:1048-1049` says "NO `conversation_id` (a modal carries none)" — **stale comment (3)**, and a *narrowing* edit, not a deletion. See § The three stale comments. |
| `src/main/daemonConnection.ts:826-847` | #784's `unrecognized-message` emit — the byte-level template for both the literal and the comment repair. |
| `src/main/transport/inboundMessage.ts:1215-1251` | `parseModalShownPayload`. `requireString(payload, 'conversation_id')` is already at `:1236`. **Confirms the decode needs zero change.** |
| `src/renderer/src/store/modalBridge.ts:21-52` | `translateModalEvent`'s `modalShown` case. The docblock at `:24-25` states the fresh-literal rule that makes this field land dormant. **No code change, no comment change** — see § Must-NOT-sweep. |
| `src/renderer/src/store/pushNotifyBridge.ts:20-39, :92-100` | The `default: null` filter. Reads only `event.type` and `event.modalId`. Unaffected; read it to confirm rather than assume. |
| `src/main/daemonConnection.test.ts:3146-3213` | The `modal_shown` stream describe: the test that inverts (`:3156`), its `toEqual` (`:3177-3190`), and the out-of-enum-class test (`:3193`). |
| `src/main/daemonConnection.test.ts:2540-2559` | #784's anti-smuggle guard — `Object.keys().sort()` + `not.toContain`. **The exact shape of this ticket's one new test.** |
| `src/main/daemonConnection.test.ts:330-332` | `modalShownPlaintext(payload: unknown)` — takes `unknown`, so the new test's extra key needs no helper change. |
| `src/main/daemonConnection.roundtrip.test.ts:611-641` | `modalPayload` (already carries the id, `:616`) and `expectedModalShown` (`:630-641`), which #870 explicitly instructed leaving alone. **This ticket is where it changes.** |
| `src/renderer/src/store/modalPrompts.ts:29-34` | `ModalEvent`'s docblock — carries the **same false parenthetical** as `events.ts:637-638`. **Out of scope, #872's.** See § Must-NOT-sweep; this is the sweep trap. |
| `docs/specs/architecture/784-unrecognized-message-conversation-id-arm.md` | The most recent widening's spec. Same shape, same rulings, same in-file/out-of-file discipline. |
| `docs/specs/architecture/870-modal-shown-conversation-id.md` | The immediately preceding slice. Its § 3 is the deferral this ticket cashes in. |
| `CLAUDE.md` § Conventions | Sealed event shapes, transport-out-of-the-window, the daemon-text rule. |

## Context

`ModalShownPayload` gained `conversation_id` in pyrycode#1065 and #870 mirrored the decode
(`inboundMessage.ts:1236`). The emit at `daemonConnection.ts:1037` builds a fresh named-field literal
and does not name the field, so the id is decoded and then discarded before the window sees it. A
desktop client following more than one conversation therefore cannot attribute an outstanding
permission prompt to a row.

`conversation_id` is an **outbound scoping key only**. `modalId` remains the sole *inbound*
correlation key: a `modal_answer` carries no conversation id and the daemon resolves it against its
own outstanding-modal state (`ModalAnswerPayload` / `ModalCancelPayload` are `ModalID`-only,
re-verified in #870 against `messaging.go:114-156`). Carrying the conversation outward does not loosen
that, and this ticket must not restate it as if it did.

## Design

Two production files, two executable lines.

### 1. The type — `src/shared/ipc/events.ts:641-649`

The braced union member gains a required `conversationId: string`, placed **first**, matching the
multi-line arms `unrecognizedMessage` (`:439-447`), `backgroundTaskStarted` (`:314-318`) and
`backgroundTaskRoster` (`:395-400`), and matching the wire order `ModalShownPayload` already uses:

```ts
| {
    type: 'modalShown'
    conversationId: string
    modalId: string
    …
  }
```

**Required, never optional.** Two independent reasons, both already settled upstream and neither to be
re-argued:

1. The wire has it always-present (no `omitempty`), so an optional field invents an absence case the
   daemon never produces.
2. An assigned `undefined` **survives** structured clone across the IPC bridge — `emitDaemonEvent`
   calls `webContents.send`, not `JSON.stringify` — so a later `'conversationId' in event` check would
   read true on an event carrying nothing. Required keeps that trap out of the code. This is the same
   reasoning behind the standing `'conversationId' in event` ban at `timelineBridge.ts:245-249`.

### 2. The emit — `src/main/daemonConnection.ts:1038`

One line added to the existing fresh literal, copied **by name**:

```ts
conversationId: inbound.modalShown.conversation_id,
```

Read **bare** — no `?? ''`, no default. `parseModalShownPayload` already requires the field
(`inboundMessage.ts:1236`), so a missing or non-string id drops the whole line upstream of this emit;
a fallback here would convert that fail-closed drop into a silent misattribution — an outstanding
permission prompt filed against the wrong conversation.

Copied by name onto the existing literal, **never** by spreading `inbound.modalShown`. That is the
house idiom at every emit in this file and is what stops a decoder that later grows a field from
smuggling it across IPC.

**This line is compiler-forced** — measured, not assumed (§ Measured probe). `emitDaemonEvent`'s
second parameter is typed `DaemonEvent`, so applying the type edit alone errors at
`daemonConnection.ts:1037`.

### 3. Why it lands dormant — no bridge edit

`translateModalEvent`'s `modalShown` case (`modalBridge.ts:43-52`) reconstructs a fresh `ModalEvent`
from named fields, precisely so the translator "stays immune to a `DaemonEvent` arm gaining an
unrelated field later" (`:24-25`). It therefore compiles untouched and simply does not forward the new
field. `ModalEvent` and `ModalPrompt` must **not** gain one here — they are #872's.

The other three bridges are likewise unaffected: `daemonEventBridge.ts` and `timelineBridge.ts` no-op
the arm, and `pushNotifyBridge.ts` is a deliberate `default: null` filter that reads only `event.type`
and `event.modalId`. **Adding a field to an existing arm forces no `case` anywhere** — only a new arm
would. Confirmed by the probe: zero production files beyond the two above appear in any error.

### The three stale comments — AC4

AC4 is scoped to the **touched files**. There are three sites, not the two the ticket body counts.

1. **`events.ts:637-638`** — "``modalId`` is the sole correlation key — no `conversation_id` is
   carried (the wire carries none on a modal)." The parenthetical is now false; the *answering*
   half stays true. Replace with the `assistantDelta` posture prose (`:105-129`), which must state:
   the id is copied by name at the emit from an already-validated payload; it is REQUIRED, never
   optional; it is a **daemon-asserted routing/scoping key, not rendered text**, so none of the
   untrusted-text warnings on `title` / `prompt` / `options[].label` attach to it; it **STOPS** at
   `modalBridge.ts`, which rebuilds a fresh `ModalEvent` omitting it, and the consumer is #872; and
   `modalId` remains the sole *inbound* correlation key for answering.

   **Do not weaken or reflow the untrusted-display-text sentence at `:638-640` or the "No token, key,
   or raw frame (AC4)" line at `:640` while repairing the sentence above them.** They stay verbatim.

2. **`daemonConnection.ts:1031-1033`** — "The payload DOES carry a `conversation_id` … and this emit
   deliberately drops it … #871 adds the DaemonEvent field that carries it across IPC." This sentence
   describes the world before this ticket. Rewrite in the `unrecognized-message` shape (`:827-843`):
   the id is carried, copied by name, read bare because the decode already guarantees it, and it stops
   at the modal bridge.

3. **`daemonConnection.ts:1048-1049`** — the `modal-dismissed` case: "NO `conversation_id` (**a modal
   carries none**)." The claim about `modal_dismissed` is still true; the parenthesised *reason*
   over-reaches once one rides `modal_shown`, and AC4's text ("no comment in the touched files still
   claims a modal carries no conversation id") catches it exactly. **Narrow the reason, keep the
   claim** — the same edit #870 made to `ModalAnswerPayload`'s "NO `conversation_id` rides a modal" →
   "rides an *answer*". Do not add a field to the `modalDismissed` arm.

## Measured probe — run live this pass on `1c55fdd`

Applying **only** the two production edits (no comments, no fixtures):

| Layer | Result |
| --- | --- |
| `tsc -p tsconfig.node.json` | **0 errors** with type + emit applied together. With the type applied and the emit reverted: **1 error at `daemonConnection.ts:1037`** — so the emit **is** compiler-forced, and every fixture cascade is web-side. |
| `tsc -p tsconfig.web.json` | **6 errors across 5 files** — the complete tsc-forced fixture list. |
| `vitest run` | **exactly 2 failures**, both `toEqual` expectation sites. **No masked second wave** — verified below. |

The 6 tsc-forced sites, at the lines tsc reports:

`interactiveRoundtrip.test.tsx:94` · `daemonEventBridge.test.ts:186` · `modalBridge.test.ts:28` ·
`pushNotifyBridge.test.ts:36` · `pushNotifyBridge.test.ts:48` · `timelineBridge.test.ts:363`

**All six are plain widenings** — add `conversationId: '<id>'` and move on. Unlike #784, there is no
site here that must be deleted, absorbed or swapped: `modalShown` is owned by the modal bridge, not by
`timelineTargetFor`, so no routing table or census is involved.

The 2 vitest failures, with their actual messages:

- `daemonConnection.test.ts` — *"emits six camelCase fields … deliberately NOT conversation_id"* →
  `expected [ { type: 'modalShown', …(7) } ] to deeply equal [ { type: 'modalShown', …(6) } ]`
- `daemonConnection.roundtrip.test.ts` — *"variant 1: a still-held modal re-pushed after the reconnect
  surfaces exactly once"* → `expected { type: 'modalShown', …(7) } to deeply equal { …(6) }`

**No wave-2 trap on this ticket** — stated because the family has one and a reviewer will look for it.
The roundtrip file asserts `expectedModalShown` twice (`:667` and `:686`) and the first masks the
second, but both read the *same* `const`, so the single fixture edit clears both at once. There is no
`not.toContain('conv-…')` guard and no `Object.keys` guard in either modal describe to expose on a
second run — verified by grep this pass. Budget two failures, not more.

**Why only 2 of the 8 fixture sites fail at runtime:** vitest strips types without checking them, and
the six tsc-forced sites are all *inputs* whose tests never read the new field. The two that fail are
*expectations* compared with `toEqual`, which is exact and so rejects the extra key. They are
compiler-blind for the mirror-image reason: `toEqual`'s argument and `const expectedModalShown` are
never checked against `DaemonEvent`.

## Sites that change — the census

### Production — 2 files, 2 executable lines

| Site | What changes | Enforced by | AC |
| --- | --- | --- | --- |
| `events.ts:641-649` | The arm gains `conversationId: string`, first. | tsc | 1 |
| `events.ts:637-638` | Stale comment (1). Replace the false parenthetical; keep the untrusted-text and no-token sentences verbatim. | nothing | 4 |
| `daemonConnection.ts:1038` | The emit line, by name, bare. | tsc (node) | 1, 2 |
| `daemonConnection.ts:1031-1033` | Stale comment (2). The "deliberately drops it / #871 adds" sentence. | nothing | 4 |
| `daemonConnection.ts:1048-1049` | Stale comment (3). Narrow "a modal carries none" → a *dismissal* carries none. | nothing | 4 |

### Tests — 7 files

| Site | What changes | Enforced by | AC |
| --- | --- | --- | --- |
| `modalBridge.test.ts:28` | `DaemonEvent` fixture — widen. | tsc | 1 |
| `daemonEventBridge.test.ts:186` | `DaemonEvent` argument — widen. | tsc | 1 |
| `pushNotifyBridge.test.ts:36`, `:48` | Two `DaemonEvent` fixtures — widen. Keep each file's distinctive `-XYZ` value convention so the AC5 no-leak assertions there stay meaningful. | tsc | 1 |
| `timelineBridge.test.ts:363` | `DaemonEvent` fixture inside `const others: DaemonEvent[]` — widen. | tsc | 1 |
| `interactiveRoundtrip.test.tsx:94` | `bridge.emit(...)` argument — widen. | tsc | 1 |
| `daemonConnection.test.ts:3156` | Test **name**: "emits six camelCase fields … and deliberately NOT conversation_id (#870, carried by #871)" — **both halves are now wrong.** Seven fields, and the id is carried. | nothing | 2, 4 |
| `daemonConnection.test.ts:3177-3190` | The `toEqual` expectation — **inverts.** Add `conversationId: 'conv-7f3a'`, matching the input at `:3163` verbatim. **This is AC2's fails-on-main / passes-after proof.** | vitest | 2 |
| `daemonConnection.test.ts:3201` | The comment "Present so this stays a test of the `class` enum, not of the missing-field path (#870)" — still true, and the reference may stay. No fixture change; this test asserts a drop and keeps passing. | — | — |
| `daemonConnection.roundtrip.test.ts:630-641` | `expectedModalShown` gains `conversationId: 'conv-reconnect-1'`, matching `modalPayload.conversation_id` at `:616`. #870's spec said to leave this alone; **that instruction expires here.** | vitest | 2 |
| `daemonConnection.test.ts` (new, after `:3213`) | **One new test** — the anti-smuggle guard. See § Testing strategy. | vitest | 3 |

**Eight fixture/expectation sites. Six are compiler-forced, two are suite-forced, none is invisible to
both** — which is what makes this cascade cheap relative to #784's.

## Must-NOT-sweep — sites that look identical and must stay untouched

A grep for the drop-claim over-matches. Each of these was checked individually this pass.

| Site | Why it stays |
| --- | --- |
| **`src/renderer/src/store/modalPrompts.ts:32-33`** | **The sweep trap.** Carries the byte-identical claim "``modalId`` is the sole correlation key — no `conversation_id` is carried (the wire carries none on a modal, ADR 0009)" — but on `ModalEvent`, the renderer-local union. It is **genuinely false after this ticket** and is deliberately **#872's**, per the family's settled in-file/out-of-file convention (`docs/specs/architecture/764-…md`; six precedents). #872 widens `ModalEvent` / `ModalPrompt` and touches this file anyway. Pulling it in here makes this a three-production-file ticket to repair a comment the very next slice rewrites. **Leaving it stale is correct, not a miss.** |
| `src/renderer/src/store/modalBridge.ts:21-34` | The translator's docblock. "Reconstructed as a fresh literal … so the translator stays immune to a `DaemonEvent` arm gaining an unrelated field later" is not merely still true — this ticket is the first thing to actually exercise it. Do not "update" it. The file takes **zero** edits; `git diff --name-only` not naming it is a free, deterministic AC-by-construction proof. |
| `src/shared/wire/types.ts:886`, `:907` | "`modal_id` is the sole correlation key — NO `conversation_id` rides an ANSWER" on `ModalAnswerPayload` / `ModalCancelPayload`. #870 already narrowed these to the accurate claim. **Still true. Never touch.** |
| `src/shared/wire/types.ts:870` | `ModalDismissedPayload` — a dismissal genuinely carries no `conversation_id` (`messaging.go:114-156`). Stays. |
| `src/shared/wire/types.test.ts:694`, `:698`, `:701` | Assertions about `ModalAnswerPayload` / `ModalCancelPayload`. Different frames. Stay. |
| `src/shared/ipc/commands.ts:169`, `:291` | Outbound `modal_answer` / archive command claims. Different direction. Stay. |
| `src/main/transport/modalResolutionEnvelope.ts:6` | Scoped to the outbound resolution frames. Stays. |
| `src/main/daemonConnection.ts:615`, `:634`, `:650`, `:668`, `:691`, `:834` | Six sibling "a missing or non-string `conversation_id` drops the whole line without emitting" comments. All still true, and the **idiom to copy**, not to edit. |
| `src/main/transport/inboundMessage.ts:1215-1251` | `parseModalShownPayload`'s docblock already describes seven fields and the `conversation_id` narrow (#870 wrote it). **Zero decode change, zero comment change.** |
| `e2e/permission-modal-answer-paths.spec.ts:70-91` | `modalShownFrame` builds a **wire payload**, not a `DaemonEvent`; #870 already widened it. `e2e/` is in neither tsconfig and contains no `DaemonEvent` literal — verified this pass. No e2e change. |
| `src/preload/index.ts:122-125` | A field-agnostic forwarder over `DAEMON_EVENT_CHANNEL`; it enumerates no `DaemonEvent` field. No preload change. |
| `docs/knowledge/**` (`daemon-event-channel.md:143-144`, `inbound-message-decode.md:576-577`, `codebase/201.md:44-45`, ADR `0009`) | Shared knowledge-base docs, owned by the documentation phase, which runs after code review on this branch. **Not developer deliverables.** See § For the documentation phase. |

Blast radius confirmed by grep: **no consumer spreads a daemon event.**

## State + concurrency model

Unchanged. No store slice, no subscription, no async task, no teardown is touched. The field rides an
existing synchronous emit on an existing arm; `translateModalEvent` is a pure function over one event;
`emitDaemonEvent` remains the single choke point and keeps its destroyed-window guard. No consumer
reads the field this slice, so there is no new state anywhere — the `modalStore`'s `outstanding` slice
is byte-identical before and after.

## Error handling

Unchanged in shape, and deliberately so. **No new reject branch** — `parseModalShownPayload` already
throws on a missing or non-string `conversation_id` (#870), and that throw is caught and the frame
dropped silently at `daemonConnection.ts:490`, pre-existing and repo-wide. No new result type, no
banner, no dialog, no log line.

The one thing this ticket must **not** do is add a recovery path at the emit. A `?? ''` there would
turn the decoder's fail-closed drop into a silent misattribution.

## Testing strategy

`npm test` (vitest, node environment — renderer specs are static server renders and cannot click; not
a constraint here, since nothing interactive changes). Two of the eight fixture sites are the
fails-on-main / passes-after proof; **one new test** covers AC3.

### The two inversions — AC2

- `daemonConnection.test.ts:3177-3190`: add `conversationId: 'conv-7f3a'` to the expected event, and
  rename the test — it currently asserts the *opposite* of AC2 in both its title and its body. A name
  in the "emits seven camelCase fields including the conversation id, options in order" shape.
- `daemonConnection.roundtrip.test.ts:630-641`: add `conversationId: 'conv-reconnect-1'`. The assembled
  stack — real codec, real Noise, fake relay — proves the id survives the whole path end to end, which
  is the strongest AC2 evidence in the suite. Both of its assertion sites read this one `const`.

Do **not** add a new AC2 test alongside the old ones. The existing assertions inverted *are* the proof;
a parallel test would leave the old one asserting the drop.

### The one new test — AC3, the anti-smuggle guard

The `modal_shown` describe has **no `Object.keys` guard**, unlike eight sibling arms in the same file
(`:1767`, `:1900`, `:2550`, `:2638`, `:2761` among them). AC3 currently rides on `toEqual`'s exactness,
which a future `toMatchObject` would silently dissolve. Add one test after `:3213`, copying
`:2540-2559` exactly:

- Emit a well-formed `modal_shown` payload carrying an **extra** key (`smuggled: 'must-not-cross'`).
  `modalShownPlaintext` takes `unknown` (`:330`), so no helper changes.
- Assert `Object.keys(events[0]).sort()` equals the eight names: `class`, `conversationId`,
  `defaultOptionId`, `modalId`, `options`, `prompt`, `title`, `type`.
- Assert `JSON.stringify(events)` does **not** contain `'must-not-cross'`.

That single test is AC3 ("no token, no key, no raw frame — the new field brings no daemon content with
it") turned into a deterministic assertion, and it is the guard the next widening of this arm inherits.

### Everything else — confirm, write nothing

- **The six tsc-forced fixtures** need no new assertions. Their tests assert `null` translation or a
  notify-kind and never read the field; the widening is purely to satisfy the type.
- **AC1's "no absence case"** is enforced by the type, not by a test. Do not write a test for a
  `conversationId`-absent event: it cannot be constructed.
- **An emit-layer fail-closed test would be vacuous.** `inboundMessage.ts:1236` throws first, so the
  emit line is unreachable on a bad id and no mutation there can make such a test red.
  `inboundMessage.test.ts` already loops every required field through the absent and non-string cases
  (#870). #763, #766 and #784 each added none and each passed review.
- **`daemonConnection.test.ts:3193`** (out-of-enum `class`) keeps passing unchanged — #870 already put
  `conversation_id` on its input so it stays a test of the `class` enum.

**Gates:** `npm run build` (typecheck + build) catches the six; `npm test` catches the two plus the new
guard. Both must pass. `npm run e2e` needs no change — `e2e/` holds no `DaemonEvent` literal.

## For the documentation phase — not developer deliverables

Recorded here so the phase that owns these docs acts on them, and so code review does not read their
absence from the diff as a miss:

- `docs/knowledge/features/daemon-event-channel.md:143-144` — the arm's transcribed shape.
- `docs/knowledge/features/inbound-message-decode.md:576-577` — quotes the emit with the retired "NO
  conversation_id to drop — the wire carries none on a modal" comment.
- `docs/knowledge/codebase/201.md:44-45` — same retired claim. **Frozen file; read as history, do not
  edit.**
- ADR `0009-modal-prompt-model.md` — #870's spec ruled **amend, not supersede**, and scoped the
  amendment to that phase. Unchanged by this slice: the id still is not a correlation key.

## Scope rulings — stated so they are not re-litigated

**Red lines, by raw count.** 2 production files (gate ≥5) · 0 new files · 2 executable production lines
· 0 new exported types or components · **8 consumer fixture sites** (gate >10) · 4 acceptance criteria
(gate >5) · **0 new reject branches** (gate ≥10). Projected total written work — 2 production lines,
~20 lines of comment repair, 8 fixture lines, one ~14-line test, three name/title edits — is under 60
lines. **No red line is approached, so no rationalization is needed and none is offered.** `size:xs`
holds; nothing here would justify raising it, and XS is already the floor.

**A fixture-cascade split would be incoherent**, and this is the reason the ticket is not sliced
further: the type does not compile until the six tsc-forced fixtures move, so a "type first, fixtures
later" child leaves `main` red. The only alternative — an intermediate optional field — is banned by
name upstream ("required, never optional") and would import the structured-clone `in`-check trap the
required type exists to exclude. Same ruling as #763, #766 and #784.

**Branch-overlap check: clean.** `git fetch origin --prune`, then all **18** `origin/feature/<N>`
branches diffed against `origin/main` — none touches any of the nine files this ticket edits. No
`blockedBy` needed. #872 is natively blocked by this ticket, correctly.

## Open questions

None blocking. Three notes for the reviewer:

- **`modalPrompts.ts:32-33` is deliberately left false.** It is #872's, on the family's settled
  convention. Flagging it here is a false finding.
- **The ticket body counts two stale comments; there are three.** `daemonConnection.ts:1048-1049` is
  the third and is in scope under AC4's own wording. It is a narrowing edit, not a deletion.
- **One new test is deliberate, and one is the right number.** AC2 is proven by inverting two existing
  assertions; AC1 is enforced by the type; AC3 is the new guard.

## Security review

**Verdict:** PASS

**Findings:**

- **[1. Trust boundaries]** No findings — the boundary is explicit, single, and **this ticket moves it
  nowhere**. The daemon is the untrusted source; `conversation_id` crosses into trusted territory at
  `parseModalShownPayload` (`inboundMessage.ts:1232-1251`) via `requireString(payload,
  'conversation_id')` at `:1236`, which fail-closes with a `WireDecodeError` and drops the whole frame.
  Downstream holds the named `ModalShownPayload` type, never raw `unknown`. The field already crossed
  that boundary in #870 and was merely discarded afterwards. The **new** hop is main → renderer, the
  *trusted*-to-untrusted direction, so it grants the renderer no capability — it hands it one
  already-validated short string of a kind that already crosses this same channel on nine other arms.
  **SHOULD FIX, forwarded to #872 (re-stating #870's forward, since #872 is now the immediate next
  slice):** the id is *display-scoping* input, never authorization. When #872 matches it against a
  sidebar row, compare by equality against an existing keyed set (`Map.get`, a `===` scan) — never
  `obj[conversationId] = …`, which is the prototype-pollution shape, and never as a path segment,
  filename, or cache key (CLAUDE.md's daemon-text rule). This slice reaches none of those sinks, and
  § 3 records why that is structural rather than lucky.

- **[2. Tokens, secrets, credentials]** No findings — nothing is generated, stored, rotated or revoked.
  The emit copies **one named field** from an already-narrowed payload onto an existing fresh literal.
  The one-time `modal_id` nonce and the client-minted answer token are untouched, and no storage,
  keychain, `safeStorage` or `localStorage` path is on this diff. The inbound anti-forgery model is
  unchanged and was re-verified in #870 against `messaging.go:114-156`: `ModalAnswerPayload` and
  `ModalCancelPayload` carry `ModalID` only, so a client still cannot assert which conversation an
  answer targets. **The arm's genuinely dangerous fields — `title`, `prompt`, `options[].label`,
  untrusted `claude`-surfaced display text — are untouched, and their plain-text-never-HTML warning at
  `events.ts:638-640` must survive the comment repair one sentence above it verbatim.** That is called
  out as an explicit instruction in § The three stale comments, because reflowing a paragraph is
  exactly how such a warning gets softened by accident.

- **[3. File / storage operations]** Not applicable by design, and structurally rather than by luck: the
  decoded value's entire lifetime this slice is one field of an in-memory object that
  `translateModalEvent` then drops by rebuilding a fresh literal (`modalBridge.ts:43-52`). It reaches
  no `path.join`, no `fs` call, no cache key, no `Map` key, no `localStorage` and no disk — **no
  renderer consumer reads it at all**, verified by reading all four bridges this pass. Recorded here
  because §1 forwards that constraint to #872, the slice where it stops being automatic.

- **[4. Inter-process / Electron attack surface]** No findings, and this is the category that most
  needed walking, because unlike #870 this slice **does** add renderer-visible surface. What it adds is
  bounded precisely: one field on an existing `DaemonEvent` union member on the existing main →
  renderer broadcast. **No new `contextBridge` API, no new `ipcMain.handle` / `ipcMain.on` channel, no
  `webPreferences` change** — `src/preload/index.ts:122-125` is a field-agnostic forwarder that
  enumerates no `DaemonEvent` field and takes zero edits (verified this pass). Process placement is
  preserved: no crypto, socket, or key material moves toward the renderer, and the direction of flow is
  outbound, so a compromised renderer gains nothing it could act on. The information-flow delta is real
  but nil in class: the renderer learns which conversation raised a prompt, a fact it already receives
  on nine other arms of this same channel alongside full message text. **The one degradation path worth
  naming:** replacing the by-name copy with a spread of `inbound.modalShown` would make every field a
  future decoder grows cross IPC automatically. The by-name idiom, AC3, and the new `Object.keys` guard
  (§ Testing strategy) together forbid it — and that guard is this ticket's answer to the fact that
  the modal arm was, uniquely among its siblings, missing one.

- **[5. Cryptographic primitives]** Not applicable by design — the change sits entirely downstream of
  the Noise session, after decryption and after decode. No RNG, hashing, key derivation, nonce, AEAD
  framing, or secret comparison is added or touched. `Noise_IK_25519_ChaChaPoly_BLAKE2s` is not on this
  diff, and `hashPlaintext` at the decode-side log site is unchanged and still hashes the whole frame,
  not a field.

- **[6. Network & I/O]** Not applicable by design — no socket option, frame-size cap, timeout, relay
  URL, TLS setting or reconnect policy is touched; the change is at the already-decoded IPC emit,
  downstream of the frame-level size guard at `parseInboundMessage` that bounds every field
  transitively. Adversarially: a hostile relay is content-blind and on-path, so it can drop, delay or
  reorder whole frames — all of which it could already do — but AEAD integrity means it cannot strip
  `conversation_id` to steer the new field, and a flood of `modal_shown` frames has a blast radius that
  grows by exactly one short string per frame with no new accumulation path, since **nothing retains
  the field**. No per-field length cap is added: no sibling field has one, and adding one only here
  would be an inconsistent defense against an unobserved failure.

- **[7. Error messages, logs, telemetry]** No findings, verified rather than assumed. `emitDaemonEvent`
  is **log-free by construction** and says so in its header ("a console.log of the event would leak
  MessagePayload.text to main-process stdout"); it was re-read this pass and contains no log call, and
  this ticket adds none. No new error message or throw is added at all — the only failure mode
  (missing / non-string id) is #870's `requireString`, whose message names the field **name**, a
  client-owned literal, and never interpolates the offending value; the resulting `WireDecodeError` is
  then caught and dropped unread at `daemonConnection.ts:490`, so it cannot reach a log or an event
  even indirectly. The decode-side content-free log test (#870, `inboundMessage.test.ts:3891`) already
  pins the field out of the log record and needs no change. No renderer-console path is added.

- **[8. Concurrency]** Not applicable by design — no async task, timer, listener, subscription,
  `AbortController` or teardown is added or touched. The emit is a synchronous field copy inside an
  existing message handler; `translateModalEvent` is pure; `emitDaemonEvent` keeps its
  destroyed-window guard (`isDestroyed()` before any `webContents` read). No check-then-act across an
  `await`, no new shared mutable state, no shutdown behaviour change. The reconnect path is exercised
  end-to-end by `daemonConnection.roundtrip.test.ts:611-690`, whose fixture this ticket widens.

- **[9. Threat model alignment]** No findings for this ticket; one item explicitly deferred.
  *Hostile / buggy daemon response* is addressed — the field is parsed defensively and fail-closed
  before the emit, and a malformed frame is rejected whole, never partially decoded. *Malicious /
  compromised relay* is unchanged, per § 6. *Renderer compromise reaching the transport* is unchanged:
  the transport stays main-side and the IPC direction is outbound. *Token theft from disk* is not
  applicable — nothing is persisted.
  **OUT OF SCOPE, named:** the id is *daemon-asserted*, so a buggy or compromised daemon could attribute
  a permission prompt to a conversation it did not come from. That trust assumption is pre-existing and
  uniform across all nine arms that already carry the field, and this ticket does not change who is
  trusted. It is also **unreachable this slice** — no consumer reads the field — so the earliest point
  it could produce an operator-visible effect is #872, where the prompt is first scoped to a row. It
  belongs there, and §1's SHOULD FIX is the concrete form it takes.
  **Availability, considered and classified OUT OF SCOPE:** a daemon predating pyrycode#1065 makes every
  permission prompt vanish silently. Not new (that became true at #870, and is identical to every
  required field on every frame type), not exploitable (it requires an old daemon, not an attacker), and
  the fix — telemetry on the shared silent-drop path at `daemonConnection.ts:490` — is a repo-wide
  change belonging to a future drop-path-observability ticket.

**Non-finding stated explicitly to pre-empt it:** `conversationId` is **required, never optional**, so
there is no absent case. The structured-clone trap that bites *optional* IPC fields — an assigned
`undefined` survives `webContents.send` as a present own property, because the bridge structured-clones
rather than `JSON.stringify`s — has no purchase here. It is precisely why the ticket body specifies
required, why `'conversationId' in event` stays banned at `timelineBridge.ts:245-249`, and why a
"defensive" optional field would be strictly worse than the required one.

**The one real risk, and its control:** adding `?? ''` or any default at the emit would convert the
decoder's fail-closed drop into a silent misattribution — a permission prompt filed against the wrong
conversation, on the one arm where the operator is being asked to grant something. The required type
makes the fallback unnecessary and the by-name bare read makes it visible in review. It is **not**
testable at the emit layer (`inboundMessage.ts:1236` throws first, so the line is unreachable on a bad
id), so it is enforced by the type plus inspection. Classified SHOULD FIX-by-construction rather than
MUST FIX: the design as specified cannot reach the failure, only a deviation from it can.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-09-01
