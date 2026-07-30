# #510 — A modal answer clicked while disconnected must re-surface after the reconnect

**Size:** XS (PO sized S; overridden down — one production file, one reducer arm, zero new exported
symbols, zero consumer call sites) · **Security-sensitive:** yes · **UI/Figma:** N/A (see Design source)

Reverses shipped #415 AC3, deliberately. Sibling of #415 / #195 / #249 on the same reducer.

## Files to read first

- `src/renderer/src/store/modalPrompts.ts:70-80` — `ModalState` and the `resolved` slice docstring.
  Extract: the docstring's closing claim — *"`modalId`s are one-time nonces (never reused), so a
  retained id is never legitimately re-shown — **retain forever**"* — is the sentence this ticket
  falsifies. `resolved` becomes **per-connection** state. This comment must change with the behaviour.
- `src/renderer/src/store/modalPrompts.ts:126-146` — the `shown` arm. Extract: the `resolved`-first
  early-out at `:130` is the suppression this bug rides. It stays (AC2 needs it) but its comment must
  be re-scoped to "within the current connection".
- `src/renderer/src/store/modalPrompts.ts:147-158` — the `dismissed` arm, including the `:152`
  same-array early-out that deliberately declines to record `resolved` for a never-outstanding id.
  Extract: **this arm does not change.** The rejected alternative shape (below) is the one that would
  have had to touch it, and that is why it was rejected.
- `src/renderer/src/store/modalPrompts.ts:169-176` — the `reconnected` arm. Extract: the `:172-173`
  comment documents today's `resolved`-preservation as *intentional*. That comment is the bug written
  down; it is rewritten here, not merely edited around.
- `src/renderer/src/store/modalPrompts.ts:93-115` — `removeById` / `appendUnique` / `removeRejection`.
  Extract: the house **same-reference-on-no-change** discipline the new arm's guards must mirror.
- `src/renderer/src/store/modalPrompts.test.ts:265-313` — the `#415` describe block. Extract: the three
  tests to update in place (`:271`, `:295`, `:308`) and the two that survive untouched (`:280`, `:290`).
- `src/renderer/src/store/modalPrompts.test.ts:33-39` — the `dismissed()` fixture builder. Extract:
  it **defaults to `source: 'remote'`**. Read this before concluding any existing test is unaffected;
  an AC2 test that means "the user answered locally" must pass `'local'` explicitly.
- `src/renderer/src/store/modalPrompts.test.ts:109-124` — the within-connection no-op test (`:109`) and
  the ghost-dismiss ordering edge (`:119`). Extract: both must still pass **unmodified**. They are the
  regression fence around the chosen shape.
- `src/renderer/src/screens/conversation/PermissionModal.tsx:185-226` — the container. Extract: it reads
  `useModalStore(selectOutstanding)` with `Object.is` equality (`:186`), which is why the new arm must
  not mint a fresh empty `outstanding` array when nothing actually left it; and `pendingOptionId`
  (`:193`) is component-local `useState` the reducer cannot see — see Security review §8.
- `src/renderer/src/screens/conversation/modalResolution.ts:38-47` — `answerPrompt`. Extract: the
  `dispatch` sits **outside** the try (`:46`), and stamps `source: 'local'`. **No change here** — the
  discriminant it already stamps is sufficient.
- `src/main/daemonConnection.ts:1394-1420` — `answerModal`. Extract: the `driver === null` early return
  (the swallow), `mintToken()` minting a **fresh** `answer_token` per send, and `outstandingAnswers.push`
  reached only after a successful build. Read-only context — no change.
- `docs/specs/architecture/415-reconnect-modal-reconcile.md` — the spec whose AC3 this supersedes.

## Design source

N/A — pure reducer; the diff contains zero `.tsx` and zero `.css` lines. Confirmed by reading the
locked dialog family at [node 22-3](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=22-3)
(the shared dark-surface dialog shell — title, body, right-aligned text actions — that
`PermissionModalView` already renders): a re-surfaced prompt reaches the user through that component
entirely unchanged. Matches the precedent set by direct sibling #415 on this same reducer. The
visible effect (a prompt reappearing) is a consequence of store-lifecycle correctness, not a new
visual surface — so the code-review visual-fidelity check is intentionally skipped.

## Context

The client dismisses a prompt optimistically on click and records its `modalId` in `resolved`
(`modalPrompts.ts:156`); a later `shown` for that id is suppressed unconditionally (`:130`). But the
outbound send is fire-and-forget — `answerPrompt` dispatches `dismissed` *outside* the try
(`modalResolution.ts:46`), and main's `answerModal` early-returns when `driver === null`
(`daemonConnection.ts:1397`). So the suppression treats a **local click** as **delivery**.

The daemon re-sends every still-outstanding `modal_shown` after each re-handshake. The client refuses
to re-surface it. The turn stays blocked on an invisible prompt until the daemon's 2-minute
deny-on-timeout window resolves it — the user's explicit **Allow silently becomes a timeout deny**.

**Why retaining `resolved` across a reconnect guards nothing.** #415 AC3 preserved `resolved` across
the reset believing it prevented a double-show. The upstream contract says otherwise, and I verified
it rather than assuming (pyrycode#876/#877, `internal/modalbridge`):

- The connect-time reconcile is sourced from `Registry.Snapshot()` — *"read fresh at reconcile time,
  a resolved-before-open modal is simply absent — no timestamp bookkeeping, no 'how long was the
  client away' special case"* (pyrycode `knowledge/codebase/877.md`). Only **still-outstanding**
  modals are re-sent.
- So the only prompt the daemon can re-send is one it has **not** resolved. Suppressing it client-side
  is never correct; it is exactly this bug.

`resolved` is therefore **per-connection** state, not permanent state. Clearing it at the connection
boundary is the fix, and it is also what the slice always meant.

## Design

One production file: `src/renderer/src/store/modalPrompts.ts`. No new type, no new export, no new
event arm, no bridge change, no consumer cascade (`resolved` has **zero** readers outside the reducer
— verified by grep across `src/`: only `:79`, `:130`, `:156`, `:182` and the test file).

### The change: `resolved` is cleared on the `reconnected` edge

Rewrite the `reconnected` arm (`:169-176`) to clear **both** per-connection slices, each behind its own
no-change guard so the same-reference discipline survives:

```ts
case 'reconnected': {
  // Both `outstanding` and `resolved` are per-CONNECTION truth. Clear each only when non-empty, so a
  // reconnect that changes nothing returns the same state (and an already-empty `outstanding` keeps
  // its reference — PermissionModal selects it under Object.is).
  const outstanding = state.outstanding.length === 0 ? state.outstanding : []
  const resolved = state.resolved.length === 0 ? state.resolved : []
  if (outstanding === state.outstanding && resolved === state.resolved) return state
  return { ...state, outstanding, resolved }
}
```

Behaviour table — the whole contract:

| `outstanding` | `resolved` | result |
|---|---|---|
| empty | empty | **same state reference** (first connect — AC3, unchanged from #415 AC4) |
| empty | non-empty | new state; `outstanding` preserved **by reference**; `resolved` cleared |
| non-empty | either | new state; `outstanding` freshly empty (correct churn); `resolved` cleared |

`rejections` passes through the spread untouched in every row (AC3, #249 — it has no daemon
repopulation path).

**Why the second guard, and why `outstanding` keeps its reference in row 2.** Row 2 is the common case
(a normal answered session, then a drop). `PermissionModal.tsx:186` selects `outstanding` under
zustand's default `Object.is`, so minting a fresh `[]` there would re-render the container for no
state change. The two independent guards mirror `removeById`'s same-reference-on-no-change contract
(`:93-96`) rather than inventing a new discipline.

### Comment corrections — load-bearing, not cosmetic

The prose currently asserts the buggy behaviour as intent. Four sites must change with it; a developer
who edits only the arm leaves the codebase self-contradictory.

1. `:73-79` (`ModalState.resolved` docstring) — drop *"retain forever"*. `resolved` is per-connection:
   it suppresses a duplicate `shown` **within one connection** and is cleared on the `reconnected`
   edge (#510), because the daemon only ever re-sends still-outstanding prompts.
2. `:128-130` (the `shown` arm's early-out) — re-scope "must NOT re-surface" to "within the current
   connection"; name #510 for the cross-connection case.
3. `:169-176` (the `reconnected` arm) — replace the *"Spread preserves `resolved`"* rationale with the
   clear-both rationale above, naming #510 as the deliberate reversal of #415 AC3.
4. `:117-124` (`reduceModal`'s docstring) — *"a re-delivered already-resolved id is a same-reference
   no-op"* is now connection-scoped; qualify it.

Also extend the `reconnected` union-arm doc at `:56-60` (it currently describes clearing `outstanding`
only).

### Rejected alternative — record `resolved` only on a daemon-sourced `dismissed`

Rejected, and the reason is not visible from the reducer alone. On the connected happy path the local
`dismissed` already empties `outstanding`, so the daemon's subsequent remote `dismissed` hits the
`:152` same-array early-out and records **nothing** — AC2's within-connection dedupe would break. The
repair (relax `:152` to record `resolved` for remote/timeout sources on a non-outstanding id) then
collides head-on with the shipped ordering-edge test at `modalPrompts.test.ts:119`, where a
`dismissed('ghost')` must not poison `resolved` against a later legitimate `shown('ghost')` — and the
`dismissed()` fixture defaults to `source: 'remote'`, so that test hits the relaxed path directly.
Two coupled arms, a shipped invariant broken, for the same user-visible outcome. **Do not revisit.**

### Data flow (unchanged path; only the reset's reach widens)

```
link drops → user clicks Allow
  → answerModal: driver === null → send swallowed (unchanged, out of scope)
  → dispatch{dismissed, source:'local'} → resolved += m1        (unchanged)
relay reconnects → handshake completes
  → DaemonEvent{connected} → translateModalEvent → ModalEvent{reconnected}
  → reduceModal → outstanding: [], resolved: []                 ← THE CHANGE
  → daemon reconcileModals unicasts modal_shown(m1)
  → ModalEvent{shown, m1} → resolved no longer contains m1 → APPENDS
  → PermissionModal renders m1 again; user re-clicks Allow → fresh answer_token minted, delivered
```

## State + concurrency model

- **Store:** the existing app-singleton `modalStore`. `reduceModal` remains the only writer. No new
  slice, no new async task, no subscription, no teardown surface.
- **Reset-before-repopulate still holds — same argument as #415, re-verified upstream.** The daemon
  calls `reconcileModals` in `handleNoiseInit`'s success tail *after* `state = V2StateOpen`
  (pyrycode `knowledge/codebase/877.md`), and the desktop emits `DaemonEvent{connected}` at
  handshake-complete before any inbound frame from that session is decoded. Both travel the single
  in-order daemon-event channel; `subscribeModal` translates and dispatches synchronously per event,
  and zustand `setState` completes before the next. So `reconnected` lands before any re-sent `shown`.
  **I found no reordering seam.** Were one to exist, the failure is the pre-#510 behaviour (a
  suppressed prompt), not a new one — the change strictly cannot make ordering worse.
- **Idempotent across repeated drops.** If the user re-answers while *still* disconnected, the send is
  swallowed again and `resolved` re-records — and the next `reconnected` clears it again. The fix
  self-heals across an arbitrary number of drops rather than working exactly once.
- **`outstanding` re-population stays exactly-once** via #195's match-and-replace: after the reset both
  slices are empty, so a re-sent prompt appends once and a duplicate re-send replaces in place.

## Error handling

No I/O, no async, no new failure mode; the arm cannot throw (no lookups, no narrowing beyond the
discriminant). Two behavioural edges worth naming:

- **A `connected` with no subsequent re-sends** → both slices cleared and stay cleared. Correct: by the
  pyrycode#877 contract the daemon re-sends *all* still-outstanding prompts, so absence is
  authoritative. Not this ticket's job to defend a contract-violating daemon.
- **Accepted residual — the re-surfaced prompt inherits the original timeout.** `Snapshot()` *"mints no
  nonce and retires nothing, so it neither re-arms the deny-on-timeout nor changes answerability"*
  (pyrycode #877 spec). A prompt re-surfaced late in its 2-minute window may expire shortly after
  reappearing. That is strictly better than today (zero chance to answer) and re-arming is a daemon-side
  decision, not a client one. State it; do not design around it.

## Testing strategy

vitest at the reducer level — plain function tests on the pure reducer, no React, folded through the
existing `run()` helper. **No new fixture builder is needed.** Bullet scenarios; the developer writes
them in the file's existing idiom.

**Updated in place (AC4) — each keeps its `it(...)` slot and gains a comment naming #510 as the
deliberate reversal of #415 AC3. Not deleted, not skipped.**

- `:271` *"preserves the resolved slice by reference across the reset"* → becomes **clears** it:
  from `[shown('m1'), dismissed('m1')]`, a `reconnected()` leaves `resolved` empty and not the same
  array reference as before.
- `:295` *"same state reference on a reconnect after everything already resolved"* → becomes the
  **row-2** assertion: a new state object is returned (`resolved` was cleared), while `outstanding` is
  preserved **by reference** and `resolved` is empty. This is the one AC3 clause that shifts: the
  no-churn invariant is now "same reference when the reconnect has **nothing to clear**", and this
  case does have something to clear.
- `:308` *"an optimistically-answered prompt stays suppressed if re-sent after the reset"* → becomes
  **re-surfaces**: `[shown('m1'), dismissed('m1', 'allow', 'local'), reconnected(), shown('m1')]`
  leaves exactly one outstanding prompt.

**New (AC1 — answered-then-reconnect-then-reshown, the first required ordering):**

- The re-surfaced prompt carries the **re-delivered** fields, not the stale ones: re-send with an
  overridden title and assert the held prompt shows the new title.
- It **can be answered again**: a following local `dismissed('m1')` clears it and re-records `resolved`,
  proving the prompt is a live, answerable entry and not a display artefact.
- Answered while disconnected with a *sibling still held*: `[shown('m1'), shown('m2'),
  dismissed('m1', 'allow', 'local'), reconnected(), shown('m1'), shown('m2')]` → both outstanding,
  exactly once each.

**New (AC2 — answered-then-dismissed-then-reshown, the second required ordering, no reconnect):**

- `[shown('m1'), dismissed('m1', 'allow', 'local'), dismissed('m1'), shown('m1')]` → `outstanding`
  stays empty and the final `shown` is a **same-reference** no-op. Pass `'local'` explicitly on the
  user's answer; the `dismissed()` fixture defaults to `'remote'`.

**Unchanged, and load-bearing as the regression fence — the developer must confirm these still pass
without edits:**

- `:109` — within-connection re-delivery after resolution is a same-reference no-op.
- `:119` — a ghost `dismissed` does not suppress a later legitimate `shown` (the `dismissed` arm is
  untouched by the chosen shape; this is the proof).
- `:280` — `rejections` preserved by reference across the reset (AC3, #249).
- `:290` — first connect from `initialModalState` returns the same state reference (AC3).
- `:302` — a still-held prompt re-sent after the reset surfaces exactly once (AC3).
- `modalBridge.test.ts` and `daemonConnection.roundtrip.test.ts:802` — the #416 reconnect e2e halves
  drive daemon-sourced events only, with no local dismissal in the sequence, so they are unaffected.
  Run them; do not edit them.

**Purity:** the reset must not mutate the input state's `resolved` array (mirror the existing purity
tests at `:181-206`).

**Gates:** `npm test`, `npm run typecheck`, `npm run build`.

## Open questions

None blocking. The one judgement call — that AC3's *"a reconnect with `outstanding` already empty
returns the same state reference"* now reads as *"…when the reconnect has nothing to clear"* — is
**prescribed above**, not left open: it is forced by AC4's instruction to update `:295` in place, and
the behaviour table pins it.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings — and the boundary is narrower than it looks. `shown` has exactly
  **one** producer in the whole app: `modalBridge.ts:45`, fed by the main-process daemon-event channel
  (verified by grep for `type: 'shown'` across `src/` — every other hit is a test fixture). There is no
  renderer-local `shown` dispatch, so clearing `resolved` cannot re-surface anything the **daemon** did
  not itself re-send inside the authenticated Noise session. The change widens *what the client accepts
  from the daemon*; it does not widen *who can speak to the reducer*.
- **[Tokens]** No findings, and this is the load-bearing one for replay. The re-sent `modal_shown`
  carries **no** `answer_token` (pyrycode#877: *"six fields, no `answer_token`; `modal_id` is the sole
  nonce"*), and `answerModal` mints a **fresh** token per send from a literal that names the three
  modelled fields explicitly, never a spread (`daemonConnection.ts:1405-1409`). A re-answer is therefore
  a new authenticated request, not a replay of the old one. No token is retained, logged, or re-used
  across the reconnect.
- **[Double-apply / decision integrity]** No findings — verified upstream rather than assumed. All
  daemon resolution paths (remote answer #717, remote cancel #727, deny-on-timeout #725, local attach)
  route through **one mutex-guarded one-shot `Resolve`**, which broadcasts and audits **only on `ok`**,
  so a `modal_id` is resolved at most once across goroutines (pyrycode
  `knowledge/features/modalbridge-package.md`; #706 first-answer-wins). So in the narrow race where the
  original answer *did* land just as the link dropped, the daemon may re-send and the user may
  re-answer — and that second answer is an inert `Resolve` miss. **A re-surfaced prompt cannot cause a
  double-apply, and cannot flip an already-recorded decision.**
- **[Renderer / IPC / Electron attack surface]** No findings — AC5 is structural, not aspirational.
  The diff is one pure function in one renderer file. No `contextBridge` API, no `ipcMain` channel, no
  preload export, no new `DaemonEvent` or `RendererCommand` member. The re-answer travels the existing,
  already-reviewed `answerModalCommand` path. Nothing new crosses the renderer boundary in either
  direction.
- **[File / storage]** N/A by construction — `ModalState` is in-memory renderer state with no
  persistence path. Nothing here reaches disk, `localStorage`, or `safeStorage`; a `modalId` is a
  one-time nonce, and clearing `resolved` *reduces* how long one is retained in memory.
- **[Cryptographic primitives]** N/A — no primitive, key, nonce, or comparison is touched. The Noise
  session is unaffected; nonce ordering inside the session is what makes a relay-level replay of an old
  sealed `modal_shown` frame impossible, and that guarantee is inherited, not modified.
- **[Network & I/O]** No findings. The still-disconnected re-answer is swallowed by the same
  `driver === null` guard (`:1397`) and re-recorded in `resolved`, and the next `reconnected` clears it
  again — the fix is idempotent across repeated drops rather than one-shot. Checked the #248 correlation
  window for duplicate entries: in the disconnected case `outstandingAnswers.push` is never reached (the
  early return precedes it), and any phantom entry from the inert-`sendMessage` variant is wiped by
  `dial()`'s reset before the re-answer is sent. No duplicate correlation entry survives the reconnect.
- **[Error messages / logs]** No findings — the reducer emits no log line, and this change adds none.
  No `modalId`, prompt body, or option label reaches a log, an error string, or the renderer console.
- **[Concurrency]** One concrete scenario walked, no finding for this ticket. `PermissionModal`'s
  `pendingOptionId` (`:193`, the #226 second-confirm marker) is component-local `useState` that the
  reducer cannot clear, so a re-surfaced prompt could in principle render **pre-armed in confirm mode**,
  one click from answering. It cannot: both answer paths leave that state null — `onConfirm` calls
  `setPendingOptionId(null)` (`:219`) and the default-option path never sets it — so a prompt in
  `resolved` (the only kind this ticket newly re-surfaces) always re-renders in list mode. The
  pre-existing case (an *unanswered* prompt held at confirm across a reconnect) is unchanged by this
  ticket: such an id was never in `resolved`, so it re-surfaced before this change too. **Not widened.**
  Reset-before-repopulate ordering is covered under State + concurrency model.
- **[Threat model — hostile relay]** No findings; the change strictly *reduces* relay influence. A
  content-blind on-path relay cannot forge `modal_shown` (it is sealed inside the Noise session) but it
  can drop frames and force reconnects. **Today that is a decision-forging primitive:** drop the answer
  frame and the user's explicit Allow silently decays into a timeout deny, with the client actively
  hiding the re-delivery. After this change the same relay achieves only repeated re-prompting —
  annoyance and click-fatigue, with every re-answer still requiring a fresh explicit user action and,
  for any non-default option, the #226 second-confirm gate. Fixing this bug removes the relay's ability
  to silently convert an allow into a deny.
- **[Threat model — out of scope, named]** Making the outbound send report failure to the renderer (an
  ack/error IPC path) so the optimistic dismiss can be withheld entirely — a transport + IPC redesign,
  explicitly deferred by the ticket, not required to fix the observed failure. Also deferred: the
  phantom `outstandingAnswers` entry after an inert `sendMessage` (`daemonConnection.ts:1417`), mitigated
  by `dial()`'s reset as noted above. Neither is regressed by this ticket; both need their own ticket.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-30
