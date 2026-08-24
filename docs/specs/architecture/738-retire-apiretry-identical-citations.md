# #738 — Retire the borrowed `apiRetry`-is-field-for-field-identical citations

**Size:** S (comment-only; 3 production files, 6 comment blocks, zero executable lines)
**Label:** `security-sensitive` — the document *is* the security claim (the #725 / #733 precedent)
**Parent:** split from #729; sibling of #737 (`c5e9d79`)

## Design source

N/A — comment-only change, zero executable lines, no rendered surface. The visual-fidelity check is intentionally skipped.

## Files to read first

| Path | What to extract |
|---|---|
| `src/renderer/src/store/timelineBridge.ts:21-36` | The file-level doc block. **Site 1** is the sentence spanning `:27-30`. The eleven-arm *ownership* enumeration at `:23-25` is a different enumeration (which arms are owned, not which differ) and stays. |
| `src/renderer/src/store/timelineBridge.ts:80-101` | The two in-repo templates. `:81-84` (`sessionTransition`→`sessionBoundary`) scopes its identity claim to the fields that survive a drop — **the closest fit for Site 2**. `:96-101` is #733's `stallDetected` repair, the same shape one field wider. |
| `src/renderer/src/store/timelineBridge.ts:102-113` | **Site 2.** `:103-107` is the comment to repair; `:108-113` is the four-field return literal — **code, stays byte-identical**. |
| `src/renderer/src/store/threadTimeline.ts:132-143` | **Site 3** at `:137-139`. `:132-135` is #733's `stallDetected` arm comment in this same file — the house phrasing for "#N widened that daemon event to carry `conversationId`, which the bridge drops". `:139-142` stays; `:143` is the arm declaration (code). |
| `src/shared/wire/types.ts:407-452` | **Site 4** — `BackgroundTaskStartedPayload`'s doc block; the false sentence ends at `:419-420`. |
| `src/shared/wire/types.ts:454-469` | **Site 5** — `BackgroundTaskUpdatedPayload`. The claim **wraps**: "dropping it like" ends `:467`, the two arm names sit alone on `:468`. |
| `src/shared/wire/types.ts:579-590` | **Site 6** — `BackgroundTaskRosterPayload`. Same wrap shape as Site 5; lead-in reads "exactly like both siblings". |
| `src/shared/ipc/events.ts:105-160` | Ground truth for every identity claim. The three widened arms: `turnState` (`:125`), `stallDetected` (`:145`), `apiRetry` (`:146-160`) each carry `conversationId`. The rule Sites 4–6 must point at — **the "turn-stream item, or daemon state?" test** — is written at `:114-115` and restated at `:129`, `:225`, `:260`, `:305`. |
| `src/main/daemonConnection.ts:640-660` | The `apiRetry` emit. Confirms the fresh-literal discipline the bonus repair's bare `daemonConnection.ts` reference now points at; that discipline is stated ~20× across the file, so a bare file reference cannot drift the way `:289` did. |
| `docs/specs/architecture/733-retire-stalldetected-nullary-citations.md` | The direct precedent — same shape, same files, shipped first-pass. |
| `docs/specs/architecture/737-apiretry-conversation-id.md` | The widening this ticket cleans up after. |

## Context

Three `DaemonEvent` arms now carry a `conversationId` their `ThreadEvent` counterpart does not: `turnState` (#724), `stallDetected` (#732) and `apiRetry` (#737, merged `c5e9d79`). The renderer bridge drops the id in each case by rebuilding a fresh `ThreadEvent` literal with named fields.

Six comments still describe the pre-#724 world. All six verified false on `main` at `2764b14`; the census gate returns **6** (per-file: `timelineBridge.ts` 2, `threadTimeline.ts` 1, `wire/types.ts` 3), confirmed by running it.

The `timelineBridge.ts:28-30` blanket is the oldest falsehood: `:81-84` (`sessionTransition` dropping `newSessionId`) has contradicted it since **#286**, before any `conversationId` widening. That is the argument for stating a *rule* rather than patching an arm list — an arm list was already wrong two years of tickets before the thing this ticket is cleaning up existed.

## Design

Six comment-block repairs. No new module, no new type, no signature change, no test edit.

### The two invariants that govern every site

**I1 — Classify by what the identity claim takes as its SUBJECT, not by the presence of a word.**
`apiRetry` as the *subject* of an identity claim is false. `apiRetry` named as a *discipline exemplar* ("the `apiRetry` discipline") is true and must survive. These files name neighbouring arms constantly and nine such claims remain true — see § Pinned.

**I2 — Every edited comment block keeps its own line count.**
This is a requirement, not a preference, and the reason is concrete: **four in-repo comments cite these three files by line number, and every one of them sits below an edit site.**

| Citing site | Cites | Sits below |
|---|---|---|
| `BackgroundTaskPanel.tsx:295` | `types.ts:474-477` | Sites 4 and 5 |
| `BackgroundTaskPanel.tsx:50` | `types.ts:479-485` | Sites 4 and 5 |
| `conversationArchivedBridge.ts:6` / `:10` | `types.ts:1132` / `:892` | Sites 4, 5 and 6 |
| `ConversationScreen.tsx:1244` | `threadTimeline.ts:213` | Site 3 |
| `PairedShell.tsx:37`, `activateConversation.ts:43`, `clearPairingScopedState.ts:53` | `timelineBridge.ts:206` | Sites 1 and 2 |
| `announcedModelBridge.ts:11`, `announcedModelStore.ts:12` | `timelineBridge.ts:161` | Sites 1 and 2 |

Ten citations across eight files. A net `+1` anywhere falsifies every citation below it — a comment-only ticket retiring stale references would have created fresh ones, which is exactly what `timelineBridge.ts:28`'s pointer at `daemonConnection.ts:289` is a live example of.

Per-**block** neutrality, not per-file: deltas must not merely cancel across a file, because `types.ts:474-485` sits *between* Site 5 and Site 6.

Two of these anchors (`timelineBridge.ts:161` → the `modelAnnounced` no-op, actually at `:169`; `threadTimeline.ts:213` → `fillResult`, actually elsewhere) have **already drifted**. Repairing them is out of scope. I2 exists so this ticket does not make it worse.

Each block has adequate character budget for the rewrite — verified per site below. If a block genuinely will not fit, shorten the rule statement rather than adding a line.

### Site 1 — `timelineBridge.ts:27-30` (file-level blanket) + the bonus repair

Block `:21-36` stays 16 lines; the rewrite is confined to `:28-30` (~300 characters of budget).

**Must no longer claim:** that the owned arms are field-for-field identical to their `ThreadEvent` counterparts; that there is no field-mapping.

**Must claim instead — the rule, with no arm list:** the bridge is a filter, not a rename; an arm may carry fields its `ThreadEvent` deliberately drops; rebuilding a fresh literal with *named fields* is what makes that dropping explicit and stable.

**Bonus repair, same sentence:** `(\`daemonConnection.ts:289\`)` → a bare `daemonConnection.ts`. `:289` is now inside a `set_session_settings` doc block. A bare file reference cannot drift; the discipline it names is stated ~20× in that file.

**Must survive:** the eleven-arm ownership enumeration at `:23-25`, the "not `return event`, not a spread" clause at `:26-27`, and the whole `assertNever` paragraph at `:32-35`.

### Site 2 — `timelineBridge.ts:103-107` (the `apiRetry` case)

Block stays **5 comment lines**. Copy the sentence shape from `:81-84`.

**Must no longer claim:** that the DaemonEvent and the ThreadEvent are field-for-field identical.

**Must claim instead:** the DaemonEvent carries `conversationId` (#737) beside the four render fields; the `ThreadEvent` this returns does not, so **the id STOPS here** — a filter + fresh literal (arm selection), never a pass-through of the DaemonEvent object.

**Must survive:** the falling-edge sentence — the counter is copied verbatim, discarding it is `reduceTimeline`'s job (it stores `null`), not the bridge's.

**Must not change:** `:108-113`, the four-field return literal. It is code.

### Site 3 — `threadTimeline.ts:137-139` (the `apiRetry` arm doc)

Block `:137-142` stays **6 lines**. The house phrasing is three arms up at `:132-135`, where #733 wrote the same repair for `stallDetected`.

**Must no longer claim:** field-for-field identity with the `apiRetry` DaemonEvent.

**Must claim instead:** #737 widened that daemon event to carry `conversationId`, which the bridge drops.

**Must survive verbatim:** the `(the \`toolUse\` / \`sessionBoundary\` discipline)` parenthetical — both of those arms *are* still identical, so it remains a true and useful pointer — and the "not a remap" clause.

**Must not change:** `:139-142` (the `active` edge semantics and the "Two integers and a bool, no string field" AC1 claim about the **ThreadEvent**, which keeps exactly four fields — still true) or `:143` (the arm declaration; code).

### Sites 4, 5, 6 — `wire/types.ts:419-420`, `:466-468`, `:587-589`

Three sibling doc blocks that repeat the same sentence. The unit that must keep its line count is the enclosing NOT-A-TURN-STREAM-ITEM paragraph: `:416-420` stays **5 lines**, `:465-468` stays **4**, `:587-589` stays **3**.

**Must no longer claim, at any of the three:** that the emitted event keeps `conversation_id` *rather than dropping it like* `api_retry` / `turn_state`. Both names go from all three.

**Must claim instead — the rule, with no neighbour-arm list:** the frame KEEPS `conversation_id` because it is daemon state keyed by id, decided by the **"turn-stream item, or daemon state?" test** (`events.ts`). Name the test; do not enumerate which arms currently fail it.

**Reference the test by name and a bare file, never `events.ts:114`.** The phrase appears five times in `events.ts` (`:114`, `:129`, `:225`, `:260`, `:305`), so it is robustly greppable, and a bare file reference is immune to the drift the bonus repair exists to fix. This resolves the apparent tension between the ticket's "the test written at `events.ts:114`" and its own "prefer stating a rule over citing a `file.ts:NNN`".

**Do not re-point at a sibling arm.** #730 (`compacting`) and #714 (`modelAnnounced`) widen the two arms still dropping the id; "unlike `compacting`, which drops it" goes false in two tickets.

**Must survive at each site:** the NOT-A-TURN-STREAM-ITEM paragraph's substance (no `turn_id`, opens and closes no turn, the #1240 point, the `queue_state` / #720 characterisation at Site 4, "exactly like its sibling" / "exactly like both siblings" at Sites 5 and 6).

**Three edits, not one substitution.** `:468` and `:589` are byte-identical lines (` * \`api_retry\` / \`turn_state\`.`) — a blind `replace_all` hits exactly those two, leaves `:420` standing, and mismatches the lead-ins ("the reason the" at `:419` vs "Hence" at `:466` / `:588`). Edit each block on its own.

## Pinned — do not touch (verified true at `2764b14`)

Nine still-true identity claims, each naming an arm whose `DaemonEvent` genuinely carries no `conversationId` (checked against the union in `src/shared/ipc/events.ts`):

`timelineBridge.ts:48-49` (`toolUse`) · `:69` (`toolResult`) · `:81-84` (`sessionTransition`, scoped claim) · `:114-116` (`compacting`) · `:122` (`unrecognizedMessage`)
`threadTimeline.ts:103` (`toolUse`) · `:128` (`sessionBoundary`) · `:144-146` (`compacting`) · `:151` (`unrecognizedMessage`)

Plus:

- `threadTimeline.ts:144-146` and `:148` name `apiRetry` as a **discipline exemplar** ("the `apiRetry` discipline", "the one delta from `apiRetry`"). Both clauses are true. Deleting the name to satisfy a grep replaces a true statement with a false one — invariant I1.
- `timelineBridge.ts:186-187` — "(apiRetry #492 is now an owned arm … thread chrome, not a timeline row.)" About ownership, not field shape. True.
- `src/shared/wire/types.ts:325-330` — the `ApiRetryPayload` interface. Untouched.
- `ConversationScreen.tsx:1272` — "Takes `ApiRetryStatus | null` — two numbers, NO string field." About the store scalar. True.
- **Every `type: 'apiRetry'` literal** (all 20). Code.
- `docs/knowledge/features/conversation-timeline-store.md:64-65` / `:210-211` and `docs/specs/architecture/566-background-task-roster-decode.md:299` carry the same falsified claims. `docs/knowledge/` belongs to the documentation phase, and three more files would trip the file-count gate. Out of scope; follow-up ticket.

## Verification

The compiler and the test suite cannot catch a mistake here — the whole diff is comments. Run all four checks; none alone is sufficient.

1. **The census gate.** Wrap-tolerant and case-insensitive (`threadTimeline.ts` writes "**F**ield-for-field"; a lowercase pattern scores zero silently). Returns **6** before, **0** after. Use `perl -0777`, not `rg -U` — `rg` is not on PATH in a plain non-login `bash` subshell, `/usr/bin/perl` always is.

   ```bash
   perl -0777 -ne '
     $n = 0;
     $n++ while /dropping it like[^.]{0,140}`(?:api_retry|turn_state)`/gis;
     $n++ while /field-for-field identical to the `apiRetry`/gis;
     $n++ while /owned arms are field-for-field identical/gis;
     $n++ while /case .apiRetry.:.{0,220}?field-for-field identical/gis;
     $total += $n; END { print "$total\n" }
   ' src/renderer/src/store/timelineBridge.ts \
     src/renderer/src/store/threadTimeline.ts src/shared/wire/types.ts
   ```

   **The gate reading 0 does not prove the work is done.** It counts to zero, so *deleting* the six comments scores a perfect green — and deleting them deletes the security claim (§ Security review, finding 1). The site table above is the census; the gate is a cross-check. Confirm each of the six blocks positively asserts its replacement claim by reading it.

2. **Per-hunk line-count neutrality (I2).** Every hunk must add exactly as many lines as it removes:

   ```bash
   git diff -U0 -- src/renderer/src/store/timelineBridge.ts \
     src/renderer/src/store/threadTimeline.ts src/shared/wire/types.ts
   ```

   Check each `@@ -a,b +c,d @@` for `b == d`. `--numstat` is not a substitute: it aggregates per file, and a `+1`/`-1` pair in different blocks cancels there while still shifting `types.ts:474-485`.

3. **Comment-only.** `git diff` shows no added or removed executable line and no altered `type: 'apiRetry'` literal. Every `+`/`-` line begins with `//` or ` *` (after indentation).

4. **`npm run typecheck` and `npm test` pass unchanged.** Run the two typecheck halves and read both — a `&&` hides a failure in the second.

## Open questions

None. Every line number, both templates, the stale `daemonConnection.ts:289` pointer, the ten downstream citations and the gate's 6→0 arithmetic were verified against `main` at `2764b14` while writing this spec.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] SHOULD FIX — addressed in the design.** `timelineBridge.ts` is where a daemon-asserted `conversationId` **stops** on its way to the renderer's timeline reducer, and the comments this ticket repairs are the written form of that boundary. The adversarial reading: AC1's gate **counts to zero**, so the cheapest way to pass it is to *delete* the six comments — which deletes the security claim and leaves the boundary undocumented, the precise condition under which a future reader "simplifies" the bridge into a pass-through and carries the id into the reducer silently. Two spec requirements close this: Site 2's must-claim list requires the replacement to state that **the id STOPS here**, and invariant I2 (per-block line-count neutrality, checked per hunk in Verification 2) makes wholesale deletion structurally impossible. Verification 1 states outright that a green gate does not prove the work.
- **[Trust boundaries] No findings, second aspect.** The boundary stays a single explicit chokepoint: `translateTimelineEvent` (`timelineBridge.ts:37`), one `switch`, one fresh literal per arm. The spec changes no arm and pins `:108-113` as untouchable code, so the boundary's *enforcement* is byte-identical before and after; only its *description* changes.
- **[Tokens, secrets, credentials] N/A by design decision.** The field at issue is `conversationId`, classified at `events.ts:119-124` as a daemon-asserted **routing key, not rendered text** — none of the untrusted-text warnings on `model` / `description` / `raw` attach to it. That classification is upstream (#737) and is not restated or weakened here. No token, key, or raw frame appears in any of the six blocks.
- **[File / storage operations] N/A by design decision.** No path is constructed, read, or written; the change adds zero executable lines (AC3, Verification 3).
- **[Inter-process / Electron attack surface] No findings.** The IPC arm shape is frozen by the comment-only constraint: no `contextBridge` API, no `ipcMain` channel, no `webPreferences` value, and no `DaemonEvent` union member is added or altered. `translateTimelineEvent`'s `case 'apiRetry'` remains explicit, so the arm is a documented decision rather than a fall-through.
- **[Cryptographic primitives] N/A by design decision.** No RNG, no comparison, no Noise-adjacent code is in the diff's reach; the three files hold no crypto.
- **[Network & I/O] N/A by design decision.** No socket, no frame cap, no timeout, no URL is touched. Decode-side validation for `conversation_id` is fail-closed upstream (`events.ts:112-114`, #737) and is out of this ticket's reach.
- **[Error messages, logs, telemetry] No findings — verified, not assumed.** The one log-shaped sink in these files is `assertNever`'s `JSON.stringify(event)` at `timelineBridge.ts:18`. An event with an explicit `case` never reaches it, and `case 'apiRetry':` at `:102` returns before the fall-through group — so the `conversationId`-carrying DaemonEvent is not stringified anywhere in the bridge. `emitDaemonEvent` is log-free by construction (`events.ts:121`). The spec adds no log call.
- **[Concurrency] N/A by design decision.** No async task, listener, timer, or `AbortController` is added or removed; there is no executable line in the diff.
- **[Threat model alignment] OUT OF SCOPE, named.** *Renderer compromise reaching the transport* is unaffected — process placement is unchanged and the repairs strengthen the written boundary. Two adjacent gaps are deliberately deferred: (a) `timelineBridge.ts:114-116` and `threadTimeline.ts:144-146` assert `compacting` identity, true today and **falsified by #730**, which owns the repair; `modelAnnounced` follows in #714. (b) The same falsified `apiRetry` claims live in `docs/knowledge/features/conversation-timeline-store.md:64-65` / `:210-211` and `docs/specs/architecture/566-background-task-roster-decode.md:299`; `docs/knowledge/` belongs to the documentation phase and pulling three more files in would trip the file-count gate. Both are recorded in § Pinned.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-25
