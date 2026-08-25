# #763 — carry the conversation id on the `toolUse` IPC arm

**Size:** S (2 production files, ~20 production lines, 13 compiler-named fixture adds, 3 compiler-invisible fixture adds, 4 comment/name retirements, 1 guard inversion, **0 new tests**)
**Base:** `main` at `729337f`. #751 (PR #761) and #752 (PR #762) are both **merged** — verified in `git log`, not assumed. Every citation below was re-measured against that commit by me, and the cascade was re-derived by applying the two production edits in this worktree and reverting. Anchor your edits to the **quoted text**, never to a line number.

This is the code child of the #753 split. Its sibling #764 owns the comment sites in the three files this ticket deliberately does not open.

## Design source

N/A — transport/IPC only. The change is one field on an internal `main → renderer` union arm; it renders nothing, `ThreadEvent` is untouched, and no pixel moves. There is no Figma node and the visual-fidelity check is intentionally skipped.

## Files to read first

| Path | What to extract |
|---|---|
| `src/shared/ipc/events.ts:475-497` | The `toolUse` arm and its comment block. `:475-476` is census site 1 (the arm's **own** drop-claim, which a `grep unlike toolUse` never reaches); `:490-497` is the union arm to widen. |
| `src/shared/ipc/events.ts:265-288` | The `modelAnnounced` arm. **The exemplar.** `:271-282` is the finished "routing key, not rendered text" paragraph — the reasoning your new comment should defer to rather than restate. |
| `src/main/daemonConnection.ts:885-903` | The `tool-use` emit. Census site 4 at `:886-888`; the fresh named-field literal at `:895-902` gains **one line**. This is the entire production change on this side. |
| `src/main/daemonConnection.ts:585-608` | The `assistant-delta` emit as #751 left it — the by-name-copy idiom the other arms cite. |
| `src/main/transport/inboundMessage.ts:974-985` | `parseToolUsePayload`. `requireString(payload, 'conversation_id')` at **`:978`**, returned on the literal at `:984`. **Read this before writing any decode code — there is none to write.** |
| `src/shared/wire/types.ts:681-727` | `ToolUsePayload`'s doc block and the interface at `:720-727` — `conversation_id, turn_id, tool_use_id, name, input_summary`, all required, no `omitempty`, plus optional `input`. **Unchanged by this ticket**; read it to confirm the wire order your new field placement mirrors. |
| `src/main/transport/inboundMessage.test.ts:2608-2632` | The shipped `tool_use` fail-closed describe. `:2610` iterates `conversation_id` for the missing case; `:2622` covers `conversation_id: 7` for the non-string case. **AC2 is already green here. Read this before writing a test for AC2 — you would be writing a duplicate, or worse, a vacuous one.** |
| `src/main/daemonConnection.test.ts:2874-2960` | The whole `tool_use` describe. Three `toEqual` fixtures that fail under the change, the guard at `:2900` that must invert, and a **third** `not.toContain` at `:2957` that must not. See § The three guards. |
| `src/renderer/src/store/timelineBridge.test.ts:72-158` | The adjacent-line inversion, four times over: a `DaemonEvent` input that gains the field sits ~8 lines above a `ThreadEvent` `toEqual` that must not. Also `:134`'s field-**counting** comment, which stays at five. |
| `src/renderer/src/store/timelineBridge.ts:47-60` | `translateTimelineEvent`'s `toolUse` case — where the id stops. **Do not change it.** Its `:48-49` comment goes false but is **#764's**, not yours. |
| `src/renderer/src/store/threadTimeline.ts:103-121` | The `ThreadEvent` `toolUse` arm. **Do not change it.** `:103-104` also goes false and is also #764's. |
| `src/main/emitDaemonEvent.ts:36-46` | `webContents.send`, log-free by construction — the basis for the security review's "reaches no log sink" claim, and for **structured clone, not `JSON.stringify`** (§ Explicit non-goal). |

`docs/lessons.md` does not exist in this repo. Knowledge docs under `docs/knowledge/` mention `toolUse` but are owned by the documentation phase — **do not edit them, and do not write a knowledge-base note.**

## Context

`ToolUsePayload` carries `conversation_id` on the wire (`src/shared/wire/types.ts:720-727`) and the decoder already validates it, but the emit throws it away. The renderer is moving to one timeline per conversation (#675), and a tool call that cannot be attributed renders as a row in the wrong thread.

This is the third of four turn-stream arms to be widened: `assistantDelta` (#751) and `turnEnd` (#752) have landed; `toolResult` (#754) follows. The design is fully determined by those precedents plus `turnState` (#724), `stallDetected` (#732) and `apiRetry`/`compacting` (#742). **This spec's value is not the design — it is the measured cascade and the four compiler-blind regressions below.**

## Design

### Production change — 2 files, and that is all

**1. `src/shared/ipc/events.ts`** — add the field to the arm at `:490-497`:

```ts
| { type: 'toolUse'; conversationId: string; turnId: string; /* …existing five… */ }
```

Required, never optional. An optional routing key invites the `?? activeConversation` fallback that #675 exists to remove. Place it **first**, matching the wire order (`conversation_id, turn_id, tool_use_id, …`) and the shipped `backgroundTaskStarted` arm at `:314-322`.

**2. `src/main/daemonConnection.ts:895-902`** — add one line to the existing fresh literal, reading the id **bare**:

```ts
conversationId: inbound.toolUse.conversation_id
```

Copied **by name** onto the existing literal — never a spread of `inbound.toolUse`, so a decoder that later grows a field cannot smuggle it across IPC. No `?? ''`, no `?? activeConversation`, no placeholder. The `input` line at `:901` is untouched and keeps crossing by reference.

That is the whole production change: two added lines, plus the comment work below.

### There is no decode change — do not write one

`parseToolUsePayload` (`inboundMessage.ts:974-985`) **already** does `requireString(payload, 'conversation_id')` at `:978` and returns it on the literal at `:984`. A missing or non-string `conversation_id` already throws `WireDecodeError` and drops the whole frame before any emit runs. **Zero decode lines** — the same finding that held for #751, #752 and every sub-state arm before them. This is now the fourth consecutive arm where it holds; assume it for #754 too and verify rather than re-derive.

### Comment rewrites — four sites, kept tight

Two blocks state the field count and the drop; two one-line contrasts elsewhere reference toolUse's drop by name. All four are tabled in § The AC3 census.

For the two blocks you rewrite (`events.ts:475-476`, `daemonConnection.ts:886-888`):

- State that the id is a daemon-asserted **routing key**, not rendered text — none of the untrusted-text warnings that attach to `name` / `inputSummary` / the `input` map's keys and values attach to it, and it reaches no log sink.
- State the by-name copy and the bare read, and that the decode needed no change.
- **Defer** to `modelAnnounced`'s finished paragraph (`events.ts:271-282`) for the full routing-key reasoning rather than restating it. Aim ~4-6 added lines per site; wrap at **≤108 columns** to match the surrounding blocks. Two near-identical long blocks in one file is worse writing, and every line added shifts the citations discussed in § Citation drift.
- The `daemonConnection.ts` block may say the id is read bare **because** the decode already guarantees it. It may **not** claim the emit is what makes the line fail closed — see § AC2 below for why that claim would be unpinnable.

## AC2 is already green on `main` — write no test for it

The ticket body flags this and the probe confirms it. Spelling it out because #752's review caught a spec overstating exactly this one arm over.

`parseToolUsePayload:978` throws first, so **a `?? ''` at the emit is unreachable for any input a test can supply** — the suite stays green whether or not it is there. Grade a guard by asking *which mutation makes it red*; for an emit-site `?? ''` on this arm, none does.

Both halves of AC2 are already pinned by shipped tests you must not duplicate:

| AC2 half | Shipped test | Line |
|---|---|---|
| `conversation_id` missing | `it('throws when any single field is absent (never a partial)')` — the loop iterates `conversation_id` first | `inboundMessage.test.ts:2609-2614` |
| `conversation_id` not a string | `it('throws when any single field is a non-string …')` — `{ ...TOOL_USE, conversation_id: 7 }` | `inboundMessage.test.ts:2616-2626`, the case at `:2622` |

So:

- **Write zero new tests for AC2.** It is a regression guard that already exists and already passes. Confirm both tests still pass; that is the entire obligation.
- **Do not write an emit-layer test that claims to prove fail-closedness.** It would be vacuous — no mutation of your code makes it red.
- The ban on `?? ''` in AC1 is an **inspection** criterion for code-review, not a test obligation.

## The AC3 census — five production sites, three test sites

`tsc` reaches **none** of these. `vitest` reaches exactly one, and only on a second run (§ The ordering trap).

### Production — both files this ticket already opens

| # | Site | Current text | What goes false |
|---|---|---|---|
| 1 | `events.ts:475-476` | *"Carries the **five render fields** (`conversation_id` **dropped at the emit**, single active conversation)."* | The arm's **own** comment — count and drop-claim both invert. A `grep 'unlike toolUse'` never reaches this one. |
| 2 | `events.ts:292` | *"Carries `conversationId` — **unlike toolUse, which drops it**."* (`backgroundTaskStarted`) | toolUse carries it too after this change. Rewrite the contrast, do not delete the sentence's point. |
| 3 | `events.ts:506` | *"Carries `conversationId` (**unlike toolUse, which drops it**) because the snapshot is REPLACEMENT-truth…"* (`queueState`) | Same claim, queueState's copy. |
| 4 | `daemonConnection.ts:886-888` | *"`conversation_id` is **DROPPED** (single active conversation; #202's bridge scopes identity). A fresh literal with the **five named fields**…"* | Both halves. |
| 5 | `daemonConnection.ts:920-921` | *"…the already-narrowed backlog by reference — **unlike toolUse this KEEPS conversation_id**…"* | The `daemonConnection.ts` twin of site 3. |

Sites 2, 3 and 5 are one-line contrast repairs, not rewrites. `assistantDelta` / `turnEnd` / the sub-state arms all carry the id now, so the honest replacement contrast is with **`toolResult`**, which still drops it until #754 — or drop the contrast entirely and state the reason positively. Either is fine; do not leave a stale "unlike toolUse".

### Tests — none reachable by the compiler

| # | Site | What goes false |
|---|---|---|
| 6 | `daemonConnection.test.ts:2874` | Test **name**: *"…one toolUse carrying **the four camelCase fields (conversation_id dropped)**"* — count and parenthetical both invert. #752's twin rename (`git show 335e5ab`) is the model. |
| 7 | `daemonConnection.test.ts:2899-2900` | The comment *"conversation_id is dropped at the choke point…"* **plus the executable guard below it**, `expect(JSON.stringify(events)).not.toContain('conv-1')`, which must **invert** to `toContain`. |
| 8 | `timelineBridge.test.ts:72` | Test **name**: *"toolUse → a ThreadEvent toolUse with **the same fields**, a fresh object"* — the input gains the field, the output must not, so "the same fields" stops being true. **The body of that test is correct and must keep passing**; only the name is wrong. |

Rename site 8 so it states the id **stops here** — the wording #752 landed at `timelineBridge.test.ts:50` is the model.

### The ordering trap — measured, not projected

Sites 6 and 7 are in the same test, and I confirmed by running it: the failure surfaces at **`daemonConnection.test.ts:2890`** (the `toEqual`), which throws **before** `:2900` ever executes. A developer who fixes the fixture at `:2891-2897`, re-runs, and sees that test go green **has not run `:2900` yet** — it fails on the *next* run as a fresh, surprising failure.

**Fix `:2891-2897` and `:2900` in one edit**, then confirm the inverted guard actually executed rather than reading a green suite as proof. This is the trap #752 documented and #753's split re-confirmed.

## Sites that must NOT be swept — they stay true

The drop-claim is worded near-identically on two other arms **in the same two files**, and it is a comment *template*, not a one-off. A grep for `conversation_id is DROPPED`, `dropped at the emit`, `conversation_id dropped` or `not.toContain('conv-1')` returns **more hits than this ticket owns**. Match on the **arm**, never on the phrase.

**The `toolResult` arm — #754's, still true after this ticket:**

| Site | Text that stays |
|---|---|
| `events.ts:498` | *"The tool-result arm (#229). Carries the four render fields (`conversation_id` dropped at the emit)."* |
| `daemonConnection.ts:905` | *"`conversation_id` is DROPPED (single active conversation; #202's bridge scopes identity)."* |
| `daemonConnection.test.ts:2992` | Test name *"…one toolResult carrying the four camelCase fields (conversation_id dropped)"*. |
| `daemonConnection.test.ts:3017-3018` | The comment **and** its `not.toContain('conv-1')` guard — this one must **not** invert. |
| `timelineBridge.test.ts:160` | Test name *"toolResult → a ThreadEvent toolResult with **the same fields**, a fresh object"* — the same wording as site 8, which *does* change. |

**The `unrecognizedMessage` arm — not part of this work at all, still true:**

| Site | Text that stays |
|---|---|
| `events.ts:422` | *"`conversation_id` is dropped at the emit (single active conversation)."* |
| `daemonConnection.ts:832` | *"`conversation_id` is DROPPED (never referenced — single active conversation)."* |
| `daemonConnection.test.ts:2479` | Test name *"…carrying the four display fields, **dropping conversation_id**"*. |
| `daemonConnection.test.ts:2495-2496` | The comment **and** its `not.toContain('conv-1')` guard — must **not** invert. |

**Also unchanged:**

- `events.ts:437` — *"Only `previous_session_id` is dropped at the emit (#285)"*. A different field on `sessionTransition`; it matches a loose `dropped at the emit` grep and is unrelated.
- `inboundMessage.test.ts:3984` — a fourth `not.toContain('conv-1')`, on `lines[0]` in the **`conversations` log** content-free test. It matches the guard grep and is entirely unrelated. Do not touch it.
- `inboundMessage.test.ts:2588`, `:2595`, `:2610` — *"all five fields"* / *"the five known tool_use fields"* / the `for (const field of ['conversation_id', …])` list. These count the **wire** type `ToolUsePayload`, which this ticket does not touch. **Still true**, and `:2610` is AC2's shipped guard — leave it exactly as it is.
- `inboundMessage.ts:218-219`, `threadTimeline.ts:103-104`, `timelineBridge.ts:48-49` — these three *do* go false, and they are **#764's**, deliberately out of scope so this ticket stays at two production files. **Do not touch them.**

**The `field-for-field` contrapositive, disambiguated.** A comment asserting the shapes are *"field-for-field identical"* over a type that must not gain the field encodes the drop-claim as firmly as one naming `conversation_id` — so `rg -i "field-for-field"` is worth running. It returns ~20 hits, and the rule that sorts them is clean: **every hit inside `src/shared/wire/types.ts` means wire↔daemon identity** (including `:682` for `tool_use` itself), all unchanged and all still true. The only two hits meaning **`DaemonEvent`↔`ThreadEvent`** identity are `timelineBridge.ts:48-49` and `threadTimeline.ts:103-104` — and both are #764's, not yours. Net result for this ticket: **zero `field-for-field` edits.**

### The three guards, and only one inverts

Inside `daemonConnection.test.ts` the `tool_use` and neighbouring describes hold three structurally identical leak guards. Blind-inverting all of them silently guts two shipped AC checks while `tsc` stays silent:

| Line | Arm | Action |
|---|---|---|
| `:2496` | `unrecognizedMessage` | **leave** |
| `:2900` | `toolUse` | **invert to `toContain`** |
| `:3018` | `toolResult` | **leave** |

And a **fourth** `not.toContain` sits inside the very block you edit — `daemonConnection.test.ts:2959`, `expect(JSON.stringify(events)).not.toContain('"input"')`, closing the ABSENT-`input` test that starts at `:2931`. It has nothing to do with the conversation id and must **stay**. Adding `conversationId: 'conv-1'` to that test's fixture does not disturb it (`"conv-1"` does not contain `"input"`).

When you invert `:2900`, replace its comment with one saying the id must reach the renderer **verbatim** — never dropped, never defaulted.

## The measured cascade — I ran it

I applied both production edits in this worktree, ran both `tsc` halves and the full `vitest` suite, and reverted. The tree is clean. Results reproduce the ticket body exactly, file-for-file and line-for-line.

**`tsc --noEmit -p tsconfig.node.json` → ZERO errors.** The node half is clean. `npm run typecheck` chains the two halves with `&&`, so it runs straight past node and reports only the web errors — do not read a passing node half as progress.

**`tsc --noEmit -p tsconfig.web.json` → exactly 13 errors**, every one `Property 'conversationId' is missing`. These are one-token fixture adds and the compiler names every one:

| File | Lines |
|---|---|
| `src/renderer/src/store/timelineBridge.test.ts` | `73`, `97`, `125`, `147`, `536`, `564`, `579`, `596`, `623` |
| `src/renderer/src/screens/conversation/interactiveRoundtrip.test.tsx` | `48` |
| `src/renderer/src/store/daemonEventBridge.test.ts` | `132` |
| `src/renderer/src/store/modalBridge.test.ts` | `121` |
| `src/renderer/src/store/pushNotifyBridge.test.ts` | `172` |

**`vitest run` → exactly 3 failures, all compiler-invisible**, all in the `tool_use` describe of `src/main/daemonConnection.test.ts`:

| Reported at | Test |
|---|---|
| `:2890` | *"decodes an inbound tool_use into one toolUse carrying the four camelCase fields…"* — fixture at `:2891-2897` |
| `:2919` | *"carries the tool input map across to the renderer with its entries unchanged (#642)"* — fixture at `:2920-2927` |
| `:2947` | *"emits an ABSENT input when the wire omitted it — the pre-#1678 daemon (#642)"* — fixture at `:2948-2954` |

**e2e needs no change.** `e2e/tool-row-toggle.spec.ts` and `e2e/thread-scroll-pin.spec.ts` build `ToolUsePayload` — the **wire** type, unchanged. Neither `tsconfig.node.json` nor `tsconfig.web.json` includes `e2e/`, so `npm run typecheck` never reaches them anyway. Discriminate by which union a fixture is checked against, never by the spelling `toolUse` / `tool_use`.

**Nothing else in `src/` is affected.** Ten further files mention `toolUse` (`ConversationScreen.tsx`, `toolHeadline.ts`, `backgroundTaskRosterStore.*`, `modalPrompts.test.ts`, `daemonEventBridge.ts`, `modalBridge.ts`, `timelineBridge.ts`, `threadTimeline.ts`, `inboundMessage.*`, `wire/types.test.ts`). They reference `ThreadItem` / `ThreadEvent` / the wire type / an arm label, not the `DaemonEvent` literal — proven by the node half being clean and the web half naming its 13 sites exhaustively.

## Fixture classification — by which union each is typed as

**Gains the field** (`DaemonEvent`-typed): the 13 compiler-named sites above, plus the 3 vitest-named fixtures. Sixteen in total, every one pre-enumerated.

**Must NOT gain it** (`ThreadEvent`-typed — and `tsc` is silent either way, so a blind sweep corrupts these with no signal):

| Site | Why |
|---|---|
| `timelineBridge.test.ts:81-87`, `:106-113`, `:135-141` | The three `toolUse` `toEqual` expectations. `toEqual` is exact, so each **fails if the id leaks through the bridge** — they are the executable proof of AC4. Keep them exact. |
| `timelineBridge.test.ts:134` | The comment *"The other five fields are unchanged"*, sitting directly above `:135-141`. It counts **`ThreadEvent`** fields, which do not change. **Stays at five** while its neighbours increment — the one field-counting comment in this file that must not be touched. |
| `threadTimeline.test.ts:23`, `:38` | Builder functions returning `ThreadEvent`. |
| `threadTimeline.ts:115` | The `ThreadEvent` `toolUse` arm itself. |

> **The adjacent-line inversion, four times over.** In `timelineBridge.test.ts` a `const event: DaemonEvent` that **must gain** the field sits roughly eight lines above a `ThreadEvent` `toEqual` that **must not**: `:73`→`:81`, `:97`→`:106`, `:125`→`:135`, `:147`→(no literal; `:157` asserts only on `translated.input`). Edit by the compiler's line numbers, **never** with `replace_all` across this file.

A cheap re-derivation without re-running the probe: `rg -c "type: 'toolUse'" src/renderer/src/store/timelineBridge.test.ts` returns **15** = 9 `DaemonEvent` fixtures that gain + 3 `toEqual` expectations that must not + 3 `Extract<ThreadEvent, …>` casts at `:105`, `:132`, `:155` that are neither.

**`pushNotifyBridge.test.ts:172` is safe to extend.** It is an inline fixture in a test whose only assertion is `expect(sendCommand).not.toHaveBeenCalled()` at `:174`. Use `conversationId: 'conv-1'`, matching the `turnState` fixture two lines above it. The file's three `not.toContain('XYZ')` leak guards (`:116`, `:128`, `:187`) are in **other** tests and read the module-level `turnEnd` / modal fixtures at `:28-55` — **do not touch those fixtures.**

## State + concurrency model

None added. The emit is stateless and un-coalesced: N frames produce N events in arrival order. The added field brings **no** per-id buffer, dedup, last-seq memo, or ordering check. No new async task, timer, listener, `AbortController`, or teardown path. `emitDaemonEvent` is a synchronous `webContents.send`.

## Error handling

| Failure | Where caught | Result |
|---|---|---|
| `conversation_id` missing | `parseToolUsePayload` → `requireString` (`inboundMessage.ts:978`) | `WireDecodeError`, whole frame dropped, **nothing emitted** |
| `conversation_id` non-string | same | same |
| payload not an object | `inboundMessage.ts:975-977` | `WireDecodeError('malformed tool_use payload')` |

All three are pre-existing and covered by `inboundMessage.test.ts:2608-2632`. Nothing surfaces to the UI: a dropped frame is silent by design — a missing tool row is better than a misattributed one. `WireDecodeError` messages name the failure **category** only and interpolate no field value (deliberate: `input_summary` could echo tool content).

## Testing strategy

Unit only (`npm test`, vitest). No e2e change. **No new test files, and no new tests.**

**Modified — `src/main/daemonConnection.test.ts`:**

- `:2874` — rename (census 6): the arm carries five camelCase fields now, conversation id included.
- `:2891-2897`, `:2920-2927`, `:2948-2954` — add `conversationId: 'conv-1'` to each `toEqual` fixture. All three source frames already send `conversation_id: 'conv-1'`.
- `:2899-2900` — rewrite the comment and **invert** the guard to `toContain('conv-1')`. Do this in the **same edit** as `:2891-2897` (§ The ordering trap).
- `:2959`'s `not.toContain('"input"')` — **leave it.**

**Modified — `src/renderer/src/store/timelineBridge.test.ts`:**

- `:72` — rename (census 8) so it says the id **stops here**.
- `:73`, `:97`, `:125`, `:147`, `:536`, `:564`, `:579`, `:596`, `:623` — one-token adds, all named by `tsc`.
- `:81-87`, `:106-113`, `:135-141`, `:134` — **do not touch.**

**Modified — one-token adds, each named by `tsc`:** `interactiveRoundtrip.test.tsx:48`, `daemonEventBridge.test.ts:132`, `modalBridge.test.ts:121`, `pushNotifyBridge.test.ts:172`.

**What proves each AC:**

| AC | Proof |
|---|---|
| 1 | `daemonConnection.test.ts:2891-2897` (the field arrives) + the inverted `:2900` (verbatim, never defaulted). The `?? ''` ban is an **inspection** criterion — see § AC2. |
| 2 | **Already green.** `inboundMessage.test.ts:2609-2614` and `:2616-2626`. Confirm they still pass; write nothing. |
| 3 | Inspection against the two census tables; the inverted `:2900` is the one executable part. |
| 4 | `timelineBridge.test.ts`'s three `toEqual` expectations, which must pass **unchanged**. |
| 5 | The two `input` tests at `:2919` and `:2947` still passing, plus `timelineBridge.test.ts:118`'s `toBe(input)` reference check. Inspection for the no-spread rule. |

**Gates:** `npm run build` (both `tsc` halves, then the electron-vite build) and `npm test`.

> **Known unrelated flake.** A full `vitest run` on a clean tree intermittently fails `src/main/transport/fakeRelayForwarder.test.ts` → *"rejects a pending whenReady() when close() runs before both legs connect"* with `Parse Error: Expected HTTP/, RTSP/ or ICE/`. Documented in #752's spec and reproduced there; the file passes 8/8 in isolation. It did **not** fire during this ticket's probe run (144 files passed, 1 failed — `daemonConnection.test.ts`, expected). Re-run any such file in isolation before treating a failure as yours.

## Explicit non-goals — flagged so they are neither fixed nor copied

**1. The `structured clone` wart at `daemonConnection.ts:893-894`,** inside the very block you edit. It says an absent `input` is *"`undefined` … which structured clone and JSON.stringify both drop."* **The structured-clone half is false** — `emitDaemonEvent` sends over `webContents.send`, which structured-clones, and an assigned `undefined` survives as a *present own property*. That is exactly why the arm's contract says to test `event.input === undefined` and never `'input' in event`. It is a pre-existing wart about `input`, not about the conversation id: **do not fix it here**, and **do not restate the claim** in the comment you write. It is named only so code-review does not read it as collateral damage.

**2. The stale `events.ts:<line>` citations.** Growing the `events.ts` block shifts every line below it, and comments across several files cite absolute `events.ts:<line>` numbers. **Those citations are already stale on `main` today** — `threadTimeline.ts:103` cites `events.ts:384-391` for the `toolUse` arm, which now lives at `:490-497`. #751 and #752 both grew this block and shipped without repairing them. Repairing here would pull four more production files in and trip the ≥5-file gate. **Out of scope**, and it wants one sweep rather than a fragment per widening. Two consequences: keep the new `events.ts` block **short**, and **do not write a new absolute `events.ts:<line>` into any comment you add** — refer to arms by name.

**3. `inboundMessage.ts:218-219`, `threadTimeline.ts:103-104`, `timelineBridge.ts:48-49`** — three comments that go false under this change and are **#764's** by design. Leaving them stale for one merge window is the deliberate cost of keeping this ticket at two production files.

## Note for #754 (`toolResult`) — a re-measure obligation, not a dependency

The `toolUse` and `toolResult` blocks are **adjacent with no unchanged lines between them** in both production files: `events.ts:475-497` runs straight into `:498`, and `daemonConnection.ts:886-903` into `:905`. This ticket's edit shifts #754's anchors.

That is **not** a blocker: nothing here creates or deletes #754's seam, and WIP=1 serialises them. The blocker test is *"does A create or delete B's seam?"* — a shared file plus a line shift alone is not one. #754 must re-measure against the merged result rather than trusting its own body's numbers. This is already commented on #754.

## Open questions

None blocking. One standing PO follow-up, already carried by #764 for this arm's share: the repo-wide `events.ts:<line>` citation sweep is best filed once #754 has landed and the block stops moving.

## Scope self-check

Production source files (`*.ts` / `*.tsx`, excluding `*.test.*` and `*.md`) this spec prescribes changes to: **2** — `src/shared/ipc/events.ts` and `src/main/daemonConnection.ts`. Both modified, neither created. Under the ≥5 gate.

New exported types, components, or interfaces: **0**. New error/reject branches: **0**. Acceptance criteria: **5**. Total written work: ~20 production lines plus ~35 lines of fixture and comment edits across 6 test files — well under the 600-line ceiling.

**On the 16 forced edit sites, which sit above the 10-call-site red line.** That red line is **ruled inapplicable here**, per the ruling made during the #753 split:

- The ceiling's prescribed remedy is Strangler Fig — introduce the new alongside the old, migrate consumers, remove the old. Its only union-field equivalent is *land the field optional, tighten it later*, and that is **banned by name upstream** in #675, because an optional routing key invites the `?? activeConversation` fallback that is the exact bug being removed. A red line whose only escape hatch is forbidden upstream is not a split signal.
- The ceiling exists to bound a developer's **discovery** cost in a refactor. Here every site is a one-token fixture add, and all 16 are pre-enumerated by file and line above — 13 by the compiler, 3 by the probe. Discovery cost is zero.
- The real hazard is AC4's **compiler-blind must-not-gain** set, which is why it carries its own acceptance criterion and its own section here.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The design adds no boundary and moves none. The single untrusted→trusted crossing for this frame is `parseToolUsePayload` (`inboundMessage.ts:974-985`), which is fail-closed and **unchanged**: `requireString` at `:978` rejects a missing or non-string `conversation_id` and drops the entire frame before any emit — pinned by `inboundMessage.test.ts:2609-2614` and `:2616-2626`, both of which this ticket must leave intact. Downstream code holds the narrowed `ToolUsePayload` type only. The main→renderer IPC leg carries an already-validated value copied **by name** onto a fresh literal — never a spread — so a decoder that later grows a field cannot smuggle it across. Direction matters: this is main→renderer, the trusted→untrusted direction; it grants the renderer no capability and accepts nothing from it.
- **[Tokens, secrets, credentials]** No findings. `conversation_id` is a daemon-asserted **routing key**, not a credential: it authorises nothing, is compared against no secret, and authenticates nothing. It already crosses this same IPC channel on six other arms (`assistantDelta` #751, `turnEnd` #752, `turnState` #724, `stallDetected` #732, `apiRetry`/`compacting` #742, `modelAnnounced` #588) and on `queueState` / `backgroundTaskStarted`. `ToolUsePayload` holds five bounded strings plus an already-narrowed string→string map; `InnerFrameV2`, `QrPayload` and `HelloClientPayload` are not reachable from it, so no token, key, or raw frame can ride the widened arm. Nothing about token lifecycle, storage, rotation or revocation is touched.
- **[File / storage operations]** Not applicable, and verified rather than asserted: the id reaches no filesystem path, no cache key, and no lookup path, and nothing on this leg persists. `emitDaemonEvent` (`emitDaemonEvent.ts:43-46`) is an in-memory `webContents.send`. No `path.join`, no `fs` call, no `safeStorage` call, and no renderer-side `localStorage` / IndexedDB write is added or reached. The spec bans using the id as a filename, cache key or lookup path explicitly (§ Design).
- **[Inter-process / Electron attack surface]** No findings. No new `contextBridge` API, no new `ipcMain.handle` / `.on` channel, no `webPreferences` change, no custom protocol or deep-link handler, no navigation or `setWindowOpenHandler` change, no remote content loaded anywhere. The change is one field on an existing arm of an existing union on the existing `DAEMON_EVENT_CHANNEL`. The renderer's inbound surface is a discriminated union it already subscribes to; it gains one `string` it does not yet act on — `timelineBridge.ts:47-60` rebuilds a fresh `ThreadEvent` from named fields and `ThreadEvent` carries no conversation id, so the id **stops at the bridge**, proved executably by three exact `toEqual` expectations (AC4). Process placement is unchanged: transport, keys and the Noise handshake stay in main; nothing moves renderer-ward.
- **[Cryptographic primitives]** Not applicable. No RNG, no hashing, no key derivation, and no comparison of any value against a secret (so no `timingSafeEqual` need). The Noise session, its per-direction nonce counters, and its AEAD framing are untouched — this ticket does not modify `src/main/transport/` at all, only reads `inboundMessage.ts` to confirm the decoder needs no change.
- **[Network & I/O]** No findings. No socket, connect/idle timeout, TLS setting, `maxPayload`, relay-URL validation, backoff or reconnect path is touched. Frame handling is unchanged — the same frames are decoded by the same decoder, and one already-decoded field is now forwarded. A hostile **relay** gains nothing: it is content-blind, cannot reach inside the Noise session, and cannot forge a `conversation_id` without breaking it. A hostile **daemon** supplying a well-formed but attacker-chosen id produces at worst an event filed under an id no timeline holds — a dropped update, not a corruption, and only once #756 wires routing. No unbounded growth is introduced: the emit holds no per-id state (§ State + concurrency).
- **[Error messages, logs, telemetry]** No findings, and this one needed checking rather than asserting. `emitDaemonEvent` is log-free by construction (`emitDaemonEvent.ts:40-41`), so the id reaches no sink on the IPC leg. The decode-side `tool_use` diagnostic (`inboundMessage.ts:1550-1555`) emits only `{ event, code: 'tool_use', bytes, hash }` — content-free, deliberately excluding even the `input` map's *keys* because an MCP tool can name a field anything. It is pinned as content-free by `inboundMessage.test.ts:3758` ("logs a tool_use content-free, never a decoded field"), which this ticket does not touch and must not break. `WireDecodeError` messages name the failure category only and interpolate no field value. Nothing new reaches the renderer DevTools console.
- **[Concurrency]** No findings. The emit is synchronous and stateless — no new async task, `setTimeout` / `setInterval`, listener, `AbortController`, or teardown path, and no shared state read-then-mutated across an `await`. Explicitly pinned in § State + concurrency: the added field brings no per-id buffer, dedup, last-seq memo, or ordering check, so no check-then-act race is introduced. Shutdown and duplicate-connection behaviour are unchanged.
- **[Threat model alignment]** Addressed. *Malicious / compromised relay:* content-blind and on-path only; it can drop, delay, reorder or flood, none of which this change affects. *Hostile daemon response:* covered by the unchanged fail-closed decode — a malformed `conversation_id` drops the frame before the emit. *Renderer compromise reaching the transport:* unchanged — this leg is outbound to the renderer and exposes no new capability. *Token theft from disk:* not applicable; nothing is persisted. **Explicitly out of scope:** what a consumer *does* with the id once it routes on it — collision handling, spoofed-id targeting, and unbounded per-id state are #756's concern, and the `toolResult` arm (#754) carries its own review.
- **[Deliberate non-hardening — called out so code-review does not read it as an omission]** The emit reads `inbound.toolUse.conversation_id` **bare**, with no `??` fallback and no re-validation. That is the security-relevant choice, not an oversight: re-validating would be redundant with `:978`, and a fallback would convert a fail-closed drop into a silent **misattribution** — the exact bug this work exists to remove. Note the consequence honestly: because `:978` throws first, **no test can make an emit-site `?? ''` red**, so this is enforced by code-review inspection (AC1) rather than by the suite. The spec says so rather than shipping a guard whose comment claims a layer it cannot pin — the finding #752's review surfaced.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-25
