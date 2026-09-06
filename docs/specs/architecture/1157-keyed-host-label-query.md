# #1157 — the stored-host-label query names the server it asks about

A second IPC channel beside `HOST_LABEL_CHANNEL`, carrying an untrusted `serverId`, answering from
`MultiHostLabelStore.loadFor`. The zero-argument channel stays exactly as it is.

## Files read

- `src/shared/ipc/hostLabel.ts` → `HOST_LABEL_CHANNEL`, `HostLabelResult` — the contract this slice
  extends. Its header states the obligation this ticket discharges ("per-server-id keying … is the
  deferred multi-host change that would give this query an argument; at that point it needs a
  guard") and is therefore one of the three claims this slice falsifies.
- `src/shared/ipc/unpair.ts` → `UNPAIR_SERVER_CHANNEL`, `MAX_SERVER_ID_LENGTH`,
  `isUnpairServerRequest`, `UnpairServerRequest` — the precedent in full: a second channel rather
  than a changed signature, the bound to reuse, the guard to mirror, and the two settled edge
  rulings (`{ serverId: undefined }` rejected, `''` accepted).
- `src/main/hostLabelHandler.ts` → `registerHostLabelHandler`, `HostLabelHandleTarget` — the
  zero-argument arm this slice sits beside untouched: its `Pick<HostLabelStore, 'load'>` handle, its
  strict-null ordering, its read bound, its classify-don't-forward catch.
- `src/main/unpairHandler.ts` → `registerUnpairServerHandler`, `UnpairServerHandleTarget` — the
  two-exported-registrations shape, the guard-as-first-statement discipline, and the
  `Pick<Multi…Store, 'one-verb'>` narrowing argument to reproduce.
- `src/main/hostLabelStore.ts` → `MultiHostLabelStore.loadFor`, `readEntries`, `parseLabels`,
  `load` — the store half, already built and already keyed. `loadFor` matches with `===` against
  each entry's own `server` field, and `readEntries` maps both an absent blob and a legacy bare blob
  to `[]`, which is where AC3's legacy clause comes from.
- `src/main/hostLabelHandler.test.ts` → its whole-interface literal `const store: HostLabelStore =
  { save, load, clear }` — load-bearing: a new required member on `HostLabelStore` would stop this
  file compiling, `tsc`-only, invisible to `npm test`. This is why the new handle types against
  `MultiHostLabelStore`, never `HostLabelStore`.
- `src/shared/ipc/unpair.test.ts` → its `isUnpairServerRequest` cases — the guard test set to mirror
  one-for-one, including the prototype-shaped id and the at-bound / one-over pair.
- `src/main/hostLabelStore.test.ts` → its `fakeSecureStore` helper and the legacy-blob `loadFor`
  cases — the store's side of AC3's legacy clause is already proven there, so this slice pins only
  the boundary's forwarding of it.
- `src/preload/index.ts` → `hostLabel`, `unpairServer` — the fixed-channel invoker discipline and
  the "building the request object in the bridge is a convenience, not a defence" note to carry.
- `src/main/index.ts` → the `registerHostLabelHandler` / `registerUnpairServerHandler` wiring block —
  the already-constructed `hostLabelStore` to reuse and the `will-quit` remover pattern.
- `docs/knowledge/features/host-label-channel.md` § Security properties, and
  `docs/knowledge/features/host-label-store.md` § Design notes — the two doc claims this slice
  falsifies ("still a zero-argument, body-free query"; "`loadFor` still ships with no caller"). Not
  edited here — see Context.

## Design source

**Figma:** N/A — main-process IPC and preload only. No rendered surface: the sidebar host row that
consumes this query is #1070. The visual-fidelity check is intentionally skipped.

## Context

`HOST_LABEL_CHANNEL` carries no request body, so with several machines paired it cannot say which
one it is asking about. #1155 layered the keyed triple onto the store and #1156 moved the pairing
write and the per-server unpair erase onto `saveFor` / `clearFor`; `loadFor` is the last member of
that triple with no caller. This slice is its first caller, at the IPC boundary.

**Shape: a second channel, not a changed signature.** The same cut #1149 made for the unpair path.
It is not only precedent — it is forced here. `window.pyry.hostLabel` is passed as a *bare function
reference* into `hostLabelLoader`'s one-shot loader, which calls it with no arguments, so a newly
required parameter would break that caller at the type level and be refused at the guard at runtime.
Migrating that caller is #1070's.

**No store change.** `loadFor` already exists on `MultiHostLabelStore`, and the composition root
already constructs one and hands the same instance to every host-label seam.

**Size.** Four production files, no consumer cascade, 5 acceptance criteria, 4 outcome arms — inside
every boundary except total written work, where the refiner's estimate (~1200 lines) is over the
800-line guideline. Stated rather than cut, on the floor rule: a channel constant with no guard has
no behaviour, a guard with no handler has no caller, a handler with no preload invoker is
unreachable from the window. Each candidate child would have exactly one consumer inside this
family, so splitting would produce slices that cannot be verified on their own. Parent chain depth
is 1 (#1151, no grandparent), so a split was available and was declined on this reasoning.

**No ADR.** This extends a settled pattern (#1149's) rather than deciding anything new.

**Docs.** The two `docs/knowledge/features/` pages the ticket names are the documentation phase's to
correct; this slice does not touch them. The third stale claim lives in a source comment
(`hostLabel.ts`'s module header, which predicts this ticket and says the missing guard "is not an
oversight") and *is* corrected here, in the file it is wrong about, in the same commit that makes it
wrong — the `unpair.ts` header's "An earlier version of this header stated…" retraction is the
form to follow.

## Design

Three new exports in `src/shared/ipc/hostLabel.ts`, two in `src/main/hostLabelHandler.ts`, one
bridge function, one composition-root registration. Nothing existing changes shape.

### `src/shared/ipc/hostLabel.ts`

| Symbol | Contract |
|---|---|
| `HOST_LABEL_SERVER_CHANNEL` | `'pyry:host-label-server'` — distinct from `HOST_LABEL_CHANNEL`, mirroring how `UNPAIR_SERVER_CHANNEL` sits beside `UNPAIR_CHANNEL`. |
| `HostLabelServerRequest` | `{ serverId: string }`. The channel is the verb, so no `type` discriminant. |
| `isHostLabelServerRequest(value: unknown): value is HostLabelServerRequest` | Structural runtime guard. True iff `value` is a non-null object carrying a `serverId` that is a string within `MAX_SERVER_ID_LENGTH`. Accepts extra fields. Pure, never throws. |

`MAX_SERVER_ID_LENGTH` is **imported from `./unpair`**, not re-declared. Its aliasing argument
carries over unchanged: every persisted `server` id arrived inside a pairing paste already limited
by `MAX_PASTE_LENGTH`, so no held record can be made *unreadable* by this check — whatever could be
stored can be named. Cross-module constant imports inside `src/shared/ipc/` are already the idiom
(`unpair.ts` imports from `./pairing`). A second number would be the drift the ticket forbids.

`isHostLabelServerRequest` is a new function rather than a reuse of `isUnpairServerRequest`: the
guards are structurally identical today but belong to two channels with two different verbs, and
naming one after the other would make a later divergence in either look like a bug in both. This
mirrors #1149, which minted its guard rather than sharing `isPairingRequest`.

**`HostLabelResult` is reused unchanged.** The three outcomes are the same three, and AC2 requires
the guard refusal to be indistinguishable from every other failure — which is what returning the
existing value-free `error` arm gives, exactly as `UnpairResult` is shared across both unpair
channels. No fourth arm, no reason field: a distinct refusal outcome would tell a compromised
renderer which of its guesses was well-formed.

### `src/main/hostLabelHandler.ts`

| Symbol | Contract |
|---|---|
| `HostLabelServerHandleTarget` | `handle(channel, listener: (event: unknown, request: unknown) => Promise<HostLabelResult>)` + `removeHandler(channel)`. The two-argument shape `UnpairServerHandleTarget` uses; `ipcMain` satisfies it structurally. The event arg is typed `unknown` and stripped. |
| `registerHostLabelServerHandler(target, deps: { store: Pick<MultiHostLabelStore, 'loadFor'> }): () => void` | Registers one listener on `HOST_LABEL_SERVER_CHANNEL`, returns an unregister handle removing exactly that channel. Stateless; reads through on every invoke. |

**The dep type is the security substance, not tidiness.** `Pick<MultiHostLabelStore, 'loadFor'>`
withholds `save`, `saveFor`, `clear` and `clearFor`, so this read channel has no *name* by which to
mutate at-rest state — the same instrument the zero-argument arm's `Pick<HostLabelStore, 'load'>`
uses, pointed one level finer. It is `MultiHostLabelStore` and never `HostLabelStore`: `loadFor`
lives on the layered interface, and adding a member to `HostLabelStore` would stop
`hostLabelHandler.test.ts`'s whole-interface literal compiling — a `tsc`-only break that leaves
`npm test` green.

Listener order, and each step's reason:

1. **Guard first**, before anything else reads the request. A refusal returns `{ status: 'error' }`
   *before any store call*, so a malformed request never reaches the store (AC2).
2. `store.loadFor(request.serverId)` inside a `try`. The id passes through **verbatim** and is
   compared with `===` against each decoded entry's own `server` field, so it never becomes a
   persistence name, a filesystem path or an object key — `__proto__` is inert (AC2's downstream
   half). It is not logged.
3. **Strict `=== null`**, never a truthiness test → `not-stored`. `''` is falsy, so `if (!label)`
   would type-check, read naturally, pass any test using a non-empty label, and silently collapse a
   stored-empty label into absence at the last boundary that still tells them apart (AC3).
4. `label.length > MAX_HOST_LABEL_LENGTH` → `error`. The same constant and the same unit (UTF-16
   code units) the write guard uses. Dropped **whole**: no truncation, no prefix, no length
   reported. Ordered after the null check, which has no `.length` (AC3).
5. Otherwise `{ status: 'stored', label }`, verbatim — no trim, normalize, escape or fallback.
6. `catch` → `error` **without inspecting the error**, caught object dropped. Reachable through
   `loadFor` the same way it is through `load`: invalid UTF-8 and a drifted envelope both raise
   `MalformedHostLabelError`, and a decrypt failure propagates. Never rethrows — a rejection would
   cross as an Electron-serialized error carrying a main-process stack trace (AC3, AC5).

`not-stored` and `error` declare **no `label` key** rather than `label: undefined`: structured clone
preserves an own undefined-valued property, so a renderer's `in` test would misread absence. The
existing union already makes that unrepresentable and the new arm inherits it.

**The legacy-blob answer is `not-stored`, and is left alone.** `loadFor` reads through
`readEntries`, which maps a bare pre-#1156 blob to `[]`, so on a machine installed before #1156 this
query answers never-stored for every id until the next pairing writes an envelope. A documented
one-way loss, not a gap: the store has no view of the paired records and cannot name the server a
bare string belonged to. Nothing in this slice adopts it for one server.

### `src/preload/index.ts`

`hostLabelFor(serverId: string): Promise<HostLabelResult>` — invokes `HOST_LABEL_SERVER_CHANNEL`
with `{ serverId }`. `hostLabel` is untouched beside it. The channel constant is fixed here so the
renderer cannot address an arbitrary channel, `ipcRenderer` does not cross the bridge, and building
the request object here is a **convenience, not a defence** — the main side validates on its own
merits regardless.

### `src/main/index.ts`

A second registration beside the existing one, reusing the **same already-constructed**
`hostLabelStore` (do not build a second), with its own `will-quit` remover. The existing
`registerHostLabelHandler` line and its remover are unchanged. Its comment gains a sentence saying
the keyed arm now exists and that the sidebar's move onto it is #1070's.

## State + concurrency model

Stateless on both new seams: the handler holds nothing between calls and reads through on every
invoke, so a label written at pairing confirm is visible on the very next invoke with no
invalidation step. No timers, no listeners, no subscriptions — nothing to cancel; teardown is the
single `removeHandler` the returned handle performs, symmetric with every sibling registration.

`loadFor` is a **read** and deliberately stays off the store's serializing `mutate` queue: it is a
single `secureStore.get` with nothing to interleave, and no read-modify-write pair exists on this
path to race. Two concurrent invokes on this channel are two independent reads; neither can observe
a torn write, because the writers replace the blob in one `set`.

No renderer state, no Zustand slice, no React surface — the consumer is #1070.

## Error handling

Four outcomes, three of them value-free by construction:

| Condition | Result |
|---|---|
| Guard refusal (wrong type, missing field, over-length id) | `error`, before any store call |
| `loadFor` → `null` (never stored for this id, or a legacy blob) | `not-stored` |
| Stored label over `MAX_HOST_LABEL_LENGTH` | `error`, dropped whole |
| `loadFor` throws (`MalformedHostLabelError`, propagated decrypt failure) | `error`, caught object dropped |
| Stored label within bound (`''` included) | `stored`, verbatim |

Classify-don't-forward throughout: every throw collapses to one `error` without branching on the
error type, because a decrypt failure's message can echo a filesystem or OS-keychain path. Nothing
on any path logs — no `console.*` is added to either module, and the request id is never logged
either, which is what keeps `hostLabelHandler.ts` log-free now that it takes a request at all.

## Testing strategy

vitest only (node environment). No renderer surface, so no `renderToStaticMarkup` spec; no
interaction, so no Playwright spec.

**New `src/shared/ipc/hostLabel.test.ts`** — the module has none today.

- Both channel strings pinned, and pinned distinct from each other.
- `isHostLabelServerRequest` mirroring `unpair.test.ts`'s set: accepts a string `serverId` including
  with an extra field; rejects `null` / `undefined` / non-objects; rejects a missing or non-string
  `serverId` and an array; rejects `{ serverId: undefined }`; accepts exactly
  `MAX_SERVER_ID_LENGTH` and rejects one over; accepts `''`; treats a prototype-shaped id as an
  ordinary string.
- The bound is asserted to *be* `MAX_SERVER_ID_LENGTH` rather than a repeated literal, so a second
  number cannot be minted without reddening this.

**`src/main/hostLabelHandler.test.ts`** — a new `describe('registerHostLabelServerHandler')` beside
the existing suite, which is untouched.

- Registers exactly one handler on `HOST_LABEL_SERVER_CHANNEL` and unregisters that exact channel.
- **AC1:** two ids against one fake store return each id's own label; the id reaches `loadFor`
  verbatim, including a prototype-shaped one.
- **AC2:** every malformed request answers `error` *and* `loadFor` was never called — the "before
  any store call" half asserted separately from the outcome, since an outcome-only assertion would
  pass with the guard deleted and the store returning null. `''` is accepted at the guard and
  reaches the store.
- **AC3:** stored-empty is `stored` (the truthiness-check regression pin); `null` is `not-stored`
  with no `label` key; exactly-at-bound crosses and one-over answers `error`; an over-long label
  leaves no residue, asserted against a distinctive sentinel so a truncated prefix would be visible;
  `MalformedHostLabelError` and a plain `Error` carrying a keychain-path-shaped message both answer
  `error` and resolve rather than reject, with no detail crossing.
- **AC3 legacy clause + AC4, one test, one real store.** Build a real `createHostLabelStore` over an
  in-memory `SecureStore` seeded with a bare pre-#1156 blob, and drive **both** channels against it:
  the keyed one answers `not-stored` for every id, the zero-argument one answers the bare text
  verbatim. Then reseed with a keyed envelope and assert the keyed channel answers per-id while the
  zero-argument one answers the most recently stored entry. This is the only test that proves the
  two channels disagree *correctly* on the same bytes; a fake store cannot pin it, because the
  disagreement lives in the store's two read paths.
- **AC5:** log-free across every branch including the guard refusal (spying `console.error/log/warn`);
  the request id never appears in any response, asserted against a distinctive id on the refusal,
  never-stored and error arms.
- Never writes: `save`, `saveFor`, `clear`, `clearFor` are never called on any branch. Unrepresentable
  through the `Pick` today; pinned at runtime against a future widening of the dep type.
- Reads through on every invoke — no cache.

Fakes over mocks for the store; `vi.fn()` only where call-count or argument-identity is the
assertion.

## Open questions

1. **Channel string.** `'pyry:host-label-server'` mirrors `'pyry:unpair-server'`. Settled unless the
   composition root reveals a conflicting name — resolve by grep before implementing.
2. **Does `hostLabel.ts` importing from `./unpair` create a cycle?** `unpair.ts` imports only from
   `./pairing`, and `pairing.ts` imports neither, so no. Confirm with `npm run build`.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings — one explicit boundary, `isHostLabelServerRequest`, applied as
  the listener's first statement, with exactly one store call after it. The narrowed `serverId` then
  reaches only `loadFor`'s `===` compare against each decoded entry's own `server` **field**;
  `parseEntry` rebuilds every entry from two narrowed values and `parseLabels` dedups with a `Set`,
  so `__proto__` is a plain string comparand on both sides. Nothing downstream holds an unvalidated
  value.
- **[Trust boundaries]** Accepted, named rather than fixed — the keyed query is a per-id
  **existence oracle**: a compromised renderer learns, for a guessed id, whether a label is held.
  That distinction is AC3 itself (the three outcomes must stay distinct *per server*), so it cannot
  be closed without failing the ticket. It is also the narrower half of what `serverInfo` already
  answers, and it discloses a label's presence, never a token, key or relay URL. The refusal arm is
  deliberately the *same* value-free `error` as every other failure, so the guard leaks nothing
  about which guesses were well-formed.
- **[Tokens/secrets]** No findings — no credential is on this path. The dep type
  `Pick<MultiHostLabelStore, 'loadFor'>` carries no record verb at all, and the host-label store
  holds no token, server static key or relay URL to begin with. No new storage decision: the at-rest
  seam is the existing `safeStorage`-backed `SecureStore`, unchanged, and this slice only reads it.
- **[File/storage]** No findings, and this is the category a naive design fails. The untrusted id
  never reaches `secureStore.get`'s `name`: `readEntries` reads under the fixed `HOST_LABEL_NAME`
  closed over at store construction, and the per-server collection lives *inside* that one blob.
  Composing the persistence name from the id (`pyrycode.host_label.<server-id>`) is the mechanism
  `hostLabelStore`'s `HOST_LABEL_NAME` comment explicitly rejects, and using `loadFor` inherits that
  rejection rather than re-deciding it. No path constructs a filesystem path, and this slice writes
  nothing, so there is no atomicity or TOCTOU surface.
- **[Electron attack surface]** No findings — and the `Pick` narrowing is the substance. Withholding
  `load`, `save`, `saveFor`, `clear` and `clearFor` leaves the listener **no name** by which any
  malformed request could reach a whole-collection read or any erase; the compiler holds that, not a
  branch a later edit could get wrong. The bridge exposes one read-only function over a fixed channel
  constant, `ipcRenderer` does not cross, and `webPreferences`, `setWindowOpenHandler` and the
  permission allowlist are untouched. Repeated invokes are bounded and un-amplified — one invoke is
  one local decrypt plus a linear `find` over an envelope whose size the pairing guards already
  bound; no rate limit is added here because the property is identical to `pairingStatus`,
  `serverInfo` and the existing `hostLabel` arm, and adding one to this channel alone would close
  nothing.
- **[Cryptographic primitives]** Not applicable, by design rather than omission: this slice performs
  no comparison against a secret and needs no `timingSafeEqual`. A server id is an opaque public
  identifier the renderer already holds — #1070 will pass ids it got from the paired-server list —
  so the `===` in `loadFor` is not a secret compare. AEAD, key handling and decode all stay inside
  the untouched store.
- **[Network & I/O]** Not applicable — no socket, frame, relay URL or timeout is on this path. The
  channel answers from at-rest state whether or not a connection is live, which is the same property
  the zero-argument arm has.
- **[Errors/logs/telemetry]** No findings — `not-stored` and `error` are value-free *by
  construction* (the union declares `label` on the `stored` arm alone), the caught object is dropped
  without inspection because a decrypt failure can echo a keychain or filesystem path, an over-long
  label is dropped whole with no prefix and no length reported, and no `console.*` is added to
  either module. The request id is never logged either — the property that keeps
  `hostLabelHandler.ts` log-free now that it takes a request at all. Examined and accepted: the guard
  runs *outside* the `try`, so a throw from it would escape as an Electron-serialized rejection
  carrying a main-process stack trace. It cannot throw — the `in` test is short-circuited by the
  `typeof`/null tests ahead of it, and structured clone means the main side receives a plain
  deserialized object, never a Proxy with a throwing trap. Kept outside the `try` to match
  `registerUnpairServerHandler` exactly, since a divergence would read as a correction of it.
- **[Concurrency]** No findings — stateless, no timers, no subscriptions, exact `removeHandler`
  teardown on `will-quit`. No check-then-act: one read, no mutation, nothing held across an await.
  `loadFor` stays off the store's `mutate` queue correctly (a single `get` has nothing to
  interleave); a concurrent keyed write ends in one `set` over a temp-then-rename persistence, so a
  read sees one whole blob or the other and the worst case is a stale-by-one-write answer — which is
  what "reads through, no cache" means and what the consumer wants.
- **[Threat model]** No findings on the live threat. Under **renderer compromise**, this slice grants
  exactly one new capability — ask what label is stored for id X — and no write, erase, key, token,
  socket or path; the dep type holds that structurally. A **tampered blob** fails AEAD decryption and
  a drifted envelope raises `MalformedHostLabelError`, both answering `error`, never a plausible
  string. Hostile relay and hostile daemon are off this path: the label is operator-typed at pairing
  and never touches the wire. **OUT OF SCOPE:** rendering this untrusted text as escaped, bounded
  text belongs to #1070's sidebar host row, per CLAUDE.md's 2026-08-20 operator ruling — this slice
  carries the string across IPC and asserts nothing about its markup treatment.
- **[Testing — detector soundness]** **SHOULD FIX**, carried into Phase B. AC2's malformed-request
  tests must assert that `loadFor` **was never called**, not merely that the outcome is `error`.
  With the guard deleted, a `null` or `undefined` request makes `request.serverId` throw, the
  classify-don't-forward `catch` turns that into `error`, and an outcome-only assertion passes
  green over a removed guard. (The other malformed inputs do redden, which is what makes the gap
  easy to miss: only the two that throw are vacuous.) The store-call assertion closes all of them
  uniformly and is also the literal wording of AC2's "before any store call".

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06

## Revisions

None yet.
