# 0007 — Content-free diagnostics by construction: allowlist the envelope, not a runtime scrubber

## Status

Accepted, 2026-07-08. First realized in [#126](../codebase/126.md) (the connection-lifecycle slice of Bucket 1). Consumed by the relay leg ([#127](../codebase/127.md)), the daemon leg ([#128](../codebase/128.md)), and the inbound-decode boundary ([#130](../codebase/130.md)); the last **extended the allowlist non-breaking** with the payload-hash field (`hash?`), the first concrete proof of the additive-field property below. Further Bucket-1 slices (state transitions, correlation id) are deferred (#125). See the [diagnostic-log feature doc](../features/diagnostic-log.md).

## Context

Every main-process transport module ([relay connection](../features/relay-connection.md), [daemon connection](../features/daemon-connection.md), [noise relay driver](../features/noise-relay-driver.md), [noise session](../features/noise-session.md)) is **"LOG-FREE by construction"**: it classifies each caught error into a static code and DROPS the caught object, because an error message could echo a token, a key, or message plaintext ([0002](0002-remote-head-over-relay-shared-wire.md) — keys/bytes never leave the main process; the security model mirrors mobile).

That secret-safety is correct, but it has a cost: a real connection bug reaches the UI only as a vague `connecting` / `failed` with zero diagnosis. The client dialing the relay without `/v1/client` (relay returned 404) took a long manual investigation that a single log line — `event=relay-dial status=404 path=/` — would have made trivial. The Diagnostics design (Bucket 1) calls for an always-on, ships-freely tier-1 log to close that gap.

The open question this ADR settles: **how do you add a log channel to a system whose whole discipline is dropping the caught object, without reopening the leak that the drop closed?** Two mechanisms are on the table:

1. **Log the caught object, then scrub the secrets out at write time** — a runtime denylist (regex / known-key stripping over an arbitrary `Record<string, unknown>` payload).
2. **Accept only an allowlisted *envelope*** — a typed shape of safe discriminants, with no field capable of carrying a secret in the first place.

## Decision

**Content-free-log by construction: the logger accepts only a typed allowlist of envelope fields, and the content-free guarantee is enforced by the type system at every call site — not by a runtime scrubber.**

The allowlist is the `DiagnosticEvent` interface in `src/main/diagnosticLog.ts`:

```ts
export interface DiagnosticEvent {
  event: string    // the event name (required); code?, status?, bytes?, count?, host?, path? optional
}
```

The security property is the **absence** of any field shaped to carry a token, key, header map, URL, query string, or payload bytes — and the absence of an index signature, `Record`, or `unknown` that would let one in. The logger stamps three fields the caller cannot supply (`event` echoed, a monotonic `seq`, a `ts`), serializes the record to **one line of JSON** in the core (once, not per-sink), and hands it to an **injected `DiagnosticSink`**. A sink throw is swallowed — a diagnostics logger observing the transport must not be able to crash it.

The single logger is **constructed once at the composition root** (`app.isPackaged ? fileRotatingSink(userData/logs) : stdoutSink()`) and injected into `createDaemonConnection`, so the two consumer legs share one instance without depending on each other.

## Rationale

- **A runtime scrubber is a denylist and fails open.** A scrubber must enumerate every secret shape it strips; the first shape it doesn't anticipate (a new header name, a nested object, a URL with the token in the query string) passes straight through. The failure mode is a *silent* leak — the log looks scrubbed. An allowlist is the inverse: the default is "nothing," and each safe field is added deliberately. The first shape nobody anticipated simply has no field to travel in — it fails *closed*. For a module whose entire reason to exist is a secret-safety guarantee, fail-closed is the only acceptable default.
- **Enforced at the type, so the guarantee is checked by the build, not by discipline.** Because `DiagnosticEvent` has no secret-carrying field, a call site that tries to pass `token` / `headers` / `url` / `payload` is a **compile error** (excess-property check). `tsconfig.node.json` includes `src/main/**/*` (test files too), so `npm run typecheck` — part of the QA gate — fails the moment a secret-carrying field ever becomes assignable. The allowlist *is* the enforcement, and the build pins it (a `@ts-expect-error` regression test makes the negative explicit).
- **The envelope carries the diagnostic signal without the value.** The Diagnostics design's "won't an allowlist lose the signal?" answer: the *envelope* of an event — its type, static code, size, timing, and safe connection coordinates — is what diagnoses a connection failure. `event=relay-dial status=404 path=/` is the whole fix for the 404 hunt; the token, the URL query, and the response body add nothing a diagnostician needs and everything an attacker wants.
- **Synchronous fs for the file sink.** `event()` fires from deep inside transport error handling and must be ordered and non-throwing. Sync `fs` gives per-call completion — records land in `seq` order with no interleaving and no rotation race, and no buffered tail is lost on `app.quit`. This is the standard logger shape (pino's fd writes); async would need a serialization queue for no benefit.
- **Construct-once-at-the-root, injected.** One main process = one logger (one `seq`, one file). Building it at the composition root and injecting the *same* instance is what keeps #127 and #128 independent — deferring construction to "the first consumer" would force the second to be `blocked-by` the first. Mirrors how [`secureStore`](../features/secure-store.md) is built once and consumed by several stores ([0005](0005-secret-at-rest-safestorage-fail-closed.md)).

## Consequences

- **New safe fields are additive, non-breaking.** [#130](../codebase/130.md) proved this: it added the payload `hash?` (length reusing `bytes?`, type riding `code`) for the inbound-decode boundary, and `typecheck` stayed green with **no** other call site touched — because the serializer spreads `{ ...fields, seq, ts }` rather than hand-picking, and `JSON.stringify` drops the `undefined` field everywhere else. #125's remaining slices (state transitions, a shared correlation id) slot in the same way. The record must never become a closed tuple or positional format.
- **The residual risk is a confused caller, mitigated by call-site review, not code.** `event` / `code` / `host` / `path` are `string`; the type cannot forbid a caller stuffing a secret into a string field. This is a documented SHOULD-FIX handled by a **deterministic** code-review checklist on the (few) #127/#128 call sites — static literals for `event`/`code`, `new URL(u).hostname` / `.pathname` for `host`/`path`, never `url.href` / `url.search` — not another stochastic rule (belt-and-suspenders means different fabric).
- **The classify-then-drop discipline stays where it is.** The logger does not replace it — the transport modules still classify each caught error to a static `code` and drop the object; the logger only ever receives the already-classified `code`. The drop remains the place secrets die.
- **Diagnostics ships freely.** Because a `main.log` holds no secret, it can be attached to a bug report or shipped off-machine without a redaction step — the content-free property is what makes the log *usable*, not just safe.
- **The logger is main-process-only.** No Electron import in the module, no IPC, no `contextBridge` — it observes the transport and is unreachable from a compromised renderer ([0002](0002-remote-head-over-relay-shared-wire.md)).

Related: [0002](0002-remote-head-over-relay-shared-wire.md) (keys/bytes never reach the renderer — the boundary this inherits), [0005](0005-secret-at-rest-safestorage-fail-closed.md) (the same fail-closed-over-a-blind-primitive posture and the construct-once-at-the-root idiom), the [diagnostic-log feature doc](../features/diagnostic-log.md), and [#126 codebase notes](../codebase/126.md). Cross-project sibling: the pyrycode daemon's own content-free logging discipline (content-free discriminants only — `event`, routing ids, sizes; never payload bytes or `err.Error()`), which this desktop logger mirrors on the client half of the same wire.
