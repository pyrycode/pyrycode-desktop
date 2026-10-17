# #2089 — unpairing an unreachable saved host after restart hangs Electron

## Files read

- `src/renderer/src/store/threadRuntime.ts` → `createThreadRuntime`, `live`, `removeHost`, the `subscribeChatHistoryRemoval` subscription, `handle` (`connected`): the cleanup owner where the hang happens.
- `src/renderer/src/store/threadLiveState.ts` → `createThreadLiveState` `dispatch({ type: 'dispose' })`: dispose always `set`s a new state, so every dispose notifies subscribers.
- `src/renderer/src/store/appBadgeBridge.ts` → `subscribeToAttentionStores`, `attentionCountNow`, `conversationStatusNow`: a `runtime.state` subscriber that calls `threadRuntime.live(serverId, id)` for every listed row.
- `src/renderer/src/store/threadLiveProjection.ts` → `connectThreadLiveProjection.sync`: a second `runtime.state` subscriber that calls `runtime.live` for the active row.
- `src/renderer/src/screens/settings/unpairServerAction.ts` → `runUnpairServer`: settles history removal (which runs `removeHost`) before `refreshServers` and `clearServerScopedState`, so the departed rows are still listed while `removeHost` runs. That ordering is kept.
- `src/renderer/src/store/chatHistoryRemoval.ts` → `beginChatHistoryRemoval`; `src/renderer/src/store/chatHistoryWriter.ts` → removal subscriber (unchanged).
- `src/renderer/src/clearServerScopedState.ts`, `src/renderer/src/screens/channels/EditHostDialog.tsx` → `runEditHostUnpair`, `src/main/unpairHandler.ts`, `src/main/chatHistoryHandler.ts` → `clearServer`: traced, unchanged.
- `src/renderer/src/store/threadRuntime.test.ts` → the `successful removal …` case: the pattern the new unit case sits beside.
- `e2e/sidebar-pinned.spec.ts` → the skipped `blocked on #2089 — …` reproduction; `e2e/fixtures/launchPairedApp.ts` → `reuseUserDataDir`.
- `docs/knowledge/features/thread-runtime.md` § Restore, recovery and cleanup.

## Design source

The ticket links the existing Edit host dialog (Figma node 487-2078). This fix makes no visual change: the dialog, its Unpair/Confirm controls and the sidebar keep their current design. No visual fidelity check applies. The Figma connector is not authorised in this run, and that doesn't block the work, because nothing visual is being built.

## Context

**Diagnosis (reproduced on main `ea4ff90f`, Linux x86_64).** I un-skipped the reproduction: 1 executed, 0 passed. Confirm's click completed, then Playwright waited on "scheduled navigations" for 30 s, and the worker teardown timed out. A CDP `Debugger.pause` taken while it hung landed every time in `removeHost` → `runUnpairServer`, on the `for (const [id, store] of lives)` loop.

The mechanism:

1. `removeHost(host)` iterates the `lives` Map and, for each departed key, calls `dispatch({ type: 'dispose' })` and only then `lives.delete(id)`.
2. Dispose sets new state. The store's subscriber in `live` bumps `runtime.state.liveRevision`.
3. That synchronously runs the `runtime.state` subscribers. The badge bridge's `attentionCountNow` calls `threadRuntime.live(host, id)` for every row still in `conversationListStore`, and those still include the departed host's rows, because `clearServerScopedState` runs later.
4. With two or more departed rows (Alpha, Gamma), disposing Gamma recreates the Alpha key that was just deleted. A `Map` iterator visits entries inserted during iteration, so it reaches the new Alpha, disposes it, which recreates Gamma, and so on forever on the renderer's main thread. With one departed row the key still exists during its own dispose, so `live` returns it and nothing is recreated. That is why the simpler baseline passed.

Persistence, main and IPC do no wrong here; the loop is purely renderer-local. An ADR is not needed.

## Design

Both changes are inside `createThreadRuntime`:

- **Snapshot, then dispose.** `removeHost` collects the departed `[id, store]` entries, deletes them all from `lives`, then disposes each collected store. Callbacks triggered by a dispose can no longer extend the iteration.
- **Departed-host fence.** A runtime-private `departed: Set<string>` gets the host when `removeHost` runs. While a host is departed, `live(host, chat)` returns one shared inert store and never registers it in `lives`: it is created once per runtime, already disposed, has `binding: null` and empty readings, and its dispatch is a no-op, so it never notifies. Delayed readers (badge recount, projection sync, a sidebar row still rendering before `clearServerScopedState`) therefore cannot recreate the departed host's live state.
- **Identity reuse.** The fence lifts in `handle` on a `connected` event for that host, before linking. A re-paired host with the same server ID is live again only once it has a new connection. `connecting`, `disconnected` and `failed` from the old supervisor never lift it. `dispose()` clears the set.

The name `departed` avoids the `retire` helper that in-flight #2079 adds to the same file. #2079 touches `threadRuntime.ts` and its test, so a later merge may touch those files. My edits there are additive.

No exported type, component or store is added. `live`'s signature is unchanged.

## State + concurrency model

Everything runs synchronously on the renderer thread. `removeHost` is reached only through the history-removal settlement with `removed === true`. The fence is plain runtime-local state, with no timers or async tasks. Teardown happens through the existing `dispose()`.

## State transitions and identity reuse

| Event | Covered by |
|---|---|
| Removal of a host with ≥2 live rows while a `runtime.state` subscriber reads `live()` for those rows (the hang) | vitest `threadRuntime.test.ts` "removal of a host … terminates and cannot be recreated by delayed readers" |
| Delayed `live(departed, id)` after removal returns an unregistered, inert store; departed IDs equal to another host's keep that host's store | same vitest case (asserts the other host's store identity and binding survive) |
| Failed removal (`removed === false`) retains the stores | same vitest case |
| Same server ID reconnecting (`connected`) after removal gets a registered store again | same vitest case, plus the existing "successful removal …" case |
| Old supervisor `disconnected`/`connecting` after removal does not lift the fence | same vitest case |
| Saved-profile relaunch → unpair first host → relaunch again unseeded | Playwright `e2e/unpair-unreachable-host.spec.ts` |

## Error handling

No new failure modes. A failed unpair still settles `removed === false`. `removeHost` doesn't run, the fence isn't set and the existing `unpair-failed` dialog state is unchanged.

## Testing strategy

- **vitest**, in `threadRuntime.test.ts`: a runtime from `createThreadRuntime` with live stores for host `one` (`alpha`, `gamma`) and host `two` (`alpha`, an equal ID), and a `runtime.state` subscriber that, like the badge, calls `live()` for all four rows and throws after a call budget so a regression fails fast instead of hanging. Scenarios: removal false keeps identities; removal true terminates, disposes the departed stores, keeps host `two`'s store identical and bound; a later `live('one', …)` returns an inert store not equal to the old one and stable across calls; `disconnected` keeps the fence; `connected` gives a new registered store, the same object across two calls.
- **Playwright**: a new `e2e/unpair-unreachable-host.spec.ts`. It carries over the exact skipped reproduction (two hosts, equal IDs, Beta selected, Alpha+Gamma list, both lists observed stored via `readList`, second leg closed 4401 with the failed host seen, quit, servers closed, unseeded relaunch). Then it adds: Confirm within the default action timeout; the dialog closes; rows are `['Beta']` and one host remains; the Beta row is clickable and becomes current; `readList` for the first host is not `stored` while the second still is, which shows IPC is responsive; quit; a second unseeded relaunch shows only `['Beta']` and one host. Normal fixture teardown, default timeouts. The skipped copy in `e2e/sidebar-pinned.spec.ts` is removed, so no `blocked on #2089` skip remains.
- Failing-before evidence: the new spec run against unfixed code (before the production edit), and the un-skipped original on main.

## Open Questions

- Whether any other `runtime.state` subscriber on the unpair path loops after the fix. Settle this by running the Playwright spec with the fix.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. No new IPC channel, preload API or argument is added. The unpair request still crosses only through `registerUnpairServerHandler`, whose first statement is the `isUnpairServerRequest` guard. The fence is keyed by the client-held server ID already used as the runtime's `key`, never by daemon text.
- [Tokens, secrets, credentials] No findings. Credential erasure stays in main (`chatHistoryHandler.clearServer` → `MultiPairedServerStore.clearServer`, in the shared admission queue) and its order is unchanged. The renderer change touches no token, key or record. The fix makes the credential lifecycle more reliable: before it, the renderer hung after main had already erased the credential, and the window could no longer show the result.
- [File and storage operations] No findings. No path, file or storage write is added. Saved-content removal stays main's `removeServer` under the existing generation fences. The e2e relaunch shows removed rows don't return.
- [Electron attack surface] No findings. `webPreferences`, navigation and the bridge are untouched. The Playwright spec's `page.evaluate` only uses the existing `window.pyry.chatHistory` `readList`.
- [Cryptographic primitives] No findings. Nothing in the Noise path, the relay or randomness is touched.
- [Network and I/O] No findings. Supervisor teardown on unpair (`onUnpaired`) is unchanged. A late `connecting`/`disconnected` from the old supervisor is handled by the rule that only `connected` lifts the fence.
- [Errors, logs, telemetry] No findings. No new log line. Existing `thread-live-state disposed` events stay content-free (static codes). The inert store is created with no logger, so delayed reads emit nothing.
- [Concurrency] SHOULD FIX, handled in this design. The root cause is a re-entrancy hazard: synchronous subscriber callbacks mutate the collection being iterated. Phase B must snapshot before disposing, and the vitest case must use a call budget so any reintroduced re-entrancy fails rather than hangs. A late `connected` IPC from the departing connection arrives before the unpair reply on the same ordered channel, so it cannot lift a fence set afterwards.
- [Threat model alignment] No findings. A hostile relay or daemon cannot trigger `removeHost`, which only explicit user unpair publishes (`beginChatHistoryRemoval`). Before the fix, a renderer hang was a local denial of service needing ≥2 saved rows on the unpaired host and no attacker; fixing it removes that. Out of scope: fresh provider, daemon or real-relay behaviour, which fake transport doesn't establish (refiner note).

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-17
