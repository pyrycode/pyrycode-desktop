# #767 — Retire the toolResult-drops-the-conversation-id citations

**Size:** S (comment-only; 2 production files, 2 comment blocks, zero executable lines, zero test churn)
**Label:** `security-sensitive` — the document *is* the security claim (the #725 / #733 / #738 / #743 / #764 precedent)
**Parent:** split from #754; twin of #766 (the arm, `4ce4bf3` + `9842087`, merged) and the direct mirror of #764 (the `toolUse` citations, `fbc46ef`, merged)

## Design source

N/A — comment-only change, zero executable lines, no rendered surface. Both sites are `.ts` files; neither touches markup, a class name, a theme token, or a copy constant. The visual-fidelity check is intentionally skipped.

## Baseline — re-measured at `0f9d1e0`, and the body's base has EXPIRED

The ticket body measured at `49ea43c` (`main` after #766's PR #769 merged). **`main` has since advanced to `0f9d1e0`** — #755's PR #770 landed (`5768777` / `afe2cc3` / `3c7af66`) while this ticket sat in Backlog. I re-measured every offset at `0f9d1e0`.

| Re-measured at `0f9d1e0` | Result |
|---|---|
| Did #755 move either target? | **No.** #755 added 2 new files and edited none (`git show afe2cc3 --stat`); both targets resolve at the body's numbers. |
| `inboundMessage.ts:224` resolves as quoted | **yes**, byte-for-byte |
| `timelineBridge.ts:70-71` resolves as quoted | **yes**, byte-for-byte — the block runs `:70-73`, four comment lines |
| `[Ff]ield-for-field` in the two edited files | `timelineBridge.ts` **3** (1 target + 2 pinned); `inboundMessage.ts` **0** |
| `[Ff]ield-for-field` in `src/` excluding `shared/wire/types.ts` | **17**, every non-target one pinned or in an unrelated file (§ Pinned) |
| Overlapping in-flight `origin/feature/*` branches on the two files | **none** (`git fetch --prune` then a per-branch `git diff --name-only origin/main...`) |
| codegraph | **still unindexed** — `codegraph_status` returns *"CodeGraph not initialized for this project"*; `.codegraph/` holds config only. grep/Read throughout. Probed this run, not assumed. |

**Prior-decision search:** satisfied from stronger sources than QMD would return — `docs/specs/architecture/764-retire-tooluse-conversation-id-citations.md` (the direct twin, read in full) and the #738 / #743 / #766 findings it and this project's memory carry.

## Files to read first

| Path | What to extract |
|---|---|
| `src/main/transport/inboundMessage.ts:222-226` | **Site 1.** The `tool-result` kind's contract paragraph — 5 lines. `:221` and `:227` are ` *` separators. **The sentence spanning `:224-225` carries two different "four"s and only one parenthetical is false** (§ D1). |
| `src/main/transport/inboundMessage.ts:217-220` | **The Site 1 phrasing precedent** — #764's repaired `tool-use` twin, four lines above: *"The consumer carries the five render fields plus `conversation_id` onward (#763)."* Copy this word order. |
| `src/main/transport/inboundMessage.ts:986-1006` | `parseToolResultPayload`'s docstring + body. **Ground truth for the surviving counts:** four `requireString` calls (`conversation_id` / `turn_id` / `tool_use_id` / `result_summary`) plus one `requireBoolean` (`is_error`). `:988-989` repeats the same true "four required strings". |
| `src/renderer/src/store/timelineBridge.ts:69-73` | **Site 2**, 4 comment lines under `case 'toolResult':`. `:74-80` is the return literal — code, and the executable proof the id stops here. |
| `src/renderer/src/store/timelineBridge.ts:47-50` | **The Site 2 template** — #764's `toolUse` repair. Copy the *"…the ThreadEvent this returns does not, so the id STOPS here — a filter + fresh copy (arm selection), never a pass-through of the DaemonEvent object"* sentence. **Trap: `:48`'s lead-in carries `, widened by #643`; `toolResult`'s does not** (§ D5). |
| `src/renderer/src/store/timelineBridge.ts:82-85` and `:122-128` | **The two nearest look-alikes, both TRUE and both pinned.** `:85` (`sessionTransition`) and `:123` (`unrecognizedMessage`, near-verbatim the target, 53 lines below). Read both before any sweep (§ D3). |
| `src/renderer/src/store/timelineBridge.ts:21-30` | The file-level rule: *"an arm may carry fields its `ThreadEvent` deliberately drops."* Site 2's repair must read consistently with it. `:25` is the 121-char header line that sets the file max — untouched. |
| `src/shared/ipc/events.ts:507-527` and `src/main/daemonConnection.ts:911-925` | **The SSOT for the surviving count** — #766's already-correct prose: *"Carries the four render fields plus `conversationId`"* and *"the five named fields carrying the render fields and `conversationId`"*. **Do not edit these**; they are #766's and already right. They are also what settles render-field ≠ emitted-field (§ D1). |
| `src/renderer/src/store/timelineBridge.test.ts:164-183` | The executable proof, already green and already renamed by #766. Confirms AC4 needs no test edit. |
| `docs/specs/architecture/764-retire-tooluse-conversation-id-citations.md` | The direct twin — same shape, shipped first-pass. Its § D2 (line-count neutrality) and § D3 (the `replace_all` inversion) are re-derived here against a **different** measurement; do not carry its numbers across. |
| `docs/knowledge/codebase/764.md` | The twin's review record, including the two NITs and the `inboundMessage.ts:98` out-of-scope ruling this spec extends (§ Known-false, not ours). |

## Context

#766 (`4ce4bf3`, hardened by `9842087`) widened the `toolResult` IPC arm with `conversationId: string`, and swept its own two files plus its test twins in the same PR. Two comments **outside** those files still describe the pre-widening contract. Each encodes the drop indirectly, so no grep on `conversation_id` reaches Site 2 at all.

Site 2 is the load-bearing one. `translateTimelineEvent` is exactly where the conversation id must stop — `ThreadEvent` carries no conversation id, so the bridge is now a field-**dropping** filter, and that seam is what the per-conversation routing slice (#756) builds on. A comment asserting the two shapes are *field-for-field identical* tells the next reader the opposite of what the seam does, and invites the "simplify this to a pass-through" edit that would carry the id into the reducer silently while the comment still read as if that were safe.

## Design

Two comment-block repairs. No new module, no type change, no signature change, no test edit, no `type: 'toolResult'` literal change.

### D1 — Site 1's count is TRUE. Do not inherit the twin's four→five bump.

This is the sharpest trap on the ticket, and it is a trap *because* the twin looks like a template.

#764 bumped `inboundMessage.ts:218`'s count from four to five. That bump was **repair of a pre-existing staleness**: #642 had added `input` as a fifth `toolUse` render field and the comment never caught up. **`toolResult` has no equivalent staleness.** Its render fields are and remain `turn_id` / `tool_use_id` / `is_error` / `result_summary` — four.

So at `:224`:

| Clause | Verdict |
|---|---|
| "carries the **four render fields**" | **TRUE — must survive byte-identical** |
| "(dropping `conversation_id`)" | **FALSE — the only thing this AC retires** |

**Render field ≠ emitted field, and the vocabulary is pinned at the emit site**, not by counting type members. `daemonConnection.ts:912-914` names *"the **five** named fields carrying **the render fields and `conversationId`**"* — five emitted, four of them render fields. `events.ts:507` says the same from the type side: *"Carries the **four render fields** plus `conversationId`"*. A developer who counts the members of the `DaemonEvent` `toolResult` union arm gets five and "corrects" a true four into a false five, in a file whose vocabulary excludes the id from that count.

**Failure mode if this is got wrong:** the AC is satisfied (the parenthetical goes), the suite is green, `tsc` is green — and `:224` now directs the reader to "five render fields" for an arm that has four. A *new* falsehood, shipped by the ticket whose purpose is retiring one.

### D2 — The second "four" is inside the quoted AC range and is WHOLLY true

`:224-225` is one sentence containing two counts. The AC quotes `:224`; `:225` sits inside the same sentence and is about the **decoder**, not the emit:

- `:225` — *"the fail-closed defence is **four required strings** PLUS one required boolean"*. Verified against `parseToolResultPayload` (`inboundMessage.ts:996-1006`): `requireString` on `conversation_id` / `turn_id` / `tool_use_id` / `result_summary`, plus `requireBoolean` on `is_error`. **Entirely true.**
- The same true count is repeated in that function's own docstring at `:988-989`.

Measured collision surface in `inboundMessage.ts`:

| Grep | Hits | Ruling |
|---|---|---|
| `four required strings` | **2** — `:225`, `:988` | Both TRUE. A `replace_all` guts both. |
| `four render fields` | **1** — `:224` | The target's true half. |
| `four` (any) | **13 lines** | `:117`, `:203`, `:243`, `:454`, `:542`, `:613`, `:624`, `:724`, `:760`, `:843` are unrelated true counts. |

**A `replace_all` on "four" is catastrophic and silent** — `tsc` and the suite have nothing to say about a comment. **Banned in this file.**

### D3 — `replace_all` inverts in BOTH files, measured

Neither inversion is hypothetical; both were measured at `0f9d1e0`.

**`inboundMessage.ts` — `` dropping `conversation_id` `` matches 2 lines:**

- `:192` — the `unrecognized-message` arm. **TRUE** (its id is dropped upstream at `events.ts:422`). Sweeping it writes a falsehood.
- `:224` — the target.

Two more *near*-matches survive a naive eye but not a looser grep: `:98` (*"dropping only `conversation_id`"*) and `:101-102` (*"(dropping\n `conversation_id`)"*, wrapped across the line break so it matches no single-line grep at all). Both are **false and out of scope** — see § Known-false, not ours.

**`timelineBridge.ts` — the phrase fragments collide with #764's just-shipped prose and with two true arms:**

| Grep | Hits | Which |
|---|---|---|
| `Field-for-field identical to` | **1** | `:70` — the target. Unique; a safe Edit anchor. |
| `field-for-field identical` (lowercase) | **2** | `:85` (`sessionTransition`) and `:123` (`unrecognizedMessage`) — **both TRUE, both pinned** |
| `filter + fresh copy` | **2** | `:50` — **#764's repaired `toolUse` prose, TRUE** — and `:71`, the target's justification |
| `arm selection` | **7** | only `:71` is this ticket's |

`:123` is the single most likely mis-sweep on the ticket: it is near-verbatim the target (*"The DaemonEvent and the ThreadEvent are field-for-field identical, so this is a filter + fresh literal (arm selection)"*), sits 53 lines below it, and is **true** — that arm's `conversation_id` is dropped upstream at the emit (`events.ts:422`), so its DaemonEvent genuinely carries none.

**`replace_all` is banned in both files.** Edit each block individually with enough surrounding context to make the match unique. For Site 2, `Field-for-field identical to its ThreadEvent counterpart` is unique in the file.

### D4 — Line-count neutrality, graded per file against a measured anchor census

In-repo comments cite these files by absolute line number, and every citation below an edit block moves with it. I counted them (`src/` + `e2e/` only; `docs/specs/` and `docs/knowledge/codebase/` are historical records of what a PR did at its time, not maintained anchors — #764 § D2's scoping, re-applied) and **resolved each one at `0f9d1e0`** to see whether it currently lands where it claims.

| File | Citations below the block | Resolved now | Ruling |
|---|---|---|---|
| `inboundMessage.ts:222-226` | 1 — `conversationArchivedBridge.ts:6` → `:1073` | **Already drifted**: `:1071-1075` is `parseConversationsReply`'s docblock; it names no `is_archived` | **Neutral at 5 lines — and free** (§ Site 1) |
| `timelineBridge.ts:70-73` | 6 across 3 distinct anchors; **zero in-file relative refs** (grep for `(:NNN` in the file returns nothing) | **all three already drifted** — see below | **+1 line permitted, capped at +1** |

The three `timelineBridge.ts` anchors, resolved:

- `conversationActivityBridge.ts:7` → `:96-120`. Intended target is `case 'stallDetected':` … the `compacting` return, which now sits at **`:97-121`** — **off by one already**, courtesy of #764's own +1. `:96` currently lands on a bare `}`.
- `announcedModelBridge.ts:11`, `announcedModelStore.ts:12` → `:161`. Lands on `case 'sessionSettingsUpdated':`. The citation illustrates *"an arm present only so `assertNever` makes a NEW arm a compile error"*; `:162` (`case 'sessionSettingsRejected':`) is **equally valid as that example**, so this anchor degrades sideways, not wrong.
- `PairedShell.tsx:37`, `activateConversation.ts:43`, `clearPairingScopedState.ts:53` → `:206`. Intended target is `timelineStore.getState().dispatch(event)`, which is at **`:247`** — **already 41 lines stale**. A further +1 changes nothing meaningful.

**Site 2 gets +1, deliberately, and the cost was measured rather than assumed.** The shipped idiom AC3 mandates does not fit in 4 lines — measured at **442 characters of prose** against a 4-line capacity of 400 (ceiling 109, the in-switch comment max at `:86`; the file max of 121 belongs to the header at `:25` and is not an in-switch precedent). Raising the ceiling does not rescue it either: even at 112 the capacity is 412. Fitting it in 4 would mean cutting *"never a pass-through of the DaemonEvent object"* — the clause that forecloses the exact edit this comment exists to prevent (§ Security review, finding 1).

**Rejected alternative, recorded so it is not re-litigated:** repairing `conversationActivityBridge.ts:7`'s `:96-120` → `:98-122` would leave zero new inaccuracy, but it adds a third file outside the body's scope table, and repairing drifted anchors is the known-deferred backlog #743 § I2 and #764 § D2 both kept out of scope.

**Do not exceed +1 on Site 2, and do not "tidy" any other line in either file to buy budget.**

### D5 — Copy the shipped idiom, with two substitutions

#764's `toolUse` repair at `timelineBridge.ts:48-50` is the template, and a reviewer grades a **deviation** from it, not its presence. Two things must NOT be inherited:

1. **The lead-in.** `:48` reads *"The tool-call arm (#217, widened by #643)"* — `#643` is there because `input` was added to that arm. `toolResult` gained no render field; its lead-in stays **`The tool-result arm (#229).`** Adding `, widened by #766` would be a new claim about a render-field change that did not happen.
2. **The count.** `:48` says *"beside the five render fields"* for `toolUse`. For `toolResult` it is **four** (§ D1).

Keep *"a filter + fresh **copy**"* — `toolResult` rebuilds a fresh object from named fields, so "copy" is right and "literal" (which the `stallDetected` / `apiRetry` / `compacting` / `unrecognizedMessage` arms use) is wrong. The target already says "copy"; do not change it.

### D6 — Do NOT author a mirror comment at `threadTimeline.ts:122`

Verified at `0f9d1e0`: `threadTimeline.ts:122` is the bare `ThreadEvent` `toolResult` member declaration, **carrying no comment at all**. The asymmetry with the `toolUse` member's `:103-104` comment is intentional — #764 *retired an existing false comment* there rather than authoring a new one. There is nothing to retire at `:122`.

Writing one anyway is the same false-"missing" class #763's review already ruled on: diffing against a sibling arm raises a phantom gap. **`threadTimeline.ts` is not in this ticket's scope table and must not appear in the diff.** The member itself must not gain the field.

### D7 — No new absolute `events.ts:<line>` citations

Neither target currently carries an `events.ts:<line>` citation. **Do not add one.** #764 records that `threadTimeline.ts:103`'s `(events.ts:384-391)` had gone stale and that a repo-wide sweep of stale `events.ts:<line>` citations is known-deferred; a fresh one here enrolls these lines in that backlog on the next arm. If a reference is wanted, name the type (`` the `toolResult` DaemonEvent ``) or use a bare filename — neither can drift.

### Site 1 — `inboundMessage.ts:224` (the `tool-result` kind's contract doc)

Paragraph stays **5 lines**. Measured widths `:222-226`: 108 / 102 / 106 / 106 / 100; file max 112 (set by untouched lines in this same doc block).

**Must no longer claim:** that the consumer *drops* `conversation_id`. **Only the parenthetical.**

**Must claim instead:** the consumer carries the four render fields **plus `conversation_id`** onward, attributed to `(#766)` — the twin's word order at `:218-219`, in snake_case, since this is the decode layer and the neighbouring paragraphs use wire names.

**Must survive byte-identical:**
- `:224`'s *"the four render fields"* (§ D1 — TRUE);
- `:225`'s *"four required strings PLUS one required boolean (`is_error`, whose `false` is a value, not an absence)"* (§ D2 — wholly TRUE, and a different set);
- the `#229` / `#121`'s `fillResult` lead-in at `:222-223` and the `result_summary` opaque-display-text sentence at `:226`.

**Neutrality is automatic and the edit is single-line.** Measured: replacing the 35-character `` onward (dropping `conversation_id`) `` with the 36-character `` plus `conversation_id` onward (#766) `` takes `:224` from 106 to **107** — under the 112 file max, under the block's own 108, and no re-wrap of any neighbouring line. Confirm 5 in, 5 out anyway.

**Must not change:** `:221` / `:227` (the ` *` separators), `:217-220` (#764's `tool-use` paragraph, already correct), or `:986-1006` (`parseToolResultPayload` — read only, to source the counts).

### Site 2 — `timelineBridge.ts:70-73` (the bridge's tool-result arm)

Block goes **4 → 5 comment lines** (§ D4). Measured: current widths 105 / 98 / 105 / 66, prose 341 chars; ceiling **109** (proven by `:86`), so 100 usable per line. **Cap at 5. Do not reach 6.** File max must stay flat at 121 (`:25`, the header).

**Must no longer claim:** that the `DaemonEvent` and `ThreadEvent` `toolResult` shapes are field-for-field identical, **nor** the *"so this is a filter + fresh copy"* justification **as it is currently grounded**. AC2 calls both false.

**Must claim instead:** the DaemonEvent carries `conversationId` (#766) beside the four render fields; the ThreadEvent this returns does not, so **the id STOPS here** — a filter + fresh copy (arm selection), never a pass-through of the DaemonEvent object. The filter-plus-fresh-copy conclusion **survives**; only its stated reason changes, from identity to the drop.

**Must survive:** `:72-73`'s *"reduceTimeline folds it through `fillResult`, RESOLVING the correlated `toolCall`'s result in place (by toolUseId); an orphan or duplicate is a deterministic same-reference no-op (#121)"*. Rewrapping will move these words across line breaks; their content must be preserved.

**Budget proof** — one admissible wrap at 442 chars, ceiling 109, showing 5 lines suffice and 6 are not needed. **Not paste-ready mandated text**; the developer owns the final wording within the must-claim / must-survive constraints above.

```
      // The tool-result arm (#229). The DaemonEvent carries `conversationId` (#766) beside the four render   [107]
      // fields; the ThreadEvent this returns does not, so the id STOPS here — a filter + fresh copy (arm     [105]
      // selection), never a pass-through of the DaemonEvent object. reduceTimeline folds it through          [100]
      // `fillResult`, RESOLVING the correlated `toolCall`'s result in place (by toolUseId); an orphan or     [105]
      // duplicate is a deterministic same-reference no-op (#121).                                            [66]
```

**Must not change:** `:69` (`case 'toolResult':`), `:74-80` (the return literal — code, and the executable proof the id stops here), `:47-50` (#764's `toolUse` block), `:82-85` or `:122-128` (§ Pinned).

## Pinned — do not touch (each verified true at `0f9d1e0`)

The `field-for-field` grep the developer will run is scoped to `timelineBridge.ts`, and that is exactly where the collisions are.

| Site | Arm | Why it stays |
|---|---|---|
| `timelineBridge.ts:123` | `unrecognizedMessage` | Near-verbatim the target, **53 lines below it, and TRUE** — that arm's `conversation_id` is dropped upstream at the emit (`events.ts:422`), so its DaemonEvent carries none. **The most likely mis-sweep on this ticket.** |
| `timelineBridge.ts:85` | `sessionTransition` | TRUE; the field it drops is `newSessionId`, not a conversation id, and the *render fields* really are identical. |
| `timelineBridge.ts:50` | `toolUse` | **#764's repaired prose, TRUE.** Matches a `filter + fresh copy` grep. Do not re-sweep. |
| `threadTimeline.ts:128` | `sessionBoundary` | TRUE, and a ThreadEvent↔ThreadItem claim, not a DaemonEvent↔ThreadEvent one. Different file, out of scope (§ D6). |
| `threadTimeline.ts:151` | `unrecognizedMessage` | TRUE, same class. Out of scope. |
| `threadTimeline.ts:103-104` | `toolUse` | #764's, already true. Out of scope. |
| `inboundMessage.ts:192` | `unrecognized-message` | *"dropping `conversation_id`"* is **TRUE** (matches `events.ts:422`). Matches the same grep as the target. |
| `inboundMessage.ts:256` | the two modal kinds | *"dropping nothing — a modal has no `conversation_id`"* is TRUE. |
| `inboundMessage.ts:225`, `:988-989` | `parseToolResultPayload` | The *"four required strings"* decode counts — **wholly true** (§ D2). |
| `src/shared/wire/types.ts:730` and ~40 siblings | wire types | **wire↔daemon** claims, not DaemonEvent↔ThreadEvent. Unaffected — #763's sorting rule, held again here. |
| `src/shared/ipc/events.ts:507-527`, `src/main/daemonConnection.ts:911-925` | `toolResult` | #766's, already correct. Do not re-sweep. |

**No test churn and no e2e work.** #766 swept its own test twins — `timelineBridge.test.ts:164` already reads *"…keeping the render fields, the id stopping here"*, and its exact `toEqual` at `:174-180` already fails if the id ever crosses. Nothing under `src/**/*.test.ts` still claims this arm drops the id, and no `e2e/` spec carries drop-prose for it. Stated so AC4's "no test-name edits" clause does not read as an oversight.

**`docs/knowledge/`** belongs to the documentation phase. Out of scope, including the four `codebase/*.md` notes that cite `timelineBridge.ts:161` / `:206` / `:115-116` / `:130-131` — historical records of what a PR did at its time, not maintained anchors.

## Known-false, not ours — and the list is LONGER than the body says

The ticket body flags `inboundMessage.ts:98` as false-and-unowned. **There is a second one in the same doc block, and the body does not name it.** Both were verified against the emit-side types at `0f9d1e0`:

| Site | Claim | Why it is false | Owner |
|---|---|---|---|
| `inboundMessage.ts:98` | the two interactive-stream kinds carry text onward *"(dropping only `conversation_id`)"* | `events.ts:130` / `:141` — both `assistantDelta` and `turnEnd` carry `conversationId`, widened by #751 / #752 | **none** — neither widening got a citations sweep child |
| **`inboundMessage.ts:101-102`** | the `turn-state` kind's consumer *"carries only `state` onward (dropping `conversation_id`)"* | `events.ts:156` — `turnState` carries `conversationId`, widened by #724 (`346d272`) | **none** |

`:101-102` is the sharper miss of the two. #724 *did* get a sweep child — #725, *"retire the turnState-drops-conversation_id cross-references"* (`e96cb66`) — but that ticket scoped itself to **cross-references**, and its own commit message states the rule it worked to: *"Each site keeps its own factual statement that it drops conversation_id."* Correct for the arms that genuinely still dropped it; **wrong for turnState's own paragraph**, which #725 therefore never touched. It has read false since 2026-08-24.

It is also **invisible to the obvious grep**: the parenthetical wraps across the `:101` / `:102` line break, so `` dropping `conversation_id` `` matches neither line. A developer sweeping this file will see it only by reading.

**Both stay out of scope.** This ticket is the `toolResult` sweep, and #764's review already ruled that citation overflow is a PO follow-up, never in-scope work — the scope table is a ceiling. This is now the **third consecutive sweep to step around `:98`**, and the second to step around it without a filed owner.

**Recommend PO file one follow-up covering both** (`inboundMessage.ts:98` for #751 / #752, `:101-102` for #724). Posted as a comment on #767 rather than silently carried, so it does not require a fourth ticket to rediscover it.

## Verification

The compiler and the suite cannot catch a mistake here — the whole diff is comments. Run all six; none alone is sufficient.

1. **Classify, don't count to zero.** Any gate over these claims counts *down*, so **deleting** the two comments scores a perfect green — and deletes the security claim (§ Security review, finding 1). Read both blocks and confirm each *positively asserts* its replacement claim.

2. **Confirm the surviving counts, don't just check the parenthetical went.** Grep `four` in `inboundMessage.ts` (13 lines) and confirm **`:224` still reads "four render fields"** and `:225` / `:988` still read "four required strings". A diff that satisfies AC1 while bumping either count has shipped a new falsehood (§ D1, § D2).

3. **Sweep case-insensitively and classify all hits.** `rg -i 'field-for-field' src/renderer/src/store/timelineBridge.ts` returns **3**: 1 repaired (`:70`), 2 pinned (`:85`, `:123`). A case-sensitive sweep silently loses `:70` itself, whose capital **F** does not match a lowercase pattern.

4. **Per-hunk line-count check.**

   ```bash
   git diff -U0 -- src/main/transport/inboundMessage.ts src/renderer/src/store/timelineBridge.ts
   ```

   Every `@@ -a,b +c,d @@` must have `b == d`, **except** the single `timelineBridge.ts` hunk, which is `d == b + 1` and no more. `--numstat` is not a substitute — it aggregates per file, so a `+1`/`-1` in different blocks cancels there while still shifting every citation between them.

5. **Width scan of the rewritten regions** — not the file max, which is set by untouched lines and stays flat while an edit is malformed. Check Site 1 against ceiling **112** and Site 2 against **109**; file maxima must stay flat at **112** and **121**. There is no prettier and no eslint in this repo, so nothing re-wraps what the developer widens (and `awk 'length>100'` is a false alarm here — siblings run to 109).

6. **Comment-only, then the suites.** Every `+`/`-` line in `git diff` begins with `*` or `//` after indentation. `type: 'toolResult'` literal counts unchanged; `threadTimeline.ts` absent from the diff entirely (§ D6). Then `npm run typecheck` and `npm test` pass unchanged — and **read both halves of typecheck**: it is `&&`-chained, so a node-side failure masks every web-side error. `npm run build` clean.

**Fresh-worktree note:** the developer's worktree has no `node_modules`. Run `npm install` first; `npx tsc` is a decoy that resolves a different TypeScript.

## Open questions

None. Both offsets, the template, the seven in-code line citations and their live/drifted status, both character budgets, both `replace_all` inversions, the case-sensitivity trap, both "four" counts, and the second unowned false claim at `:101-102` were verified against `main` at `0f9d1e0` while writing this spec.

## Security review

**Verdict:** PASS

**Findings:**

1. **[Trust boundaries] SHOULD FIX — addressed in the design.** `translateTimelineEvent` is where a daemon-asserted `conversationId` **stops** on its way to the renderer's timeline reducer, and Site 2 is the written form of that boundary. The adversarial reading: every gate over these claims counts *down*, so the cheapest way to pass is to **delete** the comment — which removes the boundary's documentation and creates the exact condition under which a future reader "simplifies" `timelineBridge.ts:74-80` into a pass-through, carrying the id into the reducer silently. Three requirements close it: Site 2's must-claim list requires the replacement to state that **the id STOPS here**; the filter-plus-fresh-copy conclusion must survive with a new stated reason rather than be dropped; and § D4's per-hunk line-count check (Verification 4) makes wholesale deletion structurally visible. Verification 1 states outright that a green sweep does not prove the work. This is also why § D4 spends a line of anchor drift rather than cut *"never a pass-through of the DaemonEvent object"* to fit — that clause is the foreclosure.

2. **[Trust boundaries] No findings, second aspect.** The boundary stays a single explicit chokepoint: `translateTimelineEvent`, one `switch`, one fresh object per arm. The spec changes no arm and pins `:69` and `:74-80` as untouchable code, so the boundary's *enforcement* is byte-identical before and after — only its *description* changes. The executable proof is unchanged and already green: `timelineBridge.test.ts:174-180`'s exact `toEqual` fails if the id ever crosses, and #766 already renamed that test to name the invariant (`:164`).

3. **[Trust boundaries] SHOULD FIX — addressed in the design.** Two silent cross-boundary falsehoods are reachable by an obvious tool call, and § D3 is a security finding rather than an editing hazard. (a) A `replace_all` on `` dropping `conversation_id` `` in `inboundMessage.ts` also rewrites `:192` — the `unrecognized-message` arm — asserting that a routing key crosses the IPC boundary for an arm where it provably does not (`events.ts:422`). (b) A `replace_all` on the phrase fragments in `timelineBridge.ts` reaches `:123`, near-verbatim the target and true for the same reason. Both fail silently: plausible match count, `tsc` green, suite green, in the files a reader consults to learn exactly what crosses. Closed by banning `replace_all` in both files, by the unique anchor given for Site 2, and by § Pinned listing every collision by file:line with its truth value. Downgraded from MUST FIX because the design forecloses it; if the ban is dropped, it returns as MUST FIX.

4. **[Trust boundaries] SHOULD FIX — bounded, not closed, and named.** Two claims in the edited file assert **falsely** that a routing key stops at the IPC boundary when it crosses: `inboundMessage.ts:98` (`assistantDelta` / `turnEnd`, #751 / #752) and `:101-102` (`turnState`, #724). Both are unowned; `:101-102` is newly identified by this spec and absent from the ticket body (§ Known-false, not ours). A reader consulting this doc block to learn what crosses the boundary on those three arms is misinformed today. It is bounded rather than exploitable: the *enforcement* is correct on all three arms — the ids genuinely cross, by design, with the security rationale stated in full at `events.ts:130` / `:141` / `:156` — so the defect is documentation-only, in the safe direction (the doc under-claims what crosses). Kept out of scope per #764's citation-overflow ruling; **recommended to PO as a single follow-up** covering both, posted as a comment so the third and fourth sweeps do not step around it again.

5. **[Tokens, secrets, credentials] N/A by design decision.** The field at issue is `conversationId`, classified upstream (#766, `events.ts:508-515`; `daemonConnection.ts:915-921`) as a daemon-asserted **routing key, not rendered text** — the untrusted-text warnings on `resultSummary` do not attach to it, and it reaches no sink on that leg. That classification is neither restated nor weakened here. No token, key, or raw frame appears in either block, and Site 1's surviving *"four required strings PLUS one required boolean"* clause is the fail-closed decode claim, preserved byte-identical by § D2.

6. **[File / storage operations] N/A by design decision.** No path is constructed, read, or written; the change adds zero executable lines (Verification 6).

7. **[Inter-process / Electron attack surface] No findings.** The IPC arm shape is frozen by the comment-only constraint: no `contextBridge` API, no `ipcMain` channel, no `webPreferences` value, and no `DaemonEvent` or `ThreadEvent` union member added or altered. § D6 additionally forbids the `ThreadEvent` `toolResult` member at `threadTimeline.ts:122` from gaining the field — the one code change that would actually breach the seam this ticket documents. `case 'toolResult':` stays an explicit arm, so it remains a documented decision rather than a fall-through into the `null` group, and the `assertNever` guard is untouched.

8. **[Cryptographic primitives] N/A by design decision.** No RNG, no comparison, no Noise-adjacent code is in the diff's reach; neither file holds crypto.

9. **[Network & I/O] N/A by design decision.** No socket, frame cap, timeout, or URL is touched. Decode-side validation for `conversation_id` is fail-closed upstream in `parseToolResultPayload` and out of this ticket's reach — this spec reads that function only to source a count (§ D2).

10. **[Error messages, logs, telemetry] No findings — verified, not assumed.** The one log-shaped sink in these files is `assertNever`'s `JSON.stringify(event)` at `timelineBridge.ts:18`. An arm with an explicit `case` never reaches it, and `case 'toolResult':` returns at `:74-80` before the fall-through group — so the `conversationId`-carrying DaemonEvent is not stringified anywhere in the bridge. The spec adds no log call, and `inboundMessage.ts`'s doc block contains no sink.

11. **[Concurrency] N/A by design decision.** No async task, listener, timer, or `AbortController` is added or removed; there is no executable line in the diff.

12. **[Threat model alignment] OUT OF SCOPE, named.** *Renderer compromise reaching the transport* is unaffected — process placement is unchanged and the repair strengthens the written boundary. Four adjacent gaps are deliberately deferred and recorded so they are not lost: (a) the two unowned false claims of finding 4, recommended to PO; (b) the drifted anchors `timelineBridge.ts:96-120` / `:161` / `:206`, all three measured as already-drifted, which § D4 caps at one further line of degradation but does not repair; (c) the stale-`events.ts:<line>`-citation backlog, which § D7 forbids this ticket from growing; (d) any restatement of these claims under `docs/knowledge/`, which belongs to the documentation phase.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-25
