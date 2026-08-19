# #577 — Record the background-task update frame's patch onto the held task

**Size:** S (held) · **Files:** 2 production + 2 test, all four already exist · **New files:** 0

## Design source

N/A — store and bridge only. Nothing renders: `BackgroundTaskRosterData` returns `null`, and the panel
that will read this state is #568. The visual-fidelity check is intentionally skipped, exactly as on the
two shipped siblings #573 and #576.

## Files to read first

Codegraph is not initialized for this repo (`codegraph_context` → "CodeGraph not initialized"), so this
list was assembled by reading. It is the complete surface — you should not need to grep for more.

- `src/renderer/src/store/backgroundTaskRosterStore.ts` (whole file, 302 lines) — the substrate. Read it
  in full before designing anything; **two prior predictions of this shape were wrong** (see § The two
  wrong predictions). Load-bearing regions:
  - `:56-92` — `HeldBackgroundTask` and its docstring. `:70-71` carries an instruction you must
    **correct rather than follow** (§ The trap).
  - `:94-119` — `BackgroundTaskRosterEntry` (per **conversation**) and `BackgroundTaskRosterSnapshot`.
  - `:121-148` — `BackgroundTaskStartedSnapshot`, the shape your new write unit mirrors, and the store
    type with its three setters.
  - `:217-243` — `setRoster`. The `held !== undefined && held.toolCallId !== null` branch at `:227` is
    the one line of behaviour this ticket reshapes.
  - `:244-258` — `setStartedTask`, the copy-on-write idiom your new setter clones.
  - `:259` — `resetRosters`, the in-file precedent for returning the **same state reference** so
    zustand's `Object.is` short-circuits (`queueStore.ts:79` is the cross-store twin).
  - `:272-301` — `selectRosterFor`. Hands back the held entry itself; must stay that way.
- `src/renderer/src/store/backgroundTaskRosterBridge.ts` (whole file, 165 lines) — `:45-58` and `:71-87`
  are the two sibling single-arm translators your third one clones; `:66-69` documents this arm as
  dormant and yours (correct that prose); `:114-133` is `subscribeBackgroundTaskRoster`, which gains a
  fifth writer; `:147-164` is the container that passes it.
- `src/shared/ipc/events.ts:208-242` — the `backgroundTaskUpdated` arm: four fields
  (`conversationId`, `taskId`, `patch`, `truncatedFields`) and the daemon-derived reasoning about
  `patch: ''` being a value, `truncatedFields: null` meaning nothing was cut, and the inert-text rule.
  `:199-207` is the six-field started arm next to it, for contrast.
- `src/shared/wire/types.ts:505-535` — `BackgroundTask`, the roster row. **It has no `patch`.**
  `src/shared/wire/types.test.ts:318-336` pins that absence with `expect(row).not.toHaveProperty('patch')`.
  Do not touch either — CLAUDE.md and ADR 0002 forbid drifting the wire types.
- `src/renderer/src/store/backgroundTaskRosterStore.test.ts` (whole file, 426 lines) — the existing case
  matrix you extend. § Exact mechanical edit sites lists every line in it that must change.
- `src/renderer/src/store/backgroundTaskRosterBridge.test.ts` (whole file, 441 lines) — same; the
  `describe('seam (real store)')` block at `:312-426` is where the end-to-end cases go.
- `docs/knowledge/codebase/576.md` § "Open mutation-control gap (from code review)" (`:93-107`) — the
  open SHOULD FIX this slice closes. Read it; two of your tests exist to kill that mutant.
- `docs/knowledge/codebase/573.md:74-78` — **read it only to disbelieve it.** It is the last surviving
  copy of a wrong prediction (§ The two wrong predictions). Do not edit it: `docs/knowledge/` belongs to
  the documentation phase.
- `src/renderer/src/store/queueStore.ts:35-37, 79, 96-105` — the structural precedent this store mirrors
  (`ReadonlyMap` copy-on-write, same-reference reset). Read for idiom only; do not change it.

Not needed: `App.tsx` (the container's name and props are unchanged, so it is untouched), the three
exhaustive renderer bridges (`daemonEventBridge`, `timelineBridge`, `modalBridge` — this arm is already a
deliberate no-op there since #565), and the whole `src/main` transport half (#565 shipped the decode).

## Context

The daemon reports claude's background-task lifecycle as three frames. All three already decode to typed
`DaemonEvent` arms (#564, #565, #566). #573 shipped the store holding the **roster**; #576 reshaped the
held value to be per-task and joined the **started** frame onto it. This slice joins the third and last
arm, `backgroundTaskUpdated`, recording its `patch` onto the task it names.

The join key is `conversationId` + `taskId` and never arrival order: ordering within a turn is claude's,
not the daemon's, so an update can arrive before the roster or the started frame that opens its task.

## Design

### 1. The held patch record — one nullable pair, not two loose fields

Two new exported types in `backgroundTaskRosterStore.ts`, and one new field on `HeldBackgroundTask`:

```ts
/** The latest patch this app has been told about for one task, plus the cut report FOR THAT PATCH. */
export interface HeldBackgroundTaskUpdate {
  patch: string
  truncatedFields: readonly string[] | null
}

export interface HeldBackgroundTask {
  // ...the five existing fields, unchanged...
  latestUpdate: HeldBackgroundTaskUpdate | null
}
```

Four decisions, each load-bearing:

- **One nested record, not two sibling fields.** A held task cannot sensibly carry a patch cut report
  without a patch. Nesting makes that disagreement unrepresentable; two independently-settable fields
  would permit it and cost a test to forbid it.
- **`latestUpdate: … | null`, required and nullable — never optional.** `null` means *no update has ever
  matched this task*; `{ patch: '', truncatedFields: null }` means *claude sent no change*. Those are
  different readings and neither substitutes for the other (AC1). Required-and-nullable is also the
  sibling's argument at `backgroundTaskRosterStore.ts:59-64`: an optional property lets a construction
  site silently omit it and still compile, and this slice **adds** construction sites on the roster path.
- **`latestUpdate`, not `patch`, as the field name.** The name states latest-wins at every read site.
  There is deliberately no accumulating list: an append-only history keyed by a `task_id` the model
  influences, fed by a push stream, is unbounded growth on attacker-influenceable input, and the daemon's
  own cap (`maxTaskPatch`, 4 KiB — confirmed at `internal/protocol/interactive_test.go:743` in the
  pyrycode checkout) is per frame, not per task.
- **The nested `truncatedFields` keeps that name.** It names the same wire field, and the nesting is the
  disambiguation: `held.truncatedFields` is the task's own cut report (from a roster row or the started
  frame), `held.latestUpdate.truncatedFields` is the patch's. The three lists name three different
  vocabularies (`src/shared/wire/types.ts:510-514` calls this out), so they are never merged, unioned,
  hoisted, or flattened. This is a **second field**, not a third competitor for the first one — which is
  precisely what keeps every list attributable back to the field it describes.

### 2. The write unit and the setter

```ts
/** The update write unit — the `backgroundTaskUpdated` arm minus its `type` tag. FOUR fields. */
export interface BackgroundTaskUpdatedSnapshot {
  conversationId: string
  taskId: string
  patch: string
  truncatedFields: readonly string[] | null
}
```

Flat, mirroring `BackgroundTaskStartedSnapshot` and the arm itself — the translator stays a
copy-the-named-fields filter. (A nested `{ conversationId, taskId, update }` snapshot was considered so
`setUpdatedTask` could assign the record by reference; rejected because it only moves the construction
site from the setter to the translator, and it breaks the sibling's flat posture for no gain.)

`BackgroundTaskRosterStore` gains a fourth entry point:

```ts
setUpdatedTask: (snapshot: BackgroundTaskUpdatedSnapshot) => void
```

**Contract** (AC1, AC2, AC3):

1. Look up the conversation entry. **Absent → return the state object itself, unchanged.**
2. Look up `taskId` in that entry's `tasks`. **Absent → return the state object itself, unchanged.**
3. Otherwise copy-on-write exactly as `setStartedTask` does: clone the inner `tasks` map, `Map.set` the
   matched key to the held record with `latestUpdate` replaced, clone `s.rosters`, write the entry back
   with `droppedTasks` **preserved** from the existing entry.

Notes on step 3:
- The replacement value is `{ ...held, latestUpdate: { patch, truncatedFields } }`. A spread is correct
  here — unlike in the translators, this is a same-type held-record → held-record update whose whole
  meaning is "every other field is untouched", and an update frame reports none of the other fields.
- `truncatedFields` is assigned **straight across** from the snapshot. No `??`, no `|| []`. `null` is
  "nothing was cut" and is a distinct value from `[]`. A collapse here is neither a type error nor a
  break of any other assertion — the AC3 tests are the entire defence.
- `held.truncatedFields`, `held.description`, `held.taskType` and `held.toolCallId` are **not** touched.
  An update frame reports none of them.
- `Map.set` on an existing key keeps its position, so display order is untouched.

Steps 1 and 2 returning the same state reference is the in-file `resetRosters` idiom
(`backgroundTaskRosterStore.ts:259`, twin at `queueStore.ts:79`): zustand's `Object.is` short-circuits and
no listener churns. It is also what makes AC2 assertable — "creates no partial entry" is provable by
`expect(store.getState()).toBe(before)` rather than by enumerating what did not appear.

### 3. The `setRoster` carry-over reshape (AC4)

`setRoster`'s per-row branch (`:225-238`) keeps a held record **whole** when it is started-sourced, and
rebuilds from the row otherwise. Only the rebuild branch changes: its fresh literal gains one field.

```
latestUpdate: held?.latestUpdate ?? null
```

That is the entire production change to `setRoster`. The keep-whole branch is untouched — a started-
sourced record carries its `latestUpdate` across because the whole record rides across.

- `??` is correct **here** and does not contradict the no-`??`-near-`truncatedFields` rule. It normalises
  `undefined` (no prior held record at all) and `null` (held, never updated) to `null`; both mean the
  same thing and no wire value is being collapsed. Do not delete it by cargo-culting the sibling rule.
- **Do NOT widen the provenance predicate.** See § The trap.

### 4. Bridge: a third single-arm translator, a fifth writer

- `translateBackgroundTaskUpdated(event: DaemonEvent): BackgroundTaskUpdatedSnapshot | null` — clone of
  the two siblings in every respect: `switch` on `event.type`, one owned arm returning a **fresh
  named-field literal** (never `return event`, never a spread — a spread would carry the `type` tag and
  any field a later arm gains into a write unit that never agreed to hold it), `default: null`,
  React-free. `truncatedFields` passes through untouched.
- `subscribeBackgroundTaskRoster` gains a fifth parameter,
  `setUpdatedTask: (snapshot: BackgroundTaskUpdatedSnapshot) => void`, appended after `setStartedTask`.
  The listener body gains a third `!== null` guard after the started one; branch order is
  `connected` → roster → started → updated. The arms are mutually exclusive, so order is a readability
  choice, not a correctness one — keep the existing `if (…) { …; return }` shape.
  - Considered and rejected: collapsing the four callbacks into one options object. It touches the same
    nine call sites, is a refactor of shipped code CLAUDE.md tells you not to do while you are here, and
    breaks the sibling posture #576 established. Keep the positional parameter.
- `BackgroundTaskRosterData` passes a fifth arrow calling
  `backgroundTaskRosterStore.getState().setUpdatedTask(snapshot)`. Its name, props and return stay
  identical, so **`App.tsx` is untouched by this slice.**
- The translator stays `default: null`, **not** `assertNever`. This bridge is an independent subscriber
  in the queueBridge / sessionIdBridge posture, not one of the three typecheck-gating exhaustive bridges.

### 5. The trap — the shipped docstring points at the wrong reshape

`HeldBackgroundTask`'s docstring (`backgroundTaskRosterStore.ts:70-71`) says:

> *Any field added here that a roster row cannot report must join that predicate.*

`latestUpdate` is exactly such a field, so the instruction reads as authoritative. **Following it
literally is wrong.** The predicate gates whether the held record is kept **whole**. Widening it to
`|| held.latestUpdate !== null` makes a patched roster-sourced task stop being rebuilt from later roster
rows, so its `description`, `taskType` and own `truncatedFields` go stale and never refresh again.

The two failure modes, both of which compile clean and break no existing test:

| Mistake | Symptom |
| --- | --- |
| Leave the rebuild branch as shipped | A roster-sourced task **loses its patch** at the next roster (AC4 fails). |
| Widen the predicate as the docstring says | A patched roster-sourced task **freezes its label** forever. |

The correct rule, and the docstring correction you must write in place of the sentence at `:70-71`:
a field a roster row cannot report either **gates keeping the record whole** (`toolCallId`, because the
started frame's copy of every field is authoritative) or **rides across the rebuild individually**
(`latestUpdate`, because no roster row can report it *and* the row's other fields must still refresh).
State which of the two each field is, and why `latestUpdate` is the second kind.

### 6. The two wrong predictions

Both predicted `BackgroundTaskRosterEntry` would be widened with an optional `patch`. That entry is
**per conversation**, so a single patch cannot hang off it, and the field is required-and-nullable rather
than optional. #576 corrected the four in-code copies; `docs/knowledge/codebase/573.md:74-78` was missed
and is now the only survivor. **Disbelieve it and read the store.** Do not edit it — `docs/knowledge/`
is the documentation phase's, and the correction is carried in § Open questions below for that pass.

### 7. Prose corrections (in-file, part of this slice)

These are stale the moment the arm lands, and leaving them contradicts the code:

- `backgroundTaskRosterStore.ts:3-6` — "observes **two** typed daemon events" → three.
- `backgroundTaskRosterStore.ts:33-35` — "**Three** named setters" → four (name the new one).
- `backgroundTaskRosterStore.ts:70-71` — the trap sentence (§ 5).
- `backgroundTaskRosterStore.ts:142-143` — "the **three** mutation entry points" → four.
- `backgroundTaskRosterBridge.ts:2-5` — "observes **TWO** typed daemon events" → three.
- `backgroundTaskRosterBridge.ts:66-69` — "`backgroundTaskUpdated` stays dormant on this path — it is
  #577's" → now owned by the third translator below it.
- `backgroundTaskRosterBridge.test.ts:106-107` — the same dormancy comment inside the roster translator's
  negative-sample list. The **assertion stays** (each translator remains a single-arm filter); only the
  comment's claim about dormancy changes.

**Out of scope, deliberately:** the ~18 stale `#567` references in `daemonEventBridge`, `timelineBridge`,
`modalBridge` and their tests. #576's code review confirmed leaving them is correct restraint. Do not
sweep them.

## Exact mechanical edit sites

Adding a required field and a required parameter breaks existing call sites. These are all of them —
you should not need to search.

**`subscribeBackgroundTaskRoster(…)` — append a fifth argument (`vi.fn()` unless the test asserts on it):**
`backgroundTaskRosterBridge.test.ts` lines **226, 232, 242, 258, 270, 291, 304, 316** and
`backgroundTaskRosterBridge.ts` line **155** (the container — pass the real setter). Nine sites.

**`HeldBackgroundTask` values — add `latestUpdate: null`** (these are runtime `toEqual` comparisons, so
an omission fails a test rather than the compiler, except the two typed consts which fail to compile):
- `backgroundTaskRosterStore.test.ts` **43-49** (`heldNoCut`, typed const) and **50-56**
  (`heldCutDescription`, typed const).
- `backgroundTaskRosterStore.test.ts` inline `toEqual` objects at **148-154**, **165-171**, **199-205**.
- `backgroundTaskRosterBridge.test.ts` inline `toEqual` objects at **337-343**, **350-356**.

Sites that reuse `heldNoCut` / `heldCutDescription` (store test lines 110-115, 127, 207, 291, 386,
401-407) need no edit — the consts carry the new field for them.

## State and concurrency model

Unchanged from #573/#576. Pure renderer state; one zustand vanilla store; one app-lifetime listener in
`BackgroundTaskRosterData` dispatching synchronously in arrival order, so there is no read-then-write gap
a concurrent handler could interleave into. No async, no `AbortController`, no timers, no IPC added — the
new writer rides the existing subscription, whose cleanup is already the `onDaemonEvent` off handle.

Re-render correctness: `selectRosterFor` must keep returning the **held entry itself**. An update writes
a new entry object for its own conversation only; every other conversation's entry stays `Object.is`
identical, so a component watching a different `conversationId` does not re-render. Adding a per-task
field is where a fresh-object-per-selector-call regression is easy to introduce — the selector must gain
no mapping, no spread, and no derived object. One test pins this.

Growth bound is unchanged and stated rather than defended: latest-wins means one held patch per held
task, each capped at 4 KiB by the daemon, and the held task count is already bounded by the roster cap
plus started frames since connect. No eviction policy is invented for a failure nobody has observed.

## Error handling

No new failure modes. The arm is already decoded and validated on the transport side (#565); the store
receives a typed value with no parse step. There is deliberately **no `JSON.parse` of `patch`**, no key
enumeration, and no derived `completed` / `failed` state — the daemon reports no terminal event, and its
own doc types `patch` as a plain string rather than raw JSON precisely because truncation makes it
unparseable. A task's absence from a later roster remains the only removal path.

`truncatedFields` on the update reports the **cap cut only** — the daemon also scrubs invalid UTF-8 by
deletion, so `patch` can differ from claude's bytes without appearing in the list. Record it; never
cross-check it against the patch.

## Testing strategy

`npm test` (vitest) plus `npm run typecheck`. All new cases go in the two existing test files.
Scenarios, not code — write them in the file's established idiom.

### `backgroundTaskRosterStore.test.ts`

1. **Records a patch on a roster-sourced task.** Roster `[noCut]`, then an update for `c1`/`t1` →
   `latestUpdate` equals `{ patch, truncatedFields }`; `description`, `taskType`, `toolCallId` and the
   task's own `truncatedFields` are unchanged. Assert `latestUpdate` was `null` before the update.
2. **Records a patch on a started-sourced task.** Same, seeded via `setStartedTask`.
3. **Latest wins.** Two updates for the same task → `latestUpdate.patch` is the second one only, and
   `latestUpdate` is a single record, not a list.
4. **`patch: ''` is a value, not an absence (AC1).** Update with `patch: ''` → `latestUpdate` is **not**
   null and `latestUpdate.patch === ''`. This is the test that fails if anyone writes
   `if (snapshot.patch)` anywhere on the path.
5. **Unknown `taskId` in a known conversation is ignored (AC2).** Capture `store.getState()`, emit the
   update, assert `toBe(before)` and that `tasks` gained no key.
6. **Unknown `conversationId` is ignored (AC2).** Assert `toBe(before)`, `rosters.has('cX') === false`,
   and `selectRosterFor('cX')` still `null` — no partial entry was opened.
7. **The two cut reports stay distinct (AC3).** Seed a row with `truncated_fields: ['description']`,
   update with `truncatedFields: ['patch']` → `held.truncatedFields` is `['description']` and
   `held.latestUpdate.truncatedFields` is `['patch']`. Neither merged, neither overwritten.
8. **Null-preservation on the update path (AC3).** Three tasks updated with `null`, `[]` and
   `['patch']` → each `latestUpdate.truncatedFields` reads back identically. `null` never becomes `[]`.
9. **AC4, roster-sourced — the mutation-control case.** Roster `[noCut]` → update → a **second** roster
   whose row for `t1` carries a **changed** `description`, `task_type` and `truncated_fields`. Assert
   the held record shows the **new row's** fields **and** still holds `latestUpdate`. This single test
   kills both mistakes in § 5: the unfixed branch drops the patch, the widened predicate freezes the
   label.
10. **AC4, started-sourced — closes #576's open SHOULD FIX.** Started frame → update → a roster whose row
    for `t1` carries changed fields. Assert the started record is kept whole (fuller `description`,
    `toolCallId` intact) **and** `latestUpdate` survives. Deleting `&& held.toolCallId !== null` must
    fail this test; note that in the test body so it is not later pruned as redundant.
11. **Membership still wins over carry-over.** Patch a task, then a roster that does **not** list it →
    the task is gone entirely; the recorded patch does not resurrect it.
12. **`resetRosters` clears recorded patches (AC5).** Patch tasks in two conversations, reset, assert
    both read `null` through `selectRosterFor`.
13. **Selector reference stability.** After an update, two consecutive `selectRosterFor(c)(state)` calls
    return the same object (`toBe`); and an update for `c2` leaves `c1`'s entry `Object.is` identical.
14. **Setter reference stability** — extend the existing test at `:414-425` to cover `setUpdatedTask`.

### `backgroundTaskRosterBridge.test.ts`

15. `translateBackgroundTaskUpdated` maps its owned arm to the four-field snapshot; the result is
    `not.toBe(event)` (fresh literal, no `type` tag leaked).
16. It passes `truncatedFields: null` through as `null`.
17. It returns `null` for a sample of unrelated events, roster and started included.
18. Extend the two existing negative-sample lists (`:106-114`, `:165-171`) — the `backgroundTaskUpdated`
    entries stay and still assert `null`; only their comments change (§ 7).
19. `subscribeBackgroundTaskRoster` calls `setUpdatedTask` once with the translated snapshot on an
    updated event, and calls neither `setRoster`, `setStartedTask` nor `resetRosters`.
20. Extend the existing "neither resets nor writes for an unrelated event" test (`:299-310`) to assert
    `setUpdatedTask` was not called.
21. **Seam (real store):** roster → update → the store holds the patch; then a second roster with a
    changed row for that task keeps the patch and refreshes the row fields. AC4 end-to-end.
22. **Seam (real store):** patch a task, emit `connected`, assert the conversation reads `null`. AC5
    end-to-end — a previous pairing's patch text never survives a (re)handshake.

## Size check

- **New files:** 0.
- **Production files touched:** 2 (`backgroundTaskRosterStore.ts`, `backgroundTaskRosterBridge.ts`) —
  the § 4 ≥5-file gate counts 2.
- **New exported types:** 2 (`HeldBackgroundTaskUpdate`, `BackgroundTaskUpdatedSnapshot`) — under 5.
  (The ticket body predicted one; the second is the nested held record, which § 1 argues for. Still well
  under the line.)
- **Consumer call sites:** 9 for the `subscribeBackgroundTaskRoster` signature (enumerated above) — under
  the 10-site line. The 7 held-record assertion sites are in the two test files this slice is rewriting
  anyway, and are listed by line so they cost an edit each and no discovery.
- **Reject / error branches:** 2 (`setUpdatedTask`'s two misses) — far under 10.
- **Projected total written lines:** ~100 production (two type blocks with docstrings, one setter, one
  translator, one parameter, one field on the rebuild literal, the § 7 prose corrections) + ~300 test.
  ~400 total.

**Ruler — measured, same four files, twice:** #573 (`ca86ce2`) shipped 760 insertions across 5 files;
#576 (`7790a76`) shipped 786 insertions / 205 deletions across these exact 4 files. Both sized S, both
shipped clean without hitting the turn budget. This slice is strictly smaller in kind than #576: #576
introduced the held-record type and rewrote every assertion from wire rows to camelCase records, whereas
this one appends one field, one setter, one translator, and one argument. The ~600-line red line holds.

**Splits considered and rejected:** (a) store-then-bridge — the store half would ship a setter nothing
calls and the bridge half would re-touch all four files, so both children pay the same reading cost and
the total is larger; (b) record-then-carry-over — splitting AC4 out means deliberately shipping the
carry-over bug this ticket exists to fix for a cycle. Neither is a clean seam. This matches the
`architect-outbound-verb-slice-is-5-files-irreducible-s` precedent: compile-atomic, near-zero
production fan-out, do not split.

## Open questions

- **`docs/knowledge/codebase/573.md:74-78` is still wrong** and is now the only surviving copy of the
  "widen `BackgroundTaskRosterEntry` with an optional `patch`" prediction. It is per-conversation, and
  the field is required-and-nullable on the per-**task** record. The developer must not touch it
  (documentation-phase ownership); the documentation pass for this ticket should correct or annotate it,
  as #576's pass did for the four in-code copies.
- **`latestUpdate` vs a future `#568` read shape.** The panel is the first reader and may want a
  formatted or parsed view of `patch`. Interpreting it belongs there, behind an error branch, and must
  never enumerate a closed key set. Nothing in this slice should anticipate that.
- **Reconnect repopulation is #569's**, unchanged: the set reads empty after a reconnect until claude
  next emits a roster, and `resetRosters` clears recorded patches along with everything else for free.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new boundary. The untrusted → typed crossing for this arm already happened in
  the main process (#565's decode); this slice consumes an already-narrowed `DaemonEvent` arm across the
  existing preload channel and copies four named fields. The one thing that *changes* the trust picture
  is that `patch` is a **new class of untrusted, model-influenced text now retained in renderer state** —
  structured-looking, and per the daemon's own doc (`internal/protocol/interactive.go:200-210`) the more
  tempting thing to feed somewhere that runs it. The spec pins it as opaque: held verbatim, never parsed,
  never key-enumerated, no derived state. The obligation to render it as inert plain text — never an HTML
  sink, an attribute, or a URL, never executed or re-shelled — is inherited by #568 and must be written
  into `HeldBackgroundTaskUpdate`'s docstring here, exactly as `description`'s command-line hazard is
  carried at `backgroundTaskRosterStore.ts:45-51`. **This is a required deliverable, not advisory** — it
  is the only place the constraint travels to the reader.
- **[Tokens, secrets, credentials]** No findings. No token, key, or credential can ride this arm — the
  payload is two bounded opaque strings and a list of wire field names. Nothing is logged by this path.
- **[File / storage operations]** No findings, and one prohibition restated: **nothing here may be
  persisted to web storage.** `localStorage` / `sessionStorage` / IndexedDB would survive the pairing
  boundary that AC5's `connected`-edge reset exists to enforce, and would leave a previous pairing's
  patch text — which may embed command text — readable on disk. The store is memory-only, as its two
  siblings are. No path is constructed from any field.
- **[Inter-process / Electron attack surface]** No findings. No new IPC channel, no new `contextBridge`
  surface, no `ipcMain` handler; the fifth writer rides the existing `window.pyry.onDaemonEvent`
  subscription. Nothing crypto-, socket- or key-adjacent enters the renderer.
- **[Cryptographic primitives]** Not applicable — no randomness, no comparison against a secret, no
  handshake surface. `taskId` matching is a `Map` lookup on a non-secret daemon-assigned id, so
  `timingSafeEqual` is not indicated.
- **[Network & I/O]** No findings. No socket, no fetch, no timeout to set. Frame caps are the daemon's
  and the transport's (`maxTaskPatch` 4 KiB per frame; the 65519-byte envelope), both upstream of here.
- **[Error messages, logs, telemetry]** No findings — and a constraint worth stating for code review:
  **do not add a `console.log` / diagnostic call carrying `patch` or `description`** on any branch,
  including the two AC2 misses. This app's content-free diagnostics rule (#126) forbids message content
  in logs, and a "dropped an unmatched update for task X" log line is exactly where patch text would leak
  into a file readable by anything running as the user. The two miss branches return silently.
- **[Concurrency]** No findings. No async task, timer, or listener is added; the writer is a synchronous
  dispatch on the existing app-lifetime subscription, whose cleanup is unchanged. There is no
  read-then-`await`-then-write gap — `setUpdatedTask` reads and writes inside one zustand `set`.
- **[Threat model alignment]** *Malicious relay:* it is on-path but content-blind and cannot forge a
  frame inside the Noise session; drop/delay/reorder is already survivable here because the join is on
  `conversationId` + `taskId` and never on order, and an update for an unknown task is a silent no-op
  rather than a partial write. *Hostile daemon response:* every field is narrowed on the transport side;
  this slice adds no parse. *Unbounded growth on attacker-influenceable input:* addressed by design —
  latest-wins per task rather than an append-only history keyed by a model-influenced `task_id`.
  *Renderer compromise:* out of scope for this slice and unchanged by it — no secret becomes reachable.
  *Stale-pairing disclosure:* AC5's `connected`-edge reset is the control, tested end-to-end (scenario
  22); folding that reset into a translator or gating it behind a condition would kill it silently, so
  the listener branch at `backgroundTaskRosterBridge.ts:121-124` must not be touched.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-19
