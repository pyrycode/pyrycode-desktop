# #714 — Keep the conversation id on the `model-announced` IPC arm

**Size:** S · **Labels:** `enhancement`, `security-sensitive` · **Parent:** #673 (split) · **Blocked by:** #742 (**RESOLVED** — PR #744 merged 2026-08-25T00:17:50Z) · **Consumer:** #588 / #674

Measured against `main` at `a51bd69` — the merge of #742's PR #744. **The ticket body gives every line number at `c3013e4`, which is pre-#742, so every one of them has shifted; the anchor text was re-resolved rather than trusted.** The body said so explicitly and it was right: the three comment sites, the two test-name families and the whole literal census sit at different lines now. Each is re-stated below at its `a51bd69` line.

The body left two things open — the compiler/runtime cascade, and whether the announced-model store really stays immune. Both were **probed, not projected** (§ The cascade, § 3): the arm was widened, the emit wired, each `tsc` project run separately, `vitest` run, and the tree reverted.

## Design source

N/A — transport / IPC-boundary work with no rendered surface. The ticket body carries no `## Figma` section, correctly: this slice changes no behaviour anyone can see, the announced-model store keeps holding a single value and must behave identically afterwards, and the per-conversation consumers are #588 / #674. The visual-fidelity check is intentionally skipped.

## Files to read first

Codegraph is **not indexed** for this repo — `.codegraph/` holds `config.json` + `.gitignore` and no DB; `codegraph_status` errors `CodeGraph not initialized` (re-probed 2026-08-25, unchanged since 2026-08-24). This list was built with `git grep` + read rather than `codegraph_context`. Line ranges are `a51bd69`.

| Path | What to extract |
|---|---|
| `src/shared/ipc/events.ts:173-199` | **The template.** #742's rebuilt `compacting` arm doc — written one ticket ago for this exact widening, and `:184-185` is the "REPLACED, not softened" sentence this ticket's prose must earn its own version of. Read before writing a word. |
| `src/shared/ipc/events.ts:111-125`, `:126-145`, `:146-172` | The same rebuild three, two and one arm earlier (`turnState` #724, `stallDetected` #732, `apiRetry` #737). Four independent samples of the house voice. |
| `src/shared/ipc/events.ts:200-236` | The `modelAnnounced` doc block. `:231-233` is **retirement site 1**. `:237` is the arm. Everything at `:205-229` (the `model` collision + VERBATIM + `truncated` + SECURITY paragraphs) is **out of scope and must survive verbatim**. |
| `src/main/daemonConnection.ts:662-682` | **The other template.** #742's rebuilt `compacting` emit + doc, immediately above yours. `api-retry` at `:639-661` is the same shape. |
| `src/main/daemonConnection.ts:683-705` | The `model-announced` emit + doc. `:692-694` is **retirement site 2** and carries the security clause. `:684-691` **stays line-count-neutral** — see § The neutrality question. `:700-704` is the emit. |
| `src/main/daemonConnection.ts:706-733` | `background-task-started` — the shape precedent the ticket body names. Read `:715-717` ("KEPT by the rule, not by comparison with a neighbour"); it is the anti-pattern guard for the prose you write. |
| `src/main/transport/inboundMessage.ts:123-132` | #742's rebuilt `compacting` decode paragraph — the in-file template. **Note `:129` is a 22-char orphan line left by #742's review NIT; it is compacting's, not yours. Do not fix it** (§ The adjacency traps). |
| `src/main/transport/inboundMessage.ts:134-148` | The `model-announced` decode paragraph. `:138-140` is **retirement site 3**. `:143-147` (`model` held VERBATIM, no length check) is out of scope and stays. |
| `src/main/transport/inboundMessage.ts:871-908` | `parseModelAnnouncedPayload` — already `requireString`s `conversation_id` and returns a fresh **three**-field literal. This is why AC1's fail-closed half is free. **Do not change it.** |
| `src/shared/wire/types.ts:356-405` | `ModelAnnouncedPayload` already declares `conversation_id: string`, required, no `omitempty`. No wire change. `:357`'s "field-for-field" is *wire ↔ daemon*, **not** *IPC arm ↔ wire* — true, and a sweep trap (§ The adjacency traps). **Do not touch.** |
| `src/renderer/src/store/announcedModelBridge.ts:25-46` | **Where the id stops, and the single most important read in this ticket.** `:39-45` returns a fresh `{ model, truncated }` literal by name. `:29` already claims the store shape "stays immune to the `modelAnnounced` arm gaining an unrelated field later" — this ticket is the demonstration. `:30` cites `daemonConnection.ts:686` and that citation is **live and accurate**; protect it. **The file must not appear in `git diff --name-only`.** |
| `src/main/daemonConnection.test.ts:1731-1835` | The whole `model_announced` describe block. Six tests; **five change**, `:1823` (fail-closed) must stay green untouched. |
| `src/renderer/src/store/announcedModelBridge.test.ts:24-190` | 11 input literals change; **every expected-output assertion must not**. The KEEP sites are invisible to the census grep — see § The census. |
| `docs/specs/architecture/742-compacting-conversation-id.md` | The direct precedent spec — same file set, same union, one arm over. Its § Security review is the shape this one follows. |
| `docs/specs/architecture/737-apiretry-conversation-id.md`, `732-stalldetected-conversation-id.md`, `724-turnstate-conversation-id.md` | The three earlier members of the family. |

## Context

The wire's `ModelAnnouncedPayload` (`wire/types.ts:401-405`) declares `conversation_id: string`, always present, and `parseModelAnnouncedPayload` (`inboundMessage.ts:900-908`) already decodes it fail-closed as a required string alongside `model` and `truncated`. The emit at `daemonConnection.ts:700-704` then carries `model` and `truncated` onward and deliberately throws the id away, on the stated assumption that there is exactly one active conversation.

That assumption is what the desktop sidebar retires: a chat must keep working while the operator looks at another one (operator ruling, 2026-08-21). Phase landed in #724, liveness in #732, retry in #737, compaction in #742. **This is the last arm in the family.**

Client-side only — no daemon work, no wire change, no new capability.

### What makes this arm different from #742

Three things, and each changes what the developer does.

1. **It is not a claude sub-state.** `turnState` / `stallDetected` / `apiRetry` / `compacting` are all status peers with a shared "turn-stream item, or daemon state?" justification. `model_announced` is an **identity report** — claude's account of the model it resolved, off its `system` / `init` line. It carries no `turn_id` and opens and closes no turn. The prose must justify the crossing on **its own** terms, not by appending itself to the status-neighbour list.
2. **It has a real, already-built consumer.** The other four ship dormant into bridges that no-op them. This one feeds `announcedModelBridge` → `announcedModelStore` (#588's half), which is live code with 15 passing tests. That makes AC4 ("the store still holds a single value") a **measurable** claim rather than a promise — and it is measured in § 3.
3. **The retired claim is a security clause, and it is arithmetic.** `daemonConnection.ts:693-694` says the drop leaves *"exactly one untrusted string crosses IPC on this arm rather than two."* Adding a string makes it numerically false. Unlike #742's claim (which rested on the absence of *any* string) this one rests on a **count**, so the tempting repair is to change "one" to "two" — which would be worse than deleting it, because it would assert that `conversationId` is untrusted text of the same kind as `model`. **It is not** (§ What the rebuilt prose must establish).

**Over-deletion is the stated risk and the gate rewards it.** AC3 counts to zero, and deleting the security paragraph satisfies it. The positive list in § What the rebuilt prose must establish is what makes that a failure.

## Size check — one red line trips, and the ticket is still S

Measured on `a51bd69`:

| Gate | Limit | This ticket |
|---|---|---|
| New files | 3 | **0** |
| Production source files with modified content | ≥5 forces a split | **3** — `events.ts`, `daemonConnection.ts`, `inboundMessage.ts` (comment-only) |
| Total written lines (production + tests + prose) | ~600 | **≈130** |
| New exported types / components | 5 | **0** |
| Construction sites needing simultaneous update | 10 | **23** ⚠️ |
| Reject branches added | 10 | **0** |
| Acceptance criteria | 5 | **4** |

**The 23-site count is above the gate, is stated as 23, and is not re-counted down.** No "mechanical", "collapsible", "trivial fixture cascade" or "the additive change doesn't fan out" framing is applied — and note that 23 is **above the whole family's precedent** (#724 shipped 16, #737 15, #742 12, all S first-pass). That is recorded as elevated risk, not argued away. The compensation is precision: every one of the 23 is enumerated below at its exact line with its exact edit and what catches it, so the developer's turns go into editing rather than exploring.

**The ticket still ships as one, because no valid split exists.** Three candidate seams were examined and all three fail:

1. **Split the cascade from the widening.** Impossible. Adding a *required* field to a discriminated-union member is atomic: every intermediate state is a red build, so any child fails "each child stands alone." **Verified, not asserted** — § The cascade shows the compiler forcing all 16 renderer-side literals in the same commit. The only line-drawable alternative (land it optional, then tighten) is forbidden by the ticket and by the family's ruling, because an optional routing key invites `?? activeConversation` fallbacks — the exact misattribution this work exists to remove.
2. **Split the comment retirement off, the #742 → #743 way.** This is the seam that worked for #730, and it **does not work here.** #743's files were *disjoint* from #742's; here all three retirement sites live in the three production files the code change already touches. Worse, the split would land a commit on `main` in which the code carries the field while three comments say it is dropped — **one of them a false security claim**. Shipping a knowingly-false security comment to `main` is a worse outcome than either the un-split ticket or the status quo.
3. **Split by file** (main-side first, renderer tests second). Fails the same way as (1): the 16 renderer literals *are* compile errors created by the main-side change. The first child would be a red build.

**The file-count gate — the one atomicity may never override — reads 3 of 5.** That is the gate #730 tripped at 6 and was split on; this ticket does not come near it.

## Design

Two production line edits. Everything else is prose and test fixtures.

### 1. The IPC arm — `src/shared/ipc/events.ts:237`

The arm gains one required field:

```ts
| { type: 'modelAnnounced'; model: string; truncated: boolean; conversationId: string }
```

**Required, never optional** — identical to #724's, #732's, #737's and #742's ruling. Measured width of that line: **88 chars** against the file's 110 max, so it stays a one-liner.

### 2. The emit — `src/main/daemonConnection.ts:700-704`

The fresh literal gains one named copy from the already-decoded payload:

```ts
emitDaemonEvent(sink, {
  type: 'modelAnnounced',
  model: inbound.modelAnnounced.model,
  truncated: inbound.modelAnnounced.truncated,
  conversationId: inbound.modelAnnounced.conversation_id
})
```

**By name, never `...inbound.modelAnnounced`.** This is the house idiom at every emit in the file and is what stops a decoder that later grows a field from smuggling it across IPC. snake→camel at the boundary, as everywhere else. `daemonConnection.test.ts:1819`'s `Object.keys` guard is the deterministic proof.

**Unlike #742, this emit is already multi-line, so nothing is forced to expand.** The new line measures **69 chars** against the file's 111 max. `daemonConnection.ts` therefore *can* be width-neutral and grows by exactly one code line — the opposite of #742, where a 144-char one-liner had to blow out to five.

### 3. Where the id stops — and it is already proved

`translateModelAnnounced` (`announcedModelBridge.ts:39-45`) keeps returning a fresh `{ model: event.model, truncated: event.truncated }` literal read by name. `AnnouncedModel` (`announcedModelStore.ts:62-65`) keeps its two fields. The store, its setter and `AnnouncedModelData` are untouched.

**Measured, not assumed.** With the arm widened, the emit wired, and `conversationId: 'conv-1'` added to the input literals — **and every expected-output assertion left at two fields** — `vitest` ran `announcedModelBridge.test.ts` **15/15 green**. A filter + fresh literal compiles *and* passes unchanged when the source arm grows a field.

**That is AC4's proof and it is already written.** These assertions fail on an extra own enumerable property, so a bridge that ever spread the event turns them red:

| Site | Assertion |
|---|---|
| `:31-34`, `:39`, `:45-46` | `expect(translateModelAnnounced(event)).toEqual({ model, truncated })` |
| `:51-53` | `'type' in result` is `false`, and `result` is not the event |
| `:115-118`, `:130-133`, `:143` | `toHaveBeenCalledWith({ model, truncated })` / `toHaveBeenLastCalledWith` |
| `:169-172`, `:184-187` | `selectAnnouncedModel(store.getState())).toEqual({ model, truncated })` |

**Leaving them alone IS the test for AC4.** Do not add a new test, and do not "update" them to match the widened arm — widening the arm does not make them type errors (`toEqual` and `toHaveBeenCalledWith` are loosely typed), so they stay green or go red purely on runtime behaviour. That is what makes them real assertions rather than restatements of the type.

### 4. Announcement semantics are unchanged and must stay that way

`modelAnnounced` is **not deduped**: N frames produce N events, verbatim repeats included — and the repeat is load-bearing, since it is what tells #588 the value is still current. `model` crosses **verbatim** with no normalising, lowercasing, allow-list, family regex or client-side length check. `truncated` stays a required boolean whose `false` is a value, never defaulted. The transport holds no state and must keep holding none: **adding a field must not tempt anyone into adding dedup, coalescing, a timer or a last-value memo at the emit — and none keyed by the new id either.** `daemonConnection.test.ts:1792-1807` is the no-dedup guard: two events stay two events, only the literals grow a field.

## The census — `replace_all` is UNSAFE, repo-wide

`git grep -n "type: 'modelAnnounced'"` returns **23 lines across 7 files**, re-run at `a51bd69` (matches the body's 21 test literals exactly, plus the arm and the emit). **All 23 change.**

| File | Sites | Lines |
|---|---|---|
| `src/shared/ipc/events.ts` | 1 | `:237` (the arm) |
| `src/main/daemonConnection.ts` | 1 | `:701` (the emit) |
| `src/main/daemonConnection.test.ts` | 5 | `:1759`, `:1774`, `:1788`, `:1804`, `:1805` |
| `src/renderer/src/store/announcedModelBridge.test.ts` | 11 | `:27`, `:38`, `:43`, `:49`, `:113`, `:126`, `:127`, `:140`, `:168`, `:180`, `:181` |
| `src/renderer/src/store/daemonEventBridge.test.ts` | 2 | `:276`, `:284` |
| `src/renderer/src/store/timelineBridge.test.ts` | 2 | `:367`, `:650` |
| `src/renderer/src/store/modalBridge.test.ts` | 1 | `:167` |

**Two line-numbering conventions are in play, and they differ by one on multi-line literals.** This table gives the line of the `type: 'modelAnnounced'` key (what `git grep` reports); `tsc` reports the line of the literal's opening brace. So `announcedModelBridge.test.ts:27` here is `tsc`'s `26`, `daemonEventBridge.test.ts:276`/`:284` are `tsc`'s `275`/`283`, and `timelineBridge.test.ts:650` is `tsc`'s `649`. Same sites, both correct for their tool.

**⚠️ The census pattern is a trap, because the sites that must NOT change do not match it.** Every KEEP site in § Design 3 is an *expected-output* literal — `{ model, truncated }` with **no `type` key** — so `git grep "type: 'modelAnnounced'"` cannot see them. A developer who trusts "all 23 matches change" and then reaches for a looser pattern to catch "the rest" will corrupt the AC4 proof. **The census is a list of what changes; it is not a list of what is in the file.**

**The cheapest proof you did not reach past your own boundary is `git diff --name-only`: it must name exactly eight files** — `events.ts`, `daemonConnection.ts`, `inboundMessage.ts`, `daemonConnection.test.ts`, `announcedModelBridge.test.ts`, `daemonEventBridge.test.ts`, `timelineBridge.test.ts`, `modalBridge.test.ts` — **and must never name `announcedModelBridge.ts`, `announcedModelStore.ts`, `wire/types.ts`, `inboundMessage.test.ts`, `threadTimeline.ts` or `messageViewModel.ts`.** That is the same 8-file shape #742 shipped.

### The four `replace_all` hazards — all re-measured at `a51bd69`, none safe

1. **The `modeled properties` test-name family, and #742 made it worse.** Seven tests in `daemonConnection.test.ts` share the byte-identical suffix `' modeled properties, never a spread of the decoded payload'`:

   | Line | Count word | Arm |
   |---|---|---|
   | `:1595` | five | — |
   | `:1700` | **three** | `compacting` — **#742 changed this from *two*** |
   | `:1809` | **three** | `modelAnnounced` ← **ours** |
   | `:1936` | seven | — |
   | `:2099` | five | — |
   | `:2306` | four | — |
   | `:2457` | four | — |

   **The full string `'emits exactly the three modeled properties, never a spread of the decoded payload'` currently matches TWO sites** (`:1700` and `:1809`) — the collision #744's review predicted and deferred here, now confirmed by measurement. A `replace_all` on the full string renames **compacting's** test too, silently making it lie. And renaming ours to **four** joins the existing pair at `:2306`/`:2457`, making three. **Edit by line. There is no unique key for this family.**
2. **The `(conversation_id dropped)` test-name suffix appears 3 times**: **`:1749`** (ours) · `:2793` (`toolUse`) · `:2911` (`toolResult`). The other two are **still true** — those arms still drop the id — and sweeping them would make two test names lie in the *opposite* direction. (#742 already retired compacting's, which is why this is 3 and not the body's 4.)
3. **`not.toContain('conv-1')` appears 6 times** in `daemonConnection.test.ts`: `:1361`, `:1386`, **`:1761`**, `:2415`, `:2819`, `:2937`. Exactly one — `:1761` — is ours and **inverts**. The other five belong to arms that still drop the id and stay untouched and green.
4. **Count words in test names across layers.** `inboundMessage.test.ts:1823` reads `'drops unknown server keys, keeping exactly the three known fields (forward-compat)'` — the **wire** payload's three (`conversation_id`, `model`, `truncated`), which do **not** change. ⚠️ Do not sweep it with `:1809`'s three→four; they count different things in different layers. (This is the identical trap #742 flagged at `inboundMessage.test.ts:1705`.)

## The cascade — compiler- and runtime-enumerated, not estimated

Measured by applying the two production edits, running each `tsc` project separately, then running `vitest`, then reverting. A fresh worktree has no `node_modules`; `npm install` first, then `./node_modules/.bin/tsc` (a bare `npx tsc` resolves to the wrong binary here).

**Node half (`tsconfig.node.json` = `src/main` + `src/preload` + `src/shared`) — exactly 1 error, and it is the emit itself:**

```
src/main/daemonConnection.ts(700,35): error TS2345:
  Property 'conversationId' is missing in type '{ type: "modelAnnounced"; model: string; truncated: boolean; }'
```

**Web half (`tsconfig.web.json` = `src/renderer/src` + `src/shared`) — exactly 16 errors, all in test files:**

| Site | Code |
|---|---|
| `announcedModelBridge.test.ts:26`, `:38`, `:43`, `:49` | TS2322 (`const event: DaemonEvent = …`) |
| `announcedModelBridge.test.ts:113`, `:126`, `:127`, `:140`, `:168`, `:180`, `:181` | TS2345 (`bridge.emit(…)` argument) |
| `daemonEventBridge.test.ts:275`, `:283` | TS2345 (`translateDaemonEvent(…)` argument) |
| `modalBridge.test.ts:167` | TS2322 (the ignore array) |
| `timelineBridge.test.ts:367` | TS2322 (the ignore array) |
| `timelineBridge.test.ts:649` | TS2345 (`bridge.emit(…)` argument) |

**Two traps, both confirmed by measurement:**

- **`npm run typecheck` is `&&`-chained** (`tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json`), so the single node-side error **masks all 16 web errors** until the emit is fixed. Confirmed directly: with the arm widened and the emit *not* wired, the node half reports 1 error and the web half never runs. **One clean run is not evidence you are done — seeing the second half fail *after* the first passes is the only proof the cascade was enumerated.**
- **Five more sites are runtime-forced and invisible to `tsc`**, because `toEqual` and `Object.keys` are loosely typed — which is why the node half passes clean while `daemonConnection.test.ts` still holds five stale literals. With production edited and tests untouched, `vitest` reports **exactly 5 failures, all in the `model_announced` describe block, 278 other tests passing**:

  | Test | Fails at |
  |---|---|
  | `:1749` "decodes a model_announced … (conversation_id dropped)" | `:1758` |
  | `:1764` "carries the identifier … BYTE-FOR-BYTE" | `:1773` |
  | `:1778` "carries truncated true to the sink" | `:1787` |
  | `:1792` "does NOT dedup …" | `:1803`/`:1805` |
  | `:1809` "emits exactly the three modeled properties…" | `:1819` |

  **`:1749` must be fixed twice.** `:1758`'s `toEqual` throws *before* `:1761`'s leak guard ever executes, so the guard **does not appear in the failure list at all** — confirmed: only five failures were reported, and none of them was `:1761`. Fix `:1758`, re-run, and `:1761` then fails. It must be inverted **deliberately**, not as a reaction to a failure that never surfaces.

**Measured green, requiring no edit:** `announcedModelBridge.test.ts` (15/15, with inputs widened and outputs untouched) and the other 278 tests in `daemonConnection.test.ts`, including the fail-closed test at `:1823`. If any of those goes red, the change is wrong.

## `daemonConnection.test.ts:1809` — the one edit no mechanical check reaches

`tsc` does not read test names. Neither does vitest. The AC3 gate anchors on the `model-announced` / `#587` / `#588` subject, so it never sees this one. **The classification table below is the only thing that catches it.**

What *will* pull the developer into this test is `:1819` immediately below it, which fails under vitest. **Change both while you are there:** `:1809`'s name three → **four**, and `:1819`'s `expect(Object.keys(events[0]).sort()).toEqual(['model', 'truncated', 'type'])` → `['conversationId', 'model', 'truncated', 'type']`. **`conversationId` sorts FIRST** — confirmed by the probe, which reported the actual value as `[ 'conversationId', 'model', …(2) ]`.

**`:1820`'s `not.toContain('must-not-cross')` and `:1815`'s planted `smuggled: 'must-not-cross'` field both stay exactly as they are.** Together they are AC1's "copied by name" proof, and deleting either removes the only deterministic check that the emit is not a spread. A green AC3 gate is **not** evidence that `:1809` was fixed.

## The classification

**CHANGE — production and type (5 regions, 3 files):**

| Site | Edit |
|---|---|
| `events.ts:231-233` | **rebuild** — the drop-claim paragraph. See § What the rebuilt prose must establish |
| `events.ts:237` | the arm gains `conversationId: string` |
| `daemonConnection.ts:692-694` | **rebuild the DROP sentence *and* its security clause.** `:684-691` stays (§ The neutrality question); `:694`'s "Deliberately stateless: no" tail stays |
| `daemonConnection.ts:700-704` | the emit gains one line |
| `inboundMessage.ts:138-140` | **this clause only** — "The consumer carries `model` and `truncated` onward, dropping `conversation_id` (#588 holds a single value replaced per announcement, so nothing keys by conversation)" |

**CHANGE — tests (23 sites, 5 files):**

| Site | Edit | Caught by |
|---|---|---|
| `daemonConnection.test.ts:1749` | test **name** — drop "(conversation_id dropped)" | AC3 gate |
| `:1756-1757` | the inline comment naming the shape ("the arm has exactly `type` / `model` / `truncated`") — **moves with the name** | ⚠️ **nothing** |
| `:1758-1760` | `toEqual` gains the id — **the AC2 round-trip proof** | vitest |
| `:1761` | `not.toContain('conv-1')` → **inverted to a positive assertion, never deleted** | vitest (only after `:1758` is fixed) |
| `:1773-1775` | `toEqual` — the BYTE-FOR-BYTE test | vitest |
| `:1787-1789` | `toEqual` — the truncated-true test | vitest |
| `:1803-1806` | `toEqual` — the no-dedup guard. **Two events stay two events**; only the literals grow a field | vitest |
| `:1809` | test **name** — "the three modeled properties" → **four** | ⚠️ **nothing** — see the section above |
| `:1819` | `Object.keys(…).sort()` → `['conversationId', 'model', 'truncated', 'type']` | vitest |
| `announcedModelBridge.test.ts:27`, `:38`, `:43`, `:49` | `const event: DaemonEvent = …` | TS2322 |
| `announcedModelBridge.test.ts:113`, `:126`, `:127`, `:140`, `:168`, `:180`, `:181` | `bridge.emit(…)` argument | TS2345 |
| `daemonEventBridge.test.ts:276`, `:284` | `translateDaemonEvent(…)` argument | TS2345 |
| `modalBridge.test.ts:167` | the "arms this bridge must ignore" array | TS2322 |
| `timelineBridge.test.ts:367` | the "arms this bridge must ignore" array | TS2322 |
| `timelineBridge.test.ts:650` | `bridge.emit(…)` argument | TS2345 |

Both ignore arrays take the shape `compacting` already has post-#742 — `daemonEventBridge.test.ts:270` is the live in-file example. Use `conversationId: 'conv-1'` throughout, matching the value the `ANNOUNCED` fixture (`daemonConnection.test.ts:1734-1738`) already puts on the frame. **Do not introduce a shared fixture builder** — no such module exists in this repo; every suite hand-rolls inline literals.

**KEEP — every one of these is TRUE after the change and must survive:**

| Site | Why it survives |
|---|---|
| `announcedModelBridge.test.ts:31-34`, `:39`, `:45-46`, `:51-53`, `:115-118`, `:130-133`, `:143`, `:169-172`, `:184-187` | **AC4's proof.** Expected-*output* assertions, two fields, invisible to the census grep. Measured 15/15 green unedited |
| `announcedModelBridge.ts` (whole file), `announcedModelStore.ts` (whole file) | Where the id stops. Neither may appear in `git diff --name-only` |
| `events.ts:205-229` | the `model` collision / VERBATIM / `truncated` / SECURITY paragraphs. Untouched and still apply in full |
| `events.ts:234-236` | "NOT deduped … including a verbatim repeat" — true, and #588 still depends on it |
| `events.ts:241`, `:455` | the two "unlike toolUse, which drops it" claims (`backgroundTaskStarted`, `queueState`). **Neither names `modelAnnounced`** — #742 already trimmed the one list that did. True, untouched |
| `daemonConnection.ts:684-691` | the never-a-spread idiom + `model` VERBATIM + `truncated` paragraphs. True, load-bearing, **and line-count-frozen** |
| `daemonConnection.ts:690` | "dropping it would make #588 silently wrong" — about **`truncated`**, not the id. ⚠️ Sits two lines above the false clause and matches any "drop" sweep. **Do not repair it** |
| `daemonConnection.ts:715-717` | `backgroundTaskStarted`'s "KEPT by the rule, not by comparison with a neighbour". True, and the model for your prose |
| `inboundMessage.ts:129` | #742's 22-char orphan line. Compacting's, not yours (§ The adjacency traps) |
| `inboundMessage.ts:136`, `:143-147` | the classification list and the `model`-VERBATIM paragraph — see § The adjacency traps |
| `inboundMessage.ts:871-908` | `parseModelAnnouncedPayload`. Unchanged; it is what makes AC1 fail-closed free |
| `wire/types.ts:356-405` | "Mirrors the daemon's ModelAnnouncedPayload **field-for-field**" — about the *wire* payload mirroring the *daemon's*. True |
| `daemonConnection.test.ts:1815`, `:1820` | the planted `smuggled` field and its guard. **AC1's proof** |
| `daemonConnection.test.ts:1823-1834` | "drops a malformed model_announced" — the **frame**, not the id. Green untouched |
| `daemonConnection.test.ts:1700` | **compacting's** "three modeled properties" name. Collides byte-for-byte with ours |
| `daemonConnection.test.ts:2793`, `:2911` | the two sibling `(conversation_id dropped)` names. Still true |
| `daemonConnection.test.ts:1361`, `:1386`, `:2415`, `:2819`, `:2937` | the five sibling leak guards. Untouched and green |
| `inboundMessage.test.ts:1754-1900` | the decode tests, incl. `:1823`'s "exactly the three known fields". A different layer; green unedited |
| `inboundMessage.test.ts:3558`, `:3583` | the content-free log tests — "never the conversation_id, the model or the cut flag". Green **without being edited** |
| `messageViewModel.ts:24` | "`conversation_id` dropped" — about `MessagePayload` → `Message`, a different arm entirely |

## The adjacency traps

Four sites read like the in-scope defect. All four stay, and each has an independent reason.

- **`daemonConnection.ts:690` — the closest trap in the ticket, two lines from the real edit.** "`truncated` crosses WITH it: dropping it would make #588 silently wrong" is about **`truncated`**, not `conversation_id`, and it is *why `truncated` is kept*. It matches the scoped gate (§ AC3's gate) as a false positive because it sits in the same block as the real clause. Repairing it would delete the argument for keeping the cut report.
- **`inboundMessage.ts:136` — a classification list, not a drops-the-id list.** "Neither a claude sub-state like its `stall` / `api-retry` / `compacting` neighbours nor a daemon mapping gap like `unrecognized-message`" draws a contrast about **what kind of frame this is**. The same list survived #732 widening `stall`, #737 widening `api-retry` and #742 widening `compacting` — three independent proofs. Do not edit it.
- **`inboundMessage.ts:129` — #742's known orphan.** A 22-char line (`* required fields —`) left by prepending to a wrapped comment; it was raised as a NIT on PR #744 and deliberately **not** fixed there. It belongs to the `compacting` paragraph, five lines above yours. **Not this ticket's**, and touching it widens the diff into an arm this ticket has no business in.
- **`wire/types.ts:357` — a different boundary.** "field-for-field" there is *wire payload ↔ daemon payload*, not *IPC arm ↔ wire payload*. This is the same "ask which boundary a claim is about, not which arm it names" rule #738's review turned on.

**Your own two orphans are absorbed for free.** `daemonConnection.ts:693` (`…replaced per announcement), so exactly`, 62 chars) and `inboundMessage.ts:139` (`holds a single value replaced per announcement, so nothing keys by`, 68 chars) are both short lines *inside* the regions this ticket rewrites. Re-wrapping the rebuilt prose fixes both without a separate edit. **Do not leave a third orphan behind** — the NIT #744 collected is exactly this shape, and it is caught by reading the file right after the comment hunk, not by any tool.

## The neutrality question — checked, and the answer differs per file

The house instruction is *"prefer line-count-neutral comment edits — but check, never obey."* Checked. **Every downstream `file.ts:NNN` back-reference below these edits was resolved against what that line actually holds today:**

| File | Live citers below the edits | State at `a51bd69` | Ruling |
|---|---|---|---|
| `events.ts` | `announcedModelStore.ts:15` → `events.ts:179-185`; `:61` → `:174-211`; `:79` → `:194`; `:99` → `:208-209` | **All four already stale, and badly — by ~26 lines.** They now land inside **#742's `compacting` doc**: `:179-185` is compacting's routing-key paragraph, `:194` is a blank comment line (the cited "`false` is a VALUE" is at `:220`), `:208-209` is the model-name collision paragraph (the cited no-dedup claim is at `:234`) | **Neutrality buys nothing. Write the prose the change needs.** |
| `daemonConnection.ts` | `announcedModelBridge.ts:30` → **`:686`** | **ACCURATE** — `:686` is exactly the "never a spread of inbound.modelAnnounced" line it claims | ⚠️ **Freeze the line count of `:684-691`.** The edit region is `:692-694`, which is *below* `:686`, so the citation survives for free — **provided the opening sentence at `:684-685` is not re-wrapped into an extra line.** The block's widest line is 104 against a 111 max, so there is ~7 chars/line of slack to absorb any added words in place |
| `inboundMessage.ts` | none below `:140` | — | Neutral where free — it is a single-clause rewrite — but no obligation |

**Conclusion: do not compress the security argument to hit a line count.** The `events.ts` block *will* grow — #742's `compacting` doc is 27 lines and #737's `apiRetry` doc is 27, against `modelAnnounced`'s current 37 (already the longest in the union, because of the `model` collision and SECURITY paragraphs that are out of scope here). Re-anchoring the four already-broken `announcedModelStore.ts` citations is **not this ticket's work** — that file is `src/renderer`, outside the scope boundary, and touching it would add a fourth production file and a second concern. They were already wrong before this ticket and stay equally wrong after it.

**What to measure instead is width, not line count.** This repo has no prettier and no formatter, so nothing re-wraps a comment you widen. Max line width at `a51bd69`:

| File | Max width |
|---|---|
| `events.ts` | 110 |
| `daemonConnection.ts` | 111 |
| `inboundMessage.ts` | 112 |
| `daemonConnection.test.ts` | 166 |
| `announcedModelBridge.test.ts` | 103 |
| `daemonEventBridge.test.ts` | 116 |
| `timelineBridge.test.ts` | 122 |
| `modalBridge.test.ts` | 123 |

Run `awk '{print length}' <file> | sort -n | tail -1` **before and after** each file and do not raise the maximum. Note the test files carry far wider maxima than production — do not "tidy" toward the production column. Mirroring the wrap column of the `compacting` template directly above yours gets this for free in all three production files.

## What the rebuilt prose must establish

Write it in each file's own voice — these are the claims, not the wording. `events.ts:173-199` and `daemonConnection.ts:662-676` are the working templates, one arm above each edit.

- The arm carries `conversationId`, copied **by name** from the already-decoded payload — never a spread.
- The decode stays fail-closed: a missing or non-string `conversation_id` fails the whole line without emitting, exactly as today. `parseModelAnnouncedPayload` is untouched.
- The id is a **daemon-asserted routing key**, not operator text and not model-influenced text — none of the untrusted-text warnings on `model` / `description` / `raw` attach to it. It is never markup, a filename, a cache key, a lookup path, an attribute or a URL, and it reaches no log sink (`emitDaemonEvent` is log-free by construction, and the decode-side `model_announced` log is pinned content-free independently at `inboundMessage.test.ts:3558`).
- **The retired clause is arithmetic and must not be repaired arithmetically.** *"so exactly one untrusted string crosses IPC on this arm rather than two"* must be **REPLACED, not renumbered.** Changing "one" to "two" is the worst available outcome: it would assert that `conversationId` is untrusted text of the same kind as `model`, which is precisely the claim the ticket's security note denies. The count framing goes; the replacement rests on the **nature** of each string — `model` is untrusted, model-influenced text carrying the full plain-text-never-HTML discipline; `conversationId` is a routing key that reaches no sink. **The existing `model` warnings are untouched and still apply in full.**
- Why it crosses, **on this arm's own terms**: `model_announced` is an **identity report**, not a claude sub-state and not a turn-stream item — it carries no `turn_id` and opens and closes no turn. That is the same shape as `backgroundTaskStarted` and `queueState`, which keep the id by the **rule** (`daemonConnection.ts:715-717`: daemon STATE keyed by id, #720), and per-conversation attribution is what #588 / #674 need in order to say *which* chat announced *which* model.
- The id **stops at the announced-model bridge** (`announcedModelBridge.ts:39-45`), which rebuilds a fresh two-field literal with named fields; `AnnouncedModel` keeps `model` + `truncated`. The consumers that route by conversation are #588 / #674 — where an unknown id must be an explicit no-match, never a fallback onto the open conversation.
- **Required, never optional**, and why — an optional routing key invites `?? activeConversation` fallbacks.
- The announcement semantics survive the rewrite verbatim: `model` verbatim with no client-side rule, `truncated` a required boolean whose `false` is a value, not deduped (a verbatim repeat still reaches #588), no state at the emit and none keyed by the new id.

**AC3 half two is graded on this list.** A rewrite that merely deletes the sentences passes the gate and fails the criterion, and leaves this arm the only one in the family with no stated security argument.

**Never repair a cross-reference by re-pointing it at a sibling arm.** This is the last arm in the family, so there is no sibling left that drops the id on a status frame — a comment rewritten to say "unlike X, which drops it" would be false on arrival. State the rule, not a neighbour list. (`daemonConnection.ts:715-717` is the in-repo example of getting this right.)

## State + concurrency model

Unchanged. No new async work, no new subscription, no teardown surface. The field rides the existing `emitDaemonEvent` → `DAEMON_EVENT_CHANNEL` → preload pass-through → bridge path, synchronous per frame and already owned.

Adding a required field to an existing arm does not break exhaustive `switch` statements — they discriminate on `type`. **No consumer *code* changes**; only construction sites do. Confirmed by measurement: all four bridges with an explicit `case 'modelAnnounced'` (`announcedModelBridge.ts:41`, `daemonEventBridge.ts:139`, `modalBridge.ts:99`, `timelineBridge.ts:169`) produced **zero** compiler errors under the probe. Only their *test* literals did.

## Error handling

No new failure mode. The decode is the only place that can fail and it is unchanged: `parseModelAnnouncedPayload` (`inboundMessage.ts:900-908`) already `requireString`s `conversation_id`, so a missing or non-string value already throws `WireDecodeError` and drops the whole line without emitting. The fail-closed test at `daemonConnection.test.ts:1823` passes unchanged and is the proof — **measured green under the probe.**

The emit cannot fail on the new field: it reads an already-validated `string` off an already-narrowed payload.

## Testing strategy

Unit tests only (`npm test`, vitest). **No new test file and no new test** — one assertion inverts, one key-set grows, 21 literals gain a field, two names change, one inline comment moves. Bullet-pointed scenarios, not test code; the developer writes these in the suite's existing idiom.

- **Round-trip (`daemonConnection.test.ts:1749-1762`), modified — four edits in one test.** The name drops "(conversation_id dropped)"; `:1756-1757`'s comment goes with it; `:1758`'s `toEqual` gains `conversationId: 'conv-1'` and becomes the **AC2 proof** that the frame's id reaches the emitted event verbatim; `:1761`'s leak guard **inverts to a positive assertion** — it asserts the opposite of the new contract, and it **never executes** until `:1758` is fixed, so it must be inverted deliberately rather than left to "pass".
- **BYTE-FOR-BYTE (`:1764-1776`), literal-only.** `model` still crosses with no re-casing.
- **Truncated-true (`:1778-1790`), literal-only.** The cut report still crosses with the value.
- **No-dedup (`:1792-1807`), literal-only.** Must still assert **two** events after the change — only the literals grow a field. This is the guard against anyone adding a last-value memo to the emit.
- **Anti-spread (`:1809-1821`), name plus one array.** `:1819` → `['conversationId', 'model', 'truncated', 'type']`. **`:1815`'s `smuggled: 'must-not-cross'` and `:1820`'s `not.toContain('must-not-cross')` both stay** — together they are AC1's "copied by name" proof.
- **Fail-closed (`:1823-1834`), unchanged.** Must stay green untouched.
- **Announced-model bridge (`announcedModelBridge.test.ts`), inputs only.** The 11 input literals gain the field for `tsc`; **every expected-output assertion in § Design 3 stays exactly as written. Them staying green *is* AC4.** Do not add a new test for it. Measured: 15/15 green with inputs widened and outputs untouched.
- **Ignore arrays and no-op emits (`daemonEventBridge.test.ts:276`/`:284`, `modalBridge.test.ts:167`, `timelineBridge.test.ts:367`/`:650`), literal-only.** All five are `tsc`-forced; their runtime assertions (`toBeNull()`, "no timeline item") pass either way.
- **Content-free logging (`inboundMessage.test.ts:3558`, `:3583`), untouched.** Pins the `model_announced` log to a fixed field set and asserts the conversation id, the model and the cut flag never appear. Must stay green **without being edited** — this ticket changes what crosses IPC, not what reaches a log. If it goes red, the change is wrong.
- **Decode tests (`inboundMessage.test.ts:1754-1900`), untouched.** The decode already carries `conversation_id` and already strips unknown keys.
- **`e2e/` is unaffected** — a case-insensitive grep for `modelannounced` / `model_announced` across `e2e/` returns **zero** matches, re-verified at `a51bd69`.

Gates: `npm run typecheck` (twice — see the `&&` trap in § The cascade), `npm test`, `npm run build`.

### AC3's gate

Scope it to the **subject**, not to the word "drop" — the ticket's Technical Notes are explicit, and a repo-wide drop-vocabulary sweep returns ~90 lines of unrelated `backgroundTaskRoster` / `droppedTasks` noise. Treat any gate as a **floor**: run it case-insensitively and wrap-tolerantly in **both clause orders**, because the prose in all three sites is wrapped across lines and a line-oriented `grep` misses it. `rg` is not on PATH in a non-login shell here.

```bash
for f in $(git grep -lI "" -- src/); do
  perl -0777 -ne '
    while (/[^\n]*(?:model.announced|modelAnnounced|#587|#588)[^\n]*(?:\n[^\n]*){0,4}/gi) {
      my $b = $&;
      if ($b =~ /(?:conversation_id|conversationId)/i && $b =~ /(?:DROPPED|dropped|drops|dropping)/i) {
        my @l = split /\n/, $b; print "$ARGV: $l[0]\n";
      }
    }' "$f"
done | sort -u
```

**Measured: it returns 4 blocks on `main` at `a51bd69`** — `daemonConnection.test.ts` (the `:1749` name), `daemonConnection.ts` (the `:692-694` clause), `inboundMessage.ts` (the `:138-140` clause) and `events.ts` (the `:231-233` clause). It must return **0**.

⚠️ **The `daemonConnection.ts` block is a mixed hit.** It contains both the false clause at `:692-694` *and* the true "dropping it would make #588 silently wrong" at `:690`, which is about `truncated`. Driving the gate to zero must not take `:690` with it.

Because the gate rewards deletion, pair it with the positive check in § What the rebuilt prose must establish, and check `:1809` by hand — the gate is anchored on the subject and cannot see a test name that says only "three modeled properties".

## Open questions

None blocking. One judgement call: whether `conversationId` goes before or after `model` / `truncated` in the arm and the emit literal. `turnState` and `backgroundTaskStarted` put the id first; `apiRetry` and `compacting` put it last. **Recommended: last**, matching the two most recent siblings and keeping the `model` / `truncated` pair adjacent as the doc block discusses them. The `Object.keys(…).sort()` guard is order-independent, and the sorted expectation is `['conversationId', 'model', 'truncated', 'type']` either way.

## Security review

**Verdict:** PASS

**Findings:**

Walked in the order of the architect security-review categories. Every "not applicable" below names the design decision that closes the category rather than asserting absence.

- **[1. Trust boundaries]** No findings. Two boundaries are in play and this ticket adds neither. The untrusted→trusted one is `parseModelAnnouncedPayload` (`inboundMessage.ts:900-908`), a single named function that `requireString`s `conversation_id` and `model`, `requireBoolean`s `truncated`, and returns a **fresh three-field literal** — so unknown server-added keys are tolerated for forward-compat but never copied through, which is also what makes it prototype-pollution-safe and what `inboundMessage.test.ts:1823` pins. The boundary is explicit and typed (`ModelAnnouncedPayload`), not scattered, and this ticket leaves it untouched, which is why AC1's fail-closed half is inherited rather than re-argued. The second is main→renderer, and the direction matters: this leg is **trusted→untrusted**, a *disclosure*, not a validation gap. What is disclosed is a conversation id — a class of value the renderer already receives on `turnState`, `stallDetected`, `apiRetry`, `compacting`, `queueState` and `backgroundTaskStarted` — so no new category of data reaches the web layer. Nothing flows renderer→main here. The copy is by name from a narrowed payload, never a spread, and `daemonConnection.test.ts:1809-1821` is a runtime guard on exactly that with a deliberately planted `smuggled` field; **this spec requires that field and its `not.toContain` to survive the edit**, which is what keeps the guard a test rather than a restatement of the type.
- **[2. Tokens, secrets, credentials]** Not applicable — `conversationId` is a daemon-asserted routing identifier, not a credential. It grants nothing, is never compared against a secret (so the `timingSafeEqual` rule has no site here), is not generated by this code, and is not persisted. No storage, rotation, revocation or expiry surface is introduced. Note specifically that the *other* string on this arm, `model`, is untrusted model-influenced text and keeps every warning it has; the rebuilt prose must not blur the two into one category (§ What the rebuilt prose must establish).
- **[3. File / storage operations]** Not applicable — nothing here touches the filesystem, and the spec forbids the field ever being used as a path component, filename or cache key. That keeps the path-traversal and TOCTOU surfaces closed *by construction* rather than by a check a later refactor could drop. No renderer-side web storage (`localStorage` / IndexedDB) is written; the field terminates at the announced-model bridge and never reaches a store that persists. `announcedModelStore` is an in-memory Zustand singleton and keeps its two-field record — **measured**, not assumed (§ Design 3).
- **[4. Inter-process / Electron attack surface]** No findings. No new IPC channel, no new `contextBridge` API, no new `ipcMain.handle` / `.on` — the field rides the existing `DAEMON_EVENT_CHANNEL`, whose payload type is pinned to `DaemonEvent` in `emitDaemonEvent.ts`'s sink interface, so no non-event payload can reach it. No `webPreferences`, navigation, `setWindowOpenHandler` or custom-protocol surface is touched, and no remote content is loaded. Process placement is unchanged and is the MUST-FIX category here: keys, socket and Noise handshake stay in main, and what crosses is one additional daemon-supplied string on an arm that already crosses two. The destroyed-window guard in `emitDaemonEvent` covers this call site as it covers the others.
- **[5. Cryptographic primitives]** Not applicable — no randomness, no key material, no key/nonce lifecycle, no comparison against a secret, and no change to the Noise session or its framing. The field is read out of an already-authenticated, already-decrypted frame.
- **[6. Network & I/O]** Not applicable, with one thing checked rather than assumed. No socket, relay URL, TLS, timeout, backoff or `maxPayload` decision changes — the frame already carried this field on every occurrence and was already size-capped upstream by `MAX_PLAINTEXT_BYTES` (65519), so the arm gains no unbounded input. On flood resistance: announcement semantics are explicitly held constant (no dedup, no coalescing, no timer, no last-value memo), so a hostile relay or daemon that floods `model_announced` frames produces exactly the event rate it produces today. § Design 4 forbids adding state at the emit specifically because a per-id memo introduced there would be the change that opens an unbounded-map surface keyed by attacker-chosen strings. This arm is a **particularly** attractive place to add one, because "the same identifier repeats turn after turn" reads like an invitation to dedup — and the existing prose says outright that suppressing the repeat would starve #588. `daemonConnection.test.ts:1792-1807` pins it, and this spec requires it to keep asserting **two** events.
- **[7. Error messages, logs, telemetry]** No findings — this is the category the retired security clause actually rested on ("exactly one untrusted string … rather than two"), so it got the closest walk, and each sink was checked by grep rather than asserted. Five could in principle serialise the new field; all five are closed. (a) `emitDaemonEvent` is log-free *by construction*, documented in its own header as a deliberate choice, including on the destroyed-window drop path. (b) `preload/index.ts` is a bare pass-through with no logging. (c) `timelineBridge.ts`, `daemonEventBridge.ts` and `modalBridge.ts` each `JSON.stringify(event)` into an `assertNever` Error — but `modelAnnounced` is an explicitly handled `case` in all three (`timelineBridge.ts:169`, `daemonEventBridge.ts:139`, `modalBridge.ts:99`, verified by grep), so that sink is a compile-time impossibility for this arm. (d) `announcedModelBridge.ts` has `default: null` and no logging at all, and because the id stops there it cannot reach any renderer-side sink downstream — **the scope boundary is also a log-sink boundary.** (e) The renderer diagnostics channel (`shared/ipc/diagnostics.ts`) carries its own fixed-shape `RendererDiagnosticEvent` behind a projector and has no `DaemonEvent` path, so an event cannot reach it without a code change. Finally the decode-side content-free log is pinned by `inboundMessage.test.ts:3558` with an explicit "never the conversation_id, the model or the cut flag" assertion and an exact field set, plus `:3583`'s "does NOT log on the malformed throw path" — both must stay green **without being edited**, which is what makes them independent checks rather than restatements of intent. `parseModelAnnouncedPayload`'s own error names the failure category only (`'malformed model_announced payload'`) and never interpolates a value; its doc at `:897-898` states this explicitly for both `model` and the id.
- **[8. Concurrency]** Not applicable — no async task, timer, listener, `AbortController` or cancellation surface is added, and no connection lifecycle changes. The emit is synchronous within the existing per-frame handler; adding a field to a literal introduces no shared state, no check-then-act gap across an `await`, and no new shutdown-safety case. `AnnouncedModelData`'s single app-lifetime subscription is untouched.
- **[9. Threat model alignment]** No findings, and the hostile-daemon case is the one that matters for a routing key. **Hostile daemon response:** a hostile or impersonating daemon controls this value entirely. Within this ticket that buys nothing — **no consumer reads the field.** `translateModelAnnounced` (`announcedModelBridge.ts:39-45`) returns a fresh two-field literal read by name, and the untouched output assertions listed in § Design 3 are deterministic runtime guards that it stopped there — **measured: the whole bridge suite is 15/15 green with the arm widened and every output assertion left at two fields.** The value is never rendered as markup, never a filename, cache key, lookup path, attribute or URL. Parsing stays defensive and fail-closed. **Malicious relay:** unchanged — it is on-path and content-blind, and this ticket adds nothing it can drop, delay or reorder that it could not already. **Renderer compromise reaching the transport:** unchanged — the flow is one-way main→renderer and grants the renderer no new capability. **Token theft from disk:** not applicable, nothing persisted. **The real exposure is #588's / #674's**, where the id first becomes a lookup key into per-conversation state; a hostile or unknown id must be handled there as an explicit no-match, never as a fallback onto the open conversation. Named here as **OUT OF SCOPE, owned by #588 / #674** — and it is the reason this ticket refuses an optional field, since `?? activeConversation` is exactly the misattribution primitive a hostile id would want.

**One note carried forward, not a finding.** This ticket's diff *reduces* the volume of stated safety claims in the codebase — three "drops the id" assertions retire, including the family's only **arithmetic** one. That is correct, since they became false, but it means the security argument for this arm now lives entirely in the rebuilt prose at `events.ts:231-…` and `daemonConnection.ts:692-…`. **Reviewers should read that prose as a deliverable, not as commentary:** if it does not state the routing-key argument and the "reaches no sink" claim explicitly, *and* keep `model`'s untrusted-text warnings intact and distinct from the id's, the rebuild is incomplete even when every test is green and the AC3 gate returns 0. A `git diff --word-diff=porcelain` removed-token multiset over `events.ts` and `daemonConnection.ts` is the cheapest way to confirm the argument was *replaced* rather than softened — and the specific token to look for is the retired count clause, which must not reappear renumbered.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-25
