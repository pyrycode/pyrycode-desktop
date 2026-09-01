# 898 — The pure question-batch model and reducer

## Files read

- `src/renderer/src/store/modalPrompts.ts` → `ModalPrompt`, `ModalEvent`, `ModalState`, `reduceModal`,
  `removeById`, `assertNever`, `selectOutstanding`, `selectHasOutstandingFor` — the file this clones.
  The discipline taken: renderer-local camelCase types, sealed union, `switch` + `assertNever`,
  same-reference-on-no-change, every arm spreading state, ordered array scanned by id.
- `src/renderer/src/store/modalPrompts.test.ts` → the `shown(...)` / `dismissed(...)` fixture-builder
  idiom (defaults + `Partial<Omit<Extract<…>>>` overrides) and the `run(...)` fold helper this mirrors.
- `src/shared/ipc/events.ts` → the `questionShown` and `questionDismissed` `DaemonEvent` arms — the
  exact upstream shape this reducer's events are the camelCase counterpart of, and the source of the
  empty-batch, open-`source` and never-log-the-nonce rulings.
- `src/shared/wire/types.ts` → `WireQuestion`, `WireQuestionOption`, `QuestionShownPayload`,
  `QuestionDismissedPayload` — the field list and the per-field provenance split (two daemon-asserted
  ids; four claude-authored strings). `WireQuestionOption` has **no `id`**, and there is no
  `defaultOptionId` counterpart.
- `docs/knowledge/decisions/0009-modal-prompt-model.md` § "id-addressing", § "Ordered array +
  scan-by-id, not a Map", § "Reduce behavior" — the ADR this slice reuses rather than minting one.
- `docs/knowledge/features/modal-prompt-model.md` § "Edge cases and limitations" — carries the #510
  lesson that decides this ticket's no-`resolved` call: a retained id suppressed the daemon's
  legitimate re-delivery, and an operator's explicit Allow decayed into a timeout deny.

## Design source

**Figma:** N/A — a framework-free reducer module with no rendered surface. The question panel's visual
fidelity check belongs to the render slice, not here.

## Context

`claude`'s `AskUserQuestion` tool raises a batch of clarifying questions. The transport half has
landed: two typed `DaemonEvent` arms, decoded fail-closed upstream. This slice is the renderer state
model — the question vertical's counterpart to the modal vertical's #122 — so the panel has a tested
model before any store (#899), bridge (#900) or React binding is layered on it.

No new ADR. ADR 0009's decisions carry over unchanged; the three departures below are ticket-level
calls recorded here and in the module's docblocks, and the documentation phase folds them into a
package overview. Nothing in this slice re-opens 0009.

## Design

New module `src/renderer/src/store/questionBatches.ts`. Framework-free: no React, no Zustand, no IPC,
no transport import. Nothing imports it when it lands; its first consumer is #899.

Five exported types, camelCase and declared here rather than imported from `src/shared/wire`:

- `QuestionOption` — `{ label: string; description: string }`. The complete key set: no `id` (claude's
  answer protocol selects by `label`, so the label *is* the identity) and no `preview`.
- `Question` — `{ question; header; options: readonly QuestionOption[]; multiSelect: boolean }`.
  `multiSelect` is the one renamed field; the wire keeps `multi_select` across IPC by house rule, so
  #900's bridge renames per row at **both** nesting levels.
- `QuestionBatch` — `{ conversationId; questionBatchId; questions: readonly Question[] }`. The held
  batch: what `shown` installs and `dismissed` clears.
- `QuestionBatchEvent` — the sealed renderer-local input union, three arms:
  - `{ type: 'shown'; conversationId; questionBatchId; questions: readonly Question[] }`
  - `{ type: 'dismissed'; questionBatchId; outcome: string; source: string }` — `source` is a plain
    open `string`, never `WireModalSource`. Carried for a later consumer, not consulted by the reduce.
  - `{ type: 'reconnected' }` — payload-free.
- `QuestionBatchState` — `{ outstanding: readonly QuestionBatch[] }`.

Plus `reduceQuestionBatches(state, event): QuestionBatchState`, `initialQuestionBatchState`, and two
selectors. An unexported `removeById` helper and an `assertNever` exhaustiveness guard mirror
`modalPrompts.ts` symbol-for-symbol.

**Three deliberate departures from `modalPrompts.ts`:**

1. **Two nesting levels, not one.** `options` hangs off each `Question`, not off the batch.
2. **No `resolved` id-memory.** Not an omission — a decision. `modalPrompts.ts` carries one because
   the modal client answers *optimistically* (`answerModal` dispatches `dismissed` locally even when
   the send is swallowed by a downed transport), so it can hold an id the daemon does not consider
   resolved. This vertical has **no answer frame at all**: nothing dismisses a batch locally, the
   daemon's `questionDismissed` is the only exit, and the daemon does not re-send a retired batch.
   `resolved` here would defend a failure that cannot occur, and #510 is the record of what that costs
   when it outlives its justification. The slice arrives with the answer path, as the modal vertical
   added `rejected` / `rejectionDismissed` in #249.
3. **An empty question list installs nothing.** A batch with no questions cannot be answered and would
   put an un-answerable panel on screen.

### Reduce behaviour (the contract each arm honours)

- **`shown`** — an empty `questions` array returns the **same state reference**, installing nothing.
  Otherwise build a fresh `QuestionBatch` literal copying each field **by name** (never a spread of
  the event, never deriving `conversationId` from the nonce); a still-outstanding `questionBatchId`
  is replaced **in place** via `map` (position and length preserved, latest fields win — the #195
  idempotency finding), an unseen id appends. Returns `{ ...state, outstanding }`.
- **`dismissed`** — `removeById` on `questionBatchId`; a non-match returns the same array, and the arm
  then returns the same state reference. Clears on **any** `source`, recognised or not — which is what
  satisfies the never-read-an-unrecognised-`source`-as-an-answer rule at this layer.
- **`reconnected`** — clears `outstanding` so the daemon's connect-time re-send is the sole
  repopulation truth for the new connection (#415); an already-empty set keeps its reference and the
  arm returns the same state.

### Selectors

- `selectOutstandingBatches(s): readonly QuestionBatch[]` — the slice by reference (#122 parity, so
  #899 has the whole-set read it re-exports).
- `selectBatchFor(conversationId) => (s) => QuestionBatch | undefined` — a selector **factory** bound
  to one conversation, matching `selectHasOutstandingFor`. An `===` scan via `Array.prototype.find`
  over the ordered array, answering with the **first** match in insertion order. The reducer does not
  enforce one batch per conversation: nothing observed says the daemon raises two concurrently, and a
  future one-per-conversation rule stays a one-arm change. An unknown conversation id is a legitimate
  query answered `undefined`, never an error.

## State + concurrency model

None. A pure synchronous `(state, event) => state` function over immutable data — no async task, no
subscription, no cancellation path, nothing to tear down. The Zustand container that owns a lifecycle
is #899's; the subscription to the daemon-event channel is #900's.

Referential discipline is the only shared-state concern: every no-op returns the input `state` by
reference so a consumer selecting under `Object.is` does not re-render for a non-change.

## Error handling

No I/O and no IPC, so no result type and no thrown domain error. The two malformed-input classes are
both absorbed deterministically rather than surfaced: an unknown `questionBatchId` on `dismissed` and
an empty `questions` array on `shown` are same-reference no-ops. `assertNever` throws only on an
unreachable union arm — a compile-time guard, not a runtime path.

## Testing strategy

One vitest spec, `src/renderer/src/store/questionBatches.test.ts` — plain unit tests, no DOM, no
`renderToStaticMarkup` (the module is framework-free). Fixture builders mirroring
`modalPrompts.test.ts`: a `shown(...)` with sensible defaults and `Partial<Omit<Extract<…>>>`
overrides, a `dismissed(...)`, a `reconnected()`, and a `run(...)` fold. Distinct derived values for
same-typed fields (`conv-${id}`), since two `string`s make a transposition invisible to tsc.

Scenarios, by AC:

- **AC1** — the module's exports are reachable with no React/Zustand/IPC import; fields round-trip
  verbatim onto the held batch, both nesting levels, `multiSelect` included.
- **AC2** — a shown installs; a re-delivered shown for a live id replaces in place (length and
  position preserved, re-delivered fields win, no duplicate); an empty `questions` array returns the
  same state reference, and a later `dismissed` for that id is an unknown-id no-op.
- **AC3** — dismissal clears exactly the matching batch and leaves siblings; an unknown id returns the
  same state reference; clearing is identical across `outcome` / `source` values, including an
  unrecognised `source`. The landed producer pair is `outcome: "unanswered"` / `source: "no_answer"` —
  upstream's `question_dismissed.json` fixture value `"timeout"` is **not** copied into any test.
- **AC4** — `reconnected` clears every held batch; a reconnect holding nothing returns the same state
  reference; a batch re-sent after the reset surfaces exactly once.
- **AC5** — the selector answers with the conversation's batch, question order and each question's
  option order intact; `undefined` for a conversation with none and for an unknown id, never a throw;
  two batches for one conversation answer with the first in insertion order.
- **Purity** — no arm mutates the input state, its `outstanding` array, or a held batch's nested
  arrays.

## Open questions

1. `Question` as an exported name beside `WireQuestion` — resolve in Phase B by confirming no
   consumer would need both identifiers under one name. Expected: no collision (distinct
   identifiers), so no `QuestionRow`-style rename.
2. `undefined` vs `null` for the selector's "nothing" — expected `undefined`, matching
   `Array.prototype.find` and comparing stably under `Object.is`.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] No findings, and the boundary is upstream of this module.** Provenance is
  per-field and does not flatten: `conversationId` and `questionBatchId` are daemon-asserted;
  `question`, `header` and every option's `label` / `description` are claude-authored, crossed the
  subprocess trust boundary, and are neither bounded nor sanitized by the daemon. The shape boundary
  is the fail-closed decode (#884 / #894) already landed in `src/shared/wire`; this module holds the
  four strings **opaquely** and never inspects, parses, truncates or re-encodes them. Decoded is not
  sanitized, and `string` carries no signal for that — so the render slice still owes the escaping.
  The plan states it; the module's docblock must restate it, because this file is where a panel author
  reads the held shape.
- **[Untrusted text as a key or lookup path] No findings — and this is the finding the label exists
  for.** `events.ts` names the two ways this family gets it wrong: "keying a tab by `header` or
  memoising by `label`". Both are decided by how the reducer holds the batches, which is this ticket.
  The design forecloses them structurally: the container is an **ordered array scanned by
  `questionBatchId`**, never a `Map` / `Record` / object literal keyed by anything, and every
  comparison in the module (`removeById`, the `shown` in-place match, `selectBatchFor`) is a `===`
  against a **daemon-asserted id** — never against a claude-authored string. No claude-authored value
  reaches a key, an index, a lookup path, a cache key or a `Object.prototype`-reachable property
  position. That also removes the prototype-pollution hazard outright: comparing own field *values*
  cannot resolve a `'__proto__'` query onto `Object.prototype`, and no assignment path exists.
  Phase B must not introduce a keyed container as an "optimisation" — the array is load-bearing here,
  not just an ADR 0009 parity choice.
- **[Logging / the nonce] No findings — by construction, and the constraint is absence.**
  `questionBatchId` is a one-time, opaque, unguessable nonce that must never reach a log. This module
  emits **no log call in any arm** — there is no logger import, no `console.*`, and `assertNever` is
  the only throw. That is deliberate: `assertNever` `JSON.stringify`s the event it was handed, so it
  is reachable only on an unhandled union arm (a compile-time impossibility) and never on a live
  event. Phase B adds no per-arm logging; a "which batch did we drop?" diagnostic would put the nonce
  and claude-authored text into a sink in one line.
- **[Tokens, secrets, credentials] Not applicable — none present.** No token, key, credential or
  pairing material is read, held or derived here. `questionBatchId` is a correlation nonce, dead once
  `questionDismissed` lands, and receiving it is not a capability: a retired batch resolves nothing
  daemon-side. Matching it wants plain `===`, not `crypto.timingSafeEqual` — a local routing decision
  between two values the client already holds, not a secret compared against an attacker's guess.
- **[File / storage operations] Not applicable — none.** No filesystem path, no `fs` call, no
  `localStorage` / `sessionStorage` / IndexedDB, no persistence of any kind. State is in-memory and
  per-connection: the `reconnected` arm discards it.
- **[Inter-process / Electron attack surface] Not applicable — no surface added.** No `BrowserWindow`,
  no `webPreferences`, no `contextBridge` API, no `ipcMain` channel, no custom protocol or deep-link
  handler, no navigation. The module is a pure function in the renderer and adds no capability the
  renderer did not already have. It holds no socket and no key, so § 4's process-placement rule is
  satisfied vacuously — and would be violated only by importing transport code, which the AC forbids.
- **[Cryptographic primitives] Not applicable — none used, and none should be.** No RNG (nothing here
  mints an id — every id is copied from the event), no hash, no comparison of a secret.
- **[Network & I/O] Not applicable — no socket, no frame, no timeout.** One hostile-relay-adjacent
  concern does reach this layer and is answered: an unbounded `questions` array or an unbounded
  string from a compromised daemon is held verbatim, since bounds are deliberately not modelled
  anywhere in this family (nothing enforces them; a cap here would be stricter-than-wire and, with no
  `truncated_fields` in this family, a silent trim would present claude's cut text as complete). The
  memory-exhaustion ceiling is the transport's existing frame cap, upstream of this module. Rendering
  cost of a hostile-sized batch is the render slice's bound to impose, not this reducer's.
- **[Error messages, logs, telemetry] No findings.** No user-facing error string is produced; the two
  malformed-input classes are silent same-reference no-ops rather than surfaced errors, so no daemon
  or claude-authored text can reach an error message or a toast from here. No telemetry, no metrics.
- **[Concurrency] Not applicable — no async surface.** No promise, timer, listener, subscription or
  `AbortController`; nothing outlives a call. There is no check-then-act race because there is no
  `await` and no shared mutable state: every arm returns a new object or the input by reference and
  mutates nothing. Store-level write serialisation is #899's concern.
- **[Threat model alignment] Two named, one answered here and one deferred.** *Hostile daemon
  response* — reaches this module only as an already-shape-checked event; the reducer's contribution
  is that it treats every field as opaque data and no field as a key, so a hostile value can at worst
  occupy memory and be rendered (escaped) downstream. *Reading an unrecognised dismissal `source` as
  an answer* — the one live misreading in this family, since read backwards it renders a daemon
  safe-deny as the operator's own choice. This reducer clears on **any** dismissal regardless of
  `source`, which satisfies the rule at this layer; the constraint binds on whatever later reads
  `source` for display, and is **OUT OF SCOPE** here — it lands with the answer path (upstream
  pyrycode#1907) and the render slice. *Renderer compromise reaching the transport* is unchanged by
  this module, which imports nothing from `src/main`.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
