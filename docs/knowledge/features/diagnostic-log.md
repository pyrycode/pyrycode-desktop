# Content-free diagnostic log

The **connection-lifecycle diagnostics channel for the main process**: a small logger whose allowlist is the *envelope* of an event — its name, a static classification code, a byte length / count, and safe connection coordinates (hostname, path, HTTP/WS status) — **never the value inside**. It turns every transport module's "LOG-FREE by construction" into "**content-free-log by construction**," so a real connection bug leaves a diagnosable footprint instead of a silently classified-and-dropped error.

```ts
// src/main/diagnosticLog.ts — MAIN-PROCESS ONLY, Electron-free
export function createDiagnosticLog(deps: { sink: DiagnosticSink; now?: () => string }): DiagnosticLog
export interface DiagnosticLog { event(fields: DiagnosticEvent): void }
```

Introduced in [#126](../codebase/126.md); the connection-lifecycle slice of **Bucket 1** in the Diagnostics design. It ships the module + both sinks + the root wiring; the two consumers that actually *call* `event()` are [#127](../codebase/127.md) (relay leg — **shipped**, the first call sites) and [#128](https://github.com/pyrycode/pyrycode-desktop/issues/128) (daemon leg), and they stay independent of each other (see the decoupling seam below). The record shape and the allowlist-not-scrubber contract are [ADR 0007](../decisions/0007-content-free-diagnostics-by-construction.md).

## Why it exists

Every main-process transport module ([relay connection](relay-connection.md), [daemon connection](daemon-connection.md), [noise relay driver](noise-relay-driver.md), [noise session](noise-session.md)) classifies each caught error into a **static code** and DROPS the caught object, because an error message could echo a token, a key, or message plaintext ([ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — keys/bytes never leave the main process). That secret-safety is correct — but it also means a real connection bug reaches the UI only as a vague `connecting` / `failed` with zero diagnosis. The client dialing the relay without `/v1/client` (relay returned 404) took a long manual hunt that a single line — `event=relay-dial status=404 path=/` — would have made trivial. This module is the missing channel that carries exactly that line, and nothing secret.

## The content-free API — the security contract

The caller-facing allowlist is a **typed shape**. Every field is a safe *envelope* discriminant; the guarantee is the **absence** of any field shaped to carry a token, key, header map, URL, query string, or payload bytes — no index signature, no `Record`, no `unknown`.

```ts
export interface DiagnosticEvent {
  event: string    // required — the event name, a static literal at each site ('relay-closed')
  code?: string    // static classification ('pong-timeout', 'not-paired', 'malformed-hello-ack')
  status?: number  // an HTTP or WS status number (404, 1006, 1000, 1009)
  bytes?: number   // a byte length (an opaque frame's .length) — never the bytes
  count?: number   // a count (e.g. messages in a batch)
  host?: string    // a safe connection coordinate — the relay HOSTNAME only, never url.href/.search
  path?: string    // a safe path component ('/v1/client') only, never the query string
}
```

The guarantee is **structural, enforced by the type system at every call site** — not a runtime scrubber (a scrubber is a denylist and fails open; see [ADR 0007](../decisions/0007-content-free-diagnostics-by-construction.md)). The handle stamps the three fields the caller cannot supply and **never throws**:

- an echoed `event`, a monotonic `seq`, and a `ts` timestamp are added by the logger;
- the internal record `DiagnosticEvent & { seq: number; ts: string }` is serialized to **one line of JSON** (`JSON.stringify`) in the core — once, not per-sink, so both sinks emit byte-identical records — and handed to `sink.write(line)`.

JSON-lines is greppable, diffable, and **injection-safe**: `JSON.stringify` escapes any embedded newline, so a string field can never split one record into two lines.

## The two sinks

Both live in `src/main/diagnosticLogSinks.ts`, import only `node:fs` / `node:path` (no Electron), and unit-test against a capture writer / temp dir.

- **`stdoutSink(write?)`** — writes `line + '\n'` to the injected writer (default `process.stdout.write`). The injected writer is the test seam. Selected on the **dev** path.
- **`fileRotatingSink(dir, { maxBytes ≈ 5 MiB, maxFiles ≈ 5 })`** — appends records to `dir/main.log` and **rotates by size with bounded retention**. Selected on the **packaged** path (`join(userData, 'logs')`). Reuses [`fileSecretPersistence`](secure-store.md)'s disk patterns but with the **sync** `fs` variants and an **append-and-rotate** write shape (not the precedent's whole-file temp-then-`rename`):
  - `mkdirSync(dir, { recursive: true, mode: 0o700 })` on first write (owner-only dir), `appendFileSync(path, entry, { mode: 0o600 })` (owner-only file);
  - size via `statSync`, `isErrnoException`-guarded with `ENOENT → size 0` (open/stat-then-handle-ENOENT, **no `existsSync`**, no TOCTOU);
  - **rotation:** before an append that would push `main.log` past `maxBytes`, rename-shift `main.log`→`.1`→…→`.maxFiles`, unlinking the old `.maxFiles`; each rename/unlink errno-guarded (a missing intermediate is a no-op);
  - the rotation guard is `size > 0 && size + byteLength(entry) > maxBytes`, so a lone over-cap entry still lands (rotation can't shrink it) and an empty log is never rotated — the bound is on rotated **file count**, not on any single record.

**Observable retention:** at most `maxFiles` rotated files plus the active `main.log` ever exist; the oldest is discarded on each rotation; the file set never grows unbounded. Filenames are the static literals `main.log` / `main.log.N` — derived from **no** event field, so there is not even an encoded-name traversal surface.

## The composition-root wiring + the #127/#128 decoupling seam

**Decision: construct-and-hold the singleton in #126 at the root** (mirroring how [`secureStore`](secure-store.md) is built once and consumed by several stores). One main process = one logger (one `seq` counter, one file). In `src/main/index.ts`, inside `app.whenReady()`, false-first on `app.isPackaged`:

```ts
const diagnosticLog = createDiagnosticLog({
  sink: app.isPackaged ? fileRotatingSink(join(app.getPath('userData'), 'logs')) : stdoutSink()
})
createDaemonConnection({ …, diagnosticLog })
```

This is the choice that keeps **#127 and #128 independent** (neither `blocked-by` the other): both consume the *same* pre-built instance, and neither owns construction. Deferring construction to "the first consumer" would force the second to be `blocked-by` the first (it must read a dep the first added) — the exact serialization the split forbids. `createDaemonConnection` is the one construction point under which the whole transport stack hangs, so injecting there is what lets both legs reach it: #128 uses `deps.diagnosticLog` directly in the daemon-event choke point; [#127](../codebase/127.md) routes it the last leg by adding one property (`diagnosticLog: deps.diagnosticLog`) to the per-dial `connection` blob `loadDialConfig` builds — which already spreads verbatim through `NoiseRelayDriverConfig` → `RelaySupervisorConfig` down to `relayConnection` as `Omit<RelayConnectionConfig, 'onEvent'>`, so the optional field threads down with **no** driver/supervisor edit.

**#126 adds no log call sites.** `daemonConnection.ts` gains only an optional `diagnosticLog?: DiagnosticLog` on `DaemonConnectionDeps` (+ the type import); the interface field + the root injection are the whole seam.

> **Downstream note:** #127 and #128 will both edit `daemonConnection.ts` — their architect runs must apply the file-overlap check and serialize if both are in-flight concurrently.

## Concurrency + shutdown

- **Synchronous file sink — deliberate.** `event()` is a fire-and-forget call from deep inside transport error handling; it must be synchronous, ordered, and non-throwing. Sync `fs` gives per-call completion, so records land in `seq` order with **no append interleaving and no rotation race** — the battle-tested logger shape (pino's default fd writes). Async `fs/promises` (as in `fileSecretPersistence`, which writes one whole file) would need a serialization queue and floating-promise handling for no benefit; the reuse is the *patterns* (dir seam, errno guard, modes), not the async-ness.
- **Single-writer `seq`.** A module-local counter incremented inside `event()`, which has no `await` — no check-then-act gap, so `seq` is strictly monotonic and gap-free per process. Starts at 0.
- **Shutdown-safe.** Each append is durable per call, so there is no buffered tail lost on `app.quit` / process kill. No timers, no listeners, nothing to leak on window close.

## Security posture

`security-sensitive`; architect self-review verdict **PASS** (the ticket's whole deliverable *is* a security property). See [ADR 0007](../decisions/0007-content-free-diagnostics-by-construction.md) for the full rationale.

- **MUST-NOT-log is structurally impossible.** No field carries message bodies, Noise transcripts, keys, tokens, full headers, or URL query strings. The type *is* the enforcement; a runtime scrubber is explicitly rejected (fails open).
- **No secret is ever available to leak.** The logger generates, holds, and stores no token/key/credential (no RNG, no comparison, no persistence of a secret). A stolen `main.log` leaks nothing. The transport's classify-then-drop discipline is unchanged; the logger only ever receives the already-classified `code`.
- **A sink throw never escapes a log call.** The core wraps `sink.write` in try/catch and swallows — a full disk / permission error silently drops the line rather than taking down the connection it observes.
- **Main-process only.** No Electron import in the module, no IPC channel, no `contextBridge` surface, no `BrowserWindow` — unreachable from a compromised renderer. The only Electron touch is the `app.isPackaged` / `getPath('userData')` selection in the composition root.
- **Residual (documented, code-review checklist per consumer).** `event` / `code` / `host` / `path` are `string`; the type cannot forbid a *confused caller* stuffing a secret into a string field. Mitigation is a deterministic code-review checklist on the (few) call sites: static literals for `event`/`code`, `new URL(u).hostname` / `.pathname` for `host`/`path` — **never** `url.href` or `url.search`. Applied and **confirmed clean** for [#127](../codebase/127.md)'s three relay-leg sites; #128's daemon-leg sites inherit the same check.

## Forward-compatibility (deferred — #125)

The broader Bucket-1 log (state-store transitions, a payload **hash + length + type**, a shared **correlation id**) is [#125](https://github.com/pyrycode/pyrycode-desktop/issues/125). The record shape is designed so those slot in as **additive optional fields** (`hash?` / `len?` / `payloadType?` / `corr?`) without breaking existing call sites or the serializer — which is exactly why the serializer spreads `{ ...fields, seq, ts }` rather than hand-picking fields. Build none of them now.

## Related

- [#126 codebase notes](../codebase/126.md) — implementation summary, patterns, lessons, and the carried-forward code-review NIT.
- [ADR 0007](../decisions/0007-content-free-diagnostics-by-construction.md) — content-free-by-construction: allowlist the envelope, enforced by the type system, not a runtime scrubber. The decision this feature realizes.
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — keys/bytes never reach the renderer; the boundary the logger stays main-process-only to preserve.
- [Daemon connection](daemon-connection.md) — the transport composition point the singleton is injected into; #128's daemon-leg call sites live here.
- [Relay connection](relay-connection.md) / [#127](../codebase/127.md) — the static close reasons (`connect-timeout`/`pong-timeout`/`max-frame-exceeded`/`connect-error`), WS close codes (1000/1006/1009), and the HTTP upgrade `status` (404) that ground the allowlist's `code`/`status`; the shipped relay-leg call sites (`relay-open`/`relay-unexpected-response`/`relay-closed`).
- [Secure store](secure-store.md) / [#42](../codebase/42.md) — hosts [`fileSecretPersistence`](secure-store.md), whose disk patterns the file sink reuses (injected `dir`, `isErrnoException`, `0o700`/`0o600`, no-`existsSync`), and whose construct-once-at-the-root idiom the singleton mirrors. The write shape (append-and-rotate, sync) is the deliberate exception.
