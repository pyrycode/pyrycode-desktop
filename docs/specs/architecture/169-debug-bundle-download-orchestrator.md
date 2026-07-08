# #169 — Debug-bundle download: main-process orchestrator + composition-root wiring

**Size:** S · **Security-sensitive:** yes · **Figma:** N/A (no UI surface — main-process orchestration only)

The last child of #118. The transport (#115 request frame, #116 reassembly, #117 collision-safe save) and the typed IPC contract (#168) are all merged. This slice is the **orchestration** that lives at the composition root: on the bare `requestDebugBundle` command, drive request → reassemble → save, and report progress + a single terminal result back to the window. It is the only slice that touches Electron (`app.getPath('downloads')`) and IPC; the transport and persistence slices stay IPC-free.

## Files to read first

- `src/shared/ipc/events.ts:27,46-56` — `DebugBundleFailure = 'unavailable' | 'stream-corrupt' | 'write-failed'` and the three `DaemonEvent` members the orchestrator emits (`debugBundleProgress` / `debugBundleSaved` / `debugBundleFailed`). This is the closed set of fields allowed on the channel; the orchestrator emits nothing else.
- `src/shared/ipc/commands.ts:38-40,58-69` — `RendererCommand`; the bare `{ type: 'requestDebugBundle' }` member (no payload) and its `isRendererCommand` acceptance. This is the command the `index.ts` switch dispatches.
- `src/main/transport/bundleReassembler.ts:32-52` — `BundleFailReason` (the closed **5-set** to map: `seq-mismatch` / `total-mismatch` / `daemon-error` / `connection-lost` / `not-connected`) and the `BundleConsumer` interface. **Note `complete(bytes)` is synchronous** — the async `save` is kicked off from inside it. `progress?` is optional and fires once per accepted chunk with the ascending running count.
- `src/main/saveDebugBundle.ts:46-60` — `saveDebugBundle(dir, bytes): Promise<string>`. Resolves the written **absolute** path; rejects with a Node errno on any non-collision failure. The errno is exactly what the orchestrator must catch and never forward.
- `src/main/daemonConnection.ts:381-405` — `requestDebugBundle(consumer)`: it **replaces the per-connection reassembler slot on every call** (`reassembler = createBundleReassembler(consumer)`, line 392), and fails the consumer `'not-connected'` synchronously when no driver. The slot-replacement is the orphan hazard AC4 guards against.
- `src/main/daemonConnection.ts:245-257` — the connection-lost teardown net: a mid-stream socket drop or driver error calls `reassembler?.fail('connection-lost')`, so a download interrupted by a drop still delivers exactly one terminal (no hang).
- `src/main/emitDaemonEvent.ts:15-25` — `emitDaemonEvent(sink, event)`; a `BrowserWindow` satisfies `DaemonEventSink` structurally, so `mainWindow` is passed directly. Pure forwarder, no logging.
- `src/main/index.ts:148-213` — the composition root: `mainWindow` (148), `connection` (162-169) both exist by line 169; the single `onCommand` switch is at 206-212 (`sendMessage`-only today). `emitDaemonEvent` is **not yet imported** here — add the import.
- `src/main/daemonConnection.roundtrip.test.ts:161-215,343-391` — the AC1 harness to reuse: `standUpRoundTrip(buildReply, { buildReplyFrames })`, the `bundleFrames(raw, chunkSize)` splitter, and the `bundleConsumer(waiter)` pattern. AC1's integration test is a new `describe` block appended here (the helpers are module-local; do not export them).
- `src/renderer/src/store/daemonEventBridge.ts:11-14` — the codebase's local `assertNever(x: never): never` idiom (defined per module, no shared helper). Mirror it for the fail-map's `never` default.

## Design source

N/A — main-process orchestration, no rendered surface. The download UI trigger is #72; this slice only emits the events it consumes.

## Context

The renderer is untrusted and the reassembled bundle is sensitive (it is routed to disk). The events that flow back to the window must never carry content: the result event carries only a filesystem path (success) or a coarse category code (failure); progress carries only a running chunk count. This slice is where the finer transport failure taxonomy (`BundleFailReason`) plus a save errno collapse onto the three user-facing categories — the information-minimising boundary.

The transport already guarantees the consumer receives **exactly one terminal** (`complete` XOR `fail`, once). The orchestrator's job is to (a) translate that terminal into one secret-free `DaemonEvent`, (b) route `complete`'s bytes to disk and turn the save outcome into the terminal event, and (c) prevent a concurrent request from orphaning an in-flight download.

## Design

### New module — `src/main/debugBundleDownload.ts`

An injectable factory, Electron-free and unit-testable without a window:

```ts
export interface DebugBundleDownloadDeps {
  requestDebugBundle: (consumer: BundleConsumer) => void   // daemonConnection.requestDebugBundle
  save: (bytes: Uint8Array) => Promise<string>             // dir-closed saveDebugBundle
  emit: (event: DaemonEvent) => void                       // e => emitDaemonEvent(mainWindow, e)
}
export interface DebugBundleDownload { request(): void }
export function createDebugBundleDownload(deps: DebugBundleDownloadDeps): DebugBundleDownload
```

Imports: `BundleConsumer`, `BundleFailReason` from `./transport/bundleReassembler`; `DaemonEvent`, `DebugBundleFailure` from `../shared/ipc/events`. (`src/main` has no `@shared` alias — use relative paths.)

**Internal state:** a single `let active = false` flag closed over by `request()`. No other state — the reassembler and its byte accumulation live in the transport slice.

**`request()` behavior** (contract, not a body):
1. If `active`, return immediately — the single-in-flight short-circuit (AC4). Do **not** construct a consumer, do **not** call `requestDebugBundle`.
2. Set `active = true`, then construct a fresh per-download `BundleConsumer`:
   - `progress(chunksReceived)` → `emit({ type: 'debugBundleProgress', chunksReceived })`. **Not terminal** — does not clear `active`.
   - `complete(bytes)` (synchronous) → kick off `save(bytes)`; from its settlement:
     - resolve `path` → `emit({ type: 'debugBundleSaved', path })`, then clear `active`.
     - reject → **catch the errno** (never emit it or the bytes), `emit({ type: 'debugBundleFailed', reason: 'write-failed' })`, then clear `active`.
   - `fail(reason)` → `emit({ type: 'debugBundleFailed', reason: categoryFor(reason) })`, then clear `active`.
3. Call `requestDebugBundle(consumer)` (this arms the transport slot and sends the frame; for `not-connected` it fails the consumer synchronously, which runs the `fail` handler above before `request()` returns).

**The `active`-clearing invariant** (load-bearing for AC4): `active` is cleared at exactly the three **terminal-emit sites** — save-resolve, save-reject, and `fail`. It is *not* cleared in `complete` before `save` settles (the terminal for a successful stream is `debugBundleSaved`/`write-failed`, which emits only after the async save). So the flag stays `true` across the async save, and a second `request()` during that window is short-circuited. Because a second `requestDebugBundle` is never issued while active, the transport's reassembler slot (`daemonConnection.ts:392`) is never replaced out from under an in-flight download — the first always runs to its single terminal.

### Fail-map — `categoryFor(reason: BundleFailReason): DebugBundleFailure`

A pure, total, exhaustive `switch` over the closed 5-set with a `never` default (mirror the `assertNever` idiom from `daemonEventBridge.ts:11-14`). The save-errno → `write-failed` mapping is a **separate path** (the `save` reject handler), never routed through this switch:

| `BundleFailReason` | → category |
|---|---|
| `daemon-error`, `not-connected`, `connection-lost` | `unavailable` |
| `seq-mismatch`, `total-mismatch` | `stream-corrupt` |
| *(save errno — not a `BundleFailReason`)* | `write-failed` |

The `never` default is unreachable by construction (the reassembler only ever emits the five static enum members). If it were reached, its value is a static enum string — never bytes — so the `assertNever` throw carries no secret. It exists as the compile-time exhaustiveness guard: a sixth `BundleFailReason` added upstream becomes a type error here.

### Composition-root wiring — `src/main/index.ts`

Within the `app.whenReady()` callback, after `connection` is constructed (line 169) and before the `onCommand` registration (206):

- Add imports: `saveDebugBundle` from `./saveDebugBundle`, `createDebugBundleDownload` from `./debugBundleDownload`, `emitDaemonEvent` from `./emitDaemonEvent`.
- Compute `const downloadsDir = app.getPath('downloads')` — this slice's one Electron touch beyond IPC.
- Construct the downloader, wiring the three deps to the live pieces:
  - `requestDebugBundle: (c) => connection.requestDebugBundle(c)`
  - `save: (b) => saveDebugBundle(downloadsDir, b)`
  - `emit: (e) => emitDaemonEvent(mainWindow, e)`
- Extend the existing `onCommand` switch (206-212) with `case 'requestDebugBundle': downloader.request(); return`.

**Preload:** no change. The bare command rides the existing command bridge (`COMMAND_CHANNEL`); results ride the existing `DAEMON_EVENT_CHANNEL` / `onDaemonEvent`.

## State + concurrency model

- **One in-flight download at a time**, enforced by the `active` flag. The simplest satisfying behavior per AC4 is to **ignore** a new request while one is active (no queue — a queue is unobserved-need scope creep).
- **Terminal guarantee is inherited, not re-implemented.** The reassembler delivers exactly one `complete`/`fail`; the connection-lost net (`daemonConnection.ts:248,257`) covers a mid-stream socket drop by failing the consumer `connection-lost`. Every path yields exactly one terminal, so `active` always eventually clears — no permanent lock, no dangling waiter in the window.
- **No teardown hook needed.** `request()` owns no socket, timer, or subscription; the transport owns those. There is no `AbortController` or cleanup surface to add — do not invent one (evidence-based: no hung-save has been observed, so no save timeout).

## Error handling

| Failure | Where | Result event | Leak guard |
|---|---|---|---|
| daemon replies `error` in lieu of stream | `fail('daemon-error')` | `debugBundleFailed: unavailable` | static enum only |
| request while disconnected | `fail('not-connected')` (sync) | `debugBundleFailed: unavailable` | static enum only |
| socket drops mid-stream | `fail('connection-lost')` (transport net) | `debugBundleFailed: unavailable` | static enum only |
| chunk reorder/gap/dup | `fail('seq-mismatch')` | `debugBundleFailed: stream-corrupt` | static enum only |
| truncated stream | `fail('total-mismatch')` | `debugBundleFailed: stream-corrupt` | static enum only |
| fs write fails (EACCES, ENOSPC, …) | `save` reject | `debugBundleFailed: write-failed` | **errno + bytes dropped in catch** |
| stream succeeds | `save` resolve | `debugBundleSaved: <absolute path>` | path only (a local fs path, no content) |

The orchestrator never throws out of `request()`. The only fields that ever reach `emit` are `chunksReceived` (number), `path` (string), and `reason` (the closed `DebugBundleFailure` enum). `complete`'s `bytes` go only to `save` (disk); the save-reject errno is caught and discarded. See § Security review below.

## Testing strategy

`npm test` (vitest); `npm run typecheck` covers the exhaustiveness of `categoryFor`.

**Unit tests — `src/main/debugBundleDownload.test.ts`** (fakes for all three deps; capture the constructed consumer via a fake `requestDebugBundle` that stashes its argument):

- **AC2 fail-map (all six):** for each of the five `BundleFailReason` members, `request()` then drive `captured.fail(reason)`; assert `emit` received `{ type: 'debugBundleFailed', reason: <expected category> }`. For the save path, inject `save: () => Promise.reject(<errno-shaped Error>)`, drive `captured.complete(bytes)`, await a microtask, assert `reason: 'write-failed'`. For every failed event assert the emitted object's `Object.keys` are exactly `['type','reason']` — no `errno`, `token`, `key`, or `bytes` field (allowlist assertion, mirroring #116's `Object.keys` discipline).
- **AC3 progress:** drive `captured.progress(3)`; assert `emit` got `{ type: 'debugBundleProgress', chunksReceived: 3 }` and `Object.keys` are exactly `['type','chunksReceived']` (no bytes).
- **AC4 single-in-flight:** `request()` → assert fake `requestDebugBundle` called once. Second `request()` while active → assert still called once (short-circuited), and no second consumer captured, and the first's terminal still pending. Drive the first's terminal (`captured.fail('daemon-error')`) → assert exactly one terminal event emitted. Then `request()` again → assert `requestDebugBundle` now called twice (fresh download admitted after settle). Also cover the async-save window: inject a `save` that resolves on a controllable deferred; between `complete` and save-resolve, a second `request()` is short-circuited; after resolve, a third `request()` is admitted.
- **write-failed no-leak (AC2 detail):** the injected errno Error carries a `code` and a message; assert neither appears anywhere in the emitted event.

**Integration test — new `describe` in `src/main/daemonConnection.roundtrip.test.ts`** (AC1, reusing the in-file harness):

- Build a multi-chunk archive with `bundleFrames(archive, 16)`; `standUpRoundTrip(UNUSED_BUILD_REPLY, { buildReplyFrames: () => frames })` to reach `connected` through the real handshake.
- Construct a real orchestrator: `requestDebugBundle: (c) => connection.requestDebugBundle(c)`, `save: (b) => saveDebugBundle(tmpDir, b)` (a `mkdtemp`'d temp dir under `os.tmpdir()`, removed in cleanup), `emit: (e) => { emitted.push(e); waiter.notify() }`.
- `downloader.request()`; wait for a `debugBundleSaved` (or `debugBundleFailed`) in `emitted`.
- Assert: a `debugBundleSaved` event was emitted; its `path` is absolute; the file exists at that path; its bytes equal the served archive. Assert no `debugBundleFailed` and no session-level `failed` event.

Write test cases as scenarios in the project's vitest idiom — do not paste bodies from this spec.

## Open questions

None blocking. One implementation note: `categoryFor` may live as a module-local function or be exported for direct unit testing — either is fine; the AC2 tests can drive it through `consumer.fail` without a separate export, so keep it local unless a direct table test reads cleaner.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings — two explicit boundaries. Inbound: the renderer sends only the bare `{ type: 'requestDebugBundle' }`, validated by `isRendererCommand` (`commands.ts:63-65`) before the switch; it carries no payload, so there is no attacker-controlled field to smuggle a path, size, or count through, and `downloader.request()` receives no data at all. Outbound: `emit`'s type `(event: DaemonEvent) => void` is the boundary — the union has no field that can hold a token, key, frame, or bundle byte (`events.ts:8-10`), so a non-event or secret cannot cross by construction.
- **[Tokens, secrets, credentials]** N/A by design — this slice handles no token, key, or credential. The device token and server static key live in the secret store, are never referenced here, and the emitted events (number / path / enum) have no field that could carry one.
- **[File / storage operations]** No findings. Path traversal is structurally impossible: `saveDebugBundle(app.getPath('downloads'), bytes)` — the directory is fixed at the composition root and the filename parts are module constants (`saveDebugBundle.ts:19,28-30`), so no untrusted input (the bare command, the daemon-produced bytes) reaches a path segment. TOCTOU is closed by the inherited `flag: 'wx'` create-exclusive write (`saveDebugBundle.ts:38,50`) — no check-then-open gap. Storage scope: the bundle lands in the user's Downloads with `mode 0o600` owner-only permissions (`saveDebugBundle.ts:50`); Downloads is the semantically correct user-visible target the ticket specifies, and 0o600 limits at-rest exposure in a shared folder.
- **[Inter-process / Electron attack surface]** No findings — this slice adds **no new IPC channel and no new window**. It rides the existing `COMMAND_CHANNEL` (validated) and `DAEMON_EVENT_CHANNEL` (emit-only, typed), adding one `case` to the existing switch. The capability handed to the renderer is minimal: *trigger a diagnostic download to a fixed directory*; the renderer cannot choose the path, the content, or read the bytes. `webPreferences` (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`) are unchanged (`index.ts:39-40`). Process placement holds: the orchestrator lives in `src/main`, holds bytes only transiently (routes them to `save`), and no secret or socket reaches the renderer.
- **[Cryptographic primitives]** N/A by design — this slice does no crypto. It sits above the decrypted Noise layer; the handshake, AEAD, and key handling are entirely upstream in `daemonConnection` / `noiseSession`.
- **[Network & I/O]** No findings introduced here — this slice opens no socket; the bundle stream rides the already-established, TLS-enforced, `maxPayload`-capped relay session. See the OUT OF SCOPE stream-deadline finding below.
- **[Error messages, logs, telemetry]** No findings — the module is **log-free by design** (a `console.log` here could echo the saved path or become a seam that later logs the errno/bytes). The save-reject errno is caught and dropped, never logged or emitted. The `debugBundleSaved.path` reaching the renderer is required functionality (#72's "saved to X" affordance) and reveals nothing the renderer, running as the user, could not already infer.
- **[Concurrency]** No findings — the only async task is `save(bytes)`, owned by the `complete` closure; it always settles, emits its terminal, and clears `active`. No timer, interval, listener, or socket to leak or abort, so no `AbortController` is warranted. **No check-then-act race on `active`:** `request()` runs synchronously start-to-finish (the `if (active) return; active = true; …; requestDebugBundle(consumer)` sequence has no `await`), so two calls cannot interleave mid-body — the second executes in a later turn and observes `active === true`. This synchronous set-before-await is the crux of AC4 and the single-in-flight resource bound (a spamming renderer cannot spawn unbounded reassembler slots / saves).
- **[Threat model alignment]** Malicious/compromised relay (content-blind, on-path): reorder/gap/duplicate of bundle frames → reassembler fails `seq-mismatch` → `stream-corrupt` (no partial archive written); drop mid-stream → `connection-lost` → `unavailable`; it cannot read the bundle (inside the Noise session). Renderer compromise: a compromised renderer can only spam the bare command — capped by single-in-flight, path/content not renderer-chosen, bytes never returned — process isolation stops it reaching keys/socket/bytes. Hostile-but-authenticated daemon: malformed chunks → `stream-corrupt`; oversized bundle → memory (reassembler #116) or disk (`ENOSPC` → `write-failed`). **OUT OF SCOPE** — a never-terminating / slow-dribble bundle stream from an authenticated daemon leaves the download wedged (progress continues, no terminal fires, so `active` never clears and later requests are ignored). This is a pre-existing property of the #116 reassembler, not introduced by #169; the correct mitigation is a per-message read/idle deadline at the transport layer (`relayConnection` timeout discipline), not a stochastic timeout guessed in the orchestrator. No hang is observed today; deferred to transport timeout hardening, and a real socket drop still resolves it via the connection-lost net.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-08
