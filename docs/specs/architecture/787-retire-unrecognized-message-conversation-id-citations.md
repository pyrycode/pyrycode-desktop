# #787 — Retire the unrecognized-message-drops-the-conversation-id citations

**Size:** S (comment-only; 3 production files, 3 comment blocks, zero executable lines, zero test churn)
**Label:** `security-sensitive` — the document *is* the security claim (the #725 / #733 / #738 / #743 / #764 / #767 precedent)
**Twin of:** #764 (`toolUse` citations, `fbc46ef`) and #767 (`toolResult` citations, `14e69a9`), both merged. Follows #784 (the arm itself, merged in PR #788).

## Design source

N/A — comment-only change, zero executable lines, no rendered surface. All three sites are `.ts` files; none touches markup, a class name, a theme token, or a copy constant. The visual-fidelity check is intentionally skipped.

## Baseline — re-measured at `f0f1529`; the body's base is STILL LIVE

The body measured at `507cc87` (`main` after #784's PR #788 merged). `main` has since advanced to **`f0f1529`** — two commits, `b795258` and `f0f1529`, both touching **`CLAUDE.md` only** (`git diff --name-only 507cc87..origin/main` returns exactly `CLAUDE.md`; the same command scoped to `src/` returns nothing). **Every offset in the body's scope table resolves byte-for-byte.** Unlike #767, no re-measurement correction is needed.

| Re-measured at `f0f1529` | Result |
|---|---|
| `inboundMessage.ts:192` resolves as quoted | **yes**, byte-for-byte (101 chars) |
| `threadTimeline.ts:151-152` resolves as quoted | **yes**, byte-for-byte (101 / 89) |
| `conversationTimelineStore.ts:10-12` resolves as quoted | **yes**, byte-for-byte (103 / 102 / 54) |
| #784's own half landed | **yes** — `timelineBridge.ts:274` routes the arm, `:275-276` reads *"Nine of the eleven owned arms"* with `#784` in its list, `:283-287` reads *"The other two owned arms"* naming only `sessionTransition` / `connected` |
| `` dropping `conversation_id` `` across `src/` + `e2e/` | **1 hit — `inboundMessage.ts:192`, the target.** The #767-era collision at `:224` is gone (#767 repaired it). See § D2 for why `replace_all` is *still* banned. |
| `[Ff]ield-for-field` in `threadTimeline.ts` | **2** — `:128` (pinned true) + `:151` (target) |
| `[Ff]ield-for-field` across `src/` + `e2e/` | **60** — every non-target one is a wire↔daemon or ThreadEvent↔ThreadItem claim (§ Pinned) |
| Census prose in any test / e2e file | **none** — `timelineBridge.test.ts:507` / `:1028` already read *"the two … owned arms"* (#784 swept them). AC4 is free. |
| Overlapping in-flight branches on the three files | **none.** `git fetch origin --prune` then a per-branch `git diff --name-only origin/main...origin/feature/<N>` over every `origin/feature/[0-9]+` — **zero remote feature branches exist**. |
| codegraph | **still unindexed** — `codegraph_status` returns *"CodeGraph not initialized for this project"*. Probed this run, not assumed. grep/Read throughout. |

**Prior-decision search:** satisfied from stronger sources than QMD would return — `docs/specs/architecture/767-retire-toolresult-conversation-id-citations.md` (read in full; its § D1–D7 rulings are re-derived here against a *different* measurement, not carried across) and `784-unrecognized-message-conversation-id-arm.md`.

**Related-ticket note (no block needed, but PO should see it):** issues **#734 and #739 are open duplicates of each other**, both targeting `inboundMessage.ts:101-102` — the same file as Site 1 (§ Known-false). Neither has a branch, so no `blockedBy` applies today; if either is dispatched while `feature/787` is live, *its* architect run will find this branch and block. Flagged so PO can close one duplicate.

## Files to read first

| Path | What to extract |
|---|---|
| `src/main/transport/inboundMessage.ts:189-192` | **Site 1.** The `unrecognized-message` kind's contract paragraph — 4 lines, `:188` / `:193` are ` *` separators. Only the tail of `:192` is false. |
| `src/main/transport/inboundMessage.ts:222-226` | **The Site 1 template** — #767's repaired `tool-result` twin: *"The consumer carries the four render fields plus `conversation_id` onward (#766)."* Copy that word order (`X plus \`conversation_id\` onward (#N)`). |
| `src/main/transport/inboundMessage.ts:194-199` | **The paragraph immediately below Site 1 — PINNED, and it contains a trap.** `:196`'s *"two required strings"* understates the decode by one under this file's own vocabulary (§ Known-false #3). **Do not touch it and do not "fix" it.** |
| `src/main/transport/inboundMessage.ts:851-869` | `parseUnrecognizedMessagePayload` — ground truth. Three `requireString` (`conversation_id` / `message_type` / `raw`), one `requireBoolean` (`truncated`), one closed-enum `site`. Read to source § Known-false #3; **edit nothing here.** |
| `src/main/daemonConnection.ts:826-853` | **The executable proof `:192` is now false.** `:846` emits `conversationId: inbound.unrecognized.conversation_id`. This is what #784 changed. |
| `src/shared/ipc/events.ts:424-446` | #784's own already-correct prose (*"It carries `conversationId` (#784) … copied BY NAME at the emit"*) plus the widened arm. **Do not edit** — already right, and the vocabulary SSOT for Site 1's replacement. |
| `src/renderer/src/store/threadTimeline.ts:151-152` | **Site 2**, 2 comment lines above the `unrecognizedMessage` `ThreadEvent` member at `:153-159`. |
| `src/renderer/src/store/threadTimeline.ts:103-104` | **The Site 2 template, and the closest one.** #764's `toolUse` repair, and the only 2-line member of the widened-sibling family: *"The tool-call arm. #763 widened the `toolUse` DaemonEvent with a `conversationId` the bridge drops, so the bridge stays a filter + fresh copy, not a remap."* Note it carries **no discipline parenthetical** (§ D3). |
| `src/renderer/src/store/threadTimeline.ts:132-133`, `:137-138`, `:144-145` | The other three widened siblings (#732 / #737 / #742). The idiom AC2 names. `:137` is **111 chars — the proven in-file comment ceiling** (§ D3). |
| `src/renderer/src/store/threadTimeline.ts:86-92` | The `unrecognizedMessage` **ThreadItem** — `site` / `messageType` / `raw` / `truncated`, no id. **This is why AC2's surviving clause is TRUE** (§ D1). |
| `src/renderer/src/store/threadTimeline.ts:128-130` | `sessionBoundary` — **pinned true**, and the control the body names: no widening clause, correctly. |
| `src/renderer/src/store/conversationTimelineStore.ts:10-12` | **Site 3**, the header census. 3 lines. |
| `src/renderer/src/store/timelineBridge.ts:265-291` | **The Site 3 template AND its ground truth** — #784's repaired `timelineTargetFor`. Nine grouped `case`s returning `event.conversationId`; two returning `null`. AC3's numbers are read off this switch, not recounted from the union. |
| `src/renderer/src/store/timelineBridge.ts:124-139` | #784's repaired bridge arm — *"the four render fields ARE field-for-field identical, and that is precisely why the drop has to stay explicit"*. **Pinned; do not re-sweep.** |
| `docs/specs/architecture/767-retire-toolresult-conversation-id-citations.md` | The direct twin. Its § D3 (`replace_all` inversion) and § D4 (line-count neutrality graded against a *measured* anchor census) are the method this spec re-applies — **its conclusions do not transfer; the measurement here inverts § D4's** (§ D4 below). |
| `docs/specs/architecture/784-unrecognized-message-conversation-id-arm.md` | What #784 actually did, so this ticket verifies against it rather than re-asserting it. |

## Context

#784 widened the `unrecognizedMessage` IPC arm with `conversationId: string` and swept its own three files — `daemonConnection.ts`, `events.ts`, `timelineBridge.ts` — in the same commit. Three comments **outside** that file set still describe the pre-#784 contract.

Site 2 is the load-bearing one, and its damage is *positional*, not just factual. Every other widened arm in `threadTimeline.ts` that carries an explanatory paragraph records the widening — `:103-104`, `:132-133`, `:137-138`, `:144-145`. After #784 the parser-gap arm belongs to that set and is the only member whose paragraph does not say so. A reader auditing "which arms carry an id the bridge drops?" by scanning this union gets a **false negative** on the one arm whose comment simultaneously asserts field-for-field identity — the exact pairing that makes "simplify the bridge to a pass-through" look safe. `timelineBridge.ts:128-131` is the enforcement half of that boundary; Site 2 is its reader-facing half.

## Design

Three comment-block repairs. No new module, no type change, no signature change, no test edit, no `type: 'unrecognizedMessage'` / `kind: 'unrecognizedMessage'` literal change.

### D1 — The sorting: exactly one of the two clauses at Site 2 is false

This is the ticket's trap, and the body names it: **a literal port of #764's diff shape deletes a true sentence.**

| Site 2 clause | Compares | Verdict |
|---|---|---|
| *"Field-for-field identical to the `unrecognizedMessage` **ThreadItem**"* | `ThreadEvent` (`:153-159`) ↔ `ThreadItem` (`:86-92`) — two **renderer-local, id-free** shapes | **TRUE — must survive** |
| *(missing)* the widening clause | `DaemonEvent` (`events.ts:439-446`) ↔ `ThreadEvent` | **ABSENT — this is what AC2 adds** |

Verified at `f0f1529`: both shapes are `site: UnrecognizedSite` / `messageType: string` / `raw: string` / `truncated: boolean`, differing only in the `type` vs `kind` discriminant. The claim is true and stays.

Contrast #764's `toolUse` site, whose old text read *"Field-for-field identical to the `toolUse` **DaemonEvent**"* — a DaemonEvent↔ThreadEvent claim the widening made false, so #764 **replaced** it. Here the clause is **added alongside**.

**Failure mode if this is got wrong:** the AC reads as satisfied, `tsc` is green, the suite is green — and a true, load-bearing statement about two renderer shapes has been deleted, in the file that defines both.

### D2 — `replace_all` is banned in all three files, and the reason has MOVED since #767

#767 banned it because `` dropping `conversation_id` `` matched two lines in `inboundMessage.ts` — `:192` (then true) and `:224` (then the target). **That collision is gone**: `:224` was repaired by #767, so the phrase now matches exactly one line repo-wide. A developer measuring only that grep concludes `replace_all` is safe. **It is not**, for a different reason:

`grep -n dropping src/main/transport/inboundMessage.ts` returns **five** lines, and a looser sweep or a wrapped-line edit reaches all of them:

| Line | Claim | Verdict |
|---|---|---|
| `:98` | assistantDelta / turnEnd carry text *"(dropping only `conversation_id`)"* | **FALSE, unowned** (§ Known-false #1) — **out of scope** |
| `:101-102` | turnState *"carries only `state` onward (dropping\n `conversation_id`)"* — **wraps across the line break, so it matches no single-line grep** | **FALSE, owned by #734/#739** — **out of scope** |
| `:192` | the target | **FALSE — the only line this ticket edits in this file** |
| `:203` | sessionTransition *"(dropping the other four decoded fields)"* | **TRUE — pinned** |
| `:256` | the modal kinds *"(dropping nothing — a modal has no `conversation_id`)"* | **TRUE — pinned** |

In `threadTimeline.ts`, `[Ff]ield-for-field` matches **2** lines: `:128` (`sessionBoundary`, TRUE) and `:151` (target). Case matters — both start with a capital **F**, so a lowercase-only pattern finds neither. In `conversationTimelineStore.ts` the target phrase is unique, but *"the other three"* and *"Eight"* are generic enough to be dangerous.

**Ban `replace_all` in all three files. Edit each block individually with enough surrounding context to make the match unique.** Unique anchors, verified: `` and `truncated` onward, dropping `conversation_id` `` (Site 1), `` identical to the `unrecognizedMessage` ThreadItem `` (Site 2), `` Eight of the bridge's eleven owned `` (Site 3).

### D3 — Site 2's shape comes from `:103-104`, not from `:137-138` / `:144-145`

All four widened siblings are the idiom AC2 names, but they are not interchangeable. `:103-104` is the right template because it is the only one that is (a) two lines, (b) about an arm whose justification is *identity*, and (c) already #764's repaired prose:

> `// The tool-call arm. #763 widened the` `toolUse` `DaemonEvent with a` `conversationId` `the bridge drops,`
> `// so the bridge stays a filter + fresh copy, not a remap.`

Two consequences:

1. **The discipline parenthetical is optional.** `:151-152` currently carries `` (the `sessionBoundary` discipline) ``; `:103-104` carries none. Dropping it is **conforming to the template**, not shaving budget (§ D4).
2. **Do not name the arm twice.** `:103` says *"the `toolUse` DaemonEvent"* because its own surviving text no longer names the arm. Site 2's surviving clause already says *"the `unrecognizedMessage` ThreadItem"*, so the widening clause should read *"the DaemonEvent"* — 22 characters saved and no repetition.

**No new absolute `events.ts:<line>` citation** (#767 § D7, held): neither Site 2 nor any target currently carries one, and #764 recorded the stale-`events.ts:<line>` sweep as known-deferred. Name the type (`` the `unrecognizedMessage` DaemonEvent ``) or use a bare filename; neither can drift.

### D4 — Line-count neutrality is MANDATORY in all three files. #767's +1 licence does NOT transfer.

#767 permitted `timelineBridge.ts` to grow by one line **because it measured all three anchors below the edit and found every one already drifted**, making the cost nil. That was a measurement, not a precedent. **I re-ran the same measurement on `threadTimeline.ts` and it inverts.**

Every in-repo citation of `threadTimeline.ts:<line>` (`src/` + `e2e/`; `docs/` excluded per #764 § D2) sits **below** line 152, and I resolved each at `f0f1529`:

| Citing site | Anchor | Resolves to | Status |
|---|---|---|---|
| `conversationLastReadStore.ts:39`, `:105` | `:191` | `items: readonly ThreadItem[]` | **exact** |
| `conversationLastReadStore.ts:46` | `:40-92` | `export type ThreadItem =` … the `unrecognizedMessage` arm's closing `}` | **exact, both ends** |
| `conversationActivityStore.ts:22` | `:189-224` | the whole-timeline-state docblock | **exact** |
| `conversationActivityStore.ts:64` | `:184-199` | `export interface ApiRetryStatus {` → the `apiRetry` field | **accurate** |
| `conversationActivityStore.ts:72` | `:206-224` | the `#650: localSendPending` comment | **accurate** |
| `conversationActivityBridge.ts:72`, `:74` | `:227-229`, `:229` | the `assertNever` docblock / its `JSON.stringify` throw | **exact** |
| `conversationActivityBridge.ts:138` | `:196-199` | the `#493` api-retry status comment | **accurate** |
| `conversationActivityBridge.ts:142` | `:200-205` | the `#496` compacting comment | **accurate** |
| `conversationActivityBridge.ts:118`, `conversationActivityBridge.test.ts:70` | `:356-359` | `case 'turnState':` | **exact** |
| `conversationTimelineStore.ts:262`, `conversationTimelineStore.test.ts:59` | `:345-346` | `return items === state.items && !state.stalled` | **exact** |
| `conversationLastReadStore.ts:41` | `:540` | `case 'reset':` | **exact** |
| `ConversationScreen.tsx:1245` | `:213` | a `localSendPending` prose line | already loose |

**Twelve of thirteen are live, and eight are exact.** A `+1` at `:151` shifts every one of them by one and makes each single-line anchor point at the wrong line. Shipping that inside the ticket whose entire purpose is retiring stale citations is self-defeating.

Graded ruling:

| File | Citations below the edit | Rule |
|---|---|---|
| `inboundMessage.ts:189-192` | 0 (the only `inboundMessage.ts:<line>` citation in the repo is `conversationArchivedBridge.ts:6` → `:1073`, unaffected) | **4 in, 4 out** — free, and automatic (§ Site 1) |
| `threadTimeline.ts:151-152` | **13, twelve live, eight exact** | **2 in, 2 out — HARD. No +1.** Budget proved in § Site 2. |
| `conversationTimelineStore.ts:10-12` | 5 (`timelineBridge.ts:236` → `:38-42`; `conversationLastReadStore.ts:58` → `:93-111`, `:123` → `:153`; `composerSend.ts:78` and `composerSend.test.ts:114` → `:268-270`) | **3 in, 3 out** — free; the repair only *removes* characters (§ Site 3) |

**Do not "tidy" any other line in any of the three files to buy budget.** The budget is already proved sufficient.

**Rejected alternative, recorded so it is not re-litigated:** repairing the thirteen `threadTimeline.ts` anchors to absorb a +1 would touch six additional files outside the body's scope table, and repairing drifted anchors is the known-deferred backlog #743 § I2, #764 § D2 and #767 § D4 all kept out of scope.

### D5 — AC3's numbers are read off #784's switch, not recounted

Verified at `timelineBridge.ts:265-291`: nine grouped `case`s fall through to `return event.conversationId` (`assistantDelta`, `turnEnd`, `turnState`, `toolUse`, `toolResult`, `stallDetected`, `apiRetry`, `compacting`, `unrecognizedMessage`); two — `sessionTransition`, `connected` — return `null`. Eleven owned arms total.

**Do not derive these by counting `DaemonEvent` union members.** The union is larger than the bridge's owned set (modal arms, background-task arms, `conversations`, `queueState`, … all fall to `default`). A developer who recounts from `events.ts` gets a number that is neither nine nor eleven and "corrects" a true census into a false one — the same class of new-falsehood-shipped-by-the-repair as #767 § D1. `timelineBridge.ts:275-287` is the SSOT; Site 3 is its restatement, and the two must read the same.

## Site 1 — `inboundMessage.ts:192` (the `unrecognized-message` kind's contract doc)

Paragraph stays **4 lines** (`:189-192`). Measured widths: 105 / 98 / 101 / 101; block max 105, file max 112 (set by `:205`, untouched).

**Must no longer claim:** that the consumer *drops* `conversation_id`. **Only that clause** — the field list before it is correct and complete.

**Must claim instead:** the consumer carries the four named fields **plus `conversation_id`** onward, attributed to `(#784)` — the twin's word order at `:224`, in snake_case, since this is the decode layer and every neighbouring paragraph uses wire names.

**Must survive byte-identical:** `:189-191` (the "daemon's report … NOT a claude sub-state … a gap in the daemon's own mapping" lead-in) and the field list `` `site`, `message_type`, `raw` and `truncated` `` at `:192`.

**Neutrality is automatic and the edit is single-line and single-clause.** Measured: replacing the 35-character `` onward, dropping `conversation_id`. `` with the 37-character `` plus `conversation_id` onward (#784). `` takes `:192` from 101 to **103** — under the block's own 105 and well under the file's 112, with no re-wrap of any neighbouring line. Confirm 4 in, 4 out anyway.

**No count to get wrong here** — unlike #767 § D1, this paragraph names its four fields rather than counting them, so the four→five trap does not exist at Site 1. It exists two lines below instead (§ Known-false #3).

**Must not change:** `:188` / `:193` (the ` *` separators), `:194-199` (the fail-closed paragraph — **pinned, § Known-false #3**), `:217-226` (#764's and #767's already-repaired twins), `:851-869` (`parseUnrecognizedMessagePayload` — read only).

## Site 2 — `threadTimeline.ts:151-152` (the `unrecognizedMessage` `ThreadEvent` member)

Block stays **2 lines** (§ D4 — hard). Ceiling **111**, proven in-file by `:137`, a comment. Current widths 101 / 89; current prose 180 chars; capacity 2 × 106 = **212**.

**Must ADD** (not replace, § D1): that **#784** widened the `unrecognizedMessage` DaemonEvent with a `conversationId` **the bridge drops**, in the `:103-104` sentence shape.

**Must survive:** *"Field-for-field identical to the `unrecognizedMessage` ThreadItem"* — the AC2 clause, TRUE (§ D1) — and *"filter + fresh copy"*, the conclusion that forecloses the pass-through edit (§ Security review, finding 1).

**May be cut to make the 2-line budget, in this order:**

1. `` (the `sessionBoundary` discipline) `` — 34 chars. **Absent from the `:103-104` template** (§ D3), so this is conformance, not shaving. Recoverable by reading `:128-130`, 23 lines up.
2. *"not a remap"* — 13 chars, a contrast clause. Cut only if (1) is not enough.
3. Naming the arm inside the widening clause — say *"the DaemonEvent"*, not *"the `unrecognizedMessage` DaemonEvent"* (§ D3). 22 chars.

**May NOT be cut:** *"filter + fresh copy"*, the ThreadItem identity clause, or the arm's own identity lead.

**Budget proof** — one admissible 2-line wrap at **209 prose chars against the 212 capacity**, applying cuts (1) and (3) and keeping *"not a remap"*. **Not paste-ready mandated text**; the developer owns the final wording within the must-add / must-survive / may-not-cut constraints above.

```
  // The parser-gap arm. #784 widened the DaemonEvent with a `conversationId` the bridge drops. Field-for-field   [111]
  // identical to the `unrecognizedMessage` ThreadItem, so the bridge is a filter + fresh copy, not a remap.       [108]
```

Both lines land at or under the proven 111 ceiling, and the file max stays flat at **111**. Confirm 2 in, 2 out.

**The margin is 3 characters, so the wrap is the binding constraint, not the ceiling.** `Field-for-field` is a 15-character unbreakable token, so a wrap that ends line 1 before it wastes ~9 characters and the budget fails. If the developer's phrasing does not fit, take cut (2) — *"not a remap"*, 13 characters — before reaching for a third line, which § D4 forbids.

**Must not change:** `:153-159` (the `ThreadEvent` member — code; **it must not gain a `conversationId` field**, § Security review finding 7), `:86-92` (the ThreadItem), `:96` (*"`conversation_id`-free"*, true for the whole union — the body pins it), `:103-104` / `:128-130` / `:132-149` (siblings and the control), `:122-124` (`toolResult` / `turnState` / `turnEnd` — bare members with no comment, § Pinned).

## Site 3 — `conversationTimelineStore.ts:10-12` (the header census)

Block stays **3 lines** (§ D4). Current widths 103 / 102 / 54; file max 107 (`:88`, untouched).

**Must no longer claim:** eight routed arms, or three id-less ones, or that `unrecognizedMessage` is among the id-less.

**Must claim instead:** **nine** of the bridge's eleven owned arms route here; the other **two** — naming only `` `sessionTransition` `` and `` `connected` `` — carry no conversation id, so they reach the flat store only. Numbers and names read off `timelineBridge.ts:275-287` (§ D5), which this restates.

**Must survive:** `:10`'s leading sentence up to *"…the timeline's only two row-adding writers."* — byte-identical — and `:12`'s *"carry no conversation id, so they reach the flat store only"* conclusion, which stays true of the remaining two.

**Neutrality is automatic — the repair only removes characters.** `Eight`→`Nine` is −1; `three`→`two` is −2; deleting `` , `unrecognizedMessage` `` is −22. Net **−25**, across a block whose lines are 103 / 102 / 54 against a file max of 107. Any admissible re-wrap of `:11-12` stays within 3 lines; the minimal-diff form (edit the tail of `:10` and the middle of `:11`, leave `:12` untouched) is measured at **102 / 77 / 54**. Confirm 3 in, 3 out.

**Must not change:** `:1-9` (the slice's purpose and the Strangler Fig note), `:14-30` (the #757 clears, the keying rationale, the reducer-reuse note), `:262` (a `threadTimeline.ts:345-346` citation — an anchor, and § D4 keeps it valid).

## Pinned — do not touch (each verified true at `f0f1529`)

| Site | Why it stays |
|---|---|
| `threadTimeline.ts:128-130` (`sessionBoundary`) | **TRUE**, and the body's designated *control*: no widening clause because `sessionTransition` has no wire conversation id to widen (#785 owns that arm). Its bare shape is correct, not an omission. Matches the same `[Ff]ield-for-field` grep as the target. |
| `threadTimeline.ts:96` | *"`conversation_id`-free"* — TRUE for the whole `ThreadEvent` union, before and after. |
| `threadTimeline.ts:103-104`, `:132-149` | The four widened siblings. Already correct; templates, not targets. |
| `threadTimeline.ts:122`, `:123`, `:124` (`toolResult` / `turnState` / `turnEnd`) | **Bare members with no comment at all.** A comment that makes no claim cannot go stale. #767 widened `toolResult` and deliberately added nothing here. **Authoring one is out of scope** (#767 § D6's ruling, re-applied). |
| `threadTimeline.ts:100-101` (`assistantDelta`) | Its paragraph is about `seq`, not the id. Out of scope. |
| `timelineBridge.ts:124-139` | **#784's own repaired arm.** *"the four render fields ARE field-for-field identical, and that is precisely why the drop has to stay explicit"* — TRUE, and it already carries the widening. Do not re-sweep. |
| `timelineBridge.ts:87`, `:118-123` | `sessionTransition` / `compacting` arms — TRUE, already repaired by their own tickets. |
| `timelineBridge.ts:275-287` | **The SSOT Site 3 restates.** Do not edit; do not recount (§ D5). |
| `modalBridge.ts:100-113`, `:27` | *"unrecognizedMessage ships dormant too; its render consumer is the timeline row"* — scoped to the MODAL store, unaffected. The body pins it explicitly. |
| `inboundMessage.ts:194-199` | The fail-closed paragraph, **including `:196`'s "two required strings"** — stale but **out of scope** (§ Known-false #3). |
| `inboundMessage.ts:203`, `:256` | *"dropping the other four decoded fields"* / *"dropping nothing — a modal has no `conversation_id`"* — both TRUE; both match the same grep as the target. |
| `inboundMessage.ts:217-226` | #764's and #767's repairs. Already correct. |
| `src/shared/wire/types.ts` — ~45 `field-for-field` hits, **`:616` included** | **wire↔daemon** claims, a different relation entirely. `:616` describes `UnrecognizedMessagePayload` mirroring the daemon struct and names `conversation_id` in its wire order — TRUE and unaffected. The body pins it by name. |
| `src/shared/ipc/events.ts:424-446`, `src/main/daemonConnection.ts:826-853` | #784's, already correct. Read for ground truth; do not edit. |
| `src/shared/ipc/diagnostics.ts:15`, `:27`; `codec.ts:6`; `fakeRoutingRelay.ts:27`; `backgroundTaskRosterStore.ts:21`; `daemonConnection.ts:1138`; `types.test.ts` ×5; `e2e/fixtures/realDaemon.ts:538` | The remaining `field-for-field` hits. None is a DaemonEvent↔ThreadEvent claim. Unaffected. |

**No test churn and no e2e work.** `timelineBridge.test.ts:507` and `:1028` already read *"the two owned arms that carry no routing key"* / *"the two id-less owned arms"* — #784 swept them. `conversationTimelineStore.test.ts` carries no census prose (its only *"Nine"* at `:206` counts viewed conversations). No test or e2e file matches `` dropping `conversation_id` ``. Stated so AC4 does not read as an oversight.

**`docs/knowledge/`** belongs to the documentation phase. Out of scope, including any restatement of these claims in a package overview.

## Known-false, not ours — three, and the third is NEW

| # | Site | Claim | Why false | Owner |
|---|---|---|---|---|
| 1 | `inboundMessage.ts:98` | assistantDelta / turnEnd carry text *"(dropping only `conversation_id`)"* | `events.ts:130` / `:141` — both carry `conversationId` (#751 / #752) | **none.** Third consecutive sweep to step around it (#764, #767, this) |
| 2 | `inboundMessage.ts:101-102` | turnState *"carries only `state` onward (dropping `conversation_id`)"* | `events.ts:156` — `turnState` carries `conversationId` (#724) | **#734 and #739 — open DUPLICATES of each other.** PO should close one |
| 3 | **`inboundMessage.ts:196`** | the `unrecognized-message` fail-closed defence is *"a closed-enum `site` …, **two required strings**, and a required BOOLEAN"* | `parseUnrecognizedMessagePayload` (`:855-858`) makes **three** `requireString` calls — `conversation_id`, `message_type`, `raw` | **none — newly identified by this spec** |

**#3 is the sharpest hazard on this ticket**, because it sits four lines below Site 1 and understates rather than overstates. Its "two" excludes `conversation_id` — but **this file's vocabulary for the fail-closed census includes it**, proven three ways in the same doc block: `:225` says *"four required strings"* for `parseToolResultPayload`, whose four are `conversation_id` / `turn_id` / `tool_use_id` / `result_summary`; `:178-181` counts the roster payload's `conversation_id` as its *"one required string"*; `:230-231` names *"a `conversation_id` string plus a per-item narrower"*. Under that vocabulary `:196` should read **three**.

**It stays out of scope**, and the developer must not touch it. It is a **pre-existing** understatement — `conversation_id` has been in `UnrecognizedMessagePayload` since the wire type was ported (`types.ts:616`), and #784 changed the IPC arm, not the decode — so it is not this widening's residue and is not in any AC. #764's citation-overflow ruling stands: the scope table is a ceiling. The danger is that a developer editing `:192` reads the very next paragraph, sees a stale count, and fixes it — a plausible-looking out-of-scope edit that the compiler and the suite cannot object to.

**Recommend PO file one follow-up covering all three** (`:98` for #751 / #752; `:196` for the decode count) and close the #734/#739 duplicate. Posted as a comment on #787 rather than silently carried, so a fourth sweep does not rediscover it.

## Verification

The compiler and the suite cannot catch a mistake here — the whole diff is comments. Run all seven; none alone is sufficient.

1. **Classify, don't count to zero.** Every gate over these claims counts *down*, so **deleting** the three comments scores a perfect green — and deletes the security claim (§ Security review, finding 1). Read all three blocks and confirm each *positively asserts* its replacement claim.

2. **Confirm the surviving TRUE clause at Site 2 is still there.** `rg -n 'identical to the .unrecognizedMessage. ThreadItem' src/renderer/src/store/threadTimeline.ts` must still return `:151`-or-`:152`. A diff that adds the widening clause by *replacing* that sentence (#764's diff shape) satisfies AC2's first half and violates its second (§ D1).

3. **Sweep case-insensitively and classify all hits.** `rg -i 'field-for-field' src/renderer/src/store/threadTimeline.ts` returns **2**: 1 repaired (`:151`), 1 pinned (`:128`). A case-sensitive lowercase pattern finds neither — both start with capital **F**.

4. **Confirm the census matches its SSOT, character for character in the numbers.** `conversationTimelineStore.ts` must say **nine** routed / **two** id-less, naming only `sessionTransition` and `connected`, matching `timelineBridge.ts:275` / `:283-287`. Do not recount from the `DaemonEvent` union (§ D5).

5. **Per-hunk line-count check — every hunk must be neutral.**

   ```bash
   git diff -U0 -- src/main/transport/inboundMessage.ts \
                   src/renderer/src/store/threadTimeline.ts \
                   src/renderer/src/store/conversationTimelineStore.ts
   ```

   Every `@@ -a,b +c,d @@` must have **`b == d`**, with no exception on any of the three files (§ D4 — unlike #767, no +1 is licensed here). `--numstat` is not a substitute: it aggregates per file, so a `+1`/`-1` in different blocks cancels there while still shifting every citation between them.

6. **Width scan of the rewritten regions** — not the file max, which is set by untouched lines and stays flat while an edit is malformed. Site 1 ceiling **112** (expect `:192` at 103), Site 2 ceiling **111** (the proven in-file comment max), Site 3 ceiling **107**. File maxima must stay flat at **112 / 111 / 107**. There is no prettier and no eslint in this repo, so nothing re-wraps what the developer widens — and `awk 'length>100'` is a false alarm here, since siblings run to 111.

7. **Comment-only, then the suites.** Every `+`/`-` line in `git diff` begins with `*` or `//` after indentation. `type: 'unrecognizedMessage'` and `kind: 'unrecognizedMessage'` literal counts unchanged; `git diff --name-only` returns exactly the three files plus this spec; no `*.test.ts` / `e2e/` path appears. Then `npm run typecheck` and `npm test` pass unchanged — and **read both halves of typecheck**: it is `&&`-chained, so a node-side failure masks every web-side error. `npm run build` clean.

**Fresh-worktree note:** the developer's worktree has no `node_modules`. Run `npm install` first; `npx tsc` is a decoy that resolves a different TypeScript.

## Open questions

None. All three offsets, the templates, every in-repo line citation and its live/drifted status, all three character budgets, the `replace_all` inversion set, the case-sensitivity trap, the ThreadItem↔ThreadEvent shape identity, the bridge's nine/two census, and the third unowned false claim at `:196` were verified against `main` at `f0f1529` while writing this spec.

## Security review

**Verdict:** PASS

**Findings:**

1. **[Trust boundaries] SHOULD FIX — addressed in the design.** `translateTimelineEvent` is where a daemon-asserted `conversationId` **stops** on its way to the renderer's timeline reducer (`timelineBridge.ts:133-139`), and Site 2 is the reader-facing half of that boundary. The adversarial reading: every gate over these claims counts *down*, so the cheapest way to pass is to **delete** the comment — or, subtler here, to satisfy AC2 by *replacing* the surviving true sentence with the widening clause (§ D1), which removes the ThreadEvent↔ThreadItem statement while looking like the sibling diff. Either way the reader loses the pairing that makes the drop legible. Three requirements close it: Site 2's must-survive list pins both *"filter + fresh copy"* and the ThreadItem clause; § D1 states in a table which clause is false and which is true; and Verification 2 and 5 make deletion and replacement structurally visible. Verification 1 states outright that a green sweep does not prove the work.

2. **[Trust boundaries] No findings, second aspect.** The boundary stays a single explicit chokepoint: `translateTimelineEvent`, one `switch`, one fresh object per arm. This spec changes no arm and pins `timelineBridge.ts` entirely out of the diff, so the boundary's *enforcement* is byte-identical before and after — only its *description* moves. The executable proof is unchanged and already green (#784's `timelineBridge.test.ts` assertions, and `:1028`'s AC3/AC4 test over the two id-less arms).

3. **[Trust boundaries] SHOULD FIX — addressed in the design, with the hazard MOVED since #767.** Silent cross-boundary falsehoods remain reachable by an obvious tool call even though #767's specific two-line collision is gone. § D2 measures the current set: a loose sweep in `inboundMessage.ts` reaches `:203` and `:256` — both **true** statements that a routing key does *not* cross for those arms — and rewriting either asserts a crossing that provably does not happen. In `threadTimeline.ts`, `:128` is a true DaemonEvent-free claim about `sessionBoundary` that matches the same grep as the target. All fail silently: plausible match count, `tsc` green, suite green, in the files a reader consults to learn exactly what crosses. Closed by banning `replace_all` in all three files, by the three unique anchors given, and by § Pinned listing every collision by file:line with its truth value. Downgraded from MUST FIX because the design forecloses it; if the ban is dropped, it returns as MUST FIX.

4. **[Trust boundaries] SHOULD FIX — bounded, not closed, and named; the list GREW by one.** Three claims in the edited file assert **falsely** that a routing key stops at the IPC boundary when it crosses: `:98` (assistantDelta / turnEnd, #751 / #752), `:101-102` (turnState, #724), and — newly identified here — `:196`, whose *"two required strings"* under-counts the fail-closed decode by omitting `conversation_id`, in a file whose own vocabulary counts it (§ Known-false #3). A reader consulting this doc block to learn what crosses, or what the decode actually enforces, is misinformed today. All three are bounded rather than exploitable and all err in the **safe** direction: the *enforcement* is correct on every arm — the ids genuinely cross by design, `parseUnrecognizedMessagePayload:855` genuinely does require `conversation_id` — so the defect is documentation-only and under-claims. `:101-102` is owned (#734/#739, open duplicates); `:98` and `:196` are unowned. Kept out of scope per #764's citation-overflow ruling; **recommended to PO as a single follow-up**, posted as a comment so the fourth sweep does not step around them again.

5. **[Trust boundaries] No findings, fourth aspect — the census.** Site 3 restates a security-relevant count: which arms carry a routing key across the IPC boundary. § D5 forbids deriving it from the `DaemonEvent` union (which is larger than the bridge's owned set) and pins `timelineBridge.ts:275-287` as the SSOT. A census that drifted *upward* would claim attribution for arms that have none; one that drifted *downward* — the current state — hides that `unrecognizedMessage` is now attributable, which is precisely the fact #784 established to keep a parser-gap row out of the wrong thread (`events.ts:428-430`).

6. **[Tokens, secrets, credentials] N/A by design decision.** The field at issue is `conversationId`, classified upstream by #784 (`events.ts:432-437`) as a daemon-asserted **routing key, not rendered text** — the untrusted-text warnings that attach to `raw` and `messageType` do not attach to it, and it reaches no sink on that leg. That classification is neither restated nor weakened here. No token, key, or raw frame appears in any of the three blocks, and Site 1's surviving fail-closed sentence is pinned unedited (§ Known-false #3), so no decode claim is loosened.

7. **[Inter-process / Electron attack surface] No findings.** The IPC arm shape is frozen by the comment-only constraint: no `contextBridge` API, no `ipcMain` channel, no `webPreferences` value, and no `DaemonEvent` or `ThreadEvent` union member added or altered. § Site 2 additionally forbids the `ThreadEvent` member at `threadTimeline.ts:153-159` from gaining a `conversationId` field — the one code change that would actually breach the seam this ticket documents, and the change a reader who took "field-for-field identical" too literally might make. `case 'unrecognizedMessage':` stays an explicit arm in the bridge, so it remains a documented decision rather than a fall-through, and the `assertNever` guard (`threadTimeline.ts:227-229`) is untouched.

8. **[File / storage operations] N/A by design decision.** No path is constructed, read, or written; the change adds zero executable lines (Verification 7). The `raw` blob — the most untrusted string the timeline holds — is not moved, logged, or re-typed.

9. **[Cryptographic primitives] N/A by design decision.** No RNG, no comparison, no Noise-adjacent code is in the diff's reach; none of the three files holds crypto.

10. **[Network & I/O] N/A by design decision.** No socket, frame cap, timeout, or URL is touched. The two independent bounds on `raw` (the daemon's 16 KiB construction cap and `MAX_PLAINTEXT_BYTES`) are described at `inboundMessage.ts:197-198`, inside the pinned paragraph, and are unchanged.

11. **[Error messages, logs, telemetry] No findings — verified, not assumed.** The one log-shaped sink in these files is `assertNever`'s `JSON.stringify(event)` at `threadTimeline.ts:229`. An arm with an explicit `case` never reaches it, and `unrecognizedMessage` has one at `:151`-adjacent's reducer case. The spec adds no log call, and `inboundMessage.ts`'s doc block contains no sink — its decoder messages name the failure CATEGORY only, never the `raw` blob or the id (`:848-849`, pinned).

12. **[Concurrency] N/A by design decision.** No async task, listener, timer, or `AbortController` is added or removed; there is no executable line in the diff.

13. **[Threat model alignment] OUT OF SCOPE, named.** *Renderer compromise reaching the transport* is unaffected — process placement is unchanged and the repair strengthens the written boundary. Four adjacent gaps are deliberately deferred and recorded so they are not lost: (a) the three false claims of finding 4, one owned by an open duplicate pair and two recommended to PO; (b) the drifted anchors this ticket refuses to create — § D4 forbids any line-count change precisely so the thirteen live `threadTimeline.ts` citations stay accurate, inverting #767's licence rather than inheriting it; (c) the stale-`events.ts:<line>`-citation backlog, which § D3 forbids this ticket from growing; (d) any restatement of these claims under `docs/knowledge/`, which belongs to the documentation phase.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-26
