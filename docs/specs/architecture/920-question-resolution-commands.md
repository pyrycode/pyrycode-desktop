# 920 — Question resolution commands (renderer → main, token minted main-side)

The command half of the question vertical's outbound leg: two renderer commands that name a batch by
id (plus, for an answer, the ordered entries), their boundary guards, and the two main-side sends that
mint the `answer_token` and call #919's builders. No renderer control yet — the buttons that dispatch
these land after this slice.

## Files read

- `src/shared/ipc/commands.ts` → `AnswerModalCommandPayload`, `answerModalCommand`,
  `cancelModalCommand`, `RendererCommand`, `isRendererCommand`, `isAnswerModalPayload`,
  `isCancelModalPayload` — the seam-for-seam precedent: the `Omit<…, 'answer_token'>` derivation that
  makes the token structurally unexpressible renderer-side, the union arms, and the
  structural-minimum guard idiom (present-and-typed per field, extra fields tolerated).
- `src/main/daemonConnection.ts` → `answerModal`, `cancelModal` — the two bodies this slice clones
  (guard → try → fresh literal → advance id → send → empty catch); `mintToken` — the existing
  `crypto.randomUUID` DI seam; `nextEnvelopeId` — the single monotonic counter every sender shares;
  `dequeueMessage` — the fresh-literal-without-a-correlation-window shape, which is what these two
  actually are; `DaemonConnection` — the interface the two methods join.
- `src/main/index.ts` → the `onCommand` switch — where the two dispatch arms go. It has **no
  `default` / `assertNever`**, so a new union member without an arm is silently dropped rather than a
  compile error; the arms are load-bearing, not ceremony.
- `src/main/transport/questionResolutionEnvelope.ts` → `buildQuestionAnswer`, `buildQuestionRefused`,
  `QuestionAnswerInput`, `QuestionRefusedInput` — #919's builders, this slice's callees, including
  their header note that the payload is serialized **verbatim** so every own enumerable key ships.
- `src/shared/wire/types.ts` → `QuestionAnswerPayload`, `QuestionAnswerEntry`,
  `QuestionRefusedPayload`, `MAX_PLAINTEXT_BYTES` — the wire shapes both `Omit`s derive from, and the
  65519-byte cap that makes the answer path's throw a live branch.
- `src/main/daemonConnection.test.ts` → the `answerModal` / `cancelModal` describe blocks, `build`
  (its `mintToken` override), `captureLog`, `connected()` — the fixtures and assertions the two new
  blocks mirror.
- `src/shared/ipc/commands.test.ts` → the `answerModalCommand / cancelModalCommand (#236)` and
  `isRendererCommand` blocks — the constructor + accept/reject test shape.
- `docs/knowledge/features/question-resolution-envelope.md` § "Configuration and usage" /
  "Edge cases and limitations" — the forward obligations this slice discharges: mint main-side, plain
  `===` (not `timingSafeEqual`) for any batch-id matching, and **no client-side range check on
  `question_index` or membership check on `values`**.
- `docs/knowledge/features/modal-resolution-envelope.md` — the #235/#236 answer/cancel split
  precedent this pair follows one stage later.

## Design source

N/A — the ticket carries no `## Figma` section, and nothing in this slice renders. It is two IPC
union members, two guards, two main-process senders and two dispatch arms.

## Context

#919 landed `buildQuestionAnswer` / `buildQuestionRefused` and nothing calls them. The question panel
renders a batch and holds it, but every control on its action row is inert as to resolving one,
because there is no command to dispatch and no main-side sender to mint the token. This slice lands
exactly that middle layer and stops there.

The shape is #236's modal pair, one asymmetry aside: **both question frames carry `answer_token`**,
where only `modal_answer` does. So both command payload types `Omit` it and both senders mint it.
`answerModal`'s correlation window (#248) is deliberately **not** cloned — the daemon emits no reply
and no error envelope for a rejected question answer, so there is nothing to correlate.

No ADR is warranted: this slice makes no new normative choice, it applies #236's settled one to a
second frame family.

## Design

### Naming

`answerQuestions` / `refuseQuestions` — verb-first like `answerModal` / `cancelModal`, plural because
the unit of resolution is a batch. `refuse`, not `cancel`, because the frame is `question_refused`
and refusing is the operator declining to choose rather than dismissing the prompt.

### Command types and guards (`src/shared/ipc/commands.ts`)

Two payload types derived from the wire types, so the token is absent at compile time exactly as
`AnswerModalCommandPayload` makes it absent today:

```ts
export type AnswerQuestionsCommandPayload = Omit<QuestionAnswerPayload, 'answer_token'>
export type RefuseQuestionsCommandPayload = Omit<QuestionRefusedPayload, 'answer_token'>
```

`RefuseQuestionsCommandPayload` collapses to `{ question_batch_id }`. It is written as an `Omit` and
**not** as a hand-written one-field interface, so the day upstream adds a field to
`QuestionRefusedPayload` the renderer type follows rather than silently diverging.

Two union arms on `RendererCommand`, two pure constructors mirroring `answerModalCommand` /
`cancelModalCommand` (neither mints), and two arms inside `isRendererCommand` delegating to:

- `isAnswerQuestionsPayload(value): value is AnswerQuestionsCommandPayload` — `question_batch_id`
  present-and-string; `answers` present and `Array.isArray`; **every** element an object with
  `question_index` present-and-number and `values` present-and-`Array.isArray` of strings.
- `isRefuseQuestionsPayload(value): value is RefuseQuestionsCommandPayload` — one
  present-and-string `question_batch_id` check, an exact clone of `isCancelModalPayload` with the key
  changed.

Three properties of the answer guard are decisions, not incidentals:

1. **It recurses into the entries.** Every sibling guard in this file checks a flat scalar row; this
   is the file's first structured payload, and a shallow `Array.isArray(answers)` would let
   `{ question_index: 'nope' }` reach `JSON.stringify` and put a type-lie on the wire.
2. **It iterates with `for…of`, never `Array.prototype.every`.** `every` *skips holes*, so a sparse
   `[ , 'a']` passes it while `JSON.stringify` emits `[null,"a"]` — a `null` inside a declared
   `string[]`. `for…of` goes through the iterator, which yields `undefined` for a hole, and the
   `typeof` check then rejects it. Non-obvious enough to carry a comment at the loop.
3. **It bounds nothing and range-checks nothing** — not entry count, not value length, not
   `question_index` against any batch. Upstream's `answerVerdict` owns every one of those, and a
   second copy would be a second bound to keep in agreement with the batch. It is a *shape* guard.

It stays a structural minimum on extra keys, like every sibling: a smuggled `answer_token` is not
rejected here, because the main-side fresh-literal construction already makes it lose.

### The senders (`src/main/daemonConnection.ts`)

Two methods on `DaemonConnection`, two bodies cloning `answerModal` / `cancelModal` minus the
correlation push:

```ts
answerQuestions(payload: Omit<QuestionAnswerPayload, 'answer_token'>): void
refuseQuestions(payload: Omit<QuestionRefusedPayload, 'answer_token'>): void
```

Each body, in order: `if (driver === null) return` (inert no-op, the `send` twin — a resolution has no
consumer to fail); `try`; build a **fresh literal** naming exactly the modelled fields with
`answer_token: mintToken()`; `nextEnvelopeId += 1` only after the build returns; `driver.sendMessage`;
`catch {}` that drops the caught object entirely — no log, no event, no rethrow.

**The answer's fresh literal is deep, and that is the point.** `answers` is an array of objects, so a
shallow `answers: payload.answers` would carry any extra key smuggled onto an *entry* onto the wire —
the builder serializes verbatim. Each entry is rebuilt as
`{ question_index: entry.question_index, values: entry.values }`. `values` is passed through without
a copy, deliberately: `JSON.stringify` serializes an array **by index**, so an extra own property on
it cannot ride, and a defensive copy would be ceremony that reads as a real check.

Both share the one monotonic `nextEnvelopeId` — no second counter — and neither touches
`outstandingAnswers`, `pendingSettings` or `pendingCreateFolders`.

### Dispatch (`src/main/index.ts`)

Two `case` arms routing straight to the connection methods, mirroring `answerModal` / `cancelModal`:
no orchestrator, no consumer, no reply correlated.

## State + concurrency model

No new state at all: no store slice, no map, no set, no timer, no listener, no async task, nothing to
cancel or tear down. Both senders are synchronous and run to completion with no `await` between the
read of `nextEnvelopeId` and its write, so they inherit the module's existing single-writer property
verbatim.

The deliberate omission is the correlation window. `answerModal` pushes onto `outstandingAnswers` for
#248's rejection surface; there is **no question equivalent and none is added**, because upstream's
`handleQuestionAnswer` emits nothing on a false verdict — no reply, no broadcast, no error envelope.
A window here would be an entry nothing ever drains.

## Error handling

Three failure modes, all inside the module:

- **Not connected** — `driver === null`, return. Silence, not an error: the daemon still holds the
  batch parked and its connect-time reconcile re-asserts it as a fresh `question_shown` after the next
  handshake, so a swallowed send self-heals.
- **Over-cap plaintext** — `WireEncodeError` out of `buildQuestionAnswer`. **A live path, not a
  defensive branch**: `values` are operator-typed free text and nothing bounds entry count or value
  length, so `MAX_PLAINTEXT_BYTES` (65519) is reachable in ordinary use. Caught, send dropped, envelope
  id **not** advanced. Never truncated — a trimmed answer would send a different choice than the
  operator made. The refusal frame carries two ids and no free text, so its own throw stays exotic;
  the `catch` is there for `driver.sendMessage`.
- **Driver / wasm throw** — same `catch`, same drop (parity #490: never throw out of the module).

The caught object is dropped in both, never logged and never forwarded: its message could echo the
batch id or an entry value. Nothing on this path calls `deps.diagnosticLog` at all.

## Testing strategy

Vitest only, node environment. Nothing here renders and nothing is reachable from a click, so no
renderer spec and no Playwright spec.

`src/shared/ipc/commands.test.ts` (extended), one block per half:

- Both constructors wrap fields unchanged into the right `type`, minting nothing — plus the
  compile-time assertion that the payload type cannot express `answer_token` (the
  `@ts-expect-error` shape the `#236` block already uses).
- The guard accepts a well-formed answer (mixed batch: one single-value entry, one multi-value),
  accepts one carrying a smuggled `answer_token` and an extra top-level key (structural minimum),
  and accepts an empty `answers` array (out of contract upstream, but a *shape* guard does not
  adjudicate that).
- The guard rejects: missing payload, `null` payload, missing/non-string `question_batch_id`, missing
  `answers`, non-array `answers`, a non-object entry, a missing/non-number `question_index`, a
  non-array `values`, a non-string element in `values`, **and a hole in `values`** — the case that
  distinguishes `for…of` from `every`.
- Refuse: accepts a well-formed one and one with an extra key; rejects missing payload, `null`,
  missing key, non-string.

`src/main/daemonConnection.test.ts` (extended), two blocks mirroring the modal ones:

- No-op before `start()`: no driver, nothing sent, no throw.
- After handshake, forwards one `question_answer` / `question_refused` envelope with id 2, the fixed
  `ts`, and a payload that `toEqual`s exactly the modelled fields with the minted token.
- Shares the one envelope-id counter with `send`.
- A fresh token per call (injected counter mint), two calls carrying two distinct tokens.
- Smuggling: a renderer-supplied `answer_token` and an extra top-level key are both absent from the
  sent frame; **an extra key on an answer entry is absent too** — the assertion that pins the deep
  rebuild, and the one a shallow implementation passes every other test while failing.
- `driver.sendMessage` throwing does not throw out of the module.
- **Over-cap (answer only, AC3):** a `values` string past `MAX_PLAINTEXT_BYTES` — no throw, nothing
  sent, and the *next* successful send still uses envelope id 2 (the id did not advance).
- **Silence (AC4):** with a `captureLog` diagnostic log injected, neither a successful send nor the
  over-cap failure records any diagnostic event.

## Open questions

1. Should the refusal payload type be a hand-written `{ question_batch_id: string }` rather than an
   `Omit`, given it collapses to one field? Resolved in the Design above: `Omit`, so an upstream field
   addition propagates instead of diverging silently.
2. Does `values` need a defensive array copy in the fresh literal? Resolved in the Design above: no —
   `JSON.stringify` serializes an array by index, so no own property on it can ride the wire, and the
   copy would read as a check it is not.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** This slice *is* the boundary #919 deferred, so nothing here is
  "outbound-only, nothing to parse". The untrusted→trusted crossing is explicit and single: `onCommand`
  runs `isRendererCommand` on the raw `ipcMain.on` argument and drops anything malformed before
  `handler` sees it — verified by reading `receiveCommand`, not assumed. Two consequences worth
  stating rather than waving through. **(a) The classic guard-then-rebuild bypass is closed by the
  boundary itself, not by my code.** A getter on `answers` returning a benign value to the guard and a
  hostile one to the sender would defeat every check here — but the payload has already been through
  structured clone by the time `isRendererCommand` runs, and structured clone materialises accessors
  into plain data properties, so no accessor can cross. Recording the mechanism because the design
  *depends* on it and it is invisible in the code. **(b) `answers` is the file's first structured
  payload**, and a shallow `Array.isArray` check would admit `{ question_index: 'nope' }` — hence the
  recursive guard, and hence `for…of` over `every` (holes). SHOULD FIX, addressed in the design, and
  the hole case is a named test rather than a comment.
- **[Tokens, secrets, credentials]** `answer_token` is minted main-side through the existing
  `mintToken` seam, defaulting to `crypto.randomUUID` (Node CSPRNG) — never `Math.random`, and never
  renderer-composed: the `Omit` makes it unexpressible in the command type. Lifecycle is complete
  *because it is short*: created per frame, never stored, never rotated, never revoked — correct for a
  one-shot idempotency key, and there is nothing to revoke. Its secrecy buys nothing (the daemon
  never reads it on this path), which is precisely why the design does not lean on it: the anti-replay
  property is the daemon's one-shot consume of `question_batch_id`. The field that *does* matter is
  `question_batch_id`, a one-time unguessable nonce — MUST never reach a log, discharged by
  construction: no `deps.diagnosticLog` call exists anywhere on either sender, and the `catch` drops
  the caught object rather than reading its message.
- **[File / storage operations]** Not applicable by design, not by luck: neither sender takes a path,
  touches `fs`, or persists anything. No at-rest secret is created, so no `safeStorage` question
  arises. The only new state is two stack-local literals.
- **[Inter-process / Electron attack surface]** No new channel, no `contextBridge` API, no
  `ipcMain.handle`, no `BrowserWindow`, no protocol handler, no navigation surface — two members join
  an existing validated union on an existing channel, and preload is untouched (it is generic over
  `RendererCommand`). Capability minimisation holds: the commands express "resolve batch X with these
  entries", never a raw frame, a socket, or a path. `IpcMainEvent` is still stripped by `onCommand`,
  so no `sender` capability reaches these handlers.
- **[Cryptographic primitives]** `randomUUID` is the only primitive touched and it is a vetted CSPRNG
  call, not hand-rolled. No key material, no hashing, no AEAD, no Noise state: the frame is handed to
  the driver already formed and sealed one layer down. **No comparison of any kind exists in this
  slice** — nothing here matches a token or a batch id against anything, so the
  `timingSafeEqual`-vs-`===` question the #919 review forwarded does not land here after all; it lands
  on whichever slice does the matching, and it is still `===` (a local routing decision between two
  values the client holds, not a secret compared against a guess).
- **[Network & I/O]** The over-cap path is the finding and it is treated as live rather than
  defensive: `values` are operator-typed free text, nothing bounds entry count or value length, so
  `MAX_PLAINTEXT_BYTES` (65519) is reachable in ordinary use. Fail-closed — the send is dropped whole,
  never truncated, because a trimmed answer would send the operator a different choice than the one
  they made. Considered and accepted: a compromised renderer can hand main a huge `answers` array that
  `encodeEnvelope` stringifies before rejecting, but the renderer had to materialise and clone that
  same data through IPC first, so the amplification is ~2× of an allocation the attacker already paid
  for, inside the app's own resource envelope — identical in shape to `send`'s existing `text` path,
  and not a new vector. No socket, timeout, TLS, backoff or reconnect surface is introduced.
- **[Error messages, logs, telemetry]** Nothing on this path logs — not the success, not the
  over-cap failure, not the driver throw — and that is required rather than incidental, since the
  caught object's message could echo the batch nonce or an entry value. No event is emitted either
  (classify-don't-forward). The residual is honest and named: an over-cap answer sent while connected
  is silently dropped, and the operator sees no signal until the daemon's connect-time reconcile
  re-asserts the batch as a fresh `question_shown`. That is a UX gap, not a security one; surfacing it
  belongs to the renderer-control slice. OUT OF SCOPE, named here so it is not rediscovered as a bug.
- **[Concurrency]** No async work, no timer, no listener, no `await` anywhere in either body, so both
  run to completion and inherit the module's existing single-writer property on `nextEnvelopeId`
  unchanged — there is no check-then-act gap to guard. Nothing is registered, so nothing leaks and
  shutdown needs no new teardown. Two rapid answers for one batch produce two frames with two distinct
  tokens; the second is inert daemon-side via the one-shot consume of `question_batch_id`, which is
  exactly why the token is minted per call rather than per batch. The deliberate *absence* of a
  correlation window is a concurrency decision too: `answerModal`'s `outstandingAnswers` entry is
  drained by a reply that has no question equivalent, so cloning it would leak an entry per answer.
- **[Threat model alignment]** *Malicious relay:* on-path and content-blind — it can drop or delay a
  resolution, which parks the batch rather than resolving it wrongly (the fail-safe direction), and
  the frame is Noise-sealed before it leaves, so no plaintext leaks. *Hostile daemon:* no decode path
  is added, so nothing in this slice parses hostile input. *Token theft from disk:* nothing at rest.
  *Renderer compromise reaching the transport:* this is the finding that deserves the scrutiny, and
  the answer is tier-equality, not absence. A compromised renderer can resolve any batch **whose id it
  already holds** — it renders them, so it holds exactly the ids the operator can already see — and it
  cannot reach one it does not hold, because `question_batch_id` is an unguessable one-time nonce,
  main-forwarded, and this slice adds no command that enumerates batches. The `values` it supplies
  reach claude's context at precisely `send_message`'s existing tier, since a paired client can
  already put arbitrary text into the conversation. What it *does* gain is resolving a batch without
  operator intent — and that is tier-equal with #236's `answerModal`, which has had the same property
  since it shipped, on the higher-stakes permission path rather than a clarifying question. It grants
  nothing new. OUT OF SCOPE and named: the interactive gate and the per-device answer gate are the
  resolver's, upstream #1986; any UI confirmation is the renderer-control slice's.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
</content>
</invoke>
