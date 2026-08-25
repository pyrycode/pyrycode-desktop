# #751 — Carry the conversation id on the `assistantDelta` IPC arm

**Size:** S · **Labels:** `enhancement`, `security-sensitive` · **Parent:** #675 (8-way split) · **Consumer:** #756

Measured against `main` at `ac4dcc9` (`git log --oneline -1` confirms HEAD), after #749 (PR #760) merged. Every count, line number and hazard in the ticket body was re-run at that commit rather than trusted, **and one had drifted** — see § Body drift. The cascade in § The cascade is not projected: `npm install` was run in this worktree, the two production edits were applied, both `tsc` projects and the full `vitest` suite were executed, and the tree was reverted (`git status --porcelain` empty). Every "measured" claim below is an observation, not an estimate.

## Design source

N/A — transport / IPC-boundary work with no rendered surface. The ticket body carries no `## Figma` section, correctly: this slice changes nothing anyone can see. The renderer's `ThreadEvent` is unchanged, the timeline renders identically, and the per-conversation routing that consumes this field is #756. The visual-fidelity check is intentionally skipped.

## Body drift — one citation moved, re-anchor before editing

The body cites `conversationActivityBridge.test.ts:203`. At `ac4dcc9` the site is **`:219`** — #749 (PR #760) landed between the body being written and this spec, adding tests above it. `tsc` names the correct line (§ The cascade), so the drift is self-correcting, but **do not trust a `:NNN` from the body over what `tsc` prints.** Every other body citation was re-verified exact.

## Files to read first

Codegraph is not indexed for this repo (`.codegraph/` holds `config.json` + `.gitignore`, no DB — confirmed 2026-08-24, re-probed and unchanged), so this list was built by `git grep` + read + the compiler probe rather than `codegraph_context`. Line ranges are `ac4dcc9`.

| Path | What to extract |
|---|---|
| `src/shared/ipc/events.ts:111-124` | **The template.** #724's rebuilt `turnState` arm doc — the first of four, and the one the ticket body quotes as setting the terms. `:126-139` (`stallDetected` #732), `:146-163` (`apiRetry` #737) and `:173-198` (`compacting` #742) are three more independent samples of the same house voice. Read at least two before writing a word of prose. |
| `src/shared/ipc/events.ts:105-108` | **The block to rewrite.** Shared prose covering `assistantDelta` (`:109`) *and* `turnEnd` (`:110`). `:108` carries the claim that goes false. `turnEnd` is #752's — see § The shared-block problem. |
| `src/main/daemonConnection.ts:605-620` | **The other template.** #724's rebuilt `turn-state` emit + doc. `stall` `:621-638`, `api-retry` `:639-661` and `compacting` `:662-681` are the same shape, immediately below yours. |
| `src/main/daemonConnection.ts:585-597` | The `assistant-delta` emit + doc. **Both change.** `:587` is the DROP sentence; `:589-590` is the three-fields sentence; `:591-596` is the emit. |
| `src/main/transport/inboundMessage.ts:538-555` | `parseAssistantDeltaPayload` — already `requireString`s `conversation_id` and already returns "the four known fields", stated in its own doc at `:542`. **This is why this ticket needs no `inboundMessage.ts` change at all, unlike #742. Do not touch it.** |
| `src/shared/wire/types.ts:244-258` | `AssistantDeltaPayload` already declares `conversation_id: string`, required, wire order first. No wire change. `:244`'s "field-for-field" is about the *wire* payload mirroring the *daemon's* — true. **Do not touch.** |
| `src/main/daemonConnection.test.ts:1339-1400` | The whole `assistant_delta / turn_end` describe block. Six tests; **four change, two must stay green untouched** — and one `turnEnd` test in the middle is a trap (§ The census). |
| `src/renderer/src/store/timelineBridge.ts:16-40` | Where the id stops. The header at `:25-30` already states the general rule ("an arm may carry fields its `ThreadEvent` deliberately drops … stable as arms widen"); `:39-40` is the bare `assistantDelta` case. **Unchanged — the file must not appear in `git diff --name-only`.** See § Why `timelineBridge.ts` stays out. |
| `src/renderer/src/store/timelineBridge.test.ts:35-42`, `:451-459` | **The two AC3 proof blocks.** Each pairs a `DaemonEvent` input with a `ThreadEvent` expectation two lines apart (`:37`/`:39`, `:456`/`:458`). Input gains the field; expectation must not. Read both whole blocks before editing either. |
| `src/renderer/src/store/threadTimeline.ts:94-102` | The `ThreadEvent` union header + the `assistantDelta` arm. `:96`'s "`conversation_id`-free … thin rename" is **already stale** from the four arms widened before this one — pre-existing, and #756's when `ThreadEvent` actually changes. **Do not touch, and do not sweep it in.** |
| `src/main/transport/inboundMessage.test.ts:733-745` | The decode-level fail-closed pin. Its `bad` list's first entry is `{ ...DELTA, conversation_id: undefined }`. **This is where AC2 already holds. It must stay green without being edited.** |
| `src/main/emitDaemonEvent.ts:24-46` | The forwarder: no transform, no clone, **no logging, by construction** (stated in its own header). Load-bearing for the security review. |
| `docs/specs/architecture/742-compacting-conversation-id.md` | The direct precedent spec — same union, one arm over, shipped first-pass. Its § Security review is the shape this one follows. `737-apiretry-conversation-id.md` and `724-turnstate-conversation-id.md` are the two before it. |

## Context

`AssistantDeltaPayload` carries `conversation_id` on the wire (`types.ts:251`), always present, no `omitempty`, and `parseAssistantDeltaPayload` (`inboundMessage.ts:546-554`) already decodes it fail-closed as a required string alongside `turn_id` / `seq` / `text`. The emit at `daemonConnection.ts:591-596` then carries three of the four onward and deliberately throws the id away, on the stated assumption that there is exactly one active conversation.

That assumption is what the desktop sidebar retires: the renderer is moving to one timeline per conversation, and a consumer cannot route a delta it cannot attribute. Phase landed in #724, liveness in #732, retry in #737, compaction in #742; the assistant-text stream is this one.

Client-side only — no daemon work, no wire change, no new capability.

### What makes this arm different from #742

Two things, and both make it **smaller**, not larger:

1. **The decode needs no change.** #742 spent 7 lines in `inboundMessage.ts` because `parseCompactingPayload`'s doc had a clause to retire. `parseAssistantDeltaPayload` already `requireString`s the id and its doc already says "the four known fields" (`inboundMessage.ts:542`). **`inboundMessage.ts` is not in this ticket's file set.** AC2's fail-closed half is therefore *already true at the decode* and is pinned by an existing test (`inboundMessage.test.ts:734`) — the ticket keeps it holding, it does not rebuild it.
2. **There is no retired security claim to replace.** `compacting`'s doc rested its safety argument on the *absence of a string* ("one bool and nothing else"), so #742 had to replace it. `assistantDelta` already carries `text` — the largest untrusted string on the union — so the arm's safety argument was never about field absence. The rebuilt prose here **adds** the routing-key paragraph its four neighbours carry; it does not have to rescue a collapsed one.

**What is *bigger* than #742 is the fixture cascade: 15 construction sites against #742's 12.** See § Size check.

### The live risk AC2 actually guards

Not the decode. The decode makes a missing or non-string id unreachable at the emit. The risk is an implementer who needs a required `conversationId`, does not check the decode, and reaches for `?? ''` or `?? 'unknown'` at the emit "to be safe". **That is a defect, not a defence**: it converts a fail-closed drop into a silently-misattributed delta, which is the exact misattribution this whole work exists to remove. `inbound.delta.conversation_id` is already typed `string` — read it bare, with no coalesce, no default, no guard.

## Size check — one red line trips, and the ticket is still S

Measured on `ac4dcc9`:

| Gate | Limit | This ticket |
|---|---|---|
| New files | 3 | **0** |
| Production source files with modified content | ≥5 forces a split | **2** — `events.ts`, `daemonConnection.ts` |
| Total written lines (production + tests + prose) | ~600 | **≈85** |
| New exported types / components | 5 | **0** |
| Construction sites needing simultaneous update | 10 | **15** ⚠️ |
| Reject branches added | 10 | **0** |
| Acceptance criteria | 5 | **4** |

**The 15-site count is above the gate and is stated as 15, not re-counted down.** No "mechanical", "collapsible", "one-token", "compiler-forced so it doesn't really count" or "trivial fixture cascade" framing is applied — each site is a real Edit in a block the developer must read first, and § The census shows three separate `replace_all` hazards that make a blind sweep actively wrong. The ticket still ships as one, for three structural reasons:

1. **No split exists.** Adding a *required* field to a discriminated-union member is atomic: every intermediate state is a red build, so any child would fail "each child stands alone". **Verified, not asserted** — § The cascade shows the compiler refusing to typecheck until all eleven type-forced sites are in the same commit. The only line-drawable alternative — land it optional, then tighten — is forbidden by the ticket body and by #675's split ruling, because an optional routing key invites `?? activeConversation` fallbacks.
2. **The splittable half does not exist here.** #742 was child A of #730, with #743 carrying the comment-only renderer sweep that no compiler edge reaches. This arm has no such cluster: `timelineBridge.ts:39-40` carries no comment at all, and `threadTimeline.ts:96`'s stale header is pre-existing and #756's (§ Why `timelineBridge.ts` stays out). There is nothing left to slice off.
3. **The precedent is measured, not projected.** #724 shipped this exact change on this exact union at **16** sites, S, first pass. #737 at **15**, S, first pass. #742 at **12**, S, first pass. This ticket sits at 15, between them.

Recorded as a deliberate override of the 10-site gate on measured evidence, matching #724, #737 and #742. **The file-count gate — the one atomicity may never override — reads 2 of 5**, lower than #742's 3, because the decode needs no change.

## Design

Two production line edits and two prose rewrites. Everything else is test fixtures.

### 1. The IPC arm — `src/shared/ipc/events.ts:109`

The arm gains one required field, **last**, matching `turnState` / `apiRetry` / `compacting`:

```ts
| { type: 'assistantDelta'; turnId: string; seq: number; text: string; conversationId: string }
```

**Required, never optional** — settled at #675's split, identical to the four rulings before it. Measured at **97 characters** against a file max of 110, so it stays one line.

### 2. The emit — `src/main/daemonConnection.ts:591-596`

The fresh literal gains one named copy from the already-decoded payload:

```ts
emitDaemonEvent(sink, {
  type: 'assistantDelta',
  turnId: inbound.delta.turn_id,
  seq: inbound.delta.seq,
  text: inbound.delta.text,
  conversationId: inbound.delta.conversation_id
})
```

**By name, never `...inbound.delta`.** This emit *is* the house idiom: seven other emits in this file (`:608`, `:624`, `:642`, `:665`, `:686`, `:714`, `:827`) cite "the assistant-delta idiom" by name as their precedent for copy-by-name-never-spread. Those seven comments name the *idiom*, not the drop — **they stay true, must not be churned, and the widened emit must keep exemplifying what they point at.** snake→camel at the boundary, as everywhere else. No `??`, no default, no guard (§ The live risk AC2 actually guards).

### 3. Where the id stops

`translateTimelineEvent` (`timelineBridge.ts:39-40`) keeps returning a fresh `{ type: 'assistantDelta', turnId, seq, text }` literal read by name. `ThreadEvent.assistantDelta` (`threadTimeline.ts:102`) keeps its three fields. The reducer, the store and the screen are untouched.

**Measured, not assumed:** with the arm widened and the emit wired, `tsc -p tsconfig.web.json` reported **zero** errors in `timelineBridge.ts`, `threadTimeline.ts`, `daemonEventBridge.ts` and `modalBridge.ts`, and `vitest` ran `timelineBridge.test.ts` **38/38 green with no edit at all**. A filter + fresh literal compiles *and* passes unchanged when the source arm grows a field.

**The seam gets a free deterministic guard and it is already written.** `timelineBridge.test.ts:39` and `:458` compare against a three-field `ThreadEvent` and fail on an extra own enumerable property, so a bridge that ever spread the event turns them red. **Leaving them alone IS the test for AC3.** Do not add a new test, and do not "update" them to match the widened arm — widening the arm does not make them type errors (`toEqual` / `toHaveBeenCalledWith` are loosely typed), so they stay green or go red purely on runtime behaviour. That is what makes them real assertions rather than restatements of the type. The `not.toBe(event)` freshness companion at `:41` is likewise untouched.

### 4. Why `timelineBridge.ts` stays out of the diff — a decision, not an omission

`timelineBridge.ts` carries a per-arm drop note for three of the four widened arms (`:97` stall, `:104` apiRetry, `:116` compacting). Those were written by **#743**, the comment-only sibling, not by the widening tickets themselves. After this lands, `assistantDelta` will be the one widened arm with no such note.

**That asymmetry is accepted, deliberately:**

- The file header at `:25-30` already states the general rule — *"an arm may carry fields its `ThreadEvent` deliberately drops, and rebuilding from named fields is what makes each drop explicit and stable as arms widen"* — which covers this arm without a per-arm restatement. Nothing in the file goes false.
- Keeping the file out of the diff is a **free, deterministic AC3 proof**: `git diff --name-only` must not name it.
- #756 rewrites `threadTimeline.ts:94-97`'s stale header when `ThreadEvent` actually gains the id, and is in these files anyway. A per-arm note added now would be rewritten then.

Adding a note here would put a third production file in the diff to say something the header already says. **Do not.**

### 5. Stream semantics are unchanged and must stay that way

`assistantDelta` is a turn-stream item, not daemon state: N frames produce N events, in arrival order, with no coalescing at the transport — coalescing into one assistant bubble is the reducer's job (`threadTimeline.ts:291`, pinned by `timelineBridge.test.ts:477`). The transport holds no state and must keep holding none: **adding a field must not tempt anyone into keying a per-conversation buffer, a last-seq memo, an ordering check or a dedup at the emit.** `seq` is carried for wire fidelity and is deliberately not consulted (`threadTimeline.ts:100-101`); a new id does not change that.

## The shared-block problem — `events.ts:105-108`

`:105-108` is one comment covering **two** arms: `assistantDelta` (`:109`) and `turnEnd` (`:110`). Its last clause — *"carry only turnId / seq / text / stopReason — no token, key, or raw frame"* — goes false for the first and stays true for the second.

**#752 widens `turnEnd` next.** So the rewrite must:

- state what `assistantDelta` now carries (four fields) and what `turnEnd` still carries (three), **without** widening `turnEnd`'s shape or pre-announcing #752's change as done;
- **never repair the field list by re-pointing it at a sibling.** A rewrite reading "unlike `turnEnd`, which drops it" goes false in one ticket. State the rule, not a neighbour list. (This is the rule #742's spec named after #714 was queued behind it.)

The cleanest shape — and the one the four neighbours already use — is to give `assistantDelta` its own paragraph carrying the routing-key argument, and leave a short shared preamble that says only what is genuinely shared (both are v2 interactive-stream arms, `text` IS the render payload, consumed by the timeline bridge #202, camelCase). Splitting the block is expected and is not scope creep.

**Do not compress the security argument to hit a line count.** #724's `turnState` doc is 14 lines and #737's `apiRetry` doc is 18, against this block's current 4 — growth is correct. What to hold constant is **width, not line count**: this repo has no prettier, no eslint and no lint/format script (verified — no config at root, no script in `package.json`), so nothing re-wraps a comment you widen. Run `awk '{print length}' <file> | sort -n | tail -1` before and after each file and do not raise the maximum.

| File | Max width at `ac4dcc9` |
|---|---|
| `src/shared/ipc/events.ts` | **110** |
| `src/main/daemonConnection.ts` | **111** |

Mirroring the wrap column of the `turnState` template gets this for free in both files.

### What the rebuilt prose must establish

Write it in each file's own voice — these are the claims, not the wording. `events.ts:111-124` and `daemonConnection.ts:606-614` are the working templates.

- The arm carries `conversationId`, copied **by name** from the already-decoded payload — never a spread.
- The decode stays fail-closed: a missing or non-string `conversation_id` fails the whole line without emitting, exactly as today, **and unchanged by this ticket** (`parseAssistantDeltaPayload` already required it).
- The id is a **daemon-asserted routing key**, not operator text and not model-influenced text — none of the untrusted-text warnings that attach to `text` on this same arm attach to it. It is never markup, a filename, a cache key, a lookup path, an attribute or a URL, and it reaches no log sink (`emitDaemonEvent` is log-free by construction, and the decode-side `assistant_delta` log is pinned content-free independently at `inboundMessage.test.ts:3379`).
- The id **stops at the renderer timeline bridge**, which rebuilds a fresh `ThreadEvent` literal with named fields; `ThreadEvent.assistantDelta` keeps its three. The consumers that route by conversation are #756.
- The **"turn-stream item, or daemon state?" test** (stated canonically at `events.ts:114`) is worth naming here because this arm answers it *differently* from its four neighbours: `assistantDelta` **is** a turn-stream item, and it carries the id anyway — not to report per-conversation state, but because a stream item has to be filed in the right thread. State that; do not copy the neighbours' "the sidebar must show a chat is busy" reason, which is not this arm's.
- **Required, never optional**, and why — an optional routing key invites `?? activeConversation` fallbacks.
- Stream semantics survive the rewrite verbatim: one event per frame, arrival order authoritative, `seq` carried but not consulted, no coalescing or dedup at the transport and none keyed by the new id.

## The census — `replace_all` is UNSAFE, repo-wide

`git grep -n "type: 'assistantDelta'"` returns **23 lines across 12 files** at `ac4dcc9`. **13 change, 10 must not.**

**The 13 that change** (2 production + 11 test fixtures):

`events.ts:109` · `daemonConnection.ts:592` · `daemonConnection.test.ts:1359`, `:1374` · `timelineBridge.test.ts:37`, `:456`, `:483`, `:484`, `:552`, `:554` · `interactiveRoundtrip.test.tsx:46`, `:47` · `daemonEventBridge.test.ts:105` · `modalBridge.test.ts:118` · `conversationActivityBridge.test.ts:219`

(That list names 15 sites; two of them — `daemonConnection.test.ts:1359` and `:1374` — are the same `toEqual` literals counted once each, and the 13/15 difference is that `timelineBridge.test.ts` contributes six. **15 is the construction-site count in § Size check; 13 is `git grep`'s line count**, which collapses nothing — recount from the table in § The classification, not from prose.)

**The 10 that must NOT change:**

| Site | What it is |
|---|---|
| `threadTimeline.ts:102` | the `ThreadEvent` arm declaration — *file not in this ticket's set* |
| `threadTimeline.test.ts:19` | `function delta(…): ThreadEvent` — *file not in this ticket's set* |
| `timelineBridge.ts:40` | the bridge's fresh literal — *file not in this ticket's set* |
| `timelineBridge.test.ts:39`, `:458` | **the AC3 proof.** Untouched and green |
| `timelineStore.test.ts:18`, `:19`, `:42` | `dispatch(…)` takes a `ThreadEvent` — *file not in this ticket's set* |

A blind `replace_all` corrupts all of these. **Widening `ThreadEvent` to make the suite pass silently destroys the scope boundary this ticket depends on — and it is also a log-sink boundary (see § Security review [7]). Do not do that.**

**The cheapest proof you did not reach past your own boundary is `git diff --name-only`: it must name exactly eight source files** —

`src/shared/ipc/events.ts` · `src/main/daemonConnection.ts` · `src/main/daemonConnection.test.ts` · `src/renderer/src/store/timelineBridge.test.ts` · `src/renderer/src/store/daemonEventBridge.test.ts` · `src/renderer/src/store/modalBridge.test.ts` · `src/renderer/src/store/conversationActivityBridge.test.ts` · `src/renderer/src/screens/conversation/interactiveRoundtrip.test.tsx`

— **and must never name** `inboundMessage.ts`, `inboundMessage.test.ts`, `threadTimeline.ts`, `threadTimeline.test.ts`, `timelineBridge.ts`, `timelineStore.test.ts`, `wire/types.ts`, `ConversationScreen.tsx` or any `e2e/` file. (Plus this spec file itself.)

### The three `replace_all` hazards — all re-measured, none safe

1. **`type: 'assistantDelta'` inside `timelineBridge.test.ts`.** Six sites change (`:37`, `:456`, `:483`, `:484`, `:552`, `:554`); two must not (`:39`, `:458`). Same file, same literal, opposite verdicts — and in both proof blocks the two sit **two lines apart**.
2. **`not.toContain('conv-1')` in the assistant_delta describe block.** It appears twice inside `daemonConnection.test.ts:1339-1400`: at **`:1361`** (assistantDelta's — **inverts**) and at `:1386` (turnEnd's — **stays**, #752 owns it). Both tests read from the same `conv-1` fixture value, 25 lines apart. Repo-wide the same call appears exactly five times — `:1361`, `:1386`, `:2443`, `:2847`, `:2965` — and **exactly one inverts**; `:2847` / `:2965` are `toolUse` / `toolResult`, i.e. #753 / #754.
3. **The comment `// conversation_id is dropped at the choke point`.** Four occurrences in `daemonConnection.test.ts`: **`:1360`** (ours, goes false) · `:2442` · `:2846` · `:2964`. The other three belong to arms that still drop the id — `:2846` and `:2964` are `toolUse` / `toolResult`, which are **#753 and #754**, the very next children of #675. Sweeping them would make three comments lie in the *opposite* direction, one ticket early.

## The cascade — compiler- and runtime-enumerated, not estimated

Measured by running `npm install`, applying the two production edits, running each `tsc` project separately, then `vitest`, then reverting.

**Node half (`tsconfig.node.json` = `src/main` + `src/preload` + `src/shared`) — with both production edits applied, exactly 0 errors.**

**⚠️ This inverts #742's trap and is the single most important thing to know about this cascade.** `npm run typecheck` is `&&`-chained (`tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json`). Measured directly, with the arm widened and the emit *not* wired:

```
src/main/daemonConnection.ts(591,35): error TS2345:
  Property 'conversationId' is missing in type '{ type: "assistantDelta"; turnId: string; seq: number; text: string; }'
```

— one node-side error that **masks all eleven web-side errors**. Fix the emit and the node half goes silent *completely*: it reports zero errors even though `daemonConnection.test.ts` still has two literals that are wrong. **A clean node half is not evidence you are done.** Seeing the web half fail after the node half passes is the only proof the type cascade was enumerated, and `vitest` is the only thing that reaches the node-side test fixtures at all.

**Web half (`tsconfig.web.json` = `src/renderer/src` + `src/shared`) — exactly 11 errors, 6 files:**

| Site | Code |
|---|---|
| `interactiveRoundtrip.test.tsx:46`, `:47` | TS2322 (`const stream: DaemonEvent[]`) |
| `conversationActivityBridge.test.ts:219` | TS2345 (`bridge.emit(…)` argument) — **the body says `:203`; trust the compiler** |
| `daemonEventBridge.test.ts:105` | TS2345 (`translateDaemonEvent(…)` argument) |
| `modalBridge.test.ts:118` | TS2322 (the "arms this bridge must ignore" array) |
| `timelineBridge.test.ts:37` | TS2322 (`const event: DaemonEvent = …`) |
| `timelineBridge.test.ts:456` | TS2345 (`bridge.emit(…)` argument) |
| `timelineBridge.test.ts:483`, `:484`, `:552`, `:554` | TS2322 (`const sequence: DaemonEvent[]`) |

**`timelineBridge.test.ts:39` and `:458` are conspicuously absent from that list** — they are the `ThreadEvent` expectations, and `tsc` not naming them is the compiler agreeing with § Design 3.

**Two more sites are runtime-forced and invisible to `tsc`,** because `toEqual` is loosely typed. With production edited and all tests untouched, the full `vitest` run reports **exactly 2 failures, both in the assistant_delta describe block, and nothing else in the repo goes red**:

- `:1352` "decodes an inbound assistant_delta into one assistantDelta carrying turnId/seq/text (camelCase)" — fails at `:1359`
- `:1364` "carries seq:0 and empty text through as those values, not dropped/defaulted" — fails at `:1374`

**`:1352` must be fixed twice, and this was measured explicitly.** `:1359`'s `toEqual` throws *before* `:1361`'s leak guard ever executes, so the guard does not appear in the first failure list. After patching `:1359` alone and re-running, the same test fails again with a different message:

```
× decodes an inbound assistant_delta … carrying turnId/seq/text (camelCase)
  → expected '[{"type":"assistantDelta","turnId":"t…' not to contain 'conv-1'
```

Invert `:1361` deliberately at that point rather than treating the second failure as a surprise — and **invert it, never delete it.** Deleting removes the only assertion that the id reaches the renderer at all.

**Measured green, requiring no edit:** the entire rest of the suite. In particular `timelineBridge.test.ts` (38/38), `threadTimeline.test.ts` (108/108), `inboundMessage.test.ts` (357/357 — including the content-free log tests at `:3379`/`:3407` and the decode fail-closed pin at `:733`), `conversationActivityStore.test.ts` (33/33) and `ConversationScreen.test.tsx` (213/213). **If any of those goes red, the change is wrong.** `e2e/` is unaffected — a case-insensitive grep for `assistantdelta` across `e2e/` returns zero matches.

## The three edits no mechanical check reaches

`tsc` does not read test names or comments. Neither does vitest. All three sites below sit adjacent to a line that *does* fail, so the developer will be in the block — but nothing will point at them.

| Site | Current text | Why it goes false |
|---|---|---|
| `daemonConnection.test.ts:1352` | test name: *"…into one assistantDelta carrying **turnId/seq/text** (camelCase)"* | Enumerates three fields; there are now four. **An AC4 hit** — the criterion's "counts the fields it carries as three" clause. Adjacent to the `:1359` vitest failure. |
| `daemonConnection.test.ts:1360` | *"// conversation_id is dropped at the choke point (single active conversation; #202 scopes it)."* | Verbatim false. **An AC4 hit.** Sits directly above the `:1361` guard that inverts, so it is reached on the *second* run, not the first. |
| `timelineBridge.test.ts:36` | test name: *"assistantDelta → a ThreadEvent assistantDelta with **the same fields**, a fresh object"* | The input now has four fields and the output three, so "the same fields" is false. **Not an AC4 hit** (it neither says "drops" nor counts to three) but it is the AC3 proof block's own label, and a false label on the proof is worse than none. Adjacent to the `:37` TS2322. Rewrite it to name the three fields the `ThreadEvent` keeps and say the id stops here. |

**None of these is optional.** A green suite and a passing AC4 grep are both compatible with all three being missed.

## The classification

**CHANGE — production and type (4 regions, 2 files):**

| Site | Edit |
|---|---|
| `events.ts:105-108` | **rewrite the shared block** — see § The shared-block problem. Split `assistantDelta`'s paragraph out; leave `turnEnd`'s shape alone |
| `events.ts:109` | the arm gains `conversationId: string` (last; 97 chars, stays one line) |
| `daemonConnection.ts:586-590` | **`:587` (the DROP sentence) and `:589-590` (the three-fields sentence) both go.** Rebuild as the four neighbours below it read |
| `daemonConnection.ts:592-595` | the emit gains one named line |

**CHANGE — tests (15 sites, 5 files):**

| Site | Edit | Caught by |
|---|---|---|
| `daemonConnection.test.ts:1352` | test **name** — drop the three-field list | ⚠️ **nothing** |
| `:1359` | `toEqual` gains `conversationId: 'conv-1'` — **the AC2 round-trip proof.** 131 chars on one line vs a block max of 117, so **wrap the array across three lines** | vitest |
| `:1360` | the comment above the leak guard | ⚠️ **nothing** |
| `:1361` | `not.toContain('conv-1')` → **inverted to a positive assertion, never deleted** | vitest (only after `:1359` is fixed) |
| `:1374` | `toEqual` literal — the seq:0 / empty-text test. 94 chars, fits | vitest |
| `timelineBridge.test.ts:36` | test **name** — "the same fields" | ⚠️ **nothing** |
| `:37` | `const event: DaemonEvent` — 119 chars vs a file max of 122; fits, but wrap if you prefer the block's 100 | TS2322 |
| `:456` | `bridge.emit(…)` — 102 chars, fits | TS2345 |
| `:483`, `:484` | `const sequence: DaemonEvent[]` — 93 chars, fit | TS2322 |
| `:552`, `:554` | `const sequence: DaemonEvent[]` — 97 chars, fit | TS2322 |
| `interactiveRoundtrip.test.tsx:46`, `:47` | `const stream: DaemonEvent[]` — 97 chars vs a file max of 107, fit | TS2322 |
| `daemonEventBridge.test.ts:105` | `translateDaemonEvent(…)` — **121 chars vs a file max of 116. Must wrap**; the `toolUse → null` test at `:119-126` is the in-file multi-line template | TS2345 |
| `modalBridge.test.ts:118` | the "arms this bridge must ignore" array — 92 chars, fits | TS2322 |
| `conversationActivityBridge.test.ts:219` | `bridge.emit(…)` in the unowned-arm test — with `conversationId: 'conv-unowned'` it is 111 chars vs a **file max of 107**, so either wrap it or use `'conv-1'` (104). Either is fine; do not raise the file max | TS2345 |

Use `conversationId: 'conv-1'` throughout, matching both the value `assistantDeltaPlaintext(DELTA)` already puts on the frame (`daemonConnection.test.ts:1340`) and the dominant local convention (21 uses in `timelineBridge.test.ts`, 15 in `daemonEventBridge.test.ts`, 9 in `modalBridge.test.ts`, all `'conv-1'`). `conversationActivityBridge.test.ts` is the one file with semantic ids (`conv-think`, `conv-unowned`) — follow its local convention there if you keep the width in budget. **Do not introduce a shared fixture builder** — no such module exists in this repo; every suite hand-rolls inline literals.

**ADD — one test (1 file):**

| Site | Edit |
|---|---|
| `daemonConnection.test.ts:1389-1397` | Extend the existing fail-closed test (or add a sibling beside it) to cover a **bad `conversation_id`** — see § Testing strategy. This is the ticket's only new assertion. |

**KEEP — every one of these is TRUE after the change and must survive:**

| Site | Why it survives |
|---|---|
| `daemonConnection.ts:608`, `:624`, `:642`, `:665`, `:686`, `:714`, `:827` | the seven "the assistant-delta idiom" citations. They name the copy-by-name discipline, not the drop. **True, load-bearing, and pointed at the emit you are editing** |
| `daemonConnection.test.ts:1386` | `turnEnd`'s `not.toContain('conv-1')`. Still true — **#752's**, 25 lines below the one that inverts |
| `daemonConnection.test.ts:2442`, `:2846`, `:2964` | the three sibling "dropped at the choke point" comments. `:2846`/`:2964` are `toolUse` / `toolResult` — **#753 / #754, the next children of #675** |
| `daemonConnection.test.ts:1378-1387`, `:1389`'s name, `:1399`+ | the `turn_end` round-trip, the malformed-delta test name, and the coarse-path regression. Green untouched |
| `daemonConnection.test.ts:1700` | `compacting`'s "emits exactly **the three** modeled properties". Counts a different arm's fields in a different block. ⚠️ Do not sweep with `:1352`'s three→four |
| `inboundMessage.ts:538-555` | `parseAssistantDeltaPayload` + its doc, including "the **four** known fields" (`:542`) — **already correct**. Unchanged; it is what makes AC2 free |
| `inboundMessage.ts:1250`, `inboundMessage.test.ts:1823`, `:2294`, `:2863`, `:3108` | five other "three known fields" claims, all about different payloads in different layers |
| `inboundMessage.test.ts:703` | "keeping only the **four** known delta fields" — already four. Green untouched |
| `inboundMessage.test.ts:733-745` | the decode fail-closed pin, whose `bad` list already includes `conversation_id: undefined`. **AC2's upstream half.** Green **without being edited** |
| `inboundMessage.test.ts:3379`, `:3407` | the content-free `assistant_delta` log tests. Green without being edited |
| `wire/types.ts:244`, `:251` | "field-for-field" is about the *wire* payload mirroring the *daemon's*, and `conversation_id: string` is already declared. **Do not touch** |
| `events.ts:376` | "crosses IPC for the same reason `assistantDelta.text` does" — about `text`, not the id |
| `timelineBridge.ts:25-30`, `:39-40` | the header's general drop rule and the bare case. True, and strengthened by this change (§ Design 4) |
| `timelineBridge.test.ts:39`, `:41`, `:458` | **the AC3 proof** + the freshness guard |
| `threadTimeline.ts:96` | "`conversation_id`-free … thin rename" — **already stale** before this ticket, from four prior widenings. Pre-existing, not newly falsified. **#756's.** Leave it |

## State + concurrency model

Unchanged. No new async work, no new subscription, no teardown surface. The field rides the existing `emitDaemonEvent` → `DAEMON_EVENT_CHANNEL` → preload pass-through → bridge path, synchronous per frame and already owned.

Adding a required field to an existing arm does not break exhaustive `switch` statements — they discriminate on `type`. **No consumer *code* changes**; only construction sites do. Confirmed by measurement: all four exhaustive consumers (`timelineBridge.ts:39`, `daemonEventBridge.ts:52`, `modalBridge.ts:74`, plus `threadTimeline.ts:291` on the `ThreadEvent` side) already have an explicit `case 'assistantDelta'`, and none produced a compiler error under the probe.

## Error handling

No new failure mode, and — unlike #742 — **no decode change at all.** `parseAssistantDeltaPayload` (`inboundMessage.ts:546-554`) already `requireString`s `conversation_id` as the first of its four fields, so a missing or non-string value already throws `WireDecodeError` and drops the whole line without emitting. Two existing tests pin it and both were **measured green under the probe without being edited**: `inboundMessage.test.ts:734` (decode layer, `conversation_id: undefined`) and `inboundMessage.test.ts:3407` (no log on the throw path).

The emit cannot fail on the new field: it reads an already-validated `string` off an already-narrowed payload. **No `??`, no default, no guard** — see § The live risk AC2 actually guards.

## Testing strategy

Unit tests only (`npm test`, vitest). **One new assertion; everything else is an edit.** Bullet-pointed scenarios, not test code; the developer writes these in each suite's existing idiom.

- **Round-trip (`daemonConnection.test.ts:1352-1362`), modified — four edits in one test.** The name drops the three-field list; `:1359`'s `toEqual` gains `conversationId: 'conv-1'` and becomes the **AC2/AC1 proof** that the frame's id reaches the emitted event verbatim; `:1360`'s comment goes with it; `:1361`'s leak guard **inverts to a positive assertion**. The guard **never executes** until `:1359` is fixed (measured), so it must be inverted deliberately rather than left to "pass".
- **Value-fidelity (`:1364-1376`), literal-only.** `seq: 0` and `text: ''` stay explicit values.
- **Fail-closed on a bad `conversation_id` (`:1389-1397`), the ticket's one new assertion.** The existing "drops a malformed assistant_delta" test keys on `seq: 'x'`. AC2 is specifically about `conversation_id`, and no *emit-level* test covers it — the decode-level pin at `inboundMessage.test.ts:734` proves the throw, not the absence of an emit. Extend this test with two more malformed payloads asserting the send count is unchanged: **`conversation_id` absent** (pass `undefined`; the envelope encoding drops it, which is the "missing" case) and **`conversation_id: 42`** (the "not a string" case). Assert only "no send, no throw" — do not assert on the error message, which is category-only by design. *Note: none of the four already-widened arms has this guard; their fail-closed tests all key on the arm's other field. Adding it here is a deliberate, cheap strengthening asked for by AC2's second sentence, not a family-idiom break to be reverted.*
- **`turn_end` round-trip (`:1378-1387`), untouched.** Including its own `not.toContain('conv-1')` at `:1386`. **#752's.** Must stay green.
- **Bridge seam (`timelineBridge.test.ts:35-42`, `:451-459`), half-modified.** `:37` and `:456` gain the field for `tsc`; **`:39`, `:41` and `:458` stay exactly as written. Them staying green *is* AC3.** Do not add a new test for it. `:36`'s name is rewritten (§ The three edits no mechanical check reaches). Measured: the whole file is 38/38 green before any edit, so every edit in it is compiler-driven or naming.
- **Store-integration sequences (`timelineBridge.test.ts:483`, `:484`, `:552`, `:554`), literal-only.** All four are `tsc`-forced; their assertions are about coalescing and item order and pass either way. This is the pin that the transport still holds no state — two deltas must still coalesce to **one** `assistantText` item, and the added id must not change that.
- **Ignore arrays and null-mappings (`daemonEventBridge.test.ts:105`, `modalBridge.test.ts:118`), literal-only.** Both `tsc`-forced; their `toBeNull()` assertions pass either way.
- **Unowned-arm guard (`conversationActivityBridge.test.ts:219`), literal-only.** `tsc`-forced. The assertion — that `assistantDelta` drives no activity setter — must keep passing: this arm stays unowned by that bridge, and a widened arm must not tempt anyone into wiring it there. **That is #756's decision, not this ticket's.**
- **Full-turn render (`interactiveRoundtrip.test.tsx:46`, `:47`), literal-only.** `tsc`-forced; the rendered-markup assertions below are unchanged and are an end-to-end pin that the id never reaches the DOM.
- **Decode tests (`inboundMessage.test.ts`), untouched — 357/357 green under the probe.**
- **Reducer and store (`threadTimeline.test.ts` 108/108, `timelineStore.test.ts`), untouched.** A different union.

Gates: `npm run typecheck` (twice — see the `&&` trap in § The cascade), `npm test`, `npm run build`.

**AC4 verification.** Two checks, because one grep cannot do it:

```bash
# (a) must return 0
git grep -nE "conversation_id is DROPPED|only the three known fields|carry only turnId / seq / text|carrying turnId/seq/text" -- src/

# (b) must return exactly 3, none of them between daemonConnection.test.ts:1339 and :1400
git grep -n "dropped at the choke point" -- src/main/daemonConnection.test.ts
```

Check (a) returns **4** on `main` at `ac4dcc9` (`events.ts:108`, `daemonConnection.ts:587`, `:589`, `daemonConnection.test.ts:1352`) — verified. Check (b) returns **4** and must return **3**. **Because both gates reward deletion, pair them with the positive check in § What the rebuilt prose must establish** — a rewrite that merely deletes the sentences passes both greps and fails the criterion, leaving this arm the only one of five with no stated routing-key argument.

## Open questions

None blocking. Two judgement calls, both recorded rather than left open:

1. **Field order in the arm and the emit.** `conversationId` goes **last**, matching `turnState`, `apiRetry` and `compacting`. `backgroundTaskStarted` puts it first; the majority and the three most recent widenings put it last. No test is order-dependent (there is no `Object.keys(…).sort()` guard on this arm — see below).
2. **This arm has no anti-spread `Object.keys` guard, and this ticket does not add one.** `compacting` has one (`daemonConnection.test.ts:1700-1716`, with a planted `smuggled` field); `assistantDelta` does not. Adding one is tempting since this emit is the file's named idiom precedent — but it is a new test for an unobserved failure mode, on an arm whose `toEqual` at `:1359` already fails on any extra own property. **Deferred, not forgotten:** if #756 or a later reviewer wants it, it is a self-contained one-test addition. Named here so its absence reads as a decision.

## Security review

**Verdict:** PASS

**Findings:**

Walked in the order of the architect security-review categories. Every "not applicable" below names the design decision that closes the category rather than asserting absence.

- **[1. Trust boundaries]** No findings. Two boundaries are in play and this ticket adds neither. The untrusted→trusted one is `parseAssistantDeltaPayload` (`inboundMessage.ts:546-554`), a single named function that `requireString`s `conversation_id` and returns a **fresh four-field literal** — so unknown server-added keys are tolerated for forward-compat but never copied through, which is also what makes it prototype-pollution-safe (the mechanism is stated at `inboundMessage.ts:415`) and what `inboundMessage.test.ts:703` pins. The boundary is explicit and typed (`AssistantDeltaPayload`), not scattered, and **this ticket does not modify it** — which is materially stronger than #742, where the boundary function's doc had to be edited. The second boundary is main→renderer, and the direction matters: this leg is **trusted→untrusted**, a *disclosure*, not a validation gap. What is disclosed is a conversation id — a class of value the renderer already receives on `turnState`, `stallDetected`, `apiRetry`, `compacting`, `queueState` and `backgroundTaskStarted` — so no new category of data reaches the web layer, and it reaches it on an arm that already carries `text`, a far larger untrusted string. The copy is by name from a narrowed payload, never a spread. Nothing flows renderer→main here.
- **[2. Tokens, secrets, credentials]** Not applicable — `conversationId` is a daemon-asserted routing identifier, not a credential. It grants nothing, is never compared against a secret (so the `timingSafeEqual` rule has no site here), is not generated by this code, and is not persisted. No storage, rotation, revocation or expiry surface is introduced.
- **[3. File / storage operations]** Not applicable — nothing here touches the filesystem, and the spec forbids the field ever being used as a path component, filename or cache key. That keeps the path-traversal and TOCTOU surfaces closed *by construction* rather than by a check a later refactor could drop. No renderer-side web storage (`localStorage` / IndexedDB) is written; the field terminates at the timeline bridge and never reaches a store that persists.
- **[4. Inter-process / Electron attack surface]** No findings. No new IPC channel, no new `contextBridge` API, no new `ipcMain.handle` / `.on` — the field rides the existing `DAEMON_EVENT_CHANNEL`, whose payload type is pinned to `DaemonEvent` in `emitDaemonEvent.ts`'s sink interface (`:22`), so no non-event payload can reach it. No `webPreferences`, navigation, `setWindowOpenHandler` or custom-protocol surface is touched, and no remote content is loaded. Process placement is unchanged and is the MUST-FIX category here: keys, socket and Noise handshake stay in main, and what crosses is one additional daemon-supplied string on an arm that already crosses three. The destroyed-window guard (`emitDaemonEvent.ts:44-45`) covers this call site as it covers the other 31.
- **[5. Cryptographic primitives]** Not applicable — no randomness, no key material, no key/nonce lifecycle, no comparison against a secret, and no change to the Noise session or its framing. The field is read out of an already-authenticated, already-decrypted frame.
- **[6. Network & I/O]** Not applicable, with two things checked rather than assumed. No socket, relay URL, TLS, timeout, backoff or `maxPayload` decision changes — the frame already carried this field on every occurrence and was already size-capped upstream by `MAX_PLAINTEXT_BYTES`, so the arm gains no unbounded input. On flood resistance, this arm deserves the closer look because it is the **highest-frequency arm on the union** — one frame per text slice, many per turn, where `compacting` flips at most twice. Stream semantics are explicitly held constant (§ Design 5): no coalescing, no dedup, no per-id buffer, no last-seq memo at the emit, so a hostile relay or daemon that floods `assistant_delta` frames produces exactly the event rate it produces today. **The new field makes a per-conversation buffer at the transport look attractive for the first time** — an unbounded map keyed by attacker-chosen strings — which is precisely why § Design 5 forbids it, and why `timelineBridge.test.ts:477-495` (coalescing is the reducer's job, two deltas → one item) must keep passing untouched as the pin.
- **[7. Error messages, logs, telemetry]** No findings — checked by grep, not asserted. Five sinks could in principle serialise the new field; all five are closed. (a) `emitDaemonEvent` (`emitDaemonEvent.ts:24-46`) is log-free *by construction*, documented in its own header as a deliberate choice, including on the destroyed-window drop path. (b) `preload/index.ts` is a bare pass-through with no logging. (c) `timelineBridge.ts:18`, `daemonEventBridge.ts:13` and `modalBridge.ts:18` each `JSON.stringify(event)` into an `assertNever` Error — but `assistantDelta` is an explicitly handled `case` in all three (`timelineBridge.ts:39`, `daemonEventBridge.ts:52`, `modalBridge.ts:74`, verified by grep), so that sink is a compile-time impossibility for this arm. (d) `threadTimeline.ts:229` stringifies a **`ThreadEvent`** — and because the id stops at the bridge, it cannot reach that sink at all; **the scope boundary is also a log-sink boundary**, which is a second, independent reason not to widen `ThreadEvent` to silence a `replace_all` accident. (e) The renderer diagnostics channel (`shared/ipc/diagnostics.ts`) carries its own fixed-shape `RendererDiagnosticEvent` behind a projector and has no `DaemonEvent` path. Finally the decode-side log is already content-free and pinned by `inboundMessage.test.ts:3379` ("never the delta text / turn_id / seq") plus `:3407` (no log on the throw path) — **measured green under the probe without being edited**, which makes them independent checks rather than restatements of intent. `parseAssistantDeltaPayload`'s own error names the failure category only (`'malformed assistant_delta payload'`) and never interpolates a value, deliberately, because `text` on this arm could echo conversation content (`inboundMessage.ts:543-544`).
- **[8. Concurrency]** Not applicable — no async task, timer, listener, `AbortController` or cancellation surface is added, and no connection lifecycle changes. The emit is synchronous within the existing per-frame handler; adding a field to a literal introduces no shared state, no check-then-act gap across an `await`, and no new shutdown-safety case.
- **[9. Threat model alignment]** No findings, and the hostile-daemon case is the one that matters for a routing key. **Hostile daemon response:** a hostile or impersonating daemon controls this value entirely. Within this ticket that buys nothing — **no consumer reads the field.** `translateTimelineEvent` (`timelineBridge.ts:39-40`) returns a fresh three-field `ThreadEvent` read by name, and the untouched `toEqual` / `toHaveBeenCalledWith` at `timelineBridge.test.ts:39` and `:458` are deterministic runtime guards that it stopped there — **measured: the whole bridge suite is 38/38 green with the arm widened and no edit applied.** The value is never rendered as markup, never a filename, cache key, lookup path, attribute or URL, and `interactiveRoundtrip.test.tsx` is an end-to-end pin that it reaches no DOM. Parsing stays defensive and fail-closed, unchanged. **Malicious relay:** unchanged — it is on-path and content-blind, and this ticket adds nothing it can drop, delay or reorder that it could not already. **Renderer compromise reaching the transport:** unchanged — the flow is one-way main→renderer and grants the renderer no new capability. **Token theft from disk:** not applicable, nothing persisted. **The real exposure is #756's**, where the id first becomes a lookup key into per-conversation timeline state; a hostile or unknown id must be handled there as an explicit no-match, never as a fallback onto the open conversation, and never as an unbounded map key. Named here as **OUT OF SCOPE, owned by #756** — and it is the reason this ticket refuses an optional field, since `?? activeConversation` is exactly the misattribution primitive a hostile id would want.

**One note carried forward, not a finding.** This ticket's diff *reduces* the volume of stated safety claims in the codebase — four "drops the id" / "three fields" assertions retire. That is correct, since they became false, but it means the security argument for this arm now lives entirely in the rebuilt prose at `events.ts:105-…` and `daemonConnection.ts:586-…`. **Reviewers should read that prose as a deliverable, not as commentary:** if it does not state the routing-key argument and the "reaches no sink" claim explicitly, the rebuild is incomplete even when every test is green and both AC4 greps return their target counts. A `git diff --word-diff=porcelain` removed-token multiset over `events.ts` is the cheapest way to confirm the argument was *added* rather than the old claim merely deleted.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-25
