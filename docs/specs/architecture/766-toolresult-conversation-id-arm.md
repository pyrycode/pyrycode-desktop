# #766 — carry the conversation id on the `toolResult` IPC arm

The fourth and last of #675's four turn-stream arms. `assistantDelta` (#751), `turnEnd` (#752) and
`toolUse` (#763) already shipped this widening; the four sub-state arms (`turnState`, `stallDetected`,
`apiRetry`, `compacting`) went through it earlier. **This spec follows that shipped pattern rather than
re-deriving it** — the sibling commits are the authority on wording and shape, not this document's prose.

## Design source

N/A — a transport/IPC type widening with no rendered surface. The ticket body has no `## Figma` section
and needs none: nothing about the window's appearance changes, and the three shipped sibling arms landed
the same way. The visual-fidelity check is intentionally skipped.

## Base — re-measured, and it moved after the ticket was written

**The ticket body measured against `main` at `6aadc97`. HEAD is now `f4c5048`** — #764 (the `toolUse`
citations sweep, PR #768) merged in between.

`git diff 6aadc97 f4c5048` touches three production files, **all comment-only**:

| File | Net lines | Effect on this ticket |
| --- | --- | --- |
| `src/main/transport/inboundMessage.ts` | 0 (−3/+3) | None. `parseToolResultPayload` and its `requireString` keep their line numbers. |
| `src/renderer/src/store/threadTimeline.ts` | 0 (−1/+1) | None. `:122` still the `ThreadEvent` `toolResult` member. |
| `src/renderer/src/store/timelineBridge.ts` | **+1** | **Every pin below its line 47 shifts by one.** Re-pinned below. |

`src/shared/ipc/events.ts`, `src/main/daemonConnection.ts` and **every test file** are untouched, so all
of the body's line numbers in those files survive. They were each re-verified against `f4c5048` during
this pass, and the probe was re-run on the new base (§ Measured probe).

**Re-pinned for the shift** — the body's `timelineBridge.ts` citations are all off by one now:

| Body says | Actually now | What it is |
| --- | --- | --- |
| `timelineBridge.ts:68-79` | **`:69-80`** | The `case 'toolResult':` arm — comment + the fresh `ThreadEvent` |
| `timelineBridge.ts:69` | **`:70`** | The "Field-for-field identical" comment — **#767's**, left stale here |
| `timelineBridge.ts:73-79` | **`:74-80`** | The returned `ThreadEvent` literal — changes in no ticket |

**Path correction.** The body cites `daemonConnection.ts` bare. It lives at **`src/main/daemonConnection.ts`**,
not under `src/main/transport/`.

## Files to read first

codegraph is wired but not indexed for this repo (`.codegraph/` holds config only, no DB) — every
`codegraph_*` call errors `CodeGraph not initialized`. This list was built by grep + read instead.

| Path | What to extract |
| --- | --- |
| `src/shared/ipc/events.ts:507-512` | The `toolResult` arm: its doc comment (both false claims) and the one-line union member that gains the field. |
| `src/shared/ipc/events.ts:475-506` | **The template.** #763's shipped `toolUse` arm — comment (`:475-`) plus its braced union member (`:498-506`). The exact sentences and shape the new `toolResult` block should echo. Read this before writing prose. |
| `src/main/daemonConnection.ts:911-924` | The `case 'tool-result':` emit — the comment block (two false claims) and the fresh literal that gains one line. |
| `src/main/daemonConnection.ts:886-909` | #763's shipped `tool-use` emit + comment. Same template role. |
| `src/main/transport/inboundMessage.ts:996-1006` | `parseToolResultPayload` — already `requireString`s `conversation_id` at `:1000`. **Confirms the decode needs no change.** |
| `src/main/daemonConnection.test.ts:2996-3049` | The two `tool_result` tests: the name, two `toEqual`s, the guard comment and the guard. |
| `src/main/daemonConnection.test.ts:2871-2903` | #763's shipped test edits — the rename, the guard comment, the inverted `toContain`. Byte-level template. |
| `src/renderer/src/store/timelineBridge.test.ts:164-182` | The bridge test: its name, the `DaemonEvent` literal that gains the field, and the `ThreadEvent` expectation directly below that must **not**. |
| `src/renderer/src/store/timelineBridge.ts:69-80` | The bridge arm. **Read to confirm no change is needed** — it rebuilds by name. Its comment is #767's. |
| `docs/specs/architecture/763-tooluse-conversation-id-arm.md` | The immediately preceding arm's spec. Same shape, same rulings. |
| `CLAUDE.md` § Conventions | Sealed event shapes, transport-out-of-the-window, untrusted-daemon-text rules. |

## Context

`ToolResultPayload` carries `conversation_id` on the wire (`src/shared/wire/types.ts:741-747`). The IPC
emit throws it away and documents that it does so. The renderer is moving to one timeline per
conversation (#756), where a result that cannot be attributed resolves a tool call in the **wrong
thread** — a row silently filled in on the chat the user happens to be looking at. This ticket restores
the field on the IPC arm and does nothing else with it.

## Design

Two production files. **One executable production line.** Everything else is comment retirement.

### The type — `src/shared/ipc/events.ts:512`

The `toolResult` arm is currently a single-line union member. It gains a required `conversationId: string`
and expands to a braced multi-line member, matching the `toolUse` arm at `:498-506`:

```ts
| {
    type: 'toolResult'
    conversationId: string
    turnId: string
    toolUseId: string
    isError: boolean
    resultSummary: string
  }
```

**Required, never optional.** An optional routing key invites the `?? activeConversation` fallback that
#675 exists to remove. This is stated in the ticket body, in #675, and in all three sibling arms.

### The emit — `src/main/daemonConnection.ts:918`

One line added to the existing fresh literal, copied **by name**:

```ts
conversationId: inbound.toolResult.conversation_id,
```

Read **bare** — no `?? ''`, no default. `parseToolResultPayload` already requires the field, so a missing
or non-string id drops the whole line upstream of this emit. A fallback here would convert that
fail-closed drop into a silent misattribution.

Copied by name onto the existing literal — **never** by spreading `inbound.toolResult`, so a decoder that
later grows a field cannot smuggle it across IPC. This is the shipped idiom on all seven prior arms.

### The decode — no change

`parseToolResultPayload` (`src/main/transport/inboundMessage.ts:996-1006`) already does
`requireString(payload, 'conversation_id')` at `:1000`. Zero decode lines. Fourth arm running.

### The bridge — no change, and that is the point

`translateTimelineEvent`'s `case 'toolResult':` (`src/renderer/src/store/timelineBridge.ts:69-80`)
rebuilds a fresh `ThreadEvent` from named fields. It does not spread, so the new field is dropped there
with no edit. `ThreadEvent` carries no conversation id and **must not gain one** — the id stops at the
bridge until #756 builds the consumers that route by it.

This is measured, not asserted: under the probe, with the `DaemonEvent` literal at
`timelineBridge.test.ts:165` widened, **all 38 tests in `timelineBridge.test.ts` pass** — the exact
`toEqual` at `:173-179` would fail if the id ever leaked across.

`fillResult`'s correlation stays on `toolUseId` alone. This ticket does **not** make result resolution
depend on the new field.

## State + concurrency model

Unchanged. No store slice, no subscription, no teardown, no async surface is touched. The field rides an
existing synchronous emit on an existing arm and is dropped by an existing pure translation function.
`emitDaemonEvent` remains the single choke point.

## Error handling

Unchanged, and deliberately so. The failure mode (missing / non-string `conversation_id`) is handled one
layer up, in the decoder, by dropping the whole line without emitting. No new result type, no new UI
surface, no banner or dialog. The one thing this ticket must **not** do is add a recovery path at the
emit — see AC2.

## Testing strategy

**Zero new tests.** The developer widens fixtures, retires stale names and comments, and inverts one
guard. Nothing else.

### AC2 is already green — confirm, write nothing

Both halves are pinned by shipped tests that need no edit:

- `src/main/transport/inboundMessage.test.ts:2796-2801` — loops every field, including `conversation_id`,
  through the missing case expecting a throw.
- `:2803-2813` — covers `conversation_id: 7` (non-string).

**Do not write an emit-layer fail-closed test.** It would be *vacuous*: `inboundMessage.ts:1000` throws
first, so the emit line is unreachable on a bad id and **no mutation there can make such a test red**.
AC2's second half (the `?? ''` ban) is an **inspection** criterion, not a testable one.

### Do not diff against `assistant_delta` / `turn_end` for a "missing" test

Those two arms each have a dedicated `conversation_id` fail-closed test (`daemonConnection.test.ts:1406`,
`:1428`). **`tool_use` (#763) added none, and that was reviewed and passed.** `tool_result` already has
its matching malformed-payload test at `:3051`. #763 is the precedent; #751/#752 are the anti-precedent.
A reviewer diffing this change against `assistantDelta` will raise a false "missing test" finding.

### The guard at `daemonConnection.test.ts:3022` inverts — it does not vanish

Its fixture uses `conversation_id: 'conv-1'`, so `not.toContain('conv-1')` flips from a true drop-guard
to a false one. Make it a positive `toContain` with a rewritten comment, following #763's byte-level
template at `:2900-2902`. **Deleting it silently is the one outcome to avoid.** It is subsumed by the
`toEqual` above it — that is the shipped idiom on three arms now, not a finding.

## Measured probe — re-run on `f4c5048` during this pass

Applying only the two production edits above:

| Layer | Result |
| --- | --- |
| `tsc -p tsconfig.node.json` | **0 errors.** Every cascade is web-side. (The emit itself errors only if the type lands without the emit.) |
| `tsc -p tsconfig.web.json` | **10 errors across 5 test files** |
| `vitest run` | **3 failures, all in `daemonConnection.test.ts`, exposed across two runs** |
| `timelineBridge.test.ts` | **38/38 pass** unwidened — the id demonstrably stops at the bridge |

The 10 tsc-forced fixture adds, **at the lines tsc reports** (the object literal's opening line, which is
one below the `const event: DaemonEvent = {` line in four cases):

`interactiveRoundtrip.test.tsx:56` · `conversationActivityBridge.test.ts:119` ·
`daemonEventBridge.test.ts:145` · `modalBridge.test.ts:129` ·
`timelineBridge.test.ts:165, 599, 623, 637, 657, 661`

Each is a one-token add to a `DaemonEvent` literal. **No fixture *helper* changes** — see the
`threadTimeline.test.ts` entry in § Must-NOT-sweep for the helper that must stay put.

### The ordering trap — budget three failures, not two

`vitest` reports at the **call** line, not the literal line:

1. Run 1 shows **2** failures: `:3012` (the `toEqual` whose literal opens at `:3014`) and `:3040`
   (literal at `:3042`).
2. Fixing both exposes a **third**: the `not.toContain('conv-1')` guard at `:3022`, which run 1 never
   reached because the `toEqual` above it failed first.

Confirmed live in this pass — run 2 reported it at `:3023:40` (the guard, shifted one line by the fixture
add). **Never quote the failure count from a single run.**

Once fixture and guard are fixed in one edit there is **no early return** between the `toEqual` and the
guard, so a green test *proves* the guard executed. No re-run is needed to confirm that.

## Sites that change — the census

Rebuilt by grepping the drop-predicate, the arm's own comment block, and test **names** separately. The
three shipped sibling arms each landed with a body census short by two to five sites.

| Site | What goes false | Enforced by | AC |
| --- | --- | --- | --- |
| `events.ts:512` | The arm type. | tsc | 1 |
| `daemonConnection.ts:918` | The emit. The one executable production line. | tsc (node half) | 1 |
| `events.ts:507` | "Carries the **four** render fields (`conversation_id` **dropped at the emit**)" — both the count and the parenthetical. | nothing | 4 |
| `daemonConnection.ts:912-913` | "`conversation_id` is **DROPPED** (single active conversation; #202's bridge scopes identity)". | nothing | 4 |
| `daemonConnection.ts:913-914` | **Same block, next sentence:** "A fresh literal with the **four** named fields" → five. Rewriting the sentence above and leaving the count is the natural miss. | nothing | 4 |
| `events.ts:292` | "unlike toolResult, which still drops it **until #754**". See § The dead ticket reference. | nothing | 4 |
| `events.ts:515` | "Carries `conversationId` (**unlike toolResult, which still drops it**)" — the `queueState` arm. | nothing | 4 |
| `daemonConnection.ts:927` | "**unlike toolResult this KEEPS** conversation_id" — the `queueState` emit. Third contrast site, second neighbouring arm. | nothing | 4 |
| `daemonConnection.test.ts:2996` | Test **name**: "carrying the **four** camelCase fields (**conversation_id dropped**)". Both halves. | nothing | 4 |
| `daemonConnection.test.ts:3021` | The **comment** above the guard: "conversation_id is dropped at the choke point…". Neither tsc nor the suite catches this. | nothing | 4 |
| `daemonConnection.test.ts:3014` | `toEqual` fixture. | vitest (run 1, reported `:3012`) | 1 |
| `daemonConnection.test.ts:3042` | `toEqual` fixture. | vitest (run 1, reported `:3040`) | 1 |
| `daemonConnection.test.ts:3022` | The `not.toContain('conv-1')` guard. **Must invert.** | vitest (run 2 only) | 4 |
| `timelineBridge.test.ts:164` | Test **name**: "toolResult → a ThreadEvent toolResult **with the same fields**". The two shapes now differ by exactly this field — the seam #756 builds on. | nothing | 4 |
| `timelineBridge.test.ts:165, 599, 623, 637, 657, 661` + the 4 other files listed under § Measured probe | tsc-forced `DaemonEvent` fixture adds. | tsc (web half) | 1 |

**Ten sites are invisible to the compiler; nine of those are invisible to the suite as well** (the guard
at `:3022` is the exception — run 2 catches it). AC4's "nine" counts categories: three contrast comments,
two field counts, two test names, one test comment, one guard. The arm's own drop-prose at `:912-913` is
rewritten in the same block as its count at `:913-914`.

### Cheap completeness check for the contrast class

`rg -i "unlike toolResult" src/` returns exactly **3** today — `events.ts:292`, `events.ts:515`,
`daemonConnection.ts:927`. After this change it must return **0**. One grep proves all three landed.
(#763 used the same check against `unlike toolUse`.)

### The dead ticket reference

`events.ts:292` defers to **#754**, which is **CLOSED as NOT_PLANNED** (verified this pass via
`gh issue view 754`) — it was split into this ticket and #767. The replacement must not name #754, and
there is **no successor to repoint it at**: `toolResult` is the last still-dropping turn-stream arm.
State the fact directly rather than naming a neighbour.

## Must-NOT-sweep — sites that look identical and must stay untouched

A grep for the drop-claim over-matches badly here. **None of these change**, and line numbers are
re-pinned to `f4c5048`.

| Site | Why it stays |
| --- | --- |
| `daemonConnection.test.ts:2479` (test name "…dropping conversation_id") and `:2495-2496` (comment + `not.toContain('conv-1')`) | The **`unrecognizedMessage`** arm, which still truthfully drops the id. Byte-identical predicate, byte-identical comment, and the identical `'conv-1'` string. **Repo-wide there are now exactly two `not.toContain('conv-1')` in this file — `:2496` and `:3022` — and exactly one inverts.** Discriminate by the enclosing `describe`. |
| `daemonConnection.ts:615, :634, :650, :668, :691` | Five sibling-arm comments reading "a missing or non-string `conversation_id` drops the whole line without emitting" — `turnEnd` / `turnState` / `stall` / `apiRetry` / `compacting`. All still **true**, and they are the idiom to **copy**, not edit. |
| `daemonConnection.test.ts:2963` — `not.toContain('"input"')` | `toolUse`'s absent-input guard (#763). Identical shape, different string. |
| `events.ts:422`, `daemonConnection.ts:832` | `unrecognizedMessage`'s own drop claims. Still true. |
| `inboundMessage.test.ts:2751` ("all five fields verbatim") and `:2782` ("the five known tool_result fields") | These count the **wire** type `ToolResultPayload`, which already has five fields. Already true, stay true. |
| `src/shared/wire/types.ts:730` — "Mirrors the daemon's ToolResultPayload field-for-field" | A wire↔daemon claim, not a `DaemonEvent`↔`ThreadEvent` one. |
| `threadTimeline.ts:122` — the **`ThreadEvent`** `toolResult` member | `ThreadEvent` carries no conversation id and must not gain one. No comment sits above it (`:103-104` is `toolUse`'s). |
| `threadTimeline.test.ts:41-47` — the `toolResult()` fixture **helper** | Builds the **ThreadEvent** shape for `reduceTimeline`, not a `DaemonEvent`. tsc never flags it, so nothing forces it and nothing stops a sweep from "fixing" it. Editing it also breaks this ticket's no-helper-changes size claim. |
| `timelineBridge.ts:69-80` — the arm's comment and the fresh `ThreadEvent` it builds | The comment at **`:70`** ("Field-for-field identical to its ThreadEvent counterpart") **does go false** — and it is **#767's** to fix, exactly as #763 left `timelineBridge.ts:48-49` stale for #764. Leaving it stale here is correct, not a miss. The literal at `:74-80` changes in no ticket. |
| `timelineBridge.test.ts:173-179` — the `toEqual` **ThreadEvent** expectation | Sits eight lines below the `DaemonEvent` literal at `:165-171` that *does* gain the field. Adjacent, opposite requirements: classify by which union each is checked against, never by the spelling. |
| `inboundMessage.ts:224-225` | `:224` "carries the four render fields onward (dropping `conversation_id`)" goes false — **#767's**. `:225` "four required strings" counts the wire decode and stays **true**. Touch neither. |
| `e2e/tool-row-toggle.spec.ts:69-77` | A raw **wire** frame the fake daemon pushes, and `e2e/` is in neither tsconfig. Verified this pass: **no `DaemonEvent` `toolResult` literal exists anywhere under `e2e/`**. |

### No citations hole outside this ticket and #767

Every other file in `src/` and `e2e/` mentioning `toolResult` was checked for a drop- or
equivalence-claim and **none carries one**: `daemonEventBridge.ts:56` and `modalBridge.ts:78` are bare
arm-selection labels, `backgroundTaskRosterStore.ts:105` speaks about the `tool_use_id` identifier domain
(unaffected — the arm keeps `toolUseId`), `ConversationScreen.test.tsx:1528` and `pairedShell.css:37` are
prose, and `wire/types.test.ts:572` is an envelope-type string. The two comments that *are* false —
`inboundMessage.ts:224` and `timelineBridge.ts:70` — are **#767's**, and are the complete remainder.

Blast radius confirmed by grep: **no consumer spreads a daemon event.** `timelineBridge.ts` rebuilds by
name, which is what makes the bridge's `toEqual` executable proof rather than a claim.

## Scope rulings — stated here so they are not re-litigated

**The >10-call-site red line is inapplicable, on the same grounds as #763.** Two independent reasons:

1. Its prescribed remedy is the Strangler Fig pattern, whose optional-first union is **banned by name in
   #675** ("required, never optional"). A red line whose escape hatch is forbidden upstream is not a
   split signal.
2. It bounds *discovery* cost. Discovery here is **zero** — all 16 sites are tabled with file:line, 12
   forced by tsc, 3 by vitest, and the compiler-blind remainder carries its own acceptance criterion
   (AC4). The developer greps nothing.

**Size check: `size:s` holds.** 2 production files (below the ≥5-file gate), 0 new files, 0 new exported
types, 1 executable production line, 6 test files, no fixture helpers, 0 new tests, 4 acceptance criteria.
Projected total written work is well under 200 lines. Size oracle — the three shipped siblings by real
diffstat: #751 `739151c` (2 production files, 102 insertions), #752 `335e5ab` (2 production files, 78
insertions), #763 `52dc0cc` (2 production files, 8 files total, 98 insertions). This ticket's re-run probe
reproduces that shape exactly.

**Branch-overlap check: clean.** `git fetch origin --prune` then every `origin/feature/<N>` branch diffed
against `origin/main` — no in-flight branch touches any of the eight files this ticket edits. No
`blockedBy` needed; #766 has no open blocker (#765 merged 2026-08-25T07:43:47Z).

## Open questions

None blocking. Two notes for the reviewer:

- **`timelineBridge.ts:70` is deliberately left false.** It is #767's, mirroring how #763 left
  `timelineBridge.ts:48-49` for #764. Flagging it here would be a false finding.
- **Zero new tests is deliberate and precedented** (#763). See § Testing strategy for why the obvious
  emit-layer test would be vacuous.

## Security review

**Verdict:** PASS

**Findings:**

- **[1. Trust boundaries]** No findings — the boundary is explicit and single. The daemon is the
  untrusted source; `conversation_id` crosses into trusted territory at
  `parseToolResultPayload` (`src/main/transport/inboundMessage.ts:996-1006`) via
  `requireString(payload, 'conversation_id')` at `:1000`, which fail-closes with a `WireDecodeError` and
  drops the whole line. Downstream holds the named `ToolResultPayload` type, never raw `unknown`. **This
  ticket moves the boundary nowhere** — the field already crossed it before this change and was merely
  discarded afterwards. The IPC hop it now rides is main → renderer, the *trusted*-to-untrusted
  direction, so it grants the renderer no capability; it hands it one already-validated short string.

- **[2. Tokens, secrets, credentials]** No findings — nothing is generated, stored, rotated or revoked
  here. AC3 is the standing check that no token, key or raw frame rides the widened arm, and the emit
  satisfies it structurally: it copies **one named field** from an already-narrowed payload onto an
  existing fresh literal. `conversation_id` is a daemon-generated conversation identifier that already
  crosses this same channel on ten other arms (`assistantDelta`, `turnEnd`, `toolUse`, `turnState`,
  `stallDetected`, `apiRetry`, `compacting`, `queueState`, `modelAnnounced`, `backgroundTaskOpened`), so
  this introduces no new class of data.

- **[3. File / storage operations]** Not applicable by design — the change adds no filesystem path, no
  persistence, and no cache. The id is never used as a filename, cache key or lookup path in this ticket;
  the bridge drops it before the renderer, so it reaches no renderer-side web storage at all. It becomes
  a routing key only in #756, which owns that decision.

- **[4. Inter-process / Electron attack surface]** No findings, and this is the category that most needed
  walking. No new `contextBridge` API, no new `ipcMain.handle` / `ipcMain.on` channel, no
  `webPreferences` change: one field is added to an existing `DaemonEvent` union member on the existing
  main → renderer event broadcast. Process placement is preserved — the change is entirely within
  `src/main` and `src/shared`, and no crypto, socket or key material moves toward the renderer.
  **The one degradation path worth naming:** replacing the by-name copy with a spread of
  `inbound.toolResult` would make every field a future decoder grows cross IPC automatically. That is
  precisely the property the by-name idiom exists to preserve; the spec, AC3 and all seven shipped sibling
  arms forbid it. Widening the literal does not weaken it.

- **[5. Cryptographic primitives]** Not applicable by design — the change sits entirely downstream of the
  Noise session, after decryption and after decode. No RNG, no hashing, no key derivation, no nonce, no
  comparison against a secret is added or touched. The `Noise_IK_25519_ChaChaPoly_BLAKE2s` path is not on
  this diff.

- **[6. Network & I/O]** Not applicable by design — no socket option, frame-size cap, timeout, URL,
  TLS setting or reconnect policy is touched; the change is at the already-decoded IPC emit, downstream of
  `maxPayload` and the connect/idle deadlines. Adversarially: a hostile relay or daemon flooding
  `tool_result` frames has an **unchanged** blast radius — one extra short string per frame, and no
  unbounded accumulation is introduced, because the bridge drops the field and this ticket adds no map
  keyed by it.

- **[7. Error messages, logs, telemetry]** No findings, verified rather than assumed. `emitDaemonEvent`
  contains no log call (grepped this pass), and the emit adds none. The decode-failure path cannot leak
  daemon-controlled text either: `requireString` throws ``missing required field: ${field}`` — the field
  **name**, a client-owned constant, never the offending value (`inboundMessage.ts:307-313`), and
  `parseToolResultPayload`'s own throw is the constant `'malformed tool_result payload'`. No new error
  message, no new throw, and no renderer-console path is added.

- **[8. Concurrency]** Not applicable by design — no async task, timer, listener, subscription or
  teardown is added. The emit is a synchronous field copy inside an existing message handler, and
  `translateTimelineEvent` is a pure function. There is no check-then-act across an `await` and no shared
  state mutated, so no cancellation or shutdown behaviour changes.

- **[9. Threat model alignment]** No findings for this ticket; one item explicitly deferred.
  *Hostile daemon response* is addressed — the field is parsed defensively and fail-closed before the
  emit. *Malicious / compromised relay* is unchanged: the relay stays content-blind and on-path, and this
  diff neither adds plaintext exposure nor a new hang point. *Renderer compromise reaching the transport*
  is unchanged: the transport stays in the main process. *Token theft from disk* is not applicable —
  nothing is persisted.
  **OUT OF SCOPE, named:** the id is a *daemon-asserted* routing key, so a buggy or compromised daemon
  could assert a conversation the result does not belong to. That trust assumption is pre-existing and
  uniform across all eleven arms that carry the field — this ticket does not change who is trusted, and
  the id is inert here because the bridge drops it. The first code that acts on it is **#756**, which owns
  whether a received id is validated against the client's known conversations before routing.

**Non-finding stated explicitly to pre-empt it:** `conversationId` is **required, never optional**, so
there is no absent case. The structured-clone trap that bites *optional* IPC fields (an assigned
`undefined` survives `webContents.send` as a present own property) has no purchase here. `isError: false`
likewise stays a **value**, not an absence — AC3's second half.

**The one real risk, and its control:** adding `?? ''` or any default at the emit would convert the
decoder's fail-closed drop into a silent misattribution — a tool result resolving a call in the wrong
conversation. AC2 forbids it, #675 forbids the optional-typed variant that invites it, and the required
type makes the fallback unnecessary. It is **not** testable at the emit layer (`:1000` throws first, so
the line is unreachable on a bad id), so it is enforced by the type plus inspection. Classified SHOULD
FIX-by-construction rather than MUST FIX: the design as specified cannot reach the failure, only a
deviation from it can.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-25
