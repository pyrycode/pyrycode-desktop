# #737 — Carry the conversation id on the `apiRetry` IPC arm

**Size:** S · **Labels:** `enhancement`, `security-sensitive` · **Parent:** #729 (split) · **Sibling:** #738 (citation sweep, blocked by this) · **Consumer:** #674

Measured against `main` at `693d6fe` — after #724 (`346d272`), #732 (`41f889d`) and #733 (PR #736) merged. **Every number in the ticket body was re-run at that commit, not trusted.** All held; the three that did not are corrected in § Corrections to the ticket body, and one falsified site the body does not list is added in § The three sites the body missed.

## Design source

N/A — transport / IPC-boundary work with no rendered surface. This slice changes no behaviour anyone can see: the retry chrome keeps reading the open conversation and must render identically. The visual-fidelity check is intentionally skipped. The per-conversation UI that consumes this field is #674.

## Files to read first

Codegraph is not indexed for this repo (`.codegraph/` holds `config.json` + `.gitignore`, no DB — confirmed 2026-08-24), so this list was built by grep + read rather than `codegraph_context`.

| Path | What to extract |
|---|---|
| `src/shared/ipc/events.ts:126-145` | **The template.** #732's rebuilt `stallDetected` arm doc — the exact security argument to rebuild here, already written out. Read before writing a word of prose. #724's `turnState` block at `:111-125` is the same shape one arm earlier. |
| `src/shared/ipc/events.ts:146-158` | The `apiRetry` doc block + the arm. **Both change.** Note the block contains no bare `apiRetry` token — only `:158` does. See § The gate is a floor. |
| `src/shared/ipc/events.ts:159`, `:167`, `:231`, `:268`, `:312` | Four `apiRetry` mentions that stay TRUE. Read to confirm you are not touching them. |
| `src/main/daemonConnection.ts:605-620` | **The other template.** #724's rebuilt `turn-state` emit + doc. `stall` at `:621-638` is #732's version of the same. |
| `src/main/daemonConnection.ts:639-654` | The `api-retry` emit + doc. **Both change.** |
| `src/main/daemonConnection.ts:690-712` | `background-task-started` — `:699` names `api-retry` as a divergence that stops existing. **Change `:699` only.** |
| `src/main/transport/inboundMessage.ts:112-119` | The `api-retry` decode paragraph. **The `:114-115` clause only** — the rest is #733's freshly-landed prose. The `stall` paragraph at `:104-110` is the in-file template. |
| `src/main/transport/inboundMessage.ts:98`, `:101-102` | **Two traps three lines above your edit.** `:98` is assistant-delta's (true, different arm); `:101-102` is turn-state's, stale since #724 and **filed as #739**. Do not repair either. See § The adjacency traps. |
| `src/main/transport/inboundMessage.ts:607-633` | `parseApiRetryPayload` — `requireString(payload, 'conversation_id')` plus three helpers, returning a fresh four-field literal. This is why AC1's fail-closed half is free. **Do not change it.** |
| `src/shared/wire/types.ts:325-330` | `ApiRetryPayload` already declares `conversation_id: string`, required. No wire change. |
| `src/main/daemonConnection.test.ts:1498-1636` | The whole `api_retry` describe block. Six tests; five change, one (`:1611`) must stay green untouched. |
| `src/main/daemonConnection.test.ts:1867-1872` | One of three identical comments this ticket also repairs — see § The three sites the body missed. |
| `src/renderer/src/store/timelineBridge.ts:102-113` | Where the id stops: a filter + fresh four-field literal read by name. **Unchanged — the file must not appear in `git diff --name-only`.** |
| `src/renderer/src/store/timelineBridge.test.ts:198-215` | The seam block. `:199` and `:209` gain the field; `:201` and `:210-215` must not change. Read the whole block before editing anything in the file. |
| `src/renderer/src/store/threadTimeline.ts:137-143` | The renderer-internal `ThreadEvent.apiRetry` arm. **Out of scope** (`:137-138`'s stale claim is #738's). Read only to confirm you are not touching it. |
| `src/main/emitDaemonEvent.ts:24-46` | The forwarder: no transform, no clone, **no logging, by construction** (stated in its own header). Load-bearing for the security review. |
| `docs/specs/architecture/732-stalldetected-conversation-id.md` | The direct precedent spec — same split, same union, one arm over. Its § Security review is the shape this one follows. |
| `docs/specs/architecture/724-turnstate-conversation-id.md` | The first of the family. |

## Context

The wire's `ApiRetryPayload` declares `conversation_id: string`, always present, and `parseApiRetryPayload` already decodes it fail-closed as a required string. The emit at `daemonConnection.ts:648-653` then carries `active`, `current` and `total` onward and deliberately throws the id away, on the stated assumption that there is exactly one active conversation.

That assumption is what the desktop sidebar retires: a chat must keep working while the operator looks at another one, and the list must show each chat's state (operator ruling, 2026-08-21). Phase landed in #724, liveness in #732; retry is this one.

Client-side only — no daemon work, no wire change, no new capability. `backgroundTaskStarted`, `queueState`, `turnState` (#724) and `stallDetected` (#732) are the shape precedents.

### What makes this arm different from #732

`stallDetected` was nullary, so its doc's safety claim ("no field can ride it") was true by construction. `apiRetry` already carries three fields, so its claim is narrower and sharper: **"no token, key, raw frame, or conversation content can ride an arm with no string field on it"** (`events.ts:150-151`). Adding a *string* is precisely what falsifies it.

The claim is **replaced, not patched**. #724 and #732 have already written the replacement — a daemon-asserted routing key is not untrusted text, plus what it may and may not be used for. Rebuild it in this arm's voice.

**Over-deletion is the stated risk.** Four `apiRetry` mentions in `events.ts` and eight elsewhere in the file set are true and must survive. § The classification is the authority.

## Size check — one red line trips, and the ticket is still S

Measured on `693d6fe`:

| Gate | Limit | This ticket |
|---|---|---|
| New files | 3 | **0** |
| Production source files with modified content | ≥5 forces a split | **3** — `events.ts`, `daemonConnection.ts`, `inboundMessage.ts` |
| Total written lines | ~600 | **≈105** |
| New exported types / components | 5 | **0** |
| Construction sites needing simultaneous update | 10 | **15** ⚠️ |
| Reject branches added | 10 | **0** |
| Acceptance criteria | 5 | **4** |

**The 15-site count is above the gate and is stated as 15, not re-counted down.** No "mechanical", "collapsible" or "trivial cascade" framing applies — each site is a real Edit in a block the developer must read. The ticket still ships as one, for three reasons that are structural rather than rhetorical:

1. **No split exists.** Adding a required field to a discriminated-union member is atomic: every intermediate state is a red build, so any child would fail "each child stands alone". The only line-drawable alternative — land it optional, then tighten — is explicitly forbidden by the ticket and by #729's split ruling, because an optional routing key invites `?? activeConversation` fallbacks, which is the misattribution this whole work exists to remove.
2. **The splittable half is already split off.** #737 *is* child A of #729. The citation sweep (#738) — the part that genuinely stands alone — is already a separate ticket, blocked on this one, sharing no file with it.
3. **The precedent is measured, not projected.** #724 shipped this exact change on this exact union at **16** construction sites across 12 files, S, first pass. #732 shipped it at **7** sites across 7 files, S, first pass, 0 review findings. This ticket sits between them at 15 sites across 7 files.

Recorded as a deliberate override of the 10-site gate on measured evidence, matching #724.

## Design

Two production line edits. Everything else is prose and test fixtures.

### 1. The IPC arm — `src/shared/ipc/events.ts:158`

The arm gains one required field:

```ts
| { type: 'apiRetry'; active: boolean; current: number; total: number; conversationId: string }
```

Field order within the arm is a style call; put `conversationId` where it reads best against the neighbouring arms. **Required, never optional** — settled at #729's split, identical to #724's and #732's ruling.

### 2. The emit — `src/main/daemonConnection.ts:648-653`

The fresh literal gains one named copy from the already-decoded payload:

```ts
emitDaemonEvent(sink, {
  type: 'apiRetry',
  active: inbound.apiRetry.active,
  current: inbound.apiRetry.current,
  total: inbound.apiRetry.total,
  conversationId: inbound.apiRetry.conversation_id
})
```

**By name, never `...inbound.apiRetry`.** This is the house idiom at every emit in the file and is what stops a decoder that later grows a field from smuggling it across IPC. snake→camel at the boundary, as everywhere else. `daemonConnection.test.ts:1607`'s `Object.keys` guard is the deterministic proof.

### 3. Where the id stops

`translateTimelineEvent` (`timelineBridge.ts:102-113`) keeps returning a fresh `{ type, active, current, total }` literal read by name. `ThreadEvent.apiRetry` (`threadTimeline.ts:143`) keeps its four fields. The reducer and `selectApiRetry` are untouched.

**Measured, not assumed:** with the arm widened and the emit wired, `tsc -p tsconfig.web.json` reported zero errors in `timelineBridge.ts` — a filter + fresh literal compiles unchanged when the source arm grows a field.

**The seam gets a free deterministic guard and it is already written.** `timelineBridge.test.ts:201` and `:210-215` (`toEqual({ type: 'apiRetry', … })`) fail on an extra own enumerable property, so a bridge that ever spread the event turns them red. **Leaving them alone IS the test for AC3.** Do not add a new test, and do not "update" them to match the widened arm — widening the arm does not make them type errors (`toEqual` is loosely typed), so they stay green or go red purely on runtime behaviour. That is what makes them real assertions rather than restatements of the type.

### 4. Edge semantics are unchanged and must stay that way

`apiRetry` is neither onset-only nor deduped: N frames produce N events, verbatim repeats included. `active: false` is an explicit falling edge, not an absence. `current: 0` / `total: 0` is the legitimate "count unknown" value. The transport holds no state and must keep holding none — **adding a field must not tempt anyone into adding dedup, coalescing, a timer or a last-value memo at the emit.** `daemonConnection.test.ts:1584` is the no-dedup guard: three events stay three events, only the literals grow a field.

## The census — `replace_all` is UNSAFE, repo-wide

`git grep -n "type: 'apiRetry'"` returns **20 lines across 9 files** (re-run at `693d6fe`; matches the body exactly). **15 change, 5 must not**, and several on opposite sides of the boundary are byte-identical — `{ type: 'apiRetry', active: true, current: 3, total: 10 }` appears at `daemonConnection.test.ts:1523` (change) and `timelineBridge.test.ts:201` (must not).

**The 15 that change** — all inside this ticket's file set:

`events.ts:158` · `daemonConnection.ts:649` · `daemonConnection.test.ts:1523`, `:1543`, `:1562`, `:1585`, `:1586`, `:1587` · `timelineBridge.test.ts:199`, `:209`, `:623`, `:627` · `daemonEventBridge.test.ts:248`, `:249` · `modalBridge.test.ts:153`

**The 5 that must NOT change are `ThreadEvent`, not the IPC arm** — and three live in files this ticket never opens:

| Site | What it is |
|---|---|
| `threadTimeline.ts:143` | the `ThreadEvent` arm declaration — *file not in this ticket's set* |
| `threadTimeline.test.ts:79` | `function apiRetry(…): ThreadEvent` helper — *file not in this ticket's set* |
| `timelineBridge.ts:109` | the bridge's fresh four-field literal — *file not in this ticket's set* |
| `timelineBridge.test.ts:201` | the AC3 proof (single-line `toEqual`) |
| `timelineBridge.test.ts:211` | the AC3 proof (inside the `:210-215` multi-line `toEqual`) |

A blind `replace_all` corrupts the `ThreadEvent` five and the suite goes red. **Widening `ThreadEvent` to make it pass silently destroys the scope boundary this ticket depends on — and it is also a log-sink boundary (see § Security review [7]). Do not do that.** Edit each of the 15 individually with enough surrounding context to disambiguate. `replace_all` is unsafe even *within* `timelineBridge.test.ts`, where `:199`/`:209` are in scope and `:201`/`:211` are not.

**The cheapest proof you did not reach past your own boundary is `git diff --name-only`: it must never name `threadTimeline.ts`, `threadTimeline.test.ts`, or `timelineBridge.ts`.**

Use `conversationId: 'conv-1'` throughout, matching the value `apiRetryPlaintext({ conversation_id: 'conv-1' })` already puts on the frame. **Do not introduce a shared fixture builder** — no such module exists in this repo; every suite hand-rolls inline literals.

## The gate is a floor, not a census

AC4's grep returns **3** file-scoped and **6** repo-wide on `main` (both re-run and confirmed). It is a single-line grep and **six of this ticket's falsified sites wrap across a line boundary, putting the arm name on one line and the claim on another — none of them match**:

| Site | Why the gate is blind |
|---|---|
| `events.ts:146-151` | `api-retry` on `:146`, `dropped` on `:149`, `no string field` on `:151` |
| `events.ts:162-163` | `dropped` on `:162`, `apiRetry` on `:163` |
| `events.ts:200-201` | `dropped` on `:200`, `apiRetry` on `:201` |
| `daemonConnection.ts:640-647` | `api-retry` on `:640`, `DROPPED` on `:643` |
| `inboundMessage.ts:112-115` | `api-retry` on `:112`, `dropping` on `:115` |
| `daemonConnection.test.ts:1591` | `four modeled` present, no `apiRetry` token on the line |

Plus the three at `daemonConnection.test.ts:1870`/`:2023`/`:2210`, whose vocabulary ("the deliberate inverse of") the gate's regex does not contain at all.

**Therefore: work the classification table below, and use the 3→1 / 6→4 gate only as a secondary check.** Chasing the file-scoped gate to 0 is the over-deletion this ticket exists to prevent — `daemonConnection.test.ts:1611` ("drops a malformed api_retry") is about dropping the malformed **frame**, not the id, and must survive.

Prettier never reflows comments, so a name deleted from a wrapped list leaves short lines behind. That is cosmetic, not a defect.

## The classification

**CHANGE — production and type (9 regions):**

| Site | Edit |
|---|---|
| `events.ts:146-157` | **rebuild the doc block** — the retired safety claim is here |
| `events.ts:158` | the arm gains `conversationId: string` |
| `events.ts:162-163` | `compacting`'s drop list "matching / apiRetry)" — remove the `apiRetry` reference |
| `events.ts:200-201` | `modelAnnounced`'s "matching / apiRetry / compacting)" — remove `apiRetry`, keep `compacting` |
| `events.ts:210` | `backgroundTaskStarted`'s "unlike toolUse / apiRetry / compacting, which drop it" — remove `apiRetry`, keep the other two |
| `daemonConnection.ts:640-647` | **rebuild the emit doc** |
| `daemonConnection.ts:648-653` | the emit |
| `daemonConnection.ts:699` | "the deliberate divergence from api-retry / compacting above" — remove `api-retry`, keep `compacting` |
| `inboundMessage.ts:114-115` | **this clause only** — "carries the edge … and the counter … onward, dropping only `conversation_id`" |

**CHANGE — tests (18 sites):**

| Site | Edit |
|---|---|
| `daemonConnection.test.ts:1508` | test **name** — "(conversation_id dropped)" |
| `:1523` | `toEqual` gains the id — **the AC2 round-trip proof** |
| `:1524` | the comment above the leak guard |
| `:1525` | `not.toContain('conv-1')` → **inverted to a positive assertion, never deleted** |
| `:1543`, `:1562` | `toEqual` — the 0/0 and falling-edge cases |
| `:1585`, `:1586`, `:1587` | `toEqual` — the no-dedup guard. **Three events stay three events**; only the literals grow a field |
| `:1591` | test **name** — "the four modeled properties" → five |
| `:1607` | `Object.keys(…).sort()` → `['active', 'conversationId', 'current', 'total', 'type']` |
| `:1870`, `:2023`, `:2210` | three identical comments — see § The three sites the body missed |
| `timelineBridge.test.ts:199`, `:209` | `const event: DaemonEvent = …` (TS2322) |
| `timelineBridge.test.ts:623`, `:627` | `bridge.emit(…)` (TS2345) |
| `daemonEventBridge.test.ts:248`, `:249` | `translateDaemonEvent(…)` argument (TS2345) |
| `modalBridge.test.ts:153` | the "arms this bridge must ignore" array (TS2322) |

**KEEP — every one of these is TRUE after the change and must survive:**

| Site | Why it survives |
|---|---|
| `events.ts:159` | "Like apiRetry it carries the edge" — scoped to the edge. True |
| `events.ts:167`, `:231`, `:268`, `:312` | "the apiRetry-was-a-no-op-until-#493 precedent" — bridge wiring. True |
| `inboundMessage.ts:98` | the **assistant-delta** paragraph, which also reads "dropping only `conversation_id`". Different arm |
| `inboundMessage.ts:101-102` | turn-state's paragraph. **Stale, but #739's** — see § The adjacency traps |
| `inboundMessage.ts:112-113`, `:117-119` | #733's freshly-landed prose and the fail-closed defence. Not yours |
| `inboundMessage.ts:122`, `:131`, `:147`, `:186` | contrast lists — `api-retry` is still a claude sub-state. Deleting the name would write a *new* falsehood |
| `daemonConnection.test.ts:1611` | "drops a malformed api_retry" — the **frame**, not the id. **The expected AC4 survivor** |
| `daemonConnection.test.ts:1361`, `:1386`, `:1652`, `:1747`, `:2401`, `:2805`, `:2923` | the seven sibling `not.toContain('conv-1')` guards — see § Corrections |
| `timelineBridge.test.ts:198`, `:206`, `:617` | test names about the **ThreadEvent** / the store. True |
| `timelineBridge.test.ts:201`, `:210-215` | **the AC3 proof.** Untouched and green |
| `daemonEventBridge.test.ts:247`, `modalBridge.test.ts:152` | "ships dormant, consumer is #493". True |
| `inboundMessage.test.ts:3496` | the content-free log test. **Green without being edited** |
| `ConversationScreen.tsx:1272`, `threadTimeline.ts:137`, `wire/types.ts:420` | outside the file set. `:1272` is correct and permanent; the other two are #738's |

## The three sites the body missed

`daemonConnection.test.ts:1870`, `:2023` and `:2210` each carry the byte-identical comment:

> `// The deliberate inverse of api_retry's `not.toContain('conv-1')`: #567 attributes tasks by id,`

Once `:1525` inverts, `backgroundTaskStarted`'s `expect(events[0].conversationId).toBe('conv-1')` is no longer api_retry's *inverse* — it is its **twin**. The claim is falsified by this ticket, in this ticket's file set, and covered by AC4's wording ("no comment … still states that `apiRetry` drops `conversation_id`"). **#738 never opens this file**, so if this ticket does not take them, nobody does.

Repair the first line only; the second line ("#567 attributes tasks by id, the same model queue_state already uses, so dropping it here would make that slice unbuildable") is a positive statement that survives intact. **State the rule, do not re-point the contrast at a sibling** — `compacting` and `modelAnnounced` become non-droppers at #730 and #714.

**This is the one place `replace_all` IS safe** — three byte-identical lines, all three changing identically (the #725 precedent).

## The adjacency traps

Three false-looking or true-looking lines sit within a few lines of your edits. All three stay.

- **`inboundMessage.ts:101-102` — stale, and NOT yours.** turn-state's decode paragraph still reads "The consumer carries only `state` onward (dropping `conversation_id`)", which #724 falsified. It sits **three lines above** the paragraph you edit, in the same doc block. **It is filed as #739.** It is a `turn_state` claim — a different arm and a different concern — and folding it in makes this a two-concern diff.
- **`inboundMessage.ts:98` — true, and NOT yours.** The assistant-delta paragraph also reads "dropping only `conversation_id`". **Anchor your edit on the `api-retry` paragraph, never on the phrase.**
- **`inboundMessage.ts:112-113` — #733's, landed four days ago.** PR #736 replaced the old "Unlike `stall` this arm is NOT nullary" opening with "The render slice #493 shows \"attempt N/M\", so …". That opening is *why* the consumer carries the counter and stays true. **Edit the clause at `:114-115`, not the paragraph.**

## Corrections to the ticket body

Three of the body's statements did not survive re-measurement. None changes the design; all three reduce risk.

1. **There are 8 `not.toContain('conv-1')` assertions in `daemonConnection.test.ts`, not 4.** The body names `:1361` (assistantDelta), `:1386` (turnEnd), `:1525` (yours) and `:1652` (compacting). It omits `:1747` (modelAnnounced), `:2401` (unrecognizedMessage), `:2805` (toolUse) and `:2923` (toolResult). **Exactly one — `:1525` — is yours. The other seven stay untouched and green.** A developer greping for the body's "four" will find eight and must not treat the surplus as a discrepancy. (Three further matches at `:1870`/`:2023`/`:2210` are comments, not assertions — those are the § three sites above.)

2. **The body's "prefer a line-count-neutral edit" note buys nothing measurable here, and must not be paid for in clarity.** The rebuilt `events.ts` block *will* grow — #724's `turnState` block is 15 lines and #732's `stallDetected` block is 20, against `apiRetry`'s current 12. Checked, rather than assumed: the only open ticket citing line numbers in these files is **#730, whose citations are already stale by ~24 lines** (it cites `events.ts:135-143` for the compacting arm, now at `:159-168`, and `inboundMessage.ts:119-124`, now at `:121-127`) and must be re-anchored regardless. #714 cites no line numbers; #738 cites only `events.ts:114`, above every edit here; #739 cites `inboundMessage.ts:100-102`, also above. **Write the prose the change needs.** Keep `inboundMessage.ts` neutral where it is free, since it is a single-clause rewrite — but do not compress a security argument to hit a line count.

3. **`timelineBridge.test.ts:211` is one line of a multi-line `toEqual` spanning `:210-215`.** Read it as the block it is; the "must not change" applies to the whole assertion.

## What the rebuilt prose must establish

Write it in each file's own voice — these are the claims, not the wording. `events.ts:126-145` and `daemonConnection.ts:621-638` are the working templates.

- The arm carries `conversationId`, copied **by name** from the already-decoded payload — never a spread.
- The decode stays fail-closed: a missing or non-string `conversation_id` fails the whole line without emitting, exactly as today.
- The id is a **daemon-asserted routing key**, not operator text and not model-influenced text — none of the untrusted-text warnings on `model` / `description` / `raw` attach to it. It is never markup, a filename, a cache key, a lookup path, an attribute or a URL, and it reaches no log sink (`emitDaemonEvent` is log-free by construction).
- The id **stops at the timeline bridge**; `ThreadEvent.apiRetry` keeps its four fields. The consumers that route by conversation are #674.
- The **"turn-stream item, or daemon state?" test** (stated canonically at `events.ts:114`) is why it crosses: per-conversation retry is daemon state, so the sidebar can show a chat is stuck retrying while the operator looks at a different one (#674).
- **Required, never optional**, and why — an optional routing key invites `?? activeConversation` fallbacks.
- The edge semantics survive the rewrite verbatim: not onset-only, not deduped, `active: false` a value, `0/0` legitimate, no state at the emit.

**The retired claim — "no token, key, raw frame, or conversation content can ride an arm with no string field on it" — must be REPLACED, not softened.** The safety framing now rests on the field's *nature* (a routing key that reaches no sink) rather than on the absence of a string. A rewrite that merely deletes the sentence leaves this arm the only one in the family with no stated security argument.

### Explicitly not falsified — `daemonConnection.ts:646-647`

"Not compile-forced (this inner switch has no `assertNever`) — the round-trip test guards this emit." **Still true and not a required edit.** It is about the switch arm's existence, not the literal's shape. If the rebuild absorbs it naturally, fine; do not delete it as falsified.

## The cascade — compiler-enumerated, not estimated

Widening the arm and running `npm run typecheck` produces exactly **8** errors, in two halves:

**Node half (1)** — `daemonConnection.ts:648` (TS2345, the emit).

**Web half (7)** — `timelineBridge.test.ts:199`, `:209` (TS2322); `timelineBridge.test.ts:623`, `:627` (TS2345); `daemonEventBridge.test.ts:248`, `:249` (TS2345); `modalBridge.test.ts:153` (TS2322).

Two traps:

- **`npm run typecheck` is `&&`-chained** (`tsc -p tsconfig.node.json && tsc -p tsconfig.web.json`), so the single node-side error **masks all seven web errors** until the emit is fixed. **One clean run is not evidence you are done — seeing the second half fail *after* the first passes is the only proof the cascade was enumerated.**
- **Five more sites are runtime-forced and invisible to `typecheck`**, because `toEqual` and `Object.keys` are loosely typed: `daemonConnection.test.ts:1523`, `:1543`, `:1562`, `:1584`, `:1607`. Run `npm test`, not just `npm run typecheck`. Note `:1523` throws before `:1525` executes, so **expect to fix that test twice** — once for the `toEqual`, once for the inverted guard.

## State + concurrency model

Unchanged. No new async work, no new subscription, no teardown surface. The field rides the existing `emitDaemonEvent` → `DAEMON_EVENT_CHANNEL` → preload pass-through → bridge path, synchronous per frame and already owned.

Adding a required field to an existing arm does not break exhaustive `switch` statements — they discriminate on `type`. No consumer *code* changes; only construction sites do.

## Error handling

No new failure mode. The decode is the only place that can fail and it is unchanged: `parseApiRetryPayload` (`inboundMessage.ts:624-633`) already `requireString`s `conversation_id`, so a missing or non-string value already throws `WireDecodeError` and drops the whole line without emitting. The fail-closed reject test at `daemonConnection.test.ts:1611` passes unchanged and is the proof.

The emit cannot fail on the new field: it reads an already-validated `string` off an already-narrowed payload.

## Testing strategy

Unit tests only (`npm test`, vitest). No new test *file*; one assertion inverts. Bullet-pointed scenarios, not test code — the developer writes these in the suite's existing idiom.

- **Round-trip (`daemonConnection.test.ts:1508-1526`), modified — four edits in one block.** The name drops "(conversation_id dropped)"; `:1523`'s `toEqual` gains `conversationId: 'conv-1'` and becomes the AC2 proof that the frame's id reaches the emitted event verbatim; `:1525`'s leak guard **inverts to a positive assertion** — it asserts the opposite of the new contract, and it **never executes** until `:1523` is fixed, so it must be inverted deliberately rather than left to "pass"; `:1524`'s comment goes with it.
- **Anti-spread (`daemonConnection.test.ts:1591-1609`), modified — name plus one array.** `:1607` becomes `['active', 'conversationId', 'current', 'total', 'type']`. **`:1602`'s `smuggled: 'must-not-cross'` field and `:1608`'s `not.toContain('must-not-cross')` both stay** — together they are AC1's "copied by name" proof, and deleting either removes the only deterministic check that the emit is not a spread.
- **0/0, falling edge, no-dedup (`:1528`, `:1547`, `:1566`), literal-only edits.** The no-dedup test must still assert **three** events after the change.
- **Fail-closed (`:1611-…`), unchanged.** Must stay green untouched.
- **Bridge seam (`timelineBridge.test.ts:198-215`), half-modified.** `:199` and `:209` gain the field; `:201` and `:210-215` stay exactly as written. **Them staying green *is* AC3.** Do not add a new test for it.
- **Store drive (`timelineBridge.test.ts:617-629`), literal-only.** `selectApiRetry` still returns `{ current, total }` — the store scalar is not widened here (`ConversationScreen.tsx:1272`'s "two numbers, NO string field" comment stays true and is an expected gate survivor).
- **Content-free logging (`inboundMessage.test.ts:3496`), untouched.** Pins the `api_retry` log to a fixed field set and asserts the conversation id never appears. Must stay green **without being edited** — this ticket changes what crosses IPC, not what reaches a log. If it goes red, the change is wrong.
- **Decode tests (`inboundMessage.test.ts`), untouched.** The decode already carries `conversation_id` and already strips unknown keys.
- **Reducer (`threadTimeline.test.ts`), untouched.** A different union.
- **`e2e/` is unaffected** — **zero** `type: 'apiRetry'` literals anywhere under `e2e/` (confirmed by the census).

Gates: `npm run typecheck` (twice — see the `&&` trap), `npm test`, `npm run build`.

## Open questions

None blocking. One judgement call: whether `conversationId` goes first or last in the arm and the emit literal. `turnState` and `backgroundTaskStarted` put it first; `stallDetected` has nothing to compare against. Pick by readability — the `Object.keys(…).sort()` guard is order-independent.

## Security review

**Verdict:** PASS

**Findings:**

Walked in the order of the architect security-review categories.

- **[1. Trust boundaries]** No findings. Two boundaries are in play and this ticket adds neither. The untrusted→trusted one is `parseApiRetryPayload` (`inboundMessage.ts:624-633`), a single named function that `requireString`s `conversation_id` and returns a **fresh four-field literal**, so unknown server-added keys are tolerated for forward-compat but never copied through — which is also what makes it prototype-pollution-safe, stated explicitly at `inboundMessage.ts:410`. The boundary is explicit and typed (`ApiRetryPayload`), not scattered. The second is main→renderer, and the direction matters: this leg is **trusted→untrusted**, a *disclosure*, not a validation gap. What is disclosed is a conversation id — a class of value the renderer already receives on `turnState`, `stallDetected`, `queueState` and `backgroundTaskStarted` — so no new category of data reaches the web layer. Nothing flows renderer→main here. The copy is by name from a narrowed payload, never a spread, and `daemonConnection.test.ts:1591-1609` is a runtime guard on exactly that with a deliberately planted `smuggled` field; **this spec requires that field and its `not.toContain` to survive the edit**, which is what keeps the guard a test rather than a restatement of the type.
- **[2. Tokens, secrets, credentials]** Not applicable — `conversationId` is a daemon-asserted routing identifier, not a credential. It grants nothing, is never compared against a secret (so the constant-time-comparison rule has no site here), is not generated by this code, and is not persisted. No storage, rotation, revocation or expiry surface is introduced.
- **[3. File / storage operations]** Not applicable — nothing here touches the filesystem, and the spec forbids the field ever being used as a path component, filename or cache key. That keeps the path-traversal and TOCTOU surfaces closed *by construction* rather than by a check a later refactor could drop. No renderer-side web storage is written.
- **[4. Inter-process / Electron attack surface]** No findings. No new IPC channel, no new `contextBridge` API, no new `ipcMain.handle`/`on` — the field rides the existing `DAEMON_EVENT_CHANNEL`, whose payload type is pinned to `DaemonEvent` in `emitDaemonEvent.ts`'s sink interface, so no non-event payload can reach it. No `webPreferences`, navigation, `setWindowOpenHandler` or custom-protocol surface is touched, and no remote content is loaded. Process placement is unchanged and is the MUST-FIX category here: keys, socket and Noise handshake stay in main, and what crosses is one additional daemon-supplied string on an arm that already crosses three fields. The destroyed-window guard (`emitDaemonEvent.ts:44`) covers this call site as it covers the other 31.
- **[5. Cryptographic primitives]** Not applicable — no randomness, no key material, no key/nonce lifecycle, no comparison against a secret, and no change to the Noise session or its framing. The field is read out of an already-authenticated, already-decrypted frame.
- **[6. Network & I/O]** Not applicable, with one thing checked rather than assumed. No socket, relay URL, TLS, timeout, backoff or `maxPayload` decision changes — the frame already carried this field on every occurrence and was already size-capped upstream by `MAX_PLAINTEXT_BYTES`, so the arm gains no unbounded input. On flood resistance: edge semantics are explicitly held constant (no dedup, no coalescing, no timer, no last-value memo), so a hostile relay or daemon that floods `api_retry` frames produces exactly the event rate it produces today. **This arm is the family's worst case for that question** — it is the one that already re-fires as the counter climbs — which is precisely why § Design 4 forbids adding state at the emit: a per-id memo introduced there would be the change that opens an unbounded-map surface keyed by attacker-chosen strings. `daemonConnection.test.ts:1584` pins it.
- **[7. Error messages, logs, telemetry]** No findings — this is the category the retired doc comment's safety claim actually rested on ("no string field on it"), so it got the closest walk, and each sink was checked by grep rather than asserted. Five could in principle serialise the new field; all five are closed. (a) `emitDaemonEvent` (`emitDaemonEvent.ts:24-46`) is log-free *by construction*, documented in its own header as a deliberate choice, including on the destroyed-window drop path. (b) `preload/index.ts` is a bare pass-through with no logging. (c) `timelineBridge.ts:18`, `daemonEventBridge.ts:13` and `modalBridge.ts:18` each `JSON.stringify(event)` into an `assertNever` Error — but `apiRetry` is an explicitly handled `case` in all three (proved by `daemonEventBridge.test.ts:248` asserting `null`, not a throw, and by `modalBridge.test.ts:153` listing it as ignored), so that sink is a compile-time impossibility for this arm. (d) `threadTimeline.ts:229` stringifies a **`ThreadEvent`** — and because the id stops at the bridge, it cannot reach that sink at all; **the scope boundary is also a log-sink boundary**, which is a second, independent reason not to widen `ThreadEvent` to silence a `replace_all` accident. (e) The renderer diagnostics channel (`shared/ipc/diagnostics.ts`) carries its own fixed-shape `RendererDiagnosticEvent` behind a projector and has no `DaemonEvent` path, so an event cannot reach it without a code change. Finally the decode-side content-free log is pinned by `inboundMessage.test.ts:3496` with an explicit "never the conversation_id or the counter" assertion — **that test stays green untouched, which is what makes it an independent check rather than a restatement of intent.** `parseApiRetryPayload`'s own error names the failure category only (`'malformed api_retry payload'`) and never interpolates a value.
- **[8. Concurrency]** Not applicable — no async task, timer, listener, `AbortController` or cancellation surface is added, and no connection lifecycle changes. The emit is synchronous within the existing per-frame handler; adding a field to a literal introduces no shared state, no check-then-act gap across an `await`, and no new shutdown-safety case.
- **[9. Threat model alignment]** No findings, and the hostile-daemon case is the one that matters for a routing key. **Hostile daemon response:** a hostile or impersonating daemon controls this value entirely. Within this ticket that buys nothing — **no consumer reads the field.** `translateTimelineEvent` (`timelineBridge.ts:102-113`) returns a fresh four-field `ThreadEvent` read by name, and the untouched `toEqual`s at `timelineBridge.test.ts:201` / `:210-215` are deterministic runtime guards that it stopped there. The value is never rendered as markup, never a filename, cache key, lookup path, attribute or URL. Parsing stays defensive and fail-closed, and the decoder deliberately does not range-check `current` / `total` — unchanged here, and correct: a client-invented bound would drop valid future frames (ADR 0002), while `#493` formats the counter defensively. **Malicious relay:** unchanged — it is on-path and content-blind, and this ticket adds nothing it can drop, delay or reorder that it could not already. **Renderer compromise reaching the transport:** unchanged — the flow is one-way main→renderer and grants the renderer no new capability. **Token theft from disk:** not applicable, nothing persisted. **The real exposure is #674's**, where the id first becomes a lookup key into per-conversation state; a hostile or unknown id must be handled there as an explicit no-match, never as a fallback onto the open conversation. Named here as **OUT OF SCOPE, owned by #674** — and it is the reason this ticket refuses an optional field, since `?? activeConversation` is exactly the misattribution primitive a hostile id would want.

**One note carried forward, not a finding.** This ticket's diff *reduces* the volume of stated safety claims in the codebase — four "drops the id" assertions and one "no string field can ride it" argument retire. That is correct, since they became false, but it means the security argument for this arm now lives entirely in the rebuilt prose at `events.ts:146-…` and `daemonConnection.ts:640-…`. **Reviewers should read that prose as a deliverable, not as commentary:** if it does not state the routing-key argument and the "reaches no sink" claim explicitly, the rebuild is incomplete even when every test is green.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-25
