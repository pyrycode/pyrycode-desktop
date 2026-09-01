# Debug-bundle orchestrator

The **main-process consumer that ties the whole client debug-bundle download together**: on the renderer's bare `requestDebugBundle` command, drives request → reassemble → save and reports progress + one terminal result back to the window. This is the only debug-bundle slice that touches Electron (`app.getPath('downloads')`) and IPC — the transport ([debug-bundle request](debug-bundle-request.md), [debug-bundle reassembly](debug-bundle-reassembly.md)) and [persistence](save-debug-bundle.md) slices stay Electron-free and IPC-free.

```ts
// src/main/debugBundleDownload.ts — MAIN-PROCESS ONLY, Electron-free
export interface DebugBundleDownloadDeps {
  requestDebugBundle: (consumer: BundleConsumer) => void
  save: (bytes: Uint8Array) => Promise<string>
  emit: (event: DaemonEvent) => void
}
export function createDebugBundleDownload(deps: DebugBundleDownloadDeps): { request(): void }
```

Introduced in [#169](../codebase/169.md), the last child of [#118](../codebase/118.md)'s split. Consumed by [#72](../codebase/72.md) — the "Log data" section's Download button, the [conversation shell](conversation-shell-workspace-and-run-config.md#log-data-section-72)'s sole trigger for this module — which closes the [#71](https://github.com/pyrycode/pyrycode-desktop/issues/71) debug-bundle family end to end: this orchestrator had a real emitter and command handler since #169, but no UI ever called `requestDebugBundle` or read the three `DaemonEvent`s until #72 shipped.

## Why this needed its own slice

Everything up to this point was deliberately IPC-free and Electron-free: [#115](debug-bundle-request.md) builds and sends the request frame, [#116](debug-bundle-reassembly.md) reassembles the stream behind an injected `BundleConsumer`, [#117](save-debug-bundle.md) persists bytes given a directory, and [#168](../codebase/168.md) shipped a typed but *inert* IPC contract (nothing called `emitDaemonEvent` with the three new events, and the `requestDebugBundle` command was an unhandled no-op). This ticket is the composition-root glue that makes those pieces do something, and it is the one place `app.getPath('downloads')` gets called.

## The information-minimising boundary

The renderer is untrusted and the reassembled bundle is sensitive (recent daemon logs + a terminal recording). Only three kinds of value ever reach `emit`:

- `chunksReceived` (`number`) — progress, no bytes.
- `path` (`string`) — the saved absolute filesystem path, on success.
- `reason` (the closed `DebugBundleFailure` enum: `unavailable` / `stream-corrupt` / `write-failed`) — on failure.

The transport's finer 5-value `BundleFailReason` (`seq-mismatch` / `total-mismatch` / `daemon-error` / `connection-lost` / `not-connected`) plus any `save` rejection collapse onto those three categories via `categoryFor`, a total exhaustive `switch` with a `never` default (mirrors the `assertNever` idiom in `daemonEventBridge.ts`). The save-errno path is separate from that switch entirely — the reject handler that runs on a failed `save` takes **no error parameter**, so the fs errno (e.g. `EACCES`, `ENOSPC`) is structurally impossible to leak, not merely dropped by convention.

## The `active` flag — single-in-flight, not a queue

One `let active = false`, closed over by `request()`, is the module's entire state:

1. `request()` returns immediately if `active` is already `true` — no consumer constructed, no transport call. A spamming renderer cannot orphan an in-flight reassembler slot (`daemonConnection.ts` replaces its one reassembler slot on every `requestDebugBundle` call — see [debug-bundle reassembly](debug-bundle-reassembly.md) — so a second concurrent call would silently drop the first's terminal without this guard).
2. Otherwise `active = true` is set **synchronously, before** `requestDebugBundle(consumer)` is called. This ordering matters: a disconnected session fails the consumer *synchronously* inside that call (`not-connected`), and the `fail` handler is what clears `active` — setting the flag afterwards would leave it stuck `true` forever on that path.
3. `active` clears at exactly three terminal-emit sites: `save` resolve, `save` reject, and `fail`. It does **not** clear inside `complete` before the save settles — the terminal for a successful stream is the *save outcome*, not the byte delivery, so the flag stays held across the whole async `save(bytes)` window. A second `request()` arriving mid-save is short-circuited exactly like one arriving mid-stream.
4. `request()`'s body has no `await` anywhere, so two calls can never interleave mid-body — the second observes a fully-settled `active` from a prior synchronous turn, not a race.

Because a second `requestDebugBundle` is never issued while `active`, the transport's reassembler slot is never replaced out from under an in-flight download — the terminal-exactly-once guarantee the reassembler already provides (see [debug-bundle reassembly](debug-bundle-reassembly.md)) is never defeated by a concurrent request.

## Composition-root wiring — `src/main/index.ts`

Inside `app.whenReady()`, after `connection` is constructed and before the `onCommand` registration:

```ts
const downloadsDir = app.getPath('downloads')
const downloader = createDebugBundleDownload({
  requestDebugBundle: (c) => connection.requestDebugBundle(c),
  save: (b) => saveDebugBundle(downloadsDir, b),
  emit: (e) => emitDaemonEvent(live.sink, e) // #519 — live.sink, not a captured mainWindow
})
```

and one added `case` in the existing switch: `case 'requestDebugBundle': downloader.request(); return`. No preload change — the bare command rides the existing `sendCommand` bridge, results ride the existing `onDaemonEvent` subscription.

## Error handling

| Failure | Where | Result event |
|---|---|---|
| daemon replies `error` in lieu of a stream | `fail('daemon-error')` | `debugBundleFailed: unavailable` |
| request while disconnected | `fail('not-connected')` (synchronous) | `debugBundleFailed: unavailable` |
| socket drops mid-stream | `fail('connection-lost')` (transport teardown net) | `debugBundleFailed: unavailable` |
| chunk reorder/gap/dup | `fail('seq-mismatch')` | `debugBundleFailed: stream-corrupt` |
| truncated stream | `fail('total-mismatch')` | `debugBundleFailed: stream-corrupt` |
| fs write fails (`EACCES`, `ENOSPC`, …) | `save` reject | `debugBundleFailed: write-failed` — errno + bytes dropped in the reject handler |
| stream succeeds | `save` resolve | `debugBundleSaved: <absolute path>` |

## Out of scope

- **No queue.** A second request while one is active is *ignored*, not queued — unobserved need, deliberately deferred.
- **No stream timeout.** A never-terminating or slow-dribble bundle stream from an authenticated daemon leaves the download wedged (`active` never clears). The architect's security review flagged this explicitly as out of scope: the correct fix is a per-message idle deadline at the transport layer (`relayConnection`), not a stochastic timeout guessed in this module. No hang has been observed; a real socket drop still resolves cleanly via the connection-teardown net (originally `terminal`/`error` only, extended by [#505](../codebase/505.md) below to `relay-link-down` and `dial()`).
- **`onCommand`'s switch has no `assertNever` default arm** (code-review NIT, non-blocking) — a future third `RendererCommand` member without a matching `case` here would silently no-op instead of failing to compile. Carried forward for whenever `index.ts`'s switch is next touched.
- **A driver that is non-null but not live can still wedge a request.** `requestDebugBundle`'s guard is `driver === null`, not "driver is connected." Retrying the download in the window between `dial()` clearing the old driver and the new handshake completing arms a reassembler that never settles. Reachable from [#505](../codebase/505.md)'s own scenario; flagged to the PO for its own ticket rather than fixed there — needs a driver-liveness flag, not a two-line change.

### [#505](../codebase/505.md) — the teardown net originally only covered `terminal`/`error`

[#169](../codebase/169.md)'s own "Deferred / carried forward" reasoned that "a real socket drop already resolves via the existing `connection-lost` teardown net (#116)." That held for a *fatal* close (`terminal`) but not for a *retryable* close (`relay-link-down`, which the supervisor auto-re-dials from) or for a superseded driver's `terminal` fenced out by `dial()`'s generation bump during a `reconnect()`. Both left `active` wedged for the rest of the process lifetime after a single relay hiccup or a re-pair/unpair. [#505](../codebase/505.md) closed both gaps in [debug-bundle reassembly](debug-bundle-reassembly.md)'s teardown net — no change was needed in this module itself, since `active` was always correctly *responsive* to the reassembler's consumer callbacks; it was the callbacks that were sometimes never firing.

## Testing

- **`debugBundleDownload.test.ts`** — all three deps faked; drives the captured `BundleConsumer` directly. Covers the fail-map for all five `BundleFailReason`s plus a save-reject (`Object.keys` allowlist assertion on every emitted event — no errno/token/key/bytes field), progress, and single-in-flight including the async-save window (via a hand-rolled `deferred<T>()`) and the synchronous `not-connected` path.
- **`daemonConnection.roundtrip.test.ts`** (new `describe`) — a real orchestrator over the real reassembler and a real `saveDebugBundle` into a `mkdtemp`'d temp dir, driven through a fake daemon streaming a genuine multi-chunk archive; asserts the written file's bytes equal the served archive and the emitted `debugBundleSaved.path` is absolute.

## Related

- [#169 codebase notes](../codebase/169.md) — implementation summary, patterns, and lessons learned.
- [#505 codebase notes](../codebase/505.md) — closed the two connection-teardown gaps (`relay-link-down`, `dial()`) that could leave `active` wedged; corrects #169's original scoping of the wedge to "an unterminated stream only."
- [Live window](live-window.md) / [#519](../codebase/519.md) — the injected `emit` closes over
  `live.sink`, the process-lifetime channel that replaced a captured `mainWindow` reference so the
  emitter keeps working after a dock reopen.
- [Debug-bundle request (outbound)](debug-bundle-request.md) / [#115](../codebase/115.md) — sends the frame this ticket's `requestDebugBundle` dep triggers.
- [Debug-bundle reassembly (inbound)](debug-bundle-reassembly.md) / [#116](../codebase/116.md) — source of `BundleConsumer`/`BundleFailReason`; owns the reassembler slot this ticket's single-in-flight guard protects.
- [Save debug bundle (persistence)](save-debug-bundle.md) / [#117](../codebase/117.md) — the `save` dep, closed over `app.getPath('downloads')`.
- [Command channel](command-channel.md) / [Daemon-event channel](daemon-event-channel.md) / [#168](../codebase/168.md) — the typed IPC contract this ticket wires a real emitter and command handler for; both channels were inert until now.
- [ADR 0007 — Content-free diagnostics by construction](../decisions/0007-content-free-diagnostics-by-construction.md) — the sibling information-minimisation philosophy this module's `emit` boundary shares (a different mechanism, same "the type can't hold a secret" posture).
- [Conversation shell](conversation-shell-workspace-and-run-config.md#log-data-section-72) / [#72 codebase notes](../codebase/72.md) — the Download button + local state machine that finally drives this module; closes the #71 family.
- Parent: [#118](../codebase/118.md) split into [#168](../codebase/168.md) + this ticket — [[ticket-118-command-surface-refined]], [[ticket-169-orchestrator-refined]].
