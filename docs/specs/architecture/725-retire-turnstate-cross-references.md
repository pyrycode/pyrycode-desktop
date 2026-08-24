# #725 — Retire the `turnState`-drops-`conversation_id` cross-references

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/725
**Size:** S (held; see § Size check)
**Labels:** `security-sensitive` — the security-review pass at the end of this spec is mandatory and was run.

## Design source

N/A — transport and IPC doc comments; no rendered surface, no Figma node. The visual-fidelity check is intentionally skipped.

## Files to read first

Codegraph is not the tool here and no query was run: it parses code, not comments, and this ticket's entire surface is comment lines. The census below is a `grep` census, taken on this worktree at `66274e7`, and it is reproducible in two commands (§ The census).

- `src/shared/ipc/events.ts:105-200` — the claude-substate arms (`turnState`, `stallDetected`, `apiRetry`, `compacting`, `modelAnnounced`, `backgroundTaskStarted`). Six of the nine `events.ts` edits live here. Read `:111-125` first: that is #724's definitional block for the arm whose precedent is being retired, and it is the reason the other twenty comments are now wrong.
- `src/shared/ipc/events.ts:405-472` — `queueState`, `conversationDeleted`, `workspaceFolderCreated`. The remaining three `events.ts` edits, including both single-field-idiom sites.
- `src/shared/ipc/events.ts:92-95` — the ***sessionTransition*** convention. **Read it so you recognise it and leave it alone.** It is a different convention ("a session id is a routing id, not a secret"), it is reinforced by #724 rather than retired, and it contains no `turnState` token — so the AC1 classification never reaches it.
- `src/main/daemonConnection.ts:605-680` — the inner emit switch: `turn-state` (#724's, already correct), `stall`, `api-retry`, `compacting`, `model-announced`. Four of the six `daemonConnection.ts` edits.
- `src/main/daemonConnection.ts:770-784, 860-872` — `unrecognized-message` and `queue-state`, the other two.
- `src/main/transport/inboundMessage.ts:118-195` — the decoder's kind-by-kind prose block. Both edits here are two-line deletions (§ The four two-line sites).
- `src/main/daemonConnection.test.ts:1520-1524, 1647-1651, 2396-2400` — three byte-identical comment lines, each sitting above a `not.toContain('conv-1')` assertion. **The assertions stay.**
- `src/renderer/src/store/timelineBridge.ts:177` — matches an `unlike turnState` grep and is **out of scope**. Read it once so the false positive does not cost you a turn.
- `docs/specs/architecture/724-turnstate-conversation-id.md` — the sibling that created this cleanup. Its § "The four prose sites" is the precedent for how a prose edit is scoped here.

## Context

#724 widened the `DaemonEvent` `turnState` arm to carry `conversationId`, and rewrote the two comments describing that arm. Twenty other comments across four files cite the `turnState` drop as *precedent* for their own arm. Those arms genuinely still drop `conversation_id` — that half stays true until #714 / #728 / #729 / #730 — but the precedent they appeal to has stopped existing. Three are now outright false; two more cite `turnState` as an example of the *single-field* emit idiom, which it stopped being the moment it gained a second field.

Zero lines of production code change. No code path moves. The test count does not change.

## Size check — the disclosed red line does not actually trip

The ticket body flags, honestly, that this touches four files and asks the architect to rule rather than rationalise. Ruling: **no red line trips, on either of the two counts that exist.**

- *"More than 3 **new** files"* — this creates **zero** new files. Four files are modified. The red line is about new files; it does not apply.
- The pre-commit self-check counts *production source files* (`*.ts` / `*.tsx`, **excluding** `*.test.ts`) and gates at **≥ 5**. This spec prescribes content for **three**: `daemonConnection.ts`, `events.ts`, `inboundMessage.ts`. Three is under five.

The remaining quantitative lines, for completeness: ~20 changed comment lines total (one of them a deletion), 0 new exported types, 0 consumer call sites, 4 acceptance criteria, 0 reject branches. Every one measures at or near zero.

Held at **S**, not lowered to XS: twenty sites each need the surrounding clause read before the cut (AC3), four of them are two-line edits, and the AC1 gate is a 34-hit classification. That is a ~25–35 turn ticket, not a ~10 turn one.

The body's own load-bearing argument is also correct and worth preserving: **a split here would have to be by file, not by concern, and AC1's gate is a repo-wide classification of all 34 hits that does not survive being cut in half.** When the verification mechanism is inherently repo-wide, splitting removes the only thing that makes the ticket checkable.

**File-overlap check:** run against all 14 remote `origin/feature/*` branches. **No branch touches any of the four files.** No `addBlockedBy`.

## The census — and why the four phrase greps are not the gate

Two commands establish the whole surface, and they are worth running first because AC1 is stated in their terms:

```
grep -rn "turnState" src/ | grep -E ':\s*(//|\*|/\*)' | wc -l     # → 34   comment-line hits
grep -rn "turnState" src/ | grep -vE ':\s*(//|\*|/\*)' | grep "//.*turnState"   # → empty
```

The second command is the proof that the first is airtight: 100 total hits, 34 comment-line, 66 code-line, and **no code line carries a trailing `//` comment mentioning `turnState`**, so a leading-marker grep misses nothing.

**34 = 20 in scope + 14 out of scope.** Every hit lands in exactly one bucket. That classification is the gate.

The four phrases named in the ticket body are *not* sufficient, and the arithmetic says so precisely:

| Phrase | Hits | Of which in scope |
|---|---|---|
| `turnState convention` | 8 | 8 |
| `turnState rule` | 3 | 3 |
| `matching turnState` | 3 | 3 |
| `unlike turnState` | 4 | **3** (`timelineBridge.ts:177` is a false positive) |
| **Total** | **18** | **17** |

**The four phrases find 17 of the 20 in-scope sites and include 1 out-of-scope site.** They miss `events.ts:149-150` (the phrase wraps mid-line) and both single-field-idiom sites (`events.ts:445`, `:466`, which use a different form entirely). A pass built on the phrase greps is green while three sites stand.

One further arithmetic note, because it predicts the *editing* hazard rather than the *finding* hazard: `grep "the turnState convention"` — the three-word form — returns **5**, against 8 for the two-word form. The missing three are the sites where `the` sits on the previous line. That is the tell for § The four two-line sites below.

## Design

### The deletion contract

The design is a single rule, and it is what makes AC3 checkable rather than a matter of taste:

> **At each site, delete exactly the substring named in the table below — the cross-reference and the punctuation that joined it to the sentence, and nothing else. Do not re-flow the paragraph. Do not rewrite the surrounding clause.**

Three consequences, all of them wanted:

1. **AC3 holds by construction.** None of the twenty deletion substrings contains any of `token`, `key`, `raw frame`, `untrusted`, `secret`, `fail-closed`, or `never`. An arm's own security claim cannot be weakened by an edit that only removes the listed text. This is the answer to the `security-sensitive` label's stated risk (over-deletion), and it is deterministic rather than a plea for care.
2. **The diff stays minimal and reviewable** — one changed line per site, except at the four sites in § The four two-line sites. No re-flow cascade makes a reviewer diff a whole paragraph to find a four-word removal.
3. **Scope cannot creep.** The rule names what goes; everything else stays.

### Non-goal — do not audit the other names in each list

Several sites name sibling arms alongside `turnState`: `matching turnState / stallDetected / apiRetry`, `unlike turnState / toolUse / apiRetry / compacting`. **Remove `turnState` from the list. Leave every other name.**

Those remaining cross-references are true today. Some of them (`stallDetected`, `apiRetry`, `compacting`) will stop being true when #728 / #729 / #730 land — and each of those tickets rewrites the comment for its own arm, which is where that job belongs. Widening this ticket to pre-emptively strip all sibling cross-references is out of scope and would delete prose those tickets need to edit.

### The twenty sites

Grouped by form. `→` shows the resulting fragment, not the whole comment.

**A. "the turnState convention" — 8 sites**

| Site | Delete exactly | → |
|---|---|---|
| `daemonConnection.ts:623` | `, the turnState convention` | `(never referenced — single active conversation), so zero` |
| `daemonConnection.ts:634` | `, the turnState convention` | `conversation). Deliberately stateless: …` |
| `daemonConnection.ts:650` | `, the turnState convention` | `active conversation). Deliberately stateless: …` |
| `daemonConnection.ts:666-667` | *two-line — see below* | |
| `daemonConnection.ts:778` | `, the turnState convention` | `single active conversation). Deliberately stateless: …` |
| `events.ts:328` | `, the turnState convention` | `conversation). Ships dormant: …` |
| `inboundMessage.ts:131-132` | *two-line — see below* | |
| `inboundMessage.ts:185-186` | *two-line — see below* | |

**B. "matching turnState" — 4 sites**

| Site | Delete exactly | → |
|---|---|---|
| `events.ts:127` | `, matching turnState` | `(single active conversation), so the` |
| `events.ts:137` | `turnState / ` | `matching stallDetected), so what crosses IPC …` |
| `events.ts:150` | `turnState / ` | `stallDetected / apiRetry), so what crosses IPC …` |
| `events.ts:187` | `turnState / ` | `…, matching` / next line `stallDetected / apiRetry / compacting): …` |

`events.ts:149-150` is the phrase-grep blindspot, but note its *edit* is ordinary: the deletion is confined to line 150. Finding it is the hard part; changing it is not.

**C. "unlike turnState … which drop it" — now FALSE — 3 sites**

| Site | Delete exactly | → |
|---|---|---|
| `daemonConnection.ts:865` | `turnState / ` | `— unlike toolUse this KEEPS` |
| `events.ts:197` | `turnState / ` | `— unlike toolUse / apiRetry / compacting, which drop it.` |
| `events.ts:411` | `turnState / ` **plus `drop` → `drops`** | `(unlike toolUse, which drops it) because …` |

**`events.ts:411` is the one site needing an edit beyond deletion.** Removing `turnState` leaves a one-item list, so the plural verb must become singular. `events.ts:197` keeps three items and stays plural; `daemonConnection.ts:865` reads "this KEEPS" and needs no change.

**D. "the turnState rule" — test comments — 3 sites**

`daemonConnection.test.ts:1522`, `:1649`, `:2398`. All three lines are **byte-identical**, including indentation:

```
      // conversation_id is dropped at the choke point (single active conversation, the turnState rule).
```

Delete `, the turnState rule` at each. This is the one place a `replace_all` on `, the turnState rule` scoped to this file is safe: exactly 3 occurrences, all in scope, all identical. (Contrast #724, where a `replace_all` went red.)

**The three `expect(JSON.stringify(events)).not.toContain('conv-1')` assertions on the following lines stay untouched.** Those arms really do still drop the id; #729 / #730 / #714 flip those assertions, and that is their work.

**E. single-field emit idiom — 2 sites**

| Site | Delete exactly | → |
|---|---|---|
| `events.ts:445` | ``turnState carrying `state`, `` | ``single-field emit idiom (sessionSettingsUpdated naming `sessionId`) is a`` |
| `events.ts:466-467` | *two-line — see below* | |

### The four two-line sites

These are where "delete a substring" is insufficient, because the cross-reference itself spans a line break. **The ticket body flags none of them** — it flags `events.ts:149-150`, which is a *grep* hazard with an easy edit. These four are the inverse: easy to find, fiddly to edit. Confine re-wrapping to the two lines the deletion touches; never push words onto a third line.

**1. `daemonConnection.ts:666-667`** — the `;` must survive the cut and move up.

```
before  666  // model. `conversation_id` is DROPPED (never referenced — single active conversation, the
        667  // turnState convention; #588 holds a single value replaced per announcement), so exactly

after   666  // model. `conversation_id` is DROPPED (never referenced — single active conversation;
        667  // #588 holds a single value replaced per announcement), so exactly
```

**2. `inboundMessage.ts:131-132`** — the `(` must not be left dangling; pull `#588` up.

```
before  131   * closing no turn. The consumer carries `model` and `truncated` onward, dropping `conversation_id` (the
        132   * turnState convention — #588 holds a single value replaced per announcement, so nothing keys by

after   131   * closing no turn. The consumer carries `model` and `truncated` onward, dropping `conversation_id` (#588
        132   * holds a single value replaced per announcement, so nothing keys by
```

**3. `inboundMessage.ts:185-186`** — the whole parenthetical goes, and **line 186 is deleted, not left as a bare `*`.** This is the only line removal in the diff.

```
before  185   * consumer carries `site`, `message_type`, `raw` and `truncated` onward, dropping `conversation_id` (the
        186   * turnState convention).

after   185   * consumer carries `site`, `message_type`, `raw` and `truncated` onward, dropping `conversation_id`.
        (186 removed)
```

**4. `events.ts:466-467`** — the exemplar `turnState naming \`state\`` wraps.

```
before  466   // to `path: string` — the single-field emit idiom (conversationDeleted naming `id`, turnState naming
        467   // `state`, sessionSettingsUpdated naming `sessionId`): a fresh literal naming the one field, keeping

after   466   // to `path: string` — the single-field emit idiom (conversationDeleted naming `id`,
        467   // sessionSettingsUpdated naming `sessionId`): a fresh literal naming the one field, keeping
```

Two exemplars survive here, one at `events.ts:445` — both still illustrate the idiom exactly, which is why neither needs re-argued.

### Sibling overlap — the site table is stale by construction

#714 / #728 / #729 / #730 each add `conversationId` to one arm, and each rewrites the comment this ticket edits for that arm. **Twelve of the twenty sites are shared; eight are exclusive to this ticket.**

| Owner | Sites it will rewrite |
|---|---|
| #728 `stallDetected` | `daemonConnection.ts:623` · `events.ts:127` |
| #729 `apiRetry` | `daemonConnection.ts:634` · `events.ts:137` · `daemonConnection.test.ts:1522` |
| #730 `compacting` | `daemonConnection.ts:650` · `events.ts:149-150` · `daemonConnection.test.ts:1649` |
| #714 `modelAnnounced` | `daemonConnection.ts:667` · `events.ts:187` · `inboundMessage.ts:132` · `daemonConnection.test.ts:2398` |
| **this ticket alone (8)** | `daemonConnection.ts:778` · `daemonConnection.ts:865` · `events.ts:197` · `events.ts:328` · `events.ts:411` · `events.ts:445` · `events.ts:466` · `inboundMessage.ts:186` |

**If a site is already gone or rewritten, that means "already handled", not "you mis-grepped."** Do not hunt for it, and do not re-add a cross-reference to an arm that has since started carrying the id. The classification in AC1 is the gate; twenty is a measurement taken at refinement, not a quota.

All three outright-false comments (`daemonConnection.ts:865`, `events.ts:197`, `events.ts:411`) sit in the exclusive eight, so the ticket keeps its independent value under any board order.

### What must NOT be touched

Fourteen `turnState` comment hits are correct as written and must be **byte-identical** afterwards. Thirteen are in the renderer, which gives a deterministic guard: **this ticket touches no file under `src/renderer/`.**

- `src/renderer/src/store/threadTimeline.ts:221, 279, 358` — daemon-provenance, reducer separation, idle-against-live-stall. None about the id.
- `src/renderer/src/store/threadTimeline.test.ts:389, 622, 800-802, 861-862` — stall / `localSendPending` ordering semantics.
- `src/renderer/src/store/timelineBridge.ts:23` — the eleven-timeline-arms inventory.
- `src/renderer/src/store/timelineBridge.ts:86` — `turnState` as the no-cast literal-union precedent. A second field does not disturb it.
- `src/renderer/src/store/timelineBridge.ts:177` — **matches an `unlike turnState` grep, out of scope.** It is about which events are timeline *rows*, not about the id.
- `src/main/daemonConnection.ts:608` — inside #724's definitional block ("never a spread of `inbound.turnState`"). Already correct.

Two more are correct and unreachable by a `turnState` grep, listed so a wider search does not sweep them up:

- `src/shared/ipc/events.ts:92-95` — the ***sessionTransition*** convention ("a session id is a routing id, not a secret"). Reinforced by #724, not retired. **Do not generalise the search to the word "convention."**
- `src/shared/ipc/events.ts:111-124` — #724's definitional comment for the `turnState` arm itself. Already correct. Do not rewrite it again.

## State + concurrency model

N/A. No executable line changes; no store slice, async task, subscription, or teardown path is touched.

## Error handling

N/A — no runtime failure mode is introduced. The one *build-time* failure mode worth naming: an edit inside a `/* … */` block (`inboundMessage.ts`) that damages a delimiter, or a stray edit landing on a code line. `npm run build` catches both, which is why AC4 gates on it.

## Testing strategy

No test is added, changed, or removed. The verification is the AC1 classification plus the two existing gates.

- **Capture the baseline first.** Run `npm test` before editing and note the reported test count. AC4 requires it unchanged, and re-deriving it after the fact is guesswork.
- **`npm run build`** — typecheck plus main/preload/renderer build. Proves no comment delimiter was damaged and no code line was hit.
- **`npm test`** — green, with the count identical to the baseline.
- **`git diff --stat`** — names at most the four files, and **nothing under `src/renderer/`**. Expect **23 changed lines and 1 removed line**: 16 single-line edits, three two-line edits (6 lines), and `inboundMessage.ts:185-186` (1 changed + 1 removed).
- **`git diff -U0`, read in full.** Twenty sites is small enough to read every hunk. Each hunk must be a deletion of listed text (plus the `drops` singular at `events.ts:411`), never a rewritten clause.
- **The AC1 re-classification — the gate closes deterministically.** Every one of the twenty deletions removes the *token* `turnState` from its line. So after the edit, re-running the census:

  ```
  grep -rn "turnState" src/ | grep -E ':\s*(//|\*|/\*)' | wc -l     # → 14, was 34
  ```

  must return **exactly 14**, and those 14 must be precisely the § What must NOT be touched list, byte-identical. Not 33, and not "14 or fewer" — a count above 14 means a site was missed; below 14 means an out-of-scope comment was damaged. If a sibling ticket landed first, the count is still 14: that sibling removed the token from its shared sites too.
- **Negative check for AC2:** `grep -rn "single-field emit idiom" src/` must show no remaining `turnState` exemplar.

## Open questions

None. Every site's text, deletion substring, and resulting fragment is fixed above, verified against this worktree at `66274e7`.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, and the design closes the category by construction. The comments being edited *are* the documentation of the main↔renderer IPC boundary for eleven `DaemonEvent` arms. The stated risk of this ticket is over-deletion — a bulk clause removal taking an arm's own "no token, key, raw frame …" claim with it. The deletion contract (§ The deletion contract) makes that unreachable: **none of the twenty deletion substrings contains any of `token`, `key`, `raw frame`, `untrusted`, `secret`, `fail-closed`, or `never`.** Every security claim sits outside every cut. Spot-checked at the three arms whose claim is most load-bearing — `events.ts:128` (stallDetected, "no payload at all"), `:138` (apiRetry, "no string field on it"), `:150-151` (compacting, same) — the deletion is `turnState / ` or `, matching turnState`, and the claim clause is untouched in all three.
- **[Tokens, secrets, credentials]** No findings. No token, key, or credential handling is described, moved, or re-documented. `events.ts:121`'s assertion that `emitDaemonEvent` is log-free by construction sits inside #724's block at `:111-124`, which is on the do-not-touch list.
- **[File / storage operations]** N/A — no filesystem path, no read, no write, no serialisation is touched.
- **[Inter-process / Electron attack surface]** No findings. The IPC surface itself is unchanged: no arm gains or loses a field, no `contextBridge` API or `ipcMain` channel is added, and no window preference is touched. What changes is the *description* of that surface, covered by the trust-boundaries finding above.
- **[Cryptographic primitives]** N/A — no handshake, RNG, key, nonce, or comparison is in scope.
- **[Network & I/O]** N/A — no socket, frame cap, timeout, TLS setting, or reconnect path is touched.
- **[Error messages, logs, telemetry]** No findings. No log call, error message, or telemetry field is added or altered. The untrusted-text warnings on `model` / `description` / `raw` / `path` / `text` all sit outside every deletion substring and survive verbatim — checked individually at `events.ts:182-185`, `:414-416`, `:457-461`, `:470-472`.
- **[Concurrency]** N/A — no async task, listener, timer, or teardown path is touched.
- **[Threat model alignment]** No findings for this ticket. Named explicitly so it is not mistaken for coverage: the hostile-daemon and renderer-compromise defences documented at these arms are *fail-closed decode* and *fresh-literal emit*, both described in clauses outside the cuts, and both unchanged.
- **[Threat model alignment — OUT OF SCOPE, owners named]** Two future-staleness items this ticket deliberately does not fix:
  1. After the cut, several sites still cross-reference `stallDetected` / `apiRetry` / `compacting` (e.g. `events.ts:137` → "matching stallDetected"). Those are true today and become false when **#728 / #729 / #730** land. Each of those tickets rewrites its own arm's comment; retiring its outgoing cross-references is that ticket's job, and pre-emptively stripping them here would delete prose they need. See § Non-goal.
  2. The claims "an arm with no string field on it" (`events.ts:138`, `:151`) are true today and become false the moment **#729 / #730** add `conversationId` to those arms. Same owners, same reasoning. Flagged here so those tickets' architects inherit the note rather than rediscovering it.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-24
