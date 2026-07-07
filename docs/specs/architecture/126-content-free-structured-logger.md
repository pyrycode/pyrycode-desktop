# Spec #126 — Content-free structured logger for the main process

Split from #124. This is the connection-lifecycle slice of **Bucket 1** in the Diagnostics
design: it turns every transport module's "LOG-FREE by construction" into "content-free-log
**by construction**." Its two consumers — relay-wiring (#127) and daemon-wiring (#128) — depend
on this module and stay independent of each other.

## Files to read first

- `src/main/secureStore.ts:1-100` — **the core+injected-adapter DI shape to mirror.** An interface
  (`SecretPersistence`) + an Electron-free core factory (`createSecureStore({deps})`) + a
  "LOG-FREE by construction" doc-comment stating the security posture up front. The logger is the
  same skeleton: injected `DiagnosticSink`, Electron-free core factory, security contract in the
  header comment.
- `src/main/fileSecretPersistence.ts:1-68` — **the fs-adapter precedent to REUSE.** Injected `dir`;
  `mkdir(dir, { recursive: true, mode: 0o700 })`; the `isErrnoException` typed-errno guard;
  open-then-handle-ENOENT (no `existsSync`, no TOCTOU); `0o600` file mode. **Do NOT copy** its
  whole-file temp-then-`rename` write — the file sink *appends and rotates* (a different write
  shape, and it uses the **sync** `fs` variants — see § Concurrency).
- `src/main/fileSecretPersistence.test.ts:1-93` — **the temp-dir test harness to mirror.**
  `mkdtemp` root + `rm` in `afterEach`; `freshDir()` returns a *non-existent* subdir so the first
  write is what creates it (lets you observe the dir mode); mode assertions gated on
  `it.runIf(process.platform !== 'win32')`. The file-sink test reuses this shape exactly.
- `src/main/index.ts:117-151, 161-172` — **the composition root.** How `secureStore` is built once
  (`createSecureStore(...)`) and handed to several downstream stores; and how `app.isPackaged` +
  `process.env` drive a **false-first** effectful selection (`selectSecretEncryption`,
  `selectRelayPolicy`) with `app.getPath('userData')` sourcing the on-disk path. The logger
  singleton construction + `app.isPackaged ? fileRotatingSink(…) : stdoutSink()` selection lands
  in this idiom and is injected into `createDaemonConnection`.
- `src/main/daemonConnection.ts:40-68` — **`DaemonConnectionDeps` (the injection seam you extend
  with `diagnosticLog?`)** plus the `messageFor` / `emitFailed` **classify-then-drop** pattern:
  static `code` strings (`not-paired`, `malformed-hello-ack`, `connection-closed`, `connect-failed`)
  and the caught object dropped. These codes are exactly what consumer #128 feeds the logger —
  they ground the allowlist's `code` field. (Lines 146-210 show the emit sites.)
- `src/main/transport/relayConnection.ts:34-61` — **`RelayConnectionConfig` + `RelayEvent`.** The
  static close reasons (`connect-timeout` / `pong-timeout` / `max-frame-exceeded` / `connect-error`),
  the WS close codes (1000 / 1006 / 1009), and the opaque `frame: Uint8Array` whose `.length` is the
  only safe thing to log. Grounds the allowlist's `code` / `status` / `bytes` fields — consumer #127.
- Diagnostics design doc (vault, read via QMD:
  `mcp__qmd__get("second-brain/1f4cb-projects/2026-07-02-pyrycode-desktop/diagnostics.md")`) —
  sections **"Bucket 1"**, **"Won't an allowlist lose the signal we need?"**, and **"Why not just
  scrub the secrets out"**. The security rationale: allowlist the *envelope* of every event, never
  a fixed named-field list; a runtime scrubber is a denylist that fails open. This ticket is the
  always-on, content-free tier-1 log described there.
- `docs/knowledge/decisions/0002-remote-head-over-relay-shared-wire.md` — the keys/bytes-never-reach-
  the-renderer boundary (ADR 0002, cited across `src/main`). Confirms the logger stays main-process-only.
- `package.json` — confirm **no new dependency** is needed. Node `fs` / `path` + `JSON` cover the
  whole design; a size-capped append-and-rename is a few dozen lines (CLAUDE.md: no unjustified deps).

## Context

Every main-process transport module classifies each caught error into a **static code** and DROPS
the caught object, because an error message could echo a token, a key, or message plaintext. That
secret-safety is correct — but it also means a real connection bug reaches the UI only as a vague
"connecting" / "failed" with zero diagnosis. The client dialing the relay without `/v1/client`
(relay returned 404) took a long manual investigation that a single log line — `event=relay-dial
status=404 path=/` — would have made trivial.

This ticket introduces the missing channel: a small logger whose **allowlist is the envelope** of an
event (its type, static code, size, safe connection coordinates), never the value inside. The
guarantee is enforced by the **type system at every call site** — a typed shape, not a
`Record<string, unknown>` scrubbed at runtime (a scrubber is a denylist and fails open). #126 ships
the module + both sinks + the factory + tests, and the one-time composition-root construction that
lets #127 and #128 consume the *same* instance without depending on each other.

## Design

### Module layout

Two new Electron-free production files under `src/main/` (the logger is a cross-cutting main-process
*service*, alongside `secureStore.ts` / `fileSecretPersistence.ts` — **not** under `transport/`,
which houses the semantics-blind wire pipeline):

| File | Contents |
|------|----------|
| `src/main/diagnosticLog.ts` (NEW) | `DiagnosticEvent` (the allowlist), `DiagnosticSink`, `DiagnosticLog`, the internal record shape + serializer, and `createDiagnosticLog`. Imports nothing but its own types. |
| `src/main/diagnosticLogSinks.ts` (NEW) | `stdoutSink` and `fileRotatingSink`. Only `node:fs` / `node:path` — no Electron. |

Two small seam edits (see § Composition-root wiring):

| File | Change |
|------|--------|
| `src/main/index.ts` (MOD) | Construct the singleton, select the sink by `app.isPackaged`, pass it into `createDaemonConnection`. ~6 lines. |
| `src/main/daemonConnection.ts` (MOD) | Add `diagnosticLog?: DiagnosticLog` to `DaemonConnectionDeps` (+ import). No call sites — those are #128. ~2 lines. |

### The content-free API — the security contract (AC1)

The caller-facing allowlist. Every field is a safe *envelope* discriminant. The security guarantee
is the **absence** of any field shaped to carry a token, key, header map, URL query string, or
payload bytes — enforced structurally by the type, not by a runtime scrubber. No index signature,
no `Record`, no `unknown`.

```ts
/** Caller-facing allowlist of content-free envelope fields. There is deliberately NO field for a
 *  token, key, header map, URL, query string, or payload bytes. See § Security review. */
export interface DiagnosticEvent {
  event: string    // required — the event name, e.g. 'relay-closed', 'daemon-failed'
  code?: string    // static classification, e.g. 'pong-timeout', 'not-paired', 'malformed-hello-ack'
  status?: number  // HTTP or WS status number, e.g. 404, 1006, 1000, 1009
  bytes?: number   // a byte length (an opaque frame's .length) — never the bytes
  count?: number   // a count (e.g. number of messages in a batch)
  host?: string    // safe connection coordinate — the relay HOSTNAME only, never url.href/url.search
  path?: string    // safe path component ('/v1/client') only, never the query string
}
```

The handle stamps the record fields the caller cannot supply and never throws:

```ts
export interface DiagnosticLog {
  /** Stamp seq + ts onto the allowlisted fields, serialize, write to the sink. Never throws (AC3). */
  event(fields: DiagnosticEvent): void
}
```

### Record shape + serialization (AC1, AC4)

The logger builds an internal record = the allowlisted fields **plus** the three it owns —
`event` (echoed), a monotonic `seq`, and a `ts` timestamp — and serializes it to a **single-line
JSON string** (`JSON.stringify`), which it hands to `sink.write(line)`.

- Serialization lives in the **core**, once — not per-sink — so both sinks emit byte-identical
  records (no format drift; the Diagnostics doc wants the log greppable/diffable) and the
  content-free guarantee is a single auditable choke point testable with no sink at all.
- JSON-lines is greppable, diffable, and **injection-safe**: `JSON.stringify` escapes any embedded
  newline, so a string field can never split one record into two lines.

Internal record type (not exported): `DiagnosticEvent & { seq: number; ts: string }`.

### `DiagnosticSink` + `createDiagnosticLog` (AC2, AC3)

```ts
export interface DiagnosticSink {
  /** Write one already-serialized record as a single line. Synchronous. May throw — the logger
   *  swallows it (a diagnostics sink must not take down the transport it observes). */
  write(line: string): void
}

export function createDiagnosticLog(deps: {
  sink: DiagnosticSink
  now?: () => string   // injected clock; default () => new Date().toISOString() (mirrors daemonConnection.now)
}): DiagnosticLog
```

`event()` behavior (contract, not code): increment the module-local `seq`; build the record with
`now()` and the echoed fields; `JSON.stringify`; call `sink.write(line)` **inside a try/catch that
swallows** any throw. Asserted by the throwing-sink test (AC3).

### The two sinks (AC2)

**`stdoutSink(write?: (chunk: string) => void): DiagnosticSink`** — writes `line + '\n'` to the
injected writer, defaulting to `process.stdout.write.bind(process.stdout)`. The injected writer is
the test seam (capture into an array). One serialized record per line.

**`fileRotatingSink(dir: string, opts?: { maxBytes?: number; maxFiles?: number }): DiagnosticSink`** —
appends records to `dir/main.log` and rotates by size with bounded retention. Reuses
`fileSecretPersistence`'s patterns with the **sync** `fs` variants:

- `mkdirSync(dir, { recursive: true, mode: 0o700 })` on first write (owner-only dir).
- Append with `appendFileSync(path, line + '\n', { mode: 0o600 })` (owner-only file).
- Size check via `statSync`, guarded by `isErrnoException` + `ENOENT` → treat as size 0 (open/stat-
  then-handle-ENOENT; **no `existsSync`**, no TOCTOU).
- **Rotation (rename-shift):** before an append that would push `main.log` past `maxBytes`, shift
  `main.log.(N-1)`→`.N`, …, `main.log.1`→`.2`, `main.log`→`.1`, discarding the old `.N`. Each rename
  is errno-guarded (a missing intermediate file is a no-op, not a throw). Then append to a fresh
  `main.log`.
- **Bounded retention (AC2 observable):** at most `maxFiles` rotated files (`.1`…`.maxFiles`) plus
  the active `main.log` ever exist; the oldest (`.maxFiles`) is unlinked on each rotation. The set
  never grows unbounded.
- Defaults: `maxBytes` ≈ 5 MiB, `maxFiles` ≈ 5 (developer picks concrete values; the *invariant* —
  bounded file count — is what the test pins, not the exact numbers).

No new dependency: `node:fs` (`mkdirSync`, `appendFileSync`, `statSync`, `renameSync`, `unlinkSync`),
`node:path` (`join`), and `JSON` cover everything.

### Composition-root wiring + the #127/#128 decoupling seam

**Decision: construct-and-hold the singleton in #126 at the root** (mirroring how `secureStore` is
built once and consumed by several stores). This is the choice that keeps #127 and #128 independent
(neither `blocked-by` the other): both consume the *same* pre-built instance, and neither owns
construction. Deferring construction to "the first consumer" would force the second to be
`blocked-by` the first (it must read a dep the first added) — the exact serialization the split
forbids. So #126 does the wiring:

- In `src/main/index.ts` (inside `app.whenReady()`), false-first on `app.isPackaged`:
  `const diagnosticLog = createDiagnosticLog({ sink: app.isPackaged ?
  fileRotatingSink(join(app.getPath('userData'), 'logs')) : stdoutSink() })`.
- Pass it into the single transport composition point: `createDaemonConnection({ …, diagnosticLog })`.
  This is the one construction call under which the whole transport stack hangs (daemonConnection
  builds the driver, which builds the relay connection), so injecting here is what lets **both**
  consumers reach it — #128 uses `deps.diagnosticLog` directly in the daemon-event choke point;
  #127 threads it down through `NoiseRelayDriverConfig` to the relay connection.
- In `src/main/daemonConnection.ts`, add `diagnosticLog?: DiagnosticLog` to `DaemonConnectionDeps`
  (optional) and import the type. **#126 adds no log call sites** — the interface field + the root
  injection are the whole seam. `noUnusedLocals` is off (only `strict`), so an accepted-but-unused
  optional dep compiles clean.

> **Downstream note (not #126 scope):** #127 and #128 will both edit `daemonConnection.ts` (relay-
> threading vs. daemon-leg call sites). Their architect runs must apply the file-overlap check and
> serialize if both are in-flight concurrently.

## State + concurrency model

- **Synchronous file sink — deliberate.** `event()` is a fire-and-forget call from deep inside
  transport error handling; it must be synchronous, ordered, and non-throwing. Sync `fs`
  (`appendFileSync` + `renameSync`) gives per-call completion, so records land in `seq` order with
  **no append interleaving and no rotation race** — the standard battle-tested logger shape (e.g.
  pino's default fd writes). Async `fs/promises` (as in `fileSecretPersistence`, which writes one
  whole file) would require a serialization queue and floating-promise rejection handling for no
  benefit here; the write shape is different, so the reuse is the *patterns* (dir seam, errno guard,
  modes), not the async-ness. The brief event-loop block per log is acceptable for a
  connection-lifecycle logger (not a hot path).
- **Single-writer sequence counter.** `seq` is a module-local counter incremented inside `event()`,
  which has no `await` — it runs to completion with no check-then-act gap, so `seq` is strictly
  monotonic and gap-free per process.
- **One process = one logger.** The singleton (one counter, one `main.log`) is constructed once at
  the root; there is no second instance and no parallel mutable state.
- **Shutdown safety.** Because each append is synchronous and durable per call, there is no buffered
  tail lost on `app.quit` / process kill. No timers, no listeners, no long-lived async task to tear
  down (nothing to leak on window close).

## Error handling

- **A sink throw never escapes a log call (AC3).** The core wraps `sink.write` in try/catch and
  swallows. A diagnostics logger observing the transport must not be able to crash it. Asserted by a
  test that injects a throwing sink and expects `event()` to return normally.
- **fs errors in the file sink** are errno-guarded with `isErrnoException` (reused from
  `fileSecretPersistence`): `ENOENT` on `statSync` / `renameSync` of a not-yet-existing file is a
  no-op (treat size as 0 / skip the shift), not a throw. Any other fs error propagates out of the
  sink and is swallowed by the core's try/catch — a full disk or a permission error silently drops
  the log line rather than taking down the connection.
- **No secret is ever available to leak.** The caught-object-drop discipline stays in the transport
  modules (unchanged); the logger only ever receives already-classified allowlisted fields. There is
  no code path from a caught `Error`, a header map, a URL, or a payload buffer into a log record.

## Testing strategy

`npm test` (vitest). Two test files mirroring the existing `*.test.ts` split.

`src/main/diagnosticLog.test.ts` (core — no fs, capture sink `(line) => lines.push(line)`):

- **Allowlisted round-trip + stamped fields (AC1).** `event({ event: 'relay-closed', status: 1006,
  code: 'pong-timeout' })` → the captured line parses to an object carrying `event`, `code`,
  `status`, plus a `seq` and a `ts`.
- **Monotonic seq (AC1).** Three `event()` calls → `seq` is 0,1,2 (or 1,2,3 — pin whichever the impl
  starts at), strictly increasing, gap-free.
- **Injected clock (AC1).** A fixed `now: () => '2026-01-01T00:00:00.000Z'` → every record's `ts`
  equals it (deterministic; no wall-clock flake).
- **Content-free guarantee (AC4).** Declare test locals for a fake bearer token, a base64 key, and a
  message-plaintext string. Emit a representative event set (relay-connected; relay-closed
  status 1006 code pong-timeout; daemon-failed code not-paired; message-received count 3 bytes 512;
  relay-dial host+path). Assert the joined output contains **none** of the three planted secrets —
  demonstrating there is no API parameter by which they could reach the sink.
- **Throwing sink is swallowed (AC3).** Sink whose `write` throws → `expect(() =>
  log.event({ event: 'x' })).not.toThrow()`.
- **Injection-safety (defensive).** A field value containing `'\n'` still produces exactly one line
  (JSON escapes it) — the record count equals the call count.

`src/main/diagnosticLogSinks.test.ts` (sinks — temp dir via the `fileSecretPersistence.test.ts`
harness: `mkdtemp` + `rm` afterEach, `freshDir()` a non-existent subdir):

- **stdout sink (AC2).** Injected writer captures; `write('{...}')` appends exactly one line with a
  trailing newline.
- **File sink appends (AC2).** Two writes → `main.log` holds two lines, in order.
- **File sink rotates + bounded retention (AC2 observable).** With a tiny `maxBytes` and small
  `maxFiles`, write enough records to cross the cap several times; assert the on-disk file set is
  `main.log` + at most `maxFiles` rotated files (never more), and that the oldest content is the one
  discarded (the file set does not grow with continued writes).
- **File modes (AC2/security), gated `it.runIf(process.platform !== 'win32')`.** `dir` is `0o700`,
  `main.log` is `0o600` — mirrors `fileSecretPersistence.test.ts`.
- **First-write creates the dir (no existsSync/TOCTOU).** `freshDir()` points at a non-existent
  subdir; the first `write` creates it with the right mode.

Type coverage: `npm run typecheck` confirms `DiagnosticEvent` rejects a `token` / `headers` / `url`
/ payload field at the type level (a compile-time negative — the allowlist *is* the enforcement).
The added optional `DaemonConnectionDeps.diagnosticLog` typechecks with existing call sites unchanged.

## Forward-compatibility (do NOT build — #125)

The broader Bucket-1 log (state-store transitions, a payload **hash + length + type**, a shared
**correlation id**) is #125. Design the record so those are **additive optional fields**, non-
breaking: a future `hash?` / `len?` / `payloadType?` group and a `corr?` field slot into
`DiagnosticEvent` as new optional properties; existing call sites and serialization are unaffected.
Build none of them now — just don't foreclose them (e.g. don't make the record a closed tuple or a
positional format).

## Open questions

- **Concrete `maxBytes` / `maxFiles` defaults.** The spec pins the *invariant* (bounded file count,
  oldest discarded), not the numbers. Developer picks sane defaults (≈5 MiB / ≈5 files); the test
  drives tiny values to exercise rotation quickly.
- **`seq` start value (0 vs 1).** Cosmetic; pin one and assert it. No downstream dependency (the
  daemon correlation id in #125 is separate).
- **stdout vs stderr for the dev sink.** Spec says stdout (AC2 says "stdout sink"). If a future
  consumer wants diagnostics off the app's stdout stream, that's a #125/#127 concern, not here.

## Security review

**Verdict:** PASS

This ticket's whole deliverable *is* a security property (content-free-**by-construction**), so the
review is adversarial about the one thing that matters: can any code path put a secret into the log?

**Findings:**

- **[Trust boundaries] SHOULD FIX (residual, documented).** The logger parses no untrusted input —
  it is a *sink* for already-classified fields from the transport modules. The boundary that matters
  is the allowlist, and it is explicit and single: the `DiagnosticEvent` type in `diagnosticLog.ts`.
  The type **structurally eliminates the secret-carrying shapes** — there is no `headers`, `url`,
  `token`, `key`, or payload-bytes field. Residual: `event` / `code` / `host` / `path` are `string`,
  and the type cannot forbid a *confused caller* from stuffing a secret into a string field. This is
  not the observed failure mode (which was a dropped classified error, now closed) and the field
  names signal intent, so it is SHOULD FIX, not MUST FIX. Mitigation, for #127/#128 code-review: each
  call site passes **static literals** for `event`/`code` and **coordinates** for `host`/`path`
  (`new URL(u).hostname` / `.pathname`), **never** `url.href` or `url.search`. Belt-and-suspenders is
  a deterministic code-review checklist on the (few) call sites, not another stochastic rule.

- **[Tokens / secrets] No findings.** The logger generates, holds, and stores **no** token, key, or
  credential — no RNG, no comparison, no persistence of a secret. A stolen `main.log` leaks nothing
  because nothing secret can reach it (the design goal). The transport's classify-then-drop discipline
  (`daemonConnection.ts:96-99` `messageFor`, and the `RelayEvent` sink) is unchanged and remains the
  place secrets are dropped; the logger only ever receives the classified `code`.

- **[File / storage] No findings.** `fileRotatingSink` writes under `join(app.getPath('userData'),
  'logs')` — the per-user data dir, not a temp or synced folder — with `0o700` dir / `0o600` file
  (reused from `fileSecretPersistence.ts:43,48`), errno-guarded, no `existsSync` TOCTOU. **No path
  traversal:** the filenames are the static literals `main.log` / `main.log.N`, derived from **no**
  event field, so unlike `fileSecretPersistence` there is not even an encoded-name surface. Atomic
  whole-file writes are not needed (append-and-rotate; a crash mid-append truncates at most the last
  JSON line, tolerable for a diagnostics log; the rename in rotation is atomic on one filesystem).
  Bounded retention (AC2) caps disk use — no unbounded-log-file disk-fill vector; each record is
  bounded (allowlisted scalars, no payload), so no single-record cap blow-out.

- **[Electron attack surface] No findings.** The logger module imports **no** Electron API (AC3),
  lives entirely in `src/main`, adds **no** IPC channel, **no** `contextBridge` surface, and **no**
  `BrowserWindow`. It never crosses `ipcMain` / `contextBridge`, so nothing renderer-side can read the
  log or feed it. The only Electron touch is the `app.isPackaged` / `app.getPath('userData')`
  selection in `index.ts` (already imports `app`; window `webPreferences` unchanged).

- **[Cryptographic primitives] N/A by design.** The logger does no crypto and no secret comparison.
  The relevant guarantee is the *inverse*: handshake keys, ephemeral/static keys, nonces, and Noise
  transcripts have **no field** to be logged into — the same structural allowlist that closes the
  token case closes this one.

- **[Network & I/O] N/A by design.** The logger performs no network I/O. It *observes* network
  outcomes (`status` close codes 1000/1006/1009, HTTP 404) as content-free discriminants fed by the
  consumer. The `ws` `maxPayload` / connect / idle timeouts stay in `relayConnection.ts` (unchanged);
  the logger adds no socket and no frame parsing.

- **[Error messages / logs / telemetry] No findings — the core category.** MUST-NOT-log (message
  bodies, Noise transcripts, keys, tokens, full headers, URL query strings) is **structurally
  impossible** — no field carries them. MUST-log (event, code, status, host, path, seq, ts) is exactly
  the allowlist. Log files are `0o600` under `userData/logs`, **rotated + size-capped** (AC2), so no
  verbose unbounded file accrues. Nothing pipes to the renderer DevTools console (main-process only).
  No external telemetry — the log is local and content-free ("ships freely" per Bucket 1).
  JSON-line serialization escapes embedded newlines, so a string field cannot inject a forged log line.

- **[Concurrency] No findings.** The synchronous sink makes `event()` ordered and non-interleaving
  (single-writer `seq`, no `await`), with no rotation race. A throwing sink is swallowed (AC3), so the
  logger cannot take down the transport it observes. No long-lived async task, timer, or listener →
  nothing to cancel or leak on window close; sync appends are durable per call, so no buffered tail is
  lost on `app.quit`. One singleton = no duplicate-logger / double-file state.

- **[Threat model] Addressed / deferred.** *Malicious relay* (on-path, content-blind): it can supply
  a WS close `reason` string, but the logger has **no free-text `reason`/`message` field** — the
  consumer maps to a static `code`, so a hostile relay cannot inject content into the log through the
  close reason. *Token theft from disk*: the content-free log raises no additional bar to lower — it
  holds no secret. *Hostile daemon response*: parsed defensively in `daemonConnection` (unchanged); the
  logger sees only the classified `code`. *Renderer compromise reaching transport*: the logger is
  main-process-only with no IPC, unreachable from a compromised renderer. **OUT OF SCOPE:** payload
  `hash + length + type` and the shared correlation id (still content-free, but payload-adjacent) —
  deferred to **#125**, and the record shape is designed to accept them as additive optional fields.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-08
