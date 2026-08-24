# #742 — Carry the conversation id on the `compacting` IPC arm

**Size:** S · **Labels:** `enhancement`, `security-sensitive` · **Parent:** #730 (split) · **Sibling:** #743 (render-end citation sweep, blocked by this) · **Consumer:** #674

Measured against `main` at `c3013e4` — the exact commit the ticket body names, after #738 (PR #741) merged. **`git log --oneline -1` confirms HEAD is `c3013e4`, so the body's baseline had not drifted by the time this spec was written.** Every count, line number and hazard in the body was re-run at that commit rather than trusted. All of them held; nothing needed correcting. The two things the body left open — the compiler/runtime cascade, and the "prefer line-count-neutral, but check" instruction — are measured here in § The cascade and § The neutrality question.

## Design source

N/A — transport / IPC-boundary work with no rendered surface. The ticket body carries no `## Figma` section, correctly: this slice changes no behaviour anyone can see, the compaction banner keeps reading the open conversation and must render identically, and the per-conversation UI that consumes this field is #674. The visual-fidelity check is intentionally skipped.

## Files to read first

Codegraph is not indexed for this repo (`.codegraph/` holds `config.json` + `.gitignore`, no DB — confirmed 2026-08-24 and unchanged), so this list was built by `git grep` + read rather than `codegraph_context`. Line ranges are `c3013e4`.

| Path | What to extract |
|---|---|
| `src/shared/ipc/events.ts:146-163` | **The template.** #737's rebuilt `apiRetry` arm doc — the exact security argument to rebuild here, written for this exact widening one ticket ago. `:157-163` is precisely the routing-key paragraph AC4 half two asks for. Read before writing a word of prose. |
| `src/shared/ipc/events.ts:111-125`, `:126-145` | The same rebuild two and three arms earlier (`turnState` #724, `stallDetected` #732). Three independent samples of the house voice. |
| `src/shared/ipc/events.ts:173-181` | The `compacting` doc block. **The safety argument to rebuild — the single most important site in this ticket.** `:182` is the arm. |
| `src/shared/ipc/events.ts:214-215`, `:224` | Two cross-references that go false. `:214-215` drops its comparator entirely; `:224` loses one name and goes singular. |
| `src/main/daemonConnection.ts:639-661` | **The other template.** #737's rebuilt `api-retry` emit + doc, immediately above yours. `turn-state` at `:605-620` and `stall` at `:621-638` are the same shape. |
| `src/main/daemonConnection.ts:662-673` | The `compacting` emit + doc. **Both change.** `:663-665` is the never-a-spread paragraph and **stays**; `:666-667` is the DROP sentence and goes. |
| `src/main/daemonConnection.ts:697-714` | `background-task-started`. **`:706` only** — its last referent dies here. `:707-708` already states the replacement rule. |
| `src/main/daemonConnection.ts:674-696` | `model-announced`. `:683-684` also says "`conversation_id` is DROPPED" but names **no comparator** — true, and **not yours**. Read to confirm you leave it alone. |
| `src/main/transport/inboundMessage.ts:123-129` | The `compacting` decode paragraph. **The `:125-126` clause only.** `apiRetry`'s at `:112-121` is the in-file template. |
| `src/main/transport/inboundMessage.ts:149`, `:188-189` | **Two traps that look exactly like the defect and are not.** See § The adjacency traps. Do not repair either. |
| `src/main/transport/inboundMessage.ts:651-658` | `parseCompactingPayload` — `requireString(payload, 'conversation_id')` + `requireBoolean`, returning a fresh two-field literal. This is why AC1's fail-closed half is free. **Do not change it.** |
| `src/shared/wire/types.ts:332-340` | `CompactingPayload` already declares `conversation_id: string`, required. No wire change. `:333`'s "field-for-field" is about the *wire* payload mirroring the *daemon's* — true, freshly correct after #738. **Do not touch.** |
| `src/main/daemonConnection.test.ts:1640-1726` | The whole `compacting` describe block. Five tests; four change, `:1714` (fail-closed) must stay green untouched. |
| `src/renderer/src/store/timelineBridge.ts:114-120` | Where the id stops: a filter + fresh literal read by name. **Unchanged — the file must not appear in `git diff --name-only`.** |
| `src/renderer/src/store/timelineBridge.test.ts:230-236`, `:275-280` | The two seam blocks. `:231`/`:276` gain the field; `:233`/`:278` and `:235`/`:279` must not change. Read both whole blocks before editing either. |
| `src/main/emitDaemonEvent.ts:24-46` | The forwarder: no transform, no clone, **no logging, by construction** (stated in its own header). Load-bearing for the security review. |
| `docs/specs/architecture/737-apiretry-conversation-id.md` | The direct precedent spec — same file set, same union, one arm over. Its § Security review is the shape this one follows. |
| `docs/specs/architecture/732-stalldetected-conversation-id.md`, `724-turnstate-conversation-id.md` | The two earlier members of the family. |

## Context

The wire's `CompactingPayload` declares `conversation_id: string`, always present, and `parseCompactingPayload` (`inboundMessage.ts:651-658`) already decodes it fail-closed as a required string alongside the edge. The emit at `daemonConnection.ts:672` then carries `active` onward and deliberately throws the id away, on the stated assumption that there is exactly one active conversation.

That assumption is what the desktop sidebar retires: a chat must keep working while the operator looks at another one, and the list must show each chat's state (operator ruling, 2026-08-21). Phase landed in #724, liveness in #732, retry in #737; compaction is this one.

Client-side only — no daemon work, no wire change, no new capability.

### What makes this arm different from #737

`apiRetry` already carried three fields, so its retired claim was narrow. `compacting` carries **one bool and nothing else**, so its claim is the strongest in the family and the most load-bearing:

> "what crosses IPC is one bool and nothing else — no token, key, raw frame, or conversation content can ride an arm with no string field on it" (`events.ts:176-178`)

Adding a string is precisely what falsifies it, and this is the **last** arm in the family whose safety argument rests on the *absence of a string* rather than on the *nature of the string*. There is no weaker version of this claim to retreat to — it must be **replaced, not patched and not softened**. #724, #732 and #737 have already written the replacement three times; rebuild it in this arm's voice.

**Over-deletion is the stated risk and the gate rewards it.** AC4 half one counts to zero, and deleting the security paragraph satisfies it. AC4 half two exists precisely to make that a failure. See § What the rebuilt prose must establish.

## Size check — one red line trips, and the ticket is still S

Measured on `c3013e4`:

| Gate | Limit | This ticket |
|---|---|---|
| New files | 3 | **0** |
| Production source files with modified content | ≥5 forces a split | **3** — `events.ts`, `daemonConnection.ts`, `inboundMessage.ts` |
| Total written lines (production + tests + prose) | ~600 | **≈110** |
| New exported types / components | 5 | **0** |
| Construction sites needing simultaneous update | 10 | **12** ⚠️ |
| Reject branches added | 10 | **0** |
| Acceptance criteria | 5 | **4** |

**The 12-site count is above the gate and is stated as 12, not re-counted down.** No "mechanical", "collapsible", "trivial fixture cascade" or "the additive change doesn't fan out" framing is applied — each site is a real Edit in a block the developer must read first, and § The census shows four separate `replace_all` hazards that make a blind sweep actively wrong. The ticket still ships as one, for three structural reasons:

1. **No split exists.** Adding a *required* field to a discriminated-union member is atomic: every intermediate state is a red build, so any child would fail "each child stands alone". The only line-drawable alternative — land it optional, then tighten — is forbidden by the ticket and by #730's split ruling, because an optional routing key invites `?? activeConversation` fallbacks, which is the misattribution this whole work exists to remove. **Verified, not asserted:** § The cascade shows the compiler forcing all six renderer-side literals in the same commit.
2. **The splittable half is already split off.** #742 *is* child A of #730. The four renderer comments — the part that no compiler edge reaches and that therefore genuinely stands alone — are #743, blocked on this one, sharing no file with it.
3. **The precedent is measured, not projected.** #724 shipped this exact change on this exact union at **16** sites, S, first pass. #737 shipped it at **15** sites, S, first pass, review PASS with one nit. This ticket sits below both at 12.

Recorded as a deliberate override of the 10-site gate on measured evidence, matching #724 and #737. **The file-count gate — the one atomicity may never override — reads 3 of 5 and is the reason #730 was split in the first place** (it stood at 6 production files; the two comment-only renderer files are what pushed it over, and they are now #743's).

## Design

Two production line edits. Everything else is prose and test fixtures.

### 1. The IPC arm — `src/shared/ipc/events.ts:182`

The arm gains one required field:

```ts
| { type: 'compacting'; active: boolean; conversationId: string }
```

**Required, never optional** — settled at #730's split, identical to #724's, #732's and #737's ruling.

### 2. The emit — `src/main/daemonConnection.ts:672`

The fresh literal gains one named copy from the already-decoded payload:

```ts
emitDaemonEvent(sink, {
  type: 'compacting',
  active: inbound.compacting.active,
  conversationId: inbound.compacting.conversation_id
})
```

**By name, never `...inbound.compacting`.** This is the house idiom at every emit in the file and is what stops a decoder that later grows a field from smuggling it across IPC. snake→camel at the boundary, as everywhere else. `daemonConnection.test.ts:1710`'s `Object.keys` guard is the deterministic proof.

**The one-liner cannot survive.** The single-line form measures **144 characters** against a file max of 111, so the emit necessarily expands from one line to five, matching every other multi-field emit in the file. This is the reason `daemonConnection.ts` cannot be line-count-neutral — see § The neutrality question.

### 3. Where the id stops

`translateTimelineEvent` (`timelineBridge.ts:114-120`) keeps returning a fresh `{ type: 'compacting', active: event.active }` literal read by name. `ThreadEvent.compacting` (`threadTimeline.ts:150`) keeps its one field. The reducer and the screen selector are untouched.

**Measured, not assumed:** with the arm widened and the emit wired, `tsc -p tsconfig.web.json` reported **zero** errors in `timelineBridge.ts` and `threadTimeline.ts`, and `vitest` ran `timelineBridge.test.ts` **38/38 green with no edit at all**. A filter + fresh literal compiles *and* passes unchanged when the source arm grows a field.

**The seam gets a free deterministic guard and it is already written.** `timelineBridge.test.ts:233` and `:278` (`expect(translated).toEqual({ type: 'compacting', active: … })`) fail on an extra own enumerable property, so a bridge that ever spread the event turns them red. **Leaving them alone IS the test for AC3.** Do not add a new test, and do not "update" them to match the widened arm — widening the arm does not make them type errors (`toEqual` is loosely typed), so they stay green or go red purely on runtime behaviour. That is what makes them real assertions rather than restatements of the type. Their `not.toBe(event)` companions at `:235`/`:279` are likewise untouched.

### 4. Edge semantics are unchanged and must stay that way

`compacting` is neither onset-only nor deduped: N frames produce N events, verbatim repeats included. `active: false` is an explicit falling edge, not an absence. It is **banner-only** — the wire streams no compaction progress and none may be invented. The transport holds no state and must keep holding none: **adding a field must not tempt anyone into adding dedup, coalescing, a timer or a last-value memo at the emit — and none keyed by the new id either.** `daemonConnection.test.ts:1677-1694` is the no-dedup guard: two events stay two events, only the literals grow a field.

## The census — `replace_all` is UNSAFE, repo-wide

`git grep -n "type: 'compacting'"` returns **19 lines across 11 files** (re-run at `c3013e4`; matches the body exactly). **12 change, 7 must not** — and the twelve *includes the two production lines*, so only **ten** are test-side literals.

**The 12 that change:**

`events.ts:182` · `daemonConnection.ts:672` · `daemonConnection.test.ts:1660`, `:1674`, `:1691`, `:1692` · `timelineBridge.test.ts:231`, `:276` · `daemonEventBridge.test.ts:269`, `:270` · `modalBridge.test.ts:155` · `announcedModelBridge.test.ts:73`

**The 7 that must NOT change** — five are `ThreadEvent` or the bridge, two are wire envelopes:

| Site | What it is |
|---|---|
| `threadTimeline.ts:150` | the `ThreadEvent` arm declaration — *file not in this ticket's set* |
| `threadTimeline.test.ts:83` | `function compacting(active: boolean): ThreadEvent` — *file not in this ticket's set* |
| `timelineBridge.ts:120` | the bridge's fresh literal — *file not in this ticket's set* |
| `timelineBridge.test.ts:233`, `:278` | **the AC3 proof.** Untouched and green |
| `daemonConnection.test.ts:291`, `inboundMessage.test.ts:179` | `encodeEnvelope({ … type: 'compacting' … })` — the **wire envelope kind**, not a `DaemonEvent`. The payload beside them already carries `conversation_id` |

A blind `replace_all` corrupts all seven. **Widening `ThreadEvent` to make the suite pass silently destroys the scope boundary this ticket depends on — and it is also a log-sink boundary (see § Security review [7]). Do not do that.**

**The cheapest proof you did not reach past your own boundary is `git diff --name-only`: it must name exactly eight files** — `events.ts`, `daemonConnection.ts`, `inboundMessage.ts`, `daemonConnection.test.ts`, `timelineBridge.test.ts`, `daemonEventBridge.test.ts`, `modalBridge.test.ts`, `announcedModelBridge.test.ts` — **and must never name `threadTimeline.ts`, `threadTimeline.test.ts`, `timelineBridge.ts`, `wire/types.ts`, `inboundMessage.test.ts`, `ConversationScreen.tsx` or `ConversationScreen.test.tsx`.**

### The four `replace_all` hazards — all re-measured, none safe

1. **`type: 'compacting'` inside `timelineBridge.test.ts`.** `:231` and `:276` change; `:233` and `:278` must not. Same file, same literal, opposite verdicts.
2. **The test-name family.** Seven tests in `daemonConnection.test.ts` share the byte-identical suffix `' modeled properties, never a spread of the decoded payload'`: `:1595` five · **`:1696` two ← ours** · `:1805` three · `:1932` seven · `:2095` five · `:2302` four · `:2453` four. Two "five"s and two "four"s, so the **suffix is not a safe key**. The full string `'emits exactly the two modeled properties, never a spread of the decoded payload'` is currently unique — key on that.
3. **`not.toContain('conv-1')` appears 7 times** in `daemonConnection.test.ts`: `:1361`, `:1386`, **`:1662`**, `:1757`, `:2411`, `:2815`, `:2933`. Exactly one — `:1662` — is compacting's and **inverts**. The other six belong to arms that still drop the id and stay untouched and green. The same trap sits on the comment above each: `// conversation_id is dropped at the choke point` at `:1360`, **`:1661`**, `:2410`, `:2814`, `:2932`.
4. **The test-name suffix `(conversation_id dropped)` appears 4 times**: **`:1650`** (ours) · `:1745` (`modelAnnounced`, goes in #714) · `:2789` (`toolUse`) · `:2907` (`toolResult`). The other three are **still true** — those arms still drop the id — and sweeping them would make three test names lie in the *opposite* direction.

## The cascade — compiler- and runtime-enumerated, not estimated

Measured by applying the two production edits, running each `tsc` project separately, then running `vitest`, then reverting.

**Node half (`tsconfig.node.json` = `src/main` + `src/preload` + `src/shared`) — exactly 1 error, and it is the emit itself:**

```
src/main/daemonConnection.ts(672,35): error TS2345:
  Property 'conversationId' is missing in type '{ type: "compacting"; active: boolean; }'
```

**Web half (`tsconfig.web.json` = `src/renderer/src` + `src/shared`) — exactly 6 errors:**

| Site | Code |
|---|---|
| `announcedModelBridge.test.ts:73` | TS2322 (`const others: DaemonEvent[]`) |
| `daemonEventBridge.test.ts:269`, `:270` | TS2345 (`translateDaemonEvent(…)` argument) |
| `modalBridge.test.ts:155` | TS2322 (the ignore array) |
| `timelineBridge.test.ts:231`, `:276` | TS2322 (`const event: DaemonEvent = …`) |

**Two traps, both confirmed by measurement:**

- **`npm run typecheck` is `&&`-chained** (`tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json`), so the single node-side error **masks all six web errors** until the emit is fixed. Confirmed directly: with the arm widened and the emit *not* wired, the node half reports 1 error and the web half never runs. **One clean run is not evidence you are done — seeing the second half fail *after* the first passes is the only proof the cascade was enumerated.**
- **Four more sites are runtime-forced and invisible to `tsc`**, because `toEqual` and `Object.keys` are loosely typed. With production edited and tests untouched, `vitest` reports **exactly 4 failures, all in the compacting describe block**:
  - `:1650` "decodes a rising-edge compacting…" (fails at `:1660`)
  - `:1665` "emits the falling edge…" (fails at `:1674`)
  - `:1677` "does NOT dedup…" (fails at `:1691`/`:1692`)
  - `:1696` "emits exactly the two modeled properties…" (fails at `:1710`)

  **`:1650` must be fixed twice.** `:1660`'s `toEqual` throws *before* `:1662`'s leak guard ever executes, so the guard does not appear in the failure list on the first run. Fix `:1660`, re-run, and `:1662` then fails — invert it deliberately at that point rather than treating the second failure as a surprise.

**Measured green, requiring no edit:** `timelineBridge.test.ts` (38/38) and `inboundMessage.test.ts` (357/357), including the content-free log tests at `:3531`/`:3550` and the forward-compat test at `:1705`. If any of those goes red, the change is wrong.

## `daemonConnection.test.ts:1696` — the one edit no mechanical check reaches

`tsc` does not read test names. Neither does vitest. AC4's gate anchors its `test-name` pattern on `rising-edge compacting`, so it never sees this one. **The classification table below is the only thing that catches it.**

What *will* pull the developer into this test is `:1710` immediately below it, which fails under vitest. **Change both while you are there:** `:1696`'s name two → three, and `:1710`'s `expect(Object.keys(events[0]).sort()).toEqual(['active', 'type'])` → `['active', 'conversationId', 'type']` (sorted position is between the two).

**`:1711`'s `not.toContain('must-not-cross')` and `:1705`'s planted `smuggled: 'must-not-cross'` field both stay exactly as they are.** Together they are AC1's "copied by name" proof, and deleting either removes the only deterministic check that the emit is not a spread. A green AC4 gate is **not** evidence that `:1696` was fixed.

## The classification

**CHANGE — production and type (8 regions, 3 files):**

| Site | Edit |
|---|---|
| `events.ts:173-181` | **rebuild the doc block** — the retired safety claim is here. See § What the rebuilt prose must establish |
| `events.ts:182` | the arm gains `conversationId: string` |
| `events.ts:214-215` | `modelAnnounced`'s "(single active conversation, matching / compacting)" — **drop the comparator entirely, do not re-point it** |
| `events.ts:224` | `backgroundTaskStarted`'s "unlike toolUse / compacting, which drop it" → "unlike toolUse, which **drops** it" (singular) |
| `daemonConnection.ts:666-667` | the DROP sentence only. **`:663-665` is the never-a-spread paragraph and stays** |
| `daemonConnection.ts:672` | the emit (expands to 5 lines) |
| `daemonConnection.ts:706` | "the deliberate divergence from compacting above" — its last referent dies here. **Rewrite, do not trim:** state the rule `:707-708` already gives (daemon STATE keyed by id, the #720 queue-state rule), never a fresh neighbour list |
| `inboundMessage.ts:125-126` | **this clause only** — "so the consumer carries just the edge (`active`) onward, dropping `conversation_id`" |

**CHANGE — tests (15 sites, 5 files):**

| Site | Edit | Caught by |
|---|---|---|
| `daemonConnection.test.ts:1650` | test **name** — drop "(conversation_id dropped)" | AC4 gate |
| `:1660` | `toEqual` gains the id — **the AC2 round-trip proof** | vitest |
| `:1661` | the comment above the leak guard | AC4 gate |
| `:1662` | `not.toContain('conv-1')` → **inverted to a positive assertion, never deleted** | vitest (only after `:1660` is fixed) |
| `:1674` | `toEqual` — the falling edge | vitest |
| `:1691`, `:1692` | `toEqual` — the no-dedup guard. **Two events stay two events**; only the literals grow a field | vitest |
| `:1696` | test **name** — "the two modeled properties" → **three** | ⚠️ **nothing** — see the section above |
| `:1710` | `Object.keys(…).sort()` → `['active', 'conversationId', 'type']` | vitest |
| `timelineBridge.test.ts:231`, `:276` | `const event: DaemonEvent = …` | TS2322 |
| `daemonEventBridge.test.ts:269`, `:270` | `translateDaemonEvent(…)` argument | TS2345 |
| `modalBridge.test.ts:155` | the "arms this bridge must ignore" array | TS2322 |
| `announcedModelBridge.test.ts:73` | the "arms this bridge must ignore" array | TS2322 |

Both ignore arrays take the shape `apiRetry` already has post-#737 — `modalBridge.test.ts:153` is the live in-file example. Use `conversationId: 'conv-1'` throughout, matching the value `compactingPlaintext({ conversation_id: 'conv-1' })` already puts on the frame. **Do not introduce a shared fixture builder** — no such module exists in this repo; every suite hand-rolls inline literals.

**KEEP — every one of these is TRUE after the change and must survive:**

| Site | Why it survives |
|---|---|
| `daemonConnection.ts:683-684` | `modelAnnounced`'s own "`conversation_id` is DROPPED" — names **no comparator**. True, and #714's when it changes |
| `daemonConnection.ts:663-665` | the never-a-spread idiom paragraph. True and load-bearing |
| `inboundMessage.ts:149`, `:188-189` | classification lists, not drops-the-id lists — see § The adjacency traps |
| `inboundMessage.ts:651-658` | `parseCompactingPayload`. Unchanged; it is what makes AC1 fail-closed free |
| `wire/types.ts:333` | "Mirrors the daemon's CompactingPayload **field-for-field**" — about the *wire* payload mirroring the *daemon's*. True, and freshly re-verified by #738 |
| `daemonConnection.test.ts:1714` | "drops a malformed compacting" — the **frame**, not the id. Green untouched |
| `daemonConnection.test.ts:1745`, `:2789`, `:2907` | the three sibling `(conversation_id dropped)` names. Still true |
| `daemonConnection.test.ts:1361`, `:1386`, `:1757`, `:2411`, `:2815`, `:2933` | the six sibling leak guards, plus their comments at `:1360`, `:2410`, `:2814`, `:2932`. Untouched and green |
| `daemonConnection.test.ts:1705`, `:1711` | the planted `smuggled` field and its guard. **AC1's proof** |
| `timelineBridge.test.ts:230`, `:233`, `:235`, `:275`, `:278`, `:279` | names about the **ThreadEvent** + the AC3 proof + the freshness guards |
| `inboundMessage.test.ts:1705` | "keeping exactly **the two known fields**" — the **wire** payload's two, which do not change. ⚠️ Do not sweep with `:1696`'s two→three; they count different things in different layers |
| `inboundMessage.test.ts:3531`, `:3550` | the content-free log tests. Green **without being edited** |
| `threadTimeline.ts:148-149` | "One bool, no string field … stays true by construction" — scoped to the **ThreadEvent**, true even after #743. Sits four lines below `:144`, which does go false. **Do not sweep the pair together** |
| `timelineBridge.ts:115-116`, `threadTimeline.ts:144`, `ConversationScreen.tsx:121-122`, `ConversationScreen.test.tsx:1244` | **all four go false when this lands, and all four are #743's.** Re-read at `c3013e4`; all still carry the claim. Touching them here re-creates the six-file shape #730's split exists to avoid |

## The adjacency traps

Three sites read exactly like the in-scope defect. All three stay, and each has an independent reason.

- **`inboundMessage.ts:149` — rewritten by #733 (`0b42fa9`) on purpose.** It reads "Unlike its `stall` / `api-retry` / `compacting` neighbours it is not a claude sub-state at all", and the contrast it draws is **classification**, not "those neighbours drop the id". #733 deliberately replaced the old "…**so** the consumer carries ALL SIX fields onward" with "It is daemon STATE keyed by id, and **THAT is why** ALL SIX fields cross" — the "so"-inference that once rested on the neighbours' behaviour no longer exists. **Two independent proofs it is a classification list:** the same list survived #732 widening `stall` and #737 widening `api-retry`, untouched both times. Editing it undoes #733's repair.
- **`inboundMessage.ts:188-189` — trimmed by #725 on purpose.** Its "dropping `conversation_id`" is about **unrecognized-message itself**, not about compacting. #725 already removed the cross-reference.
- **`wire/types.ts:333` — a different boundary.** "field-for-field" there is *wire payload ↔ daemon payload*, not *IPC arm ↔ wire payload*. A sweep broadened by dropping the word "identical" will hit it, and #738 has just been through this file. **This is the same "ask which boundary a claim is about, not which arm it names" rule #738's review turned on.**

## The neutrality question — checked, and the answer differs per file

The ticket says *"prefer line-count-neutral comment edits — but check, never obey."* Checked. **Every downstream `file.ts:NNN` back-reference below these edits was resolved against what that line actually holds today:**

| File | Live citers below the edits | Their state at `c3013e4` | Ruling |
|---|---|---|---|
| `events.ts` | `announcedModelStore.ts:15` → `events.ts:179-185`; `:61` → `:174-211`; `:79` → `:194`; `:99` → `:208-209` | **All four already stale by ~9 lines.** `:194` is "own payload doc draws it", not the cited "`false` is a VALUE" (that is `:203`); `:208-209` is the NEVER-HTML warning, not the cited no-dedup claim (that is `:217-218`) | **Neutrality buys nothing. Write the prose the change needs.** |
| `daemonConnection.ts` | `announcedModelBridge.ts:30` → `:686` (**accurate**); `index.ts:261` → `:1479` (stale); `runSettingsWriteStore.ts:117` → `:1490` (stale) | one live, two stale | **Neutrality is impossible** — the emit must expand 1→5 lines (144 chars > the 111 max), so `:686` shifts by ≥4 whatever you do. Don't pay for it elsewhere; just don't sprawl |
| `inboundMessage.ts` | `conversationArchivedBridge.ts:6` → `:1073` | **already stale** (`:1073` is `function parseConversationsPayload`) | Neutral where free — it is a single-clause rewrite — but no obligation |

**Conclusion: do not compress the security argument to hit a line count.** The `events.ts` block *will* grow — #737's `apiRetry` doc is 18 lines and #732's `stallDetected` doc is 20, against `compacting`'s current 9 — and that is correct. Re-anchoring the four already-broken `announcedModelStore.ts` citations is **not this ticket's work** (they are `src/renderer`, outside the scope boundary, and would add a fourth production file and a second concern); they were already wrong before this ticket and stay equally wrong after it.

**What to measure instead is width, not line count.** This repo has no prettier and no formatter, so nothing re-wraps a comment you widen. Max line width at `c3013e4`, re-measured:

| File | Max width |
|---|---|
| `events.ts` | 110 |
| `daemonConnection.ts` | 111 |
| `inboundMessage.ts` | 112 |

Run `awk '{print length}' <file> | sort -n | tail -1` **before and after** each file and do not raise the maximum. Mirroring the wrap column of the `apiRetry` template directly above yours gets this for free in all three files.

## What the rebuilt prose must establish

Write it in each file's own voice — these are the claims, not the wording. `events.ts:146-163` and `daemonConnection.ts:639-653` are the working templates, one arm above each edit.

- The arm carries `conversationId`, copied **by name** from the already-decoded payload — never a spread.
- The decode stays fail-closed: a missing or non-string `conversation_id` fails the whole line without emitting, exactly as today.
- The id is a **daemon-asserted routing key**, not operator text and not model-influenced text — none of the untrusted-text warnings on `model` / `description` / `raw` attach to it. It is never markup, a filename, a cache key, a lookup path, an attribute or a URL, and it reaches no log sink (`emitDaemonEvent` is log-free by construction, and the decode-side compacting log is pinned content-free independently).
- The id **stops at the renderer timeline bridge**, which rebuilds a fresh `ThreadEvent` literal with named fields; `ThreadEvent.compacting` keeps its one field. The consumers that route by conversation are #674.
- The **"turn-stream item, or daemon state?" test** (stated canonically at `events.ts:114`) is why it crosses: per-conversation compaction is daemon state, so the sidebar can show a chat is busy compacting while the operator looks at a different one (#674).
- **Required, never optional**, and why — an optional routing key invites `?? activeConversation` fallbacks.
- The edge semantics survive the rewrite verbatim: banner-only (no progress on the wire, none may be invented), not onset-only, not deduped, `active: false` a value, no state at the emit and none keyed by the new id.

**AC4 half two is graded on this list.** The retired claim — *"what crosses IPC is one bool and nothing else — no token, key, raw frame, or conversation content can ride an arm with no string field on it"* — must be **REPLACED, not softened and not deleted**. The safety framing now rests on the field's *nature* (a routing key that reaches no sink) rather than on the absence of a string. A rewrite that merely deletes the sentence passes the gate and fails the criterion, and leaves this arm the only one in the family with no stated security argument.

**Never repair a cross-reference by re-pointing it at a sibling arm.** #714 widens `modelAnnounced` next, so a comment rewritten to say "unlike `modelAnnounced`, which drops it" goes false again in one ticket. State the rule, not a neighbour list.

## State + concurrency model

Unchanged. No new async work, no new subscription, no teardown surface. The field rides the existing `emitDaemonEvent` → `DAEMON_EVENT_CHANNEL` → preload pass-through → bridge path, synchronous per frame and already owned.

Adding a required field to an existing arm does not break exhaustive `switch` statements — they discriminate on `type`. **No consumer *code* changes**; only construction sites do. Confirmed by measurement: all four exhaustive bridges (`timelineBridge.ts:114`, `daemonEventBridge.ts:133`, `modalBridge.ts:94`, plus `threadTimeline.ts:521` on the ThreadEvent side) already have an explicit `case 'compacting'`, and none produced a compiler error under the probe.

## Error handling

No new failure mode. The decode is the only place that can fail and it is unchanged: `parseCompactingPayload` (`inboundMessage.ts:651-658`) already `requireString`s `conversation_id`, so a missing or non-string value already throws `WireDecodeError` and drops the whole line without emitting. The fail-closed test at `daemonConnection.test.ts:1714` passes unchanged and is the proof — **measured green under the probe.**

The emit cannot fail on the new field: it reads an already-validated `string` off an already-narrowed payload.

## Testing strategy

Unit tests only (`npm test`, vitest). **No new test file and no new test** — one assertion inverts, one key-set grows, four literals gain a field, two names change. Bullet-pointed scenarios, not test code; the developer writes these in the suite's existing idiom.

- **Round-trip (`daemonConnection.test.ts:1650-1663`), modified — four edits in one test.** The name drops "(conversation_id dropped)"; `:1660`'s `toEqual` gains `conversationId: 'conv-1'` and becomes the **AC2 proof** that the frame's id reaches the emitted event verbatim; `:1661`'s comment goes with it; `:1662`'s leak guard **inverts to a positive assertion** — it asserts the opposite of the new contract, and it **never executes** until `:1660` is fixed, so it must be inverted deliberately rather than left to "pass".
- **Falling edge (`:1665-1675`), literal-only.** `active: false` stays an explicit value.
- **No-dedup (`:1677-1694`), literal-only.** Must still assert **two** events after the change — only the literals grow a field. This is the guard against anyone adding edge-tracking state to the emit.
- **Anti-spread (`:1696-1712`), name plus one array.** `:1710` → `['active', 'conversationId', 'type']`. **`:1705`'s `smuggled: 'must-not-cross'` and `:1711`'s `not.toContain('must-not-cross')` both stay** — together they are AC1's "copied by name" proof.
- **Fail-closed (`:1714-…`), unchanged.** Must stay green untouched.
- **Bridge seam (`timelineBridge.test.ts:230-236`, `:275-280`), half-modified.** `:231` and `:276` gain the field for `tsc`; `:233`, `:235`, `:278`, `:279` stay exactly as written. **Them staying green *is* AC3.** Do not add a new test for it. Measured: the whole file is 38/38 green before any edit, so the two edits are compiler-driven only.
- **Ignore arrays (`daemonEventBridge.test.ts:269`/`:270`, `modalBridge.test.ts:155`, `announcedModelBridge.test.ts:73`), literal-only.** All four are `tsc`-forced; their runtime assertions (`toBeNull()`) pass either way.
- **Content-free logging (`inboundMessage.test.ts:3531`, `:3550`), untouched.** Pins the `compacting` log to a fixed field set and asserts the conversation id never appears. Must stay green **without being edited** — this ticket changes what crosses IPC, not what reaches a log. **Measured green under the probe.** If it goes red, the change is wrong.
- **Decode tests (`inboundMessage.test.ts`), untouched — 357/357 green under the probe.** The decode already carries `conversation_id` and already strips unknown keys.
- **Reducer (`threadTimeline.test.ts`), untouched.** A different union.
- **`e2e/` is unaffected** — a case-insensitive grep for `compacting` across `e2e/` returns **zero** matches, re-verified at `c3013e4`.

Gates: `npm run typecheck` (twice — see the `&&` trap in § The cascade), `npm test`, `npm run build`.

**AC4 half one, re-run:** the body's gate returns **8** on `main` at `c3013e4` — verified, with the per-file split `events.ts` 3, `daemonConnection.ts` 2, `inboundMessage.ts` 1, `daemonConnection.test.ts` 2, and each of the eight sub-patterns matching exactly once. It must return **0**. Because the gate rewards deletion, pair it with the positive check in § What the rebuilt prose must establish, and check `:1696` by hand — the gate is anchored on `rising-edge compacting` and cannot see it.

## Open questions

None blocking. One judgement call: whether `conversationId` goes before or after `active` in the arm and the emit literal. `turnState` and `backgroundTaskStarted` put the id first; `apiRetry` puts it last. Pick by readability against the neighbouring arms — the `Object.keys(…).sort()` guard is order-independent, and the sorted expectation is `['active', 'conversationId', 'type']` either way.

## Security review

**Verdict:** PASS

**Findings:**

Walked in the order of the architect security-review categories. Every "not applicable" below names the design decision that closes the category rather than asserting absence.

- **[1. Trust boundaries]** No findings. Two boundaries are in play and this ticket adds neither. The untrusted→trusted one is `parseCompactingPayload` (`inboundMessage.ts:651-658`), a single named function that `requireString`s `conversation_id`, `requireBoolean`s `active`, and returns a **fresh two-field literal** — so unknown server-added keys are tolerated for forward-compat but never copied through, which is also what makes it prototype-pollution-safe (stated at `inboundMessage.ts:410`) and what `inboundMessage.test.ts:1705` pins. The boundary is explicit and typed (`CompactingPayload`), not scattered. The second is main→renderer, and the direction matters: this leg is **trusted→untrusted**, a *disclosure*, not a validation gap. What is disclosed is a conversation id — a class of value the renderer already receives on `turnState`, `stallDetected`, `apiRetry`, `queueState` and `backgroundTaskStarted` — so no new category of data reaches the web layer. Nothing flows renderer→main here. The copy is by name from a narrowed payload, never a spread, and `daemonConnection.test.ts:1696-1712` is a runtime guard on exactly that with a deliberately planted `smuggled` field; **this spec requires that field and its `not.toContain` to survive the edit**, which is what keeps the guard a test rather than a restatement of the type.
- **[2. Tokens, secrets, credentials]** Not applicable — `conversationId` is a daemon-asserted routing identifier, not a credential. It grants nothing, is never compared against a secret (so the `timingSafeEqual` rule has no site here), is not generated by this code, and is not persisted. No storage, rotation, revocation or expiry surface is introduced.
- **[3. File / storage operations]** Not applicable — nothing here touches the filesystem, and the spec forbids the field ever being used as a path component, filename or cache key. That keeps the path-traversal and TOCTOU surfaces closed *by construction* rather than by a check a later refactor could drop. No renderer-side web storage (`localStorage` / IndexedDB) is written; the field terminates at the timeline bridge and never reaches a store that persists.
- **[4. Inter-process / Electron attack surface]** No findings. No new IPC channel, no new `contextBridge` API, no new `ipcMain.handle` / `.on` — the field rides the existing `DAEMON_EVENT_CHANNEL`, whose payload type is pinned to `DaemonEvent` in `emitDaemonEvent.ts`'s sink interface, so no non-event payload can reach it. No `webPreferences`, navigation, `setWindowOpenHandler` or custom-protocol surface is touched, and no remote content is loaded. Process placement is unchanged and is the MUST-FIX category here: keys, socket and Noise handshake stay in main, and what crosses is one additional daemon-supplied string on an arm that already crosses one bool. The destroyed-window guard (`emitDaemonEvent.ts:44-45`) covers this call site as it covers the other 31.
- **[5. Cryptographic primitives]** Not applicable — no randomness, no key material, no key/nonce lifecycle, no comparison against a secret, and no change to the Noise session or its framing. The field is read out of an already-authenticated, already-decrypted frame.
- **[6. Network & I/O]** Not applicable, with one thing checked rather than assumed. No socket, relay URL, TLS, timeout, backoff or `maxPayload` decision changes — the frame already carried this field on every occurrence and was already size-capped upstream by `MAX_PLAINTEXT_BYTES`, so the arm gains no unbounded input. On flood resistance: edge semantics are explicitly held constant (no dedup, no coalescing, no timer, no last-value memo), so a hostile relay or daemon that floods `compacting` frames produces exactly the event rate it produces today. § Design 4 forbids adding state at the emit specifically because a per-id memo introduced there would be the change that opens an unbounded-map surface keyed by attacker-chosen strings — and this arm is a *more* attractive place to add one than `apiRetry` was, because "banner-only, flips at most twice per compaction" reads like an invitation to coalesce. `daemonConnection.test.ts:1677-1694` pins it, and this spec requires it to keep asserting **two** events.
- **[7. Error messages, logs, telemetry]** No findings — this is the category the retired doc comment's safety claim actually rested on ("no string field on it"), so it got the closest walk, and each sink was checked by grep rather than asserted. Five could in principle serialise the new field; all five are closed. (a) `emitDaemonEvent` (`emitDaemonEvent.ts:24-46`) is log-free *by construction*, documented in its own header as a deliberate choice, including on the destroyed-window drop path. (b) `preload/index.ts` is a bare pass-through with no logging. (c) `timelineBridge.ts:18`, `daemonEventBridge.ts:13` and `modalBridge.ts:18` each `JSON.stringify(event)` into an `assertNever` Error — but `compacting` is an explicitly handled `case` in all three (`timelineBridge.ts:114`, `daemonEventBridge.ts:133`, `modalBridge.ts:94`, verified by grep), so that sink is a compile-time impossibility for this arm. (d) `threadTimeline.ts:229` stringifies a **`ThreadEvent`** — and because the id stops at the bridge, it cannot reach that sink at all; **the scope boundary is also a log-sink boundary**, which is a second, independent reason not to widen `ThreadEvent` to silence a `replace_all` accident. (e) The renderer diagnostics channel (`shared/ipc/diagnostics.ts`) carries its own fixed-shape `RendererDiagnosticEvent` behind a projector and has no `DaemonEvent` path, so an event cannot reach it without a code change. Finally the decode-side content-free log is pinned by `inboundMessage.test.ts:3531`/`:3550` with an explicit "never the conversation_id or the edge" assertion and an exact `Object.keys` field set — **measured green under the probe without being edited**, which is what makes it an independent check rather than a restatement of intent. `parseCompactingPayload`'s own error names the failure category only (`'malformed compacting payload'`) and never interpolates a value.
- **[8. Concurrency]** Not applicable — no async task, timer, listener, `AbortController` or cancellation surface is added, and no connection lifecycle changes. The emit is synchronous within the existing per-frame handler; adding a field to a literal introduces no shared state, no check-then-act gap across an `await`, and no new shutdown-safety case.
- **[9. Threat model alignment]** No findings, and the hostile-daemon case is the one that matters for a routing key. **Hostile daemon response:** a hostile or impersonating daemon controls this value entirely. Within this ticket that buys nothing — **no consumer reads the field.** `translateTimelineEvent` (`timelineBridge.ts:114-120`) returns a fresh one-field `ThreadEvent` read by name, and the untouched `toEqual`s at `timelineBridge.test.ts:233`/`:278` are deterministic runtime guards that it stopped there — **measured: the whole bridge suite is 38/38 green with the arm widened and no edit applied.** The value is never rendered as markup, never a filename, cache key, lookup path, attribute or URL. Parsing stays defensive and fail-closed. **Malicious relay:** unchanged — it is on-path and content-blind, and this ticket adds nothing it can drop, delay or reorder that it could not already. **Renderer compromise reaching the transport:** unchanged — the flow is one-way main→renderer and grants the renderer no new capability. **Token theft from disk:** not applicable, nothing persisted. **The real exposure is #674's**, where the id first becomes a lookup key into per-conversation state; a hostile or unknown id must be handled there as an explicit no-match, never as a fallback onto the open conversation. Named here as **OUT OF SCOPE, owned by #674** — and it is the reason this ticket refuses an optional field, since `?? activeConversation` is exactly the misattribution primitive a hostile id would want.

**One note carried forward, not a finding.** This ticket's diff *reduces* the volume of stated safety claims in the codebase — six "drops the id" assertions retire, including the family's strongest one. That is correct, since they became false, but it means the security argument for this arm now lives entirely in the rebuilt prose at `events.ts:173-…` and `daemonConnection.ts:663-…`. **Reviewers should read that prose as a deliverable, not as commentary:** if it does not state the routing-key argument and the "reaches no sink" claim explicitly, the rebuild is incomplete even when every test is green and the AC4 gate returns 0. A `git diff --word-diff=porcelain` removed-token multiset over `events.ts` is the cheapest way to confirm the argument was *replaced* rather than softened.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-25
