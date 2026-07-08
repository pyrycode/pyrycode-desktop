# Spec #130 — Content-free log of every inbound daemon envelope

**Ticket:** [#130](https://github.com/pyrycode/pyrycode-desktop/issues/130) · size:s · `security-sensitive` · split from #125 (Bucket-1 diagnostics)

Wire the merged content-free logger (#126) into the post-decryption decode boundary
(`parseInboundMessage`) so every inbound daemon message — modeled *and* unmodeled — leaves a
content-free footprint (type + seq + length + one-way hash), never the payload value. This is the
Diagnostics doc's Bucket-1 "hash + length + type, never the value" recovery move plus the
"log unrecognised events by type, size, and hash" catch-all.

## Files to read first

- `src/main/transport/inboundMessage.ts` (all 111 lines) — **the only production file with new
  logic.** `parseInboundMessage` at :92, the `switch (envelope.type)` at :101–109 (the three log
  sites), the `MAX_PLAINTEXT_BYTES` size guard at :97, and the module header at :1–17 whose
  "This module performs no logging" line (:17) this ticket deliberately flips.
- `src/main/diagnosticLog.ts:20–42` — the `DiagnosticEvent` allowlist. Add the one new field here.
  Note the header (:1–18): the guarantee is the *absence* of any secret-carrying shape, enforced by
  the type at every call site — additive optional fields don't break that.
- `src/main/transport/relayConnection.ts:52–59, 178, 209–219, 243–249` — **the precedent to copy.**
  `diagnosticLog?: DiagnosticLog` as an optional injected dep (:52–59); the log-site idiom
  `config.diagnosticLog?.event({ event: '…', … })` (:178, :243); and the `unexpected-response`
  handler (:209–219) — the exact shape for "log a peer-supplied value at a decode boundary."
- `src/main/daemonConnection.ts:198–206` — the sole production caller (`parseInboundMessage(event.plaintext)`
  at :200). `deps.diagnosticLog?: DiagnosticLog` is already in scope (declared :68, imported :35, used at
  :173/:192/:270/:380). One-line change: thread it in.
- `src/main/pairingConfirmation.ts:22–29, 104–113` — the blake2s precedent. `import { blake2s } from
  '@noble/hashes/blake2'` (:29), why it's `@noble/hashes` not `node:crypto` (:22–28, note #101:
  BoringSSL has no BLAKE2 → `createHash('blake2s256')` throws in the packaged app), and the
  `blake2s(bytes, { dkLen: 32 })` call shape (:106).
- `src/main/transport/inboundMessage.test.ts` (all 185 lines) — the existing test suite the new
  cases extend. In particular the `secret-safety / log-free` describe (:149–184): its console-spy
  pattern and secret-planting technique are what AC4's new test reuses; it must stay green.
- `src/main/transport/codec.ts:126–137` — `decodeEnvelope`: `Envelope.type` is `string` (peer-
  controlled), `payload` stays `unknown`. Confirms why the frame bytes — not `envelope.payload` —
  are the only stable, deterministic thing to hash.
- `src/shared/wire/types.ts:30` — `MAX_PLAINTEXT_BYTES = 65519`. The upstream bound on the whole
  plaintext, hence on the peer-controlled `type` string. Load-bearing for the security ruling below.
- `docs/knowledge/decisions/0007-content-free-diagnostics-by-construction.md` — the ADR this ticket
  extends. Read the "additive optional fields" and "not a runtime scrubber (a denylist fails open)"
  rationale before touching `DiagnosticEvent`.
- `docs/knowledge/features/diagnostic-log.md` and `.../inbound-message-decode.md` — current state of
  the two features this ticket joins.

## Design source

N/A — background-process diagnostic logging, no UI surface. This ticket adds no renderer code, no
IPC channel, and no visible element; the visual-fidelity check is intentionally skipped.

## Context

`parseInboundMessage` is the post-decryption decode boundary. It takes one already-decrypted
plaintext and does one of three things:

1. narrows a `message` / `message_chunk` envelope to a typed `InboundDaemonMessage`;
2. returns `null` for a well-formed-but-unmodeled envelope type (`ack`, `error`, a future kind) —
   **today this is silently dropped**;
3. throws `WireDecodeError` on malformed / oversized / mistyped input (fail-closed).

None of the three is recorded anywhere. A message that recurs, mutates between send and receive,
truncates, or arrives as an unforeseen kind vanishes from the operator's view. This ticket records
outcomes (1) and (2) as content-free records and leaves outcome (3) — the throw path — exactly as
today (see Scope).

**Byte-safety rule (the reason #130 and #133 are separate tickets):** the input here is *decrypted
plaintext* and may carry message text. This boundary therefore logs **only** a one-way hash + a
byte length + the envelope type — never the payload bytes or any decoded field value. (Keeping the
raw *failing* bytes is safe only pre-decryption, where they're ciphertext — that's sibling #133.)

## Design

### Data flow

```
daemonConnection ('message' arm) ──event.plaintext (Uint8Array)──▶ parseInboundMessage(plaintext, deps.diagnosticLog?)
                                                                          │
   size guard (unchanged) ─▶ decodeEnvelope (unchanged) ─▶ switch(envelope.type)
                                                                          │
        ┌───────────────────────────┬─────────────────────────────────┬─┘
   'message'                  'message_chunk'                      default (unmodeled)
   narrow (may throw*)        narrow (may throw*)                  (no narrow)
        │                           │                                   │
   log inbound-decoded         log inbound-decoded                 log inbound-unmodeled
   {code:'message'}            {code:'message_chunk', count}       {code: cappedType}
        │                           │                                   │
   return {kind:'message'}     return {kind:'chunk'}               return null
```

`*` The narrower throw is the throw path — **not logged** (see Scope). Logging fires only *after* a
modeled envelope has fully narrowed, so a `message` with a malformed payload throws and produces no
record — consistent with "this ticket does not change or log the throw path."

### Change 1 — `DiagnosticEvent` gains one content-free field (`src/main/diagnosticLog.ts`)

Add a single optional field to the allowlist interface (:42, after `path?`):

```ts
/** A one-way digest of an opaque frame/payload — never the bytes. A fixed-width, content-free
 *  correlation handle: an identical frame recurring, or a frame changing/truncating between
 *  send and receive, shows up as a repeated / differing / shifting hash. Hex BLAKE2s-256. */
hash?: string
```

- Additive optional property → no existing call site changes, serialization unchanged
  (`JSON.stringify` drops `undefined`). This is exactly the extension #126's header (:23–25) and
  ADR 0007 reserved room for.
- **Length reuses the existing `bytes?` field** (`DiagnosticEvent.bytes`, :34) — it is already
  "a byte length … never the bytes themselves." Do NOT add a second length field. `hash?` is the
  *only* new field (AC3).

### Change 2 — `parseInboundMessage` logs at the three decode outcomes (`src/main/transport/inboundMessage.ts`)

New signature — an optional injected logger as the second parameter (mirrors
`relayConnection.ts:52–59`; the sole caller updates in Change 3, all test callers keep passing one
arg):

```ts
export function parseInboundMessage(
  plaintext: Uint8Array,
  diagnosticLog?: DiagnosticLog
): InboundDaemonMessage | null
```

New imports: `import { blake2s } from '@noble/hashes/blake2'` and
`import type { DiagnosticLog } from '../diagnosticLog'`.

Module-private hash helper (contract, not body):

- `hashPlaintext(plaintext: Uint8Array): string` — `blake2s(plaintext, { dkLen: 32 })` → lowercase
  hex (`Buffer.from(digest).toString('hex')`, 64 chars). Deterministic, one-way, content-free;
  synchronous and BoringSSL-safe per #101. Hashes the **input frame bytes**, never `envelope.payload`
  (a parsed `unknown` object — re-serializing it would be non-deterministic on JSON key order, per
  the ticket's Technical Notes).

Module-private cap constant + helper for the peer-supplied type (the security ruling — see Security
review):

- `MAX_LOGGED_TYPE_CHARS = 64` and log `envelope.type.slice(0, MAX_LOGGED_TYPE_CHARS)` in the
  unmodeled branch. Real wire types (`ack`, `error`, `hello_ack`, `message`, `message_chunk`) are
  all < 16 chars, so the cap is lossless for legitimate traffic and deterministically bounds a
  hostile peer's ~64 KB-capable `type` string (`MAX_PLAINTEXT_BYTES`).

The three log sites (recommended `event` names; keep or refine):

| Outcome | Site | Record fields |
|---|---|---|
| modeled `message` | after `parseMessagePayload` succeeds, before `return` | `{ event: 'inbound-decoded', code: 'message', bytes: plaintext.length, hash: hashPlaintext(plaintext) }` |
| modeled `message_chunk` | after `parseMessageChunkPayload` succeeds, before `return` | `{ event: 'inbound-decoded', code: 'message_chunk', bytes: plaintext.length, count: messages.length, hash: hashPlaintext(plaintext) }` |
| unmodeled (`default`) | before `return null` | `{ event: 'inbound-unmodeled', code: envelope.type.slice(0, MAX_LOGGED_TYPE_CHARS), bytes: plaintext.length, hash: hashPlaintext(plaintext) }` |

Each site is a single `diagnosticLog?.event({ … })` call — optional chaining short-circuits the
whole call (including `hashPlaintext`) when no logger is injected, so absent-logger costs nothing
and cannot throw (matches `relayConnection`). `code` carries the wire type: a **static literal** on
the modeled arms (safe), the **capped peer value** on the unmodeled arm.

**Update the module header** (:17): replace "This module performs no logging." with a content-free
statement mirroring `relayConnection.ts:14–19` — e.g. that the module now emits content-free
records (type, seq, length, hash) through the injected logger and never the payload value or a
decoded field. The ticket explicitly changes this invariant for this file only.

### Change 3 — thread the logger from the caller (`src/main/daemonConnection.ts`)

One line, at :200: `parseInboundMessage(event.plaintext, deps.diagnosticLog)`. `deps.diagnosticLog`
is already the injected content-free logger (declared :68, used at :173/:192/:270/:380). No other
change to `daemonConnection` — the drop/emit logic at :198–213 is untouched.

## State + concurrency model

No store, no async, no new task. `parseInboundMessage` is synchronous; the logger's `seq` is a
single-writer synchronous counter (#126, no `await` gap). The monotonic sequence position is the
logger's existing per-process `seq` — **not** a new counter (AC). Cross-side ordering (client vs
daemon) needs the deferred correlation/sequence twin (out of scope per #125); the client-side
receive-order `seq` stands on its own.

## Error handling

- **Throw path unchanged and unlogged.** The size guard (:97), `decodeEnvelope`, and the semantic
  narrowers still throw `WireDecodeError` in exactly today's cases; the caller
  (`daemonConnection.ts:201–205`) still drops it. No log fires on the throw path — a
  content-free log for the *post-decryption semantic* throw (e.g. a `message` missing `text`) is a
  deferred question, not this ticket.
- **Sink failure is contained by #126** — `DiagnosticLog.event` swallows a throwing sink
  (`diagnosticLog.ts:89–95`), so a full-disk log write cannot take down the decode boundary.
- **Absent logger** → no call, no throw, identical return (AC5 backward-compat).

## Testing strategy

Extend `src/main/transport/inboundMessage.test.ts` (vitest, `npm test`). Build inputs with the real
codec (`encodeEnvelope`) exactly as the existing suite does. For logging assertions, inject a **real**
`createDiagnosticLog({ sink, now })` over a capture array (`const lines: string[] = []; sink = { write: (l) => lines.push(l) }`)
so the assertions see the exact serialized JSON line #126 produces. Scenarios (bullets — write in the
project idiom, not as pre-written bodies):

- **modeled `message` → content-free record (AC1 + AC4).** Decode a `message` whose `text` and
  `conversation_id` are planted secrets, through the capture logger. Assert: exactly one line;
  parsed → `event:'inbound-decoded'`, `code:'message'`, `bytes === plaintext.length`, `hash` a
  non-empty 64-char hex string, `seq` present; and the **raw serialized line contains neither
  planted secret** (the AC4 guarantee — the content-free property at the serialized boundary).
- **modeled `message_chunk` → type + batch count.** A 2-element chunk → `code:'message_chunk'`,
  `count:2`, `hash` present. An empty chunk → `count:0` (still logged, still content-free).
- **unmodeled type logged, not dropped (AC2).** An `ack` envelope → `event:'inbound-unmodeled'`,
  `code:'ack'`, `bytes`+`hash` present; return value still `null` (the "not modeled here" behavior
  is unchanged).
- **hostile long type is capped (security).** An unmodeled envelope whose `type` is a 200-char
  string → the logged `code` is ≤ 64 chars; still returns `null`; the line splits into exactly one
  record (JSON-escape holds).
- **hash correlates (the recurrence/change signal).** The same plaintext logged twice → identical
  `hash`; two different plaintexts → different `hash`.
- **throw path is NOT logged.** A `message` with a missing `text` → throws `WireDecodeError` **and**
  the capture sink received zero records. An oversized plaintext → throws, zero records.
- **backward-compat (AC5).** `parseInboundMessage(bytes)` with no logger → returns the same result
  as the existing happy/ignored/throw cases, never throws for lack of a logger. (Mirrors
  `relayConnection`'s no-`diagnosticLog` test.)
- **existing `secret-safety / log-free` test stays green (AC5).** It spies on `console.*` and calls
  with no logger; #130 logs via the injected sink, never `console`, so it remains valid and must
  pass unchanged.

Type coverage: `npm run typecheck` confirms `hash?` on `DiagnosticEvent` and the new optional param
compile; the modeled arms pass a static-literal `code`, the unmodeled arm a `string`.

## Open questions

- **`event` names** (`inbound-decoded` / `inbound-unmodeled`) are the architect's recommendation for
  greppability and symmetry with `relay-*` / `daemon-*`. The developer may refine; the ACs constrain
  the *fields*, not the literal names.
- **Post-decryption semantic-throw logging** (a `message` that decodes as `message` but fails to
  narrow) — deferred, not #133's either (those are pre-decryption). Named here so it isn't lost.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. `parseInboundMessage` is the single explicit untrusted→trusted
  boundary; the untrusted input is `plaintext` (from an on-path relay / a hostile daemon). Nothing
  the design logs is a decoded field *value*: modeled arms log a static type literal, a length, and
  a one-way hash; the unmodeled arm additionally logs a **capped** type discriminator. Downstream
  holds the same `InboundDaemonMessage | null` as today.
- **[Error messages, logs, telemetry]** Addressed by design — this *is* the category the ticket
  lives in. MUST-NOT-log (payload bytes, decoded field values, message text) never enters a record:
  the only fields are `event`/`code` (literal or capped type), `bytes` (a number), `count` (a
  number), `hash` (a one-way hex digest), plus the logger's own `seq`/`ts`. The #126 serializer
  JSON-escapes every string, so a peer-crafted `type` cannot split or inject a log line. Log-file
  location, permissions, and rotation are owned by `diagnosticLogSinks.ts` (#126) — unchanged here.
- **[Cryptographic primitives]** No findings. The hash is `blake2s` from the vetted, audited
  `@noble/hashes` (already in-tree, #101) — not hand-rolled, not `node:crypto` (BoringSSL lacks
  BLAKE2). It is used purely as a one-way content-free digest (no authentication, no key, no nonce),
  so there is no timing-comparison, key-reuse, or nonce-reuse surface.
- **[Threat model — hostile daemon / malicious relay]** Addressed. The peer-supplied `type` string
  is the one non-literal reaching the log. **Ruling: cap it** (`slice(0, 64)`) before logging into
  `code`. This is a deterministic code bound (belt-and-suspenders: a stochastic rule paired with a
  deterministic cap), lossless for real wire types (all < 16 chars) and defanging a peer that could
  otherwise stuff up to `MAX_PLAINTEXT_BYTES` (65519) of arbitrary text into `type`. The plaintext
  itself is already size-guarded at :97. A hostile daemon returning malformed/oversized/mistyped
  input hits the unchanged throw path (unlogged) or the unmodeled catch-all (content-free) — either
  way it leaves a footprint or fails closed, never leaks.
- **[Threat model — confirmation-of-a-guess on the hash]** No finding; documented residual. Hashing
  the **full plaintext frame** (not just the payload text) means the digest is implicitly salted by
  the server-assigned `id`, `ts`, and `message_id` an attacker cannot predict — so a
  read-the-log-and-confirm-the-user-typed-X dictionary attack must reconstruct the entire frame
  byte-for-byte, not just guess the text. This is why the ticket's "hash the frame, not the payload"
  instruction is the more secure choice, not merely the more deterministic one. The log lives under
  `userData` (user-readable only), the same trust boundary as any local diagnostic.
- **[Inter-process / Electron attack surface]** No findings. No IPC channel, no `BrowserWindow`, no
  `contextBridge` API added. `inboundMessage.ts` stays main-process-only (its header forbids
  renderer re-export); the logger is injected, never imported from the sink side. No secret or
  socket moves toward the renderer.
- **[Concurrency]** No findings. Synchronous decode + synchronous single-writer `seq` (#126); no new
  async task, timer, listener, or shared-state mutation across an `await`.
- **[File / storage, Tokens, Network & I/O]** N/A here — this ticket writes no file directly, handles
  no token, and opens no socket; the frame-size cap (:97) and the sink's file I/O are unchanged
  upstream concerns (#126). Cross-side sequence/correlation is OUT OF SCOPE, deferred to the daemon
  twin per #125.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-08
