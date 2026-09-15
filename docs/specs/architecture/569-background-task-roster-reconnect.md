# 569 — Show still-running background tasks after a reconnect to a live session

## Files read

- `src/renderer/src/store/backgroundTaskRosterStore.ts` → `createBackgroundTaskRosterStore`, `setRoster`,
  `resetRostersFor`, `clearAllRosters`, `selectRosterFor` — the unconditional replacement write, the
  scoped `connected`-edge drop, and the `null`-vs-present-empty distinction the two silences rest on.
  Its `resetRostersFor` docblock carries the "Nothing repopulates them" paragraph this ticket falsifies,
  and `clearAllRosters`' carries "this family has no re-assertion path of ANY kind".
- `src/renderer/src/store/backgroundTaskRosterBridge.ts` → `subscribeBackgroundTaskRoster`,
  `BackgroundTaskRosterData`, `originOf` — the single listener on which all four write paths dispatch in
  arrival order, and the composition root that resolves the reconnecting server's conversation ids from
  `selectConversationIdsFor` at reset time. Its docblock carries "there is no re-send ordering to reason
  about here".
- `src/renderer/src/clearPairingScopedState.ts` → `ClearPairingScopedStateDeps`, `clearPairingScopedState`
  — two paragraphs cite "#569 owns that gap" as the reason the pairing-boundary clear is owed. Only the
  premise changes; the clear stays.
- `src/renderer/src/store/backgroundTaskRosterStore.test.ts` → the
  `a scoped reset then a new roster repopulates one conversation` case — its assertion is still right
  (a *started* frame is not re-asserted, only the roster is); its framing calls that "#569's gap".
- `src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx` → `BackgroundTaskPanelView` — the
  three-way reading and the two client-owned sentences (`.background-task-panel__unobserved` /
  `.background-task-panel__empty`) the acceptance criteria name verbatim.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ComposerTaskCount`,
  `ComposerErrorSlotControl`, `ThreadOverflowMenuView`, `EmptyThread` — the footer pill
  (`.composer-status__tasks`, gated on `status.type === 'connected'` and last in the slot's priority
  chain), the `More actions` → `Background tasks` route that opens the panel, and the fact that
  `.conversation__thread` mounts only once the timeline holds an item.
- `src/main/daemonConnection.ts` → the `handshake-complete` arm (`emitDaemonEvent(sink, { type:
  'connected', ack })`) and the `message` arm — the same synchronous sink, which is why arrival order
  through the transport is what decides the outcome.
- `src/main/transport/fakeDaemon.ts` → `reconnectResendFrames` — ordered plaintexts re-sealed under the
  new send cipher and streamed right after the reconnect `hello_ack`, which is the burst shape exactly.
- `src/shared/wire/types.ts` → `BackgroundTask`, `BackgroundTaskRosterPayload`, `Envelope` — `event_id`
  is already optional on `Envelope`, so a reconciled frame carrying none decodes unchanged.
- `e2e/banner-reports.spec.ts`, `e2e/permission-modal-answer-paths.spec.ts` → the `frame` /
  `fake` / `rowFor` / `openChat` idioms and the working `reconnectResendFrames` + `dropClientLeg()` drive.
- `e2e/fixtures/launchPairedApp.ts` → `SEEDED_ROW`, the `launchPairedApp` options — including the rule
  that a second row's `name` must share no substring with another's, because Playwright's `hasText` is a
  case-insensitive substring match.
- `docs/knowledge/features/background-task-roster-store.md` → the four claims the documentation stage
  owns; read so the plan's handoff names them precisely and so the code comments and the overview do not
  end up saying different things.

Codegraph was unavailable in this worktree — `.codegraph/` holds `config.json` and a `.gitignore` but no
built index, so `codegraph_context` answered *not initialized*. Everything above was reached by grep and
Read. Noted per the fallback rule rather than silently.

## Design source

**Figma:** N/A — echoed from the ticket. The background-task panel is a desktop-only surface with no
counterpart in the design file; #580 (open) owns designing it. This ticket changes what the panel is
holding after a reconnect and adds no visual element of its own, so the visual-fidelity check is
intentionally skipped.

## Context

The daemon half landed upstream (pyrycode#2077–#2080): on any (re)connection it unicasts one
`background_task_roster` per conversation whose bound session has reported a roster — snapshot-shaped,
match-and-replace on `conversation_id`, safe to re-apply on every connect. Three rules from its
`docs/protocol-mobile.md` § **Reconcile on (re)connect** bind this client:

1. **Two silences, not one.** An *explicit empty* snapshot (`"tasks": []`) means "observed, nothing
   alive". **Absence** from the burst means "nothing has been reported" — never "nothing is alive".
2. **A reconciled frame carries no `event_id`**, deliberately: it is kept out of the replay ring. That is
   not malformedness, and `Envelope.event_id` is already optional, so it decodes today.
3. **Correlate by `conversation_id`, never by position.** The daemon walks its registry in insertion
   order and that order is not a contract.

The desktop side *looks* ready and this ticket is the proof that it is. `setRoster` is unconditional
replacement truth for a conversation's membership, so a connect-time re-send applies idempotently by
construction. `resetRostersFor` already drops the reconnecting server's held rosters on the `connected`
edge. `selectRosterFor` already keeps `null` apart from a present-but-empty entry, and
`BackgroundTaskPanelView` already renders those as two different sentences.

What is **not** proved is that the clear and the re-assertion land in that order through the real
transport. A reconciled roster applied *ahead* of the clear would be wiped by it, and the panel would go
on reading "No background-task report yet" while work was alive — the exact symptom the ticket exists to
rule out. `connected` is emitted from `daemonConnection`'s `handshake-complete` arm and inbound frames
arrive as `message` through the same synchronous sink, so the argument is available by reading; but the
daemon reconciles off its own handshake tail, a different clock, so this gets **proved**.

Hence the shape of the work: **no behaviour change, one new proof, and four stale claims corrected.**

This design warrants no ADR. It records no new decision — it retires the premise of one already recorded
(#1139's) without touching its conclusion.

## Design

**Production code changes: none.** The store, the bridge and the panel already implement every
acceptance criterion; the ticket is the evidence that they compose correctly through the transport, plus
the comment corrections that stop the tree asserting the opposite.

The three edits below are **comment-only**. Each keeps the surrounding decision intact and changes only
the premise that has now moved.

1. `createBackgroundTaskRosterStore`'s docblock, `resetRostersFor` paragraph — replace "Nothing
   repopulates them: these frames are not in the daemon's reconcile-on-connect set … (#569 owns closing
   that gap …)" with what the daemon now does: it re-asserts one roster per conversation whose bound
   session has reported one, correlated by `conversation_id`, and the clear-then-re-assert order is what
   makes the drop safe rather than destructive. State the two silences at the same place, because this is
   the paragraph a reader lands on when asking "what does a reconnect leave behind?".
2. The same docblock's `clearAllRosters` paragraph — "this family has no re-assertion path of ANY kind,
   which makes it strictly worse than the queue's case" is the one sentence in the file that is now flatly
   false. It must become the *narrower* true claim: the daemon re-asserts, but only for the conversations
   of the pairing that reported them, and a new pairing's first `connected` still resolves an empty
   conversation list and drops nothing. **The pairing-boundary clear is still required** and its
   justification is not weakened — only its comparison to the queue's case changes (the roster now has a
   re-assertion path, and like the queue's it does not reach a departed pairing's conversations).
3. `subscribeBackgroundTaskRoster`'s docblock — "Nothing repopulates afterwards … so there is no re-send
   ordering to reason about here" becomes the opposite: there *is* a re-send, this branch resets and
   returns before any of it is dispatched, and the whole ordering guarantee is that all four write paths
   ride one listener in arrival order behind a `connected` that `daemonConnection` emits from the
   handshake tail. Name the e2e that proves it so the next reader does not have to re-derive it.
4. `clearPairingScopedState`'s two "#569 owns that gap" paragraphs — same correction as (2), applied to
   the header's membership argument and to the function docblock's latch argument. Both keep their
   conclusion: `clearAllRosters` stays in the dep set, stays nullary, stays before `clearAllLastRead`.

Everything else the ticket touches is `e2e/` and the one test comment.

## State + concurrency model

Unchanged, and that is the claim under test. For one reconnect episode:

- `daemonConnection` completes the Noise handshake, parses the ack, and emits `{ type: 'connected', ack }`
  on the sink **synchronously**; every subsequent decoded `message` rides the same sink.
- `BackgroundTaskRosterData`'s single listener sees `connected` first, calls
  `resetRostersFor(selectConversationIdsFor(origin)(conversationListStore.getState()))`, and returns.
  The conversation list read happens *at reset time*, so on a reconnect it still holds the previous
  episode's rows and the reconnecting server's conversations are known.
- Each re-asserted roster then arrives as its own `message`, is translated by
  `translateBackgroundTaskRoster`, and lands through `setRoster` — unconditional replacement, keyed by
  `conversation_id`, so burst order is immaterial (rule 3).
- A conversation absent from the burst stays dropped and reads `null` → "No background-task report yet".
  A conversation re-asserted with `tasks: []` becomes a present-but-empty entry → "No background tasks".

No new async work, no new cancellation path, no new subscription. Nothing is added to the timeline
because nothing in this family ever enters the timeline reducer — these frames carry no `turn_id`.

## Error handling

No new failure modes. The two that already exist keep their behaviour:

- A malformed `background_task_roster` fails closed in `parseBackgroundTaskRosterPayload` at the transport
  boundary and never reaches the store. Unchanged.
- A missing `event_id` is **not** a failure: `Envelope.event_id` is optional, so a reconciled frame
  decodes like any other. The e2e's frames deliberately omit it, which is what pins that.

## Testing strategy

**One new Playwright spec, `e2e/background-task-reconnect.spec.ts`, in the fake-transport tier.** It has
to be Playwright and nothing else: the renderer tier runs `environment: 'node'` and renders through
`renderToStaticMarkup`, so it cannot drive a handshake, a socket drop or a click — and the whole subject
here is an *ordering through the real transport*, which no unit fake can observe. No
`needs-real-claude`: a live claude cannot be made to start a background task and lose its connection on
cue, and pyrycode#2080 already proved the daemon half against a real session.

Harness, all of it already built by #416: `launchPairedApp`'s `reconnectResendFrames` (ordered plaintexts
re-sealed under the new send cipher right after the reconnect `hello_ack` — the burst shape exactly) and
the fake relay forwarder's `dropClientLeg()`.

Three conversations, because the criteria need three distinct post-reconnect readings. Their display
names share no substring with one another (Playwright's `hasText` is a case-insensitive substring match —
the trap `SECOND_SEEDED_ROW` documents).

| Conversation | Held before the drop | Re-asserted at connect | Expected reading after |
|---|---|---|---|
| `SEEDED_ROW` | two tasks, stale + live | a roster naming **only** the live one | one row, the live task |
| the empty one | one task | an **explicit empty** roster | `.background-task-panel__empty`, "No background tasks" |
| the silent one | one task | **absent from the burst** | `.background-task-panel__unobserved`, "No background-task report yet" |

Scenarios, one test:

- Seed the list with all three rows, push a roster for each, and pin the pre-disconnect state: the panel
  on `SEEDED_ROW` lists both tasks, and the footer pill reads two tasks running.
- Pin the timeline as empty before the drop — `.conversation__thread` mounts only once an item exists, so
  its absence plus a zero `[data-thread-role]` count is the baseline AC4 compares against.
- `forwarder.dropClientLeg()`, then wait on the footer pill falling to **one** task running. That single
  assertion is the reconnect gate *and* the first evidence for AC1/AC2: the pill is gated on
  `status.type === 'connected'`, so it is hidden while disconnected; and had the clear run *after* the
  re-assertion, the pill would be gone entirely rather than showing one task.
- Open the panel on `SEEDED_ROW`: exactly one row, the live task present, the stale one absent (AC1, AC2).
- Open each of the other two chats in turn and assert the reading **by class and by copy**, and that
  neither shows its pre-disconnect task (AC3). Class-level assertions are what keep the two silences from
  collapsing: the two sentences are substring-independent, but the class is unambiguous.
- Re-assert the empty timeline after the reconnect (AC4).

AC5 is proved by reading, not by the spec: the four sites in § Design no longer claim this family has no
re-assertion path, and none of them still cites #569 as an open gap.

**No new unit test, and one unit comment corrected.** `backgroundTaskRosterStore.test.ts`'s
`a scoped reset then a new roster repopulates one conversation` case already asserts exactly the
post-reconnect behaviour this ticket relies on, and its expectation stays as it is — a *started* frame is
still not re-asserted, only the roster is, so the rebuilt task genuinely reads roster-sourced. Only its
framing ("That is #569's gap, stated honestly") is wrong and gets corrected to say what the daemon now
does and what it still does not.

Verification gate: `npm test -- src/renderer/src/store/backgroundTaskRosterStore.test.ts`, then
`npm run build`, then `npx playwright test e2e/background-task-reconnect.spec.ts`. The full suites are
the verifier's gate.

## Documentation handoff

Owned by the documentation stage, pending — not done in this ticket.

- `docs/knowledge/features/background-task-roster-store.md` claims in four places that no frame in this
  family is in the daemon's reconcile-on-connect set and that closing the gap is #569's subject: in
  **What it does** (the `connected`-edge paragraph), in **How it works → Data flow** (the "NOT
  repopulated" line), in **Edge cases and limitations** (the "No repopulation after a reconnect" bullet),
  and in **Related** (the #581 entry naming #569 open). Fold in what the daemon now re-asserts and the
  two-silences rule, and keep the observable wording — "No background tasks" versus "No background-task
  report yet" — intact.
- Two further doc-stage-owned sites carry the same stale claim and were found while reading, listed so
  they are not missed: `docs/knowledge/features/conversation-shell.md` (the background-task-store
  paragraph naming #569 "blocked on a daemon change") and `docs/knowledge/CATALOG.md` (the entry saying
  neither frame is in the reconcile-on-connect set and the app sends no `last_event_id`).

The frozen per-ticket notes under `docs/knowledge/codebase/` and the prior tickets' committed plans under
`docs/specs/architecture/` are history and are deliberately left alone.

## Open questions

1. **Does the `connected` clear reach the conversations the burst is silent about?** It resolves ids from
   `selectConversationIdsFor(origin)` against the list held at reset time, so it should — but a roster
   held for a conversation no server's list carries is left alone by design (`clearAllRosters` is the only
   thing that collects one). The spec seeds all three rows into the list precisely so the silent
   conversation is in scope; if it turns out not to be, that is a finding, not a test bug. To be resolved
   by running the spec.
2. **Is the footer pill reachable after a reconnect, or does something else occupy the slot?** The slot's
   priority chain is `recovery ?? refusal ?? notice ?? history ?? taskCount`. No turn runs, no usage
   limit arrives, and the fake answers every `request_history`, so `taskCount` should win. If a history
   occupant appears, the reconnect gate moves to a panel assertion with the same timeout and the pill
   assertions are dropped rather than worked around. To be resolved by running the spec.

Each resolution lands in a `## Revisions` entry if it changes the design.

## Security review

**Verdict:** PASS

The subject audited is not "what code does this plan add" — it adds none — but **what this plan
certifies as correct**: that on every (re)connection, untrusted, model-influenced daemon-relayed text
(a task's `description`, which for `taskType: local_bash` **is** the literal command line claude ran, and
its `latestUpdate.patch`) is re-populated into a rendered panel, unsolicited, on a new occasion that did
not previously exist.

**Findings:**

- **[Trust boundaries]** No finding against this plan. The reconciled frame crosses exactly one boundary,
  `parseBackgroundTaskRosterPayload` at the transport edge: it fails closed on a non-record payload and on
  a non-array `tasks`, returns a fresh three-field literal (so server-added keys are tolerated and not
  copied through, which is also what makes it prototype-pollution-safe), and the renderer receives an
  already-typed event. The reconciled frame's **absent `event_id` bypasses nothing**, because no decode
  branch and no store setter consults that field at all — it is optional on `Envelope` and unread on this
  path. Downstream holding is signalled by type: `HeldBackgroundTask`, not the wire row.
- **[Trust boundaries / hostile daemon]** OUT OF SCOPE, named rather than waved past. `setRoster` writes
  under whatever `conversation_id` the frame carries and does **not** check that the conversation belongs
  to the server the frame arrived from, so a hostile daemon could in principle re-assert a roster under
  another server's conversation id and put its own command-line text on a screen the operator attributes
  elsewhere. This is **pre-existing and not widened here**: the live push path has had the identical
  property since #566/#573, this ticket changes no write path, and the tree has already taken a considered
  position on the adjacent question (`clearPairingScopedState`'s docblock reasons that conversation ids are
  daemon-minted UUIDv4 so a later server cannot reuse an earlier one's). What the reconcile does change is
  that connect becomes a new occasion on which it fires. Deliberately **not** filed as a bug ticket: it is
  a standing design position across every conversation-id-keyed store, not an unobserved defect in one, and
  hardening it belongs with the cross-server attribution family (#1139's territory), not inside a proof
  ticket. Noted so a later reader does not mistake this review's silence for absence.
- **[Trust boundaries / the clear side]** No finding — and the asymmetry is worth stating, because it is
  what makes the reconcile safe to accept. `originOf` reads the server only from the **main-bound stamp**,
  never from `event.ack.server_id`, so a hostile or confused daemon cannot steer *whose* rosters the
  reconnect drops. The write side is keyed by a daemon field (above); the destructive side is not.
- **[Tokens, secrets, credentials]** No finding. The plan adds no token handling. The spec inherits
  `launchPairedApp`'s synthetic `DUMMY_TOKEN` and never reads, asserts on, or echoes it; every assertion
  reads DOM text, element counts and class names. No persisted secret is touched.
- **[File / storage]** No finding, plus one self-directed MUST-NOT that the comment edits are held to:
  **nothing in this family is persisted, and the correction must not weaken the argument that it must not
  be.** `clearAllRosters` at the pairing boundary is what keeps a departed pairing's command lines and
  patch text from latching, and web storage would survive that boundary. Only the premise of that
  paragraph changes (the daemon now re-asserts, but only for the conversations of the pairing that
  reported them; a new pairing's first `connected` still resolves an empty conversation list and drops
  nothing), never its conclusion. No path here builds a filesystem path, and no untrusted field reaches one.
- **[Electron / IPC attack surface]** No finding — the plan adds no IPC channel, no `contextBridge`
  member, and no `webPreferences` change. The transport, keys and Noise session stay in the background
  process; the renderer continues to receive already-typed events and no raw frames. The `fakeDaemon` and
  the codec are reached only from `e2e/` and the fixture, never from the production graph.
- **[Cryptographic primitives]** No finding. Nothing is touched, and one property is load-bearing for
  this ticket rather than incidental: the reconnect establishes **new** ciphers and the burst is re-sealed
  under the new send cipher, so there is no `(key, nonce)` reuse across the episode and no reuse of the
  pre-drop session's material.
- **[Network & I/O]** No finding, after checking the flood question specifically. The burst is N frames at
  connect, one per conversation with a reported roster, and a hostile in-session daemon could make N large.
  Each frame is capped (`MAX_PLAINTEXT_BYTES` at the frame boundary, `ws` `maxPayload` at the socket) and
  each roster at 8 rows, so the per-frame bound is unchanged. The unbounded axis is the **number of held
  conversations**, which the store's own docblock already states and already declines to build an eviction
  policy for; the reconcile does not widen it, and on a reconnect the `connected` clear **net reduces**
  held state for the server's listed conversations before anything repopulates. No speculative cap is
  added for a failure nobody has observed.
- **[Errors, logs, telemetry]** No finding, and one constraint the implementation is held to. The store's
  setters and the panel's branches are **silent by design** — a "no roster for conversation X" or "dropped
  an unmatched update" line is precisely where a command line, a patch or a conversation id would leak
  into a file (the content-free diagnostics rule, ADR 0007 / #126). **The comment corrections must add no
  diagnostic**, not even a content-free count. For the spec: every task field it asserts on is a
  **client-owned synthetic literal declared in the spec file**, never a real command line and never
  anything from the pairing plumbing, so a Playwright failure diff printing an expected/actual string
  discloses nothing. That is the decision that makes this category inapplicable, not an accident.
- **[Concurrency]** No finding; the check-then-act shape was examined rather than assumed. The `connected`
  branch reads `conversationListStore.getState()` and writes `backgroundTaskRosterStore` **across no
  `await`**, inside one synchronous dispatch from one listener, so nothing can interleave between resolving
  the id set and dropping those keys. Each reconciled roster then arrives as its own synchronous dispatch
  on that same listener, after the clear's has returned. No new long-lived task, timer, or subscription;
  the spec's teardown is the fixture's.
- **[Threat model — malicious / compromised relay]** No finding, and this is the strongest result of the
  pass. The relay is content-blind but on-path: it can drop, delay, reorder or flood. It **cannot invert
  clear-before-re-assert**, because the burst is sealed under the ciphers the reconnect handshake
  establishes — a reconciled frame reordered ahead of handshake completion does not decrypt at all and
  fails closed at the AEAD. What the relay *can* do is drop a reconciled roster, which degrades that
  conversation to "No background-task report yet": an honest under-report, never a stale over-report. The
  safe failure direction, and exactly the reading AC3 pins.
- **[Threat model — hostile daemon response]** No finding. Every field is parsed defensively at the
  boundary, and the two look-alike shapes stay distinguished: `tasks: null` fails the frame closed while a
  row's `truncated_fields: null` is a valid value meaning "nothing was cut". A reconciled frame's missing
  `event_id` is valid and read by nothing.
- **[Threat model — untrusted text reaching a sink]** No finding. Re-population routes the same
  `description` and `patch` through the same `BackgroundTaskPanelView`, which renders both as
  auto-escaped React children and nothing else — never `dangerouslySetInnerHTML`, never into an attribute
  (not even `title=`), never a URL, never a React key, never parsed, never re-shelled. This ticket adds
  **occasions**, not sinks: no new render path, no new derivation from `entry.tasks`, and the rows stay
  non-interactive.
- **[Threat model — token theft from disk / renderer compromise]** Not on this path. Nothing here reaches
  disk and nothing here gains renderer access to keys, the token, or the socket.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-15

## Revisions

### 2026-09-15 — the AC4 baseline, and two more stale sites than the ticket named

**`.conversation__thread` is present at zero timeline items; the plan said it was absent.** § Testing
strategy planned AC4's baseline as "`.conversation__thread` mounts only once an item exists, so its
absence plus a zero `[data-thread-role]` count is the baseline". That is what
`useThreadScrollPin`'s docblock states, and it is not what the DOM does — the first run of the spec found
one `.conversation__thread` on an empty thread, with `.conversation__empty` visible inside it. The
assertion is now the honest form and a better one regardless: the container's CHILD COUNT is captured
before the drop and compared against itself afterwards, beside a zero bubble count so the baseline cannot
already be nonzero and hide a later addition. No production behaviour is involved; only the spec's
reading of the empty state changed.

**Three sites beyond the four the ticket named carry the same stale claim, and AC5 reaches them.** The
ticket's Technical Notes list four; AC5 is broader ("no claim survives in the tree that this family has no
re-assertion path"). Grepping the premise rather than the ticket number found three more, all corrected
with their conclusions and assertions untouched:

- `clearPairingScopedState`'s **#1145 activity paragraph**, which files the activity store's re-assertion
  story as "the roster's rather than the queue's". The claim about the activity family is still true; the
  comparison is not, since the roster now behaves like the queue.
- `clearPairingScopedState.test.ts`'s **throw-ordering case**, asserting the roster clear has "no
  re-assertion path of any kind to overwrite them".
- `clearPairingScopedState.test.ts`'s **pairing-boundary roster case**, asserting "NOTHING re-asserts a
  roster … and this app sends no `last_event_id`".

### Open questions, resolved

1. **Does the `connected` clear reach the conversations the burst is silent about?** Yes. The silent
   conversation held a task before the drop and reads "No background-task report yet" afterwards, which is
   only reachable through the clear. That assertion turned out to be load-bearing twice over: it is AC3's
   second silence *and* the half of the ordering proof that shows the clear ran at all.
2. **Is the footer pill reachable after a reconnect?** Yes — no history occupant appears, because the
   spec's fake answers every `request_history` with an empty page. The pill is kept as the reconnect gate.

**Falsifiability check, run rather than argued.** A proof ticket whose spec passes on the first run has
proved nothing until the spec is shown to be capable of failing. Removing the re-asserted roster from the
burst and re-running made it fail at the pill assertion (`Expected "1 task running"`, 20.6s) — which is
exactly the ticket's feared failure mode, a re-assertion eaten by the clear. The burst restored, it passes.

### 2026-09-15 (rework leg 1) — four more sites, and why the first sweep stopped short

**The verifier's FAIL was correct and its count was exact: four claims survived, two of them inside
docblocks this PR had itself edited.** All four are now corrected, each keeping its conclusion and moving
only its premise — the same edit shape applied nine times in the first leg, bringing the set to thirteen:

- `clearPairingScopedState`'s **#1320 usage-limit paragraph**, which latched "for the ROSTER's reason — a
  re-assertion does not exist at all". #1320's own reason is untouched by this ticket and survives
  verbatim; only the borrowed attribution moved, since that is no longer the roster's reason. The
  #1420 paragraph below still borrows from #1320 rather than from the roster, so the chain needed no
  further edit — checked rather than assumed.
- `clearPairingScopedState`'s header **#1140 `modalStore` paragraph**, which read "so **unlike the roster**
  this store has a repopulation path". Post-reconcile the two stories are the same one told twice, so the
  comparison did not merely go stale, it inverted.
- `PairedShell`'s `clearPairingDeps` → the `clearAllRosters` entry ("this family re-asserts nothing at
  all"), rewritten to the shape its `dispatchModal` sibling eleven lines below already carried.
- `backgroundTaskRosterStore.test.ts`'s `clearAllRosters (pairing-boundary drop, #1139)` describe header.
  The other occurrence in that same file was corrected in the first leg; this one was missed.

**The lesson is about the shape of the search, not its diligence.** The first leg already knew to grep the
premise rather than `#569`, and said so in the entry above — that is why it found three sites past the
ticket's four. What it still did was anchor on the *subject*: phrasings that name the roster. Three of
these four never name it as a subject at all. Two state the claim while talking about a **different
store**, where the roster appears only as the compared-against term ("unlike the roster", "the ROSTER's
reason"), and one states it as a bare predicate about "this family" in a composition-root comment whose
surrounding lines are about `clearPairingDeps`. A claim about family X routinely lives inside a paragraph
about family Y, so the grep has to be for the **predicate** — "no re-assertion", "re-asserts nothing",
"unlike the roster" — and every hit has to be read with its whole paragraph, because the matched line is
frequently not the line that carries the falsehood. Subject-anchored greps cannot find a claim that is
made in passing about something else.

**Verification for this leg:** `npx vitest run` on the three touched unit files (87 passed),
`npm run build`, and a mechanical re-check that all four hunks are comment-only (`git diff -U0 -- src/`
filtered to non-comment changed lines returns nothing). The e2e spec is untouched by this leg.
