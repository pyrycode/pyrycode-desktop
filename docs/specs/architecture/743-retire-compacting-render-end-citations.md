# #743 — Retire the compacting render-end citations

**Size:** S (comment-only; 3 production files + 1 test file, 4 comment blocks, zero executable lines)
**Label:** `security-sensitive` — the document *is* the security claim (the #725 / #733 / #738 precedent)
**Parent:** split from #730; sibling of #742 (`687f961`, merged)

## Design source

N/A — comment-only change, zero executable lines, no rendered surface. Two of the four sites live in `.tsx` files, but neither touches markup, a class name, a token, or a copy constant. The visual-fidelity check is intentionally skipped.

## Baseline — re-measured at `9bcddcc`, NOT the body's `a51bd69`

The ticket body's offsets were taken at `a51bd69`. `main` has since advanced to **`9bcddcc`** (#714's `modelAnnounced` widening merged via PR #745). Every offset was re-verified at `9bcddcc` and **all four still resolve**, because #714 touched none of this ticket's four files:

```
git diff --stat a51bd69..HEAD -- <the four files>   →  empty
```

| Re-verified at `9bcddcc` | Result |
|---|---|
| The AC1 gate | **4** (one per file) |
| `type: 'compacting'` literals repo-wide | **19** |
| `compacting` references under `e2e/` | **0** |
| File max width — `timelineBridge.ts` / `threadTimeline.ts` / `ConversationScreen.tsx` / `ConversationScreen.test.tsx` | **121 / 111 / 203 / 136** |
| Overlapping in-flight `origin/feature/*` branches on these four files | **none** |

**One body claim needs a correction the developer must not trip over.** #714 *did* edit `src/shared/ipc/events.ts` — but only at `@@ -228,13 +228,33 @@`, below the line the body cites. The `"turn-stream item, or daemon state?"` rule at `events.ts:114-115` is unshifted and still reads as the body describes. See § I3 for why the spec still forbids writing that line number into a comment.

## Files to read first

| Path | What to extract |
|---|---|
| `src/renderer/src/store/timelineBridge.ts:21-36` | The file-level doc block — **#738's repaired rule**, at `:28-30`: *"This is a filter, not a rename: an arm may carry fields its `ThreadEvent` deliberately drops, and rebuilding from named fields is what makes each drop explicit and stable as arms widen."* Every Site 1 repair must be consistent with it. The eleven-arm *ownership* enumeration at `:23-25` names `compacting` truthfully — ownership, not field shape. Pinned. |
| `src/renderer/src/store/timelineBridge.ts:102-113` | **The closest repair template.** `:103-107` is #738's `apiRetry` repair: "carries `conversationId` (#737) beside the four render fields; the `ThreadEvent` this returns does not, so **the id STOPS here** — a filter + fresh literal (arm selection), never a pass-through of the DaemonEvent object". Note its tail says *"the translator normalizes nothing"*, **not** "a pure rename" — see Site 1's sub-repair. |
| `src/renderer/src/store/timelineBridge.ts:80-84` | The second template. `sessionTransition` scopes its identity claim to *the render fields* that survive a drop. |
| `src/renderer/src/store/timelineBridge.ts:114-124` | **Site 1** at `:115-119`. `:114` is `case 'compacting':` and `:120` is the return literal — **both code**. `:122-124` is the `unrecognizedMessage` twin: pinned, and the `replace_all` inversion (§ I4). |
| `src/renderer/src/store/threadTimeline.ts:132-151` | **Site 2** at `:144-149`. `:137-142` is #738's `apiRetry` repair — the house phrasing for "#N widened that daemon event with a `conversationId` the bridge drops". `:132-135` is #733's `stallDetected` repair, the same shape. `:141-142` and `:148-149` are the two pinned "no string field" siblings. `:150` is the arm declaration — code. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:112-125` | **Site 3** at `:120-124`. `:113-118` is the `apiRetry` sibling — its AC1 claim is scoped to *the view's prop*, still true, and the shape Site 3's repair should read parallel to. `:125` is `const compacting = …` — code. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1193-1247` | **Site 4** at `:1241-1246`. `:1193-1198` is the `ApiRetryIndicator` sibling block; `:1195` is pinned. `:1247` is `describe(` — code. |
| `src/shared/ipc/events.ts:105-160` and `:228-260` | Ground truth. The `"turn-stream item, or daemon state?"` test is stated at `:114-115` and restated at `:129` and inside #714's `modelAnnounced` block. `compacting`'s widened arm is the fact all four repairs rest on. |
| `docs/specs/architecture/738-retire-apiretry-identical-citations.md` | The direct precedent — same shape, same two store files, shipped first-pass. Its § Pinned already names this ticket as the owner of the `compacting` claims. |
| `docs/specs/architecture/742-compacting-conversation-id.md` | The widening this ticket cleans up after. |

## Context

`#742` (`687f961`) widened the `compacting` `DaemonEvent` arm with `conversationId: string`. The renderer bridge drops the id at `timelineBridge.ts:120` by rebuilding a fresh one-field `ThreadEvent` literal.

Four renderer-side comments still describe the pre-widening world. Two assert **field identity across the bridge**; two assert **the frame has no string field at all** and use that as the stated reason AC1 ("no daemon-supplied string is ever rendered") holds. All four verified false at `9bcddcc`; the AC1 gate returns **4**.

The second pair is why this ticket is not deferrable. **The guarantee survives; its stated reason does not.** AC1 now holds because the bridge filters the id out, not because the frame is string-free — and a comment claiming the frame carries no string field is an invitation to collapse `timelineBridge.ts:120` into a pass-through, which would carry the id into the reducer silently while the comment still read as if that were safe. The filter-plus-fresh-literal discipline *is* the boundary; the comment has to say so.

## Design

Four comment-block repairs. No new module, no new type, no signature change, no test-assertion edit, no `type: 'compacting'` literal change.

### I1 — Classify by what the claim takes as its SUBJECT, not by the presence of a word

`compacting` as the **subject of a field-identity or no-string-field claim about the frame/arm** is false. `compacting` named as a **discipline exemplar** (`timelineBridge.ts:124`) is true. A claim scoped to the **`ThreadEvent`**, the **prop**, or the **copy constant** is true.

These two files name neighbouring arms constantly, and **fourteen such claims stay** — § Pinned. Deleting a name to satisfy a grep replaces a true statement with a false one.

### I2 — Per-block line-count neutrality is a HARD requirement

Not a preference. **Twenty in-repo comments cite these files by line number, and all twenty sit below an edit block:**

| Edit block | Line citations below it | Citing sites |
|---|---|---|
| `timelineBridge.ts:115-119` | **5** | `PairedShell.tsx:37`, `activateConversation.ts:43`, `clearPairingScopedState.ts:53` (→ `:206`); `announcedModelBridge.ts:11`, `announcedModelStore.ts:12` (→ `:161`) |
| `threadTimeline.ts:144-149` | **1** | `ConversationScreen.tsx:1244` (→ `:213`) |
| `ConversationScreen.tsx:120-124` | **14** | `PairingScreen.tsx:132`/`:275`, `ChannelList.tsx:400`, `AssistantMarkdown.tsx:18`/`:26`/`:191`, `BackgroundTaskPanel.tsx:67`, `ConversationScreen.test.tsx:1126`, `toolHeadline.ts:143`, `RunConfigSections.tsx:207`, `conversation.css:716`, `exitActiveConversation.ts:76`, `conversationDeletedBridge.ts:4`, `conversationArchivedBridge.ts:14` |
| `ConversationScreen.test.tsx:1241-1246` | **0** | its only citer (`interactiveRoundtrip.test.tsx:60` → `:396`) points *above* the block |

`ConversationScreen.tsx:120-124` is the sharp one: a 5-line comment block near the top of a 2419-line file with fourteen citations beneath it. A net `+1` there falsifies all fourteen — a comment-only ticket retiring stale references would have minted fourteen fresh ones.

Several anchors have **already drifted** (`timelineBridge.ts:161` now lands on `case 'sessionSettingsRejected':`; `:206` lands mid-comment; `threadTimeline.ts:213` lands mid-bullet). Repairing them is out of scope. I2 exists so this ticket does not make it worse.

**Character budget — measured, per block.** Each block has room; the escape valve when a repair will not fit is a shorter rule statement, **never an extra line**.

| Site | Block | Lines (fixed) | Width ceiling | Content now | Capacity | **Net chars available** |
|---|---|---|---|---|---|---|
| 1 | `timelineBridge.ts:115-119` | 5 | 106 | 424 | 485 | **+61** |
| 2 | `threadTimeline.ts:144-149` | 6 | 111 | 578 | 636 | **+58** |
| 3 | `ConversationScreen.tsx:120-124` | 5 | 109 | 467 | 520 | **+53** ← tightest |
| 4 | `ConversationScreen.test.tsx:1241-1246` | 6 | 107 | 541 | 624 | **+83** |

Each ceiling is the block's own current maximum, and the in-repo sibling block proves it holds the load (e.g. `timelineBridge.ts:103-107` carries 467 chars in the same 5 lines at ≤106).

### I3 — Rewrap to the BLOCK's width, never to the file's

The file maxima (121 / 111 / 203 / 136) are set by lines this ticket does not touch. `ConversationScreen.tsx`'s 203 in particular is 94 characters wider than the block being edited. **Targeting the file max is how #742 left a 22-character orphan line behind (PR #744, NIT).** There is no prettier and no formatter in this repo, so nothing re-wraps what the developer widens.

Use the ceilings in the budget table above. After editing, scan the widths **of the rewritten region**, not just the file max — the file max is set elsewhere and stays flat while the edit itself is malformed.

### I4 — State the rule; never re-point at a neighbour arm; never mint a new `file.ts:NNN`

- **Naming the widening ticket (`#742`) is correct** and is what #733 and #738 both did.
- **Naming a neighbouring arm's current field set is not.** "unlike `modelAnnounced`, which drops it" was already false before this ticket dispatched — #714 merged at `9bcddcc`.
- **Do not write `events.ts:114` into a comment.** Name the rule by its phrase — the **"turn-stream item, or daemon state?" test** — and, if a file reference is wanted, a bare `events.ts`. The phrase occurs at `:114-115`, `:129` and inside #714's `modelAnnounced` block, so it is robustly greppable; a bare file reference cannot drift. This resolves the tension between the body's "the test at `events.ts:114`" and its own Technical Note "prefer stating a rule over citing a `file.ts:NNN` line" — and #738 settled it the same way.

### I5 — `replace_all` is banned in both store files; in `timelineBridge.ts` it INVERTS

The Site 1 target sentence — "The DaemonEvent and the ThreadEvent are field-for-field identical" — is **wrapped** across `:115-116`. The **same sentence sits unwrapped on the single line `:122`** (`unrecognizedMessage`, still true, pinned), and it is the file's only one-line occurrence (`grep -c` = **1**, verified). A `replace_all` on the full sentence therefore edits **only the out-of-scope site and misses yours entirely**, silently, while scoring a plausible-looking single match.

The bare phrase additionally recurs at `:49`, `:69`, `:84`; in `threadTimeline.ts` at `:103`, `:128`, `:144`, `:151`. **Only `:144` is yours.** Edit each block on its own, with enough surrounding context to make the match unique.

### Site 1 — `timelineBridge.ts:115-119` (the `case 'compacting':` block)

Block stays **5 comment lines**. Copy the sentence shape from `:103-107`.

**Must no longer claim:** that the `compacting` DaemonEvent and its ThreadEvent are field-for-field identical.

**Must claim instead:** the DaemonEvent carries `conversationId` (#742) beside the one render field; the `ThreadEvent` this returns does not, so **the id STOPS here** — a filter + fresh literal (arm selection), never a pass-through of the DaemonEvent object.

**Sub-repair, same block, in scope — `:118-119`'s "the translator stays a pure rename".** This contradicts the file-level rule #738 wrote at `:28` (*"This is a filter, not a rename"*), and #738 already made exactly this adjustment on the sibling arm: `:107` reads "the translator normalizes nothing". Bring `:118-119` in line. This is an architect call, deliberate and recorded: it is a live falsehood inside the block being repaired, it costs no line and no file, and leaving it would ship a block that contradicts its own file header two sentences later. It also frees ~28 characters against the budget.

**Must survive:** the `#496:` / `(#495 decodes it, this slice gives it a consumer)` lead-in, and the substance of the both-edges sentence — deciding what `active: false` means is `reduceTimeline`'s job, not the bridge's.

**Must not change:** `:114` (`case 'compacting':`) or `:120` (the return literal). Both are code.

### Site 2 — `threadTimeline.ts:144-149` (the `compacting` arm doc)

Block stays **6 lines**. The house phrasing is seven lines up at `:137-138`, where #738 wrote this repair for `apiRetry`.

**Must no longer claim:** field-for-field identity with the `compacting` DaemonEvent.

**Must claim instead:** #742 widened that daemon event with a `conversationId` the bridge drops.

**Must survive verbatim:** the ``(the `apiRetry` discipline)`` parenthetical. It refers to the filter-plus-fresh-copy discipline, **not** to field identity — #738 has already ruled it must stand, and deleting the name would write a new falsehood. Also the "not a remap" clause.

**Must not change:** `:146-149` — the `active` edge semantics, the BANNER-ONLY sentence, ``(the one delta from `apiRetry`)``, and the "One bool, no string field: AC1 … stays true by construction" claim, which is scoped to the **`ThreadEvent`** and is true. Rewrapping the block may move these words across line breaks; their content must be preserved exactly.

**Must not change:** `:150` (the arm declaration). It is code.

### Site 3 — `ConversationScreen.tsx:120-124` (the compaction scalar read)

Block stays **5 lines**. Tightest budget on the ticket: **+53 net characters**, with fourteen line-citations below it.

**Must no longer claim:** "the compacting frame carries no string field at all".

**Must still assert AC1** — the guarantee survives, only its reason changes. **Must claim instead:** the bridge omits the daemon's `conversationId` (#742) when it rebuilds the `ThreadEvent`, so what the container reads is a plain boolean. Read parallel to the `apiRetry` sibling at `:113-115`, whose AC1 claim is scoped to *the view's prop* and stays true.

**Must survive:** the `#496:` lead-in, the *relative* back-reference "read beside `apiRetry` (the selectApiRetry line above)" — relative, so drift-immune; keep it relative — and the whole re-render-churn sentence (flips at most twice per compaction, same state reference on a verbatim repeated frame, no churn beyond the items delta).

**Must not change:** `:125` (`const compacting = useTimelineStore(selectCompacting)`). It is code.

### Site 4 — `ConversationScreen.test.tsx:1241-1246` (the CompactingIndicator block)

Block stays **6 lines**. Same clause, same repair as Site 3.

**Must no longer claim:** "the compacting frame carries no string field at all".

**Must still assert AC1**, restated with the bridge-filters-the-id reason.

**Must survive:** the "pure (isCompacting in, markup out) over a plain boolean, **NOT the store type**" reasoning — load-bearing and true — and the injected-boolean / server-render sentence explaining why the "showing" assertions live here.

**Must not change:** `:1247` onward. Every assertion in this file is untouched; this ticket edits zero test bodies.

## Pinned — do not touch (verified true at `9bcddcc`)

Ten still-true identity claims, each naming an arm whose `DaemonEvent` genuinely carries no `conversationId`, or already-repaired prose belonging to #733 / #738:

`timelineBridge.ts:48-49` (`toolUse`) · `:69` (`toolResult`) · `:81-84` (`sessionTransition`, scoped claim) · `:103-107` (`apiRetry`, #738's) · `:122-123` (`unrecognizedMessage`)
`threadTimeline.ts:103` (`toolUse`) · `:128` (`sessionBoundary`) · `:132-135` (`stallDetected`, #733's) · `:137-142` (`apiRetry`, #738's) · `:151` (`unrecognizedMessage`)

Plus:

- **`timelineBridge.ts:122-124`** — `unrecognizedMessage`'s "…never a pass-through of the DaemonEvent object — the `compacting` discipline." The referent is the **filter-plus-fresh-literal** discipline, which this ticket *strengthens*: `compacting` becomes an arm that visibly filters a field out, a better exemplar, not a worse one.
- **`timelineBridge.ts:23-25`** — the eleven-arm *ownership* enumeration names `compacting` #496. Ownership, not field shape. True.
- **`threadTimeline.ts:141-142`** — "Two integers and a bool, no string field" — `apiRetry`'s **ThreadEvent**. True.
- **`threadTimeline.ts:148-149`** — "One bool, no string / field" — `compacting`'s **ThreadEvent**, four lines below the Site 2 edit. True. **The ordering trap:** a single-line `grep 'no string field'` on this file returns **`:141` only**, because `:148-149` wraps mid-phrase. One hit is not evidence of one claim.
- **`ConversationScreen.tsx:1272`** ("Takes `ApiRetryStatus | null` — two numbers, NO string field") and **`ConversationScreen.test.tsx:1195`** ("The prop carries two numbers and no string field"). Both scoped to the **prop**. True.
- **`ConversationScreen.tsx:1146` and `:1307`** — the byte-identical "Never a daemon string — the arm carries no string field" sentence above `API_RETRY_COPY` and `COMPACTING_COPY`. **Both stay, together.** See § Security review, finding 3: this is a real, deliberately deferred finding, not a true claim.
- **Every `type: 'compacting'` literal** (all **19**). Code.
- **`e2e/`** — zero `compacting` references. No e2e work.
- **`docs/knowledge/`** — belongs to the documentation phase. Out of scope.

## Verification

The compiler and the test suite cannot catch a mistake here — the whole diff is comments. Run all five; none alone is sufficient.

1. **The AC1 gate.** Run the body's `perl -0777` gate verbatim. Returns **4** before, **0** after.

   **A green gate does not prove the work is done.** It counts to zero, so *deleting* the four comments scores a perfect green — and deleting them deletes the security claim (§ Security review, finding 1). **Classify every hit against the site table; do not count to zero.** Confirm each of the four blocks positively asserts its replacement claim by reading it.

2. **Any sweep beyond the gate must be `-0777`/`-U` AND `-i`.** Sharper than the ticket body states: **`grep -n 'field-for-field identical' src/renderer/src/store/threadTimeline.ts` returns ZERO** — all four occurrences in that file are capital-**F**. A case-sensitive sweep of both store files returns 4 hits, *all in `timelineBridge.ts`*, and reads as if `threadTimeline.ts` has nothing to do with this ticket. It silently loses an entire file, not just one line.

3. **Per-hunk line-count neutrality (I2).**

   ```bash
   git diff -U0 -- src/renderer/src/store/timelineBridge.ts \
     src/renderer/src/store/threadTimeline.ts \
     src/renderer/src/screens/conversation/ConversationScreen.tsx \
     src/renderer/src/screens/conversation/ConversationScreen.test.tsx
   ```

   Every `@@ -a,b +c,d @@` must have `b == d`. **`--numstat` is not a substitute** — it aggregates per file, so a `+1`/`-1` pair in different blocks cancels there while still shifting every citation between them.

4. **Width scan of the rewritten region** (not just the file max, which is set by untouched lines and stays flat while the edit is malformed):

   ```bash
   awk 'NR>=115 && NR<=119 {print NR": "length}' src/renderer/src/store/timelineBridge.ts
   ```

   …and the equivalent for each block, against the ceilings in the budget table (106 / 111 / 109 / 107). File maxima must also stay flat at **121 / 111 / 203 / 136**.

5. **Comment-only, then the suites.** `git diff` shows no added or removed executable line; every `+`/`-` line begins with `//` (after indentation). `type: 'compacting'` literals: **19 before, 19 after**. Then `npm run typecheck` and `npm test` pass unchanged — and **read both halves of typecheck**: it is `&&`-chained, so a node-side failure masks every web-side error.

## Open questions

None. All four offsets, both templates, the twenty downstream citations, the four character budgets, the `replace_all` inversion, the case-sensitivity trap and the gate's 4→0 arithmetic were verified against `main` at `9bcddcc` while writing this spec.

## Security review

**Verdict:** PASS

**Findings:**

1. **[Trust boundaries] SHOULD FIX — addressed in the design.** `timelineBridge.ts` is where a daemon-asserted `conversationId` **stops** on its way to the renderer's timeline reducer, and these four comments are the written form of that boundary. The adversarial reading: AC1's gate **counts to zero**, so the cheapest way to pass it is to *delete* the four comments — which deletes the security claim and leaves the boundary undocumented, the precise condition under which a future reader "simplifies" the bridge into a pass-through and carries the id into the reducer silently. Three spec requirements close this: Site 1's must-claim list requires the replacement to state that **the id STOPS here**; Sites 3 and 4 require AC1 to still be *asserted*, not merely un-contradicted; and I2 (per-block line-count neutrality, checked per hunk in Verification 3) makes wholesale deletion structurally impossible. Verification 1 states outright that a green gate does not prove the work.

2. **[Trust boundaries] No findings, second aspect.** The boundary stays a single explicit chokepoint: `translateTimelineEvent` (`timelineBridge.ts:37`), one `switch`, one fresh literal per arm. The spec changes no arm and pins `:114` and `:120` as untouchable code, so the boundary's *enforcement* is byte-identical before and after; only its *description* changes.

3. **[Trust boundaries] OUT OF SCOPE — named, and a genuine finding, not a true claim.** `ConversationScreen.tsx:1307` reads "Never a daemon string — **the arm carries no string field**, so the plain-text-never-HTML guarantee holds by construction." The `compacting` **IPC arm** now carries `conversationId: string`, so that stated reason is false — as its byte-identical twin at `:1146` has been since #737 widened `apiRetry`. Severity is materially below Sites 3 and 4: both sentences sit above **client-owned module-level copy constants** (`COMPACTING_COPY`, `API_RETRY_COPY`), whose plain-text guarantee holds because they are literals the daemon cannot influence at all — a reason wholly independent of any arm's field set. No daemon data flows through either region. PO ruled the pair out of scope by symmetry (#737 left `:1146` standing through architect, security and code review), and editing one twin without the other would create an asymmetry inside a single file. **Recommend PO file a follow-up taking both sentences together**; this spec pins both so the deferral is recorded rather than lost.

4. **[Tokens, secrets, credentials] N/A by design decision.** The field at issue is `conversationId`, classified at `events.ts:119-124` as a daemon-asserted **routing key, not rendered text** — none of the untrusted-text warnings on `model` / `description` / `raw` attach to it. That classification is upstream (#742) and is neither restated nor weakened here. No token, key, or raw frame appears in any of the four blocks.

5. **[File / storage operations] N/A by design decision.** No path is constructed, read, or written; the change adds zero executable lines (Verification 5).

6. **[Inter-process / Electron attack surface] No findings.** The IPC arm shape is frozen by the comment-only constraint: no `contextBridge` API, no `ipcMain` channel, no `webPreferences` value, and no `DaemonEvent` union member is added or altered. `translateTimelineEvent`'s `case 'compacting':` remains explicit, so the arm stays a documented decision rather than a fall-through into the `null` group.

7. **[Cryptographic primitives] N/A by design decision.** No RNG, no comparison, no Noise-adjacent code is in the diff's reach; the four files hold no crypto.

8. **[Network & I/O] N/A by design decision.** No socket, no frame cap, no timeout, no URL is touched. Decode-side validation for `conversation_id` is fail-closed upstream (#742) and out of this ticket's reach.

9. **[Error messages, logs, telemetry] No findings — verified, not assumed.** The one log-shaped sink in these files is `assertNever`'s `JSON.stringify(event)` at `timelineBridge.ts:18`. An event with an explicit `case` never reaches it, and `case 'compacting':` at `:114` returns at `:120` before the fall-through group — so the `conversationId`-carrying DaemonEvent is not stringified anywhere in the bridge. `emitDaemonEvent` is log-free by construction. The spec adds no log call, and the two `.tsx` sites contain no sink at all.

10. **[Concurrency] N/A by design decision.** No async task, listener, timer, or `AbortController` is added or removed; there is no executable line in the diff.

11. **[Threat model alignment] OUT OF SCOPE, named.** *Renderer compromise reaching the transport* is unaffected — process placement is unchanged and the repairs strengthen the written boundary. Three adjacent gaps are deliberately deferred: (a) the `:1146` / `:1307` twin pair, finding 3 above; (b) the already-drifted line anchors `timelineBridge.ts:161` / `:206` and `threadTimeline.ts:213`, which I2 prevents this ticket from worsening but does not repair; (c) any restatement of these claims under `docs/knowledge/`, which belongs to the documentation phase. All three are recorded in § Pinned.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-25
