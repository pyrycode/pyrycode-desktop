# #593 — Renderer: drop the announced running model when the pairing ends

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/593
**Size:** S · `security-sensitive`

## Design source

N/A — renderer state lifecycle only, no user-visible surface of its own. The run-configuration sheet
that renders this store carries the Figma reference on #560. The visual-fidelity check is intentionally
skipped for this ticket.

## Files to read first

Codegraph is not initialised for this repo (`codegraph init` has never been run here), so this list was
built by hand. Line ranges are against `main` at `c3af075`.

| Path | What to extract |
|---|---|
| `src/renderer/src/store/announcedModelStore.ts:19-22` | "A single setter rather than a reducer" — the paragraph that becomes false with this change; `sessionIdStore.ts:15-20` is the two-mutation rewrite to mirror |
| `src/renderer/src/store/announcedModelStore.ts:24-32` | The deferral block this ticket retires. It asserts an exclusion that no longer holds |
| `src/renderer/src/store/announcedModelStore.ts:58-75` | `AnnouncedModelState` + the `announced: null` vs `{ model: '', truncated: false }` contract. AC1 asks for the former |
| `src/renderer/src/store/announcedModelStore.ts:77-84` | `AnnouncedModelStore` type + `initialAnnouncedModelState`. The new setter goes on the *store* type, never on the *state* interface |
| `src/renderer/src/store/announcedModelStore.ts:99-119` | Factory, singleton, hook, selector — the shape the new setter slots into |
| `src/renderer/src/store/sessionIdStore.ts:31-39` | The two-mutation store type this one becomes |
| `src/renderer/src/store/sessionIdStore.ts:41-73` | `clearSessionId: () => set(initialSessionIdState)` at `:72` — the exact shape to mirror — plus `:44-48` on why it is sourced from the exported constant and why unconditional beats a guard |
| `src/renderer/src/store/sessionIdStore.ts:56-62` | The post-clear repopulation window and why it is left unguarded. Inherited verbatim here; see § Error handling |
| `src/renderer/src/clearPairingScopedState.ts:9-33` | The deps docstring + `ClearPairingScopedStateDeps`. `:22-26` is the exclusion list — it must NOT gain this store |
| `src/renderer/src/clearPairingScopedState.ts:35-80` | Helper docstring + body. `:42-48` ("Three of these four stores latch"), `:53-57` (idempotence), `:59-62` (ordering), `:64-67` (why nothing is logged) all need arithmetic or content updates |
| `src/renderer/src/clearPairingScopedState.test.ts:32-50` | `spyDeps()` — the fifth spy goes here |
| `src/renderer/src/clearPairingScopedState.test.ts:53-65` | Tripwire stage 2: each member asserted called once |
| `src/renderer/src/clearPairingScopedState.test.ts:67-80` | Tripwire stage 1: the key-set literal. Its own comment `:68-71` describes the two-stage sequence |
| `src/renderer/src/clearPairingScopedState.test.ts:113-144` | The already-clear case (AC3's home) and `realDeps`, which gains a fifth store |
| `src/renderer/src/PairedShell.tsx:43-55` | `clearPairingDeps` — one shared object, so this is a single edit |
| `src/renderer/src/PairedShell.tsx:159-178` | The two call sites (`:171`, `:176`). Neither changes |
| `src/renderer/src/App.tsx:113-125` | The roster leaf's `connected`-edge note and the announced-model leaf's deferral note. The latter is retired here |
| `src/renderer/src/store/backgroundTaskRosterBridge.ts:118-127` | The counter-example: "THIS BRANCH IS THE SOLE ENFORCEMENT OF AC5", and why that store is *not* in the shared set |
| `src/renderer/src/store/announcedModelBridge.ts:60-70` | `subscribeAnnouncedModel` — the only writer. Unchanged, but read it to see that nothing re-asserts a value on a new pairing |
| `src/renderer/src/screens/conversation/RunConfigSections.tsx:185-230, :464-466` | The consumer. #560 **has landed** (merge `c3af075`), so a stale value is observable today |
| `src/renderer/src/store/announcedModelStore.test.ts:1-19, :112-127` | Test idiom + the DI/seed cases the new clear cases sit beside |

## Context

`announcedModelStore` (#588) holds claude's announced running model. Nothing re-asserts it on a new
pairing — an announcement rides a turn's `init` line, so after a pairing change the store keeps the
previous daemon's value until the new daemon's first turn produces one.

**Correction to the ticket body's premise, in the ticket's favour.** The body says #560 is in flight and
the store still ships dormant. #560 merged as PR #594 (`c3af075`, now the tip of `main`), so
`RunConfigSections.tsx:466` reads this store through `useAnnouncedModelStore(selectAnnouncedModel)` and
`RunningModelSection` (`:211-230`) renders it under a "Running model" header. The stale value is
observable **today**: after a pair-another-server switch the sheet attributes server A's model — and
server A's `(truncated)` cut report — to server B, with no provenance marker distinguishing them. The
deferral recorded at `announcedModelStore.ts:24-32` has expired exactly as it predicted it would ("the clear rides with #560
or a follow-up filed against it").

Everything else in the body holds. There is no file overlap with #560's merged diff, and the
branch-overlap sweep over all twelve live `origin/feature/*` branches found no other in-flight work
touching any file below, so no `addBlockedBy` is needed.

## Design

### Mechanism — the shared helper. Not a `connected`-edge clear. Not an architect coin-flip.

The body offered this as open; the code has already settled it, and AC2 + AC4 already assume the answer.

Two mechanisms exist and they are **mutually exclusive by design**:

- `clearPairingScopedState` — runs on both pairing-change paths, and its docstring (`:22-26`)
  *explicitly excludes* stores the transport's `connected` edge already clears.
- A `connected`-edge clear inside a store's own bridge — `backgroundTaskRosterBridge.ts:118-127`, whose
  comment states its branch is "THE SOLE ENFORCEMENT OF AC5" (#573: no previous *connection*'s tasks
  survive a *re-handshake*) and that this is why that store is deliberately absent from the shared set.

So the discriminator for any pairing-scoped store is one question: **does a reconnect to the *same*
daemon need to clear it?** For background tasks, yes — a re-handshake means the roster may have moved on
underneath us. For the announced model, **no**: after a reconnect to the same daemon the held
announcement still describes that daemon, and clearing it would blank a correct value the sheet has no
way to re-fetch (there is no request half — `announcedModelBridge.ts:1-7`). Answer *no* ⇒ the shared
helper.

**The only thing that would justify deviating** is a concrete re-handshake staleness case — a scenario
where the same daemon, across a reconnect, is running a different model than it announced before the
drop, *and* that mattered. No such case is known: the announcement is per-turn, and the next turn on the
reconnected daemon re-announces. If a developer or reviewer believes they have found one, note that
deviating invalidates AC2 (both pairing-change paths) and AC4 (the shared clear-set test) as written —
**route the ticket back rather than reinterpreting those ACs**.

### 1. `announcedModelStore` — a second mutation

Add one setter to the **store** type (not to `AnnouncedModelState`, so the selector stays typed against
the state-only interface and `initialAnnouncedModelState` stays assignable — the existing `:77-79`
rationale, unchanged):

```ts
export type AnnouncedModelStore = AnnouncedModelState & {
  setAnnouncedModel: (announced: AnnouncedModel) => void
  clearAnnouncedModel: () => void   // returns the state to initialAnnouncedModelState, by reference
}
```

In the factory, mirror `sessionIdStore.ts:72` exactly: `set(initialAnnouncedModelState)` — sourced from
the exported constant, never a fresh `{ announced: null }` literal, so it keeps resetting everything if
the state ever gains a second field. Unconditional, with no already-clear guard: that is what makes AC3
structural rather than arranged.

Comment work in this file, all of it load-bearing rather than cosmetic:

- **Retire `:24-32` entirely.** It asserts an exclusion that is now false. Replace it with the positive
  statement: this store IS in `clearPairingScopedState`'s set, because nothing re-asserts an
  announcement on a new pairing, and it is *not* on the `connected` edge, because a reconnect to the same
  daemon leaves the held announcement accurate. Name `backgroundTaskRosterBridge.ts:118-127` as the
  contrasting case. The ticket is explicit that this reasoning belongs in the code beside the other
  stores' — the shared helper exists precisely because it used to live nowhere.
- **Rewrite `:19-22`** ("there is exactly one mutation … a one-member union"). There are now two.
  `sessionIdStore.ts:15-20` is the paragraph to mirror: two *independent whole-value writes*, neither
  reading prior state nor constraining the other's ordering, so there is still no state machine for a
  discriminated-union action set to model.
- **Amend `:116-119`** ("There is no exposed setter beyond `setAnnouncedModel`"). Both mutations are
  store-owned and invoked only by wiring — never two-way-bound from a component. Unidirectionality is
  preserved, not weakened: the clear has exactly one caller, and it is the helper.

Out of scope in this file: the `(#560, later)` phrasing in the header comment and the two "Ships
dormant" notes in `announcedModelBridge.ts` (`:75-77`) / `App.tsx:123`. Those went stale when #560
merged, not because of this change. Fix only the `App.tsx` sentence named below, which is *about* this
deferral; leave the rest for a housekeeping pass.

### 2. `clearPairingScopedState` — a fifth effect

One field on the interface, one call in the body:

```ts
export interface ClearPairingScopedStateDeps {
  // … existing four …
  clearAnnouncedModel: () => void
}
```

Place the call after `deps.clearSessionId()`, keeping the two `clear*` setters adjacent. There is no
ordering constraint — these are independent whole-value writes and none reads another's state — so
placement is legibility only.

Docstring updates, each with real content beyond arithmetic:

- The four-bullet effect list (`:10-14`) gains a fifth: `clearAnnouncedModel` — announcedModelStore's
  #593 clear.
- `:19-27`'s rule paragraph: the announced model is now the worked example of a store that belongs here,
  and the exclusion list at `:22-26` must **not** gain it.
- `:42-48` ("Three of these four stores latch across either switch because nothing on a new pairing
  re-asserts them") becomes four of five, and the announced model joins the latch enumeration with its
  own reason: its sole writer is `subscribeAnnouncedModel`, driven only by a turn's init line, so on a
  fresh pairing nothing writes until the new daemon's first turn.
- `:53-57` (idempotence) and `:59-62` (ordering, "no observer can see a half-cleared set") update their
  counts; the by-reference claim now also covers this store's `initialAnnouncedModelState`.
- `:64-67` (why nothing is logged) — **this stays a MUST NOT.** See § Security review.

### 3. `PairedShell.tsx` — one dep field

Import `announcedModelStore` and add to `clearPairingDeps` (`:50-55`):

```ts
clearAnnouncedModel: () => announcedModelStore.getState().clearAnnouncedModel()
```

The `getState()`-inside-the-arrow-body idiom is required, not stylistic: it keeps module scope correct,
dereferences nothing at load, reads nothing during render, and preserves PairedShell's
"subscribes to no store at all, stays server-renderable" property (`:43-49`).

Both call sites (`:171`, `:176`) pass this one object, so **neither changes**. `onPairServerCancelled`
stays unwrapped — cancelling out of pair-another ends no pairing, so it must clear nothing.

### 4. `App.tsx:123-125` — retire the deferral note

The sentence "Unlike its roster neighbour above it has no `connected` branch, so its store is
pairing-scoped with nothing clearing it yet; that deferral and its follow-up obligation are recorded in
announcedModelStore.ts" is false after this change. Replace it with: no `connected` branch **because**
the announcement survives a re-handshake to the same daemon; the pairing-change clear is
`clearPairingScopedState`'s (#593). Comment-only — no code in this file moves.

### State flow

Unchanged in every direction. One writer (`announcedModelBridge` → `setAnnouncedModel`), one reader
(`RunConfigSections` → `selectAnnouncedModel`), and now one clearer (`PairedShell` → the helper). No new
IPC, no new preload surface, no new subscription, no React state.

**Re-render seam.** The cleared value is the `null` sentinel, so `useAnnouncedModelStore(selectAnnouncedModel)`
sees `Object.is(null, null)` on a redundant clear and does not re-render. `RunningModelSection` falls to
its `RUN_CONFIG_RUNNING_UNKNOWN_COPY` arm (`:221-223`) once cleared — the same markup a freshly launched
app renders, which is AC1 restated at the surface.

## Error handling

No new failure modes. The helper is total: no gate, no return value, no throw path, and this addition
keeps it that way — the clear is an unconditional whole-value `set`.

**One inherited window, deliberately not guarded.** `AnnouncedModelData` is an App-level sibling of
`AppView` (`App.tsx:126-142`), so the unpair route flip does not unmount it and its listener outlives
the clear. A `modelAnnounced` frame from the old daemon still queued on the IPC channel would therefore
repopulate the store after the clear, last-write-wins. This is the *same* window `sessionIdStore.ts:56-62`
documents and deliberately leaves alone, with the same reasoning: guarding it belongs to the pairing
lifecycle that owns the clear, not to a store whose whole contract is to record what it was told. It is
bounded (the transport is torn down by the unpair) and self-correcting (the new daemon's first turn
overwrites), and no such failure has been observed. **Do not add a guard, a generation counter, or a
post-clear suppression window.** State the inheritance in the store docstring beside the clear and stop
there.

## Testing strategy

Both files are plain-function tests over isolated store instances — no React, no DOM, no bridge. This is
provable with spies at the helper level and does not need to be driven through the sheet.

### `clearPairingScopedState.test.ts` — AC2, AC3, AC4

AC4 requires **both** stages of the tripwire, because either alone is satisfiable while the store is
declared but never invoked:

- `spyDeps()` gains a fifth `vi.fn()` and returns it alongside the others.
- Stage 2 (`:53-65`): add `expect(clearAnnouncedModel).toHaveBeenCalledTimes(1)`. Update the test name's
  "all four clears" to five.
- Stage 1 (`:67-80`): add `'clearAnnouncedModel'` to the sorted key-set literal — it sorts **second**,
  between `clearActiveConversation` and `clearSessionId`. Update the comment's "a fifth pairing-scoped
  store" to "a sixth".
- `realDeps` (`:132-144`) takes a fifth store and wires
  `clearAnnouncedModel: () => announced.getState().clearAnnouncedModel()`.
- Seeded real-store case (`:82-111`): construct the announced-model store with an injected announcement
  (`createAnnouncedModelStore({ announced: { model: 'model-on-A', truncated: false } })`) and assert it
  is `null` afterwards. Extend the test name to name the announced model.
- Already-clear case (`:113-129`) — **AC3 lives here, not in a new test.** Add a default-constructed
  announced-model store to the set and assert it is still `null` after the redundant clear.

**Trap to avoid on AC3.** Do not assert idempotence with a vanilla `store.subscribe(spy)` and
`expect(spy).not.toHaveBeenCalled()` — zustand's vanilla `set` notifies subscribers unconditionally, so
that test fails on correct code. The no-churn property is a *selector*-level one: `useStore` compares the
selected value with `Object.is`, and `null` → `null` short-circuits the re-render. Note also that for
this store the by-reference claim is structurally trivial today (the cleared value *is* `null`), unlike
the timeline's `toBe(itemsBefore)` where a fresh `[]` would genuinely churn. What is load-bearing here is
that the clear is unconditional and sourced from `initialAnnouncedModelState` — assert the value, and do
not manufacture a stronger-looking identity assertion than the type admits.

### `announcedModelStore.test.ts` — AC1

Bullet-pointed scenarios; write them in the file's existing idiom (`createAnnouncedModelStore()` +
`selectAnnouncedModel`, one behaviour per `it`):

- Clearing a store holding an announcement returns `announced` to `null`, and `selectAnnouncedModel`
  returns `null` — the freshly-launched state, not a record.
- Clearing a store holding the **degenerate** `{ model: '', truncated: false }` record returns `null`,
  not that record. This is AC1's precise ask ("not an announcement carrying an empty identifier") and
  the one case that distinguishes the two sentinels the store deliberately keeps apart (`:58-65`).
- Clearing an already-clear store leaves it `null` — no throw, no guard needed.
- A clear does not make the store one-shot: a later `setAnnouncedModel` records normally.
- Optional, mirroring `:122-127`: the `clearAnnouncedModel` reference is stable across updates.

### Gates

`npm run typecheck` is the primary gate and is the reason the three production files move together — a
new field on `ClearPairingScopedStateDeps` breaks the helper body and `PairedShell`'s deps object until
both are updated, and breaks `realDeps` in the test until that is too. `npm test` covers the behaviour.
`npm run build` is the salvage gate.

## Scope

Four production files touched (`announcedModelStore.ts`, `clearPairingScopedState.ts`, `PairedShell.tsx`,
`App.tsx`), one of them comment-only; two test files; no new files; no new exported types; three call
sites of the widened interface, all compile-forced. Projected ~160 lines of written work including
comment rewrites. Under every red line, and under the §4 five-production-file gate. No split.

Explicitly **not** in scope: the `#560, later` / "ships dormant" comments that #560's merge left stale in
`announcedModelStore.ts:1-5` and `announcedModelBridge.ts:77`; any change to `RunConfigSections.tsx`;
any change to the bridge or its subscription; a guard for the post-clear repopulation window.

## Open questions

None blocking. One judgement recorded for code-review: `App.tsx` is included as a fourth (comment-only)
production file rather than left asserting a now-false design claim about a security-relevant decision.
If a reviewer prefers that comment untouched, dropping it costs nothing structural — but the comment is
then wrong.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new boundary. `announced.model` is untrusted, model-influenced,
  daemon-relayed text (`announcedModelStore.ts:46-51`); this change adds no parse, no sink, and no new
  holder — it only *drops* held untrusted data earlier than before. One MUST for the implementation: the
  clear is **unconditional and must never branch on the held content**. A clear gated on `announced?.model`
  (or on it being non-empty, or on it matching a catalog token) would let a daemon craft a value that
  survives a pairing switch and is then attributed to the next daemon. `set(initialAnnouncedModelState)`
  with no guard has this property structurally.
- **[Threat model — cross-pairing disclosure]** This is the ticket's actual security payload, and it is
  live rather than theoretical now that #560 has merged: after a pair-another-server switch,
  `RunningModelSection` (`RunConfigSections.tsx:211-230`) renders server A's identifier under a "Running
  model" header inside server B's session, with no provenance marker — the section deliberately carries
  none, since it was designed on the assumption the held value belongs to the current pairing. The stale
  `truncated` flag rides along, so server A's cut report is attributed to server B too. Clearing the
  whole record (not just `model`) is what closes both halves; a `model`-only clear would leave a
  dangling cut report. Addressed by the design.
- **[Threat model — hostile daemon]** A hostile daemon's crafted identifier can no longer outlive the
  pairing it was sent on. Nothing security-relevant branches on the value at any layer
  (`RunConfigSections.tsx:187-192`), so there is no privilege the stale value could have carried — the
  exposure is misattribution, not control-flow.
- **[Error messages, logs, telemetry]** MUST NOT log here. `clearPairingScopedState.ts:64-67` records
  that a diagnostic in this helper would want exactly the identifiers ADR 0007's content-free rule
  forbids; `announced.model` is worse than the existing four, being attacker-influenceable text that
  would land verbatim in a log file readable by anything running as the user. No observed failure
  motivates instrumentation. The pre-existing content-free seam (sessionStore's #134 transition observer,
  which records only an action `type`) is unaffected.
- **[Inter-process / Electron attack surface]** No findings. No `contextBridge` API, no `ipcMain`
  channel, no preload surface, no window/`webPreferences` change. Purely renderer-internal state, one
  new nullary function with no arguments to validate.
- **[Process placement]** No findings. Nothing here touches keys, sockets, tokens, or the Noise session;
  the transport stays in the background process and this change does not reach toward it.
- **[Concurrency]** One finding, accepted rather than fixed: `AnnouncedModelData`'s listener is
  App-lifetime (`App.tsx:126-142`) and survives the unpair route flip, so an old-daemon `modelAnnounced`
  frame already queued on the IPC channel can repopulate the store after the clear. Identical in shape
  and reasoning to the window `sessionIdStore.ts:56-62` documents and accepts; bounded by transport
  teardown, self-correcting on the next turn, never observed. **OUT OF SCOPE** — closing it means a
  pairing-generation token across every pairing-scoped store, which belongs to the pairing lifecycle and
  needs its own ticket if a failure is ever observed. Documented in the store docstring; no guard.
- **[File / storage operations]** Not applicable, concretely: this change performs no I/O of any kind —
  no `fs`, no `app.getPath`, no `safeStorage`, no path construction. The store is in-memory renderer
  state that does not persist across an app restart.
- **[Tokens, secrets, credentials]** Not applicable: no credential material is read, written, derived,
  or compared on this path. The value cleared is a model identifier string.
- **[Cryptographic primitives]** Not applicable: no randomness, no hashing, no comparison of
  attacker-controlled values against secrets. `clearAnnouncedModel` takes no arguments, so there is
  nothing to compare at all.
- **[Network & I/O]** Not applicable: no socket, no URL, no frame, no timeout. The change is downstream
  of the transport by two layers and adds no path back toward it.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-20
