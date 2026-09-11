# Daemon-event bridge (renderer)

The **renderer translation half** of the background→window bridge: a pure function that maps each typed daemon event to a session-store action, and a thin React hook that pipes the [daemon-event channel](daemon-event-channel.md) into the [session store](session-store.md). It is the connective tissue that lets the window render connection status and streamed messages from the store alone — the seam the store's own doc-comment reserves (*"translates daemon envelopes into the SessionActions dispatched here"*).

Introduced in [#19](../codebase/19.md). Lives at `src/renderer/src/store/daemonEventBridge.ts`, beside the session store. It consumes what #18 (the `DaemonEvent` union + `window.pyry.onDaemonEvent`) and #2 (`SessionAction` + the app-singleton `sessionStore`) already export, and touches nothing in `src/main` or `src/preload`. No transport is wired yet — nothing emits on the channel — but the receive-and-dispatch path is now complete end to end.

[#168](../codebase/168.md) widened `translateDaemonEvent`'s return type to `SessionAction | null` to tolerate three new `DaemonEvent` members (`debugBundleProgress`/`debugBundleSaved`/`debugBundleFailed`) that drive **no** session-store action — see § Tolerating events with no store action below. At the time this was the **only** exhaustive `DaemonEvent` consumer, so it was the one file any additive `DaemonEvent` change was forced to touch. That stopped being true once [#202](../codebase/202.md) shipped a second exhaustive switch ([conversation timeline store](conversation-timeline-store.md)'s `timelineBridge`) and [#223](../codebase/223.md) a third ([modal store + bridge](modal-store-bridge.md)'s `modalBridge`) — see below; a new `DaemonEvent` member now forces a case in all three.

[#180](../codebase/180.md) (the [screen snapshot fetch](screen-snapshot-fetch.md)) added a fourth
no-store-action member, `snapshotReceived`, and is the concrete case study for that forced touch: the
ticket's own spec claimed "the renderer needs zero change," which held for the generic preload
channels but not for this exhaustive switch — see its "Lessons learned" in [#180 codebase
notes](../codebase/180.md). [#187](../codebase/187.md) landed the consumer this arm was reserved for
— see [Run configuration store](run-config-store.md). That consumer moved onto the dedicated
`runConfigReceived` arm at #491/#500, and [#621](../codebase/621.md) removed `snapshotReceived`
itself (and `screenSnapshotReceived`, below) once both were unconsumed — this `case` no longer
appears in `translateDaemonEvent`, though the exhaustive switch it forced remains the same shape.

[#199](../codebase/199.md) added a fifth and sixth no-store-action member, `assistantDelta` /
`turnEnd` — the transport slice of the structured-stream render vertical. Unlike `snapshotReceived`,
both carry real content (`text` is the render payload) across IPC; this bridge still maps them to
`null` because their consumer is the renderer *timeline* bridge, [#202](../codebase/202.md)'s
[conversation timeline store](conversation-timeline-store.md) — a second, independent
`assertNever`-guarded switch over the same `DaemonEvent` union that owns exactly these two arms and
returns `null` for the rest, the mirror image of this file's switch.

[#139](../codebase/139.md) added a seventh no-store-action member, `conversationsReceived` — the
[conversation list fetch](conversation-list-fetch.md) feature's reply. Like `assistantDelta`/
`turnEnd`, it carries real content (the full `ConversationSummary[]`) across IPC unminimised; this
bridge still maps it to `null` because its consumer is the conversation-list store
[#208](https://github.com/pyrycode/pyrycode-desktop/issues/208), not the session store.

[#214](../codebase/214.md) added an eighth no-store-action member, `turnState` — the coarse
turn-lifecycle scalar of the same v2 stream `assistantDelta`/`turnEnd` belong to. Like those two, its
consumer is the [conversation timeline store](conversation-timeline-store.md)'s bridge, not the
session store; this file's `translateDaemonEvent` still just returns `null`. First `DaemonEvent` arm
added since [#202](../codebase/202.md) shipped the timeline bridge, so it is also the first arm this
bridge and that one both had to add a case for at once.

[#217](../codebase/217.md) added a ninth no-store-action member, `toolUse` — the tool-call enrichment
of the same v2 stream. Joins the `assistantDelta`/`turnEnd`/`turnState` fall-through group; its
consumer is the [conversation timeline store](conversation-timeline-store.md)'s bridge (the fourth arm
that bridge owns), not the session store. The second `DaemonEvent` arm forcing a case in both
`assertNever`-guarded switches at once, confirming the pattern #214 established holds for a second load.

[#201](../codebase/201.md) added a tenth and eleventh no-store-action member, `modalShown` /
`modalDismissed` — the transport slice of the [modal-prompt model](modal-prompt-model.md) vertical
(ADR 0009). Unlike every arm above, **neither existing bridge owns these** — the [conversation timeline
store](conversation-timeline-store.md)'s bridge also maps them to `null` (added to its inverse-filter
list, not its owned block); the real consumer is a **third**, independent [modal store +
bridge](modal-store-bridge.md), shipped in [#223](../codebase/223.md). The third `DaemonEvent` arm
addition forcing a case in both `assertNever`-guarded switches at once.

[#229](../codebase/229.md) added a twelfth no-store-action member, `toolResult` — the outcome half of
`toolUse` (#217), the last transport slice of the structured-stream vertical. Joins the
`assistantDelta`/`turnEnd`/`turnState`/`toolUse` fall-through group; its consumer is the [conversation
timeline store](conversation-timeline-store.md)'s bridge (the fifth arm that bridge owns — the first to
**resolve** an existing `ThreadItem` rather than append one or set a scalar), not the session store. By
this point [modal store + bridge](modal-store-bridge.md)'s `modalBridge.ts` ([#223](../codebase/223.md))
also existed, so this is the first arm to force a case in **three** independent `assertNever`-guarded
switches at once, not two — a cost the #229 spec's scope self-check (written before #223 merged)
undercounted by one file; see [#229 codebase notes](../codebase/229.md) § Lessons learned.

[#241](../codebase/241.md) added a thirteenth no-store-action member, `conversationCreated` — the
[conversation create](conversation-create.md) feature's reply, the write-side twin of
`conversationsReceived` (#139). Consumed by **neither** existing bridge; the real consumer is the
render sibling [#242](https://github.com/pyrycode/pyrycode-desktop/issues/242) (blocked on this
ticket), not the session store, the timeline store, or the modal store. The second arm (after
`toolResult`) to force a case in all three exhaustive `assertNever`-guarded switches at once — now the
steady-state cost of any new `DaemonEvent` member.

[#254](../codebase/254.md) added a fourteenth no-store-action member, `sessionTransition` — the
session-boundary marker's addressing id (`newSessionId`), content-minimised at the emit (the other four
decoded wire fields are dropped there, not here). Consumed by **none** of the three existing bridges;
the real consumer is a not-yet-built renderer holder,
[#259](https://github.com/pyrycode/pyrycode-desktop/issues/259) (blocked on this ticket). The third arm
to force a case in all three exhaustive `assertNever`-guarded switches at once.

[#264](../codebase/264.md) added a sixteenth no-store-action member, `sessionSettingsUpdated` — the
`set_session_settings` (#263) confirmation reply's addressing id, widened with a `changeId` correlation
key by [#261](../codebase/261.md). [#269](../codebase/269.md) added a seventeenth,
`sessionSettingsRejected{changeId}`, the rejected twin sharing the same `daemon-error` wire trigger as
`modalAnswerRejected` but a different, precise per-request attribution (`pendingSettings` lookup by
`Envelope.in_reply_to`, not a FIFO). Both are consumed by **none** of the three existing bridges; their
real consumer, [#256](../codebase/256.md)'s [Run configuration write store](run-settings-write-store.md),
has since shipped as a **fourth, independent** subscriber on this same channel — not a change to any of
the three bridges below. Unlike `sessionTransition`, which content-minimises a five-field decode,
`sessionSettingsUpdated` is minimal because the decoded wire payload itself has only one field — nothing
is dropped anywhere in the chain.

[#315](../codebase/315.md) added an eighteenth no-store-action member, `stallDetected` — the daemon's
onset-only `stall` liveness signal on the same v2 stream `turnState`/`toolUse` belong to. Joins the
`assistantDelta`/`turnEnd`/`turnState`/`toolUse`/`toolResult` fall-through group; its consumer is the
[conversation timeline store](conversation-timeline-store.md)'s bridge, not the session store — the
fourth arm to force a case in all three exhaustive `assertNever`-guarded switches at once. At ship
time, unlike every prior member, it was **nullary**: `StallPayload`'s one field (`conversation_id`)
was dropped at the emit, so this bridge's `null`-returning case discarded a literal that already
carried nothing. [#732](../codebase/732.md) widened it with `conversationId`; this bridge's case is
still `null`-returning, so it now discards a daemon-asserted routing key rather than nothing, and
that id reaches no sink here.

[#316](../codebase/316.md) added a nineteenth no-store-action member, `screenSnapshotReceived` — a
**deliberate widening**, carrying the rendered-screen `text`/`ts` that `snapshotReceived`
([#180](../codebase/180.md)) deliberately excluded, once the display slice
[#324](../codebase/324.md) needed it. Emitted from the same `case 'snapshot'` seam as
`snapshotReceived`, so one decoded frame fired both events. Consumed by **none** of the three
existing bridges; this bridge's `null`-returning case
discarded a real, non-trivial payload (unlike `stallDetected`'s literal, nullary at the time) — the fifth arm to
force a case in all three exhaustive `assertNever`-guarded switches at once, after
`toolResult`/`conversationCreated`/`sessionTransition`/`stallDetected`. **Both `snapshotReceived` and
`screenSnapshotReceived` were removed by [#621](../codebase/621.md)**, along with the `case` each
forced in this file — the exhaustive switch shrank back by one no-op arm, and the `assertNever`
default still terminates it.

[#492](../codebase/492.md) added a further no-store-action member, `apiRetry` — `stallDetected`'s peer on
the same v2 stream, but **not** nullary: it carries `active`/`current`/`total` (`conversation_id` dropped
at the emit), because the render slice #493 needs to show "attempt N/M" and the wire gives it nowhere
else. Unlike `stallDetected`, the daemon frame is **not** onset-only (an explicit `active: false` falling
edge) and **not** deduped (the rising edge re-fires as the count climbs) — the transport holds no state,
so N daemon frames produce N events. Consumed by **none** of the three existing bridges; this bridge's
`null`-returning case discards a real, non-trivial payload (the `screenSnapshotReceived` posture, not
`stallDetected`'s already-empty one) — a further arm to force a case in all three exhaustive
`assertNever`-guarded switches at once. This bridge (the session store) still nulls it; the
[conversation timeline store](conversation-timeline-store.md)'s bridge has since claimed it as a
seventh owned arm, feeding the render slice #493 reads ([#493](../codebase/493.md), see below).

[#328](../codebase/328.md) added a twentieth no-store-action member, `relayLinkChanged` — the
relay-**socket** leg's classified link category (`RelayLinkStatus`), distinct from this bridge's
own combined session status. Content-free by construction (no token, key, frame, or raw close
code — only the category crosses IPC). Consumed by **none** of the three existing bridges; unlike
every prior no-store-action member, its real consumer is a **new, fourth independent** subscriber
purpose-built for it — the [relay-link store](relay-link-store.md)'s own `RelayLinkData` bridge
([#329](../codebase/329.md)), not any of the three switches below. The sixth arm to force a case in
all three exhaustive `assertNever`-guarded switches at once.

[#495](../codebase/495.md) added a further no-store-action member, `compacting` — `apiRetry`'s peer on the
same v2 stream, but **banner-only**: it carries only `active` (`conversation_id` dropped at the emit),
since the wire streams no compaction progress for a render slice to carry a counter from. Like `apiRetry`,
the daemon frame is **not** onset-only and **not** deduped. Consumed by **none** of the three existing
bridges; this bridge's `null`-returning case discards a real (if minimal) payload — a further arm to force
a case in all three exhaustive `assertNever`-guarded switches at once. The render slice #496 is the first
consumer.

[#564](../codebase/564.md) added a further no-store-action member, `backgroundTaskStarted` — the first of
three sibling frames (#565/#566 follow) reporting claude work that outlives the turn that spawned it
(pyrycode#1240). Unlike `apiRetry`/`compacting`, it **keeps** `conversationId` rather than dropping it —
the frame carries no `turn_id` and opens/closes no turn, so it is daemon state (the `queueState` #292/#720
rule), not a turn-stream item. Carries five strings plus a nullable string array (`toolCallId`,
`description`, `taskType`, `truncatedFields`), the widest payload since `modalShown`. Consumed by **none**
of the three existing bridges; this bridge's `null`-returning case discards a real, non-trivial payload — a
further arm to force a case in all three exhaustive `assertNever`-guarded switches at once. [The
background-task-roster store (#573, shipped)](../codebase/573.md) is now live, but it consumes only the
`backgroundTaskRoster` arm below — this `backgroundTaskStarted` arm stays dormant here, awaiting #574.

## What it does

Turns each `DaemonEvent` arriving from the background process into the matching `SessionAction` (or `null`, for events the session store doesn't model) and dispatches non-null results into the one store the UI reads. Two exported symbols:

- **`translateDaemonEvent(event: DaemonEvent): SessionAction | null`** — the pure choke point. Total by construction over the sealed union; `null` is a real, non-error return value for events with no store-side effect.
- **`useDaemonEventBridge(): void`** — the only production caller. A side-effecting binding that subscribes on mount, dispatches translated actions into `sessionStore` (skipping `null`), and unsubscribes on unmount.

## How it works

### 1. The pure translation (`translateDaemonEvent`)

A `switch (event.type)` over all forty-two `DaemonEvent` arms with a `default: return assertNever(event)` exhaustiveness guard (a module-local 3-line copy of `sessionStore.ts`'s pattern — kept local rather than widening the store's public surface).

| `DaemonEvent` arm | `SessionAction` produced | conversion |
|---|---|---|
| `connecting` | `{ type: 'connecting', serverId: originOf(event) }` | — |
| `connected` | `{ type: 'connected', ack, serverId: originOf(event) }` | `HelloAckPayload` passed **by reference** |
| `disconnected` | `{ type: 'disconnected', serverId: originOf(event) }` | — |
| `failed` | `{ type: 'failed', error: { code, message, retryable }, serverId: originOf(event) }` | **explicit three-field copy** of the wire `ErrorPayload` into a fresh store-owned `ConnectionError` |
| `messageReceived` | `{ type: 'messageReceived', message }` | `MessagePayload` passed **by reference** |
| `messagesReceived` | `{ type: 'messagesReceived', messages }` | `readonly MessagePayload[]` passed **by reference** |
| `debugBundleProgress` | `null` | consumed by the download UI (#72), not the session store |
| `debugBundleSaved` | `null` | consumed by the download UI (#72), not the session store |
| `debugBundleFailed` | `null` | consumed by the download UI (#72), not the session store |
| `runConfigReceived` | `null` | consumed by the [Run configuration store](run-config-store.md)'s data path (#491/#500, superseding #187's original `snapshotReceived` consumer), not the session store |
| `assistantDelta` | `null` | consumed by the [conversation timeline store](conversation-timeline-store.md)'s bridge (#202), not the session store — present only for exhaustiveness (#199) |
| `turnEnd` | `null` | consumed by the [conversation timeline store](conversation-timeline-store.md)'s bridge (#202), not the session store — present only for exhaustiveness (#199) |
| `conversationsReceived` | `null` | consumed by the conversation-list store (#208), not the session store — present only for exhaustiveness (#139) |
| `turnState` | `null` | consumed by the [conversation timeline store](conversation-timeline-store.md)'s bridge (#202), not the session store — present only for exhaustiveness (#214) |
| `stallDetected` | `null` | consumed by the [conversation timeline store](conversation-timeline-store.md)'s bridge (a sixth owned arm as of [#317](../codebase/317.md)), not the session store — present only for exhaustiveness (#315) |
| `apiRetry` | `null` | consumed by the [conversation timeline store](conversation-timeline-store.md)'s bridge (a seventh owned arm as of [#493](../codebase/493.md)), not the session store — present only for exhaustiveness (#492) |
| `toolUse` | `null` | consumed by the [conversation timeline store](conversation-timeline-store.md)'s bridge (#202), not the session store — present only for exhaustiveness (#217) |
| `modalShown` | `null` | consumed by neither existing bridge; the real consumer is the third, independent [modal store + bridge](modal-store-bridge.md) (#223, shipped) — present only for exhaustiveness (#201) |
| `modalDismissed` | `null` | consumed by neither existing bridge; the real consumer is the third, independent [modal store + bridge](modal-store-bridge.md) (#223, shipped) — present only for exhaustiveness (#201) |
| `questionShown` | `null` | consumed by none of the three existing bridges; the real consumer is a fourth, independent question store + bridge ([#850](https://github.com/pyrycode/pyrycode-desktop/issues/850), open) — **permanently** for exhaustiveness ([#885](https://github.com/pyrycode/pyrycode-desktop/issues/885)), not dormant: unlike `stallDetected`/`apiRetry`/`compacting`/`connected`, this arm's own consumer is never a case in this file |
| `questionDismissed` | `null` | consumed by none of the three existing bridges; the real consumer is the same fourth, independent question store + bridge as its sibling above ([#850](https://github.com/pyrycode/pyrycode-desktop/issues/850), open) — **permanently** for exhaustiveness ([#895](https://github.com/pyrycode/pyrycode-desktop/issues/895)), not dormant. Own case rather than folded into `questionShown`'s, each with its own comment naming the unguessable `questionBatchId` at risk if `assertNever`'s stringified-event throw ever fired for this arm |
| `toolResult` | `null` | consumed by the [conversation timeline store](conversation-timeline-store.md)'s bridge (#202), not the session store — present only for exhaustiveness (#229) |
| `conversationCreated` | `null` | consumed by neither existing bridge; the real consumer is the render sibling #242 — present only for exhaustiveness (#241) |
| `sessionTransition` | `null` | consumed by none of the three existing bridges; the real consumer is the renderer holder #259 — present only for exhaustiveness (#254) |
| `sessionSettingsUpdated` | `null` | consumed by none of the three existing bridges; the real consumer is [#256](../codebase/256.md)'s [write store](run-settings-write-store.md) (shipped) — present only for exhaustiveness (#264, correlation widened by #261) |
| `sessionSettingsRejected` | `null` | consumed by none of the three existing bridges; the real consumer is [#256](../codebase/256.md)'s [write store](run-settings-write-store.md) (shipped) — present only for exhaustiveness (#269) |
| `relayLinkChanged` | `null` | consumed by none of the three existing bridges; the real consumer is the [relay-link store](relay-link-store.md)'s own bridge (#329, shipped) — present only for exhaustiveness (#328) |
| `backgroundTaskStarted` | `null` | consumed by none of the three existing bridges; present only for exhaustiveness (#564). Ships dormant — [the roster store (#573, shipped)](../codebase/573.md) consumes only `backgroundTaskRoster`, not this arm; awaiting #574. First of three sibling frame arms (#565/#566 follow) |
| `thinkingProgress` | `null` | consumed by none of the three existing bridges; the session store has no thinking state at all — present only for exhaustiveness ([#1313](https://github.com/pyrycode/pyrycode-desktop/issues/1313), decoded at [#1312](https://github.com/pyrycode/pyrycode-desktop/issues/1312)). **Permanently** null here, on the `questionShown` grounds rather than `stallDetected`'s: the arm is a mid-turn reading with no rising and no falling edge, so there is no status scalar here for it to ever flip. See [Daemon event channel — the sealed union: per-member history (recent members)](daemon-event-channel-sealed-union-history-recent.md) for the full per-field rationale |
| `rateLimited` | `null` | consumed by none of the four exhaustive bridges; the session store has no usage-limit state — present only for exhaustiveness ([#1319](https://github.com/pyrycode/pyrycode-desktop/issues/1319), decoded at [#1318](https://github.com/pyrycode/pyrycode-desktop/issues/1318)). **Permanently** null here, the `thinkingProgress` grounds sharpened: folding a quota reading into this store's *connection*-status scalar would be exactly the "you are blocked" overclaim the wire names as the realistic client bug, since the one measured non-benign status is a warning band in which every turn still ran normally. Shipped — the real consumer is the [usage-limit store](usage-limit-store.md)'s own independent bridge ([#1320](https://github.com/pyrycode/pyrycode-desktop/issues/1320)), not `timelineBridge`. See [Daemon event channel — the sealed union: per-member history (recent members)](daemon-event-channel-sealed-union-history-recent.md) for the full per-field rationale |

`DaemonEvent` was deliberately shaped in #18 with the same member and field names as `SessionAction`, so the six session-lifecycle arms are pass-through. The **only** non-identity session arm is `failed`: `DaemonEvent.failed` carries the wire `ErrorPayload`, `SessionAction.failed` the store-owned `ConnectionError`. They are structurally identical (`{ code, message, retryable }`) but nominally distinct per layer, so the translation copies the three fields into a fresh object rather than spreading — keeping the store shape immune to `ErrorPayload` gaining an unrelated field later. See [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md) for why `ConnectionError` is a store-owned model distinct from the wire type. The three debug-bundle arms ([#168](../codebase/168.md)) are grouped fall-through cases returning `null` — see § Tolerating events with no store action.

**The four session-lifecycle arms also carry their origin, since #1133.** Each of `connecting` / `connected` / `disconnected` / `failed` now stamps `serverId: originOf(event)` onto the action it returns, so [the session store](session-store.md#one-slot-per-server-since-1133) can file each server's status into its own slot. `originOf(event: DaemonEvent): StatusOrigin` is a module-local function reading [#1068](daemon-event-channel-plumbing.md)'s stamp with the same `in`-guard-plus-`typeof` idiom `liveWindow.ts`'s main-side `originOf` uses: `!('serverId' in event)` → `undefined` (unbound producer); `serverId === null` → `null` (the not-paired stand-in); a string → that string.

`translateDaemonEvent` deliberately **keeps its bare-`DaemonEvent` parameter** rather than being re-declared to take `StampedDaemonEvent`: 51 existing test calls pass bare event literals, and a re-declared parameter would only compile at the call site through unsound method-parameter bivariance. So the stamp arrives structurally at a statically bare-union-typed parameter, and `originOf`'s `in`-guard is what reads through that hole — the renderer twin of the same hole `liveWindow.ts` documents on the main side.

The origin is read **only** from the stamp, **never** from a payload field — most importantly never from `connected`'s `ack.server_id`, a distinct value the daemon supplies. The stamp itself is bound main-side at construction from a client-held paired record, so a hostile or confused daemon cannot make its own event claim another server's slot. This is asserted by a dedicated test (a `connected` event stamped for server A whose `ack.server_id` names server B must file under A, and B must read `undefined`), not merely documented.

**Exhaustiveness is the AC1 guarantee.** Adding a 10th `DaemonEvent` member with no `case` makes `event` non-`never` at the `default`, so `assertNever(event)` fails `npm run typecheck`. That type error *is* "adding a variant with no mapping is a compile-time error." [#168](../codebase/168.md) proved this in practice: adding three members to `DaemonEvent` broke this switch until matching cases landed — the forced consequence the ticket's spec called out up front.

**No mutation, no side effects, no logging.** Pure `DaemonEvent → SessionAction | null`. A `console.log(event)` here would leak `MessagePayload.text` (message bodies) to the DevTools console — the same standing guardrail as #18's emit helper.

### Tolerating events with no store action ([#168](../codebase/168.md))

Not every `DaemonEvent` drives session-store state. The three debug-bundle members report progress and results the download UI consumes directly (over the same `onDaemonEvent` subscription, outside this bridge) — the session store has no concept of a download in progress. Rather than invent a no-op `SessionAction` member (which would force `sessionStore`'s own reducer to grow a dead arm just to satisfy *its* exhaustiveness), `translateDaemonEvent`'s return type absorbs the "no action" case directly as `SessionAction | null`, and the sole call site skips the dispatch on `null`:

```ts
case 'debugBundleProgress':
case 'debugBundleSaved':
case 'debugBundleFailed':
  // No session-store action: the download UI (#72) consumes these, not the session store.
  return null
```

This keeps `DaemonEvent` and `SessionAction` as two **independently** exhaustive unions rather than forcing them into permanent 1:1 correspondence — a `DaemonEvent` member is free to exist purely for a non-store consumer, as long as this bridge's switch has a case (even a `null`-returning one) for it. The `assertNever` default arm is unchanged and stays load-bearing: a *tenth* variant with no case, `null` or otherwise, is still a compile error.

### 2. The subscription hook (`useDaemonEventBridge`)

A single `useEffect(() => { … }, [])` (empty deps — subscribe once per mount):

```ts
useEffect(() => {
  const off = window.pyry.onDaemonEvent((event) => {
    const action = translateDaemonEvent(event)
    // Debug-bundle events translate to `null` (no session-store action) — skip the dispatch.
    if (action) sessionStore.getState().dispatch(action)
  })
  return off   // effect cleanup IS the unsubscribe handle from onDaemonEvent
}, [])
```

Before [#168](../codebase/168.md) this dispatched `translateDaemonEvent(event)` unconditionally — safe when the return type was always a `SessionAction`, but `dispatch` doesn't accept `null`, so the widened return type forced this explicit skip.

- Dispatch goes to the **app-singleton** `sessionStore` (`sessionStore.getState().dispatch`) — the "one source of truth" #12 will read — not a per-hook store.
- The effect **returns the unsubscribe handle verbatim**, so teardown removes exactly the listener it registered. Under `React.StrictMode` (which `main.tsx` wraps `App` in), dev double-invokes the effect: subscribe A → cleanup unsubscribes A → subscribe B. Because #18's `onDaemonEvent` removes the *exact* handler it added, the net result is **exactly one** live listener — no duplicated dispatch, no doubled message append. A body that ignored the returned handle would leak a listener per remount and double every `messageReceived`.
- The hook reads nothing from `window` beyond `onDaemonEvent`; it never touches `ipcRenderer`, raw frames, keys, or the transport.

### 3. Wiring site (`src/renderer/src/App.tsx`)

`useDaemonEventBridge()` is called once at the top of `App()`, the renderer composition root (mounted once by `main.tsx`), so the subscription's practical lifetime is the app's. Nothing else in `App.tsx` changed.

### Data flow

```
 #18 preload bridge            useDaemonEventBridge (#19)                          store (#2)
 webContents.send ──IPC──►  window.pyry.onDaemonEvent(cb) ──►  translateDaemonEvent ──►  if (action) sessionStore.dispatch
 DAEMON_EVENT_CHANNEL       cb(event: DaemonEvent)              (DaemonEvent→SessionAction|null)  reduceSession → state
                            useEffect cleanup: off()            failed: ErrorPayload→ConnectionError
                                                                 debugBundle*: → null (skipped, #168)
```

`translateDaemonEvent` is the single pure choke point; the hook is its only production caller. The renderer reads status/messages **only** through `sessionStore` this feeds — it never re-parses frames or holds transport state. The three debug-bundle events pass through `onDaemonEvent` like any other event but are filtered out before `dispatch` — a consumer that wants them (#72) subscribes to `window.pyry.onDaemonEvent` directly, alongside this bridge, not through the store.

## Configuration and usage

- **Dispatch is synchronous.** `onDaemonEvent`'s callback runs synchronously on IPC delivery; `translate` + `dispatch` + `reduceSession` are all synchronous and pure. No timers, no async iteration — the transport (#4/#7) owns those upstream.
- **Call the hook in exactly one place.** Each `useDaemonEventBridge()` registers its own listener; App calls it once. A second mounting consumer would dispatch every event once per listener.
- **Imports** (renderer side, `@shared` alias resolves): `translateDaemonEvent` imports `type { DaemonEvent } from '@shared/ipc/events'` and `sessionStore` + `type { SessionAction }` from `./sessionStore`.

## Edge cases and limitations

- **No runtime validation at the boundary.** The producer is our own trusted main process delivering already-validated `DaemonEvent`s (validated upstream in #5/#10 before the event crosses the bridge). Per evidence-based-fix, no `zod`-style guard is added — it would defend against a bug, not an attacker, and a compromised main process is already game-over.
- **`window.pyry` is assumed present.** In the Electron renderer the preload runs before the window script, so `window.pyry` is always defined when `App` mounts. If a future test renders `<App />` in jsdom without the preload, the effect throws — stub `window.pyry` or inject the bridge at that point (no such test exists yet).
- **No backfill dedupe.** `messagesReceived` dispatches unconditionally; a re-delivered backfill batch with repeated `message_id`s would double-append (inherited from [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md)). Owned by whichever ticket wires reconnect. This bridge faithfully translates whatever the channel delivers.
- **Translation cannot fail on well-typed input** — it is a total mapping over a sealed union; the `assertNever` arm is unreachable at runtime for a valid `DaemonEvent` and exists solely as the compile-time totality guard.
- **A future `DaemonEvent` member forces explicit handling in four exhaustive bridges:**
  `daemonEventBridge`, `timelineBridge`, `modalBridge` and `questionBridge`.
  Both model-refusal variants belong to the [timeline](conversation-timeline-store.md#refusal-records-and-routing);
  the other three return `null`. An ignored event needs no invented `SessionAction`,
  and leaves session/model-label authority unchanged.

## Related

- [Daemon-event channel](daemon-event-channel.md) — the `DaemonEvent` union + `onDaemonEvent` subscription this consumes (#18); gained three no-store-action members in [#168](../codebase/168.md)
- [Session store](session-store.md#one-slot-per-server-since-1133) — the `SessionAction` write surface + app-singleton `sessionStore` this dispatches into (#2); since #1133 the four status arms carry `originOf(event)` so the store can file each server's status into its own slot
- [Live window](live-window.md#one-slot-per-server-since-1121) — #1121, the main-side precedent for the same stamp-only-origin rule, applied to the reopened-window status cache
- [Command channel](command-channel.md) / [#168](../codebase/168.md) — the mirror-image `requestDebugBundle` command that triggers the download the three tolerated events report on
- [Screen snapshot fetch](screen-snapshot-fetch.md) / [#180](../codebase/180.md) — the `snapshotReceived` member this bridge tolerated as a fourth `null`-returning case (removed [#621](../codebase/621.md)), and the concrete "renderer needs zero change" correction
- [#621 codebase notes](../codebase/621.md) — removed the `snapshotReceived`/`screenSnapshotReceived` cases this bridge tolerated, once both were unconsumed; the `assertNever` default still terminates the switch
- [Thread timeline (conversation model)](thread-timeline.md) / [#199](../codebase/199.md) — the `assistantDelta`/`turnEnd` members this bridge tolerates as a fifth and sixth `null`-returning case; both carry real content (unlike the four members above) but still map to `null` here because their consumer is [#202](../codebase/202.md)'s [conversation timeline store](conversation-timeline-store.md), not this session-store bridge
- [Conversation list fetch](conversation-list-fetch.md) / [#139](../codebase/139.md) — the `conversationsReceived` member this bridge tolerates as a seventh `null`-returning case; consumed by the conversation-list store [#208](https://github.com/pyrycode/pyrycode-desktop/issues/208), not this session-store bridge
- [Conversation timeline store](conversation-timeline-store.md) / [#214](../codebase/214.md) — the `turnState` member this bridge tolerates as an eighth `null`-returning case; the third arm the timeline bridge owns, alongside `assistantDelta`/`turnEnd`
- [#315 codebase notes](../codebase/315.md) — the `stallDetected` member this bridge tolerates as an eighteenth `null`-returning case, the fourth arm to force a case in all three exhaustive bridges at once; at ship time the only nullary member (its one decoded field, `conversation_id`, was dropped at the emit). [#732 codebase notes](../codebase/732.md) later widened it with `conversationId`; still a `null`-returning no-op here, and the id reaches no sink in this bridge.
- [#317 codebase notes](../codebase/317.md) — the render slice that claims `stallDetected` as the [conversation timeline store](conversation-timeline-store.md) bridge's sixth owned arm (this bridge, the session store, still nulls it)
- [#492 codebase notes](../codebase/492.md) — the `apiRetry` member this bridge tolerates as a further `null`-returning case: `stallDetected`'s status-liveness peer, carrying `active`/`current`/`total`, and neither onset-only nor deduped
- [#493 codebase notes](../codebase/493.md) — the render slice that claims `apiRetry` as the [conversation timeline store](conversation-timeline-store.md) bridge's seventh owned arm (this bridge, the session store, still nulls it)
- [#316 codebase notes](../codebase/316.md) — the `screenSnapshotReceived` member this bridge tolerated as a nineteenth `null`-returning case (removed [#621](../codebase/621.md)), the fifth arm to force a case in all three exhaustive bridges at once; unlike `stallDetected` at the time, a deliberate widening carrying real content (`text`/`ts`) this bridge still discarded, since its consumer was the [screen-snapshot store](screen-snapshot-store.md)'s independent observer (#323) and the display slice #324, not the session store
- [Conversation timeline store](conversation-timeline-store.md) / [#217](../codebase/217.md) — the `toolUse` member this bridge tolerates as a ninth `null`-returning case; the fourth arm the timeline bridge owns, and the first to drive a durable `toolCall` item rather than text or a scalar
- [Modal-prompt model](modal-prompt-model.md) / [#201](../codebase/201.md) — the `modalShown`/`modalDismissed` members this bridge tolerates as a tenth and eleventh `null`-returning case; unlike every prior member, the timeline bridge ALSO returns `null` for these — the real consumer is the third, independent [modal store + bridge](modal-store-bridge.md), shipped in [#223](../codebase/223.md)
- [Conversation timeline store](conversation-timeline-store.md) / [#229](../codebase/229.md) — the `toolResult` member this bridge tolerates as a twelfth `null`-returning case; the fifth arm the timeline bridge owns and the first to **resolve** an existing `ThreadItem` rather than append one or set a scalar; the first arm to force a case in three exhaustive `DaemonEvent` switches at once (session, timeline, and [modal store + bridge](modal-store-bridge.md))
- [Conversation create](conversation-create.md) / [#241](../codebase/241.md) — the `conversationCreated` member this bridge tolerates as a thirteenth `null`-returning case; consumed by neither existing bridge, the real consumer is the render sibling [#242](https://github.com/pyrycode/pyrycode-desktop/issues/242)
- [#254 codebase notes](../codebase/254.md) — the `sessionTransition` member this bridge tolerates as a fourteenth `null`-returning case; consumed by none of the three existing bridges, the real consumer is the renderer holder [#259](https://github.com/pyrycode/pyrycode-desktop/issues/259)
- [#248 codebase notes](../codebase/248.md) — the `modalAnswerRejected` member this bridge tolerates as a fifteenth `null`-returning case; owned by the [modal store + bridge](modal-store-bridge.md), dormant until the render slice #249
- [Session settings send](session-settings-send.md) / [#264 codebase notes](../codebase/264.md) — the `sessionSettingsUpdated` member this bridge tolerates as a sixteenth `null`-returning case, widened with a `changeId` correlation key by [#261](../codebase/261.md); consumed by none of the three existing bridges, the real consumer is [#256](../codebase/256.md)'s [write store](run-settings-write-store.md), shipped
- [Session settings send](session-settings-send.md) / [#269 codebase notes](../codebase/269.md) — the `sessionSettingsRejected` member this bridge tolerates as a seventeenth `null`-returning case, the rejected twin of `sessionSettingsUpdated`; consumed by none of the three existing bridges, the real consumer is [#256](../codebase/256.md)'s [write store](run-settings-write-store.md), shipped
- [Run configuration write store](run-settings-write-store.md) / [#256 codebase notes](../codebase/256.md) — the fourth independent App-level subscriber on this channel (alongside this bridge, the timeline bridge, and the modal bridge), consuming `sessionSettingsUpdated`/`sessionSettingsRejected` into the pending-write state machine; does not modify this bridge
- [Relay-link store](relay-link-store.md) / [#328 codebase notes](../codebase/328.md) / [#329 codebase notes](../codebase/329.md) — the `relayLinkChanged` member this bridge tolerates as a twentieth `null`-returning case (#328, content-free relay-socket-leg category); its real consumer is a fifth independent App-level subscriber, the relay-link store's own `RelayLinkData` bridge (#329, shipped) — the sixth arm to force a case in all three exhaustive bridges at once
- [#564 codebase notes](../codebase/564.md) — the `backgroundTaskStarted` member this bridge tolerates as a further `null`-returning case; unlike `apiRetry`/`compacting`, it **keeps** `conversationId` (the `queueState` #720 daemon-state rule — the frame carries no `turn_id` and opens/closes no turn); first of three sibling frame arms (#565/#566 follow); stays dormant in this bridge — [the roster store (#573, shipped)](../codebase/573.md) consumes only the `backgroundTaskRoster` arm, awaiting #574 for this one
- [ADR 0004 — Renderer session store: reducer + sealed actions + wire types](../decisions/0004-renderer-session-store-reducer-wire-types.md) — the `failed → ErrorPayload → ConnectionError` seam
- [#19 codebase notes](../codebase/19.md) · Spec: `docs/specs/architecture/19-translate-daemon-events-to-session-actions.md` · [#168 codebase notes](../codebase/168.md) · Spec: `docs/specs/architecture/168-debug-bundle-ipc-contract.md`
