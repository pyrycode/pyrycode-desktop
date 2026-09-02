# #945 — `request_session_settings` names the conversation it asks about

Root-cause slice 1 of #941. Main and shared only: the command member, the connection method, and the
outbound frame. Nothing supplies an id yet, so client behaviour is unchanged and
`e2e/real-daemon-session-settings.spec.ts` stays red — #946 is the slice that makes it green.

## Files read

| Path | Symbol | Why it matters |
|---|---|---|
| `src/main/transport/requestSessionSettingsEnvelope.ts` | `buildRequestSessionSettings`, `RequestSessionSettingsInput` | The frame this slice changes; its header and builder doc both assert the dead bare contract |
| `src/main/transport/requestSessionSettingsEnvelope.test.ts` | `carries no conversation id or any other selector` | The one test whose premise inverts — it asserts an empty payload and carries the security argument this slice voids |
| `src/main/transport/dequeueMessageEnvelope.ts` | `buildDequeueMessage`, `DequeueMessageInput` | The payload-bearing builder analogue: wire-type import, `payload` passed through verbatim, same doc shape |
| `src/main/daemonConnection.ts` | `DaemonConnection.requestSessionSettings` (interface decl) and its implementation | The forwarding seam: `driver === null` no-op, shared `nextEnvelopeId`, never-throw catch |
| `src/main/daemonConnection.test.ts` | `sends a bare request_session_settings frame when connected` | Asserts `payload` `toEqual({})`; its comment states the daemon-wide contract as fact |
| `src/main/index.ts` | the `onCommand` switch's `requestSessionSettings` case | Where the validated command reaches the connection method; its comment repeats "Bare … the reply is daemon-wide" |
| `src/shared/ipc/commands.ts` | `RendererCommand`, `isRendererCommand`, `isDequeueMessagePayload`, `isRefuseQuestionsPayload` | The union member and boundary guard; the two `is*Payload` siblings are the single-string-field guard precedent |
| `src/shared/wire/types.ts` | `EnvelopeType` (`request_session_settings` arm), `SessionSettingsPayload`, `DequeueMessagePayload`, `Envelope` | Two dead-contract statements ~200 lines apart; `Envelope.payload` is `unknown`, so nothing here forces the new shape — a named payload interface is what makes it checked |
| `src/renderer/src/screens/conversation/runConfigSnapshot.ts` | `requestRunConfigSnapshot` | The one production sender of the bare literal. Read-only for this slice: it must keep typechecking untouched, which is what forces the optional payload |
| `src/shared/ipc/commands.test.ts` | the `isRendererCommand` bare-member cases | The accept/reject table this slice extends |
| `docs/knowledge/features/command-channel.md` § "The sealed union + constructor + guard", § "Security posture" | — | The guard-then-rebuild pattern and its dependence on structured clone; the "add the `case` in lockstep or the member is silently dropped" trap |
| `docs/knowledge/features/run-config-store.md` § "Configuration and usage", § "Data flow" | `requestRunConfigSnapshot`, `subscribeRunConfigRefresh` | Records the daemon-wide contract in several places. **Not edited here** — the documentation phase owns that file, and its two renderer callers are #946's |

Project memory carried into the design: *structured clone preserves an explicitly-`undefined`
property across the IPC bridge*, which is why the boundary guard tests the payload's **value** for
`undefined` rather than only `'payload' in value`.

## Design source

**Figma:** N/A — main- and shared-process only. This slice renders nothing; the visual-fidelity check
is intentionally skipped.

## Context

`request_session_settings` was genuinely bare when this client shipped it (#491). Two daemon commits
made it conversation-keyed — pyrycode#1586 (`bfb46f56`) added
`RequestSessionSettingsPayload{ConversationID string \`json:"conversation_id"\`}` and pyrycode#1610
(`54c979b7`) taught the handler to resolve it. The degradation is silent by construction: an
unnamed request "addresses nothing — the zero reply", no error frame, no log line. So this client has
been sending `payload: {}` since 2026-08-20 and receiving `session_id: ''` for it, which makes
`isAddressableSessionId('')` false, which makes `RunConfigSections` withhold `onChange`, which makes
the model row inert. About two weeks of real operator use with a run-config sheet that could not show
or confirm the running model.

No ADR is warranted: this is a wire-shape correction to match an upstream contract, not a new
decision. The upstream SSOT for the shape is `internal/protocol/settings.go`.

`set_session_settings` needs no change anywhere — `SetSessionSettingsPayload` is keyed by
`session_id`, not by conversation. The write is unreachable, not broken.

## Design

Thread one optional string from the renderer command boundary to the wire, and normalise it to a
present-always `conversation_id` at the frame builder.

### 1. `src/shared/wire/types.ts` — the payload type plus two comment corrections

Add the outbound payload interface, placed immediately before `SessionSettingsPayload` so request and
reply read together:

```ts
export interface RequestSessionSettingsPayload {
  conversation_id: string
}
```

Mirrors the daemon struct field-for-field. No `omitempty` upstream, so the key is always present on
the wire and `''` is a real value meaning "names nothing" — not an absence. `Envelope.payload` is
`unknown`, so this interface is the only thing that makes the emitted shape type-checked rather than
conventional.

Corrections in the same file: the `EnvelopeType` union arm's note ("Carries NO payload at all: the
reply is daemon-wide, so there is no field that could select another session's data") and
`SessionSettingsPayload`'s doc ("The answer to a **bare** `request_session_settings`"). Both must
state the conversation-keyed contract and the daemon's documented degradation.

### 2. `src/shared/ipc/commands.ts` — the member stops being bare

```ts
| { type: 'requestSessionSettings'; payload?: RequestSessionSettingsPayload }
```

**Optional, not required.** `requestRunConfigSnapshot` sends the bare literal today and this slice
does not touch the renderer; a required payload would break its typecheck. #946 tightens it.

The guard case accepts three inputs and rejects everything else:

- payload key absent → the bare shape, accepted unchanged
- payload present and `undefined` → also the bare shape. Testing the value, not just `'payload' in
  value`, is load-bearing: structured clone materialises an explicitly-`undefined` property across
  `ipcRenderer.send`, so an `in`-only check would reject a caller that spreads an optional id and
  silently drop the command at the boundary
- payload an object whose `conversation_id` is a string → accepted

A new `isRequestSessionSettingsPayload` mirrors `isRefuseQuestionsPayload`: one present-and-string
check, type not emptiness (`''` passes — the daemon polices ids), structural minimum (extra fields
harmless), pure, never throws.

### 3. `src/main/index.ts` — the route forwards the id

The `requestSessionSettings` case passes `command.payload?.conversation_id` to the connection method.
Nothing else in the route changes; the comment asserting bareness is corrected.

### 4. `src/main/daemonConnection.ts` — the method carries an optional id

```ts
requestSessionSettings(conversationId?: string): void
```

A scalar, not a payload object: the "absent means `''` on the wire" rule belongs to the builder (see
below), so the connection only forwards. Everything else is untouched — the `driver === null` inert
no-op, the shared monotonic `nextEnvelopeId` (advanced only on a successful build), and the
never-throw catch that drops the caught object.

### 5. `src/main/transport/requestSessionSettingsEnvelope.ts` — the frame

```ts
export interface RequestSessionSettingsInput {
  id: number
  ts: string
  /** The conversation to ask about; absent → `conversation_id: ''` on the wire. */
  conversationId?: string
}
```

The builder emits `payload: { conversation_id: input.conversationId ?? '' } satisfies
RequestSessionSettingsPayload`. The `?? ''` normalisation lives here, not in the connection, so the
"always a present string key, never omitted, never `null`" invariant is provable in this module's own
unit test against real codec bytes — the same place the old `payload: {}` invariant was proved.

The file header and the builder doc-comment are rewritten: the frame is no longer bare, the reply is
no longer daemon-wide, and the "daemon never reads Payload for this bare control type" claim is
false. The size argument survives verbatim in shape (a fixed-shape envelope plus one id can never
approach `MAX_PLAINTEXT_BYTES`), so the `MAY throw WireEncodeError in principle` note stays.

## State + concurrency model

No store slice, no async task, no stream, no new lifetime. The whole change is synchronous:
`sendCommand` → `ipcMain.on` → guard → switch → `connection.requestSessionSettings(id?)` →
`buildRequestSessionSettings` → `driver.sendMessage(bytes)`. The reply path
(`session_settings` → `runConfigReceived`) is untouched, as is its correlation by
`Envelope.in_reply_to`. Cancellation is unchanged because nothing here is cancellable — the request
is fire-and-forget and a disconnected send is an inert no-op that simply produces no reply.

## Error handling

- **Not connected.** `driver === null` → return. Unchanged; the sheet re-requests on its next open.
- **Encode failure.** The existing `catch` drops the caught object without rethrowing (parity #490),
  and `nextEnvelopeId` advances only on a successful build. Unchanged.
- **Malformed command at the boundary.** `isRendererCommand` returns false and the receiver drops the
  command — the existing default-deny, now also covering a non-string `conversation_id`.
- **Unresolvable id on the daemon side.** Documented upstream as a zero-valued `SessionSettingsPayload`
  — never an error frame, never another session's values — so a wrong id degrades to exactly today's
  behaviour. There is nothing for this client to surface, and no new UI state.

## Testing strategy

All vitest (node environment). No renderer render, no Playwright spec: this slice changes no rendered
markup and drives no interaction. `e2e/run-config-settings.spec.ts`'s fake daemon answers
`request_session_settings` without reading its payload, so the fake tier is unaffected — verified
before commit rather than assumed.

`src/main/transport/requestSessionSettingsEnvelope.test.ts` (real codec, actual wire bytes):

- round-trips to a `request_session_settings` envelope carrying the exact id and ts — payload now
  `{ conversation_id: '' }` for a caller that names none
- carries the named conversation id verbatim when one is supplied
- emits `conversation_id` as its **only** key — the surviving half of the deleted selector test: no
  second selector reaches the wire
- the key is present and a string in both shapes — never omitted, never `null`

The deleted test's security rationale is replaced, not dropped (see § Security review).

`src/main/daemonConnection.test.ts`:

- the existing not-connected no-op test is unchanged
- `sends a bare request_session_settings frame when connected` inverts: it now asserts
  `payload` `toEqual({ conversation_id: '' })` for the no-arg call
- a new case proves the id it is handed reaches the frame, asserting a **distinct** non-empty id so a
  transposition against the envelope's other string field (`ts`) cannot pass

`src/shared/ipc/commands.test.ts` — the guard's accept/reject table:

- accepts the bare `{ type: 'requestSessionSettings' }` (the shape the renderer still sends)
- accepts an explicitly `undefined` payload (the structured-clone case above)
- accepts `{ payload: { conversation_id: 'conv-1' } }`, and with an extra field (structural minimum)
- accepts `conversation_id: ''` — type, not emptiness
- rejects a non-string id, a payload missing the key, and `payload: null`
- types both shapes as `RendererCommand` members

## Open questions

1. **Does the builder take a scalar or the wire payload object?** Resolved in favour of the scalar
   before the plan commit: `buildDequeueMessage` takes a payload because its caller has one already
   validated, whereas here the "absent → `''`" normalisation is the frame's own invariant and belongs
   where its test lives.
2. **Is `RequestSessionSettingsPayload` warranted, given the ticket sketched `wire/types.ts` as a
   comment-only edit?** Resolved yes: `Envelope.payload` is `unknown`, so without a named type the
   emitted shape is convention rather than a checked contract, and the union member would have to
   inline a structural literal against the repo's "reuse wire types, no remapping" convention. It adds
   no file — `wire/types.ts` is already in the touched set.
3. **Should the guard reject an explicitly-`undefined` payload?** Resolved no; see § Design 2.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, and this is the category the slice actually moves. The boundary
  is single and explicit: `isRendererCommand` in `src/shared/ipc/commands.ts`, reached through
  `onCommand`. This slice widens what crosses it by exactly one optional string, validated by
  `isRequestSessionSettingsPayload` before `src/main/index.ts` reads it. Downstream the value is a
  plain `string | undefined` parameter on `DaemonConnection.requestSessionSettings` — the same
  untrusted-shaped-then-validated posture every payload-bearing sibling already has. The
  guard-then-rebuild property holds: `buildRequestSessionSettings` composes a **fresh object literal**
  rather than forwarding the renderer's object, so no accessor or extra key from the renderer reaches
  `encodeEnvelope`, and structured clone has already flattened any accessor before the guard ran.
- **[Replacement for the argument this slice voids]** The deleted test
  `carries no conversation id or any other selector` justified bareness with "no attacker-controlled
  field selects another session's data." That argument is gone and needs a real successor, not a
  deletion. Two halves. **Daemon side:** the field "is untrusted network input used for exactly one
  thing — an in-memory resolution through the handler's conversation-keyed run-configuration seam —
  and never reaches a log line, an error string, a filesystem path, or the reply"
  (`internal/protocol/settings.go`); an unhosted, unbound, or absent conversation is answered with a
  zero-valued `SessionSettingsPayload`, never an error frame and never another session's values.
  **Client side:** the id is client-owned — it comes from the renderer's own conversation state, not
  off the network — and travels as a JSON string field into `encodeEnvelope`. It is never a log
  field, a path, an attribute, a cache key, or a lookup key. So the worst a compromised renderer gets
  is a request for a conversation it names, as the already-authenticated user, whose failure mode is
  the zero reply it gets today. This reasoning is written into the replacement test's comment.
- **[Tokens, secrets, credentials]** No findings. The new field is a routing id, never a secret, per
  the established `conversation_id` / `session_id` convention. Nothing is generated, stored, rotated,
  or compared here — no RNG, no `safeStorage`, no `timingSafeEqual` question arises because nothing
  on this path compares the id to anything. The union doc's AC5 property is preserved: the added
  member's payload reuses a wire type with a single id field, so no member gains a field that could
  hold a token, key, or raw frame.
- **[File / storage operations]** Not applicable by design decision: this slice touches no filesystem
  path, no `fs` call, and no cache. The id is deliberately kept out of every path-shaped sink — stated
  as a constraint above rather than left implicit, because "conversation id" is exactly the kind of
  value a later ticket might be tempted to use as a filename.
- **[Inter-process / Electron attack surface]** No findings. No new IPC channel, no new
  `contextBridge` API, no `webPreferences` change, no protocol handler, no navigation surface. The
  added capability is one optional string on an existing channel behind an existing guard. Process
  placement is unchanged and correct: the envelope bytes are built in main
  (`requestSessionSettingsEnvelope.ts` imports `codec.ts` / Node `Buffer`) and this slice adds no
  renderer-side import of it.
- **[Cryptographic primitives]** Not applicable by design decision: no key, nonce, handshake, or AEAD
  framing is read or written. The frame is built above the Noise session and handed to
  `driver.sendMessage` as opaque bytes; the per-direction nonce counter is the driver's and is
  untouched. Sending one additional short string changes no `(key, nonce)` pairing.
- **[Network & I/O]** No findings. Outbound only, and the size argument that made
  `MAX_PLAINTEXT_BYTES` unreachable still holds: a fixed-shape ~90-byte envelope plus one
  conversation id, where the id is a client-owned uuid-shaped value, not attacker-supplied unbounded
  text. Worth naming: the client applies no explicit length cap to the id. That is acceptable because
  the only source is the client's own conversation state and `encodeEnvelope` already throws
  `WireEncodeError` above the plaintext cap, which the caller catches and drops — a bounded,
  fail-closed outcome rather than an oversized frame. Relay URL, TLS, timeout, and reconnect
  discipline are untouched.
- **[Error messages, logs, telemetry]** No findings, and one explicit constraint. The id must not be
  logged: the existing `catch` in `requestSessionSettings` drops the caught object and adds no log
  line, and this slice adds none. That is deliberate — content-free structured logging is the repo
  rule, and a conversation id in a log file under `userData` is exactly the kind of identifier the
  daemon-side reasoning above promises never reaches one. No error message, user-facing or
  console, gains the value.
- **[Concurrency]** Not applicable by design decision: the change is entirely synchronous, launches no
  task, registers no listener, and holds no shared mutable state across an `await`. The one piece of
  shared state on the path, `nextEnvelopeId`, keeps its existing advance-only-on-success discipline
  and is not read or written differently here.
- **[Threat model alignment]** **Malicious / compromised relay** — content-blind and unchanged; the id
  travels inside the Noise session, so an on-path relay learns nothing new, and it can already drop or
  delay this request. **Hostile daemon response** — the inbound `session_settings` decode is
  untouched and still parses defensively; the daemon's documented behaviour for an unresolvable id is
  a zero reply the client already handles. **Renderer compromise reaching the transport** — bounded
  above: one validated string, no reach to keys, socket, or token. **Token theft from disk** — not
  applicable; nothing is written to disk. **Out of scope, named:** where the renderer sources the id
  and whether the boundary tightens to a required payload is #946's, and the real-daemon spec that
  proves the chain end-to-end is #946's too (this slice is deliberately not labelled
  `needs-real-claude`, because it cannot make that spec pass).

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
