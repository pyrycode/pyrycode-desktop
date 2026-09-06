# 1156 — the label written at pairing and erased at unpair is keyed by server

Ticket: https://github.com/pyrycode/pyrycode-desktop/issues/1156 (split from #1151, unblocked by #1155)

## Design source

**Figma:** N/A — this slice is main-process only: one store, two IPC handlers, and comments at the
composition root. No rendered surface changes. The sidebar host row that displays the label is
explicitly out of scope (`ChannelList.tsx`'s `HostRowControl` is untouched; #1070 owns its move onto
a keyed read channel), so there is no visual-fidelity check to make.

## Files read

- `src/main/hostLabelStore.ts` → `createHostLabelStore`, `HostLabelStore`, `MultiHostLabelStore`,
  `decodeLabels`, `decodeLabel`, `encodeLabels`, `HOST_LABEL_NAME` — the store this slice's reader
  change lands in, and the keyed triple #1155 shipped with no caller. Its header carries the
  hand-off this ticket takes.
- `src/main/pairingHandler.ts` → `registerPairingHandler` — the confirm arm that writes the label,
  and the `pendingConfirm` slot the server id has to ride beside.
- `src/main/pairingConfirmation.ts` → `PairingConfirmation`, `PreparedPairing`,
  `createPairingConfirmation` — checked because `confirm` is `() => Promise<void>` and carries no
  server id back. It is what makes the id's source a design question rather than a lookup.
- `src/main/pairingPayload.ts` → `ParsePairingResult` — the `{ ok: true; payload: QrPayload }` arm is
  where the handler already holds the id it needs, on the submit side of the same request pair.
- `src/main/unpairHandler.ts` → `registerUnpairHandler`, `registerUnpairServerHandler` — both arms:
  the interim `remaining === 0` rule this slice retires, and the whole-collection arm that does not
  move and the reason it does not.
- `src/main/hostLabelHandler.ts` → `registerHostLabelHandler` — the zero-argument read AC4 protects.
  Its `Pick<HostLabelStore, 'load'>` handle is why the reader seam can be taken inside the store
  without touching this file at all.
- `src/main/pairedServerStore.ts` → `MultiPairedServerStore['clearServer']` — returns
  `{ matched, remaining }` from inside its own mutate queue, so the erase's id and its outcome are
  both in hand with no follow-up read.
- `src/main/index.ts` → the `hostLabelStore` construction and the three `hostLabel:` wirings — the
  store is already constructed as `MultiHostLabelStore`, which is why re-keying the handles needs no
  code change here.
- `src/main/pairingHandler.test.ts` → `fakeHostLabel`, `paired` — the one helper every label
  assertion in that file goes through.
- `src/main/unpairHandler.test.ts` → `labelWithClear`, `storeWithClearServer` — same shape, and the
  per-server `describe` block that pins the rule being retired.
- `src/main/hostLabelHandler.test.ts` → its `const store: HostLabelStore = { save, load, clear }`
  whole-interface literal — the reason no member may be added to `HostLabelStore`, and a check that
  this slice adds none.
- `docs/knowledge/features/host-label-store.md` § Encoding, § Edge cases — the decode order this
  design reuses verbatim, and the standing ruling that **a legacy blob reads as no labels stored for
  every server id**. That ruling is about the *keyed* reader and is preserved here; the un-keyed
  reader keeps reading a legacy blob as the label it is, which is what AC4 asks for.

## Context

The host label has been a single un-keyed slot since #822. #1155 layered a per-server collection
(`saveFor` / `loadFor` / `clearFor` on `MultiHostLabelStore`) into the same blob under the same
`HOST_LABEL_NAME`, deliberately with **no caller**, leaving the callers to a sibling slice. This is
that slice: it moves the write and the per-server erase onto the keyed members, so pairing a second
machine stops overwriting the first machine's name and a per-server unpair stops guessing whose name
to erase.

Two at-rest shapes now share one blob — a bare UTF-8 label and a `{"v":1,"labels":[…]}` envelope —
and the store's header names the hazard exactly: *"a partial migration is the one state that would
put an envelope in front of the un-keyed reader."* The zero-argument stored-host-label query still
reads through un-keyed `load`, and #1157 keeps it that way on purpose while #1070 owns the sidebar's
move. So the first keyed write **is** the partial migration, and without a reader change the sidebar
would render `{"v":1,"labels":[{"server":"…","label":"Pyrybox"}]}` as the machine's name — or
`error`, once a longer id pushes that string past `MAX_HOST_LABEL_LENGTH`. AC4 is what closes it, and
this slice owns it because it is the one that first puts an envelope in the blob.

No ADR is warranted: this consumes a decision #1155 already recorded rather than making a new one.

**Sizing.** Built as one `size:s` ticket. Four production files, two production call sites, no new
exported type, five acceptance criteria, no new reject branches — every counted boundary holds. The
refiner's ~1100-line estimate is above the 800-line guideline and it says so; my own count against
this plan is nearer 700, because most of the weight is fixture rewiring inside two existing helpers
(`fakeHostLabel`, `labelWithClear`) rather than new structure. Either way the floor rule governs: the
write, the per-server erase, and the reader that observes them have no consumer but each other, and
splitting them is exactly what produced the defect this ticket closes — a keyed write erased by an
un-keyed clear and read back by an un-keyed reader that renders the envelope.

## Design

Four seams, three production files with real changes.

### 1. The reader (AC4) — `load` learns both at-rest shapes, inside the store

The read *channel* stays exactly as it is: `hostLabelHandler` is untouched, keeps its
`Pick<HostLabelStore, 'load'>` handle, and keeps its three distinct outcomes. The seam is taken one
layer down, in `createHostLabelStore`'s `load`, because that is where the two at-rest shapes are
already told apart and where the version marker lives. Taking it in the handler instead would mean
adding a "newest entry" member to `MultiHostLabelStore` and widening the handler's `Pick` — more
surface, in two files, for the same answer.

`decodeLabels` today conflates "this blob is not our envelope" with "our envelope holds no entries",
returning `[]` for both. `load` must distinguish them, so the parse splits in two:

- `parseLabels(text: string): HostLabelEntry[] | null` — the decode order documented in the store's
  header and in `host-label-store.md` § Encoding, unchanged step for step, except that the legacy
  outcome is now `null` ("not our format") instead of `[]`. Format drift past the marker still
  throws `MalformedHostLabelError`.
- `decodeLabels(blob: Uint8Array): HostLabelEntry[] | null` — `parseLabels(decodeLabel(blob))`.
  Hoisting `decodeLabel` out of the `try` is what lets the invalid-UTF-8 throw stay unswallowed
  structurally, replacing today's catch-and-`instanceof`-re-throw dance.

`readEntries` absorbs the new `null` as `[]`, so `saveFor` / `loadFor` / `clearFor` behave byte for
byte as they do today — including the standing ruling that a legacy blob reads as no labels stored
for every server id.

`load` then reads:

1. no blob → `null` (never stored) — unchanged, still the only null path.
2. invalid UTF-8 → `MalformedHostLabelError` — unchanged.
3. not our envelope → the decoded text verbatim (the single-slot label) — unchanged behaviour for
   every blob that exists today.
4. our envelope → **the last entry's label**, or `null` when it holds none.

"Last" is "most recently stored": `saveFor` drops any entry for the id and appends, and `clearFor`
filters, so array order is save order. That is the closest thing to what a single-slot blob returns,
which is exactly what AC4 asks for. The empty-envelope arm is unreachable in practice (`clearFor`
deletes the blob when the last entry goes) and resolves `null` rather than leaking envelope text —
the branch exists so that no reachable-by-tampering shape can put JSON in front of the renderer.

The last entry's label is taken with `?? null`, never `||` and never a truthiness test, for the same
reason `loadFor` documents and `hostLabelHandler` documents again: a stored `''` is a value the
operator supplied, and `''` is falsy, so a truthiness test would type-check, read naturally, pass any
test using a non-empty label, and silently collapse stored-empty into never-stored at the last
boundary where that distinction still exists. AC4 requires the three outcomes stay distinct, and this
is the line where the newly added branch could quietly merge two of them.

`load` returns **one label and nothing else** — never the envelope, never a list, never a count of
entries. Returning the collection (or reporting how many it holds, in a result or in an error
message) would tell the renderer how many machines the operator has paired and what they are called,
which is a fingerprinting gain the zero-argument query does not have today. `decodeLabels`'s existing
"no offending id, no index, no count" rule on `MalformedHostLabelError` is the same rule and stays.

The un-keyed `save` is **not** taught the envelope: after this slice it has no caller at all, and
teaching a dead writer a second format would be surface with no reader.

### 2. The write (AC1) — the id rides beside the pending confirm

`registerPairingHandler`'s `hostLabel` dep becomes `Pick<MultiHostLabelStore, 'saveFor'>` and the
confirm arm calls `saveFor(serverId, request.label)`. The narrowing survives intact and gets
stronger: `saveFor` can write one server's label and cannot read any label back, so "the label
string is never materialised where it must not be" stays a fact about the type.

The id is not available from `confirm` — `PreparedPairing` exposes only `fingerprint` and an opaque
`() => Promise<void>`, deliberately, so the record never leaves `pairingConfirmation`'s frozen
snapshot. Widening that union to carry the id would touch a file whose whole point is that it hands
back nothing but a hash and a callable. The handler already holds the id one branch earlier: the
submit arm has `parsed.payload`, and `confirmation.prepare(parsed.payload)` freezes `record.server`
off that same object in the same statement, so the two cannot differ. `parse` builds a fresh payload
per call, so there is no aliasing to a caller-held object either.

`pendingConfirm: (() => Promise<void>) | null` therefore becomes a single nullable pair,
`{ confirm, serverId } | null`. One slot, not two: they are set together and consumed together, so
they cannot desync, and the "consume before awaiting" rule that makes *persists exactly once*
structural applies to the pair unchanged.

Everything else about the write holds: ordered after the record and before `onPaired`, inside its own
`try` whose caught object is dropped, `request.label !== undefined` (not truthiness) so a stored `''`
survives, no `console.*` on any label branch.

### 3. The per-server erase (AC2) — `clearFor`, unconditionally

`registerUnpairServerHandler`'s `hostLabel` dep becomes `Pick<MultiHostLabelStore, 'clearFor'>` and
the `if (outcome.remaining === 0)` gate and its comment are deleted: the erase now runs on every
matched per-server unpair, naming the same `request.serverId` the record erase used. A handle that
can erase one server's label still cannot read any label, so the module stays unable to materialise
label text.

"An id matching no held record erases nothing" is already structural — the `!outcome.matched` arm
returns before this line — and needs no new branch.

Ordering and fail-closed behaviour do not drift: still after the record erase, still outside the
fail-closed catch, still its own empty catch with the caught object dropped, still `ok`.

`outcome.remaining` loses its only reader in the repo. Removing it from `clearServer`'s contract is a
`pairedServerStore` change and out of this ticket's scope; it stays as #1149 shipped it.

### 4. The whole-collection erase (AC3) — unchanged, deliberately

The ticket's technical notes expect all three un-keyed `save`/`clear` holders to move. Two do. The
whole-collection arm keeps `Pick<HostLabelStore, 'clear'>`, because `clear` deletes the blob under
`HOST_LABEL_NAME` — which *is* the keyed collection — so "no label stored for any server" is already
what it does, byte for byte, under the new at-rest shape. A `clearAll` on `MultiHostLabelStore` would
be a synonym for `clear` with a different name, shipped into an arm #1152 deletes wholesale. AC3 is
therefore satisfied by an unchanged arm plus a test that pins it against the keyed shape, not by a
new member. The `clear` doc comment is corrected to say it erases the blob whichever shape it holds.

### Comment corrections (no behaviour)

The store header's hand-off is now stale and is rewritten to describe what shipped: three of the four
callers moved, `hostLabelHandler`'s `load` stays live for #1157 and #1070, the un-keyed three are
therefore **not** deleted here, and the envelope-in-front-of-the-un-keyed-reader hazard is answered
by `load` understanding both shapes rather than by moving every caller at once. `index.ts`'s
"three disjoint `Pick`s" note is corrected to name the keyed members. No `index.ts` code changes: the
constructed store is already a `MultiHostLabelStore`, so it satisfies the new `Pick`s as-is.

## State + concurrency model

No new state and no new concurrency. `saveFor` and `clearFor` are read-modify-write and already run
through the store's serializing `mutate` chain, which is what makes two pairings or an unpair
interleaving across an `await` safe; this slice only gives that chain its first callers. `load` stays
off the chain — it is a single `get` with nothing to interleave, and reading the collection while a
mutation is queued yields either the pre- or post-state, both of which are labels an operator typed.

`pairingHandler`'s pending pair is main-process-local and consumed before its `await`, unchanged. No
timers, no listeners, no subscriptions, so nothing new to cancel on teardown; both handlers keep
their exact-teardown `removeHandler` handles.

## Error handling

Every path keeps the classification it has today.

- `saveFor` throwing (keychain unavailable, a decrypt failure on the read half of its
  read-modify-write) is caught in `pairingHandler`'s inner `try`, the caught object dropped, and the
  pairing still reports `ok` — a lost nickname is not a failed pairing. `saveFor`'s own
  `readForSave` still swallows only `MalformedHostLabelError`, so a corrupt blob remains settable
  while a transient keychain failure still fails loudly.
- `clearFor` throwing is caught in `registerUnpairServerHandler`'s inner `try`, dropped, and the
  unpair still reports `ok` — a surviving label must not downgrade an already-erased record (AC5).
- `load` throwing (invalid UTF-8, envelope drift past the version marker, a propagated decrypt
  failure) still collapses to `hostLabelHandler`'s `status: 'error'` with the caught object dropped.
  A keyed envelope that is broken past the marker is drift, not legacy, and must surface as
  unreadable rather than as a silently dropped label — that is the same rule `loadFor` follows.
- No `console.*` is added anywhere. No label text, server id, keychain path or error detail reaches
  any result or log on any path; the `Pick` narrowing is what holds it rather than a convention.

## Testing strategy

Vitest only, node environment, all main-process. No renderer surface and no interaction, so nothing
for the Playwright tiers.

`hostLabelStore.test.ts` — the reader, against fake `SecureStore` blobs:
- an envelope with one entry → `load` resolves that label (not the envelope text).
- an envelope with three entries → `load` resolves the **last-saved** one; driven through `saveFor`
  rather than a hand-written blob, so it pins save order rather than array order.
- `saveFor` then `load` → the label, and specifically **not** a string containing `"v":1` — the
  regression AC4 names.
- a legacy bare blob → `load` still resolves it verbatim, including `''` and a BOM-leading label.
- invalid UTF-8 → still `MalformedHostLabelError` from `load`.
- an envelope whose `labels` is not an array, or holds a duplicate id → `load` throws (drift, not
  legacy), keeping the unreadable outcome reachable.
- a hand-written `{"v":1,"labels":[]}` blob → `load` resolves `null`, not envelope text.
- `clearFor` down to the last entry then `load` → `null`; `clear()` after `saveFor` → `null` (AC3 at
  the store).
- `loadFor` / `saveFor` / `clearFor` behaviour on a legacy blob is unchanged (the `?? []` path).

`pairingHandler.test.ts` — `fakeHostLabel` moves to `saveFor`, and the existing label assertions move
with it:
- a labelled confirm calls `saveFor(<the payload's server id>, label)` exactly once — the id
  assertion is new and is what AC1 turns on.
- two pairings of different servers in one handler pass their own ids (a submit/confirm pair each).
- unchanged: no label → no call; `''` → saved as a value; a failed persist → no call; a throwing
  `saveFor` → still `{ ok: true }`, `onPaired` still fires; no dep wired → resolves.

`unpairHandler.test.ts` — a `labelWithClearFor` helper beside `labelWithClear`:
- per-server unpair with `remaining: 1` calls `clearFor(serverId)` — the retired rule's inverse, and
  the assertion that would have failed before this slice.
- `remaining: 0` also calls `clearFor(serverId)` (no gate left).
- `matched: false` calls nothing.
- the id passed to `clearFor` is the same one passed to `clearServer`, including for a hostile id
  (`__proto__`).
- a throwing `clearFor` still resolves `{ result: 'ok' }` and still fires `onUnpaired` (AC5).
- the whole-collection arm's existing `clear` assertions stay exactly as they are (AC3).

Fakes over mocks at the store seam, as the surrounding files already do; `vi.fn` spies only where a
call count or an argument is the assertion.

## Open questions

1. **Newest-wins or oldest-wins for the un-keyed `load` over an envelope?** Resolved in Design:
   newest. It is what a single-slot blob returns today (the last `save` wins), so the zero-argument
   query's answer does not change character when the first envelope lands.
2. **Should the whole-collection arm gain a keyed `clearAll`?** Resolved in Design: no — `clear`
   already erases the whole blob, and the arm is deleted by #1152.
3. **Does the empty-envelope arm need a test if it is unreachable?** Resolved in Testing: yes, as a
   hand-written blob. It is the one shape that could put JSON in front of the renderer, and the cost
   is one assertion.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] No findings — and the one new untrusted flow is bounded by an argument that
  already existed.** The design adds no boundary. `request.serverId` is still narrowed by
  `isUnpairServerRequest` as `registerUnpairServerHandler`'s first statement, before any store call,
  and this slice reuses that already-guarded value rather than re-deriving it. The genuinely new flow
  is `parsed.payload.server` reaching `saveFor` from the pasted pairing payload — untrusted paste
  input. It is bounded transitively: `MAX_SERVER_ID_LENGTH` is *aliased* to `MAX_PASTE_LENGTH`
  precisely on the reasoning that every persisted `server` id arrived inside a paste that bound
  already limited, so the id this slice writes cannot exceed what the unpair guard will later accept
  — nothing becomes unforgettable. The id never becomes a persistence name, a path, or an object key:
  `saveFor` makes it a JSON string value and a `===` comparand, which is what `HOST_LABEL_NAME`'s
  comment holds structurally.
- **[Tokens/secrets] No findings — and the rejected alternative was the less safe one.** The `Pick`
  narrowing is the instrument, not a tidiness preference, and it survives: `Pick<…, 'saveFor'>` can
  write one server's label and cannot read any, `Pick<…, 'clearFor'>` can erase one and cannot read
  any, so label text is still never materialised in either handler. `MultiHostLabelStore extends
  HostLabelStore`, but a `Pick` of one member does not inherit the others, so the narrowing is not
  quietly widened by the extension. The tempting way to get the server id into `pairingHandler` —
  widening `PreparedPairing` to carry it — was rejected in Design: it would put a record field on the
  return path of the one module whose entire purpose is handing back only a hash and an opaque
  callable, next to the frozen snapshot holding the bearer token and the server static key. Submit-
  side capture materialises the `server` id and nothing else, and that id is already renderer-visible
  through `serverInfoHandler`'s non-secret identity read.
- **[File/storage] No findings — the reader change writes nothing.** No path is constructed and no
  name is derived; `HOST_LABEL_NAME` is untouched and stays distinct from `pyrycode.paired_server`
  and `pyrycode.device_static`, so an erase still cannot reach a credential. Critically, `load`'s new
  envelope branch performs **no** `secureStore.set`: migration stays read-time only, exactly as
  `decodeLabels` documents, because a lazy rewrite-on-read would put a write on a read path where an
  unavailable keychain throws inside a query. Encryption at rest, fail-closed writes, and the
  temp-then-rename atomicity inherited from `fileSecretPersistence` are all unchanged.
- **[Electron / IPC surface] No findings — no new capability reaches the renderer.** No channel, no
  `contextBridge` member, no preload change, no `webPreferences` change; `shared/ipc/hostLabel.ts`'s
  shape is untouched. The one delta a hostile renderer can observe is *which* string comes back on
  `HOST_LABEL_CHANNEL`, and it gains nothing by it: the renderer already chooses that text outright
  via `request.label` on a pairing confirm, and the query still returns a single label — never the
  collection, never a server id, never an entry count. The naive implementation that returns the
  envelope text (or joins the labels) would hand a compromised renderer the number and names of every
  paired machine; the Design section pins the single-label rule for that reason.
- **[Cryptographic primitives] No findings, and the `===` on an untrusted comparand is correct here.**
  No crypto is added. The id comparison inside `saveFor`/`clearFor` is `===` against a decoded
  entry's own field, and constant-time comparison is not required because a `server` id is neither a
  secret nor an authenticator — the record's bearer token is what authenticates, and it is never read
  or compared on any path this slice touches. safeStorage's AEAD remains the integrity barrier that
  makes the decoder's positive version test sound.
- **[Network & I/O] Not applicable, by construction.** Nothing in this slice opens, reads, or
  configures a socket; no relay URL, timeout, TLS setting, or reconnect path is in scope. The only
  adjacent live-session effect is the unchanged `onUnpaired` teardown trigger.
- **[Errors, logs, telemetry] No findings, with one MUST-NOT for Phase B.** Every caught object stays
  dropped unread on all three paths, because `secureStore`'s failures can echo an OS-keychain or
  filesystem path. `MalformedHostLabelError`'s message stays static. Both handler modules are
  log-free by construction and must stay that way: while rewiring the per-server erase the natural
  debugging move is to log the id whose label was erased, which would put untrusted renderer input
  into a log for the first time in that module. No `console.*` is added on any path; the one existing
  `console.warn` in `pairingHandler` is a fixed string on the malformed-request arm and is untouched.
- **[Concurrency] SHOULD FIX — the naive two-slot implementation re-introduces this ticket's own
  bug.** `pairingHandler` must hold the confirm closure and the server id as ONE nullable pair, as
  Design prescribes. Two parallel `let` slots would let a path that clears one and not the other
  write server A's label under server B's id — a mislabelled machine, which is precisely the defect
  this ticket exists to remove, arriving from the other direction. The consume-before-`await`
  discipline that makes *persists exactly once* structural then applies to the pair as a unit. On the
  store side, `saveFor` and `clearFor` were already serialized by the `mutate` chain and this slice
  merely gives that chain its first callers; `load` stays off the chain, which is safe because a
  concurrent write is temp-then-rename atomic, so a reader sees the whole prior blob or the whole new
  one and never a torn envelope, and both are labels the operator typed. No timer, listener, or
  long-lived task is added, so nothing new needs cancelling at teardown.
- **[Threat model] No findings; the tampered-blob case is the one that moved, and it moved the safe
  way.** A malicious relay and a hostile daemon response are out of scope — the label is
  operator-typed and never crosses the wire, and this slice touches no transport. Token theft from
  disk is unchanged. The case that *is* newly relevant is a tampered at-rest envelope: safeStorage is
  AEAD, so a blob that decrypts was written by something already holding the keychain entry (which
  means it already holds the token, a strictly worse position), and drift past the version marker
  still raises rather than silently dropping a label — so the unreadable outcome AC4 requires stays
  reachable rather than degrading into a plausible-looking string. Renderer compromise reaching the
  transport is unchanged: no bridge surface is added.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06
