# #764 — Retire the toolUse-drops-the-conversation-id citations

**Size:** S (comment-only; 3 production files, 3 comment blocks, zero executable lines, zero test churn)
**Label:** `security-sensitive` — the document *is* the security claim (the #725 / #733 / #738 / #743 precedent)
**Parent:** split from #753; twin of #763 (the arm, `52dc0cc`, merged) and of #767 (the `toolResult` citations)

## Design source

N/A — comment-only change, zero executable lines, no rendered surface. All three sites are `.ts` files; none touches markup, a class name, a token, or a copy constant. The visual-fidelity check is intentionally skipped.

## Baseline — re-verified at `6aadc97`

The body measured at `6aadc97` (`main` after #763's PR #765 merged). I re-verified every offset at that same commit; nothing has moved.

| Re-verified at `6aadc97` | Result |
|---|---|
| The three target sites resolve as quoted | **yes**, all three, byte-for-byte |
| `field-for-field` (case-insensitive) in the two renderer store files | **7** — 2 targets + 4 pinned + 1 (`timelineBridge.ts:69`) belonging to #767 |
| `field-for-field` repo-wide in `src/` | **~55**, of which every hit under `shared/wire/types.ts` is a wire↔daemon claim and stays true (#763's sorting rule, re-confirmed) |
| Overlapping in-flight `origin/feature/*` branches on the three files | **none** |
| `origin/feature/766` / `origin/feature/767` | neither exists — the `toolResult` twins are not in flight |
| codegraph | still unindexed (`.codegraph/` holds config only); grep/Read throughout, per the standing note |

**Prior-decision search:** satisfied from stronger sources than QMD would return — `docs/specs/architecture/743-retire-compacting-render-end-citations.md` (the direct precedent, read in full) and the #738 / #763 findings it and this project's memory carry.

## Files to read first

| Path | What to extract |
|---|---|
| `src/main/transport/inboundMessage.ts:217-220` | **Site 1.** The `tool-use` kind's contract paragraph — 4 lines. `:216` and `:221` are ` *` separators. Note the sentence carries **two different "five"s** (§ D1). |
| `src/main/transport/inboundMessage.ts:960-985` | `parseToolUsePayload`'s doc block + body (`:974-985`). **Ground truth for both counts**: five `requireString` calls (`conversation_id` / `turn_id` / `tool_use_id` / `name` / `input_summary`) plus `optionalStringMap('input')`. |
| `src/main/transport/inboundMessage.ts:222-226` | **#767's `tool-result` twin**, four lines below Site 1. Still true. This is the `replace_all` inversion target — read § D3 before touching either. |
| `src/renderer/src/store/threadTimeline.ts:103-104` | **Site 2**, 2 lines. `:105` is a `  //` separator and `:106-113` is the #643 `input` paragraph — both must survive untouched. |
| `src/renderer/src/store/threadTimeline.ts:137-143` | **The Site 2 template.** #738's `apiRetry` repair: *"#492 decodes it; #737 widened that daemon event with a `conversationId` the bridge drops"*. Copy this sentence shape. `:132-135` (#733's `stallDetected`) is the same shape. |
| `src/renderer/src/store/timelineBridge.ts:47-50` | **Site 3**, 3 comment lines under `case 'toolUse':`. `:51-59` is the #643 `input` paragraph — untouched. |
| `src/renderer/src/store/timelineBridge.ts:102-119` | **The Site 3 templates** — `apiRetry` `:103-107` and `compacting` `:115-119`, both 5 comment lines. Copy the *"…so the id STOPS here — a filter + fresh …(arm selection), never a pass-through of the DaemonEvent object"* sentence. **Two traps: "literal" must become "copy" (§ D5), and `:104`'s own field count must not be inherited (§ D1).** |
| `src/renderer/src/store/timelineBridge.ts:21-30` | The file-level rule: *"This is a filter, not a rename: an arm may carry fields its `ThreadEvent` deliberately drops."* Site 3's repair must read consistently with it. |
| `src/shared/ipc/events.ts:475-486` and `src/main/daemonConnection.ts:885-895` | **The SSOT for the replacement counts** — #763's already-corrected prose: *"Carries the five render fields plus `conversationId`"* and *"a fresh literal with the six named fields"*. Do **not** edit these; they are #763's and already right. |
| `docs/specs/architecture/743-retire-compacting-render-end-citations.md` | The direct precedent — same shape, same two renderer store files, shipped first-pass. Its § I2 (line-count neutrality) and § I5 (the `replace_all` inversion) are the two rules this spec re-derives against a different measurement. |
| `docs/specs/architecture/763-tooluse-conversation-id.md` | The widening this ticket cleans up after. |

## Context

#763 (`52dc0cc`) widened the `toolUse` IPC arm with `conversationId: string`, and swept its own two files plus its test twins in the same commit. Three comments **outside** those files still describe the pre-widening contract. Each encodes the drop indirectly, so no grep on `conversation_id` reaches any of them.

The second and third are the load-bearing pair. `translateTimelineEvent` is exactly where the conversation id must stop — `ThreadEvent` carries no conversation id, so the bridge is now a field-**dropping** filter, and that seam is what the per-conversation routing slice (#756) builds on. A comment asserting the two shapes are *field-for-field identical* tells the next reader the opposite of what the seam does, and invites the "simplify this to a pass-through" edit that would carry the id into the reducer silently while the comment still read as if that were safe.

## Design

Three comment-block repairs. No new module, no type change, no signature change, no test edit, no `type: 'toolUse'` literal change.

### D1 — The two "five"s are DIFFERENT SETS. This is the sharpest trap on the ticket.

Site 1's sentence will, after the repair, contain the word "five" twice, counting two different things:

| Phrase | Members | Count |
|---|---|---|
| "the **five render fields**" | `turn_id`, `tool_use_id`, `name`, `input_summary`, **`input`** | 5 — includes the optional map, **excludes** `conversation_id` |
| "(**five strings**, no enum)" | **`conversation_id`**, `turn_id`, `tool_use_id`, `name`, `input_summary` | 5 — includes `conversation_id`, **excludes** `input` (not a string) |

Both are true. Verified against `parseToolUsePayload` (`inboundMessage.ts:974-985`): five `requireString` calls, one `optionalStringMap`. The render-field count is independently confirmed by the two sites #763 already corrected — `events.ts:475` ("the five render fields plus `conversationId`") and `daemonConnection.ts:887` ("the six named fields").

**The failure mode:** a developer or reviewer notices two adjacent fives, concludes one must be a copy-paste error, and "harmonises" them — breaking a clause the AC explicitly requires to survive. **Neither number changes. The sets differ; the coincidence is real.** If the repair can be phrased so the two counts do not sit in the same sentence, prefer that; do not change either number to achieve it.

**Corollary — do not inherit the template's count.** `timelineBridge.ts:104` (#738's `apiRetry` prose, the Site 3 template) reads *"carries `conversationId` (#737) beside the four render fields"*, while the `apiRetry` arm is `{ active, current, total, conversationId }` (`events.ts:203`) and its bridge return is three fields (`:108-113`). That reads as an off-by-one in the template. **Out of scope and pinned** (§ Pinned), but it means the number in the template is not evidence: for `toolUse`, derive **five** from the return literal at `timelineBridge.ts:60-67` and from `daemonConnection.ts:887`, not by analogy.

### D2 — Line-count neutrality, graded per file against a measured anchor census

In-repo comments cite these files by absolute line number, and every citation below an edit block moves with it. I counted them (`src/` + `e2e/` only; `docs/specs/` are historical records, not maintained anchors) and resolved each one to see whether it currently lands where it claims.

| File | Citations below the block | Live | Already drifted | Ruling |
|---|---|---|---|---|
| `inboundMessage.ts:217-220` | 1 (`conversationArchivedBridge.ts:6` → `:1073`) | — | 1 | **Neutral at 4 lines** — and forced anyway (§ Site 1) |
| `threadTimeline.ts:103-104` | 13 — 11 external + 2 in-file relatives | `(:136)` → `\| { type: 'stallDetected' }` **resolves exactly**; the `conversationActivity*` ranges | `(:133)`, `:213` | **Neutral at 2 lines — HARD** |
| `timelineBridge.ts:48-50` | 6 | `conversationActivityBridge.ts:7` → `:96-120` **resolves exactly** (`case 'stallDetected':` … the `compacting` return) | `:161` → lands on `case 'sessionSettingsRejected':`; `:206` → lands mid-comment (×3 citers) | **+1 line permitted, capped at +1** |

**Sites 1 and 2 are neutral and that is a hard requirement.** Both fit — measured in § Site 1 and § Site 2. `threadTimeline.ts`'s `(:136)` is a *point* citation to an arm declaration: off-by-one lands it on a comment line, a new falsehood minted by a ticket whose whole purpose is retiring them.

**Site 3 gets +1, deliberately.** The shipped idiom AC2 mandates does not fit in 3 lines — measured at **358 characters of prose** (§ Site 3) against a 3-line capacity of ~318 including comment prefixes. Fitting it would mean cutting roughly two clauses out of the sentence the AC says to match, and the AC is explicit that review grades a *deviation* from the shipped prose. The downstream cost is bounded and was measured rather than assumed: five of the six citations point at `:161` / `:206`, both **verified already drifted**, so a one-line shift turns a wrong anchor into a differently-wrong one; the sixth is a **25-line range** that degrades to off-by-one (still spanning the stall/apiRetry/compacting cluster) rather than to a wrong target.

**Rejected alternative, recorded so it is not re-litigated:** repairing `conversationActivityBridge.ts:7`'s `:96-120` → `:97-121` would leave zero new inaccuracy, but it adds a fourth file outside the body's scope table, and repairing drifted anchors is the known-deferred backlog #743 § I2 explicitly kept out of scope. Not worth the scope expansion for an off-by-one on a range.

**Do not exceed +1 on Site 3, and do not "tidy" any other line in these files to buy budget.**

### D3 — `replace_all` INVERTS on Site 1, and the collision is a different ticket's true claim

Measured:

```
grep -c "carries the four render fields onward (dropping \`conversation_id\`)" src/main/transport/inboundMessage.ts
→ 1     … and that single hit is line 224 — #767's tool-result claim, NOT Site 1.
```

Site 1's copy of that sentence is **wrapped across `:218-219`** and does not match on one line. So a developer who greps the phrase, sees exactly one clean hit, and runs `replace_all`:

1. edits the **out-of-scope** `tool-result` claim — writing a **falsehood**, since `toolResult` genuinely still drops the id until #766 lands;
2. **misses Site 1 entirely**;
3. scores a plausible-looking single match, with `tsc` and the whole suite green.

This is #743 § I5's inversion in a new file and sharper: there the collision was a *true* neighbour claim; here it is another ticket's *deliverable*. **`replace_all` is banned in all three files.** Edit each block individually with enough surrounding context to make the match unique — for Site 1, anchor on `` `toolCall` timeline item (#202 / #121) ``, which is unique to the `tool-use` paragraph.

### D4 — Drop the stale citation; do not re-pin it

`threadTimeline.ts:103` carries `(events.ts:384-391)`, which no longer points at the `toolUse` arm (now `:498-506`, and it moves again with #755). Since the sentence is being rewritten anyway, **delete the citation rather than re-pinning it**. Writing a fresh absolute `events.ts:<line>` re-enrolls this line in the deferred stale-citation backlog on the next arm. If a reference is wanted, name the type (`` the `toolUse` DaemonEvent ``) or use a bare filename — neither can drift. #738, #743 and #763 all settled it this way; #763's new comments say *"the modelAnnounced arm above"* rather than a line number.

### D5 — Copy the shipped idiom, with one substitution

Three arms (#732 `stallDetected`, #737 `apiRetry`, #742 `compacting`) already ship this prose in **both** renderer files. Match it; a reviewer grades a deviation, not its presence.

**The one substitution:** those three arms return a fresh **literal** (nullary or scalars only), so their prose says *"a filter + fresh **literal** (arm selection)"*. `toolUse` rebuilds a fresh object from six named fields, so the correct phrase for this arm is *"a filter + fresh **copy**"* — which is also what both target comments already say, and what the `toolResult` and `sessionTransition` arms say. Do not inherit "literal".

### Site 1 — `inboundMessage.ts:217-220` (the `tool-use` kind's contract doc)

Paragraph stays **4 lines**. Measured: widths 105 / 103 / 102 / 109; block ceiling 109 (its own max; file max 112); content 419 chars, capacity 436.

**Must no longer claim:** that the consumer carries *four* render fields, or that it *drops* `conversation_id`. **Both halves are false** — the parenthetical went false with #763, and "four" was already off by one from #642's `input`.

**Must claim instead:** the consumer carries the **five render fields plus `conversation_id`** onward. Snake_case here — this is the decode layer, and the neighbouring paragraphs use wire names.

**Must survive:** *"the fail-closed required-string presence here (five strings, no enum) is the boundary this slice defends"* — true, and counting a different set (§ D1). Also the `#217` / `#202 / #121` lead-in and the `name` / `input_summary` opaque-display-text sentence at `:220`.

**Neutrality is automatic here**: the replacement is ~6 characters *shorter* than what it replaces (`"the five render fields plus \`conversation_id\` onward;"` ≈ 52 vs `"the four render fields onward (dropping \`conversation_id\`);"` ≈ 58), and 413 characters cannot wrap into 3 lines at this width. Confirm 4 in, 4 out anyway.

**Must not change:** `:216` / `:221` (the ` *` separators) or `:222-226` (#767's `tool-result` paragraph — see § D3).

### Site 2 — `threadTimeline.ts:103-104` (the `ThreadEvent` tool-call arm)

Block stays **2 lines — hard** (§ D2). Measured: widths 101 / 60; ceiling 106 (the file's sibling prose runs to 111 at `:137`, so 106 is comfortably in-house); content 161 chars, capacity 212, **+51 available**. The template sentence is seven lines down at `:137-138`.

**Must no longer claim:** field-for-field identity with the `toolUse` DaemonEvent, the *"so the bridge stays a filter + fresh copy"* justification **as it is currently grounded**, or the `events.ts:384-391` citation. AC1 calls all three false.

**Must claim instead:** #763 widened that daemon event with a `conversationId` the bridge drops — so the arm is still a filter + fresh copy, now grounded in the drop rather than in identity. The "filter + fresh copy, not a remap" conclusion **survives**; only its stated reason changes.

**Must not change:** `:105` (the `  //` separator), `:106-113` (the #643 `input` paragraph), or `:114-121` (the arm declaration — code).

### Site 3 — `timelineBridge.ts:48-50` (the bridge's tool-call arm)

Block goes **3 → 4 comment lines** (§ D2). Measured: widths 104 / 104 / 103; ceiling 106 (proven by the `apiRetry` sibling at `:105`); 4-line capacity ~424 against ~394 needed (358 chars of prose + 4 × 9-char `      // ` prefixes). **Cap at 4. Do not reach 5.**

**Must no longer claim:** that the `DaemonEvent` and `ThreadEvent` `toolUse` shapes are field-for-field identical.

**Must claim instead:** the DaemonEvent carries `conversationId` (#763) beside the five render fields; the ThreadEvent this returns does not, so **the id STOPS here** — a filter + fresh copy (arm selection), never a pass-through of the DaemonEvent object.

**Must survive:** the `(#217, widened by #643)` lead-in — `#643` is still true, `input` is still on the arm — and `:50`'s *"reduceTimeline folds it into a pending `toolCall` item (result: null) in arrival order (#121)"*. Rewrapping may move these words across line breaks; their content must be preserved.

**Must not change:** `:47` (`case 'toolUse':`), `:51-59` (the #643 `input` paragraph), or `:60-67` (the return literal — code, and the executable proof the id stops here).

## Pinned — do not touch (each verified true at `6aadc97`)

The `field-for-field` grep the developer will run is scoped to the two renderer files, and that is exactly where the collisions are. Every hit below is still true; leave each byte-identical.

| Site | Arm | Why it stays |
|---|---|---|
| `timelineBridge.ts:84` | `sessionTransition` | Drops `newSessionId`; the *render fields* really are identical. |
| `timelineBridge.ts:122` | `unrecognizedMessage` | That arm's DaemonEvent and ThreadEvent really are identical. |
| `threadTimeline.ts:128` | `sessionBoundary` | Identical to the `sessionBoundary` ThreadItem. |
| `threadTimeline.ts:151` | `unrecognizedMessage` | Identical to the `unrecognizedMessage` ThreadItem. |

**#767's `toolResult` twins — still true until #766 lands.** One sits four lines below Site 1 and one sits 19 lines below Site 3: `inboundMessage.ts:224-225`, `timelineBridge.ts:69-70`, `events.ts:507`, `daemonConnection.ts:912`. See § D3 — `inboundMessage.ts:224` is the `replace_all` inversion target.

**Already true, matches a naive grep:**

- `threadTimeline.ts:122` — the `ThreadEvent` `toolResult` member **carries no comment above it** (`:103-104` is Site 2's). Nothing to read true or false; a code line that must not gain the field. (#767's body is the oracle here; #764's own AC3 over-listed it as a claim.)
- `threadTimeline.ts:96` — *"`conversation_id`-free (single active conversation, ADR 0004)"* is scoped to the whole `ThreadEvent` union and stays true: no arm carries the id.
- `threadTimeline.ts:138` — cites *"the `toolUse` / `sessionBoundary` discipline"* as the filter-plus-fresh-copy exemplar. Still true, and this ticket *strengthens* it: `toolUse` becomes an arm that visibly filters a field out, exactly as `apiRetry` does.
- `shared/wire/types.ts:682` (and every other `field-for-field` in that file) — **wire↔daemon** claims, not DaemonEvent↔ThreadEvent. Unaffected. This is #763's sorting rule and it held again here.
- `src/shared/ipc/events.ts` and `src/main/daemonConnection.ts` — #763's, already correct. Do not re-sweep.

**Out of scope, named:** `timelineBridge.ts:104`'s *"beside the four render fields"* for `apiRetry` (§ D1 corollary) — pinned by #743 as #738's prose, and not this arm's claim. **Recommend PO file a follow-up**; do not fix it here.

**No test churn and no e2e work.** #763 swept its own test twins in `52dc0cc` — `timelineBridge.test.ts:72` already reads *"…keeping the render fields, the id stopping here"*. Nothing under `src/**/*.test.ts` still claims this arm drops the id. Both `e2e/` hits on a `drops conversation_id` grep belong to other arms (`send-and-stream.spec.ts:35` = `assistantDelta`, `queued-backlog-interrupt.spec.ts:31` = `turnState`). Stated so the AC4 "no test-name edits" clause does not read as an oversight.

**`docs/knowledge/`** belongs to the documentation phase. Out of scope.

## Verification

The compiler and the suite cannot catch a mistake here — the whole diff is comments. Run all five; none alone is sufficient.

1. **Classify, don't count to zero.** Any gate over these claims counts *down*, so **deleting** the three comments scores a perfect green — and deletes the security claim (§ Security review, finding 1). Read each of the three blocks and confirm it *positively asserts* its replacement claim.

2. **Sweep case-insensitively and multiline.** `threadTimeline.ts`'s occurrences are capital-**F** `Field-for-field`; a case-sensitive sweep of the two store files returns hits only in `timelineBridge.ts` and reads as if `threadTimeline.ts` were uninvolved — it silently loses a whole file. Use `rg -i`. Then classify all 7 hits in the two files against the § Pinned table: 2 repaired, 4 pinned, 1 (`timelineBridge.ts:69`) #767's.

3. **Per-hunk line-count check.**

   ```bash
   git diff -U0 -- src/main/transport/inboundMessage.ts \
     src/renderer/src/store/threadTimeline.ts src/renderer/src/store/timelineBridge.ts
   ```

   Every `@@ -a,b +c,d @@` must have `b == d`, **except** the single `timelineBridge.ts` hunk, which is `d == b + 1` and no more. `--numstat` is not a substitute — it aggregates per file, so a `+1`/`-1` in different blocks cancels there while still shifting every citation between them.

4. **Width scan of the rewritten region** — not the file max, which is set by untouched lines and stays flat while the edit is malformed. Check each block against ceiling **109 / 106 / 106**; file maxima must stay flat at **112 / 111 / 121**. There is no formatter in this repo, so nothing re-wraps what the developer widens.

5. **Comment-only, then the suites.** Every `+`/`-` line in `git diff` begins with `*` or `//` after indentation. `type: 'toolUse'` literal counts unchanged. Then `npm run typecheck` and `npm test` pass unchanged — and **read both halves of typecheck**: it is `&&`-chained, so a node-side failure masks every web-side error. `npm run build` clean.

## Open questions

None. All three offsets, both templates, the twenty in-code line citations and their live/drifted status, the three character budgets, the `replace_all` inversion, the case-sensitivity trap, and both "five" counts were verified against `main` at `6aadc97` while writing this spec.

## Security review

**Verdict:** PASS

**Findings:**

1. **[Trust boundaries] SHOULD FIX — addressed in the design.** `translateTimelineEvent` is where a daemon-asserted `conversationId` **stops** on its way to the renderer's timeline reducer, and Sites 2 and 3 are the written form of that boundary. The adversarial reading: any gate over these claims counts *down*, so the cheapest way to pass is to **delete** the comments — which removes the boundary's documentation and creates the exact condition under which a future reader "simplifies" `timelineBridge.ts:60-67` into a pass-through, carrying the id into the reducer silently. Three requirements close it: Site 3's must-claim list requires the replacement to state that **the id STOPS here**; Site 2 requires the filter-plus-fresh-copy conclusion to survive with a new stated reason rather than be dropped; and § D2's per-hunk line-count check (Verification 3) makes wholesale deletion structurally visible. Verification 1 states outright that a green sweep does not prove the work.

2. **[Trust boundaries] No findings, second aspect.** The boundary stays a single explicit chokepoint: `translateTimelineEvent`, one `switch`, one fresh object per arm. The spec changes no arm and pins `:47`, `:60-67` and the `ThreadEvent` declaration as untouchable code, so the boundary's *enforcement* is byte-identical before and after — only its *description* changes. The executable proof is unchanged and already green: `timelineBridge.test.ts`'s exact `toEqual` expectations fail if the id ever crosses.

3. **[Trust boundaries] SHOULD FIX — addressed in the design.** The cross-ticket falsehood, reachable by an obvious tool call. § D3 is a security finding, not just an editing hazard: the one-line `replace_all` that a developer would naturally reach for rewrites `inboundMessage.ts:224` — #767's `tool-result` claim — into *"carries the five render fields plus `conversation_id`"*, which is **false**, because `toolResult` still drops the id until #766. That would assert across an IPC boundary that a routing key crosses when it does not, in the file a reader consults to learn exactly that. It fails silently: one plausible match, `tsc` green, suite green. Closed by banning `replace_all` in all three files, by the unique anchor given for Site 1, and by § Pinned listing all four `toolResult` twins by file:line. Downgraded from MUST FIX because the design now forecloses it; if the ban is dropped, it returns as MUST FIX.

4. **[Tokens, secrets, credentials] N/A by design decision.** The field at issue is `conversationId`, classified upstream (#763, `events.ts:478-479`) as a daemon-asserted **routing key, not rendered text** — the untrusted-text warnings on `name` / `inputSummary` / `input` do not attach to it. That classification is neither restated nor weakened here. No token, key, or raw frame appears in any of the three blocks, and Site 1's surviving *"five strings, no enum"* clause is the fail-closed decode claim, preserved verbatim by § D1.

5. **[File / storage operations] N/A by design decision.** No path is constructed, read, or written; the change adds zero executable lines (Verification 5).

6. **[Inter-process / Electron attack surface] No findings.** The IPC arm shape is frozen by the comment-only constraint: no `contextBridge` API, no `ipcMain` channel, no `webPreferences` value, and no `DaemonEvent` or `ThreadEvent` union member added or altered. `case 'toolUse':` stays an explicit arm, so it remains a documented decision rather than a fall-through into the `null` group, and the `assertNever` guard is untouched.

7. **[Cryptographic primitives] N/A by design decision.** No RNG, no comparison, no Noise-adjacent code is in the diff's reach; none of the three files holds crypto.

8. **[Network & I/O] N/A by design decision.** No socket, frame cap, timeout, or URL is touched. Decode-side validation for `conversation_id` is fail-closed upstream in `parseToolUsePayload` and out of this ticket's reach — this spec reads that function only to source a count (§ D1).

9. **[Error messages, logs, telemetry] No findings — verified, not assumed.** The one log-shaped sink in these files is `assertNever`'s `JSON.stringify(event)` at `timelineBridge.ts:18`. An arm with an explicit `case` never reaches it, and `case 'toolUse':` returns at `:60-67` before the fall-through group — so the `conversationId`-carrying DaemonEvent is not stringified anywhere in the bridge. The spec adds no log call, and `inboundMessage.ts`'s doc block contains no sink.

10. **[Concurrency] N/A by design decision.** No async task, listener, timer, or `AbortController` is added or removed; there is no executable line in the diff.

11. **[Threat model alignment] OUT OF SCOPE, named.** *Renderer compromise reaching the transport* is unaffected — process placement is unchanged and the repairs strengthen the written boundary. Four adjacent gaps are deliberately deferred and recorded in § Pinned so they are not lost: (a) `timelineBridge.ts:104`'s `apiRetry` field count, recommended to PO as a follow-up; (b) the drifted anchors `timelineBridge.ts:161` / `:206` and `threadTimeline.ts:133` / `:213`, which § D2 prevents this ticket from worsening beyond the capped `+1` but does not repair; (c) the four `toolResult` claims, which go false when #766 lands and are #767's; (d) any restatement of these claims under `docs/knowledge/`, which belongs to the documentation phase.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-25
