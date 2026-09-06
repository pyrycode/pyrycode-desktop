# #1169 — A new chat opens at the last effort level used

## Files read

| Path → symbol | Why it matters |
|---|---|
| `src/renderer/src/store/pushNotificationPrefStore.ts` → `PushNotificationPrefStorage`, `localStoragePushNotificationPref`, `createPushNotificationPrefStore` | The storage-port preference shape this ticket's third key copies verbatim, including the `typeof window` import-safety guard the `node` vitest env needs. |
| `src/renderer/src/store/defaultWorkspaceStore.ts` → `WorkspacePrefStorage`, `DEFAULT_WORKSPACE_KEY` | The first of the two precedents; its header carries the standing "defer a key-namespacing helper until a genuine third case" note this ticket deliberately declines to act on. |
| `src/renderer/src/store/runSettingsWriteStore.ts` → `reduceRunSettingsWrite`, `selectEffectiveSettings`, `selectError`, `SettingsChange` | The write machine. Its `pending` map is where a confirm's value is recovered from, its `confirmed`/`pending` composition is what makes an applied level ≠ `''`, and `error` is the standing-rejection cell the security review rejected as a no-retry guard (`changeDispatched` clears it). |
| `src/renderer/src/store/runSettingsWriteBridge.ts` → `subscribeRunSettingsWrite`, `submitSettingsChange`, `RunSettingsWriteData` | The one place a confirm reply is folded into the store, and therefore the only seam where "remember on confirm" can read the value that was confirmed before the reducer deletes the pending record. |
| `src/renderer/src/screens/conversation/runSettingsControls.ts` → `changeSetting`, `isAddressableSessionId` | The gated write this ticket supplies a value and a moment to. `isAddressableSessionId` is the single definition of "there is a session to address" and this plan reuses it rather than restating the `null` / `''` rule. |
| `src/renderer/src/screens/conversation/ComposerEffortMenu.tsx` → `composerEffortMenuModel`, `ComposerEffortMenu` | The control whose blank rendering (`effort === '' → null`) is the defect, and the container whose four store reads this ticket's leaf mirrors. |
| `src/renderer/src/screens/conversation/RunConfigSections.tsx` → `effortRowFor`, `publishedRowFor`, `EffortSection` | #1168's row join — the ONE home of "which row's levels does an effort surface offer", including the empty-model → `default` substitution. Also the surface that stays operable at `effort === ''`, which is how the real-claude drive can pick a level at all. |
| `src/renderer/src/store/runConfigStore.ts` → `RunConfigSnapshot`, `clearSnapshot`, `selectSnapshot` | The daemon-authored snapshot base. Its `effort: ''` is the wire's "no explicit effort" and is this ticket's whole precondition. |
| `src/renderer/src/activateConversation.ts` → `activateConversation`, `clearRunConfig`, `requestConversationConfig` | #1166 + #1167's landed guarantees: opening a chat clears the previous chat's snapshot and write state and asks for the new one's configuration without waiting for a turn end. Both are load-bearing preconditions here and neither is re-implemented. |
| `src/renderer/src/screens/conversation/runConfigSnapshot.ts` → `subscribeRunConfig`, `requestRunConfigSnapshot` | #1176's attribution gate — why a late reply naming another chat cannot mis-seed the precondition this ticket reads. |
| `src/renderer/src/store/modelListStore.ts` → `ModelListEntry`, `selectModelListFor` | The per-conversation published rows; the `useMemo`-stable selector idiom the leaf reuses. |
| `docs/knowledge/features/composer-effort-menu.md` § "Where this control departs from its neighbour", § "Security", § "Testing" | The label **is** the session's value (no relabelling); the levels are unsanitized claude-authored text; and the e2e lesson that the `.composer-options-anchor` count is what isolates *this* control. |
| `docs/knowledge/features/push-notification-preference-store.md` (via the module header) | Why the port is the DI seam and why absence-mapping lives at the store, not at the port. |
| `e2e/run-config-scoped-to-conversation.spec.ts` | #1167's two-chat drive: the FAB create round trip, the per-request `session_settings` fake, and the "seed a confirmed override in A, then switch" shape this ticket's fake spec adapts. |
| `e2e/composer-effort-menu.spec.ts` | The effort control's own fake drive — invented levels, the capturing reply factory, and `settingsFramesMatching`'s deep-equal frame count. |
| `e2e/real-claude-permission-mode.spec.ts`, `e2e/run-config-settings.spec.ts` | The real-claude settings drive's shape (cursor-quiesce turn gate, read-the-baseline discipline) and how the run-configuration sheet is opened (`menuitem` "Run configuration"). |

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3688

The node is the composer footer's effort trigger as already shipped by #989: a 36×16 control drawn as the level's lowercase text in `--color-primary` at the body-small size, followed by the 8×4 `chevron-up-solid-full` glyph, with no border, no fill and no chrome of its own — the trigger is text plus glyph. **This ticket introduces no new markup, no new CSS and no new token.** It changes only *whether that trigger has a value to draw*: today the control renders `null` on a chat whose session reports no explicit effort, and after this ticket such a chat carries the remembered level, so the already-designed trigger draws exactly as the node shows. The visual-fidelity question therefore reduces to "does the existing control render", which `ComposerEffortMenuView` already answers and this ticket does not reopen.

## Context

The footer's effort control draws nothing when the session carries no explicit effort — the wire's `SessionSettingsPayload.effort === ''`, "inherited daemon default". That is every session nobody has set a level on. Unlike the model, there is nothing to fall back on: claude's session-open line does not carry effort, so no part of the system knows the effective effort of a session that was never given one. The fix is to make sure a session always has one rather than to report one nobody holds.

Juhana's call, 2026-09-04: **the default is the last level used, held client-side.** A new chat opens at whatever level the last one was set to; the value persists across restarts; it is validated against the published levels before use and dropped when it matches none; and with no usable remembered level the control stays blank rather than being filled with an invented level (#988's constraint — nothing the client displays here is client-authored).

The three blockers have landed and are what make this reachable at all: #1166 asks for the opened chat's run configuration and model list on open rather than at the next turn end; #1167 clears the previous chat's snapshot and write state on a switch, which is what makes a blank effort control reachable; #1168's `effortRowFor` resolves an unconfigured chat's inherited-default row, which is what makes its levels knowable. #1176 refuses a late reply naming another chat.

**No ADR is warranted.** This is a third instance of the shipped renderer-preference pattern plus a decision rule over existing stores; the reasoning that would go in a decision record is the "one remembered level app-wide" and "remember on confirm" argument, which belongs in the effort-menu package overview beside the control it governs.

## Size

The refiner sized this **S at ~900 lines against the table's 800**, and merged the two halves deliberately: the only clean cut is remembering from applying, and the remembered value's sole consumer is the apply half in this same slice. That is the § A1 **floor** rule — a slice whose only deliverable is consumed by exactly one sibling in the same family is part of that sibling — and when floor and ceiling disagree the floor wins. Re-counted against this written plan: **4 production source files**, ~5 new exported types/stores/components, 2 wiring sites, 5 acceptance criteria, no new reject branch. Every other line of the table is well inside its bound; the overage is one test file's worth of total written work, stated here rather than worked around.

## Design

Four production files. Nothing on the write path changes: `changeSetting` → `submitSettingsChange` already sends one `set_session_settings` carrying the single changed field, and `runSettingsWriteStore` already holds the optimistic overlay and folds the confirm or reject back in. This ticket supplies a **value** and a **moment**.

### 1. `src/renderer/src/store/lastEffortStore.ts` (new) — the remembered level

The app's **third** renderer preference, in the same shape as the two shipped ones (`defaultWorkspaceStore`, `pushNotificationPrefStore`): an injected storage **port** as the DI seam, a DI factory, an app-wide singleton, a narrow-slice hook and one read selector.

- `LastEffortStorage` — `read(): string | null`, `write(value: string): void`. No clear path: the only writer is a daemon-confirmed level, and no reset-to-default action exists (the push preference's own simplification).
- `LAST_EFFORT_KEY = 'pyry.lastEffort'` — the third key, added in the same shape as the other two. **The standing key-namespacing deferral is declined here on purpose**: extracting the helper means editing two adjacent modules this task does not otherwise need, which is squarely "don't refactor adjacent code while you are there". If the helper is wanted it is its own ticket.
- `localStorageLastEffortPref()` — the real port, with the `typeof window` import-safety guard both precedents carry (the vitest env is `node`, so the singleton must be constructible with no `window`). `read()` maps a stored `''` to `null`: `''` is the wire's *absence* of a level, never a level, so it is not a value this store may hand out. Not a try/catch — an unobserved failure mode gets no defense.
- `LastEffortState { lastEffort: string | null }`, `setLastEffort(value: string)` — persist-through-then-record, the precedents' order.

`null` is the distinct "nothing remembered" state (fresh install, or every level so far rejected).

### 2. `src/renderer/src/store/runSettingsWriteBridge.ts` (modified) — remember on confirm

Two new pure helpers plus one wiring change in `RunSettingsWriteData`.

- `confirmedEffortLevel(pending, event): string | null` — the value to remember. Non-null only when the event is `settingsConfirmed`, the `changeId` matches a pending record, that record's `field` is `'effort'`, and its `value` is non-empty. Everything else — a model/yolo/permissionMode confirm, a rejection, an unmatched `changeId`, a reconnect, a switch — is `null`. **Remember on confirm, not on pick**: a rejected level is not a level that was used, and this is the only seam where the confirmed *value* is recoverable, because the confirm reply carries only a `changeId` and the reducer deletes the pending record as it commits.
- `foldWriteEvent(deps, event): void` — reads the pending map, dispatches, then remembers. **The read must precede the dispatch** and that ordering is the whole helper; it gets its own named test. Deps are `{ getPending, dispatch, rememberEffort }`, injected, so the path stays unit-testable with plain spies (the file's existing idiom).
- `RunSettingsWriteData` swaps its inline `dispatch` arrow for a `foldWriteEvent` call wired to the two real stores. `subscribeRunSettingsWrite` itself is untouched.

Applying a remembered level is an ordinary change that confirms and re-remembers the same value — idempotent, not a loop.

### 3. `src/renderer/src/screens/conversation/EffortDefaultData.tsx` (new) — the decision and the moment

One file holding a pure decision function and the headless leaf that runs it — `ComposerEffortMenu.tsx`'s own shape (pure model function beside its React binding), so every rule is unit-testable as data under a `node` env that cannot run an effect.

```ts
export function effortDefaultToApply(input: EffortDefaultInput): string | null
```

`EffortDefaultInput` is `{ conversationId, appliedFor, sessionId, effort, model, models, remembered }`. It returns the level to apply, or `null`. The rules, in order:

1. `conversationId === null` → `null`. No chat is open, so there is no opening to apply to.
2. `remembered === null` → `null`. Nothing stored (AC4's first arm).
3. `appliedFor === conversationId` → `null`. **AC3's no-retry arm and the one-per-chat-opening rule, and they are the same rule.** `appliedFor` is the conversation id the leaf last applied for; once the default has been offered to a chat it is not offered again, whatever the outcome. See below for why this and not the standing-rejection cell.
4. `effort !== ''` → `null`. **The chat already answered the question this ticket exists to answer** (AC2) — and `effort` here is `selectEffectiveSettings`' composition, so an in-flight or already-confirmed apply also reads non-empty. Different fabric from rule 3: this is the store's composed truth about the session, that is the leaf's own record of what it did.
5. `!isAddressableSessionId(sessionId)` → `null`. Reused from `runSettingsControls`, never restated: `null` (never observed) and `''` (the daemon says it has no session to address) are both inert. `changeSetting` re-checks it downstream as its own gate; this rule is here so the decision is complete as data, not as a substitute for that gate. It is also what makes the window #1167 opens safe: a switch clears the session id, so between the clear and the new chat's reply this rule is what stops a default being written into the session the operator just left.
6. `effortRowFor(models, model)?.effort_levels ?? []` must **contain** the remembered level, by `Array.prototype.includes` — an equality scan, never an object keyed by daemon text. Levels are published per model, so a level carried over from one model may not exist for the next (AC4's second arm). No fallback list, no repair, no normalisation: #976 deleted the last client-side vocabulary and nothing here re-mints one. `?? []` guards the shape for `EffortSection`'s stated reason.

**Why rule 3 is a marker and not `runSettingsWriteStore.error`.** The obvious guard is "a standing effort rejection blocks the retry", and it is wrong: `changeDispatched` clears `error`, so an operator who picks a *model* after the default was refused clears the guard while the chat's effort is still `''` — and the refused level goes out again, once per unrelated setting change. That is reachable without a switch and violates AC3 as written. The marker has no such coupling: it records that this chat's opening has had its one attempt, and nothing on the write path can clear it.

`appliedFor` is an input rather than something the decision reads for itself, so every rule stays testable as data.

```tsx
export function EffortDefaultData({ conversationId }: { conversationId: string | null }): null
```

The leaf mirrors `ComposerEffortMenu`'s container reads (session id, snapshot, raw write state, the `useMemo`-stable per-conversation model-list selector) plus `selectLastEffort`, so it wakes on exactly the facts the decision reads, and holds `appliedFor` in a `useRef` — a value that must not trigger a re-render, and the leaf's own record rather than shared state. It renders `null` — no DOM node, so no footer count or geometry assertion anywhere in `e2e/` can see it.

**The effect resolves the current store state through `getState()` rather than closing over the render-time values.** `main.tsx` wraps the app in `React.StrictMode`, which double-invokes an effect against the *same* closure: a render-time `effort` of `''` would still read `''` on the second invocation even though the first already dispatched. The ref already closes that double-send (a ref survives StrictMode's simulated remount), and reading fresh state is the second, independent reason the same frame cannot go out twice — it is also what makes rule 4 true of the store rather than of a stale render. `RunSettingsWriteData`'s own `runSettingsWriteStore.getState()` idiom, for the same class of reason. The hooks stay as the *wake* signal; the effect body is the *read*.

The marker is set **before** the send, so a throw out of `sendCommand` cannot leave the chat eligible for a retry on the next tick.

**Why a separate leaf rather than an effect inside `ComposerEffortMenu`.** The menu is a display-and-pick control whose container is documented as reading no state of its own beyond what it draws; folding a write policy into it would fuse two unrelated concerns into one container and make the control's own tests answer for a decision they do not own. A `null`-rendering sibling costs four zustand subscriptions and no render.

### 4. `src/renderer/src/screens/conversation/ConversationScreen.tsx` (modified) — the mount

One import and one JSX line: `<EffortDefaultData conversationId={activeConversationId} />` beside `<ComposerEffortMenu />` in the composer footer, which is where `activeConversationId` is already in hand and where the leaf's lifetime is the open chat's.

## State + concurrency model

- **Stores touched:** `lastEffortStore` (new, global, one key); `runSettingsWriteStore` (read for `effort`/`error`, written through the existing `dispatch` only); `runConfigStore`, `sessionIdStore`, `modelListStore` read-only. No new store is conversation-keyed and none needs to be.
- **Unidirectional:** the leaf reads selectors and calls `changeSetting`; nothing two-way-binds. The preference store's only writer is `foldWriteEvent`, and its only reader is the decision.
- **Async:** none introduced. `changeSetting` is fire-and-forget over an already-typed IPC command; there is no promise to await, no timer, no subscription beyond the zustand ones React tears down with the leaf.
- **Cancellation / teardown:** the leaf's subscriptions are hook-owned and unmount with `ConversationScreen`; the effect starts nothing that outlives it, so it needs no cleanup function. `localStorage` access is synchronous.
- **Re-render seams:** the leaf renders `null`, so its own re-renders cost nothing and cascade nowhere. The raw write state is selected whole (stable identity between dispatches) exactly as `ComposerEffortMenu` does, never `selectEffectiveSettings` as the selector.

## Error handling

No new failure mode and no new result type. The apply rides the existing write path, so its two outcomes are the shipped ones: a confirm commits the override and re-remembers the same value; a rejection drops the pending marker, the label reverts through `selectEffectiveSettings`, `error` is set to `'effort'`, and rule 3 stops the retry. The footer says nothing further about it — the row has a hard 20px height and no slot for an error line, and the run-configuration sheet is where a rejection is named (#989's ruling, unchanged).

Nothing here throws. A missing `window` (the `node` render path) is answered by the port's guard; an absent model list, an unmatched row and an empty published list all collapse into rule 5's single "not usable" arm, which is a no-op and not an error.

**Logging:** none added, and that is deliberate rather than an omission. Every value on this path is either claude-authored text or a conversation-scoped identifier, and ADR 0007's content-free rule plus #989's "nothing on this path is logged at all" both point the same way; the observable evidence is the wire frame itself, which the e2e tiers assert.

## Testing strategy

**vitest (`node`, static renders only) — the whole decision surface:**

- `lastEffortStore.test.ts` — hydration from a populated port; hydration from an empty port (`null`); a stored `''` reads as `null`; `setLastEffort` persists **through the port** and then records (AC3's "a store built fresh from that same storage reports it" is asserted literally: write through store 1, construct store 2 over the same fake storage, read it back); the real port is a no-op with no `window`; the key string is pinned.
- `runSettingsWriteBridge.test.ts` (extended) — `confirmedEffortLevel` returns the value for a matching effort confirm; `null` for a model/yolo/permissionMode confirm, for a rejection, for an unmatched `changeId`, for `reconnected` / `conversationSwitched`, and for an empty value. `foldWriteEvent` dispatches exactly once for every event; remembers only on the effort confirm; and **reads the pending map before dispatching** — pinned with a spy whose `getPending` is asserted to have been called before `dispatch`, so a reordering that would read an already-deleted record fails.
- `EffortDefaultData.test.tsx` — `effortDefaultToApply` as a table: each of the six rules returning `null` in isolation, the one path returning the level, the empty-model row substitution reaching the `default` row's levels, a near-miss level (a published `xhigh` against a remembered `high`) returning `null`, and a `null` / `''` session id returning `null`. Plus a smoke render of the leaf proving it emits no markup.
- `EffortDefaultData.test.tsx`, the **send-loop** pins — the availability hazard this design introduces, so they are asserted against the **real** `runSettingsWriteStore` rather than a hand-built input, which pins the composition instead of my belief about it. Dispatch a `changeDispatched` for `{ field: 'effort' }` into a real store, compose `selectEffectiveSettings` over an `effort: ''` snapshot, feed that into the decision, and assert `null` (rule 4 holds the moment the send is recorded). Then confirm it and assert `null` again. Then, on a fresh store, dispatch → reject → assert the decision returns `null` **because of the marker**, and — the regression this pass found — that it still returns `null` after an unrelated `changeDispatched` for `{ field: 'model' }` has cleared `error`.

**Playwright, fake tier — `e2e/composer-effort-default.spec.ts` (new):** the two-chat drive, adapted from #1167's `run-config-scoped-to-conversation.spec.ts`. Levels are **invented**, mutually non-substring (the sibling specs' rule — seeding the measured five would put back the vocabulary #976 deleted and would let a client-side fallback pass unnoticed). One launch, one continuous drive:

1. Chat A opens (the fixture navigates by clicking the seeded row) and its `request_session_settings` is answered with a real effort and a model whose row publishes the levels. **AC2's assertion lands here**: zero `set_session_settings` frames have gone out, and the label reads A's own level — a chat that reports an effort of its own is left alone.
2. Pick a level in A through the real menu; the fake confirms it. That confirm is what writes the remembered level.
3. Mint chat B through the FAB's real create round trip. B's own `request_session_settings` is answered with `effort: ''` and the same model, and B's `model_list` is pushed.
4. **AC1's assertion**: exactly one `set_session_settings` deep-equal to `{ session_id: <B>, effort: <picked> }` — a frame count, which can only be non-zero if the apply fired, so it cannot pass vacuously — and the footer label reads that level on B before any message is sent.

Why a new file rather than a step on `composer-effort-menu.spec.ts`: that drive's whole premise is a chat that *reports* an effort, and every existing effort spec seeds one. A second chat reporting none is the shape, and the shape is what makes it its own file (#1167's own stated reason, one axis over).

**Playwright, real-claude tier — `e2e/real-claude-effort-default.spec.ts` (new), AC5.** The `real-*` filename is what partitions the tier, and the criterion is discharged by a `npm run e2e:real:gate` run reporting it **executed**, never by an exit code. Two real turns, `real-claude-permission-mode.spec.ts`'s budget and its cursor-quiesce turn gate:

1. Pair; create chat A through the FAB; send one message and let the turn quiesce, so a real session is resolved and addressable.
2. Open the run-configuration sheet and pick a level from the **published** segments — the sheet, not the footer, because the footer control draws nothing at `effort === ''` while `EffortSection` stays operable there. The level is read off what the daemon actually published; nothing is assumed.
3. Mint chat B through the FAB and send **nothing**. Assert the footer effort label reads the picked level. **This is AC5's "a level set on a chat before its first message"**, and it also proves the ticket's load-bearing wire premise — that a session is minted at conversation creation, so `set_session_settings` against a never-messaged conversation is addressable and persists (pyrycode#2085).
4. Send B's first message and let the turn quiesce. Assert the label still reads that level once the turn has ended — the daemon composed it into the child's launch arguments — and that **no `.bubble` in the thread contains `/effort`**, since a slash line would mean the value reached the turn stream instead.

Accepted limitation, stated rather than papered over (the sibling real specs' own): `runSettingsWriteStore.confirmed` outlives the post-turn re-read, so the final label is not *provably* snapshot-sourced. What the drive does prove is the failure this tier exists to catch — a daemon that refuses the level, or drops it for a never-messaged conversation, rejects or reports `''`, the override is never committed, and step 3 or step 4 reddens.

**Fakes over mocks** throughout: the fake storage port is an in-memory object, the daemon is the fake-tier forwarder, and `vi.fn()` appears only for the injected `foldWriteEvent` deps where call *ordering* is the assertion.

## Open questions

1. **Does AC3's "not applied again to that chat" survive a switch away and back, or a screen remount?** No: `appliedFor` holds one conversation id, so A → B → A makes A eligible again, and leaving the conversation screen for Settings and returning resets the ref. Both are re-*openings*, and the ticket words the guard as "one per chat opening" rather than one per chat ever — a durable per-chat memo would need a conversation-keyed store for a documented upstream asymmetry (the daemon refusing a level it published) that costs exactly one refused frame per opening, and each occurrence needs a fresh operator action. Recorded as the deliberate bound rather than the maximal one. To be re-checked in Phase B against the wired leaf; if the re-check changes the design, it lands as a `## Revisions` entry.
2. **Does the daemon's `session_settings` reply report a level set on a never-messaged conversation, or keep reporting `''` until the child spawns?** It changes nothing in the design — if it reports `''` the apply simply repeats the same value idempotently on a re-open — but it decides whether step 3 of the real-claude drive can also assert the *sheet's* re-read. Resolve while writing that spec; assert only what holds either way.
3. **Is `.composer__effort-label` mounted on chat B before its `model_list` arrives?** No — rule 5 needs the levels, so the apply waits for the list. The fake spec must therefore push B's list before polling the frame count, and must not assert a pre-apply absence (an opening `toHaveCount(0)` there would be the vacuous-pass trap). Confirm the ordering when the drive is written.

## Security review

**Verdict:** PASS (first pass returned FAIL on one MUST FIX; the Design section above is the revision)

**Findings:**

- **[Trust boundaries] No findings.** This design adds exactly one boundary — renderer `localStorage` → memory — and it is a single named site, `effortDefaultToApply`'s membership rule, not a check scattered across callers. Its guarantee is strong rather than structural: the remembered string can only leave the decision if it is byte-identical to a level the daemon *itself* published for this chat's model, so the only values that reach `changeSetting` or the wire are values the daemon just minted. It also never reaches a render sink as itself — it becomes the pending overlay, so it renders through `.composer__effort-label` under the same React escaping and the same client-owned 64px bound a live level does. The daemon-side boundary is unmoved: `effort_levels` is still unsanitized text and this ticket adds no new sink for it.
- **[Trust boundaries] No findings — cross-chat write.** The sharp hazard on this path is writing a default into the session the operator just navigated away from (the one `runConfigSnapshot.ts` names). It is closed by rule 5 over #1167's clear: a switch nulls the session id, so between the clear and the new chat's reply the decision is inert; #1176's attribution gate means the reply that refills it describes the open chat and no other.
- **[Tokens, secrets, credentials] N/A by construction.** No token, key, credential or lifecycle exists on this path. What is persisted is a published effort level — the same class of non-secret UX preference as `pyry.defaultWorkspace` and `pyry.pushNotificationsEnabled`, and the reason `localStorage` is the right store here and would not be for a device token. Nothing on this path is minted, rotated, revoked or compared against a secret.
- **[File / storage operations] No findings, and one decision worth naming.** No filesystem path, no `path.join`, no check-then-open, no partial-write window (a `localStorage` set is atomic per key). The key is a **client-owned constant literal** and the ticket's "one remembered level app-wide" ruling is what keeps it one: a per-model or per-chat key would have composed claude-authored text into a storage key, and that shape is declined rather than merely unused. The remembered value is likewise never a plain-object key — the only structure it meets is an array scanned by `includes`, so the `__proto__`-as-key hazard does not arise.
- **[Inter-process / Electron attack surface] N/A by construction.** No new `contextBridge` API, no new `ipcMain` channel, no new `BrowserWindow`, no protocol handler, no navigation. The send rides the existing `setSessionSettings` command through the existing `buildSettingsPayload`, adding no field, so the main-side guard is unchanged and the renderer gains **no capability it did not already have**. Nothing moves toward the renderer: no key, no socket, no raw frame.
- **[Cryptographic primitives] N/A by construction.** No randomness, no hashing, no comparison against a secret. The `changeId` mint stays `crypto.randomUUID()` inside `submitSettingsChange`, untouched.
- **[Network & I/O] MUST FIX — fixed in the plan before commit.** The one availability hazard this design introduces is a self-inflicted write loop against the daemon over the relay: "empty effort ⇒ apply" re-arms itself every time a rejection drops the pending record. The first draft guarded it with `runSettingsWriteStore.error`, and that guard is clearable — `changeDispatched` resets `error`, so an operator picking a *model* after the default was refused re-arms the apply while the chat's effort is still `''`, and the refused level goes out again, once per unrelated setting change. Reachable with no switch and a straight violation of AC3. **Fixed** by replacing it with the leaf's own `appliedFor` marker (Design rule 3), which nothing on the write path can clear, and pinned by a named test that dispatches an unrelated model change after a rejection and asserts the decision still refuses. Both remaining guards are deterministic code — a store composition and a ref — not a stochastic rule. No new socket, frame type or size limit is in scope.
- **[Error messages, logs, telemetry] No findings.** Nothing on this path logs, and that is the decision rather than an omission: the value is claude-authored text and ADR 0007's content-free rule plus #989's "nothing on this path is logged at all" agree. No error message, thrown error or renderer-console write carries the level, the session id or the conversation id. The e2e specs' levels are invented non-secret literals, so no failure diagnostic serialises anything real.
- **[Concurrency] No findings.** The effect is fully synchronous — no `await`, so there is no check-then-act gap for a concurrent handler to slip into, and `changeSetting`'s record-before-send makes the guard true before control returns. It launches nothing long-lived: no timer, no listener, no promise, so it owes no cleanup and can leak nothing past the conversation screen's unmount. `React.StrictMode`'s double-invoke is closed twice over — the ref survives the simulated remount, and the effect re-reads store state through `getState()` instead of the render-time closure — which is also why a duplicate mount would net one send rather than two.
- **[Threat model — malicious / compromised relay] No findings.** On-path and content-blind. Dropping the confirm means nothing is remembered, which is correct by design (remember on confirm, not on pick). Replaying a confirm is closed by the shipped correlation: an unmatched `changeId` is a reducer no-op and `confirmedEffortLevel` returns `null` on the same miss, so a replayed ack can neither commit an override nor re-write the preference.
- **[Threat model — hostile daemon response] Recorded decision, no fix.** A hostile or buggy daemon could publish an oversized or control-byte-bearing level, have it confirmed, and get it persisted — so the one genuinely new property is that such a string now survives a restart instead of dying with the process. The blast radius does not grow with the persistence: to be re-applied it must still appear in that chat's published levels, and it renders through the same escaped, ellipsized, 64px-bounded label as a live one. No length bound is added at the port, because the render bound already exists and shipping a defense for an unobserved failure mode is Evidence-Based Fix Selection's anti-pattern; if it surfaces, the fix is localized to `localStorageLastEffortPref`.
- **[Threat model — renderer compromise / token theft from disk] N/A by construction.** The renderer still reaches the transport only through already-typed commands, and the `userData` localStorage file gains one non-secret preference and no credential.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06
