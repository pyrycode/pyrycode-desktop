# Spec: Decode the v2 conversation list (`list_conversations` → `conversations`) into a typed daemon event (#139)

## Context

Desktop has a single conversation today. Every conversation-list, navigation, archive, and
channel-management feature (mirror mobile #312) needs a live conversation list first. This is the
**transport half** of that foundation: request the list over v2, decode the reply at the
untrusted→trusted boundary, and emit one typed `DaemonEvent`. The renderer store slice that lands the
event and the on-connect request *trigger* are the sibling ticket **#208** (blocked by this one); it
is renderer-only and NOT security-sensitive.

The daemon speaks a request/response pair: the client sends `list_conversations` (empty payload) and
the daemon replies `conversations` carrying an array of conversation summaries. This is an **exact
clone of two shipped precedents**:

- **`request_snapshot` → `screen_snapshot` (#180, PR #185)** — the full main-side vertical: a
  request-envelope builder, a `RendererCommand` arm + `isRendererCommand` guard case, an `index.ts`
  `onCommand` case, an inbound decode arm in `parseInboundMessage`, a new `DaemonEvent` member the
  consumer emits, and a bridge `null`-case + `assertNever` touch.
- **`assistant_delta` / `turn_end` (#199, PR #207)** — the inbound decode chain with a `null`-name
  analogue absent (both were all-required-string), verified 5-file architectural floor.

Because this decodes input from a non-trusted party on the internet-exposed relay surface AND adds a
renderer→main command arm through the `isRendererCommand` boundary guard, the ticket is
`security-sensitive` (see § Security review below).

### Wire contract (source of truth — verified against the daemon Go, do not drift)

Verified against `pyrycode/internal/protocol/conversations_read.go` (#273 spec, current shape after
#880's `is_archived` addition). `ConversationSummary` carries exactly, in this wire order:

| wire field | Go type | TS type | notes |
|---|---|---|---|
| `id` | `string` | `string` | conversation id |
| `name` | `*string` | `string \| null` | title; **literal `null`** = unnamed scratch conversation. **No `omitempty`** — always present, either a string or `null`, **never absent** |
| `is_promoted` | `bool` | `boolean` | `true` = saved **channel**; `false` = ad-hoc **discussion** |
| `is_archived` | `bool` | `boolean` | archived flag (added daemon-side #880, right after `is_promoted`, **no `omitempty`**) |
| `cwd` | `string` | `string` | the conversation's workspace path. **Untrusted daemon-supplied string** — decoded and carried as opaque display text on desktop; this ticket never resolves it into a filesystem path (see § Security review) |
| `last_message_ts` | `time.Time` | `string` | RFC3339 (Go `time.Time` serialises to a string) |
| `last_used_at` | `time.Time` | `string` | RFC3339 |

- The `conversations` reply body is `{ "conversations": ConversationSummary[] }`.
- The `list_conversations` request body is empty (`payload: {}` on the wire — the daemon's
  `ListConversationsPayload struct{}`).
- **Order is preserved from the wire** — the daemon is the source of truth for ordering (e.g.
  most-recently-used first). Do not reorder here.

## Files to read first

- `src/shared/wire/types.ts:40-56` — `EnvelopeType` union + `Envelope`. Add the two new type names
  here; note `payload: unknown` stays opaque until narrowed.
- `src/shared/wire/types.ts:94-103` — `MessagePayload` / `MessageChunkPayload`: the row-type +
  list-wrapper precedent to mirror (`ConversationSummary` / `ConversationsPayload`).
- `src/shared/wire/types.ts:147-174` — `AssistantDeltaPayload` / `TurnEndPayload` (#199): the most
  recent "mirror the daemon field-for-field, no `omitempty`" doc-comment style to copy.
- `src/main/transport/inboundMessage.ts:73-119` — `InboundDaemonMessage` union + the three
  `requireString` / `requireNumber` / `requireBoolean` helpers. Add the new `conversations` arm and a
  new `requireStringOrNull` helper (the `name` field is the only nullable field in the codec so far).
- `src/main/transport/inboundMessage.ts:130-207` — `parseMessagePayload` (the "return only known
  fields, tolerate unknown keys, category-only error messages" pattern) + `parseMessageChunkPayload`
  (array-of-rows, one bad element fails the whole chunk) + `parseScreenSnapshotPayload`. Your
  `parseConversationSummary` / `parseConversationsPayload` mirror these exactly.
- `src/main/transport/inboundMessage.ts:252-377` — the `parseInboundMessage` switch: the per-case
  "narrow BEFORE logging so the throw path leaves no record" content-free logging pattern, and the
  `default` unmodeled-catch-all. Add one `case 'conversations':`.
- `src/main/transport/requestDebugBundleEnvelope.ts` (whole file, ~50 lines) — the **bare
  control-frame builder** to clone. `list_conversations` has an empty payload, so this — not
  `requestSnapshotEnvelope.ts` — is the exact shape (`payload: {}` present-but-empty; the
  `codec.ts:133` decode requires a present payload; never `null`; never an omission).
- `src/main/transport/requestSnapshotEnvelope.ts` (whole file, ~44 lines) — for contrast only: the
  payload-*carrying* builder. Confirm you are cloning `requestDebugBundle`, not this.
- `src/main/daemonConnection.ts:104-124` — the `DaemonConnection` interface (`send` /
  `requestSnapshot` / `requestDebugBundle` doc contracts). Add `requestConversations(): void`.
- `src/main/daemonConnection.ts:241-292` — the `switch(inbound.kind)` consumer + the `snapshot`
  (content-drop) and `assistant-delta` (fresh-literal) emit precedents. Add one `case 'conversations':`.
- `src/main/daemonConnection.ts:431-446` — `requestSnapshot` impl (the "send twin": inert no-op when
  `driver === null`, shares `nextEnvelopeId`, try/catch drops). `requestConversations` mirrors it,
  minus the payload arg.
- `src/shared/ipc/events.ts:50-73` — the `DaemonEvent` union + the `messagesReceived` arm (reuses
  `readonly MessagePayload[]` verbatim). Add `conversationsReceived` the same way.
- `src/renderer/src/store/daemonEventBridge.ts:27-65` — `translateDaemonEvent` + the load-bearing
  `assertNever`. Add `case 'conversationsReceived': return null` (store #208 consumes it).
- `src/shared/ipc/commands.ts:39-93` — `RendererCommand` union + `isRendererCommand` guard + the bare
  `requestDebugBundle` case (`return true`). Add `requestConversations` the same bare way.
- `src/main/index.ts:234-248` — the single `onCommand` switch. Add
  `case 'requestConversations': connection.requestConversations(); return`.
- `src/main/transport/requestDebugBundleEnvelope.test.ts` + `src/main/transport/inboundMessage.test.ts`
  — the test shapes to mirror (builder round-trip; decode happy + fail-closed + content-free log).
- `docs/knowledge/codebase/199.md` (QMD `pyrycode-desktop-docs` absent → read via repo) — the #199
  implementation summary; this ticket is the same shape one layer wider (adds the outbound plumbing).

## Design

Eight production touch points — the same vertical #180 shipped (inbound decode chain **plus** the
outbound `RendererCommand` plumbing). One new file; seven additive edits. No renames, no signature
changes to existing exports, no consumer cascade.

### 1. Wire types — `src/shared/wire/types.ts` (modify)

- Add `'list_conversations'` and `'conversations'` to `EnvelopeType`.
- Three new types (contract sketch; mirror the `AssistantDeltaPayload` doc-comment style):

```ts
/** Outbound `list_conversations` request body (client → daemon). Empty by spec — the daemon's
 *  ListConversationsPayload struct{}. Documentary: the bare builder emits `payload: {}` directly. */
export type ListConversationsPayload = Record<string, never>

/** One row of a `conversations` reply. Mirrors the daemon ConversationSummary field-for-field
 *  (conversations_read.go, post-#880), wire order below — all always present, no `omitempty`.
 *  `name` is `string | null`: literal `null` (never absent) is a distinct "unnamed scratch
 *  conversation", NOT an empty string. `is_promoted`/`is_archived` are booleans (`false` is a value,
 *  not an absence). `last_message_ts` is a TIMESTAMP, not preview text — there is no message text on
 *  this wire. */
export interface ConversationSummary {
  id: string
  name: string | null
  is_promoted: boolean
  is_archived: boolean
  cwd: string
  last_message_ts: string
  last_used_at: string
}

/** Inbound `conversations` reply body (daemon → client). Order preserved from the wire. */
export interface ConversationsPayload {
  conversations: ConversationSummary[]
}
```

### 2. Inbound decode — `src/main/transport/inboundMessage.ts` (modify)

- New helper `requireStringOrNull(payload, field): string | null` — the sibling of `requireString` /
  `requireBoolean` for the one nullable wire field. It accepts a `string` **or** literal `null`, and
  throws `WireDecodeError` on anything else, **including a missing/`undefined` field** (`name` is never
  absent on the wire). This is the AC2 mechanism: `null` → `null` (distinct unnamed), string → string,
  missing/number/object → fail closed. Category-only message (no field value interpolated — `name`
  could echo a conversation title).
- `parseConversationSummary(payload: unknown): ConversationSummary` — fail-closed like
  `parseMessagePayload`: `isRecord` guard, then `requireString` for `id`/`cwd`/`last_message_ts`/
  `last_used_at`, `requireStringOrNull` for `name`, `requireBoolean` for `is_promoted`/`is_archived`.
  Returns only the seven known fields; unknown server-added keys are tolerated (forward-compat) but
  **not copied through** (this is what keeps the emitted event minimal — see § 4).
- `parseConversationsPayload(payload: unknown): ConversationsPayload` — mirror
  `parseMessageChunkPayload`: `conversations` must be an array, each element narrows via
  `parseConversationSummary` (one bad element throws, failing the whole reply closed). An empty array
  is valid.
- Add `{ kind: 'conversations'; conversations: ConversationSummary[] }` to `InboundDaemonMessage`.
- Add `case 'conversations':` to the `parseInboundMessage` switch: narrow BEFORE logging (throw path
  leaves no record), then log content-free and return the arm. Logging: **`{ event: 'inbound-decoded',
  code: 'conversations', bytes: plaintext.length, hash: hashPlaintext(plaintext) }`** — type + byte
  length + one-way hash ONLY (AC7). **Trap: do NOT add a `count` field** (unlike the `message_chunk`
  arm which logs `count`): AC7 restricts the set to type/bytes/hash, and a conversation-count is more
  identifying than a message-batch size. No new `DiagnosticEvent` field, so #131's renderer pin is
  untouched.

### 3. Request builder — `src/main/transport/listConversationsEnvelope.ts` (NEW)

Clone `requestDebugBundleEnvelope.ts` exactly — a **bare** control-frame builder.

```ts
export interface ListConversationsInput { id: number; ts: string }
export function buildListConversations(input: ListConversationsInput): Uint8Array
// → encodeEnvelope({ id, type: 'list_conversations', ts, payload: {} })
```

Copy `buildRequestDebugBundle`'s `payload: {}` rationale into the doc comment verbatim: the daemon
tolerates an absent/`{}`/`null` payload for this bare type, but the desktop's own `decodeEnvelope`
(`codec.ts:133`) requires a present `payload`, so emit present-but-empty `{}`, never an omission,
never `null`. Do not "fix" this.

### 4. Main-side consumer — `src/main/daemonConnection.ts` (modify)

- Import `buildListConversations`.
- Add to the `DaemonConnection` interface + impl a **`requestConversations(): void`** method — the
  send twin of `requestSnapshot` (§ signature contract in the interface doc): inert no-op when
  `driver === null` (a list request has no consumer to fail, unlike `requestDebugBundle`); shares the
  one monotonic `nextEnvelopeId`; wraps the build/send in a try/catch that drops (never throws out of
  the module, parity #490). Bare — no payload argument. Add it to the returned object literal.
  **It has no caller in this ticket** — #208 triggers it via `sendCommand` on connect, exactly as #181
  triggered `requestSnapshot`. That is expected, not dead code.
- Add `case 'conversations':` to the `switch(inbound.kind)`: emit a fresh literal reusing the
  already-minimal decoded array — mirror `messagesReceived`, **not** the `snapshot` content-drop:

```ts
case 'conversations':
  emitDaemonEvent(sink, { type: 'conversationsReceived', conversations: inbound.conversations })
  return
```

There is nothing to drop (no secret field): the decoder already stripped unknown keys, so passing the
`ConversationSummary[]` reference is safe and matches `messagesReceived: inbound.messages`. Field
names stay **snake_case** — the event reuses the wire `ConversationSummary` verbatim (like
`messagesReceived` reuses `MessagePayload`), so #208's store reads snake_case and derives the
discussion/channel label from `is_promoted`. **Do NOT invent a camelCase remap or a `kind` enum here.**

### 5. Typed event — `src/shared/ipc/events.ts` (modify)

- Import `ConversationSummary` from `../wire/types`.
- Add `| { type: 'conversationsReceived'; conversations: readonly ConversationSummary[] }` to
  `DaemonEvent`, reusing the wire row type verbatim (the `messagesReceived` precedent). Extend the
  doc-comment note: consumed by the conversation-list store (#208), not the session store, so the
  session bridge maps it to `null`. No token/key/raw frame — `ConversationSummary` carries only ids,
  a nullable title, two flags, a workspace path, and two timestamps.

### 6. Session bridge — `src/renderer/src/store/daemonEventBridge.ts` (modify)

Add `case 'conversationsReceived': return null` (the conversation-list store #208 consumes it, not the
session store). This is the forced change the load-bearing `assertNever` demands — a new `DaemonEvent`
arm is a compile error until it has a case. Update `daemonEventBridge.test.ts` for the new arm (see
§ Testing).

### 7. Command union + boundary guard — `src/shared/ipc/commands.ts` (modify)

- Add `| { type: 'requestConversations' }` to `RendererCommand` — **bare**, like `requestDebugBundle`
  (the request carries no payload).
- Add `case 'requestConversations': return true` to `isRendererCommand` (a bare member: a well-formed
  `type` is complete acceptance — no payload to validate). This is the untrusted renderer→main boundary
  edit that makes the ticket security-sensitive; it stays here (not on the non-security #208), exactly
  as #180 kept `requestSnapshot`'s guard on the main-side ticket.

### 8. Command dispatch — `src/main/index.ts` (modify)

Add to the `onCommand` switch:

```ts
case 'requestConversations':
  connection.requestConversations()
  return
```

Direct to the connection method (mirrors `sendMessage` / `requestSnapshot`), no orchestrator — a list
request has no consumer/reassembler.

### Data flow

```
#208 store (on `connected`)
  → sendCommand({type:'requestConversations'})            [renderer, #208]
  → isRendererCommand ✓  →  onCommand → connection.requestConversations()   [main, this ticket]
  → buildListConversations({id,ts}) → driver.sendMessage(list_conversations {payload:{}})
        ─────────────── relay ───────────────
  daemon replies `conversations`
  → driver `message` event → parseInboundMessage → {kind:'conversations', conversations:[…]}
  → switch(inbound.kind) 'conversations' → emitDaemonEvent({type:'conversationsReceived', conversations})
  → DAEMON_EVENT_CHANNEL → #208 store bridge lands it; daemonEventBridge (session) maps → null
```

## State + concurrency model

- **No new store, no new state in this ticket.** The transport is stateless for this path: a request
  is fire-and-forget, the reply is decoded and emitted as one event. State lands in #208's Zustand
  slice.
- `requestConversations` shares the single module-local `nextEnvelopeId` counter (single-writer, no
  `await` between read and increment → no check-then-act race), so ids stay unique across interleaved
  `send` / `requestSnapshot` / `requestDebugBundle` / `requestConversations` calls.
- **Cancellation/teardown:** none needed. Unlike `requestDebugBundle`, a list request arms no
  reassembler and owns no consumer, so a socket drop mid-flight simply produces no reply (no hang, no
  leaked slot). `requestConversations` is an inert no-op after `stop()` (driver torn down → `driver ===
  null`). An unsolicited or late `conversations` frame is decoded and emitted harmlessly; #208's store
  is the single source of truth for what the UI shows.
- **No correlation.** The desktop transport routes inbound frames by `type` only (no `in_reply_to`
  map). A `conversations` reply is matched to no specific request — consistent with `screen_snapshot`
  (#180). This is safe: the content-blind relay cannot forge in-session frames (only the authenticated
  daemon can emit `conversations` through the Noise channel), so an unsolicited reply merely reflects
  the daemon's real state.

## Error handling

| Failure mode | Layer | Result |
|---|---|---|
| Oversized plaintext | `parseInboundMessage` size guard | throws `WireDecodeError` (fail closed); the `daemonConnection` `message` catch drops the frame — no event, no throw |
| `payload` not an object | `parseConversationsPayload` `isRecord` | throws `WireDecodeError` |
| `conversations` missing / not an array | `parseConversationsPayload` | throws `WireDecodeError` |
| a row missing a required field, or `name`/`is_promoted`/`is_archived`/etc. mistyped | `parseConversationSummary` (one bad element fails the whole reply) | throws `WireDecodeError` |
| `name: null` on the wire | `requireStringOrNull` | decodes to `null` — a **valid distinct value** (AC2), never a failure, never `""` |
| request built while disconnected | `connection.requestConversations` (`driver === null`) | inert no-op — no send, no throw |
| build/send throw (over-cap, driver/wasm error) | `requestConversations` try/catch | dropped — never throws out of the module (parity #490) |
| malformed command from a compromised renderer | `isRendererCommand` | rejected at the boundary; never reaches `onCommand` |

Every caught object is **dropped** (classify-don't-forward) — a `WireDecodeError` message could echo a
conversation title/cwd, so it never reaches a log or an event. All decode failures collapse to the
single `WireDecodeError` type, so the consumer's one `catch` covers oversized / malformed /
unparseable / mistyped alike. This exactly matches the existing `message` / `snapshot` / `assistant_delta`
arms — no new failure-handling shape.

## Testing strategy

`npm test` (vitest); `npm run typecheck`; `npm run build` (salvage/QA gate). Fresh worktree needs
`npm install` first (no `node_modules`; do not use a global `vitest`). Test-first: RED before GREEN.
Describe scenarios, not full function bodies — write them in the project idiom.

- **`inboundMessage.test.ts` — decode happy path:** a `conversations` frame with ≥2 rows, one with
  `name: null` and one with a string name, and mixed `is_promoted`/`is_archived` (include `false`).
  Assert: returns `{ kind: 'conversations', conversations: [...] }`; row order preserved; `name === null`
  on the unnamed row and the string on the named row; both booleans decoded (including `false`); an
  empty `conversations: []` frame decodes to an empty array.
- **`inboundMessage.test.ts` — fail-closed:** each of — `payload` not an object; `conversations`
  missing; `conversations` not an array; a row missing `id`/`cwd`/`last_message_ts`/`last_used_at`; a
  row with `name` **absent/undefined**; a row with `name: 42`; a row with `is_promoted: "true"`; a row
  with `is_archived` missing; an oversized frame — throws `WireDecodeError`, returns no partial value,
  and the error message names no field value.
- **`inboundMessage.test.ts` — content-free log:** inject a fake `DiagnosticLog`; on a valid decode,
  assert exactly one record whose key set is `{ event, code, bytes, hash }` (plus the logger's own
  `seq`/`ts` stamps) with `code === 'conversations'` — and **no** `count` key and **no** decoded field
  (no id/name/cwd). On a throw, assert **no** record is emitted.
- **`listConversationsEnvelope.test.ts` (NEW):** `buildListConversations({ id, ts })` → `decodeEnvelope`
  the bytes → assert `{ id, type: 'list_conversations', ts, payload: {} }`. Mirror
  `requestDebugBundleEnvelope.test.ts` (including an assertion that `payload` is a present empty object,
  not absent/`null`).
- **`commands.test.ts`:** `isRendererCommand({ type: 'requestConversations' })` → `true`; with an extra
  unknown field → still `true` (structural minimum); a non-object / missing `type` → `false`.
- **`daemonConnection.test.ts` — emit + request:** drive the fake driver's `message` event with a
  crafted `conversations` plaintext → assert exactly one `conversationsReceived` event whose
  `conversations` equals the decoded summaries, with `name: null` preserved and no extra keys.
  `requestConversations()` before connect (driver null) → no send, no throw. After handshake → the fake
  driver captures one `sendMessage`; decode it → `type === 'list_conversations'`, `payload` is `{}`.
- **`daemonConnection.roundtrip.test.ts` — e2e (AC8 round-trip):** use the `fakeDaemon`
  `buildReplyFrames` seam (receives the inbound `list_conversations` plaintext) to return a crafted
  `conversations` reply; assert one `conversationsReceived` event with the decoded summaries including
  the `null`-name row. Mirror #180's `daemonConnection.roundtrip.test.ts`.
- **`daemonEventBridge.test.ts`:** `translateDaemonEvent({ type: 'conversationsReceived', conversations:
  [...] })` returns `null`; the existing exhaustiveness (assertNever) still compiles with the new arm.

Type-level coverage: `npm run typecheck` proves the `assertNever` guard forces the new bridge case and
that `ConversationSummary`/`RendererCommand`/`DaemonEvent` line up across the process boundary.

## Scope self-check (auditable)

**Size: S. 8 production `.ts` files (7 modified + 1 new); ~170 production LOC + ~215 test LOC ≈ 385
total** — under the 600-total-LOC red line. This is above the §4 "≥5 production files" gate, and I am
**not** splitting, for the same reason #180 (8 files) and #199 (5 files) both shipped S with a clean
code-review and no rework:

- **This is a verified clone of #180.** I read all eight touchpoints; the shape is identical. #180
  shipped at 8 files, size S, code-review PASS, no rework, no `max_turns`. That is empirical, not a
  rationalization.
- **5 files is the architectural floor** for any new inbound `DaemonEvent` (wire → decode → consumer →
  event → bridge); the outbound `RendererCommand` plumbing (builder + method + command + guard +
  dispatch) adds the other 3, exactly as #180.
- **A split is strictly worse.** The only seam is inbound-decode vs outbound-request, and both halves
  (a) still touch `src/shared/wire/types.ts` **and** `src/main/daemonConnection.ts` → guaranteed §1.5
  merge conflict on two shared files; (b) are each still 5 files → neither clears the gate; (c) cannot
  test the AC8 request→reply round-trip in isolation. This is the documented **TS exhaustive-union
  atomicity exception**, not #311-style undercounting (where 4 claimed files became 13).
- **No edit fan-out.** Only one consumer is exhaustiveness-forced (`daemonEventBridge`'s `assertNever`);
  the other `DaemonEvent` consumers (`toDownloadAction` / `toRunConfigSnapshot`) use `default: null` and
  need no change. `InboundDaemonMessage` and `RendererCommand` are each consumed in one place.

**Edit fan-out check:** `grep`-equivalent — the new `DaemonEvent`/`RendererCommand`/`InboundDaemonMessage`
arms cascade to zero additional call sites beyond the eight files above. No renamed/re-signatured
export. No fixture cascade (fakes are constructed per-test).

## Design source

N/A — main-process transport data path; no on-screen surface (the conversation-list UI is #141,
consuming #208's store). Same as #180. The visual-fidelity check is intentionally not applicable.

## Open questions

- **`ListConversationsPayload` is documentary only.** The bare builder emits `payload: {}` directly and
  does not import it; it exists to satisfy AC1 and mirror the daemon's `ListConversationsPayload
  struct{}`. If the repo's lint flags an unused exported type (it should not — eslint flags unused
  locals, not exported types), the developer may inline a doc comment instead; the wire types file is
  the right home either way. Not blocking.
- **`readonly` on the event array vs mutable on the wire type.** `DaemonEvent.conversationsReceived`
  uses `readonly ConversationSummary[]` (matching `messagesReceived`), while `ConversationsPayload.
  conversations` is mutable `ConversationSummary[]` (matching `MessageChunkPayload.messages`). This is
  the existing precedent's asymmetry, kept deliberately — resolve in favour of matching the siblings,
  not in favour of uniformity.

## Security review

**Verdict:** PASS (no MUST FIX)

Adversarial self-review per `architect/security-review.md`. This ticket decodes input from a
non-trusted party on the internet-exposed relay surface AND adds one renderer→main command arm through
the `isRendererCommand` boundary guard — the two reasons it is `security-sensitive`.

**Findings:**

- **[Trust boundaries]** No finding. Two untrusted→trusted crossings, both explicit and single-concern:
  (1) the decrypted `conversations` reply narrows at `parseInboundMessage` →
  `parseConversationsPayload` → `parseConversationSummary` (fail-closed `WireDecodeError`; downstream
  holds the narrowed `ConversationSummary`, never raw bytes); (2) the renderer's `requestConversations`
  command validates at `isRendererCommand`. The command is **bare** (no attacker-controllable payload),
  so `return true` is complete acceptance — there is nothing to validate beyond a known `type` string.
  Boundary documented in § Error handling.
- **[Tokens/secrets]** No finding — N/A. This path introduces no credential: `list_conversations` is a
  bare frame, and no `ConversationSummary` field is a token/key. The dial-time `X-Pyrycode-Token` /
  Noise static keys are handled upstream (`daemonConnection` dial config) and untouched here.
- **[File / storage]** **SHOULD FIX (forward-looking, out of scope for this ticket).** `cwd` is an
  untrusted daemon-supplied string; a hostile or impersonating daemon could send `cwd:
  "../../etc/..."`. This ticket is safe — `cwd` is decoded and carried as **opaque display text**,
  never `path.join`/`path.resolve`'d or opened. The residual risk lands only if a **downstream**
  consumer (#141 render / #208 store, or any later "open workspace" feature) uses `cwd` in a real
  filesystem operation. Handoff: #141/#208 MUST treat `cwd` as untrusted and boundary-check
  (`path.resolve` + known-root prefix check) before any fs use. Not gated on this ticket (no fs op
  here). Flagged in the wire-contract table `cwd` row.
- **[Electron attack surface]** No finding — MUST-FIX category clean. No `webPreferences` / window /
  new-IPC-channel change: the two new arms ride the existing generic `sendCommand` / `onDaemonEvent`
  pass-throughs. Capability added to the renderer is minimal and bare (ask main to send one empty list
  request). Transport, keys, Noise handshake, and the socket stay entirely in `src/main`
  (`parseInboundMessage`, the builder, `requestConversations` are all main-process); the renderer
  receives only the typed `conversationsReceived` event. No secret or socket reaches renderer reach.
- **[Cryptographic primitives]** No finding — N/A. No RNG, key, nonce, or secret comparison in this
  path. The content-free digest reuses the existing vetted `@noble/hashes` `blake2s` (note #101),
  unchanged.
- **[Network & I/O]** No finding. The inbound `conversations` reply is bounded by the existing
  `MAX_PLAINTEXT_BYTES` (65519) size guard in `parseInboundMessage`, which throws BEFORE parsing — so a
  hostile daemon cannot exhaust memory with an oversized array. Within the cap, `parseConversationsPayload`
  is O(n) over a bounded row count. Relay-URL / TLS / timeout / reconnect discipline are upstream (dial
  config, driver, supervisor) and untouched.
- **[Error messages, logs, telemetry]** No finding — this is the load-bearing property and it is
  enforced. The `conversations` decode logs ONLY `{ event: 'inbound-decoded', code: 'conversations',
  bytes, hash }` — no id/name/cwd/timestamp, and explicitly **no `count`** (§ 2 trap). The throw path
  leaves no record (narrow-before-log). Parser error messages are category-only (field NAME, never
  field VALUE), so a conversation title or cwd never enters a message; the caught `WireDecodeError` is
  DROPPED at `daemonConnection` (classify-don't-forward). No new `DiagnosticEvent` field → #131's
  renderer pin untouched. The content-free-log key set is asserted in `inboundMessage.test.ts`.
- **[Concurrency]** No finding. `requestConversations` launches no long-lived task, arms no reassembler
  (nothing to leak, unlike `requestDebugBundle`), adds no timer/listener, and is fire-and-forget with
  no `await` between the `nextEnvelopeId` read and increment (no check-then-act race). Inert no-op after
  `stop()`. An unsolicited/late/replayed `conversations` frame is decoded and emitted harmlessly (#208's
  store is the idempotent source of truth).
- **[Threat model alignment]** Addressed. **Hostile relay** (content-blind, on-path): cannot forge a
  valid in-session `conversations` frame (only the authenticated daemon can emit through the Noise
  channel); can drop/delay/reorder/flood, but a dropped reply is #208's "not-loaded" concern and a
  replayed one is harmless — no plaintext leak, no hang (no consumer). **Hostile daemon response:** the
  fail-closed decode (size guard + per-field narrowing, one bad row fails the whole reply) is the
  primary defense; the `cwd` path-traversal residual is the forward-looking SHOULD FIX above. **Renderer
  compromise reaching transport:** process isolation holds — the compromised renderer gains only "send
  an empty list request," no keys/token/socket; request-flooding is bounded by the daemon's own
  rate-limiting and is identical in shape to the existing `requestSnapshot` / `sendMessage` commands (no
  new surface).

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-10
