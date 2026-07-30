# Spec #538 — give the timeline reducer a `reconnected` arm

**Ticket:** [#538](https://github.com/pyrycode/pyrycode-desktop/issues/538) · **Size:** XS · Split from #509 (sibling: #539)

## Files to read first

Codegraph is not initialized for this repo (`codegraph init` never run — `codegraph_context` errors out), so this list is hand-built from grep + reads rather than lifted from a `codegraph_context` result. Verified at `51c3861`.

| Path | What to extract |
|---|---|
| `src/renderer/src/store/threadTimeline.ts:90-138` | The `ThreadEvent` union. Note the per-arm doc-comment density and that `reset` (`:133-138`) is the last member — the new arm appends after it. |
| `src/renderer/src/store/threadTimeline.ts:155-172` | `TimelineState` — the five fields. `items` is Mode A content; `phase` / `stalled` / `apiRetry` / `compacting` are the Mode B chrome this arm reconciles. |
| `src/renderer/src/store/threadTimeline.ts:230-448` | `reduceTimeline`. **Every arm writes all five fields as an explicit literal** — there is no spread idiom in this file. Match that; see § "Why a hand-written literal". |
| `src/renderer/src/store/threadTimeline.ts:271-273, 288-290` | The two deliberately un-widened guards. They are the reason nothing but a falling edge clears `apiRetry` / `compacting` today — i.e. the bug. **Do not touch them.** |
| `src/renderer/src/store/threadTimeline.ts:435-444` | The `reset` arm (#528). Read the rationale for returning the shared constant, then note why it is *not* reusable here (it clears `items`). |
| `src/renderer/src/store/modalPrompts.ts:169-176` | **The shape to copy.** #415's `reconnected` arm: clear the reconcilable slice, preserve everything else, early-out to the same reference when there is nothing to clear. |
| `src/renderer/src/store/modalBridge.ts:61-65` | **The bridge shape to copy.** The payload-free `connected` → `reconnected` flip, placed immediately after the last owned arm and before the null cluster. |
| `src/renderer/src/store/timelineBridge.ts:23-35` | The translator's doc comment — the arm count ("ten") is falsified by this change. |
| `src/renderer/src/store/timelineBridge.ts:125-172` | The null fall-through cluster. `connected` (`:126`) leaves it; the comment block at `:151-171` carries a parenthetical per promoted arm (`:161`, `:168`, `:170`) — follow that convention. |
| `src/renderer/src/store/timelineBridge.test.ts:15, 219-288` | The `ack` fixture and the null-cluster pin. **`ack` is referenced at `:223` and nowhere else** — see § "Footgun". |
| `src/renderer/src/store/modalBridge.test.ts:82-88, 91-95` | How #415 updated *its* null-cluster pin: a positive test above, a placeholder comment in the array where the arm used to sit. AC4 asks for the same edit. |
| `src/renderer/src/store/threadTimeline.test.ts:615-668` | The `reset` describe block — the `dirty()` helper (note the ordering comment: the stall goes last) and the precondition-assertion style. The new block mirrors it. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:102-120` | The four consumers of the reconciled scalars. Read-only — no edit here. |
| `pyrycode` repo, `docs/protocol-mobile.md` § Reconnect / Backfill | Mode A vs Mode B. The written contract this arm implements; quoted in Context below. |

## Design source

N/A — carried forward from the ticket body. The mobile Figma file (`g2HIq2UyPhslEoHRokQmHG`) draws only the populated steady-state Conversation Thread (node `16-8`); every transient thread-chrome overlay has shipped N/A-justified on this project (#215, #277, #279, #305, #317, #493, #496). This slice changes *when* those overlays disappear, not how any of them looks — no new pixels. The visual-fidelity check is intentionally skipped.

## Context

`TimelineState` holds one Mode A field (`items`, the transcript) and four Mode B chrome scalars. Two of the four — `apiRetry` and `compacting` — are cleared **only** by an explicit wire falling edge (`threadTimeline.ts:390-402` and `:426-434`), and turn activity deliberately carries them through (the two un-widened guards at `:271-273` and `:288-290`). Lose the falling edge to a disconnect and the banner sticks until the app restarts. `phase` and `stalled` self-heal on the next turn; the two banners never do.

Nothing recovers the lost frame. The relay does not resume sessions in v2, and the desktop advertises no replay cursor: `HelloClientPayload.last_seen_ts` exists (`src/shared/wire/types.ts:122`, plumbed through to `buildClientHello`) but the production dial never populates it (`daemonConnection.ts:922`), and the `last_event_id` ring-replay cursor is absent from the desktop wire type entirely.

`timelineBridge.ts:126` currently maps `connected` into the null fall-through cluster, so the reducer never observes the reconnect edge at all.

**This is the written wire contract, not a local workaround.** `docs/protocol-mobile.md` § Reconnect / Backfill splits reconnect on data type: Mode A (bulk transcript) reconnects by cursor backfill; Mode B (control state) reconnects by current-state snapshot, with the client's obligation stated directly — *"each reconnect is a fresh Noise_IK handshake, so the client resets its control state and rebuilds it from whatever the daemon re-asserts."* The chrome scalars are Mode B state the desktop never resets. The two modes are complements applied on the same connect, which is exactly why `items` must survive: the transcript is Mode A, reconciled by cursor, and clearing it here would break the other half of the contract.

`modalStore` got this treatment in #415 and `queueStore` in #197. This slice gives the timeline the same reconcile.

## Design

Two production files. No new files, no new exported types, no new modules.

### 1. `threadTimeline.ts` — a new `ThreadEvent` arm

Append after `reset` (`:138`):

```ts
| { type: 'reconnected' }
```

Nullary, following `stallDetected` and `reset`. Document it as the **second** non-content arm, and distinguish it from `reset` in the comment: `reset` is renderer-lifecycle and `timelineBridge` never produces it; `reconnected` is *connection*-lifecycle — bridge-produced from a wire edge, but carrying no daemon content. `reset`'s own doc comment (`:133-138`) stays accurate as written and needs **no edit**.

### 2. `threadTimeline.ts` — the reducer arm

Add a `case 'reconnected'` after `case 'reset'`, so the two whole-state control arms sit adjacent and the contrast (full wipe vs chrome-only) reads in one screen. Contract:

- **Clears** `phase` → `'idle'`, `stalled` → `false`, `apiRetry` → `null`, `compacting` → `false`.
- **Preserves** `items` **by reference** — `items: state.items`, never a fresh array, never a spread of the array.
- **Early-out** to the same `state` reference when all four are already clean (`phase === 'idle' && !stalled && apiRetry === null && !compacting`), so a first connect or a reconnect with nothing live churns no subscriber.

The four-scalar early-out predicate is the only thing here TypeScript cannot force to stay in sync — a sixth chrome field added later would need adding to it by hand. Say so in an inline comment; do not build a mechanism for it (see below).

#### Why a hand-written literal, not `{ ...initialTimelineState, items: state.items }`

The spread reads cleaner and would clear a future sixth field for free — but that is the wrong default. A sixth field could be Mode A durable content (wrongly wiped) just as easily as Mode B chrome (rightly cleared). The explicit five-field literal makes a sixth field a **compile error in this arm**, forcing whoever adds it to classify it. That is also the file's existing idiom: every one of the twelve arms writes all five fields out. `reset` returning the shared constant is the deliberate exception, and its comment explains why — it clears everything, so "for free" is unambiguously correct there. It is not correct here.

#### Accepted residual — do not engineer around it

The daemon's connect-time re-assertion set is the outstanding modal (#877) and the queued backlog (#878) **only**. There is no connect-time re-assertion of `api_retry` or `compacting`. So a retry or compaction still genuinely live across the reconnect shows no banner until the daemon emits its next edge — for a retry, the next attempt's rising edge as the counter climbs; for a compaction, possibly only the closing falling edge, which lands as a same-reference no-op. That trades a briefly-missing banner for a permanently-stuck one, which is the right trade. The same reasoning covers `phase`: a live turn shows no thinking indicator until the next `turn_state` frame, which the daemon emits frequently within a turn.

**Consequence for AC5's wording.** AC5 must be read as *"a rising edge arriving after the `reconnected` sets the status again"* — the clear must not latch. It is **not** *"the daemon re-asserts the status on reconnect"*; nothing in the contract promises that, and a test written against that reading would be unimplementable.

### 3. `timelineBridge.ts` — own the `connected` arm

- Remove `case 'connected':` from the null cluster at `:126` (leaving `connecting` and `disconnected` adjacent).
- Add an owned `case 'connected':` immediately after the last owned arm (`unrecognizedMessage`, ending `:124`) and before the cluster opens at `case 'connecting':` — the `modalBridge.ts:61` placement, exactly.
- Return `{ type: 'reconnected' }`. A fresh nullary literal; `event.ack` (`HelloAckPayload`) is ignored — this arm needs no field off it.
- Update the doc comment at `:23-26`: "ten timeline arms" → eleven, naming `connected`→`reconnected` #538.
- Add a parenthetical to the null-cluster comment block noting `connected` is now owned — the convention this exact file already uses for every promoted arm (`:161` stallDetected, `:168` apiRetry, `:170` compacting).

Do **not** touch `daemonEventBridge.ts:31` or `sessionStore.ts:113`. They are independent consumers of the same `connected` edge; this slice adds a third, it does not centralise them. Nothing else changes: `timelineStore.ts` is a thin zustand wrapper over the reducer and needs no edit for a new arm.

### State + concurrency model

No new state, no new async surface, no new subscription. The arm is a pure function of `(TimelineState, ThreadEvent)`; the bridge is an existing subscriber on an existing channel. Ordering is arrival order per ADR 0004. Teardown is unchanged — `useTimelineBridge`'s effect cleanup already nets one live listener under StrictMode.

### Error handling

No new failure modes. The arm is total (nullary event, no parse, no I/O) and the bridge is a pure translator. A `DaemonEvent` arm added later without a mapping remains a compile error via the existing `assertNever` guards in both files.

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. Two test files, no new ones. Scenarios as bullets — write them in the file's existing idiom.

### `threadTimeline.test.ts` — a new `reduceTimeline — reconnected` describe

Add a `reconnected()` event helper beside `reset()` (`:54-56`). Reuse the `reset` block's `dirty()` helper shape — including its ordering constraint (**dispatch the stall last**; a `turnState` is turn activity and would clear it).

- **Clears all four chrome scalars from a fully dirty state (AC1).** Assert the preconditions first (the `reset` block's style — otherwise the test proves nothing), then assert `phase === 'idle'`, `stalled === false`, `apiRetry === null`, `compacting === false`.
- **`items` survives by reference (AC2).** From a dirty state with a non-empty transcript: `next.items` **`toBe`** `state.items`, and `toEqual` the same contents. `toBe` is the load-bearing assertion — `toEqual` alone would pass on a fresh copy and let a `selectItems` re-render regression through.
- **Same state reference against already-clean chrome (AC3).** `reduceTimeline(initialTimelineState, reconnected())` `toBe` `initialTimelineState`; and a state dirty **only** on `items` (non-empty transcript, clean chrome) returns `toBe` the same state — this is the case that pins the early-out predicate rather than the trivial initial-state case.
- **Idempotent.** A second `reconnected` returns the same reference as the first.
- **A rising edge after a `reconnected` sets the status again (AC5).** Two runs: `[apiRetry(true, 1, 3), reconnected(), apiRetry(true, 2, 3)]` ⇒ `apiRetry` is `{ current: 2, total: 3 }`; `[compacting(true), reconnected(), compacting(true)]` ⇒ `compacting === true`. The second is the one that matters: `compacting`'s arm early-outs on `state.compacting === event.active`, so if the clear ever failed to land, the re-assert would be swallowed as a no-op and the banner would be wrong in the *other* direction.
- **The clear does not blank a live transcript mid-turn.** `[delta('t1','hello'), apiRetry(true,1,3), reconnected(), delta('t1',' world')]` ⇒ one coalesced `assistantText` reading `hello world`, `apiRetry === null`. Proves the two halves of the Mode A / Mode B split hold on the same connect.
- **Distinct from `reset`.** From the same dirty state, `reconnected` keeps `items` and `reset` empties them; `reconnected` does **not** return `initialTimelineState`. Pins the ticket's central claim that `reset` is not reusable here — cheap, and it is the invariant a future refactor is most likely to break.

### `timelineBridge.test.ts`

- **`connected` → a payload-free `reconnected`, ignoring the ack (AC4).** `toEqual({ type: 'reconnected' })`, and `not.toBe(event)` (the fresh-literal discipline every owned-arm test in this file asserts).
- **Update the null-cluster pin at `:223`.** Remove `{ type: 'connected', ack }` from the `others` array and leave a placeholder comment where it sat — the `modalBridge.test.ts:95` precedent ("connected is no longer here — …").

#### Footgun

`ack` (`:15`) is referenced at `:223` **and nowhere else** in this file. Removing it from the `others` array without adding the positive test above strands `ack` and its `HelloAckPayload` import. `noUnusedLocals` is not enabled, so this compiles silently — it will not fail the build, it will just leave dead fixture. Add the positive test (AC4 requires it anyway) and `ack` stays live.

## Fan-out proof (why this is XS)

Verified by grep at `51c3861` (codegraph unavailable). `ThreadEvent` is switched over in exactly one place — `reduceTimeline` (`threadTimeline.ts:230`) under the `assertNever` guard (`:175`, applied `:446`). Every other reference is a producer or a type-only import, and producers construct specific arms:

- `timelineBridge.ts:14,37,187` — producer + type import
- `composerSend.ts:8,18` — producer (`userText`)
- `activateConversation.ts:7,31` — producer (`reset`), dispatch signature only
- `timelineStore.ts:18,25` — dispatch signature only
- `ConversationScreen.tsx:681,1394` — comments only

Widening the union is therefore compile-safe everywhere. **Two production files change; no edit is forced anywhere else. Zero consumer call sites.** Scope self-check: 2 production source files (`*.ts`/`*.tsx`, excluding tests and this spec) — well under the ≥5 gate.

## Open questions

None blocking. One deferred item, already flagged in the ticket and **out of scope here**: advertising a replay cursor (`last_seen_ts`, plumbed but unpopulated; or `last_event_id`, absent from the desktop wire type) would let the daemon redeliver the missed edge itself. That is a transport-level change of its own and would not remove the need for this arm — ring replay can fall back to `resync`, and a plain reconnect with no live turn still needs the chrome reconciled. Worth a PO follow-up.
