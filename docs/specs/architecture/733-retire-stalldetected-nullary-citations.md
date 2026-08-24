# #733 — Retire the borrowed `stallDetected`-is-nullary citations

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/733
**Size:** S (held; see § Size check)
**Labels:** `security-sensitive` — the security-review pass at the end of this spec is mandatory and was run.
**Measured on:** this worktree at `abe2a06` (i.e. after #732 / PR #735 merged). Every count below was re-run here, not copied from the body.

## Design source

N/A — transport and renderer-store doc comments plus two e2e comments. Zero rendered surface, no Figma node, and the ticket body carries no `## Figma` section because there is nothing visual to anchor. The visual-fidelity check is intentionally skipped.

## Files to read first

**Codegraph was not queried and is not the tool here.** It is not indexed for this repo (`.codegraph/` holds `config.json` and a `.gitignore`, no database — every `codegraph_*` call returns "CodeGraph not initialized"), and even indexed it parses code, not comments, while this ticket's entire surface is comment lines. The reading list below is a `grep` census, reproducible in the three commands in § The census.

Read in this order. The first two are the *replacement vocabulary*; read them before you write a single word, because AC-satisfying prose is prose that matches them.

- `src/shared/ipc/events.ts:126-145` — **#732's canonical wording for this arm, already merged.** This is the sentence every rewrite in this ticket has to agree with: the id is "a daemon-asserted ROUTING KEY, not rendered text … never markup, a filename, a cache key, a lookup path, an attribute or a URL, and it reaches no log sink", and "It STOPS at the renderer timeline bridge (#202), which rebuilds a fresh ThreadEvent and omits it; ThreadEvent stays nullary". **Do not invent a second phrasing for the same rule.** Note `:129` — the *"turn-stream item, or daemon state?"* test — that is the named rule the `background-task-started` repair (site S2) has to cite.
- `src/main/daemonConnection.ts:624-637` — the emit-side twin of the same paragraph, also #732's, also already correct. Second data point for the vocabulary. **Neither this file nor `events.ts` is edited by this ticket** — verify and move on.
- `src/main/transport/inboundMessage.ts:104-119` — the `stall` decode paragraph (`:104-110`, #732's, correct) sitting directly above the `api-retry` paragraph (`:112-119`) that site **S1** repairs. Read both together: the falsified clause on `:114` is one sentence away from two clauses that must survive verbatim (`:112-113`'s PTY-peer relationship, `:115`'s `dropping only conversation_id` — which belongs to **#729**, not to you).
- `src/main/transport/inboundMessage.ts:145-155` — the `background-task-started` paragraph, site **S2**. The contrast list is on `:147` and the broken inference is the word `so` on `:149`. Extract: the parenthetical already names the real rule ("the queue-state rule, #720").
- `src/main/transport/inboundMessage.ts:129-136` and `:184-187` — the two contrast clauses AC2 pins as survivors (`model-announced`, `unrecognized-message`). Read them once so you recognise them, leave them alone, and do not spend a turn wondering whether they are S2 again.
- `src/renderer/src/store/timelineBridge.ts:96-101` — site **S3**, the four-line comment above `return { type: 'stallDetected' }`. Extract: the conclusion the block argues for ("filter + fresh literal, never a pass-through") is now *more* true, not less.
- `src/renderer/src/store/threadTimeline.ts:132-136` — sites **S4** and **S5** plus the ThreadEvent arm declaration at `:136`. `:136` is the line number site S6's back-reference must point at, **after your own edits** (see § Rule L1).
- `src/renderer/src/store/threadTimeline.ts:160-165` — site **S6**, the `reset` arm. `:163` carries the stale `(:109)` and is one of the two counted survivors. `:167`'s stale `(:133)` is four lines below and is **not this ticket** — read it, recognise it, leave it.
- `src/renderer/src/store/timelineBridge.test.ts:190-196` — the other counted survivor. The test *name* on `:190` describes the ThreadEvent output and stays; `:191`'s input already carries `conversationId: 'conv-1'` (#732 widened it). **No edit here.** Read it so you can prove to yourself the gate's second survivor is real.
- `e2e/stall-bundle.spec.ts:57-60` and `:124-130` — sites **S7** and **S8**. Both are "the conclusion stays true, the reason moved" repairs.
- `docs/specs/architecture/725-*.md` § "The deletion contract" — the direct precedent one ticket earlier. Same family, same shape, comment-only, S, zero review findings. Its posture (edit exactly the named clause, do not re-flow the paragraph) is this spec's posture too.

## Context

#732 widened the `DaemonEvent` `stallDetected` arm to carry `conversationId`, and rebuilt every claim about that arm's own behaviour *where that claim is made* — in `events.ts`, `daemonConnection.ts`, and the arm's decode paragraph in `inboundMessage.ts:104-110`.

The "nullary by construction" property was load-bearing: it *was* the argument that no token, key, raw frame or conversation content could ride an arm with no field to ride on. Because it was load-bearing, other arms borrowed it as an exemplar. Those borrowed citations live in files #732 never opened, and they are phrased "nullary" / "no payload" / "decodes it nullary" rather than "drops `conversation_id`" — so the grep that found #732's own sites finds none of them. This ticket retires them.

Zero lines of production code change. No behaviour moves, no type changes, no test assertion or test name changes, no line is added or removed (§ Rule L1).

**The failure this ticket is written against is over-deletion, not under-deletion.** The word `stallDetected` now names two different things — the IPC `DaemonEvent` arm, which carries a payload, and the `ThreadEvent` arm, which does not. Three nullary claims in the tree are about the second and are still true. A pass that chases the gate to zero deletes them.

## Size check

Held at **S**. No red line trips, and every one measures at or near zero:

| Red line | Threshold | This ticket |
|---|---|---|
| New files | > 3 | **0** |
| Total written LOC (prod + tests + helpers + log calls + spec edits) | > ~600 | **~30 changed comment lines**, zero added or removed |
| New exported types / components / interfaces | > 5 | **0** |
| Consumer call sites needing simultaneous update | > 10 | **0** — no symbol, signature or type changes, so there is no fan-out to have |
| Acceptance criteria worth of work | > 5 | **3** |
| Distinct error / reject branches | > ~10 | **0** |

**Pre-commit self-check (production source files with modified content, `*.ts`/`*.tsx`, excluding `*.test.ts` / `*.spec.ts` / `*.md`):** `inboundMessage.ts`, `timelineBridge.ts`, `threadTimeline.ts` = **3**. Under the gate of 5. `e2e/stall-bundle.spec.ts` is a `*.spec.ts` and is excluded by the rule; it is comment-only regardless.

**PO's body re-checked against the red lines independently** (the defence layer — PO's label is a hypothesis, not a constraint): 4 files, 3 AC, 8 edit points, no new symbol. Nothing trips. The body's size label is correct.

**Not lowered to XS.** The edit *count* is small; the per-edit reasoning is not. Eight sites each need the surrounding paragraph read before the cut, three of them sit one clause away from a survivor that must not move, the AC gate is a line-scoped grep whose arithmetic is non-obvious in three separate places (§ Rule G), every edit is constrained to be line-count-neutral (§ Rule L1), and AC3 requires `npm run build`, `npm test` **and** `npm run e2e` — the e2e tier alone is several turns. Direct precedent: **#725**, 20 sites across 4 files, comment-only, held S, zero review findings. This is fewer sites at higher reasoning density.

## File-overlap check

Run at `abe2a06` against **all 16** remote `origin/feature/*` branches after `git fetch origin --prune`. Every one returns an empty `git diff --name-only origin/main...origin/feature/N` — all merged, none carries in-flight work. **No overlap. No `addBlockedBy`.**

The one collision worth naming explicitly, because the body flags it and the mechanical check cannot see it: **#729** (OPEN, `size:s`, `security-sensitive`, `rework-count:1`) will edit the *same sentence* at `inboundMessage.ts:113-115`. Its branch exists with zero commits, so there is nothing to conflict with today. The two tickets own different clauses of that sentence — this one owns "Unlike `stall` … NOT nullary", #729 owns "dropping only `conversation_id`" — and the body's resolution stands: whichever lands second re-greps rather than trusting recorded offsets. Rule **L1** below makes this ticket's half of that contract mechanical: it leaves the sentence at the same line numbers it found them.

## The census — verified, not inherited

Three commands establish the whole surface. All three were re-run on this worktree; every number in the ticket body reproduces.

```
grep -rnE "nullary|NULLARY|no payload" --include='*.ts' --include='*.tsx' src e2e | grep -ic stall   # → 8   (the AC gate)
grep -rn "stallDetected" --include='*.ts' --include='*.tsx' src e2e | wc -l                          # → 36  across 12 files
grep -c "stall" src/main/transport/inboundMessage.ts                                                  # → 15
```

**No single grep is a census, and two edit sites are reachable by neither of the first two.** The arithmetic:

- The **bare-token** grep returns 36 hits across 12 files. Of those, 13 are in this ticket's files — `threadTimeline.ts` 6, `timelineBridge.ts` 5, `e2e/stall-bundle.spec.ts` 2, and **`inboundMessage.ts` 0.** #732 removed that file's last `stallDetected` token when it rewrote the `stall` paragraph, so the bare-token grep now finds *nothing at all* in the one file where two of this ticket's edits live.
- Sites **S1** and **S2** say `` `stall` `` — the wire kind name — not `stallDetected`. S1 is caught by the gate; **S2 is caught by neither** and is reachable only by the third command.
- `threadTimeline.ts:133` is caught by neither the gate nor the site table, and it survives. You must *see* it to leave it deliberately (§ Site S5).

The `{ type: 'stallDetected' }` literal occurs **5× across 4 files**, down from 12× across 9 before #732 — and all five survivors are the ThreadEvent: `threadTimeline.ts:136` (the arm), `threadTimeline.test.ts:67` (a test helper), `timelineBridge.ts:101` (the bridge's return), `timelineBridge.test.ts:193` (the bridge test's assertion), and the literal quoted inside the comment at `timelineBridge.ts:98`. **This ticket changes none of them.** Only the prose surrounding that last one changes.

## Design

Three rules, then the site contract. The rules are what make the ACs checkable; the table is what makes them findable.

### Rule G — the AC gate is a *line-scoped conjunction*, and it is a floor, not a census

The gate is `grep -E "nullary|NULLARY|no payload" … | grep -i stall`. A piped pair of greps counts a line only when **both** vocabularies land on the **same physical line**. Three consequences follow, and each one is a way to write correct, true prose and still fail AC1. None of them is visible from the ticket body's site table.

- **G1 — a true statement can *raise* the count to 3.** At site **S3** the ThreadEvent is still payload-free, and #732's own wording for that fact is "ThreadEvent stays nullary". Writing that phrase onto a line that also carries `stall` (or the quoted `{ type: 'stallDetected' }` literal, which is on `:98` today) leaves the site counted and the gate returns **3**. **Constraint:** at S3, state the ThreadEvent's shape by *showing the literal*, and keep the words `nullary` / `no payload` off any line that carries the token `stall`. This is not grep-appeasement — it is the same disambiguation AC1 already forces at S6: after #732 the bare adjective "nullary" applied to `stallDetected` is ambiguous between two arms, and the literal is not.
- **G2 — a re-wrap can *drop* the count to 1.** Site **S6** (`threadTimeline.ts:163`) is a counted survivor *only because* `stallDetected` and `no payload` happen to sit on one physical line today. Re-flowing that comment so the phrase spans a line break silently un-counts it and the gate returns **1** — indistinguishable, to the gate, from having deleted a true claim. **Constraint:** at S6, `stallDetected` and `no payload` must remain on the same physical line.
- **G3 — the third survivor is invisible to the gate and must stay that way.** `threadTimeline.ts:133` carries `NULLARY` and `no payload` but not the token `stall`, so it has never counted. It sits inside the paragraph site **S5** edits. **Constraint:** do not introduce the token `stall` onto that line while repairing it, or the gate returns 3.

The gate arithmetic this design produces, site by site — reproduce it and you cannot land on 1 or 3 by accident:

| Site | Gate hits today | After | Δ |
|---|---|---|---|
| S1 `inboundMessage.ts:114` | 1 | 0 | −1 |
| S3 `timelineBridge.ts:97`, `:98` | 2 | 0 | −2 |
| S4 `threadTimeline.ts:132` | 1 | 0 | −1 |
| S7 `e2e/stall-bundle.spec.ts:59` | 1 | 0 | −1 |
| S8 `e2e/stall-bundle.spec.ts:128` | 1 | 0 | −1 |
| S6 `threadTimeline.ts:163` — **survivor** | 1 | 1 | 0 |
| `timelineBridge.test.ts:190` — **survivor, not edited** | 1 | 1 | 0 |
| **Total** | **8** | **2** | **−6** |

S2 and S5 carry no gate vocabulary on their edited lines and contribute 0 in both columns. That is why they are invisible to AC1 and why the ticket needs a site table at all.

### Rule L1 — every edit is line-count-neutral

Each edited comment block must end with **exactly the number of physical lines it started with**. Re-word inside the block, re-wrap inside the block, do not grow or shrink it.

This is not tidiness. This codebase documents itself with bare line-number back-references, and **six live cross-file references point *below* this ticket's edit sites**:

| Reference | Points at | Sits below edits at |
|---|---|---|
| `PairedShell.tsx:37`, `activateConversation.ts:43`, `clearPairingScopedState.ts:53` | `timelineBridge.ts:206` | `timelineBridge.ts:97-100` |
| `announcedModelBridge.ts:11`, `announcedModelStore.ts:12` | `timelineBridge.ts:161` | `timelineBridge.ts:97-100` |
| `ConversationScreen.tsx:1244` | `threadTimeline.ts:213` | `threadTimeline.ts:132-135`, `:163` |
| `conversationArchivedBridge.ts:6` | `inboundMessage.ts:1073` | `inboundMessage.ts:114`, `:149` |

Plus the in-file `(:NNN)` refs at `threadTimeline.ts:163`, `:167` and `:219`. A ticket whose entire purpose is retiring stale references that would itself create six new ones is the self-inflicted repeat of the #725 → #734 leak this family keeps producing. Holding the line count makes every one of them structurally impossible — and it also makes this ticket's half of the #729 collision contract mechanical: #729 finds its clause exactly where it left it.

One consequence to act on rather than assume: **site S6's back-reference target is `threadTimeline.ts:136`, which is four lines below site S4/S5's block.** That number is only correct because L1 holds. Verify it after editing (§ Verification, step 3) rather than trusting the body's measurement.

### Rule W — state the rule, never the neighbour

#729 / #730 / #714 (all OPEN) will make `apiRetry` / `compacting` / `modelAnnounced` carry the id in turn. A comment repaired to read "unlike `api-retry`, which drops it" is a fresh cross-reference that goes false in a few tickets — the exact defect being retired here, re-created in the act of retiring it.

**No rewrite on this ticket may add a new claim about another arm's drop-or-carry behaviour.** Where a rewrite needs to justify why an arm carries or drops the id, cite the named rule, which already exists in two merged places:

- the *"turn-stream item, or daemon state?"* test — `events.ts:129`, written by #724
- the queue-state rule, **#720** — already named in the parenthetical at `inboundMessage.ts:149`

Existing true statements *about `stall` itself* are unaffected by this rule and stay (AC2's three contrast lists, the two PTY-peer clauses).

### Site contract

Eight edits. At each one, change exactly the named clause; do not re-flow the paragraph, do not rewrite the surrounding sentence, do not fix an adjacent staleness you notice.

| # | Site | What is false | What must survive in the same paragraph |
|---|---|---|---|
| **S1** | `inboundMessage.ts:113-115` (`api-retry`) | "Unlike `stall` this arm is NOT nullary" — `stall` is no longer the nullary exemplar. Repair **the contrast only**. | `:112-113` "the PTY-derived status peer of `stall`" (a peer relationship, not a payload claim). `:115` "dropping only `conversation_id`" — **#729's clause, verbatim, untouched.** |
| **S2** | `inboundMessage.ts:145-150` (`background-task-started`) | The **`so` on `:149`**: presenting not-being-a-claude-sub-state as the *reason* the id is carried implies the sub-state neighbours drop it, and one of them no longer does. Re-attribute the id-carrying to the named rule (Rule W). | **`:147`'s contrast list, verbatim.** `stall` *is* a claude sub-state and stays one — removing the name writes a new falsehood. AC2 is explicit that the repair lands on `:149`, not on `:147`. |
| **S3** | `timelineBridge.ts:97-100` | "the stall-onset arm (#315 decodes it nullary)" and "**Both** the DaemonEvent and the ThreadEvent are `{ type: 'stallDetected' }` — no payload". The DaemonEvent half only. | The ThreadEvent half, and the conclusion running to `:100` — which gets **stronger**: the bridge now genuinely drops a field, so "filter + fresh literal, never a pass-through" is more true than before. Subject to **G1**. |
| **S4** | `threadTimeline.ts:132` | "(#315 decodes it to a nullary `stallDetected` daemon event)". **This line only.** | `:133-135`, subject to S5. `:136`, the arm declaration, is untouched. |
| **S5** | `threadTimeline.ts:133` | The **reason** clause "the wire frame carries no field the renderer keeps" — same shape as S7/S8: conclusion true, reason moved. See § The one AC-adjacent judgment call. | **The claim** — "A NULLARY arm", "this event has no payload" — verbatim in substance. AC3 counts this line as a standing claim. Subject to **G3**. |
| **S6** | `threadTimeline.ts:163` | Nothing. **The claim is true.** Two defects only: the bare name is now ambiguous between the two arms, and `(:109)` is a stale back-reference to a ThreadEvent arm that now lives at `:136`. Disambiguate and repoint. | The whole claim. Subject to **G2** — this is a counted survivor and must still match the gate. |
| **S7** | `e2e/stall-bundle.spec.ts:58-59` | "the decoder drops it (→ nullary stallDetected)". The **conclusion** stays true — the id still does not gate rendering, because the render path reads the open conversation — but the drop moved from the decoder to the timeline bridge. | The conclusion, and the `conversation_id: SEEDED_ROW.id` realism note above it. No assertion, selector, timeout or fixture changes. |
| **S8** | `e2e/stall-bundle.spec.ts:127-128` | "the transport decodes it to the nullary stallDetected event and the reducer flips `stalled` true". Same repair as S7. | The reducer half and everything after it. No assertion changes. |

### The one AC-adjacent judgment call — site S5

AC3 lists `threadTimeline.ts:133` among the three claims that must be left standing, and says "Leave it". **This spec reads that as: do not delete the claim** — and repairs the line's *reason* clause while keeping its claim verbatim in substance. The reasoning, stated plainly so code-review can follow or overrule it:

The line reads *"A NULLARY arm — the wire frame carries no field the renderer keeps, so this event has no payload either."* That is the **identical sentence structure** the ticket body itself flags as falsified at S7: a true conclusion resting on a reason that moved. Before #732 the wire frame's `stall` payload had one field and the decoder dropped it, so "carries no field the renderer keeps" was a fact about the wire. After #732 the frame's `conversation_id` reaches the renderer on the `DaemonEvent` and is dropped one layer later, at the bridge. The conclusion holds; the reason does not.

Leaving it produces a paragraph that contradicts itself four lines running: S4 rewrites `:132` to say the daemon event now carries `conversationId`, and `:133` immediately answers that the wire frame carries no field the renderer keeps. Today the two lines are at least *consistently* wrong; after S4 they disagree with each other in the same breath. Shipping that re-creates, inside the very paragraph this ticket opens, the #725 → #734 leak the ticket's own Context section is written against.

The repair is bounded and satisfies every ACing constraint simultaneously: the words `NULLARY` and `no payload` stay (AC3's standing claim, and AC1's subject is the *IPC* arm — this line is about the ThreadEvent, so it was never in AC1's scope), the token `stall` stays off the line (**G3** — the gate stays at 2, because this line never counted), and the block stays four lines (**L1**). The new reason is the one #732 already wrote twice: the id stops at the bridge.

**If code-review disagrees, the safe fallback is to revert `:133` alone** — the other seven sites are independent of it and every AC still passes, at the cost of the self-contradicting paragraph.

## State, concurrency, error handling

**N/A, in all three cases, and named rather than skipped.** No store slice, reducer, selector, subscription, async task, `AbortController`, listener or teardown path is added, removed or re-documented. No decode branch, `WireDecodeError`, fail-closed check, result type or UI error surface changes. The `parseStallPayload` doc block at `inboundMessage.ts:588-597` — the only place on this ticket's reading path that describes error behaviour — is entirely true (the *parser* always returned `conversation_id`; #732 changed what the *consumer* does with it) and is **out of scope**. Its `:591` "no closed enum (stall carries no `state`)" and `:593` "Returns only the one known field" read like payload claims and are not; the `stall`-in-`inboundMessage.ts` grep returns them, so you will land on them.

## Testing strategy

**No test is added, removed, renamed or re-asserted.** The existing suite is the regression net and it already covers the widened arm — `timelineBridge.test.ts:190-196` feeds a `DaemonEvent` carrying `conversationId: 'conv-1'` and asserts the translated `ThreadEvent` is `toEqual({ type: 'stallDetected' })` plus `not.toBe(event)`. That test is the executable form of the claim every comment on this ticket describes, and it is green at `abe2a06`.

AC3's three commands are the gate:

- `npm run build` — typecheck (both halves) then build. Note the typecheck is `&&`-chained, so a `src/main` error masks the `src/renderer` half; a comment-only change cannot produce one, but read the output rather than the exit code if anything surprises you.
- `npm test` — vitest.
- `npm run e2e` — the fake-transport tier. `e2e/` is in **neither** tsconfig `include` (`tsconfig.node.json` covers `src/main`, `src/preload`, `src/shared`; `tsconfig.web.json` covers `src/renderer/src`, `src/preload/*.d.ts`, `src/shared`), so `npm run build` does not see `e2e/stall-bundle.spec.ts` at all. The e2e run is the only thing that exercises S7/S8's file, and AC3 requires it.

All three must be green, and all three are green-by-construction for a comment-only, line-count-neutral change — which is precisely why the *verification* below, not the test suite, is where this ticket is actually checked.

## Verification

Run in order. Steps 1–3 are the AC; step 4 is Rule L1.

1. **AC3, comment-only** — `git diff` must touch no executable line, no assertion and no test name:
   ```
   git diff --stat                         # 4 files
   git diff -U0 | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -vE '^[+-]\s*(//|\*|/\*)'
   ```
   The second command must return **empty**. Every changed line is a comment line.

2. **AC1, the gate** — verify by **content**, not by count. The count is the AC's wording; the content list is what makes 1-vs-2-vs-3 diagnosable:
   ```
   grep -rnE "nullary|NULLARY|no payload" --include='*.ts' --include='*.tsx' src e2e | grep -i stall
   ```
   Exactly two lines, and they must be *these* two: `threadTimeline.ts` — the `reset` arm's ThreadEvent back-reference (site S6), and `timelineBridge.test.ts:190` — the ThreadEvent test name. A result of **1** means G2 fired (S6 re-wrapped). A result of **3** means G1 or G3 fired (a true nullary claim landed on a `stall`-bearing line).

3. **Rule L1 and site S6's target** — confirm the arm is still at `:136` and the back-reference points at it:
   ```
   grep -n "| { type: 'stallDetected' }" src/renderer/src/store/threadTimeline.ts   # → 136
   ```

4. **AC2, the three contrast lists** — all three still name `stall`:
   ```
   grep -n "claude sub-state" src/main/transport/inboundMessage.ts
   ```
   Three hits (`:131`, `:147`, `:185-186`'s paragraph), each still carrying `` `stall` `` in its list.

5. **AC3, the suites** — `npm run build && npm test && npm run e2e`.

## Non-goals — verified true at `abe2a06`, do not touch

Over-deletion is the risk this ticket exists to prevent, so the exclusions are part of the contract, not a courtesy list. Every entry below matches one of the three census greps and every one stays.

- `inboundMessage.ts:100-102` — the `turn-state` decode paragraph, false since #724 merged. **Tracked as #734.** It is the leak that proves this family's failure mode; fixing it here is scope creep of exactly the kind #725 avoided.
- `inboundMessage.ts:115` — "dropping only `conversation_id`". True today, **#729's** to retire.
- `inboundMessage.ts:131`, `:147`, `:185-186` — the three "claude sub-state" contrast lists. `stall` is a claude sub-state and stays one; AC2 pins all three.
- `inboundMessage.ts:112-113`, `:121-122` — the two "PTY-derived status peer" clauses. A peer relationship, not a payload claim. The first sits in the same sentence-neighbourhood as S1 and is the likeliest thing to be deleted by accident on this ticket.
- `inboundMessage.ts:588-597` — the whole `parseStallPayload` doc block (see § State, concurrency, error handling).
- `threadTimeline.ts:136`, `:141-142`, `:194`, `:470`; `timelineBridge.ts:24`, `:101`, `:181`; `threadTimeline.test.ts:67`, `:341` — the ThreadEvent arm, the render-path claim, and wiring/reducer references. No payload claim among them. **No type changes on this ticket.**
- `threadTimeline.ts:167` — "distinct from `reset` (:133)" is a stale back-reference (`reset` is at `:165`), it is about `reset` rather than `stallDetected`, and you will be reading four lines below site S6. **Not this ticket.**
- `daemonEventBridge.ts`, `modalBridge.ts`, and `events.ts:157`, `:362`, `:464`, `:547` — the "stallDetected-was-a-no-op-until-#317" precedent citations. About bridge wiring, not payload shape. Verified: `events.ts` retains no falsified payload claim for this arm, and the "matching stallDetected" cross-reference #725's security review flagged as going false when #728 lands is **already gone**.
- `src/shared/ipc/events.ts`, `src/main/daemonConnection.ts`, `inboundMessage.ts:104-110` — **#732's, already done.** Verify, do not redo.
- `timelineBridge.ts:161` and `:206`, and the five cross-file references pointing at them — `:206` is already stale (it is mid-comment about the announced-model store, not "the bridge idiom"). Pre-existing, unrelated to this arm, and **out of scope**; Rule L1 guarantees this ticket neither fixes nor worsens it.

## Open questions

1. **Site S5 (`threadTimeline.ts:133`)** — the one place this spec exercises judgment against a literal reading of an AC. The argument and the fallback are in § The one AC-adjacent judgment call. Code-review should rule; either outcome ships a passing ticket.
2. **The gate's exact value is a proxy, not the contract.** AC1 pins it at 2, and this spec's step-2 verification pins the two *lines* instead — strictly stronger, and it implies the count. If a rewrite that is clearly correct nonetheless lands the gate at 3 because a true ThreadEvent claim needs the word `nullary` on a `stall`-bearing line, prefer the content list and say so in the PR body rather than contorting prose to hit the number. Rule G1 makes this unlikely; it is not impossible.
3. **#729 lands second, or this does.** Nothing to resolve here — Rule L1 holds this ticket's half of the contract, and #729's architect inherits the same note from its own body.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, and this is the category the ticket exists to serve. The comments being edited *are* the documentation of the main→renderer IPC boundary for the `stallDetected` arm — and main→renderer is a trusted→untrusted crossing, so the question at this boundary is disclosure, not injection. The property being retired ("nullary by construction, so nothing can ride it") was the old argument; the replacement is #732's, already merged at `events.ts:134-140` and `daemonConnection.ts:628-631`, and Rule W requires every rewrite to match it rather than invent a second phrasing: the id is a **daemon-asserted routing key, not rendered text**; never markup, a filename, a cache key, a lookup path, an attribute or a URL; it reaches no log sink; and it **stops at the timeline bridge**, which rebuilds a fresh `ThreadEvent` and omits it. The spec forbids weakening any of those (§ Rule W, § Non-goals) and changes no type, so the "stops at the bridge" claim remains enforced by `timelineBridge.ts:101`'s fresh literal and asserted by `timelineBridge.test.ts:193`.
- **[Trust boundaries — the over-deletion vector, closed by construction]** The concrete exploitable failure here is a bulk clause removal that takes an arm's own "no token, key, raw frame" claim with it, leaving a reader to infer a safety property nobody documents. Three things make that unreachable: the site contract names exactly one clause per site and forbids re-flowing the paragraph; the § Non-goals list is exhaustive against all three census greps; and the step-2 verification is content-based, so a deletion that overshoots shows up as gate = 1 with a *named* missing line rather than as a number nobody can diagnose. Spot-checked at the three sites nearest a security claim — S1 (`:114`, one clause from `:112-113`'s peer relationship and `:115`'s drop claim), S3 (`:97-100`, whose conclusion is the fresh-literal argument itself), S5 (`:133`, whose claim is retained verbatim) — the cut in each case is a reason clause and the claim clause is untouched.
- **[Tokens, secrets, credentials]** No findings. No token, key, or credential is handled, moved, stored, or re-documented. `conversationId` is not a credential: it is a daemon-asserted routing key with no authorisation semantics on this client — possession of it grants nothing, and the desktop client never uses it as an authentication input. The pairing token, the Noise static key and the relay socket are nowhere on this ticket's reading path.
- **[File / storage operations]** N/A — no filesystem path, read, write, serialisation, or `safeStorage` call is in scope. No line this ticket edits describes one.
- **[Inter-process / Electron attack surface]** No findings. The IPC surface is byte-unchanged: no arm gains or loses a field, no `contextBridge` API or `ipcMain` channel is added, no `webPreferences` is touched, no protocol handler or navigation guard is in scope. **`git diff` proving comment-only (§ Verification step 1) is the mechanical proof of this**, and it is an AC. What changes is the *description* of the surface — covered above.
- **[Cryptographic primitives]** N/A — no handshake, RNG, key, nonce, or comparison is in scope. The Noise variant constant is untouched and unreferenced by any edited line.
- **[Network & I/O]** N/A — no socket, `maxPayload` cap, timeout, TLS setting, relay URL, or reconnect path is touched. `e2e/stall-bundle.spec.ts`'s frame builder at `:60-66` constructs a `stall` envelope through the production codec and is **not edited** — only the comment above it is.
- **[Error messages, logs, telemetry]** No findings, and one claim is worth restating because it is the one a rewrite could quietly weaken. #732's wording asserts the id "reaches no log sink (`emitDaemonEvent` is log-free by construction, and the decode-side stall log is pinned content-free independently)". That claim lives in `events.ts` and `daemonConnection.ts`, both **out of scope and already correct**; no site in the table restates it, so no rewrite can contradict it. Separately: `threadTimeline.ts:229` stringifies a `ThreadEvent` — which is exactly why "the id stops at the timeline bridge" is a log-sink boundary and not merely a tidiness rule. This ticket changes no type and no bridge behaviour, so the id still never reaches that stringify. No log call, error message, or telemetry field is added or altered.
- **[Concurrency]** N/A — no async task, listener, timer, `AbortController`, or teardown path is touched. The `stall` arm's onset-only/no-dedup/no-timer property is documented at `events.ts:141-144` and `daemonConnection.ts:630-632`, both out of scope.
- **[Threat model alignment]** No findings for this ticket, named explicitly so it is not mistaken for coverage. The hostile-daemon defence for this arm is the fail-closed decode (`inboundMessage.ts:108-109`: a missing or non-string `conversation_id` fails the whole line rather than emitting a stall attributed to nothing) and the fresh-literal emit; both are described in clauses outside every cut and both are unchanged. The renderer-compromise defence is process placement, also unchanged. The malicious-relay case is unaffected — it is content-blind and this ticket adds no frame, cap, or timeout.
- **[Threat model alignment — OUT OF SCOPE, owners named]** Three future-staleness items this ticket deliberately does not fix, flagged so their owners inherit the note rather than rediscovering it:
  1. `inboundMessage.ts:100-102` — the `turn-state` decode paragraph has asserted a false drop since #724 merged. **#734.** This is the live proof that a comment-only cleanup in this family can leak, and it is why AC1 is a repo-wide classification rather than a site list.
  2. `inboundMessage.ts:115`, `:124`, `:133` and the corresponding `events.ts` clauses — "no token, key, raw frame, or conversation content can ride an arm with no string field on it" (`events.ts:150-151`) is true today for `apiRetry` / `compacting` / `modelAnnounced` and goes false the moment **#729 / #730 / #714** add `conversationId` to those arms. Each of those tickets rewrites its own arm; Rule W keeps this ticket from pre-emptively inventing replacements they would have to undo.
  3. `timelineBridge.ts:206`'s three inbound cross-file references are already stale (§ Non-goals). Unrelated to this arm, no security claim attached, unowned — worth an Inbox ticket, not this one.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-24
