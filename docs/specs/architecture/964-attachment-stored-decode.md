# #964 — decode the attachment upload's success reply

## Files read

- `src/shared/wire/types.ts` → `EnvelopeType`, `AttachmentChunkPayload`, `ATTACHMENT_ID_MAX_BYTES`, `MAX_PLAINTEXT_BYTES` — the union this slice widens, the sibling payload whose doc block sets the house style for an attachment frame's security prose, and the frame cap that backstops every parse here.
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage`, `InboundDaemonMessage`, `requireString`, `isRecord`, `parseQuestionDismissedPayload`, `parseSlashCommandListPayload` — the module this slice extends and the two arms the ACs name as precedent. `requireString` is the helper whose *gap* (it accepts `''`) drives this slice's one new helper.
- `src/main/daemonConnection.ts` → the inbound `switch` on `InboundDaemonMessage['kind']` — checked to confirm it has **no `assertNever` and no catch-all**, so a new union member forces nothing downstream. Its `question-dismissed` and `slash-command-list` arms exist, but they were added by the *IPC-carry* tickets (#895, #937), not by the decode tickets (#894, #936); this slice is a decode ticket and touches the file not at all.
- `src/main/transport/fakeDaemon.ts` → `FakeDaemonOptions.buildReplyFrames`, `handleTransport`, `DEFAULT_REKEY_RESUME_MESSAGE` — the existing per-inbound reply hook this slice teaches to answer a chunk, and the module's precedent for exporting a canned frame builder beside the fake itself.
- `src/main/transport/fakeDaemon.test.ts` → `standUp`, `driveClient`, and the `buildReplyFrames` streaming test — the harness AC4's end-to-end test reuses verbatim (real `createNoiseSession` client, real forwarder, real codec).
- `src/main/transport/attachmentChunkEnvelope.ts` → `buildAttachmentChunk`, `AttachmentChunkInput` — the outbound half already shipped; the test drives real chunk envelopes through it rather than hand-rolling them.
- `src/main/diagnosticLog.ts` → `DiagnosticEvent` — the content-free field set this slice reuses **unchanged** (AC3).
- pyrycode `internal/protocol/attachments.go` → `AttachmentStoredPayload`; `internal/protocol/codes.go` → `TypeAttachmentStored`; `internal/relay/v2session_attachment.go` → the emit site. SSOT, re-read against the checked-out tree on 2026-09-02 rather than against `docs/protocol-mobile.md`, whose § Attachments *status* prose ("nothing emits it yet") is stale while its *shape* prose is current.

## Design source

**Figma:** N/A — this slice is entirely inside the Electron background process and ships no renderer change. The visual-fidelity check is intentionally skipped.

## Context

An attachment upload is a multi-frame transfer. Its outbound half exists (`buildAttachmentChunk` + `planAttachmentChunks`), but its single positive terminal — `attachment_stored` — is absent from `EnvelopeType`, so `parseInboundMessage` falls through to its content-free catch-all and returns `null`. Every upload this client makes is answered by silence it cannot distinguish from an unmodelled frame, and no consumer can ever resolve one.

This slice adds the wire vocabulary, the fail-closed decode, and the fake-daemon scaffolding that proves it end to end. It claims **nothing downstream**: `daemonConnection`'s inbound switch has no catch-all, so the new kind stops at the transport boundary until #861 (the send driver) picks it up.

No ADR is warranted. The frame's design decisions are upstream's and are already recorded in `TypeAttachmentStored`'s own block; this side is a faithful decode of a published shape, which is the same posture #894 and #936 took without an ADR.

## Design

### Wire vocabulary — `src/shared/wire/types.ts`

Two additive changes, both new *members* rather than new required fields, so no existing typed fixture is disturbed.

1. `EnvelopeType` gains `| 'attachment_stored'`, sited immediately after `'attachment_chunk'` so the upload leg's request and its one positive answer read as a pair. Its comment records what the union member alone cannot: **binary → client only** (the whole difference from `attachment_chunk`, which rides both legs), that it is the single positive terminal for the *whole transfer* rather than a report that the storage step succeeded, and that correlation rides `in_reply_to` naming **the chunk whose arrival completed the set — not the highest index**.

2. A new exported payload interface:

   ```ts
   export interface AttachmentStoredPayload {
     attachment_id: string
   }
   ```

   **Exactly one key**, mirroring the Go struct field-for-field. Its doc block records that the absences are decisions, not omissions: no `size`, `sha256`, `total_chunks`, `filename`, `conversation_id` or host path — the client sent all of those and they were checked before the frame could be emitted, so echoing them confirms nothing, and a success frame carrying a host path would undo from the other side the disclosure mitigation `attachment.storage_failed` already carries. The daemon pins this key set with a two-sided wire-key test, so it is checked upstream rather than reviewed. It also records the one property that makes this frame unlike its sibling: carrying none of `filename` / `sha256` / `data`, it is **safe to log whole** — a statement about the frame, explicitly *not* a licence this client acts on (see the diagnostic decision below).

### Decode — `src/main/transport/inboundMessage.ts`

**New union member.** `InboundDaemonMessage` gains:

```ts
| { kind: 'attachment-stored'; attachmentStored: AttachmentStoredPayload }
```

**It deliberately does NOT carry `inReplyTo`**, and that is the design decision this slice most needs recorded. Three existing kinds do carry it — `daemon-error`, `session-settings` and `session-settings-updated` — because for those the envelope id *is* the correlation. Here it is not: `in_reply_to` names whichever chunk envelope happened to close the set, which a client cannot predict, and the ticket's own warning is that "a consumer that matches only on a predicted envelope id never resolves." Surfacing the field would hand #861 a plausible-looking match key that silently never fires. Omitting it makes "match on the payload's `attachment_id`" **structural rather than advisory** — the only correlation handle a consumer can reach is the one that works. A consumer that later needs the envelope id must argue for it on its own ticket.

**New narrower.** `parseAttachmentStoredPayload(payload: unknown): AttachmentStoredPayload` — the shape of `parseQuestionDismissedPayload` minus two fields: an `isRecord` guard throwing `WireDecodeError('malformed attachment_stored payload')`, then one required non-empty string, returning a fresh one-field literal so unknown server-added keys are tolerated (forward-compat) but not copied through, which also keeps it prototype-pollution-safe.

**New helper.** `requireNonEmptyString(payload, field): string` — a sibling of `requireString`, not a replacement for it. `requireString` polices *type* and accepts `''`, which is correct for every existing call site and load-bearing on at least one: an empty `argument_hint` is ordinary data on 33 of the measured 51 slash-command rows, so tightening `requireString` in place would fail-close valid traffic. The new helper exists for the one field where the empty string is a **distinct failure mode rather than a value**, and the reason is upstream's own: every key is optional to Go's `encoding/json`, so a truncated or hostile `attachment_stored` decodes daemon-side to the zero value and arrives here as `{"attachment_id": ""}`. Passed through `requireString` that yields a *success naming no transfer* — AC2's exact prohibition. Its doc block states that scope so the helper is not later swapped in "for consistency."

**New switch arm.** `case 'attachment_stored':` narrows **before** logging, so a malformed frame throws first and leaves no record (the arm's house rule), then emits the existing content-free diagnostic and returns the new kind.

**Reject vs ignore.** The two signals are distinct in this module and the tests that prove them differ: `null` for a well-formed envelope of an *unclaimed* type, a thrown `WireDecodeError` for a payload of a *claimed* type it cannot trust. A malformed `attachment_stored` is the second. `daemonConnection` catches that error and drops the frame **without logging the message**, so the rejection is observable at the unit boundary and nowhere downstream.

### Diagnostic record — no new field

The arm emits the existing four-field record: `event: 'inbound-decoded'`, `code: 'attachment_stored'` (a static literal, never the wire-supplied `envelope.type` the `default:` arm must cap), `bytes: plaintext.length`, `hash: hashPlaintext(plaintext)`.

Upstream's "safe to log whole" is a statement about **the frame**, not a licence to widen `DiagnosticEvent` here. A new field on that type would disturb the renderer pin the module's comments cite (#131), and it would not even be needed: `DiagnosticEvent` already carries `code`, so nothing structural stops an implementer adding the id — the omission has to be deliberate and stated. It is: the id is the client's own, so logging it buys a correlation handle the client already holds, at the cost of putting a per-upload identifier into a JSON-lines log the operator can ship off-box in a debug bundle.

### Fake-daemon scaffolding — `src/main/transport/fakeDaemon.ts`

The fake has no attachment awareness today. It already has the right seam: `FakeDaemonOptions.buildReplyFrames` is called by `handleTransport` for every decrypted inbound frame and streams each returned envelope as its own sealed `noise_msg`.

New export, a factory whose result matches `buildReplyFrames` exactly so it can be passed straight in:

```ts
export function attachmentStoredReplyFrames(
  completingIndex: number
): (inboundPlaintext: Uint8Array) => Uint8Array[]
```

Behaviour: decode the inbound plaintext; return `[]` for anything that is not an `attachment_chunk`, and `[]` for a chunk whose `index` is not `completingIndex`; for the completing chunk return exactly one `attachment_stored` envelope whose `in_reply_to` is **that chunk envelope's id** and whose payload carries **that chunk's `attachment_id`**. A malformed inbound decodes to `[]` rather than throwing, so a decode failure inside the fake cannot masquerade as a daemon-side crash.

Two fidelity points the parameter buys. Every non-completing chunk of a healthy upload gets **no reply at all** — the real daemon's behaviour, and the reason the fake cannot simply answer every chunk. And because the caller names *which* chunk completes, a test can drive a multi-chunk upload where the completing chunk is **not** the last one, which is what makes AC1's "whichever chunk's envelope the reply is correlated to" an assertion rather than a sentence. A fake that always answered the highest index would let a consumer that predicts the last envelope id pass forever.

Placed in `fakeDaemon.ts` rather than in the test file for the reason `DEFAULT_REKEY_RESUME_MESSAGE` is: the fake owns the daemon's side of the protocol, the test owns the assertions.

## State + concurrency model

None added. `parseInboundMessage` is a pure function over one plaintext; the new arm holds no state, opens no task, and registers no listener. The fake's reply builder is a closure over one number and is called synchronously inside the existing `handleTransport`, which already owns its socket lifecycle and teardown. No store slice, no IPC channel, no renderer surface, and nothing to cancel.

Transfer-level state — which chunks have arrived, which upload a reply resolves, when a spinner stops — belongs to the send driver (#861) and is deliberately absent here.

## Error handling

| Failure | Result |
|---|---|
| Payload not a record (`null`, array, scalar) | `WireDecodeError('malformed attachment_stored payload')` |
| `attachment_id` missing or not a string | `WireDecodeError('missing required field: attachment_id')` |
| `attachment_id` present, a string, but empty | `WireDecodeError('empty required field: attachment_id')` |
| Envelope oversized / unparseable | Existing `MAX_PLAINTEXT_BYTES` + `decodeEnvelope` guards, unchanged |
| Well-formed `attachment_stored`, id unrecognised | **Not this layer's concern.** The decode succeeds; recognise-or-ignore is the consumer's rule (#861) |

Every message names the failure **category only**. `attachment_id` is not a secret — upstream states plainly that receiving this frame is not a capability — but it is the client's own per-upload identifier, and `daemonConnection` catches `WireDecodeError` into a caller that may log it, so a value echoed into the message would ride into that log. The existing `requireString` message format already names only the field, and the new helper matches it.

**No shape validation on the id.** Upstream publishes a canonical lowercase-UUIDv4 shape, and lowercase is load-bearing there because the id becomes a directory name on a case-insensitive filesystem. That rule binds the side that *mints* ids — the outbound leg — not this one. Here the contract is recognise-or-ignore against ids this client itself chose, so a shape check would be a second copy of a rule with no authority on this side, and it would fail-close a valid frame the moment the two copies disagreed. No length check either, for the reason `parseSlashCommand` records: the daemon bounds the field at construction and `MAX_PLAINTEXT_BYTES` backstops the frame, so a third bound here would be a client-invented one to keep in agreement.

## Testing strategy

All vitest, node environment. No Playwright spec: nothing renders and nothing is clickable on this path.

**`src/main/transport/inboundMessage.test.ts`** — unit, alongside the `question_dismissed` / `slash_command_list` arms:

- A well-formed `attachment_stored` decodes to `{ kind: 'attachment-stored', attachmentStored: { attachment_id: … } }`, asserted with an exact `toEqual` on the whole result so a smuggled extra field fails.
- The result carries **no** `inReplyTo` even when the envelope has one — the assertion that pins the design decision above. `toEqual` on the whole object is what catches it.
- An unknown extra payload key is tolerated and **not** copied through.
- Four rejection cases, each `expect(() => …).toThrow(WireDecodeError)` — **not** `toBeNull()`, which is the other signal: non-record payload, missing `attachment_id`, non-string `attachment_id`, empty-string `attachment_id`. The empty case is the one a `requireString` implementation would pass, so it is the test that actually guards AC2.
- The diagnostic record is emitted once with exactly `{ event: 'inbound-decoded', code: 'attachment_stored', bytes, hash }` — asserted by `toEqual` on the whole record, so an added field (an `attachment_id`, a `count`) reddens. AC3 is a *negative*, so an assertion that only checks the four expected fields are present would not prove it.
- A rejected frame emits **no** diagnostic record at all (narrow-before-log).

**`src/main/transport/fakeDaemon.test.ts`** — one end-to-end test for AC4, reusing `standUp` + `driveClient` (real `createNoiseSession`, real forwarder, real codec, real ciphers):

- Stand the fake up with `attachmentStoredReplyFrames(0)`, drive a **two-chunk** upload through `buildAttachmentChunk`, and let chunk index `0` — the *earlier* envelope id — be the completing one.
- Assert exactly one inbound `message` event arrives (chunk 1 is answered by silence), that `parseInboundMessage` on its plaintext yields the terminal-success kind, and that the `attachment_id` it names is the one both chunks carried.
- Because the completing chunk is not the last, a consumer keying on a predicted final envelope id would find nothing — that asymmetry is the point of the test, not incidental setup.

Fakes over mocks throughout: the only `vi` use is the injected `DiagnosticLog` recorder the existing arms already use.

## Open questions

1. **Does `requireNonEmptyString` belong as a shared helper or inlined in the one narrower?** Resolved in favour of a named helper with a scoping doc block: the distinction from `requireString` is the whole point and needs somewhere to be written down. Revisit only if a second call site appears with a different emptiness rule.
2. **Should the fake answer the completing chunk, or every chunk?** Resolved to a caller-named completing index — see the fake-daemon section. Confirm during implementation that `handleTransport` tolerates an empty `[]` reply without stalling `whenSettled` (it settles `ok: true` after the loop regardless, so an empty list should be fine).
3. **Does `daemonConnection` need a no-op arm to keep compiling?** Resolved: no. Its inbound switch has no `assertNever` and no catch-all — verified by reading the switch, not assumed from the ticket body — so an unclaimed kind is simply dropped. If `npm run build` disagrees, that is new information and gets a `## Revisions` entry rather than a silent edit.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] SHOULD FIX — the decoded `attachment_id` is a bare untrusted string, and the consumer (#861) must look it up in a `Map` keyed by ids it minted, never as an index into a plain object.** The narrowing makes the SHAPE trusted, never the CONTENT: a compromised daemon inside the session puts any string it likes here, at any length the frame cap allows, and this arm verifies only `typeof === 'string'` plus non-emptiness. The concrete hazard is `attachment_id: "__proto__"` — a *read* of `pending['__proto__']` returns `Object.prototype`, which is truthy, so a consumer written the obvious way resolves a transfer that does not exist (and may then read fields off the prototype). This module already treats those three keys as hazardous in `RESERVED_MAP_KEYS`, but that guard exists because `optionalStringMap` *builds a container from wire keys*; this narrower builds no container from the value, so nothing in **this** slice is exploitable. Implemented in Phase B as a stated obligation on the payload's doc block and the switch arm, **not** as a fourth reject branch — adding one would be a client-invented shape rule, contradicting the "no shape validation on the id" decision above, and two copies of a shape rule fail-close valid traffic the moment they disagree. The verifier should check the prose landed and names the `Map` obligation explicitly.
- **[Tokens, secrets, credentials] No findings.** Nothing here touches a token, a key, or `safeStorage`. `attachment_id` is not one: upstream states plainly that receiving this frame is not a capability, and that the id is not secret, not unguessable, and never the only thing between a caller and a file. It is kept out of the diagnostic record all the same — see [Errors, logs].
- **[File / storage operations] No findings, with the rule restated at the type.** This slice opens no file, resolves no path, and writes nothing. The id *is* a directory name on the daemon side, which is exactly why the new payload's doc block repeats the sibling `AttachmentChunkPayload.attachment_id` sentence verbatim — **never resolved into a filesystem path** — rather than leaving the reader to infer it from a frame that no longer sits next to the chunk's warning.
- **[Inter-process / Electron attack surface] No findings.** No new `ipcMain` channel, no `contextBridge` addition, no `BrowserWindow`, no deep link. The new kind is decoded in the main process and **stops there**: `daemonConnection`'s inbound switch has no catch-all, so it never reaches the IPC bridge or the renderer in this slice. `AttachmentStoredPayload` is declared in `src/shared/wire/types.ts`, which the renderer may import, and that is sound — it is a type only, erased at runtime, carrying no bytes and no Node primitive, exactly as `AttachmentChunkPayload` already does. `inboundMessage.ts` stays MAIN-PROCESS ONLY and is not re-exported through any renderer barrel.
- **[Cryptographic primitives] No findings.** Nothing added. The diagnostic reuses the existing `hashPlaintext` (BLAKE2s-256 over the whole frame, `@noble/hashes` — Electron's BoringSSL has no BLAKE2). Noted for #861 so it is not cargo-culted the other way: matching a decoded `attachment_id` against ids this client minted is a plain `===`/`Map.has`, **not** `timingSafeEqual` — the id is explicitly not a secret, and a constant-time compare there would imply a confidentiality property the value does not have.
- **[Network & I/O] No findings — verified, not assumed.** The frame cannot arrive unbounded: the `MAX_PLAINTEXT_BYTES` check sits inside `parseInboundMessage` itself, ahead of `decodeEnvelope` and ahead of every narrower, so an oversized `attachment_id` fails closed before this arm runs. Confirmed by reading the guard rather than inferring it from the builders, which are all outbound. No socket, URL, timeout, or TLS decision is in scope.
- **[Errors, logs, telemetry] No findings.** Every `WireDecodeError` message names the failure category and the static field name only — never the id, never the payload, never the raw bytes — which matters because `daemonConnection` catches this error into a caller that may log it. The throw path emits no diagnostic at all (narrow-before-log). The success path emits the existing four content-free fields and adds **no** `DiagnosticEvent` field, leaving #131's renderer pin untouched; the id is omitted deliberately even though upstream calls this payload safe to log whole, because a per-upload identifier in a JSON-lines log the operator can ship off-box in a debug bundle buys a correlation handle the client already holds. Claiming the type is also strictly safer than the status quo: the frame moves off the `default:` arm, which logs a WIRE-SUPPLIED `envelope.type` capped at `MAX_LOGGED_TYPE_CHARS`, onto a static literal.
- **[Concurrency] No findings.** The narrower is pure and stateless; no task, timer, listener, or `AbortSignal` is created, so there is nothing to cancel and no teardown path to get wrong. The fake's `attachmentStoredReplyFrames` closes over one number and holds **no mutable arrival state**, which is a deliberate choice over a fake that tracks the arrival set: with no shared state there is no check-then-act race even when two transfers interleave on one session, and the fake is called synchronously inside the existing `handleTransport`, which already owns the socket lifecycle.
- **[Threat model alignment] No findings; two consumer obligations named for #861.** *Malicious / compromised relay* — content-blind but on-path, so it can drop, delay, or reorder. Dropping the reply leaves a transfer unresolved, which is a **liveness** problem owned by #861's timeout, not a safety problem here; the decode leaks nothing and hangs nothing. Reordering can land the `attachment_stored` before the client has finished sending later chunks, and the decode is stateless so it does not care — **#861 must not treat the reply's arrival as proof that every chunk was sent.** *Hostile daemon response* — parsed defensively and fail-closed, per the four reject branches; the residual is the [Trust boundaries] finding. *Renderer compromise reaching the transport* — cannot reach this path: main-process only, and the kind crosses no IPC channel in this slice.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
