# #1155 — the host-label store holds a label per server

Split from #1151. Store-only slice: the keyed API is introduced alongside the un-keyed one and
nothing is wired to it. Every caller (`pairingHandler`, both `unpairHandler` arms, `hostLabelHandler`,
the composition root) is owned by a sibling slice and is not touched here.

## Files read

- `src/main/hostLabelStore.ts` → `HostLabelStore`, `createHostLabelStore`, `HOST_LABEL_NAME`,
  `encodeLabel` / `decodeLabel`, `MalformedHostLabelError` — the module this slice changes; its
  header carries the retracted per-server-key design this ticket rejects.
- `src/main/hostLabelStore.test.ts` → the `fakeSecureStore` / `seed` harness the new tests extend, and
  the `HOST_LABEL_NAME` literal pin that must stay green.
- `src/main/pairedServerStore.ts` → `MultiPairedServerStore` (the layered-interface precedent),
  `PAIRED_SERVER_NAME` (why the name stays constant), `decodeCollection` (the decode discipline),
  `readForSave` (why a save overwrites what no read can parse), the `mutate` queue, `clearServer`
  (the `{matched, remaining}` outcome this slice weighs and declines) — the module this one mirrors.
- `src/main/pairedServerStore.test.ts` → the interleaved-`Promise.all` queue test, the
  "does not wedge the queue" test, and the corrupt-blob recovery table the new tests follow.
- `src/main/hostLabelHandler.ts` / `src/main/hostLabelHandler.test.ts` → `registerHostLabelHandler`'s
  `Pick<HostLabelStore, 'load'>` dep, and the `const store: HostLabelStore = { save, load, clear }`
  literal that forbids adding a required member to `HostLabelStore`.
- `src/main/pairingHandler.ts` → `Pick<HostLabelStore, 'save'>`; `src/main/unpairHandler.ts` →
  two `Pick<HostLabelStore, 'clear'>` deps — the three narrowed consumers proving a widened
  *return* type is invisible to them.
- `src/main/index.ts` → `createHostLabelStore({ secureStore })` and its three hand-offs; the
  composition root needs no edit because widening the return type is a subtype relation.
- `src/main/secureStore.ts` → `SecureStore`, `EncryptionUnavailableError` — the one injected seam.
- `docs/knowledge/features/host-label-store.md` § Concurrency & lifecycle, § Security properties,
  § Edge cases — the "deliberately no read-modify-write helper" invariant this slice retires, and
  the untrusted-display-text hand-off that stays true per server.
- `docs/knowledge/features/paired-server-store.md` — the sibling's shipped account of the same shape.

## Design source

**Figma:** N/A — main-process persistence module. No renderer surface, no visual change; the
visual-fidelity check is intentionally skipped.

## Context

`hostLabelStore` holds ONE label in ONE blob under `HOST_LABEL_NAME`. Since #1069 the app holds
several paired records and since #1117 a live connection behind each, so that slot now describes
whichever pairing last supplied a label. This slice gives the store a label per server id.

It follows `pairedServerStore`, not the store's own header. That header calls
`pyrycode.host_label.<server-id>` "the deferred one-line multi-host change"; `pairedServerStore`'s
`PAIRED_SERVER_NAME` comment rejects exactly that mechanism for its own collection — the `server` id
is untrusted QR/paste input and `SecretPersistence` maps a name onto a storage key, so deriving the
name from the id would put attacker-chosen text on the persistence path — and retracts the identical
"deferred one-line change" claim it used to make about itself. So: one blob, one unchanged store
name, a collection inside it.

**No ADR is warranted.** ADR 0005 (secret-at-rest, fail-closed) already governs the seam and is
inherited unchanged; this slice adds no new at-rest surface, only a new shape inside an existing one.

**Size.** ~1 production file, 1 exported interface, 0 consumer call sites, 5 ACs, ~4 reject branches
— every boundary clear except total written work, which lands near the 800-line guideline and may
cross it (the refiner estimated ~1050). Stated rather than cut, per the floor rule: the decoder is
what the ACs are about, and a slice holding the keyed API without its own decoder would have exactly
one consumer — its sibling — and would not be verifiable alone.

## Design

### The layered interface

`HostLabelStore` gains **no** member. `hostLabelHandler.test.ts` annotates an object literal as the
whole interface (`const store: HostLabelStore = { save, load, clear }`), so a new required member
there stops that file compiling and forces an edit this slice must not make. The keyed members are
layered instead, exactly as `MultiPairedServerStore extends ClearablePairedServerStore`:

```ts
export interface MultiHostLabelStore extends HostLabelStore {
  saveFor(serverId: string, label: string): Promise<void>
  loadFor(serverId: string): Promise<string | null>
  clearFor(serverId: string): Promise<void>
}
```

`createHostLabelStore` widens its return type to `MultiHostLabelStore`. That is a subtype relation,
so the composition root and all three `Pick`-narrowed consumers need no edit.

Naming: a `saveFor` / `loadFor` / `clearFor` triple mirrors the un-keyed `save` / `load` / `clear`
one-for-one, which is the pairing the Strangler Fig migration reads against. The sibling's
`loadById` / `clearServer` names are not a coherent triple to borrow.

`clearFor` returns `Promise<void>`, **not** the sibling's `{ matched, remaining }`. Those two
questions are already answered for this family by `pairedServerStore.clearServer`, which is what
#1156's unpair arm reads; a second outcome type here would have no reader. An unread return type is
surface, not information.

No `list()` and no keyed "newest" read: no AC and no consumer asks for either.

### The at-rest format

A version-marked object envelope, UTF-8 JSON, under the **unchanged** `HOST_LABEL_NAME`:

```
{"v":1,"labels":[{"server":"<id>","label":"<text>"}]}
```

Entries are an **array of objects carrying their own `server` field**, never a map keyed by id —
the sibling's rule, and what keeps `__proto__` inert (AC4): an id is only ever compared with `===`
against a decoded entry's own field. It never becomes a store name, a persistence path, or an object
key. Add-or-replace-by-key on save, appended, so entry order is the saved order and tests are stable.

The envelope is an object with a `v` marker rather than the sibling's bare array, and that deviation
is what AC5 buys (below).

### The discriminator: legacy blob vs malformed blob (AC3 vs AC5)

AC3 wants a bad blob to raise; AC5 wants a legacy blob not to. Both are "a blob the new decoder
cannot read". The seam this module already owns settles it: invalid UTF-8 is unreachable through
either version's `save` (`TextEncoder` always emits valid UTF-8), and `safeStorage` is AEAD, so
tampering fails DECRYPTION upstream and never reaches the decoder. What reaches the decoder and is
neither is precisely the old format — an arbitrary operator-typed string.

So the version marker is the discriminator, and the decode is a **positive** test in this order:

1. Decode UTF-8 with `fatal: true` → invalid bytes throw `MalformedHostLabelError`. **(AC3; unchanged)**
2. `JSON.parse` fails → legacy → **empty collection**. (Most old labels, e.g. `Pyrybox`.)
3. Not a non-null, non-array object → legacy → **empty collection**. (Covers AC5's `[]`, `null`,
   `123`, and any bare JSON string.)
4. `v !== HOST_LABEL_FORMAT_VERSION` → legacy → **empty collection**. (Covers AC5's `{}`.)
5. Past the marker the blob is unambiguously ours, so it is held to the sibling's discipline: a
   non-array `labels`, a non-object entry, a missing or non-string `server` / `label`, or a repeated
   `server` id all throw `MalformedHostLabelError`. A recognized-but-broken envelope is format drift,
   not legacy, and must not silently drop a server's label.

Accepted limitation: a legacy label whose text is *exactly* a valid v1 envelope would be read as a
collection. It is a 128-char-bounded human-typed host name; the outcome is bounded (labels for ids
the operator invented) and no worse than AC5's sanctioned loss.

Migration is read-time only — nothing in the decoder writes. The first keyed `saveFor` replaces the
legacy blob (AC5).

### The keyed save's leniency

`saveFor` becomes read-modify-write, so it gains the ability to reject on a stored blob that the old
blind `save` could not. It reads through the sibling's `readForSave` shape: a
`MalformedHostLabelError` counts as an empty collection and the save overwrites it; a **decrypt**
failure propagates (it may be transient keychain state, and discarding every label on it is worse).
Without that, one corrupt blob would make the label unsettable forever, with no in-app exit.

`loadFor` and `clearFor` stay strict: they surface the corruption to whoever asks.

### The un-keyed triple is left bit-for-bit unchanged

`save` / `load` / `clear` keep writing and reading a bare UTF-8 label under the same name, off the
mutate queue, with today's exact contract. Both formats share one blob and each recognizes only its
own, which is safe **because no shipped state calls both**: this slice wires nothing, so after it the
blob is still only ever bare UTF-8 and every current caller behaves exactly as today.

**Hand-off to the sibling slice:** migrate all four call sites (`pairingHandler`, both
`unpairHandler` arms, `hostLabelHandler`) in one go. A partial migration is the one state where an
un-keyed `load()` would read a keyed envelope back as though it were the label text. This slice adds
no guard against it — that state cannot arise here, and the un-keyed triple is deleted once the
migration lands.

## State + concurrency model

No store slice, no Zustand, no renderer state — a main-process accessor over one injected seam. No
cache, no timers, no listeners, nothing to cancel on teardown.

`saveFor` and `clearFor` are read-modify-write, so two of them interleaving across an `await` would
drop a server's label — #1069's own defect from the other direction. They are serialized through the
sibling's `mutate` chain, which continues across a rejected operation (`then(op, op)`) so one failed
save cannot wedge the store, and swallows its own copy of the outcome so a rejection is never
unhandled. Reads stay off the chain: each is a single `get` with nothing to interleave.

This **retires a stated invariant.** The `HostLabelStore` doc comment says there is deliberately no
`load`-then-`save` helper because that would be "a check-then-act race this module currently cannot
have". Keying is what gives it one. The invariant is restated where it still holds — the un-keyed
triple — and the queue is named as what replaces it for the keyed members.

## Error handling

| Condition | Result |
|---|---|
| No blob | keyed reads → no labels; un-keyed `load` → `null` |
| Legacy blob (any valid UTF-8 that is not a v1 envelope) | keyed reads → no labels, no throw; replaced by the first `saveFor` |
| Blob present, decrypts, not valid UTF-8 | `MalformedHostLabelError` from every read; `saveFor` overwrites |
| v1 envelope, broken entries / repeated id | `MalformedHostLabelError` from every read; `saveFor` overwrites |
| Decrypt failure | propagates from every path, `saveFor` included; never masked as absence |
| Keychain unavailable on write | `EncryptionUnavailableError` propagates; nothing written |
| `delete` failure | propagates (fail-closed) |
| `clearFor` for an id with no entry | resolves, writes nothing |
| `clearFor` removing the last entry | deletes the blob, so "no blob" stays the one at-rest form of nothing-stored |

`MalformedHostLabelError`'s message stays static: no bytes, no offending id, no entry count. The
module stays log-free on every path, and `loadFor` hands its unbounded untrusted value on to
consumers unvalidated, exactly as `load` does.

## Testing strategy

All vitest, in `src/main/hostLabelStore.test.ts`, over the existing in-file `fakeSecureStore` — no
keychain, no filesystem, no new seam. Every existing test in that file stays untouched and green
(including the `HOST_LABEL_NAME` literal pin and the injected-name seam test). Scenarios:

- **AC1** — save for A, save for B, both retrievable and unchanged; a reopened store over the same
  persistence reads both back; one blob under one name throughout.
- **AC1** — re-saving A replaces A's label and leaves B's alone.
- **AC2** — `clearFor(A)` leaves B retrievable; `clearFor` of an unheld id writes nothing; clearing
  the last entry deletes the blob and leaves the neighbouring credential names intact.
- **AC3** — per server: absent id → `null`; stored `''` → `''` and not `null`; invalid-UTF-8 blob →
  `MalformedHostLabelError` from `loadFor`; decrypt failure propagates.
- **AC3** — a v1 envelope with a broken entry / a repeated `server` id raises, and `saveFor`
  recovers it (table-driven, mirroring the sibling's corrupt-blob recovery test).
- **AC4** — table over `__proto__`, `../pyrycode.paired_server`, `''`, and a long id: the blob lands
  under `HOST_LABEL_NAME` and nowhere else, `store.size === 1`, the label is retrievable under that
  id only, and a `__proto__` id leaves `{}` unpolluted.
- **AC5** — table over `Pyrybox`, `[]`, `{}`, `null`, `123`, `"quoted"`: every one reads as no labels
  for several ids without raising, and the first `saveFor` replaces the blob with a v1 envelope.
- **Queue** — three `saveFor`s for distinct ids started together via `Promise.all` land all three
  (unserialized, the later reads clobber); a failed mutation does not wedge the chain.
- **Un-keyed unchanged** — `save` → `load` still round-trips bare UTF-8 with the keyed members
  present, and the blob is still the bare encoding, not JSON.
- **Log-free** — the existing log-free test is extended over the keyed happy and error paths.

Nothing here is interactive and nothing renders, so no Playwright spec: the fake-transport tier
cannot reach a main-process store that no IPC channel is wired to in this slice.

## Open questions

1. Does the un-keyed triple need a guard against reading a keyed envelope as label text? Resolved in
   Design: no — the mixed state cannot arise in this slice's shipped state, and the sibling migrates
   all four callers at once. Recorded as a hand-off rather than shipped as an untested defense.
2. Should `clearFor` report `{ matched, remaining }`? Resolved in Design: no — `pairedServerStore`
   already answers both for this family and is what #1156 reads.
3. Is the legacy label's one-time loss worth carrying over? Out of scope by the ticket's own ruling:
   it would need the paired records in scope, so it belongs in the composition root if wanted at all.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST FIX. The module keeps ONE boundary — disk bytes → memory, in
  `decodeLabels` — and this slice adds a second untrusted *input*: `serverId`, which is QR/paste
  input once the sibling wires the callers. It reaches exactly two places, both inert: a `===`
  comparand against a decoded entry's own `server` field, and a `JSON.stringify`d string value. It
  never reaches `name`, so no attacker-chosen text touches the persistence path (AC4) — structural,
  because `name` is `deps.name ?? HOST_LABEL_NAME` and nothing in the module concatenates it.
  Downstream, `loadFor` hands back the same untrusted, unbounded display text `load` does; that
  hand-off is documented on the interface and unchanged per server.
- **[Trust boundaries]** SHOULD FIX — prototype pollution is closed only if the implementation keeps
  three specific choices, so Phase B must land all three: entries are an ARRAY of objects carrying
  their own `server`, never a map keyed by id; the duplicate-id check uses a `Set`, never an object
  or a bare `{}` accumulator (`Set.has('__proto__')` is safe, `{}['__proto__']` is not); and each
  entry is rebuilt field-by-field from narrowed values, never spread from the parsed candidate.
  `JSON.parse` makes `__proto__` an own property rather than invoking the setter, so the parse itself
  is safe — the risk is entirely in what the decoder does with the parsed value afterwards. The AC4
  test table must include `__proto__` as an id and assert an unpolluted `{}`.
- **[Tokens, secrets, credentials]** No findings. Neither the label nor the `server` id is a
  credential, and both already live at this exact at-rest tier: `pairedServerStore` holds the id in
  the same `safeStorage` chain beside the bearer token. `ServerInfoEntry.serverId` is already a
  sanctioned renderer-visible field, so writing ids into this blob creates no new disclosure class.
  No token is generated, compared, rotated, or logged here.
- **[File / storage]** No findings. No path is constructed, joined, or resolved. AC4's
  `../pyrycode.paired_server` id is only ever a JSON value and a `===` comparand, so the traversal
  shape it names is unreachable. `clearFor`'s last-entry `secureStore.delete(name)` deletes by this
  store's own constant, never by a literal or an id-derived name — pinned by extending the existing
  "erases ONLY the label" test to the `clearFor` path, which is where a cross-store erase would show
  up. Encryption at rest, fail-closed writes and temp-then-rename atomicity are inherited from the
  seam unchanged (ADR 0005).
- **[Inter-process / Electron attack surface]** No findings — this slice adds none. No
  `contextBridge`, no `ipcMain`, no `BrowserWindow`, no composition-root wiring; every caller is
  explicitly a sibling slice's. The module stays main-process-only and importable in plain Node.
- **[Cryptographic primitives]** No findings, and one thing to state so it is not misread later: the
  `serverId === entry.server` comparison is NOT a secret compare and does not want
  `crypto.timingSafeEqual`. The id is a non-secret identifier, it authorizes nothing (the IPC channel
  authorizes the erase, not the match), and a timing signal on it discloses only which ids are
  stored — which `serverInfoHandler` already publishes to the renderer by design.
- **[Network & I/O]** N/A by design — no socket, no URL, no timeout, no remote input. The module's
  only edge is the injected `SecureStore` type.
- **[Errors, logs, telemetry]** No findings, with one implementation constraint: the new reject
  branches (non-array `labels`, malformed entry, repeated id) must reuse
  `MalformedHostLabelError`'s STATIC message and interpolate nothing — no offending id, no entry
  index, no count. An id in that message would put attacker-chosen text into an error that a
  consumer may surface or log, and a count would leak how many servers are paired (the sibling's own
  stated reason). The module stays log-free on every path; the existing log-free test is extended
  over the keyed paths to pin it.
- **[Concurrency]** No MUST FIX; the category's own check-then-act bullet is this ticket's central
  change and is addressed. `saveFor` / `clearFor` are read-modify-write and are serialized through
  the `mutate` chain, with the read INSIDE the mutate callback — outside it, the queue would serialize
  the writes while leaving the check-then-act gap wide open, which is the subtle way to get this
  wrong. Reads stay off the chain (a single `get`, nothing to interleave, and the blob is written
  atomically so there is no torn read). Cross-PROCESS races (two app instances) are last-writer-wins
  with no torn blob, inherited from `fileSecretPersistence`'s temp-then-rename — the same posture the
  sibling ships, not a regression. No timers, listeners, or long-lived tasks are added, so there is
  nothing to abort on teardown.
- **[Threat model alignment]** No findings. Malicious relay and hostile daemon are unreachable: the
  label is not a wire field and the daemon never sees it. Renderer compromise reaches nothing — zero
  IPC surface in this slice. A disk-write attacker gains one new capability, denial rather than
  escalation: a forged v1 envelope makes reads raise, blanking the sidebar name. It is recoverable
  (`saveFor` overwrites it) and strictly weaker than the record-replacement that same access already
  allows.
- **[Threat model alignment]** OUT OF SCOPE — label entries are never reconciled against the paired
  records, so a sibling that forgets to `clearFor` on unpair leaves a label for a server that no
  longer exists. Growth is bounded by the pairing act (an entry needs a successful pairing) and each
  label is bounded at `MAX_HOST_LABEL_LENGTH` three layers up, so this is hygiene, not a
  memory-exhaustion vector. It belongs to the slice that re-keys the unpair arms (#1156), which
  already holds the `clearServer` outcome that decides it.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06
</content>
</invoke>
