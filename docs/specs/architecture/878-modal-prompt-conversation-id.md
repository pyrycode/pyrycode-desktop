# #878 — hold the conversation id on the outstanding prompt and report it per conversation

**Ticket:** [#878](https://github.com/pyrycode/pyrycode-desktop/issues/878) · size **S** · `security-sensitive` · split from #872

#870 decoded `conversation_id` off the `modal_shown` frame, #871 carried it onto the `modalShown`
`DaemonEvent` arm, and #877 carried it the last hop onto `ModalEvent`'s `shown` arm — where
`reduceModal` holds it in hand and drops it on the floor. This slice closes the chain: the held
`ModalPrompt` gains the conversation that raised it, and the store grows the single read that fact
exists to serve.

**Three executable production lines** — one interface field, one literal field in the reducer's
`shown` arm, one selector body — plus a re-export, comment corrections, and an 11-site fixture
cascade.

The security property is the whole point of the label: a permission prompt raised by one conversation
carries a tool title and command line in `prompt`, and must never be reported against another. **The
match happens here**; every consumer downstream reads a boolean. See § Security review.

## Design source

N/A — a renderer store slice with no rendered surface. The ticket body has no `## Figma` section and
needs none: `PermissionModal` reads `selectOutstanding` unfiltered (`PermissionModal.tsx:192`) and is
untouched by this slice, so nothing an operator sees changes. The sidebar dot this selector feeds is a
later ticket and carries its own Figma anchor. The visual-fidelity check is intentionally skipped.

## Base — verified this pass

Measured against `a6b598c` (#877's merge), which is both `HEAD` and `origin/main` (`git fetch origin
--prune` run this pass). Every line number below was re-read against the working tree this pass; the
ticket body's cites were re-verified and all held.

**codegraph is wired but not indexed for this repo** — `.codegraph/` holds `.gitignore` +
`config.json` only, no DB (re-confirmed 2026-09-01, matching #877's finding). The reading list below
was built by `git grep` + Read instead.

**File-overlap check: clean.** `git fetch origin --prune` then a diff of every `origin/feature/<n>`
branch against `origin/main` returns no in-flight branch with any changed file. No blocker set.

## Files to read first

| Path | What to extract |
| --- | --- |
| `src/renderer/src/store/modalPrompts.ts:19-27` | The `ModalPrompt` interface. **Edit site for AC1** — one required field. |
| `src/renderer/src/store/modalPrompts.ts:29-46` | The `ModalEvent` docblock. `:42-43` carries **stale comment (1)**: "It STOPS at `reduceModal`, which builds `ModalPrompt` from named fields and omits it; the consumer that scopes a prompt to a sidebar row is #878." This slice makes that false. |
| `src/renderer/src/store/modalPrompts.ts:146-169` | `reduceModal`'s `shown` arm. `:153` is the `resolved` early-out (untouched); `:154-161` is the named-field literal that gains one line (**AC1**); `:165-167` is the in-place replace (untouched). |
| `src/renderer/src/store/modalPrompts.ts:218-222` | `selectOutstanding` / `selectRejections` — the existing read surface the new selector joins. **Edit site for AC2.** |
| `src/renderer/src/store/modalStore.ts:43-45` | The single re-export site. **Edit site for AC2.** |
| `src/renderer/src/store/queueStore.ts:99-104` | `selectBacklogFor` — the curried `(id) => (state) =>` idiom to copy. Note what this slice does **not** need from it: no `EMPTY_*` hoisted constant (see § Design, referential stability). |
| `src/renderer/src/store/conversationActivityStore.ts:255-265` | `selectActivityFor` and its docblock — the "an unknown id is an EXPLICIT no-match that can never resolve onto a neighbour's entry" framing this selector inherits. |
| `src/renderer/src/store/modalPrompts.test.ts:14-32` | The local `shown()` builder. It **already** supplies `conversationId` as `` `conv-${modalId}` `` before the `...overrides` spread (#877). Do not add a second convention — AC4 leans on this one. |
| `docs/knowledge/decisions/0009-modal-prompt-model.md:55` | § "The wire boundary" — traces the id along the chain and ends at #878. Read for context; **do not edit** (see § Out of scope). |
| `docs/knowledge/decisions/0009-modal-prompt-model.md:64` | § "Ordered array + scan-by-id, not a Map" — the referential-stability rationale that forbids re-keying `outstanding`. |

## Context

The daemon scopes `modal_shown` per conversation and stamps it with `conversation_id` (pyrycode#1065,
shipped 2026-07-17). The desktop chain has been assembled one hop per slice; this is the terminus.
`reduceModal`'s `shown` arm already destructures the event by name into a `ModalPrompt` literal
(`modalPrompts.ts:154-161`), so the id is sitting in scope one line above the literal that omits it.

The consumer this unblocks is the sidebar's status resolver: a conversation row lights an
input-required dot when a prompt is waiting on the operator. That resolver needs a boolean, not the
prompt — which is why the read surface added here is a predicate and not a filtered list.

## Design

### AC1 — the held prompt carries its conversation

`ModalPrompt` gains one **required** field:

```ts
export interface ModalPrompt {
  conversationId: string   // NEW — first, mirroring the `shown` arm's field order
  modalId: string
  // …unchanged
}
```

Required, not optional, for the reason #871 records at `src/shared/ipc/events.ts:653-657` and #877
carried onto the event: the wire has it always-present and the decode fail-closes on absence, so an
optional field invents an absence case the daemon never produces — and an assigned `undefined`
survives the structured clone across the IPC channel, so a later `'conversationId' in prompt` check
would read true on a prompt carrying nothing. #877 made it required on the event, so the `shown` arm
has one unconditionally; there is no narrowing to do and no default to invent.

The reducer's `shown` arm adds `conversationId: event.conversationId` to the existing named-field
literal — **by name, never by spreading `event`**, which would drag `type` onto the prompt. Field
order in the literal mirrors the interface.

**The value is copied, never derived.** `conversationId` and `modalId` are two independent
daemon-asserted values; production code must read the event's `conversationId` and nothing else. The
`` `conv-${modalId}` `` shape used throughout the tests is a **fixture convention only** (§ Testing
strategy) and must never appear in `modalPrompts.ts`. Deriving it in production would attribute every
prompt to an id computed from a one-time nonce — wrong for every prompt, and it would push the
`modalId` nonce (ADR 0009: "opaque, unguessable", the sole answer-correlation key) into a value later
consumers may render or key on. The AC1 scenario that overrides `conversationId` away from the derived
default is what catches this. See § Security review.

Everything else in the arm is unchanged and must stay so: the `resolved` early-out at `:153`, the
`some`/`map` in-place replace at `:165-167` (a re-delivery replaces from the re-delivered fields, so a
re-sent prompt picks up the re-sent conversation id — correct by construction, no extra branch), and
every same-reference no-op in `dismissed` / `rejected` / `rejectionDismissed` / `reconnected`.

### AC2 — the read surface

One new curried selector in `modalPrompts.ts`, beside `selectOutstanding`:

```ts
export const selectHasOutstandingFor =
  (conversationId: string) =>
  (s: ModalState): boolean =>
    …
```

**Behavior:** true iff some prompt in `s.outstanding` has a `conversationId` strictly equal to the
bound id; false otherwise. One `Array.prototype.some` with `===`. Asserted by the AC2/AC3/AC4
scenarios in § Testing strategy.

Curried `(conversationId) => (state) => T`, matching `selectActivityFor`
(`conversationActivityStore.ts:262`), `selectRosterFor` (`backgroundTaskRosterStore.ts:421`) and
`selectBacklogFor` (`queueStore.ts:102`) — the established idiom in this directory for a read bound to
one conversation.

Re-exported from `modalStore.ts:45` alongside `selectOutstanding` and `selectRejections`, so consumers
import the whole read surface from one site. Re-exported, never redefined — the same discipline that
line already documents.

**Three constraints on the implementation, each load-bearing:**

- **Scan the array; do not key by the conversation id.** No `Record` keyed by the id, no computed
  object key, no `Object.fromEntries`, no `Map` re-keying of `outstanding`. The id is a
  daemon-asserted string, and a `===` scan has no prototype hazard at all (§ Security review). It also
  preserves the array's referential stability, which ADR 0009 § "Ordered array + scan-by-id, not a
  Map" (`0009-modal-prompt-model.md:64`) chose the array *for*: `selectOutstanding` hands back the
  slice by reference and `PermissionModal` selects it under `Object.is`.

- **No `EMPTY_*` hoisted constant, and nothing to memoize.** This is the one place the sibling
  selectors' shape does **not** carry over. `selectBacklogFor` needs `EMPTY_BACKLOG` and
  `selectRosterFor` needs `?? null` because a fresh `[]` per call would churn React under `Object.is`.
  A `boolean` compares by value, so a fresh call returning `false` is `Object.is`-identical to the last
  one. Return the bare predicate; adding a cache would be speculative surface.

- **Do not filter `outstanding` by conversation.** The predicate is the entire deliverable. Narrowing
  the rendered prompt list is a separate ticket (§ Out of scope).

### What this slice deliberately does not touch

- **`modalResolution.ts` and `PermissionModal.tsx` need no production change.** Both take
  `ModalPrompt` in signatures only (`modalResolution.ts:73, 125`; `PermissionModal.tsx:48`) and read
  no new field. Verified this pass.
- **`modalId` remains the sole correlation key for *answering*.** `modal_answer` / `modal_cancel`
  carry no `conversation_id` (ADR 0009 § Context, amended 2026-09-01, at `:22`). Do not route an
  answer by the new id, do not add it to an outbound frame, do not add it to `PendingConfirm`.
- **No new state slice.** The field belongs on the prompt. A parallel
  `Map<modalId, conversationId>` would avoid the fixture cascade but needs clearing in lockstep with
  `dismissed` and `reconnected` — a second source of truth for prompt membership, whose desync mode is
  exactly the misattribution this ticket exists to prevent (a prompt gone from `outstanding` but left
  in the map reports `true` forever). Rejected on correctness, not taste; it also violates CLAUDE.md's
  single-source-of-state rule.

## State + concurrency model

No change. `modalStore` remains the single Zustand store over the pure `reduceModal`, `dispatch` the
sole write path, the selectors the sole read path. No async work, no subscription, no teardown, no new
IPC channel, no transport contact. The new selector is a pure function of held state.

Re-render behavior: a component binding `useModalStore(selectHasOutstandingFor(id))` re-renders only
when that conversation's *boolean* flips — a `shown` or `dismissed` for a **different** conversation
produces a new `outstanding` array but the same boolean, so `Object.is` holds and the component does
not re-render. That is a strictly narrower slice than `selectOutstanding`, which churns on any modal
event.

## Error handling

No new failure mode. Every input is already-narrowed renderer-local state:

- **Unknown / never-seen conversation id** — a legitimate query, answered `false`. Not an error, not a
  throw, no logging. Mirrors the reducer's unknown-`modalId` no-op discipline.
- **Empty `outstanding`** — `some` on `[]` is `false`. No guard needed.
- **A prompt whose conversation was archived or closed** — still reported against its own id. Nothing
  in this store knows about conversation lifetime, and inventing a liveness check here would be a
  defense for an unobserved failure.

No result type, no banner, no dialog, no log call. The selector cannot fail.

## Testing strategy

Both gates must be green. **The fixture cascade splits into two disjoint halves that fail in different
tools**, so neither `npm run typecheck` nor `npm test` alone proves the migration complete: typed
fixtures fail only at `tsc` (vitest never typechecks), while `toEqual` expectations reached through a
cast or an untyped literal fail only at vitest. Running one gate will read as done while the other is
red.

### Fixture cascade — 11 sites, re-verified this pass against `a6b598c`

| Site | Shape | Fails in |
| --- | --- | --- |
| `screens/conversation/modalResolution.test.ts:75, 111, 184` | typed `ModalPrompt` literals | tsc (3) |
| `screens/conversation/modalResolution.test.ts:144, 195` | the `permissionPrompt` / `trustPrompt` builders — each takes `modalId` only and absorbs all its call sites | tsc (2) |
| `screens/conversation/PermissionModal.test.tsx:51, 90, 116` | typed `ModalPrompt` literals | tsc (3) |
| `store/modalPrompts.test.ts:68` | `const prompt: ModalPrompt` | tsc (1) |
| `store/modalStore.test.ts:35-36` | `outstanding[0] as ModalPrompt` — a **cast**, so tsc stays silent — then a `toEqual` mirroring the full prompt shape | vitest (1) |
| `store/modalBridge.test.ts:364` | `toEqual` on `outstanding[0]` | vitest (1) |

`toEqual` is an exact own-property match, so a produced object gaining a field fails an expectation
that omits it — and both vitest-half expectations are reached through a cast or an untyped literal, so
tsc is silent on them. That is the half a single-gate run misses.

A sweep of every `ModalPrompt` reference in `src/` and `e2e/` this pass finds no site beyond these
plus the signature-only consumers above: **11 is exhaustive, not a sample.**

**Value convention for every edited fixture:** derive the conversation id from the modal id
(`` `conv-${modalId}` ``, or `conv-m1` written out for a literal). #877 established this precisely so
the two same-typed `string` fields hold **distinct** values and a transposition cannot slip past an
exact `toEqual`. Do not introduce a second convention, and do not reuse the modal id as the
conversation id anywhere.

The two builders take `modalId` only — no `Partial<Omit<Extract<…>>>` override spread — so the
optional-spread-shadows-a-required-field trap that bit #877's event builder does **not** apply here.
Add the derived field to each builder body; no signature change, no cast, no widened `Omit`.

### Verified to need no edit — do not touch

- `screens/conversation/interactiveRoundtrip.test.tsx:96` — builds a `modalShown` `DaemonEvent`, which
  #871 already gave a `conversationId` (`'conv-1'`, present today).
- `store/modalStore.test.ts:9-21` and `store/modalBridge.test.ts` event fixtures — #877 already
  supplies `conversationId` on the `shown` **event**. Only the prompt-shaped `toEqual` expectations
  move.
- `e2e/permission-modal-answer-paths.spec.ts:79` already sends `conversation_id`, and `e2e/` sits
  outside both `tsconfig.node.json` and `tsconfig.web.json`.
- `PermissionModal.test.tsx:228, 246-247, 252, 266` — read a prompt out of `selectOutstanding(state)`
  and pass it along without asserting its full shape. No `toEqual` to update.
- No shared cross-file fixture builder exists, and introducing one is a separate concern from this
  slice. Each file keeps its own local builders.

### New scenarios — `modalPrompts.test.ts`

Written against the existing `shown()` / `dismissed()` / `run()` builders. Test-first, per CLAUDE.md.

**AC1 — the field is held:**
- Fold `shown('m1')`; the installed prompt equals the full expected `ModalPrompt` including
  `conversationId: 'conv-m1'`. (This is the existing `:68` expectation, extended — not a new test.)
- Fold `shown('m1', { conversationId: 'conv-other' })`; the held prompt carries `conv-other`, proving
  the value is copied from the event rather than derived anywhere in production code.
- A re-delivery of a still-outstanding `modalId` carrying a **different** conversation id replaces in
  place: length and position unchanged, the held prompt carrying the re-delivered id.

**AC2 — the selector reports true:**
- One prompt held for `conv-m1`; `selectHasOutstandingFor('conv-m1')` reads `true`.
- Two prompts held for the **same** conversation; still `true` (no double-count semantics to get
  wrong).

**AC3 — false when absent, false again after dismissal:**
- Initial state: `false` for any id.
- One prompt held for `conv-m1`; `selectHasOutstandingFor('conv-m2')` reads `false`.
- `shown('m1')` then `dismissed('m1')`: `selectHasOutstandingFor('conv-m1')` reads `false`.
- Two prompts on the same conversation, one dismissed: still `true` — the read is per-conversation,
  not per-prompt, and dismissing one sibling must not clear the dot.
- After `reconnected` clears `outstanding`: `false` for a previously-true id.

**AC4 — never reported against another conversation, prototype names included:**
- Hold prompts for `conv-a` and `conv-b` simultaneously; each id reads `true` and a third reads
  `false`. Assert both ids independently — one prompt's presence must not answer for the other.
- Hold a prompt whose `conversationId` is `'__proto__'` and **read back under the exact id queried**:
  `selectHasOutstandingFor('__proto__')` reads `true`. A positive read-back, not an absence check —
  an absence check passes vacuously against an implementation that silently dropped the entry.
- Repeat the read-back for `'constructor'` and `'toString'`.
- With **no** prompt held for them, `selectHasOutstandingFor('__proto__')`,
  `'constructor'` and `'toString'` each read `false` — the inherited-property-name query must not
  resolve onto `Object.prototype`.
- State integrity after the `'__proto__'` install: `({} as Record<string, unknown>).polluted` is
  `undefined` and `Object.prototype` gained no own property. Near-free given the array scan, and it
  pins the no-computed-key constraint against a future refactor to a keyed container.

### Gates

- `npm run typecheck` — catches the 9 tsc-half sites.
- `npm test` — catches the 2 vitest-half sites plus the new scenarios.
- `npm run build` — the salvage gate; run it before opening the PR.

No e2e change: `e2e/` is unaffected (verified above) and the new read has no rendered surface yet.

## Security review

**Verdict:** PASS

This slice is where a permission prompt is bound to a conversation, and the `prompt` field it travels
with is a tool title and command line. Everything downstream reads a boolean, so a misattribution
introduced here is invisible to every later check. One MUST FIX was raised against the first draft and
addressed by revising § Design before commit; it is recorded below rather than silently folded in.

**Findings:**

- **[Trust boundaries] SHOULD FIX — no type-level signal that the field is daemon-asserted.**
  `conversationId` crossed the untrusted-peer boundary at `parseInboundMessage` (#870), was narrowed
  to `string` there, and has been carried by name across two typed boundaries since (#871 the IPC
  emit, #877 the renderer event). This slice re-parses and re-validates nothing — correct, since
  re-narrowing an already-narrowed value adds a second boundary to keep in sync. But both the held
  field and the selector's query parameter are bare `string`, so the type system does not distinguish
  daemon-asserted from client-owned, and a later reader could mistake it for the latter. No branded
  type is warranted: the id is **never a capability** — it authorises nothing, gates nothing, and
  selects no resource; it only labels a dot. The control is the corrected docblock (§ Comment
  corrections, item 1), which must state the provenance. Code-review should check that it does.

- **[Tokens, secrets, credentials] MUST FIX — addressed in this revision.** The first draft specified
  the `` `conv-${modalId}` `` derivation as the fixture convention without forbidding it in production
  code. A developer following the test convention into `modalPrompts.ts` would attribute every prompt
  to an id computed from `modalId` — which ADR 0009 defines as a one-time, opaque, **unguessable
  nonce** and the sole answer-correlation key. That both misattributes every prompt and pushes the
  nonce into a scoping value that later consumers may render, key on, or log. § Design now carries an
  explicit copy-never-derive constraint, and the AC1 scenario overriding `conversationId` away from
  the derived default is the test that catches it. No other token, key or credential is in reach: this
  slice adds no storage, no `safeStorage` call, and no lifecycle.

- **[Misattribution — the property the label is for] No findings.** The prompt is bound at install
  time from the same event that supplied its `modalId`, `title` and `prompt`, in one literal, by name.
  No join, no lookup table, no second event, no window in which a prompt exists without its
  conversation — so no interleaving of two `shown` events can cross-wire a prompt onto the wrong
  conversation, and a re-delivery replaces both fields together from the same re-delivered event. The
  one real risk is transposing the two adjacent same-typed `string` fields, which is **compile-silent**;
  the distinct-values fixture convention is what makes an exact `toEqual` catch it. That convention is
  a correctness control, not a style choice.

- **[File / storage operations] No findings — the id never becomes a key or a path.** The read is
  `outstanding.some((p) => p.conversationId === queried)`: a value comparison against an own field.
  There is no `obj[k]`, no computed object key, no `Object.fromEntries`, no `Record`, no `Map` keyed
  by the id, and no filesystem contact at all. So the prototype hazards are structurally absent — a
  `'__proto__'` query cannot resolve onto `Object.prototype`, `'constructor'` cannot report a false
  positive against an inherited member, and no assignment path exists to pollute a prototype. This is
  why the § Design ban on a keyed container is a **security** constraint, not a performance one: the
  hazard reappears the moment `outstanding` is re-keyed by a daemon-asserted string. AC4's
  read-back-under-the-exact-id assertions pin it against that refactor. CLAUDE.md's rule that daemon
  text must never be a filename, cache key or lookup path is upheld by construction.

- **[Inter-process / Electron attack surface] No findings — no new surface.** No `contextBridge` API,
  no `ipcMain` channel, no `BrowserWindow` config, no custom protocol or deep link, no navigation
  handler. The IPC boundary this field crosses is #871's and was reviewed there. Process placement is
  unchanged: everything lands in `src/renderer/src/store`, and no key, socket, token or raw byte is in
  reach — CLAUDE.md's "keep the transport out of the window" is unaffected.

- **[Cryptographic primitives] No findings — and `===` is the right compare here.** No RNG, no
  hashing, no key derivation, no Noise contact. The checklist's constant-time-compare bullet does not
  apply: `conversationId` is a non-secret scoping label on both sides of the comparison, not a token or
  MAC, and the only on-path adversary (the content-blind relay) cannot observe renderer-local timing.
  `crypto.timingSafeEqual` would be cargo-cult here. The contrast is worth recording — `modalId` **is**
  an unguessable nonce, and this slice adds no comparison on it.

- **[Network & I/O] No findings.** No socket, frame, URL, timeout or reconnect path. The id arrived
  over the already-capped inbound path (`MAX_PLAINTEXT_BYTES` at `parseInboundMessage`), so its length
  is bounded upstream; a `===` over an array holding at most a handful of concurrent modals (ADR 0009)
  is no amplification vector and allocates nothing per call.

- **[Error messages, logs, telemetry] No findings — zero new sinks, and that is a constraint.** The
  selector returns a `boolean` and cannot throw. This slice adds no log call, no error message, no
  `Error` interpolation, no telemetry field and no outbound frame, so no daemon-asserted string reaches
  a log line, a stack trace, an attribute, a URL or a raw-markup sink. The untrusted-display-text
  handling `title` / `prompt` / `options[].label` need does not attach to the id because nothing
  displays it — and nothing in this slice may start logging it.

- **[Concurrency] No findings — nothing async, and the boolean must stay non-authoritative.** No task,
  listener, timer, `AbortController` or teardown; the reducer, `set`, and the selector are all
  synchronous, so there is no check-then-act-across-an-`await` gap. One forward-looking note for the
  consumer: the boolean is a render-time snapshot and can go stale between render and a user action.
  Harmless for a dot. It must **not** become an authorization gate downstream — the answer path is
  keyed by `modalId` and stays that way (ADR 0009 § Context, `:22`); no outbound frame gains a field
  and `PendingConfirm` is unchanged, so the new id cannot become a forgeable routing input.

- **[Threat model alignment] No findings; one accepted residual.** *Malicious relay* — content-blind
  and unable to forge inside the Noise session; dropping or delaying a `shown` means the dot is absent,
  which is fail-safe (no false "input required"), and reordering cannot split a prompt from its id
  because both ride one frame. *Renderer compromise* — a compromised renderer already holds the prompt
  text; this slice grants no new reach. *Token theft from disk* — not in reach, no storage touched.
  *Hostile daemon* — **accepted residual:** a daemon that stamps a prompt with the wrong
  `conversation_id` will have it attributed to the wrong conversation. The client has no independent
  way to verify the stamp — the id *is* the daemon's assertion — so this is outside the client's reach
  by construction and matches the trust model the pairing handshake establishes. Not a defect in this
  slice, and not deferrable to a later one.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-09-01

## Out of scope

- **Filtering the rendered prompt list.** `PermissionModal.tsx:192` reads `selectOutstanding`
  unfiltered and shows every outstanding prompt regardless of conversation, because until this ticket
  it had no way not to. Now that a prompt is attributable, scoping that render to the open
  conversation becomes possible — and is a separate ticket. Do not widen into it.
- **The sidebar dot.** The status resolver that consumes this predicate is downstream and not
  security-sensitive; it reads a boolean.
- **ADR 0009 amendments.** § "The wire boundary" (`0009-modal-prompt-model.md:55`) currently ends "It
  stops there… the consumer that scopes a prompt to a conversation is #878", and the § "Reduce
  behavior" `shown` bullet at `:59` still lists the arm's fields without the id. **This slice makes
  both false.** Amending them is documentation phase's work, not an acceptance criterion and not a
  developer deliverable. The developer's worktree should mutate only `src/` and this spec file.

## Comment corrections (production, in scope)

Two comments assert the field stops at `reduceModal`. Both become false and must be corrected in the
same commit as the code — a stale comment asserting a security boundary that no longer exists is worse
than none:

1. `modalPrompts.ts:42-43` — the `ModalEvent` docblock's "It STOPS at `reduceModal`, which builds
   `ModalPrompt` from named fields and omits it; the consumer that scopes a prompt to a sidebar row is
   #878." Rewrite: it is now carried onto `ModalPrompt` and read by `selectHasOutstandingFor`. Keep
   the two clauses that stay true — the required-not-optional rationale, and `modalId` remaining the
   sole correlation key for answering.
2. `modalPrompts.ts:136-145` — `reduceModal`'s docblock describes the `shown` arm's behavior; extend
   it only if the field's arrival there is not already implied. Do not rewrite the `#195` / `#510`
   clauses.

`src/shared/ipc/events.ts:653-657` makes the same "stops at `reduceModal`" claim one boundary up.
Leave it: it is outside this slice's file surface, and correcting it would widen the diff into the
main-side project for a comment the documentation phase will fold in with the ADR.

## Open questions

- **Selector name.** `selectHasOutstandingFor` reads as "has outstanding [prompt] for <id>" and
  signals the boolean return through `Has` while keeping the `select…For` currying idiom. If the
  developer finds a materially clearer name while writing the tests, take it — the name is not
  load-bearing, but keep the `…For` suffix so the currying stays recognizable at the call site.
- Nothing else. The wire contract, the required-vs-optional question, the container choice, and the
  answer-path scoping are all settled on the record (ADR 0009, #871, #877) and are not reopened here.

## Sizing note

**S, and the 11-site cascade is one over the 10-call-site red line — a deliberate, examined call.**
Recorded here so code review sees the reasoning rather than an omission:

The cascade is irreducible and no split shape reduces it. All 8 screen-side sites are typed
`ModalPrompt` literals that fail at `tsc` the instant the field is required, so none can be deferred
without leaving the repo red between children — and splitting presupposes a green intermediate.
Strangler Fig does not apply: a required field has no two-version state to migrate through, and the
optional-first alternative is the exact shape #871 and #877 rejected on the record. Splitting the
selector out instead leaves all 11 edits sitting in the first child and serializes a second agent run
for three novel lines. The avoid-the-cascade-entirely option — a parallel `Map` keyed by `modalId` —
is rejected on correctness in § Design.

Every other axis carries wide margin: ~3 production lines across 2 files, 1 new exported symbol, 0 new
files, ~120 total LOC against the ~600 ceiling, and the 11 edits are one-line named-field additions
across 5 files (~25-30 turns projected against a 50-70 budget). The count is the only marginal axis,
it is over by one, and the partition that would fix it does not exist.
