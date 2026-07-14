# #375 — `conversation_deleted` inbound decode → `conversationDeleted` event

**Size:** S (irreducible, compile-atomic inbound decode slice — precedents #273 / #241 / #201 all S, none split)
**Security-sensitive:** yes (decodes an inbound frame on the internet-exposed relay path, in the Electron background process — untrusted-peer input). Security review pass at the end of this doc.
**Ships dormant:** the event is emitted and unit-tested but has no renderer subscriber yet. The subscriber is #376.

## Design source

N/A — pure transport decode slice, no UI surface. The ticket has no `## Figma` section and none is needed.

---

## Files to read first

- `src/main/transport/inboundMessage.ts:587-607` — `parseConversationUpdatedPayload`, the fail-closed narrow to mirror (scaled down to one field).
- `src/main/transport/inboundMessage.ts:155-179` — `InboundDaemonMessage` union; add the new variant after `conversation-updated` (line 177). The doc block above it (lines 138-153) is where a one-paragraph note for the new kind goes.
- `src/main/transport/inboundMessage.ts:915-929` — `case 'conversation_updated'` decode arm to clone (narrow-before-log, content-free diagnostic).
- `src/main/transport/inboundMessage.ts:188-195` — `requireString`; the whole parse fn is one `isRecord` guard + one `requireString(payload, 'id')`.
- `src/main/transport/inboundMessage.ts:688-693` — the frame-level `MAX_PLAINTEXT_BYTES` guard that runs *before* the code switch, so `conversation_deleted` inherits the oversize check for free.
- `src/main/transport/inboundMessage.ts:38-49` — wire-type import block; add `ConversationDeletedPayload` here.
- `src/shared/wire/types.ts:670-690` — `ConversationUpdatedPayload` interface + its no-drift doc-comment style. The new `ConversationDeletedPayload` goes right after it (it is an *inbound* reply type, grouped with the other inbound reply; do NOT put it next to the *outbound* `DeleteConversationPayload` at 645).
- `src/shared/wire/types.ts:628-647` — `DeleteConversationPayload` doc-comment; it already states the reply is a "distinct `conversation_deleted { id }` record … decoding that reply … owned by … #367". Read it to keep the new type's wording consistent, and note the request field is `conversation_id` while **the reply field is `id`** — do not drift.
- `src/shared/ipc/events.ts:199-207` — `conversationUpdated` `DaemonEvent` arm to sit beside; add the new arm after line 207. Import block at 14-27.
- `src/main/daemonConnection.ts:640-652` — `case 'conversation-updated'` emit arm to clone. Note the inner switch has **no `assertNever`** (see `stall` arm's comment at 529-534) — the emit is guarded by a test, not the compiler.
- `src/main/daemonConnection.ts:416-421` — the single `try/catch` around `parseInboundMessage`: a thrown `WireDecodeError` is caught and dropped (no event, no throw). This is the decode boundary AC3 depends on; you don't add anything here.
- `src/main/transport/inboundMessage.test.ts:96-98, 253-266, 832-867, 869-910, 2249-2280` — the `conversation_updated` test scaffolding (encoder helper, fixtures) + three describe blocks (recognition, fail-closed, content-free-log) to clone.
- `src/main/daemonConnection.test.ts:268-270, 2287-2310` — the `conversation_updated` plaintext helper + the decode→emit and malformed-drop tests to clone.

---

## Context

`delete_conversation` (#364) ships the dormant outbound `deleteConversation` command. Unlike archive / unarchive / promote — which the daemon confirms with an **unsolicited `conversation_updated` broadcast** the existing list-reflect path (#273 / #275) already consumes — a delete is confirmed with a **distinct, correlated `conversation_deleted { id }` record and NO broadcast** (pyrycode #822). That reply frame is currently **undecoded**: `inboundMessage.ts` has no `conversation_deleted` case, so a deletion never reaches the renderer.

This slice adds the inbound half only — the wire type, the fail-closed decode, and the `conversationDeleted` `DaemonEvent`. It is the inbound mirror of the `conversation_updated` decode already in the file. No renderer consumer (that is #376). This is the decode half of the now-split #367.

---

## Design

Six additive edits across four production files, plus two test files. Zero call-site fan-out — every edit is a new union member / new function / new switch arm. Nothing existing changes signature.

### 1. Wire type — `src/shared/wire/types.ts`

Add, immediately after `ConversationUpdatedPayload` (line 690):

```ts
export interface ConversationDeletedPayload {
  id: string
}
```

A **single required `id: string`**, mirroring the daemon's `conversation_deleted { id }` reply field-for-field. Give it a no-drift doc-comment in the house style (see `ConversationUpdatedPayload` at 670-683). The comment must state:
- Inbound `conversation_deleted` reply body (daemon → client), **correlated** by `in_reply_to` (NOT a broadcast — the deliberate contrast with `conversation_updated`).
- The field is **`id`**, distinct from the request's `conversation_id` — do not drift it (pyrycode #822 / CLAUDE.md wire-contract rule).
- `id` is a routing id (an existing row's id), not a secret; the desktop never resolves it into a filesystem path.
- Exactly one field — do **not** borrow `ConversationUpdatedPayload`'s five-field / `null`-name language.

### 2. Parse fn — `src/main/transport/inboundMessage.ts`

Add `parseConversationDeletedPayload` beside `parseConversationUpdatedPayload` (~line 607):

```ts
function parseConversationDeletedPayload(payload: unknown): ConversationDeletedPayload
```

Behaviour (mirror `parseConversationUpdatedPayload`, scaled to one field): `isRecord` guard → `throw new WireDecodeError('malformed conversation_deleted payload')`; then `const id = requireString(payload, 'id')`; `return { id }`. A **fresh single-field object** — unknown server-added keys are tolerated (forward-compat) but not copied. The error message names the failure category only (never interpolates `id`, though `id` is a routing id not a secret — the category-only posture is uniform across the file). Import `ConversationDeletedPayload` in the type-import block (38-49).

Invariant asserted by: the fail-closed test block (see Testing).

### 3. `InboundDaemonMessage` variant — `src/main/transport/inboundMessage.ts`

Add after the `conversation-updated` member (line 177):

```ts
| { kind: 'conversation-deleted'; conversationDeleted: ConversationDeletedPayload }
```

Add a one-paragraph note in the union's doc block (near the `conversation-created` / modal notes, ~150): the kind carries the decoded single-field `ConversationDeletedPayload`; the emit flattens it to the bare `id` (see §5). `id` is untrusted daemon-supplied routing text — no consumer resolves it to a path.

### 4. Decode case — `src/main/transport/inboundMessage.ts`

Add `case 'conversation_deleted':` in the code switch, after `conversation_updated` (~line 929). Clone the `conversation_updated` arm exactly:
- **Narrow before logging** — call `parseConversationDeletedPayload(envelope.payload)` first, so a malformed reply throws and leaves no log record.
- **Content-free diagnostic** — `diagnosticLog?.event({ event: 'inbound-decoded', code: 'conversation_deleted', bytes: plaintext.length, hash: hashPlaintext(plaintext) })`. **Type / bytes / hash only — the `id` is never logged**, and no `count` field (uniform with every sibling arm).
- `return { kind: 'conversation-deleted', conversationDeleted }`.

The oversized-frame case needs no new code: the `MAX_PLAINTEXT_BYTES` guard at line 690 runs before this switch and covers every code.

### 5. `DaemonEvent` variant — `src/shared/ipc/events.ts` (SHARED file)

Add after the `conversationUpdated` arm (line 207):

```ts
| { type: 'conversationDeleted'; id: string }
```

**Design decision — carry the bare `id`, not the payload object.** The sibling `conversationUpdated` carries `{ conversation: ConversationUpdatedPayload }` because that payload has five fields with "nothing to drop", so it reuses the wire type by reference. `conversation_deleted` has exactly one field, and the emit convention for single-/few-field arms is a **fresh literal naming individual fields** (see `turnState` carrying `state`, `sessionTransition` naming four fields, `assistantDelta` naming three). Flattening to `id: string` is the natural bottom of that idiom: the renderer (#376) removes a row by id, a bare string is exactly what it needs, and `events.ts` stays free of a `ConversationDeletedPayload` import (the event is decoupled from the wire type — a primitive crosses IPC). Do **not** clone `conversationUpdated`'s `{ conversation: … }` shape here; that nesting buys nothing for one field.

Doc-comment (house style, see the `conversationUpdated` arm at 199-206): correlated reply arm (#375), **not** a broadcast; carries only the routing `id`; consumed by the list-reflect slice #376, so every exhaustive consumer no-ops it for now; ships dormant. No token / key / raw frame can ride a bare string id.

### 6. Emit arm — `src/main/daemonConnection.ts`

Add `case 'conversation-deleted':` after `conversation-updated` (~line 652):

```ts
emitDaemonEvent(sink, { type: 'conversationDeleted', id: inbound.conversationDeleted.id })
```

Clone the `conversation-updated` emit discipline, with these notes in the comment:
- The reply is **correlated** by `in_reply_to`, but the event carries only the self-sufficient `id` — **no outstanding-request / correlation state is threaded here** (#376 removes by id). Emit unconditionally on decode, exactly like the `conversation-updated` broadcast arm emits unconditionally.
- A **fresh literal naming the single `id` field**, never a spread of the decoded payload (so a decoder that ever grew an extra field can't smuggle it across IPC).
- **Not compile-forced** — the inner `switch (inbound.kind)` has no `assertNever` (same as the `stall` arm, 529-534). The round-trip test in `daemonConnection.test.ts` is what guards this emit. **This is the load-bearing reason both test blocks are mandatory** (see Testing): without the daemonConnection decode→emit test, a forgotten emit arm compiles clean and ships a dead decode.

---

## State + concurrency model

None introduced. This slice is a pure function extension (`parseInboundMessage`) plus one stateless emit arm at the existing `InboundDaemonMessage → DaemonEvent` choke point. No store slice, no async task, no subscription, no teardown. The event flows main → renderer over the existing typed IPC channel and is dropped by every current consumer (dormant).

The reply is correlated to its request by `in_reply_to`, but — matching the `conversation-updated` arm — the decode/emit path threads no correlation memory. The `id` in the payload is self-sufficient for #376.

---

## Error handling

| Failure | Layer | Result |
|---|---|---|
| Missing / non-string `id` | `parseConversationDeletedPayload` | `throw WireDecodeError` (category-only message) — narrow runs before the log, so no record is written |
| Non-object payload | `parseConversationDeletedPayload` (`isRecord` guard) | `throw WireDecodeError` |
| Oversized-but-valid-JSON frame | `MAX_PLAINTEXT_BYTES` guard (line 690, pre-switch) | `throw WireDecodeError` — inherited, no new code |
| Any of the above, at the transport boundary | `try/catch` around `parseInboundMessage` in `daemonConnection.ts:418-421` | Caught and **dropped** — no `conversationDeleted` event, no throw past the boundary (AC3) |

Fail-closed posture is identical to `parseConversationUpdatedPayload`. No new UI surfacing — the event is dormant; a dropped malformed frame is silent by design (a hostile/buggy daemon cannot make the window throw or leak the frame bytes into a log).

---

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. Clone **both** sibling test blocks — a decode change tested on only one side has been a code-review failure before (memory: builder-test-only = code-review FAIL).

### `src/main/transport/inboundMessage.test.ts`
- **Scaffold** — add an `encodeConversationDeleted(payload)` helper (clone `encodeConversationUpdated`, 96-98, `type: 'conversation_deleted'`) and a `DELETED` fixture `{ id: 'conv-…' }` (clone the `UPDATED_*` fixtures, 253-266, but single-field).
- **Recognition** (clone 832-867): a well-formed `conversation_deleted` reply narrows to `{ kind: 'conversation-deleted', conversationDeleted: { id } }`; unknown extra keys are tolerated but not copied through (assert the result equals the fresh single-field object, not the input-with-extras).
- **Fail-closed** (clone 869-910): missing `id`, non-string `id` (number / null / object), and a non-object payload (string, array) each `toThrow(WireDecodeError)`; plus the oversized-but-valid-JSON case (clone 912) throws.
- **Content-free log** (clone 2249-2280): a valid decode logs exactly `{ event: 'inbound-decoded', code: 'conversation_deleted', bytes, hash }` — assert the record has no `id` and no `count`; a malformed decode logs **nothing** (narrow-before-log).

### `src/main/daemonConnection.test.ts`
- **Scaffold** — add a `conversationDeletedPlaintext(payload)` helper (clone 268-270).
- **decode→emit** (clone 2287-2295): feeding a valid `conversation_deleted` plaintext emits exactly `[{ type: 'conversationDeleted', id: '<the id>' }]` — one event, bare `id`, nothing else. **This is the test that guards the un-compile-forced emit arm.**
- **malformed-drop** (clone 2296-2310): a malformed `conversation_deleted` (e.g. `id` a number) emits **nothing** and does not throw.

Write these as scenarios in the project's existing test idiom — do not hand-transcribe the sibling bodies; clone the structure and swap the code/fixture/field.

---

## Scope guardrails (do NOT do here)

- No renderer subscriber, no store slice, no bridge — that is #376. The event ships dormant.
- No outbound / IPC command changes — #364 owns the `deleteConversation` command and its guard.
- No correlation state threaded through decode/emit — the `id` is self-sufficient.
- Do not touch the `DeleteConversationPayload` outbound type or `commands.ts` — their doc-comments already point the reply-decode here; leave them.
- Do not add a `docs/knowledge/codebase/*.md` deliverable — the documentation phase owns that.

---

## Open questions

None. The wire contract (`conversation_deleted { id }`, correlated, no broadcast) is fixed by pyrycode #822 and already documented on `DeleteConversationPayload`. The one non-obvious call — flattening the event to a bare `id` rather than cloning `conversationUpdated`'s `{ conversation }` shape — is decided in §5.

---

## Security review

**Trust boundary.** This decodes an inbound frame arriving over the content-blind relay from the paired daemon, in the Electron background process. The peer is *authenticated* by the Noise_IK handshake (a MITM on the relay cannot forge or inject frames — the relay never holds keys), so the adversary model is a **hostile, buggy, or compromised daemon** sending a well-formed-envelope-but-malformed-payload `conversation_deleted`, an oversized frame, or a spurious/unsolicited delete.

**Walk of the categories:**

1. **Untrusted input → parser.** The payload is opaque `unknown` until `parseConversationDeletedPayload` narrows it. Missing / non-string `id`, non-object payload, and oversized-valid-JSON all fail closed with `WireDecodeError` (the last via the pre-switch `MAX_PLAINTEXT_BYTES` guard). The transport boundary (`daemonConnection.ts:418-421`) catches and drops — no event, no throw, no partial value. Matches the audited `parseConversationUpdatedPayload` posture. **PASS.**

2. **Information disclosure via logs.** The diagnostic log is content-free by construction: `code / bytes / hash` only, narrow-before-log so a malformed frame leaves no record, and the `id` is never interpolated. Uniform with every sibling decode arm (AC7 lineage). **PASS.**

3. **Injection / sink reachability.** The decoded `id` crosses IPC as a bare `string` and is dropped by every current consumer (dormant). It is **not** resolved into a filesystem path, a URL, a shell arg, or a DOM sink in this slice. #376 will use it only as a store-row key (a bounded `id` lookup / removal — no path traversal, no `innerHTML`). The doc-comments carry the "untrusted display text, render as plain text, never HTML" warning forward for #376. **PASS (this slice); constraint propagated.**

4. **Spurious / unsolicited delete (authorization).** A hostile daemon could emit `conversation_deleted` for an arbitrary `id` it was never asked to delete. This is **within the daemon's authority**: the daemon is the source of truth for the conversation set — it can already push `conversation_updated` broadcasts and the full `conversations` list, so a spurious delete-by-id grants no capability the authenticated peer lacks. No client-side correlation gate is warranted (and the ticket explicitly threads none) — matching how `conversationUpdated` emits unconditionally on an unsolicited broadcast. Evidence-based: no observed failure mode here justifies a correlation-enforcement mechanism. **PASS (accepted, documented).**

5. **Secret / key / raw-frame leakage across IPC.** The event carries a single `string` id — structurally incapable of holding a token, key, or raw frame (a bare primitive, a fresh literal, never a spread of the decoded payload). **PASS by construction.**

**Verdict: PASS.** No finding requires a spec revision. The slice adds a strictly fail-closed, content-free, sink-free decode that mirrors an already-audited sibling; the one authorization consideration (unsolicited delete) is within the authenticated daemon's existing authority and is documented rather than defended.
